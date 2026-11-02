// src/pages/hr/Reports/DocumentReportHtml.ts (or controllers/wms/reports/DocumentReport.controller.ts)
//
// HR Document Report — HTML/print endpoint

import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  reportAppliedFilters,
  buildReportDocument,
} from "../../common/report_common";

type ReportRow = Record<string, any>;

// ─── DB Helpers ───────────────────────────────────────────────────────────────

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

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function parseDate(value: unknown): Date | null {
  const v = text(value).trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Param Parser ────────────────────────────────────────────────────────────

function allIfBlank(value: unknown): string {
  const v = text(value).trim();
  return v || "All";
}

function parseParams(req: RequestWithUser) {
  const src = { ...(req.query as Record<string, any>), ...(req.body || {}) };

  const userCompany = text(req.user?.company_code).trim();
  const companyCode = userCompany || text(src.company_code).trim() || "";

  return {
    companyCode,
    divCode: allIfBlank(src.div_code),
    docType: allIfBlank(src.doc_type ?? src.grade_code),
    fromDate: parseDate(src.from_date),
    toDate: parseDate(src.to_date),
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

const REPORT_PARAMETER = "Hr_Report_HR_DOCUMENT_REPORT";

async function loadDocumentData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  console.log("[DocumentReport] params:", {
    companyCode: params.companyCode,
    divCode: params.divCode,
    docType: params.docType,
    fromDate: params.fromDate?.toISOString(),
    toDate: params.toDate?.toISOString(),
  });

  if (!params.companyCode) {
    throw Object.assign(new Error("company_code is required"), { status: 400 });
  }
  if (!params.fromDate || !params.toDate) {
    throw Object.assign(new Error("from_date and to_date are required"), { status: 400 });
  }
  if (params.fromDate > params.toDate) {
    throw Object.assign(new Error("'From Date' cannot be greater than 'To Date'"), {
      status: 400,
    });
  }

  const conn = await getConn(req);

  try {
    const binds: Record<string, any> = {
      p_parameter: REPORT_PARAMETER,
      p_loginid: params.loginId,
      p_number1: null,
      p_number2: null,
      p_number3: null,
      p_number4: null,
      p_date1: { val: params.fromDate, type: oracledb.DATE },
      p_date2: { val: params.toDate, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    // P_CODE1 = company, P_CODE2 = division, P_CODE3 = doc type
    const codes = [params.companyCode, params.divCode, params.docType];
    for (let i = 1; i <= 20; i++) {
      binds[`p_code${i}`] = i <= codes.length ? codes[i - 1] : null;
    }

    const codeArgs = Array.from({ length: 20 }, (_, i) => `:p_code${i + 1}`).join(", ");

    const procResult = await conn.execute(
      `BEGIN
         PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
           :p_parameter, :p_loginid,
           ${codeArgs},
           :p_number1, :p_number2, :p_number3, :p_number4,
           :p_date1, :p_date2, :p_date3, :p_date4,
           :p_return_string
         );
       END;`,
      binds,
    );

    const builtSql = text((procResult.outBinds as any)?.p_return_string).trim();

    console.log("[DocumentReport] Built SQL:", builtSql);

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("[DocumentReport] Rows returned:", (result.rows as any[])?.length ?? 0);

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS ────────────────────────────────────────────────────────────────

const DOCUMENT_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  .rpt-title {
    text-align: center;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 3px;
    padding: 5px 0;
    margin: 0 0 10px;
    border-bottom: 1px solid #cbd5e1;
  }

  .doc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
    margin-top: 8px;
  }
  .doc-table th,
  .doc-table td {
    border: 1px solid #94a3b8;
    padding: 3px 5px;
    text-align: left;
    vertical-align: top;
  }
  .doc-table th {
    background: #f1f5f9;
    font-weight: 700;
    white-space: nowrap;
  }
  .doc-table td.num { text-align: right; }
  .doc-table td.center { text-align: center; }
  .doc-table td.wrap { word-break: break-word; max-width: 180px; }
  .doc-table thead { display: table-header-group; }
  .doc-table tr { page-break-inside: avoid; }

  .doc-total {
    margin-top: 8px;
    font-size: 10.5px;
    font-weight: 700;
  }

  .doc-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 700;
  }
  .doc-badge-active { background: #dcfce7; color: #166534; }
  .doc-badge-expired { background: #fee2e2; color: #991b1b; }
  .doc-badge-pending { background: #fef3c7; color: #92400e; }
`;

// ─── Status badge helper ─────────────────────────────────────────────────────

function statusBadge(value: unknown): string {
  const v = text(value).trim().toUpperCase();
  if (!v) return "";
  if (v === "A" || v === "ACTIVE") return `<span class="doc-badge doc-badge-active">Active</span>`;
  if (v === "E" || v === "EXPIRED") return `<span class="doc-badge doc-badge-expired">Expired</span>`;
  if (v === "P" || v === "PENDING") return `<span class="doc-badge doc-badge-pending">Pending</span>`;
  return escapeHtml(value);
}

// ─── Body Renderer ────────────────────────────────────────────────────────────

function renderDocumentBody(rows: ReportRow[], filtersHtml = ""): string {
  const heading = `<div class="rpt-title">HR DOCUMENT REPORT</div>`;

  if (!rows.length) {
    return `
      ${heading}
      ${filtersHtml}
      <p class="center muted">No data found</p>
    `;
  }

  const bodyRows = rows
    .map(
      (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.company_code)}</td>
          <td>${escapeHtml(r.div_code)}</td>
          <td>${escapeHtml(r.doc_serial_number)}</td>
          <td>${escapeHtml(r.doc_type)}</td>
          <td>${escapeHtml(r.doc_no)}</td>
          <td>${escapeHtml(r.doc_ref_no)}</td>
          <td>${escapeHtml(r.iss_plc)}</td>
          <td>${escapeHtml(fmtDate(r.iss_date))}</td>
          <td>${escapeHtml(fmtDate(r.exp_date))}</td>
          <td>${escapeHtml(fmtDate(r.expiry_date))}</td>
          <td>${escapeHtml(fmtDate(r.start_date))}</td>
          <td>${escapeHtml(fmtDate(r.tr_date))}</td>
          <td class="center">${statusBadge(r.status_flag)}</td>
          <td>${escapeHtml(fmtDate(r.status_date))}</td>
          <td>${escapeHtml(r.email_id)}</td>
          <td>${escapeHtml(r.approved_by)}</td>
          <td>${escapeHtml(fmtDate(r.approved_date))}</td>
          <td class="wrap">${escapeHtml(r.doc_remarks)}</td>
          <td class="wrap">${escapeHtml(r.expiry_remarks)}</td>
          <td class="wrap">${escapeHtml(r.req_remarks)}</td>
        </tr>`,
    )
    .join("");

  return `
    ${heading}
    ${filtersHtml}
    <table class="doc-table">
      <thead>
        <tr>
          <th style="width:26px">#</th>
          <th>Company</th>
          <th>Div</th>
          <th>Serial No</th>
          <th>Doc Type</th>
          <th>Doc No</th>
          <th>Ref No</th>
          <th>Issue Place</th>
          <th>Issue Date</th>
          <th>Exp Date</th>
          <th>Expiry Date</th>
          <th>Start Date</th>
          <th>TR Date</th>
          <th style="width:60px">Status</th>
          <th>Status Date</th>
          <th>Email</th>
          <th>Approved By</th>
          <th>Approved Date</th>
          <th>Doc Remarks</th>
          <th>Expiry Remarks</th>
          <th>Req Remarks</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <div class="doc-total">Total: ${rows.length}</div>
  `;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export const getDocumentReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadDocumentData(req);

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Division", value: [params.divCode] },
      { label: "Doc Type", value: [params.docType] },
      {
        label: "Expiry Between",
        value: [`${fmtDate(params.fromDate)} - ${fmtDate(params.toDate)}`],
      },
    ]);
    const bodyHtml = renderDocumentBody(rows, filtersHtml);
    const footerHtml = reportFooter({
      reportName: "rpt_hr_document",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "HR Document Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: DOCUMENT_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
      orientation: "landscape", // ← 21 columns, better landscape
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Document Report HTML error:", error);

    const oraNum = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};