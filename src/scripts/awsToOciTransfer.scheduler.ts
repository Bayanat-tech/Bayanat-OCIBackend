import { oracleDb } from "../database/connection";
import constants from "../helpers/constants";
import {
  S3Client as AWSS3Client,
  GetObjectCommand as AWSGetObjectCommand,
} from "@aws-sdk/client-s3";
import { S3Client as OCIClient, PutObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";
import cron from "node-cron";
import stream from "stream";
import { promisify } from "util";

const pipeline = promisify(stream.pipeline);

const SOURCE_TABLE = process.env.SOURCE_TABLE || "UPLOADED_FILES_DLTS"; 
const DEST_TABLE = process.env.DEST_TABLE || "UPLOADED_FILES_DLTS_OCI"; 
const BATCH_SIZE = Number(process.env.TRANSFER_BATCH_SIZE || 50);
const SCHEDULE_CRON = process.env.SCHEDULE_CRON || ""; 
const MAX_DOWNLOAD_RETRIES = 3;


const awsS3 = new AWSS3Client({
  region: (constants.AWS_S3_CREDENTIALS && constants.AWS_S3_CREDENTIALS.REGION) || process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || (constants.AWS_S3_CREDENTIALS && constants.AWS_S3_CREDENTIALS.ACCESS_KEY),
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || (constants.AWS_S3_CREDENTIALS && constants.AWS_S3_CREDENTIALS.SECRET_ACCESS_KEY),
  },
  maxAttempts: 3,
});


const ociS3 = new OCIClient({
  region: constants.OCI_S3_COMPATIBILITY.REGION,
  endpoint: constants.OCI_S3_COMPATIBILITY.ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: constants.OCI_S3_COMPATIBILITY.ACCESS_KEY_ID,
    secretAccessKey: constants.OCI_S3_COMPATIBILITY.SECRET_ACCESS_KEY,
  },
  maxAttempts: 3,
  requestHandler: {
    disableConcurrentStreams: true,
  },
});


const MAX_CONCURRENT = Number(process.env.TRANSFER_CONCURRENCY || 5);
const FILE_TIMEOUT_MS = Number(process.env.TRANSFER_FILE_TIMEOUT_MS || 10 * 60 * 1000); 

function parseAwsUrl(url: string): { bucket?: string; key?: string } {
  try {
    
    const encodedUrl = url.replace(/ /g, '%20');
    const u = new URL(encodedUrl);
    const hostParts = u.hostname.split(".");
    
    if (hostParts.length >= 4 && hostParts[1] === "s3") {
      const bucket = hostParts[0];
      const key = decodeURIComponent(u.pathname.substring(1));
      return { bucket, key };
    }
    
    const pathParts = decodeURIComponent(u.pathname.substring(1)).split("/");
    if (pathParts.length >= 2) {
      const bucket = pathParts[0];
      const key = pathParts.slice(1).join("/");
      return { bucket, key };
    }
    
    return {};
  } catch (err) {
    console.error(`[awsToOci] URL parsing failed for: ${url}`, err);
    return {};
  }
}

