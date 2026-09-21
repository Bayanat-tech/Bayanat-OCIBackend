import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtJobDocList = listProc("PROC_FRT_JOB_DOC_LIST", "p_result");
export const frtJobDocInit = actionProc("PROC_FRT_JOB_DOC_INIT", ["p_company_code", "p_prin_code", "p_job_no", "p_user_id"], "Job documents initialized");
export const frtJobDocDelete = actionProc("PROC_FRT_JOB_DOC_DELETE", ["p_company_code", "p_prin_code", "p_job_no", "p_doc_nr"], "Job document deleted");

export const frtJobDocSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const docs = Array.isArray(req.body.docs) ? req.body.docs : [];
    await connection.execute(
      `BEGIN PROC_FRT_JOB_DOC_SAVE(:p_company_code, :p_prin_code, :p_job_no, :p_user_id, :p_docs); END;`,
      {
        p_company_code: bodyValue(req, "company_code"),
        p_prin_code: bodyValue(req, "prin_code"),
        p_job_no: bodyValue(req, "job_no"),
        p_user_id: bodyValue(req, "user_id"),
        p_docs: { type: "FRT_JOB_DOC_TAB", val: docs.map(toDocObject) },
      },
      { autoCommit: true }
    );
    res.json({ success: true, message: "Job documents saved successfully" });
  });
};

export const frtJobInstructionCodeList = codeListProc("PROC_FRT_JOB_INSTRUCTION_CODE_LIST");
export const frtJobInstructionList = listProc("PROC_FRT_JOB_INSTRUCTION_LIST", "p_result");
export const frtJobInstructionInit = actionProc("PROC_FRT_JOB_INSTRUCTION_INIT", ["p_company_code", "p_prin_code", "p_job_no", "p_user_id", "p_op_type", "p_op_mode"], "Job instructions initialized");
export const frtJobInstructionDelete = actionProc("PROC_FRT_JOB_INSTRUCTION_DELETE", ["p_company_code", "p_prin_code", "p_job_no", "p_op_code"], "Job instruction deleted");

export const frtJobInstructionSave = async (req: Request, res: Response): Promise<void> => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  await saveLines(res, req, "PROC_FRT_JOB_INSTRUCTION_SAVE", "FRT_JOB_INSTRUCTION_TAB", "p_lines", lines.map(toInstructionObject), "Job instructions saved successfully");
};

export const frtJobAlertCodeList = codeListProc("PROC_FRT_JOB_ALERT_CODE_LIST");
export const frtJobAlertList = listProc("PROC_FRT_JOB_ALERT_LIST", "p_result");
export const frtJobAlertInit = actionProc("PROC_FRT_JOB_ALERT_INIT", ["p_company_code", "p_prin_code", "p_job_no", "p_user_id", "p_op_type", "p_op_mode"], "Job alerts initialized");
export const frtJobAlertDelete = actionProc("PROC_FRT_JOB_ALERT_DELETE", ["p_company_code", "p_prin_code", "p_job_no", "p_op_code"], "Job alert deleted");

export const frtJobAlertSave = async (req: Request, res: Response): Promise<void> => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  await saveLines(res, req, "PROC_FRT_JOB_ALERT_SAVE", "FRT_JOB_ALERT_TAB", "p_lines", lines.map(toAlertObject), "Job alerts saved successfully");
};

export const frtJobDepositList = listProc("PROC_FRT_JOB_DEPOSIT_LIST", "p_result");
export const frtJobDepositDelete = actionProc("PROC_FRT_JOB_DEPOSIT_DELETE", ["p_company_code", "p_prin_code", "p_job_no", "p_sr_no"], "Job deposit deleted");

export const frtJobDepositSave = async (req: Request, res: Response): Promise<void> => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  await saveLines(res, req, "PROC_FRT_JOB_DEPOSIT_SAVE", "FRT_JOB_DEPOSIT_TAB", "p_lines", lines.map(toDepositObject), "Job deposits saved successfully");
};

