import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtWorkspaceSummary = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_WORKSPACE_SUMMARY(
           :p_company_code,
           :p_user_id,
           :p_summary,
           :p_recent_jobs
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_user_id: req.body.user_id ?? req.body.USER_ID ?? req.body.loginid ?? req.body.LOGINID,
        p_summary: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_recent_jobs: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    const summaryRows = await rowsFromCursor(outBinds.p_summary);
    const recentJobs = await rowsFromCursor(outBinds.p_recent_jobs);
    res.json({ success: true, data: { summary: summaryRows[0] ?? {}, recentJobs } });
  });
};

export const frtJobSearch = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_SEARCH(
           :p_company_code,
           :p_user_id,
           :p_job_no,
           :p_job_date,
           :p_fy_period,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_user_id: req.body.user_id ?? req.body.USER_ID ?? req.body.loginid ?? req.body.LOGINID,
        p_job_no: req.body.job_no ?? req.body.JOB_NO ?? null,
        p_job_date: toDate(req.body.job_date ?? req.body.JOB_DATE),
        p_fy_period: req.body.fy_period ?? req.body.FY_PERIOD ?? req.body.fy ?? req.body.FY ?? null,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
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
    console.error("Freight workspace procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight workspace procedure",
      details: error?.message || "Unknown error",
    });
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

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