async function downloadFromAws(url: string, abortSignal?: AbortSignal): Promise<NodeJS.ReadableStream> {
  const parsed = parseAwsUrl(url);
  
  console.log(`[awsToOci] Processing URL: ${url.substring(0, 100)}...`);

  if (parsed.bucket && parsed.key) {
    try {
      const cmd = new AWSGetObjectCommand({ 
        Bucket: parsed.bucket, 
        Key: parsed.key 
      });
      
      const resp = await awsS3.send(cmd, { abortSignal });
      
      if (!resp.Body) {
        throw new Error("Empty body from AWS GetObject");
      }
      
      console.log(`[awsToOci] SUCCESS! Found file with key: "${parsed.key.substring(0, 100)}${parsed.key.length > 100 ? '...' : ''}"`);
      return resp.Body as unknown as NodeJS.ReadableStream;
    } catch (err: any) {
      // SPECIFIC 403 HANDLING
      if (err.name === 'AccessDenied' || err.statusCode === 403) {
        console.error(`[awsToOci] ACCESS DENIED (403) to: s3://${parsed.bucket}/${parsed.key}`);
        console.error(`[awsToOci] Error details: ${err.message}`);
        throw new Error(`S3_ACCESS_DENIED_403: No permission to access this file`);
      }
      
      const originalKey = parsed.key;
      const candidates = new Set<string>();
      
      candidates.add(originalKey);
      candidates.add(decodeURIComponent(originalKey));
      
      if (originalKey.includes(" ")) {
        candidates.add(originalKey.replace(/ /g, "%20"));
      }
      
      if (originalKey.includes("%20")) {
        candidates.add(originalKey.replace(/%20/g, " "));
      }
      
      if (originalKey.includes(" ")) {
        candidates.add(originalKey.replace(/ /g, "+"));
      }
      
      candidates.add(encodeURI(originalKey));
      
      const uniqueCandidates = Array.from(candidates).filter(k => k && k.trim());
      
      let lastErr: any = null;
      
      for (const keyCandidate of uniqueCandidates) {
        try {
          const cmd = new AWSGetObjectCommand({ 
            Bucket: parsed.bucket, 
            Key: keyCandidate 
          });
          
          const resp = await awsS3.send(cmd, { abortSignal });
          
          if (!resp.Body) {
            throw new Error("Empty body from AWS GetObject");
          }
          
          console.log(`[awsToOci] SUCCESS! Found file with key: "${keyCandidate.substring(0, 100)}${keyCandidate.length > 100 ? '...' : ''}"`);
          return resp.Body as unknown as NodeJS.ReadableStream;
        } catch (err: any) {
          lastErr = err;
        }
      }
      
      console.error(`[awsToOci] All key variants failed for bucket=${parsed.bucket}`);
    }
  }

  // Fallback: Try HTTP GET
  console.log(`[awsToOci] Attempting HTTP GET fallback`);
  try {
    let httpUrl = url;
    if (url.includes(" ")) {
      const urlObj = new URL(url);
      const encodedPath = urlObj.pathname.split("/").map(segment => 
        encodeURIComponent(segment).replace(/%2F/g, "/")
      ).join("/");
      httpUrl = `${urlObj.origin}${encodedPath}${urlObj.search}`;
    }
    
    const response = await axios.get(httpUrl, {
      responseType: "stream",
      timeout: FILE_TIMEOUT_MS,
      signal: abortSignal as any,
    });
    
    return response.data as NodeJS.ReadableStream;
  } catch (httpErr: any) {
    if (httpErr.response?.status === 403) {
      throw new Error(`HTTP_ACCESS_DENIED_403: No permission to access this file`);
    }
    throw new Error(`All download methods failed: ${httpErr.message}`);
  }
}

// for OCI compatibility
async function uploadToOci(streamBody: NodeJS.ReadableStream, targetKey: string, contentType?: string, abortSignal?: AbortSignal) {
  return new Promise<string>(async (resolve, reject) => {
    try {
      console.log(`[awsToOci] Starting OCI upload for key: "${targetKey.substring(0, 100)}${targetKey.length > 100 ? '...' : ''}"`);
      
      const chunks: Buffer[] = [];
      
      streamBody.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      streamBody.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          console.log(`[awsToOci] Buffered ${buffer.length} bytes for OCI upload`);
          
          const params = {
            Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
            Key: targetKey,
            Body: buffer,
            ContentType: contentType || "application/octet-stream",
            ContentLength: buffer.length,
          };
          
          console.log(`[awsToOci] Uploading ${buffer.length} bytes to OCI...`);
          await ociS3.send(new PutObjectCommand(params), { abortSignal });
          
          // Generate OCI URL
          const encodedKey = targetKey.split("/").map(segment => 
            encodeURIComponent(segment).replace(/%2F/g, "/")
          ).join("/");
          
          const ociUrl = constants.OCI_S3_COMPATIBILITY.getObjectUrl(encodedKey);
          console.log(`[awsToOci] OCI upload successful: ${ociUrl}`);
          resolve(ociUrl);
        } catch (uploadErr: any) {
          reject(uploadErr);
        }
      });
      
      streamBody.on('error', (err) => {
        reject(err);
      });
      
    } catch (err: any) {
      reject(err);
    }
  });
}