function listProc(procName: string, outName: string) {
  return async (req: Request, res: Response): Promise<void> => {
    await withConnection(res, async (connection) => {
      const result = await connection.execute(
        `BEGIN ${procName}(:p_company_code, :p_prin_code, :p_job_no, :${outName}); END;`,
        {
          p_company_code: bodyValue(req, "company_code"),
          p_prin_code: bodyValue(req, "prin_code"),
          p_job_no: bodyValue(req, "job_no"),
          [outName]: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const rows = await rowsFromCursor((result.outBinds as any)[outName]);
      res.json({ success: true, data: rows, totalCount: rows.length });
    });
  };
}

function codeListProc(procName: string) {
  return async (req: Request, res: Response): Promise<void> => {
    await withConnection(res, async (connection) => {
      const result = await connection.execute(
        `BEGIN ${procName}(:p_company_code, :p_op_type, :p_op_mode, :p_result); END;`,
        {
          p_company_code: bodyValue(req, "company_code"),
          p_op_type: bodyValue(req, "op_type"),
          p_op_mode: bodyValue(req, "op_mode"),
          p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const rows = await rowsFromCursor((result.outBinds as any).p_result);
      res.json({ success: true, data: rows, totalCount: rows.length });
    });
  };
}

function actionProc(procName: string, bindNames: string[], message: string) {
  return async (req: Request, res: Response): Promise<void> => {
    await withConnection(res, async (connection) => {
      const placeholders = bindNames.map((name) => `:${name}`).join(", ");
      await connection.execute(
        `BEGIN ${procName}(${placeholders}); END;`,
        Object.fromEntries(bindNames.map((name) => [name, bindActionValue(req, name)])),
        { autoCommit: true }
      );
      res.json({ success: true, message });
    });
  };
}

async function saveLines(res: Response, req: Request, procName: string, typeName: string, collectionBindName: string, lines: Record<string, unknown>[], message: string) {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN ${procName}(:p_company_code, :p_prin_code, :p_job_no, :p_user_id, :${collectionBindName}); END;`,
      {
        p_company_code: bodyValue(req, "company_code"),
        p_prin_code: bodyValue(req, "prin_code"),
        p_job_no: bodyValue(req, "job_no"),
        p_user_id: bodyValue(req, "user_id"),
        [collectionBindName]: { type: typeName, val: lines },
      },
      { autoCommit: true }
    );
    res.json({ success: true, message });
  });
}

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
    console.error("Freight job follow-up procedure error:", error);
    res.status(500).json({ success: false, message: "Failed to execute Freight job follow-up procedure", details: error?.message || "Unknown error" });
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

function bindActionValue(req: Request, bindName: string) {
  const key = bindName.replace(/^p_/, "");
  if (key.includes("date")) return toDate(bodyValue(req, key));
  if (key === "op_code" || key === "sr_no") return numberValue(bodyValue(req, key));
  return bodyValue(req, key);
}

function bodyValue(req: Request, key: string) {
  return req.body[key] ?? req.body[key.toUpperCase()] ?? null;
}

function toDocObject(row: Record<string, unknown>) {
  return {
    DOC_NR: stringValue(row.doc_nr ?? row.DOC_NR),
    COLLECTED: stringValue(row.collected ?? row.COLLECTED, "N"),
    MANDATORY: stringValue(row.mandatory ?? row.MANDATORY, "N"),
    DOC_PATH: stringValue(row.doc_path ?? row.DOC_PATH),
    DOC_RECEIVED_DT: toDate(row.doc_received_dt ?? row.DOC_RECEIVED_DT),
    DOC_RECEIVED_BY: stringValue(row.doc_received_by ?? row.DOC_RECEIVED_BY),
    DOC_RECEIVED_MODE: stringValue(row.doc_received_mode ?? row.DOC_RECEIVED_MODE),
    REMARKS: stringValue(row.remarks ?? row.REMARKS),
    DOC_SEND_DT: toDate(row.doc_send_dt ?? row.DOC_SEND_DT),
    DOC_SEND_BY: stringValue(row.doc_send_by ?? row.DOC_SEND_BY),
    DOC_SEND_MODE: stringValue(row.doc_send_mode ?? row.DOC_SEND_MODE),
    DOCUMENT_TYPE: stringValue(row.document_type ?? row.DOCUMENT_TYPE),
  };
}

function toInstructionObject(row: Record<string, unknown>) {
  return {
    OP_CODE: numberValue(row.op_code ?? row.OP_CODE),
    OP_ASSIGNED: stringValue(row.op_assigned ?? row.OP_ASSIGNED),
    OP_DATE: toDate(row.op_date ?? row.OP_DATE),
    OP_REMARKS: stringValue(row.op_remarks ?? row.OP_REMARKS),
    END_DATE: toDate(row.end_date ?? row.END_DATE),
    END_REMARKS: stringValue(row.end_remarks ?? row.END_REMARKS),
  };
}

function toAlertObject(row: Record<string, unknown>) {
  return {
    OP_CODE: numberValue(row.op_code ?? row.OP_CODE),
    OP_DATE: toDate(row.op_date ?? row.OP_DATE),
    REMARKS: stringValue(row.remarks ?? row.REMARKS),
    OP_TYPE: stringValue(row.op_type ?? row.OP_TYPE),
    OP_COUNT: numberValue(row.op_count ?? row.OP_COUNT),
    OP_YESNO: stringValue(row.op_yesno ?? row.OP_YESNO),
  };
}

function toDepositObject(row: Record<string, unknown>) {
  return {
    SR_NO: numberValue(row.sr_no ?? row.SR_NO),
    INV_NO: numberValue(row.inv_no ?? row.INV_NO),
    JOB_TYPE: stringValue(row.job_type ?? row.JOB_TYPE),
    EXIT_BILL1: stringValue(row.exit_bill1 ?? row.EXIT_BILL1),
    EXIT_BILL2: stringValue(row.exit_bill2 ?? row.EXIT_BILL2),
    TXN_TYPE: stringValue(row.txn_type ?? row.TXN_TYPE, "JOB"),
    AMOUNT: numberValue(row.amount ?? row.AMOUNT),
    DEPOSIT_DATE: toDate(row.deposit_date ?? row.DEPOSIT_DATE),
    DEPOSIT_EXPIRY_DATE: toDate(row.deposit_expiry_date ?? row.DEPOSIT_EXPIRY_DATE),
    SIGN_INDICATOR: numberValue(row.sign_indicator ?? row.SIGN_INDICATOR, 1),
    CURRENCY: stringValue(row.currency ?? row.CURRENCY),
    STATUS: stringValue(row.status ?? row.STATUS, "D"),
    BE_NO: stringValue(row.be_no ?? row.BE_NO),
    CLAIM_REF_NO: stringValue(row.claim_ref_no ?? row.CLAIM_REF_NO),
    SUPP_CODE: stringValue(row.supp_code ?? row.SUPP_CODE),
    CUST_CODE: stringValue(row.cust_code ?? row.CUST_CODE),
    INV_REF: stringValue(row.inv_ref ?? row.INV_REF),
    COLLECTED_DATE: toDate(row.collected_date ?? row.COLLECTED_DATE),
    DEPOSIT_REMARKS: stringValue(row.deposit_remarks ?? row.DEPOSIT_REMARKS),
    DEMURAGE_AMOUNT: numberValue(row.demurage_amount ?? row.DEMURAGE_AMOUNT),
    DEPOSIT_TYPE: stringValue(row.deposit_type ?? row.DEPOSIT_TYPE, "CNTRLNR"),
  };
}

function stringValue(input: unknown, fallback: string | null = null) {
  if (input === undefined || input === null) return fallback;
  const text = String(input).trim();
  return text ? text : fallback;
}

function numberValue(input: unknown, fallback: number | null = null) {
  const text = stringValue(input);
  if (text === null) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function toDate(input: unknown) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
}
