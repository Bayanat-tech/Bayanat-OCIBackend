import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtAttachmentList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_ATTACHMENT_LIST(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_context,
           :p_doc_nr,
           :p_result
         );
       END;`,
      {
        p_company_code: bodyValue(req, "company_code"),
        p_prin_code: bodyValue(req, "prin_code"),
        p_job_no: bodyValue(req, "job_no"),
        p_context: bodyValue(req, "context"),
        p_doc_nr: bodyValue(req, "doc_nr"),
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtAttachmentSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const file = req.body.file ?? req.body;
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_ATTACHMENT_SAVE(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_context,
           :p_doc_nr,
           :p_file_name,
           :p_org_file_name,
           :p_aws_file_locn,
           :p_extensions,
           :p_user_file_name,
           :p_modules,
           :p_file_type,
           :p_flow_level,
           :p_user_id,
           :p_sr_no_out
         );
       END;`,
      {
        p_company_code: value(file.company_code ?? file.COMPANY_CODE ?? req.body.company_code),
        p_prin_code: value(file.prin_code ?? file.PRIN_CODE ?? req.body.prin_code),
        p_job_no: value(file.job_no ?? file.JOB_NO ?? req.body.job_no),
        p_context: value(file.context ?? file.CONTEXT ?? req.body.context),
        p_doc_nr: value(file.doc_nr ?? file.DOC_NR ?? req.body.doc_nr),
        p_file_name: value(file.file_name ?? file.FILE_NAME),
        p_org_file_name: value(file.org_file_name ?? file.ORG_FILE_NAME),
        p_aws_file_locn: value(file.aws_file_locn ?? file.AWS_FILE_LOCN),
        p_extensions: value(file.extensions ?? file.EXTENSIONS),
        p_user_file_name: value(file.user_file_name ?? file.USER_FILE_NAME),
        p_modules: value(file.modules ?? file.MODULES ?? "FREIGHT"),
        p_file_type: value(file.file_type ?? file.FILE_TYPE ?? file.type ?? file.TYPE),
        p_flow_level: numberValue(file.flow_level ?? file.FLOW_LEVEL),
        p_user_id: value(file.user_id ?? file.USER_ID ?? req.body.user_id),
        p_sr_no_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true }
    );
    res.json({ success: true, message: "Freight attachment saved successfully", data: { sr_no: (result.outBinds as any).p_sr_no_out } });
  });
};

export const frtAttachmentRename = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_ATTACHMENT_RENAME(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_context,
           :p_doc_nr,
           :p_sr_no,
           :p_user_file_name,
           :p_user_id
         );
       END;`,
      {
        p_company_code: bodyValue(req, "company_code"),
        p_prin_code: bodyValue(req, "prin_code"),
        p_job_no: bodyValue(req, "job_no"),
        p_context: bodyValue(req, "context"),
        p_doc_nr: bodyValue(req, "doc_nr"),
        p_sr_no: numberValue(bodyValue(req, "sr_no")),
        p_user_file_name: bodyValue(req, "user_file_name"),
        p_user_id: bodyValue(req, "user_id"),
      },
      { autoCommit: true }
    );
    res.json({ success: true, message: "Freight attachment renamed successfully" });
  });
};

export const frtAttachmentDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_ATTACHMENT_DELETE(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_context,
           :p_doc_nr,
           :p_sr_no,
           :p_user_id
         );
       END;`,
      {
        p_company_code: bodyValue(req, "company_code"),
        p_prin_code: bodyValue(req, "prin_code"),
        p_job_no: bodyValue(req, "job_no"),
        p_context: bodyValue(req, "context"),
        p_doc_nr: bodyValue(req, "doc_nr"),
        p_sr_no: numberValue(bodyValue(req, "sr_no")),
        p_user_id: bodyValue(req, "user_id"),
      },
      { autoCommit: true }
    );
    res.json({ success: true, message: "Freight attachment deleted successfully" });
  });
};

async function withConnection(res: Response, handler: (connection: Connection) => Promise<void>) {
  let connection: Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);
    await handler(connection);
  } catch (error: any) {
    console.error("Freight attachment procedure error:", error);
    res.status(500).json({ success: false, message: "Failed to execute Freight attachment procedure", details: error?.message || "Unknown error" });
  } finally {
    if (connection) await connection.close();
  }
}

async function rowsFromCursor(cursor: any) {
  if (!cursor) return [];
  try {
    return await cursor.getRows(10000);
  } finally {
    await cursor.close();
  }
}

function bodyValue(req: Request, key: string) {
  return req.body[key] ?? req.body[key.toUpperCase()] ?? null;
}

function value(input: unknown) {
  if (input === undefined || input === null) return null;
  const text = String(input).trim();
  return text ? text : null;
}

function numberValue(input: unknown) {
  const text = value(input);
  if (text === null) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
