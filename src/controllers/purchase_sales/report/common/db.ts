import oracledb from "oracledb";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import TenantManager from "../../../../database/TenantManager";
import { REPORT_CONFIG, ReportConfig, ReportRow } from "./types";
import { text } from "./formatters";

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn)
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  );
}

/**
 * Resolve report kind from:
 *  1. URL path param  (req.params.reportType)
 *  2. body/query report_type
 *  3. body/query doc_type
 */
export function resolveReportConfig(req: RequestWithUser): ReportConfig {
  const raw =
    text(req.params?.reportType || req.body?.report_type || req.query?.report_type).trim().toUpperCase() ||
    text(req.body?.doc_type || req.query?.doc_type).trim().toUpperCase();

  const key =
    raw === "DN" || raw === "DELIVERY" || raw === "DELIVERY_NOTE"
      ? "SDN"
      : raw === "INV" || raw === "INVOICE" || raw === "SI"
        ? "SINVOICE"
        : raw;

  const cfg = REPORT_CONFIG[key];
  if (!cfg) {
    throw Object.assign(
      new Error(
        `Unsupported report type "${raw || "(empty)"}". Supported: ${Object.keys(REPORT_CONFIG).join(", ")}`,
      ),
      { status: 400 },
    );
  }
  return cfg;
}

export function parseDocParams(req: RequestWithUser) {
  const company =
    text(req.body?.company_code || req.query?.company_code || req.user?.company_code).trim() ||
    text(req.user?.company_code);
  const cfg = resolveReportConfig(req);
  const docType = text(req.body?.doc_type || req.query?.doc_type).trim() || cfg.kind;
  const docNo = text(req.body?.doc_no || req.query?.doc_no).trim();

  if (!company) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (!docNo) {
    throw Object.assign(new Error("doc_no is required"), { status: 400 });
  }

  return { company, docType, docNo, cfg };
}

export async function loadSalesDoc(
  req: RequestWithUser,
): Promise<{ rows: ReportRow[]; cfg: ReportConfig }> {
  const { company, docType, docNo, cfg } = parseDocParams(req);
  const conn = await getConn(req);

  try {
    // viewName comes only from REPORT_CONFIG (no user input injection)
    const sql = `
      SELECT *
        FROM ${cfg.viewName}
       WHERE company_code = :as_company
         AND doc_type     = :as_doctype
         AND doc_no       = :as_docno
       ORDER BY serial_no
    `;

    const result = await conn.execute(
      sql,
      {
        as_company: company,
        as_doctype: docType,
        as_docno: docNo,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return { rows: normalize(result.rows as any[]), cfg };
  } finally {
    await closeConn(conn);
  }
}