async function uploadToOciStreaming(streamBody: NodeJS.ReadableStream, targetKey: string, contentType?: string, abortSignal?: AbortSignal) {
  console.log(`[awsToOci] Using streaming upload for key: "${targetKey.substring(0, 100)}${targetKey.length > 100 ? '...' : ''}"`);
  
  const { Transform } = await import('stream');
  
  const passThrough = new Transform({
    transform(chunk, encoding, callback) {
      this.push(chunk);
      callback();
    }
  });
  
  streamBody.pipe(passThrough);
  
  const params = {
    Bucket: constants.OCI_S3_COMPATIBILITY.BUCKET_NAME,
    Key: targetKey,
    Body: passThrough,
    ContentType: contentType || "application/octet-stream",
  };
  
  await ociS3.send(new PutObjectCommand(params), { abortSignal });
  
  const encodedKey = targetKey.split("/").map(segment => 
    encodeURIComponent(segment).replace(/%2F/g, "/")
  ).join("/");
  
  return constants.OCI_S3_COMPATIBILITY.getObjectUrl(encodedKey);
}

async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<boolean>,
  concurrency: number
): Promise<{ total: number; success: number; failed: number }> {
  let idx = 0;
  const results: number[] = [];
  const workers: Promise<void>[] = [];
  const failedItems: { index: number, item: T, error?: any }[] = [];

  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (true) {
          const currentIndex = idx++;
          if (currentIndex >= items.length) break;
          const current = items[currentIndex];
          try {
            const ok = await worker(current);
            results.push(ok ? 1 : 0);
            if (!ok) {
              failedItems.push({ index: currentIndex, item: current });
            }
          } catch (err) {
            console.error("Worker unexpected error:", err);
            results.push(0);
            failedItems.push({ index: currentIndex, item: current, error: err });
          }
        }
      })()
    );
  }

  await Promise.all(workers);

  const success = results.reduce((s, v) => s + v, 0);
  const total = items.length;
  const failed = total - success;
  
  if (failedItems.length > 0) {
    console.log(`[awsToOci] Failed items (${failedItems.length}):`);
    failedItems.slice(0, 10).forEach((failedItem, idx) => {
      const row = failedItem.item as any;
      console.log(`  ${idx + 1}. Request: ${row.REQUEST_NUMBER || 'NULL'}, SR: ${row.SR_NO}, Error: ${failedItem.error?.message?.substring(0, 100) || 'Unknown'}`);
    });
    if (failedItems.length > 10) {
      console.log(`  ... and ${failedItems.length - 10} more`);
    }
  }
  
  return { total, success, failed };
}

