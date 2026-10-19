import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:        string;
  company_code:   string;
  request_number: string;
}

// Dispatch keys handled by PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS
const PARAM_FORM_DETAILS = "PR_REGISTER_FORM";
const PARAM_FORM_HEADER  = "PR_REGISTER_FORM_HDR";
const PARAM_FORM_HISTORY = "PR_REGISTER_FORM_HIST";

const REPORT_TITLE = "PURCHASE REQUEST";
const REPORT_NAME  = "rpt_purchase_request_form";

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId) throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function dateText(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dateTimeText(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d
    .toLocaleString("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })
    .replace(", ", " ");
}

function escapeHtml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function fmt(value: unknown, decimals: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return (0).toFixed(decimals);
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const amtFmt  = (v: unknown) => fmt(v, 3);
const rateFmt = (v: unknown) => fmt(v, 4);
const pctFmt  = (v: unknown) => fmt(v, 2);

function qtyFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:        text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code:   text(b.company_code),
    request_number: text(b.request_number).trim(),
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

/** Builds the SQL through the procedure, runs it and returns normalized rows. */
async function runProcSql(conn: oracledb.Connection, dispatchParam: string, p: ReqParams): Promise<ReportRow[]> {
  const binds: any = {
    parameter: dispatchParam,
    loginid: p.loginid,
    code1: p.company_code || null,
    code2: null,
    code3: p.request_number || null, // request number
    code4: null,
    number1: null,
    number2: null,
    number3: null,
    number4: null,
    date1: null,
    date2: null,
    date3: null,
    date4: null,
    out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
  };

  // PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS returns a CLOB
  const result = await conn.execute(
    `DECLARE
       v_sql CLOB;
     BEGIN
       PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS(
         :parameter, :loginid,
         :code1,  :code2,  :code3,  :code4,
         :number1, :number2, :number3, :number4,
         :date1,   :date2,   :date3,   :date4,
         v_sql
       );
       :out_sql := DBMS_LOB.SUBSTR(v_sql, 32767, 1);
     END;`,
    binds
  );

  const rawSql = (result.outBinds as any).out_sql;
  if (!rawSql) throw new Error(`Procedure did not return SQL for ${dispatchParam}.`);

  console.log(`=== GENERATED SQL (${dispatchParam}) ===\n`, rawSql, "\n=== END ===");

  const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
  const rows = normalize(dataResult.rows as any[]);

  // The procedure returns "SELECT 'Error ...' AS ERROR_MESSAGE FROM DUAL" when it fails
  if (rows.length === 1 && Object.keys(rows[0]).length === 1 && "error_message" in rows[0]) {
    throw new Error(text(rows[0].error_message));
  }
  return rows;
}

interface FormData {
  header: ReportRow | null;
  items: ReportRow[];
  history: ReportRow[];
}

async function loadFormData(req: RequestWithUser, p: ReqParams): Promise<FormData> {
  const conn = await getConn(req);
  try {
    const items = await runProcSql(conn, PARAM_FORM_DETAILS, p);
    // Header block (Flow, Description, Remarks, Division) is optional: if PR_REGISTER_FORM_HDR
    // is not in the procedure, the header is built from the item rows (VW_PURCHASE_DETAILS_TXN only).
    let headerRows: ReportRow[] = [];
    try {
      headerRows = await runProcSql(conn, PARAM_FORM_HEADER, p);
    } catch (e: any) {
      console.warn("[PR FORM] header query not loaded, using item rows:", e?.message);
    }

    // Approval history is optional: if the branch/table is not set up yet, the form still prints.
    let history: ReportRow[] = [];
    try {
      history = await runProcSql(conn, PARAM_FORM_HISTORY, p);
    } catch (e: any) {
      console.warn("[PR FORM] approval history not loaded:", e?.message);
    }

    return { header: headerRows[0] ?? null, items, history };
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML renderer (inline styles, same approach as PO Order Register) ────

const PR_FORM_EXTRA_CSS = `
  @page {
    size: A4 landscape;
    margin: 8mm;
  }
`;

const S = {
  wrap:   "font-size:9.5px;line-height:1.3;color:#1e293b;",
  title:  "margin:0 0 8px 0;padding:0;font-size:16px;font-weight:800;color:#0b4ca1;text-align:center;letter-spacing:.5px;",
  lbl:    "padding:3px 6px 3px 0;font-weight:700;font-size:9.5px;vertical-align:top;white-space:nowrap;width:34%;",
  val:    "padding:3px 0;font-size:9.5px;vertical-align:top;word-break:break-word;",
  valBig: "padding:3px 0;font-size:13px;font-weight:800;vertical-align:top;color:#0b3d91;",
  th:     "background:#dce6f4 !important;color:#0b3d91 !important;font-weight:700;font-size:8.5px;padding:4px 3px;text-align:center;border:1px solid #9fb6d6;word-break:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  td:     "padding:4px 3px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:9px;word-break:break-word;overflow-wrap:anywhere;",
  tdR:    "padding:4px 3px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:9px;text-align:right;word-break:break-word;",
  tdC:    "padding:4px 3px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:9px;text-align:center;",
  sub:    "display:block;font-size:8px;color:#64748b;",
  total:  "background:#cfe0f5 !important;color:#0b3d91 !important;font-weight:700;padding:6px 3px;border-top:2px solid #0b4ca1;font-size:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  totalR: "background:#cfe0f5 !important;color:#0b3d91 !important;font-weight:700;padding:6px 3px;border-top:2px solid #0b4ca1;font-size:10px;text-align:right;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  histBox:"margin-top:14px;border:1px solid #334155;padding:10px 16px;",
  badge:  "display:inline-block;min-width:160px;background:#000000 !important;color:#ffffff !important;font-weight:700;font-size:10px;text-align:center;padding:3px 10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
};

function kv(label: string, value: unknown, big = false): string {
  return `
    <tr>
      <td style="${S.lbl}">${escapeHtml(label)} :</td>
      <td style="${big ? S.valBig : S.val}">${escapeHtml(value)}</td>
    </tr>`;
}

function renderFormBody(data: FormData, requestNumber: string): string {
  const { header, items, history } = data;

  // Header falls back to the first item row if the header query returned nothing
  const first = items[0] ?? {};
  const h: ReportRow = header ?? {};
  const reqNo = text(h.request_number) || text(first.request_number) || requestNumber;
  const reqDate = h.request_date ?? first.request_date;

  const leftHtml = [
    kv("Purchase Request Number", reqNo, true),
    kv("Created By", h.create_user ?? first.user_id),
    kv("Flow", h.flow_code),
    kv("Description", h.description),
    kv("Remarks", h.remarks),
    kv("Amount", amtFmt(h.amount ?? items.reduce((s, r) => s + num(r.amount), 0))),
    kv("Division", h.req_div_code),
  ].join("");

  const rightHtml = [
    kv("Currency Rate", rateFmt(h.currency_rate ?? first.currency_rate)),
    kv("Currency", h.currency_code ?? first.curr_code),
    kv("Tax Category", h.tx_cat_code ?? first.tx_cat_code),
    kv("Tax Code", h.tx_cat_code ?? first.tx_cat_code),
    kv("Tax Type", h.tx_compntcat_code_1 ?? first.tx_compntcat_code_1),
    kv("Final Approval", text(h.final_approved ?? first.final_approved).toUpperCase() === "Y" ? "YES" : "NO"),
    kv("Request Date", dateText(reqDate)),
    kv("Last Action", h.last_action ?? first.last_action ?? first.purch_status),
  ].join("");

  // ── Item lines ──
  let totAmount = 0, totBase = 0, totTax = 0, totLine = 0;

  const lines = items
    .map((r) => {
      const amount = num(r.amount);
      const base = num(r.lcurr_amt);
      // In the entry form DISCOUNT_AMOUNT is a PERCENTAGE. Discount amount = rate x qty x % / 100,
      // using the approved qty once it exists (same rule as the form).
      const effQty = num(r.allocated_approved_quantity) > 0 ? num(r.allocated_approved_quantity) : num(r.item_qty);
      const discAmt = (num(r.item_rate) * effQty * num(r.discount_amount)) / 100;
      const tax = num(r.tx_compnt_amt_1);
      const lineTotal = amount + tax;
      totAmount += amount; totBase += base; totTax += tax; totLine += lineTotal;

      return `
      <tr>
        <td style="${S.tdC}">${escapeHtml(r.sr_no)}</td>
        <td style="${S.td}">${escapeHtml(r.item_code)}<span style="${S.sub}">${escapeHtml(r.item_desp)}</span></td>
        <td style="${S.td}">${escapeHtml(r.supplier_part_code)}<span style="${S.sub}">${escapeHtml(r.supplier)}</span></td>
        <td style="${S.tdR}">${qtyFmt(r.item_qty)}</td>
        <td style="${S.tdR}">${amtFmt(r.item_rate)}</td>
        <td style="${S.tdR}">${amtFmt(discAmt)}<span style="${S.sub}">${pctFmt(r.discount_amount)} %</span></td>
        <td style="${S.tdR}">${amtFmt(r.final_rate)}</td>
        <td style="${S.tdC}">${escapeHtml(r.curr_code)}</td>
        <td style="${S.tdR}">${rateFmt(r.currency_rate)}</td>
        <td style="${S.tdR}">${amtFmt(amount)}</td>
        <td style="${S.tdR}">${amtFmt(base)}</td>
        <td style="${S.td}">${escapeHtml(r.tx_compntcat_code_1)}<span style="${S.sub}">${escapeHtml(r.tx_cat_code)}</span></td>
        <td style="${S.tdR}">${pctFmt(r.tx_compnt_perc_1)}</td>
        <td style="${S.tdR}">${amtFmt(tax)}</td>
        <td style="${S.tdR}">${qtyFmt(r.allocated_approved_quantity)}</td>
        <td style="${S.tdR}">${amtFmt(lineTotal)}</td>
      </tr>`;
    })
    .join("");

  const itemsHtml = items.length === 0
    ? `<div style="padding:28px;font-size:11px;text-align:center;color:#64748b;">No items found for this request.</div>`
    : `
    <table style="margin-top:10px;border-collapse:collapse;width:100%;table-layout:fixed;">
      <colgroup>
        <col style="width:4%"/><col style="width:13%"/><col style="width:8%"/><col style="width:6%"/>
        <col style="width:6%"/><col style="width:6%"/><col style="width:6%"/><col style="width:5%"/>
        <col style="width:5%"/><col style="width:7%"/><col style="width:7%"/><col style="width:6%"/>
        <col style="width:4%"/><col style="width:5%"/><col style="width:5%"/><col style="width:7%"/>
      </colgroup>
      <thead>
        <tr>
          <th style="${S.th}">Sr. No.</th>
          <th style="${S.th}">Item Code</th>
          <th style="${S.th}">Supplier Part Code</th>
          <th style="${S.th}">Request Qty</th>
          <th style="${S.th}">Item Rate</th>
          <th style="${S.th}">Discount Amt</th>
          <th style="${S.th}">Final Rate</th>
          <th style="${S.th}">Currency</th>
          <th style="${S.th}">Ex Rate</th>
          <th style="${S.th}">Amount</th>
          <th style="${S.th}">Base Amount</th>
          <th style="${S.th}">Tax Code</th>
          <th style="${S.th}">TAX %</th>
          <th style="${S.th}">Tax Amt</th>
          <th style="${S.th}">Approved Qty</th>
          <th style="${S.th}">Total Amt</th>
        </tr>
      </thead>
      <tbody>
        ${lines}
        <tr>
          <td colspan="9" style="${S.total}">Total Amount</td>
          <td style="${S.totalR}">${amtFmt(totAmount)}</td>
          <td style="${S.totalR}">${amtFmt(totBase)}</td>
          <td colspan="2" style="${S.total}"></td>
          <td style="${S.totalR}">${amtFmt(totTax)}</td>
          <td style="${S.total}"></td>
          <td style="${S.totalR}">${amtFmt(totLine)}</td>
        </tr>
      </tbody>
    </table>`;

  // ── Approval history box ──
  const historyHtml = history.length === 0
    ? ""
    : `
    <div style="${S.histBox}">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px;">Request Number: &nbsp;${escapeHtml(reqNo)}</div>
      ${history
        .map(
          (r) => `
        <div style="margin:8px 0 2px 0;text-align:center;"><span style="${S.badge}">${escapeHtml(r.action_status)}</span></div>
        <table style="border-collapse:collapse;margin-bottom:4px;">
          <tr><td style="padding:2px 14px 2px 0;font-size:10px;">Last Updated :</td><td style="padding:2px 0;font-size:10px;">${escapeHtml(r.last_updated_by)}</td></tr>
          <tr><td style="padding:2px 14px 2px 0;font-size:10px;">Last Updated Dt :</td><td style="padding:2px 0;font-size:10px;">${escapeHtml(dateTimeText(r.last_updated_dt))}</td></tr>
        </table>`
        )
        .join("")}
    </div>`;

  return `
  <div class="pr-form" style="${S.wrap}">
    <h1 style="${S.title}">${escapeHtml(REPORT_TITLE)}</h1>

    <table style="width:100%;border-collapse:collapse;border-top:1px solid #334155;border-bottom:1px solid #334155;table-layout:fixed;">
      <tr>
        <td style="width:55%;vertical-align:top;padding:6px 10px 6px 0;">
          <table style="width:100%;border-collapse:collapse;">${leftHtml}</table>
        </td>
        <td style="width:45%;vertical-align:top;padding:6px 0 6px 10px;">
          <table style="width:100%;border-collapse:collapse;">${rightHtml}</table>
        </td>
      </tr>
    </table>

    ${itemsHtml}
    ${historyHtml}
  </div>`;
}

// ─── Route handler ──────────────────────────────────────────────────────────

export const getPrRegisterFormReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    if (!params.request_number) {
      res.status(400).json({ success: false, message: "Request number is required." });
      return;
    }

    const data = await loadFormData(req, params);
    if (!data.items.length && !data.header) {
      res.status(200).json({ success: false, message: "No data found for the selected request." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: REPORT_NAME,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderFormBody(data, params.request_number);

    const html = buildReportDocument({
      title: `${REPORT_TITLE} - ${params.request_number}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PR_FORM_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("PR Form HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};