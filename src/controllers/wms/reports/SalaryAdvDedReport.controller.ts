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

// ─── Types ────────────────────────────────────────────────────────────────────

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
    try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
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

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── Request Param Parser ────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  return {
    companyCode:
      req.user?.company_code ||
      text(req.body.company_code) ||
      text(req.query.company_code) ||
      "",
    docType: text(req.body.doc_type),
    docNo: Number(req.body.doc_no),
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader (via stored procedure) ──────────────────────────────────────

const REPORT_PARAMETER = "Hr_Report_SALARY_ADV_DED_REPORT";

async function loadSalaryAdvDedData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);

  if (!params.companyCode || !Number.isFinite(params.docNo) || params.docNo <= 0) {
    throw Object.assign(
      new Error("company_code and doc_no are required"),
      { status: 400 },
    );
  }

  const conn = await getConn(req);

  try {
    // Step 1: procedure builds the SELECT text
    const binds: Record<string, any> = {
      p_parameter: REPORT_PARAMETER,
      p_loginid: params.loginId,
      p_number1: params.docNo,
      p_number2: null,
      p_number3: null,
      p_number4: null,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };
    for (let i = 1; i <= 20; i++) {
      binds[`p_code${i}`] = i === 1 ? params.companyCode : null;
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

    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Report procedure returned no query"), { status: 500 });
    }

    // Step 2: run the SELECT the procedure returned
    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Salary Addition/Deduction-only CSS (extraCss for buildReportDocument) ───

const SALARY_ADV_DED_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  table.info-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.info-table td { padding: 5px 8px; border: 1px solid #cbd5e1; font-size: 11px; vertical-align: top; }
  table.info-table td.lbl { width: 18%; background: #eff6ff; font-weight: 700; color: #00378c; }

  .subject-row {
    margin: 10px 0;
    padding: 6px 8px;
    background: #f1f5f9;
    border-left: 4px solid #00378c;
    font-weight: 700;
    font-size: 12px;
  }

  .remarks-box { margin: 8px 0; font-size: 11px; line-height: 1.5; white-space: pre-wrap; }

  .amount-row {
    margin: 12px 0;
    padding: 8px;
    background: #00378c;
    color: #fff;
    font-weight: 800;
    font-size: 13px;
    text-align: right;
  }

  table.sign-table { width: 100%; border-collapse: collapse; margin-top: 36px; }
  table.sign-table td {
    width: 25%;
    padding: 6px 8px;
    border: 1px solid #cbd5e1;
    vertical-align: top;
    font-size: 11px;
  }
  table.sign-table .sign-title { font-weight: 800; color: #00378c; margin-bottom: 28px; }
  table.sign-table .sign-name { font-weight: 700; }
  table.sign-table .sign-desg { color: #64748b; font-size: 10px; }

  .signatory { margin-top: 30px; font-size: 11px; }
  .signatory .name { font-weight: 800; }
`;

// ─── HTML Body Renderer (body only — no <html>/<head>) ────────────────────────

function renderSignBlock(title: string, name: string, desg: string): string {
  if (!title && !name && !desg) return "";
  return `
    <td>
      <div class="sign-title">${escapeHtml(title)}</div>
      <div class="sign-name">${escapeHtml(name)}</div>
      <div class="sign-desg">${escapeHtml(desg)}</div>
    </td>`;
}

function renderSalaryAdvDedBody(rows: ReportRow[], filtersHtml = ""): string {
  if (!rows.length) {
    return `
      <div class="doc-title-row"><div><h1>Salary Addition/Deduction</h1></div></div>
      ${filtersHtml}
      <p class="center muted">No data found</p>
    `;
  }

  const r = rows[0];
  const currency = text(r.curr_code);

  const signBlocks = [
    renderSignBlock(text(r.ftr1_name), text(r.proposed_by), text(r.proposed_desg)),
    renderSignBlock(text(r.ftr2_name), text(r.review_by), text(r.review_desg)),
    renderSignBlock(text(r.ftr3_name), text(r.review_by2), text(r.review_desg2)),
    renderSignBlock(text(r.ftr4_name), text(r.apprv_by), text(r.apprv_desg)),
  ].join("");

  const remarks = [text(r.remarks_1), text(r.remarks_2), text(r.remarks_3)]
    .filter(Boolean)
    .map((v) => escapeHtml(v))
    .join("\n");

  return `
    <div class="doc-title-row">
      <div><h1>Salary Addition/Deduction</h1></div>
    </div>

    ${filtersHtml}

    <table class="info-table">
      <tr>
        <td class="lbl">Doc No</td><td>${escapeHtml(r.doc_no)}</td>
        <td class="lbl">Doc Date</td><td>${escapeHtml(fmtDate(r.doc_date))}</td>
      </tr>
      <tr>
        <td class="lbl">Doc Type</td><td>${escapeHtml(r.doc_type)}</td>
        <td class="lbl">Ref No</td><td>${escapeHtml(r.ref_no)}</td>
      </tr>
      <tr>
        <td class="lbl">From</td><td>${escapeHtml(r.name_from)}<br/>${escapeHtml(r.addr_from)}</td>
        <td class="lbl">To</td><td>${escapeHtml(r.name_to)}<br/>${escapeHtml(r.addr_to)}</td>
      </tr>
      <tr>
        <td class="lbl">Employee</td><td>${escapeHtml(r.emplyee_code)} ${r.emp_name ? "| " + escapeHtml(r.emp_name) : ""}</td>
        <td class="lbl">Currency / Rate</td><td>${escapeHtml(currency)} ${r.ex_rate != null ? "/ " + escapeHtml(r.ex_rate) : ""}</td>
      </tr>
    </table>

    <div class="subject-row">Subject : ${escapeHtml(r.lettr_subject)}</div>

    <div class="remarks-box">${remarks}</div>

    <div class="amount-row">Total Amount : ${escapeHtml(currency)} ${fmtAmount(num(r.amount))}</div>

    ${
      r.signatory_name || r.signatory_position
        ? `<div class="signatory">
             <div class="name">${escapeHtml(r.signatory_name)}</div>
             <div>${escapeHtml(r.signatory_position)}</div>
           </div>`
        : ""
    }

    ${
      signBlocks
        ? `<table class="sign-table"><tr>${signBlocks}</tr></table>`
        : ""
    }
  `;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getSalaryAdvDedReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows   = await loadSalaryAdvDedData(req);

    const headerHtml  = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Doc No", value: [String(params.docNo)] },
    ]);
    const bodyHtml    = renderSalaryAdvDedBody(rows, filtersHtml);
    const footerHtml  = reportFooter({
      reportName: "rpt_salary_adv_ded",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "Salary Addition/Deduction",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SALARY_ADV_DED_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Salary Addition/Deduction Report HTML error:", error);

    const oraNum  = error?.errorNum;
    const oraCode = oraNum ? `ORA-${String(oraNum).padStart(5, "0")}` : undefined;

    res.status(error.status || 500).json({
      success: false,
      code: oraCode,
      message: error.message || "Unable to generate report",
    });
  }
};