async function transferSingleRow(row: any): Promise<boolean> {
  const reqNo = row.REQUEST_NUMBER ?? row.requestNumber ?? row.request_number ?? null;
  
  const srNo = row.SR_NO ?? row.srNo ?? 0;
  const awsUrl = row.AWS_FILE_LOCN ?? row.awsFileLocn ?? "";
  const orgFileName = row.ORG_FILE_NAME ?? row.orgFileName ?? row.ORG_FILE_NAME;
  const targetKey = getTargetKeyFromAwsUrl(awsUrl, orgFileName);

  if (!awsUrl) {
    console.warn(`[awsToOci] skipping row missing aws url request=${reqNo} sr=${srNo}`);
    return false;
  }

  console.log(`[awsToOci] Starting transfer for request=${reqNo} sr=${srNo}`);

  let attempt = 0;
  while (attempt <= MAX_DOWNLOAD_RETRIES) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      console.warn(`[awsToOci] file timeout reached (${FILE_TIMEOUT_MS}ms) for ${awsUrl}, aborting`);
      try { controller.abort(); } catch (e) {}
    }, FILE_TIMEOUT_MS);

    try {
      // Download from AWS
      const bodyStream = await downloadFromAws(awsUrl, controller.signal);
      
      // Upload to OCI - using buffered approach
      const ociUrl = await uploadToOci(bodyStream, targetKey, undefined, controller.signal);
      clearTimeout(timer);
      console.log(`[awsToOci] SUCCESS: uploaded to OCI: ${ociUrl} (req=${reqNo} sr=${srNo})`);

      await oracleDb.withTransaction(async (conn) => {
        const insertDestSql = `
          INSERT INTO ${DEST_TABLE} (
            COMPANY_CODE, REQUEST_NUMBER, SR_NO, FILE_NAME, ORG_FILE_NAME,
            OCI_FILE_LOCN, FLOW_LEVEL, MODULES, CREATED_AT, CREATED_BY,
            EXTENSIONS, USER_FILE_NAME, TYPE, ATTACHMENT_SR_NO, SOURCE_AWS_URL
          ) VALUES (
            :company_code, :request_number, :sr_no, :file_name, :org_file_name,
            :oci_file_locn, :flow_level, :modules, SYSDATE, :created_by,
            :extensions, :user_file_name, :type, :attachment_sr_no, :source_aws_url
          )
        `;
        
        const insertBinds = {
          company_code: { val: row.COMPANY_CODE || null },
          request_number: { val: reqNo },
          sr_no: { val: srNo },
          file_name: { val: row.FILE_NAME || null },
          org_file_name: { val: orgFileName || null },
          oci_file_locn: { val: ociUrl },
          flow_level: { val: row.FLOW_LEVEL || null },
          modules: { val: row.MODULES || null },
          created_by: { val: "SYSTEM_TRANSFER" },
          extensions: { val: row.EXTENSIONS || null },
          user_file_name: { val: row.USER_FILE_NAME || null },
          type: { val: row.TYPE || null },
          attachment_sr_no: { val: null },
          source_aws_url: { val: awsUrl },
        };

        await oracleDb.query(insertDestSql, insertBinds, conn);

        const updateSourceSql = `
          UPDATE ${SOURCE_TABLE}
          SET FILE_TRANSFER = 'Y',
              UPDATED_AT = SYSTIMESTAMP
          WHERE REQUEST_NUMBER = :request_number
            AND NVL(SR_NO,0) = NVL(:sr_no,0)
        `;
        await oracleDb.query(updateSourceSql, { 
          request_number: { val: reqNo }, 
          sr_no: { val: srNo } 
        }, conn);
      });

      return true;
    } catch (err: any) {
      clearTimeout(timer);
      
      const errorMessage = err?.message || String(err);
      console.warn(`[awsToOci] transfer attempt ${attempt} failed: ${errorMessage.substring(0, 200)}`);

      if (attempt > MAX_DOWNLOAD_RETRIES) {
        console.error(`[awsToOci] giving up after ${attempt} attempts`);
        
        let finalStatus = 'E'; 
        let errorMsg = `Transfer failed: ${errorMessage.substring(0, 195)}`;
        
        if (errorMessage.includes('403') || errorMessage.includes('ACCESS_DENIED') || 
            errorMessage.includes('S3_ACCESS_DENIED') || errorMessage.includes('HTTP_ACCESS_DENIED')) {
          finalStatus = '403'; 
          errorMsg = `S3 Access Denied (403): No permission to access AWS file`;
        }
        
        try {
          const errorUpdateSql = `
            UPDATE ${SOURCE_TABLE}
            SET FILE_TRANSFER = :status,
                UPDATED_AT = SYSTIMESTAMP,
                ERROR_MESSAGE = :error_msg
            WHERE REQUEST_NUMBER = :request_number
              AND NVL(SR_NO,0) = NVL(:sr_no,0)
          `;
          await oracleDb.query(errorUpdateSql, { 
            status: { val: finalStatus },
            request_number: { val: reqNo }, 
            sr_no: { val: srNo },
            error_msg: { val: errorMsg }
          });
        } catch (dbErr) {
          console.error(`[awsToOci] Failed to update error status: ${dbErr}`);
        }
        
        return false;
      }

      const backoffMs = 1000 * Math.pow(2, attempt);
      console.log(`[awsToOci] Waiting ${backoffMs}ms before retry ${attempt + 1}...`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  return false;
}

function getTargetKeyFromAwsUrl(awsUrl: string, fallbackOrgName?: string): string {
  try {
    const parsed = parseAwsUrl(awsUrl);
    if (parsed && parsed.key) {
      return parsed.key;
    }
  } catch (err) {
    console.warn("getTargetKeyFromAwsUrl parse failed:", err);
  }

  return (fallbackOrgName || "file.bin").toString();
}

async function ensureDestTableExists() {
  try {
    const alterSourceSql = `
    BEGIN
      EXECUTE IMMEDIATE '
        ALTER TABLE ${SOURCE_TABLE} 
        ADD (ERROR_MESSAGE VARCHAR2(500))';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -1430 THEN
          RAISE;
        END IF;
    END;
    `;
    await oracleDb.query(alterSourceSql);
    console.log(`[awsToOci] ensured ERROR_MESSAGE column exists in ${SOURCE_TABLE}`);
  } catch (err) {
    console.warn(`[awsToOci] could not add ERROR_MESSAGE column:`, err);
  }

  const createTableSql = `
  BEGIN
    EXECUTE IMMEDIATE '
      CREATE TABLE ${DEST_TABLE} (
        COMPANY_CODE     VARCHAR2(7),
        REQUEST_NUMBER   VARCHAR2(25),
        SR_NO            NUMBER,
        FILE_NAME        VARCHAR2(180),
        ORG_FILE_NAME    VARCHAR2(400),
        OCI_FILE_LOCN    VARCHAR2(500),
        FLOW_LEVEL       NUMBER(3),
        MODULES          VARCHAR2(50),
        CREATED_AT       DATE DEFAULT SYSDATE,
        CREATED_BY       VARCHAR2(50),
        EXTENSIONS       VARCHAR2(200),
        USER_FILE_NAME   VARCHAR2(200),
        TYPE             VARCHAR2(100),
        ATTACHMENT_SR_NO NUMBER,
        SOURCE_AWS_URL   VARCHAR2(500),
        TRANSFER_DATE    DATE DEFAULT SYSDATE,
        STATUS           VARCHAR2(20) DEFAULT ''SUCCESS''
      )';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE != -955 THEN
        RAISE;
      END IF;
  END;
  `;
  try {
    await oracleDb.query(createTableSql);
    console.log(`[awsToOci] ensured destination table ${DEST_TABLE} exists`);
  } catch (err) {
    console.error(`[awsToOci] failed ensuring dest table ${DEST_TABLE}:`, err);
    throw err;
  }
}

async function transferFailedRecordsOnly() {
  console.log(`[awsToOci] ===== PROCESSING FAILED RECORDS ONLY =====`);
  console.log(`[awsToOci] Source: ${SOURCE_TABLE} -> Destination: ${DEST_TABLE}`);
  

  const sql = `
    SELECT COMPANY_CODE, REQUEST_NUMBER, SR_NO, FILE_NAME, ORG_FILE_NAME, 
           AWS_FILE_LOCN, FLOW_LEVEL, MODULES, EXTENSIONS, USER_FILE_NAME, TYPE
    FROM ${SOURCE_TABLE}
    WHERE AWS_FILE_LOCN IS NOT NULL
      AND FILE_TRANSFER = 'E'
      AND (ERROR_MESSAGE IS NULL OR 
           (ERROR_MESSAGE NOT LIKE '%403%' AND 
            ERROR_MESSAGE NOT LIKE '%ACCESS_DENIED%' AND
            ERROR_MESSAGE NOT LIKE '%S3_ACCESS_DENIED%' AND
            ERROR_MESSAGE NOT LIKE '%HTTP_ACCESS_DENIED%'))
    ORDER BY REQUEST_NUMBER, SR_NO
  `;
  
  try {
    const startTime = Date.now();
    
    console.log(`[awsToOci] Fetching failed records...`);
    const rowsResult: any = await oracleDb.query(sql);
    const rows: any[] = rowsResult.rows || [];
    
    console.log(`[awsToOci] Found ${rows.length} failed records to retry (excluding 403 errors)`);
    
    if (rows.length === 0) {
      console.log(`[awsToOci] No failed records found (excluding 403 errors).`);
      return { total: 0, success: 0, failed: 0, durationMs: 0 };
    }
    
    const concurrency = Math.max(1, Number(process.env.TRANSFER_CONCURRENCY || Math.min(5, rows.length)));
    console.log(`[awsToOci] running transfer with concurrency=${concurrency}`);
    
    const stats = await runWithConcurrency(rows, transferSingleRow, concurrency);
    
    const durationMs = Date.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(2);
    
    console.log(`\n[awsToOci] ===== FAILED RECORDS RETRY COMPLETED =====`);
    console.log(`[awsToOci] Total: ${stats.total}, Success: ${stats.success}, Failed: ${stats.failed}`);
    console.log(`[awsToOci] Duration: ${durationSec} seconds`);
    console.log(`[awsToOci] Success rate: ${stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(2) : 0}%`);
    
    return { total: stats.total, success: stats.success, failed: stats.failed, durationMs };
    
  } catch (err) {
    console.error("[awsToOci] Failed records retry failed:", err);
    throw err;
  }
}

async function markAll403Errors() {
  console.log(`[awsToOci] ===== MARKING ALL 403 ERRORS =====`);
  
  const sql = `
    UPDATE ${SOURCE_TABLE}
    SET FILE_TRANSFER = '403',
        ERROR_MESSAGE = 'S3 Access Denied (403): No permission to access AWS file',
        UPDATED_AT = SYSTIMESTAMP
    WHERE FILE_TRANSFER = 'E'
      AND (ERROR_MESSAGE LIKE '%403%' OR 
           ERROR_MESSAGE LIKE '%ACCESS_DENIED%' OR
           ERROR_MESSAGE LIKE '%S3_ACCESS_DENIED%' OR
           ERROR_MESSAGE LIKE '%HTTP_ACCESS_DENIED%')
  `;
  
  try {
    const result: any = await oracleDb.query(sql);
    console.log(`[awsToOci] Marked ${result.rowsAffected || 0} records as 403 errors`);
    return result.rowsAffected || 0;
  } catch (err) {
    console.error("[awsToOci] Failed to mark 403 errors:", err);
    throw err;
  }
}

async function transferBatchOnce() {
  console.log(`[awsToOci] ===== STARTING BATCH TRANSFER =====`);
  console.log(`[awsToOci] Source: ${SOURCE_TABLE} -> Destination: ${DEST_TABLE}`);
  console.log(`[awsToOci] Batch size: ${BATCH_SIZE}`);
  
  // duplicate processing
  const sql = `
    SELECT COMPANY_CODE, REQUEST_NUMBER, SR_NO, FILE_NAME, ORG_FILE_NAME, 
           AWS_FILE_LOCN, FLOW_LEVEL, MODULES, EXTENSIONS, USER_FILE_NAME, TYPE
    FROM ${SOURCE_TABLE}
    WHERE AWS_FILE_LOCN IS NOT NULL
      AND NVL(FILE_TRANSFER,'N') NOT IN ('Y', 'E', '403')
      AND ROWID IN (
        SELECT MIN(ROWID)
        FROM ${SOURCE_TABLE}
        WHERE AWS_FILE_LOCN IS NOT NULL
          AND NVL(FILE_TRANSFER,'N') NOT IN ('Y', 'E', '403')
        GROUP BY REQUEST_NUMBER, SR_NO, AWS_FILE_LOCN
      )
    ORDER BY REQUEST_NUMBER, SR_NO
    FETCH FIRST :batch ROWS ONLY
  `;
  
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  const startTime = Date.now();
  
  try {
    while (true) {
      console.log(`\n[awsToOci] --- Fetching next batch (${BATCH_SIZE} rows) ---`);
      
      const rowsResult: any = await oracleDb.query(sql, { batch: { val: BATCH_SIZE } });
      const rows: any[] = rowsResult.rows || [];
      
      console.log(`[awsToOci] fetched ${rows.length} rows to process`);
      
      if (rows.length === 0) {
        console.log(`[awsToOci] No more rows to process.`);
        break;
      }
      
      totalProcessed += rows.length;
      
      const concurrency = Math.max(1, Number(process.env.TRANSFER_CONCURRENCY || MAX_CONCURRENT));
      console.log(`[awsToOci] running transfer with concurrency=${concurrency}`);
      
      const stats = await runWithConcurrency(rows, transferSingleRow, concurrency);
      
      totalSuccess += stats.success;
      totalFailed += stats.failed;
      
      console.log(`[awsToOci] Batch completed: Processed=${rows.length}, Success=${stats.success}, Failed=${stats.failed}`);
      console.log(`[awsToOci] Running totals: Total=${totalProcessed}, Success=${totalSuccess}, Failed=${totalFailed}`);
      
      if (rows.length >= BATCH_SIZE) {
        await new Promise(resolve => setTimeout(resolve, 1000)); 
      }
    }
    
    const durationMs = Date.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(2);
    const durationMin = (durationMs / 60000).toFixed(2);
    
    console.log(`\n[awsToOci] ===== TRANSFER COMPLETED =====`);
    console.log(`[awsToOci] FINAL TOTALS:`);
    console.log(`[awsToOci] Total processed: ${totalProcessed}`);
    console.log(`[awsToOci] Success: ${totalSuccess}`);
    console.log(`[awsToOci] Failed: ${totalFailed}`);
    console.log(`[awsToOci] Duration: ${durationSec} seconds (${durationMin} minutes)`);
    console.log(`[awsToOci] Success rate: ${totalProcessed > 0 ? ((totalSuccess / totalProcessed) * 100).toFixed(2) : 0}%`);
    
    if (totalFailed > 0) {
      console.log(`\n[awsToOci] === FAILED ITEMS SUMMARY ===`);
      const failedSql = `
        SELECT REQUEST_NUMBER, SR_NO, AWS_FILE_LOCN, ERROR_MESSAGE, FILE_TRANSFER
        FROM ${SOURCE_TABLE}
        WHERE FILE_TRANSFER IN ('E', '403')
        ORDER BY REQUEST_NUMBER, SR_NO
      `;
      const failedResult: any = await oracleDb.query(failedSql);
      const failedRows: any[] = failedResult.rows || [];
      
      console.log(`[awsToOci] Found ${failedRows.length} failed transfers:`);
      failedRows.slice(0, 20).forEach((row, idx) => {
        console.log(`  ${idx + 1}. Request: ${row.REQUEST_NUMBER || 'NULL'}, SR: ${row.SR_NO}, Status: ${row.FILE_TRANSFER}`);
        console.log(`     URL: ${row.AWS_FILE_LOCN?.substring(0, 80)}...`);
        console.log(`     Error: ${row.ERROR_MESSAGE || 'Unknown'}`);
      });
      if (failedRows.length > 20) {
        console.log(`  ... and ${failedRows.length - 20} more`);
      }
      
      console.log(`\n[awsToOci] You can retry failed records by running: TRANSFER_FAILED_ONLY=true node your-script.js`);
      console.log(`[awsToOci] To mark all 403 errors permanently: MARK_403_ERRORS=true node your-script.js`);
    }
    
    return { total: totalProcessed, success: totalSuccess, failed: totalFailed, durationMs };
    
  } catch (err) {
    console.error("[awsToOci] transfer failed:", err);
    throw err;
  }
}

export async function startTransferScheduler() {
  try {
    await ensureDestTableExists(); 
  } catch (err) {
    console.error("[awsToOci] cannot ensure dest table - aborting scheduler start", err);
    throw err;
  }

  if (process.env.MARK_403_ERRORS === "true") {
    console.log("\n[awsToOci] ===== MARKING ALL 403 ERRORS MODE =====");
    const result = await markAll403Errors();
    console.log(`[awsToOci] Marked ${result} records as 403 errors`);
    return;
  }

  if (process.env.TRANSFER_FAILED_ONLY === "true") {
    console.log("\n[awsToOci] ===== PROCESSING FAILED RECORDS ONLY MODE =====");
    const result = await transferFailedRecordsOnly();
    console.log(`[awsToOci] Failed records retry completed: ${JSON.stringify(result)}`);
    return;
  }

  if (SCHEDULE_CRON) {
    console.log(`[awsToOci] scheduling transfer with cron "${SCHEDULE_CRON}"`);
    cron.schedule(SCHEDULE_CRON, async () => {
      console.log(`\n[awsToOci] ===== SCHEDULED RUN TRIGGERED =====`);
      console.log(`[awsToOci] Time: ${new Date().toISOString()}`);
      try {
        const result = await transferBatchOnce();
        console.log(`[awsToOci] scheduled run completed: ${JSON.stringify(result)}`);
      } catch (err) {
        console.error("[awsToOci] scheduled run failed:", err);
      }
    });
    
    console.log("[awsToOci] cron job registered; next runs will log start/completion in console.");
    (async () => {
      console.log("\n[awsToOci] ===== RUNNING INITIAL TRANSFER PASS (STARTUP) =====");
      try {
        const initialResult = await transferBatchOnce();
        console.log("[awsToOci] initial transfer pass completed:", JSON.stringify(initialResult));
      } catch (initialErr) {
        console.error("[awsToOci] initial transfer pass failed:", initialErr);
      }
    })();
  } else {
    console.log("\n[awsToOci] ===== RUNNING IMMEDIATE TRANSFER PASS =====");
    const res = await transferBatchOnce();
    console.log(`[awsToOci] immediate run completed: ${JSON.stringify(res)}`);
  }
}

if (require.main === module) {
  (async () => {
    try {
     
      await oracleDb.authenticate();
      console.log("[awsToOci] Database connection established");
      await startTransferScheduler();
      
      if (!SCHEDULE_CRON) {
        console.log("[awsToOci] Transfer completed. Exiting.");
        process.exit(0);
      } else {
        console.log("[awsToOci] Scheduler started. Waiting for cron jobs...");
        process.on('SIGINT', () => {
          console.log('[awsToOci] Received SIGINT. Shutting down...');
          process.exit(0);
        });
        process.on('SIGTERM', () => {
          console.log('[awsToOci] Received SIGTERM. Shutting down...');
          process.exit(0);
        });
      }
    } catch (err) {
      console.error("[awsToOci] fatal error:", err);
      process.exit(1);
    }
  })();
}

export {
  parseAwsUrl,
  downloadFromAws,
  uploadToOci,
  transferSingleRow,
  getTargetKeyFromAwsUrl,
  transferFailedRecordsOnly,
  markAll403Errors
};