import { oracleDb } from "./src/database/connection";
import constants from "./src/helpers/constants";
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

// ==================== CONFIGURATION ====================
const SOURCE_TABLE = process.env.SOURCE_TABLE || "PURCHASE_REQUEST_FILES_ocitransfer";
const BATCH_SIZE = Number(process.env.TRANSFER_BATCH_SIZE || 50);
const SCHEDULE_CRON = process.env.SCHEDULE_CRON || "";
const MAX_DOWNLOAD_RETRIES = 3;

// AWS S3 client (unchanged)
const awsS3 = new AWSS3Client({
  region: (constants.AWS_S3_CREDENTIALS && constants.AWS_S3_CREDENTIALS.REGION) || process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || (constants.AWS_S3_CREDENTIALS && constants.AWS_S3_CREDENTIALS.ACCESS_KEY),
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || (constants.AWS_S3_CREDENTIALS && constants.AWS_S3_CREDENTIALS.SECRET_ACCESS_KEY),
  },
  maxAttempts: 3,
});

// OCI S3-compatible client (unchanged)
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

// ==================== HELPER FUNCTIONS (unchanged) ====================
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
  // ... (unchanged, same as original)
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
      // ... (key variants logic unchanged)
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

  // HTTP fallback
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

async function uploadToOci(streamBody: NodeJS.ReadableStream, targetKey: string, contentType?: string, abortSignal?: AbortSignal) {
  // ... (unchanged, same as original)
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

// Optional streaming upload (kept for reference)
async function uploadToOciStreaming(streamBody: NodeJS.ReadableStream, targetKey: string, contentType?: string, abortSignal?: AbortSignal) {
  // ... (unchanged)
}

// ==================== CONCURRENCY HELPER (unchanged) ====================
async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<boolean>,
  concurrency: number
): Promise<{ total: number; success: number; failed: number }> {
  // ... (same as original)
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

// ==================== CORE TRANSFER LOGIC (modified) ====================
async function transferSingleRow(row: any): Promise<boolean> {
  // Extract fields from PURCHASE_REQUEST_FILES_ocitransfer
  const companyCode = row.COMPANY_CODE;
  const reqNo = row.REQUEST_NUMBER;
  const srNo = row.SR_NO;
  const fileName = row.FILE_NAME;
  const orgFileName = row.ORG_FILE_NAME;
  const awsUrl = row.NEW_AWS_FILE_LOCN;
  // USER_DT, USER_ID, FILE_VIEWED are not needed for transfer

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

      // Upload to OCI
      const ociUrl = await uploadToOci(bodyStream, targetKey, undefined, controller.signal);
      clearTimeout(timer);
      console.log(`[awsToOci] SUCCESS: uploaded to OCI: ${ociUrl} (req=${reqNo} sr=${srNo})`);

      // Update the source row with OCI URL and success status
      await oracleDb.withTransaction(async (conn) => {
        const updateSql = `
          UPDATE ${SOURCE_TABLE}
          SET OCI_FILE_LOCN = :oci_file_locn,
              FILE_TRANSFER = 'Y',
              UPDATED_AT = SYSTIMESTAMP,
              ERROR_MESSAGE = NULL
          WHERE REQUEST_NUMBER = :request_number
            AND SR_NO = :sr_no
        `;

        const binds = {
          oci_file_locn: { val: ociUrl },
          request_number: { val: reqNo },
          sr_no: { val: srNo }
        };

        await oracleDb.query(updateSql, binds, conn);
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
              AND SR_NO = :sr_no
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
  // ... (unchanged)
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

// ==================== TABLE INITIALIZATION (modified) ====================
async function ensureTableColumnsExist() {
  // Add required columns to PURCHASE_REQUEST_FILES_ocitransfer if they don't exist
  const alterStatements = [
    `ALTER TABLE ${SOURCE_TABLE} ADD (OCI_FILE_LOCN VARCHAR2(500))`,
    `ALTER TABLE ${SOURCE_TABLE} ADD (FILE_TRANSFER VARCHAR2(3) DEFAULT 'N')`,
    `ALTER TABLE ${SOURCE_TABLE} ADD (ERROR_MESSAGE VARCHAR2(500))`,
    `ALTER TABLE ${SOURCE_TABLE} ADD (UPDATED_AT DATE)` // optional timestamp
  ];

  for (const sql of alterStatements) {
    try {
      await oracleDb.query(`
        BEGIN
          EXECUTE IMMEDIATE q'[${sql}]';
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLCODE != -1430 THEN  -- ORA-01430: column already exists
              RAISE;
            END IF;
        END;
      `);
      console.log(`[awsToOci] Ensured column exists: ${sql}`);
    } catch (err) {
      console.error(`[awsToOci] Failed to add column: ${sql}`, err);
      throw err; // stop if critical
    }
  }

  // Optionally create an index for performance
  try {
    await oracleDb.query(`
      BEGIN
        EXECUTE IMMEDIATE q'[CREATE INDEX idx_prf_transfer ON ${SOURCE_TABLE}(FILE_TRANSFER)]';
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLCODE != -955 THEN  -- ORA-00955: name already used
            RAISE;
          END IF;
      END;
    `);
  } catch (err) {
    console.warn(`[awsToOci] Could not create index:`, err);
  }
}

// ==================== BATCH TRANSFER (modified queries) ====================
async function transferBatchOnce() {
  console.log(`[awsToOci] ===== STARTING BATCH TRANSFER =====`);
  console.log(`[awsToOci] Table: ${SOURCE_TABLE}`);
  console.log(`[awsToOci] Batch size: ${BATCH_SIZE}`);

 
  const sql = `
    SELECT COMPANY_CODE, REQUEST_NUMBER, SR_NO, FILE_NAME, ORG_FILE_NAME, NEW_AWS_FILE_LOCN
    FROM ${SOURCE_TABLE}
    WHERE NEW_AWS_FILE_LOCN IS NOT NULL
      AND NVL(FILE_TRANSFER,'N') NOT IN ('Y', 'E', '403')
      AND ROWID IN (
        SELECT MIN(ROWID)
        FROM ${SOURCE_TABLE}
        WHERE NEW_AWS_FILE_LOCN IS NOT NULL
          AND NVL(FILE_TRANSFER,'N') NOT IN ('Y', 'E', '403')
        GROUP BY REQUEST_NUMBER, SR_NO, NEW_AWS_FILE_LOCN
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
        SELECT REQUEST_NUMBER, SR_NO, NEW_AWS_FILE_LOCN, ERROR_MESSAGE, FILE_TRANSFER
        FROM ${SOURCE_TABLE}
        WHERE FILE_TRANSFER IN ('E', '403')
        ORDER BY REQUEST_NUMBER, SR_NO
      `;
      const failedResult: any = await oracleDb.query(failedSql);
      const failedRows: any[] = failedResult.rows || [];

      console.log(`[awsToOci] Found ${failedRows.length} failed transfers:`);
      failedRows.slice(0, 20).forEach((row, idx) => {
        console.log(`  ${idx + 1}. Request: ${row.REQUEST_NUMBER || 'NULL'}, SR: ${row.SR_NO}, Status: ${row.FILE_TRANSFER}`);
        console.log(`     URL: ${row.NEW_AWS_FILE_LOCN?.substring(0, 80)}...`);
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

// ==================== FAILED RECORDS RETRY (modified) ====================
async function transferFailedRecordsOnly() {
  console.log(`[awsToOci] ===== PROCESSING FAILED RECORDS ONLY =====`);
  console.log(`[awsToOci] Table: ${SOURCE_TABLE}`);

  // Retry only records with status 'E' and not 403-related errors
  const sql = `
    SELECT COMPANY_CODE, REQUEST_NUMBER, SR_NO, FILE_NAME, ORG_FILE_NAME, NEW_AWS_FILE_LOCN
    FROM ${SOURCE_TABLE}
    WHERE NEW_AWS_FILE_LOCN IS NOT NULL
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

// ==================== MARK 403 ERRORS (modified) ====================
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

// ==================== SCHEDULER / ENTRY POINT (modified) ====================
export async function startTransferScheduler() {
  try {
    await ensureTableColumnsExist();
  } catch (err) {
    console.error("[awsToOci] cannot ensure required columns - aborting scheduler start", err);
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

// ==================== EXPORTS (updated) ====================
export {
  parseAwsUrl,
  downloadFromAws,
  uploadToOci,
  transferSingleRow,
  getTargetKeyFromAwsUrl,
  transferFailedRecordsOnly,
  markAll403Errors
};