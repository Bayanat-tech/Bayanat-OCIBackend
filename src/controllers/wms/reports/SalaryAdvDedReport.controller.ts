import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// dd-Mon-yyyy (e.g. 06-Oct-2026), built manually so the month text never depends on locale data
function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
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

// ─── Memo-style CSS (extraCss for buildReportDocument) ───────────────────────

const SALARY_ADV_DED_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  @page { size: A4 portrait; }

  .memo-title {
    text-align: center;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 4px;
    padding: 5px 0;
    margin: 0 0 8px;
    border-bottom: 1px solid #cbd5e1;
  }

  .memo-meta { text-align: right; font-size: 10.5px; line-height: 1.6; }
  .memo-meta .k { font-weight: 400; margin-right: 6px; }

  .memo-party { margin: 14px 0 0 24px; font-size: 11px; }
  .memo-party .k { font-size: 11px; margin-bottom: 6px; }
  .memo-party .pname { font-weight: 700; margin-left: 16px; }
  .memo-party .ppos { margin-left: 16px; }

  .memo-subject { margin: 18px 0 2px 24px; font-size: 11px; }
  .memo-subject .k { display: inline-block; width: 52px; }
  .memo-subject b { font-weight: 700; }

  .memo-body {
    margin: 2px 0 14px 76px;
    font-size: 10.5px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  table.lines-table { width: 100%; border-collapse: collapse; margin: 6px 0 0; }
  table.lines-table th {
    padding: 5px 8px;
    background: #00378c;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    text-align: left;
  }
  table.lines-table td { padding: 4px 6px; font-size: 9.5px; vertical-align: top; }
  table.lines-table .num { text-align: right; }
  table.lines-table tr.total td {
    border-top: 1px solid #1e293b;
    border-bottom: 1px solid #1e293b;
    font-weight: 700;
    font-size: 9.5px;
  }

  .signatory { margin: 26px 0 0 24px; font-size: 11px; font-weight: 700; line-height: 1.7; }

  table.sign-table { width: 100%; border-collapse: collapse; margin-top: 34px; }
  table.sign-table td {
    width: 25%;
    padding: 0 6px 0 24px;
    vertical-align: top;
    font-size: 10.5px;
    border: 0;
  }
  table.sign-table .sign-title { font-weight: 700; margin-bottom: 26px; }
  table.sign-table .sign-name { font-weight: 700; }
  table.sign-table .sign-desg { font-weight: 700; }
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

function renderSalaryAdvDedBody(rows: ReportRow[]): string {
  const heading = `
    <div class="memo-title">INTERNAL OFFICE MEMO</div>
  `;

  if (!rows.length) {
    return `
      ${heading}
      <p class="center muted">No data found</p>
    `;
  }

  const r = rows[0];

  // one row per detail line (header columns repeat on every row)
  const lineRows = rows.filter((x) => x.line_no != null || x.line_amount != null);
  const total = lineRows.length
    ? lineRows.reduce((sum, x) => sum + num(x.line_amount), 0)
    : num(r.amount);

  const linesHtml = lineRows.length
    ? `<table class="lines-table">
        <thead>
          <tr>
            <th style="width:14%">Employee Code</th>
            <th>Employee Name</th>
            <th style="width:20%">Pay Unit</th>
            <th style="width:12%" class="num">Amount</th>
            <th style="width:14%">Date</th>
          </tr>
        </thead>
        <tbody>
          ${lineRows
            .map(
              (x) => `<tr>
            <td>${escapeHtml(x.line_emp_code)}</td>
            <td>${escapeHtml(x.line_emp_name)}</td>
            <td>${escapeHtml(x.pay_comp_id)}</td>
            <td class="num">${escapeHtml(fmtAmount(num(x.line_amount)))}</td>
            <td>${escapeHtml(fmtDate(x.recover_from_dt))}</td>
          </tr>`,
            )
            .join("")}
          <tr class="total">
            <td></td>
            <td></td>
            <td class="num">Total:</td>
            <td class="num">${escapeHtml(fmtAmount(total))}</td>
            <td></td>
          </tr>
        </tbody>
      </table>`
    : "";

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
    ${heading}

    <div class="memo-meta">
      <div><span class="k">Doc No.</span>: ${escapeHtml(r.doc_no)}</div>
      <div><span class="k">Date</span>${escapeHtml(fmtDate(r.doc_date))}</div>
    </div>

    <div class="memo-party">
      <div class="k">From</div>
      <div class="pname">${escapeHtml(r.name_from)}</div>
      <div class="ppos">${escapeHtml(r.addr_from)}</div>
    </div>

    <div class="memo-party">
      <div class="k">To</div>
      <div class="pname">${escapeHtml(r.name_to)}</div>
      <div class="ppos">${escapeHtml(r.addr_to)}</div>
    </div>

    <div class="memo-subject"><span class="k">Subject</span> <b>${escapeHtml(r.lettr_subject)}</b></div>
    <div class="memo-body">${remarks}</div>

    ${linesHtml}

    ${
      r.signatory_name || r.signatory_position
        ? `<div class="signatory">
             <div>${escapeHtml(r.signatory_name)}</div>
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

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const bodyHtml   = renderSalaryAdvDedBody(rows);
    const footerHtml = reportFooter({
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