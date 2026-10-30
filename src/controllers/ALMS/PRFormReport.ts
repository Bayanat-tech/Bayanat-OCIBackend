import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "./report_common_pr";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;
type Orientation = "portrait" | "landscape";
interface ReqParams {
  loginid: string;
  company_code: string;
  request_number: string;
  orientation: Orientation;
}
// Dispatch keys handled by PROC_BUILD_DYNAMIC_SQL_ALMS_REPORTS (one CASE branch each)
const PARAM_FORM = "PR_REGISTER_FORM";
const PARAM_PO = "PR_REGISTER_PO_NO";          // POs generated for this PR (TR_AC_LPO_HEADER.REF_NO)
const PARAM_HISTORY = "PR_REGISTER_HISTORY";   // approval history (TTE_PREQUEST_HDR_HISTORY)

const REPORT_TITLE = "PURCHASE REQUEST";
const REPORT_NAME = "rpt_purchase_request_form";

// Set env PR_FORM_DEBUG=1 to print the generated SQL in the server console
const DEBUG = process.env.PR_FORM_DEBUG === "1";

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

/** dd/mm/yyyy hh:mm:ss:mmm  (same as the reference form) */
function dateTimeMsText(value: unknown): string {
  const base = dateTimeText(value);
  if (!base) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return base;
  return `${base}:${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function escapeHtml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function fmt(value: unknown, decimals: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return (0).toFixed(decimals);
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const amtFmt = (v: unknown) => fmt(v, 3);
const rateFmt = (v: unknown) => fmt(v, 4);
const pctFmt = (v: unknown) => fmt(v, 2);

function qtyFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

/** First value when a query param can be string | string[] */
function firstQuery(v: unknown): string {
  return Array.isArray(v) ? text(v[0]) : text(v);
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  const q: any = req.query || {};
  const raw = text(b.orientation || b.page_orientation || q.orientation || q.page_orientation).toLowerCase();
  return {
    loginid: text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    request_number: text(b.request_number).trim(),
    orientation: raw === "portrait" ? "portrait" : "landscape",
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

  if (DEBUG) console.log(`=== GENERATED SQL (${dispatchParam}) ===\n`, rawSql, "\n=== END ===");

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
  pos: ReportRow[];
}

async function loadFormData(req: RequestWithUser, p: ReqParams): Promise<FormData> {
  const conn = await getConn(req);
  try {
    const items = await runProcSql(conn, PARAM_FORM, p);

    const f = items[0];
    const header: ReportRow | null = f
      ? {
        request_number: f.request_number,
        request_date: f.request_date,
        create_user: f.create_user,
        flow_code: f.flow_code,
        description: f.description,
        remarks: f.remarks,
        amount: f.hdr_amount,
        req_div_code: f.req_div_code,
        currency_rate: f.currency_rate,
        currency_code: f.curr_code,
        tx_cat_code: f.tx_cat_code,
        tx_compntcat_code_1: f.tx_compntcat_code_1,
        final_approved: f.hdr_final_approved ?? f.final_approved,
        last_action: f.hdr_last_action ?? f.last_action,
      }
      : null;

    // POs generated for this PR (optional: the form still prints if this fails)
    let pos: ReportRow[] = [];
    try {
      pos = await runProcSql(conn, PARAM_PO, p);
    } catch (e: any) {
      console.warn("[PR FORM] PO list not loaded:", e?.message);
    }

    // Approval history (optional: the form still prints if this fails)
    let history: ReportRow[] = [];
    try {
      history = await runProcSql(conn, PARAM_HISTORY, p);
    } catch (e: any) {
      console.error("[PR FORM] History not loaded:", e?.message);
    }

    return { header, items, history, pos };
  } finally {
    await closeConn(conn);
  }
}

// ─── Header pairs (shared by HTML and Excel) ────────────────────────────────

function formHeaderPairs(data: FormData, requestNumber: string): { left: [string, string][]; right: [string, string][] } {
  const { header, items } = data;
  const first = items[0] ?? {};
  const h: ReportRow = header ?? {};
  const reqNo = text(h.request_number) || text(first.request_number) || requestNumber;
  const reqDate = h.request_date ?? first.request_date;

  const poNos = Array.from(new Set((data.pos ?? []).map((p) => text(p.doc_no).trim()).filter(Boolean)));
  const poText = poNos.length ? poNos.join(", ") : "-";

  // const left: [string, string][] = [
  //   ["Purchase Request Number", reqNo],
  //   ["Created By", text(h.create_user ?? first.user_id)],
  //   ["Flow", text(h.flow_code)],
  //   ["Description", text(h.description)],
  //   ["Remarks", text(h.remarks)],
  //   ["Amount", amtFmt(h.amount ?? items.reduce((s, r) => s + num(r.amount), 0))],
  //   ["Division", text(h.req_div_code)],
  // ];
  // const right: [string, string][] = [
  //   ["Currency Rate", rateFmt(h.currency_rate ?? first.currency_rate)],
  //   ["Currency", text(h.currency_code ?? first.curr_code)],
  //   ["Tax Category", text(h.tx_cat_code ?? first.tx_cat_code)],
  //   ["Tax Type", text(h.tx_compntcat_code_1 ?? first.tx_compntcat_code_1)],
  //   ["Final Approval", text(h.final_approved ?? first.final_approved).toUpperCase() === "Y" ? "YES" : "NO"],
  //   ["Request Date", dateText(reqDate)],
  //   ["Last Action", text(h.last_action ?? first.last_action ?? first.purch_status)],
  //   ["PO Generated", poText],
  // ];



  const reqNoDate = `${reqNo} - ${dateText(reqDate)}`;

  const left: [string, string][] = [
    ["Purchase Request No-Date", reqNoDate],
    ["Created By", text(h.create_user ?? first.user_id)],
    ["Flow", `${text(h.flow_code)} - ${text(h.flow_name)}`],
    ["Description", text(h.description)],
    ["Remarks", text(h.remarks)],
    ["Amount", amtFmt(h.amount ?? items.reduce((s, r) => s + num(r.amount), 0))],
    ["Division", text(h.req_div_code)],
  ];

  const right: [string, string][] = [
    ["Currency Rate", rateFmt(h.currency_rate ?? first.currency_rate)],
    ["Currency", text(h.currency_code ?? first.curr_code)],
    ["Tax Category", text(h.tx_cat_code ?? first.tx_cat_code)],
    ["Tax Type", text(h.tx_compntcat_code_1 ?? first.tx_compntcat_code_1)],
    ["Final Approval", text(h.final_approved ?? first.final_approved).toUpperCase() === "Y" ? "YES" : "NO"],
    ["Last Action", text(h.last_action ?? first.last_action ?? first.purch_status)],
    ["PO Generated", poText],
  ];
  return { left, right };
}

function remarkLines(raw: unknown): string[] {
  const txt = text(raw).replace(/\s+/g, " ").trim();
  if (!txt) return [];

  const marker = /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}>>/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = marker.exec(txt)) !== null) {
    // the user name = the ALL-CAPS words directly before the date
    const words = txt.slice(0, m.index).trimEnd().split(" ");
    let k = words.length;
    while (k > 0 && /^[A-Z][A-Z.'\-]*$/.test(words[k - 1])) k--;
    if (k === words.length) continue;
    starts.push(k === 0 ? 0 : words.slice(0, k).join(" ").length + 1);
  }

  const cuts = Array.from(new Set(starts)).sort((a, b) => a - b);
  if (!cuts.length) return [txt];

  const lines: string[] = [];
  if (cuts[0] > 0) lines.push(txt.slice(0, cuts[0]).trim());   // text before the first name, if any
  cuts.forEach((c, i) => lines.push(txt.slice(c, i + 1 < cuts.length ? cuts[i + 1] : undefined).trim()));
  return lines.filter(Boolean);
}

function renderFormBody(data: FormData, requestNumber: string, orientation: Orientation = "portrait"): string {
  const { items, history } = data;
  const { left, right } = formHeaderPairs(data, requestNumber);

  // ── Header: 2 columns, grey label + bold value ──
  // ── Header: title + 2 separate boxes (label : value) ──
  const kvTable = (title: string, pairs: [string, string][]) => {
    const rows = pairs
      .map(([k, v]) => {
        const safe = escapeHtml(v || "-");
        const val = k === "Remarks"
          ? remarkLines(v).map((line) => escapeHtml(line)).join("<br/>") || "-"
          : "<b>" + safe + "</b>";

        const labelStyle = k === "Purchase Request No-Date"
          ? ' style="white-space:nowrap;"'
          : "";

        return "<tr><td" + labelStyle + ">" +
          escapeHtml(k) +
          "</td><td>:</td><td>" +
          val +
          "</td></tr>";
      })
      .join("");
    return (
      '<table class="pr-kv-box">' +
      '<thead><tr><th colspan="3">' + escapeHtml(title) + "</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table>"
    );
  };

  const headerBlockHtml =
    '<table class="pr-title-line"><tbody><tr><td>' +
    '<h1 class="report-title">Purchase Request : ' +
    escapeHtml(requestNumber) +
    "</h1>" +
    "</td></tr></tbody></table>" +
    '<table class="grn-two-col"><tbody><tr>' +
    "<td>" + kvTable("Request Details", left) + "</td>" +
    "<td>" + kvTable("Other Details", right) + "</td>" +
    "</tr></tbody></table>";

  // ── Per-line numbers (shared by both layouts) ──
  const calc = items.map((r) => {
    const amount = num(r.amount);                 // Total Amt (E.T)
    const base = num(r.lcurr_amt);                // Base Amount
    const tax = num(r.tx_compnt_amt_1);           // Tax Amt
    const lineTotal = amount + tax;               // Total Amt (I.T)
    const lcurrAfterTax = lineTotal * (num(r.currency_rate) || 1);
    const effQty = num(r.allocated_approved_quantity) > 0 ? num(r.allocated_approved_quantity) : num(r.item_qty);
    const discAmt = (num(r.item_rate) * effQty * num(r.discount_amount)) / 100;
    return { r, amount, base, tax, lineTotal, lcurrAfterTax, discAmt };
  });

  const sum = (k: "amount" | "base" | "tax" | "lineTotal" | "lcurrAfterTax" | "discAmt") =>
    calc.reduce((t, c) => t + c[k], 0);
  const totAmount = sum("amount");
  const totBase = sum("base");
  const totTax = sum("tax");
  const totLine = sum("lineTotal");
  const totLcurr = sum("lcurrAfterTax");
  const totDisc = sum("discAmt");

  // ── Items: PORTRAIT = 7 columns (pairs share a cell) so it fits the page ──
  const portraitLines = calc.map(({ r, amount, tax, lineTotal, lcurrAfterTax, discAmt }) => `
    <tr>
            <td>${escapeHtml(r.sr_no)}.&nbsp;${escapeHtml(r.item_code)}<br/><span class="muted">${escapeHtml(r.item_desp)}</span>${r.supplier_part_code ? `<br/><span class="muted">Part: ${escapeHtml(r.supplier_part_code)}</span>` : ""}
    ${(r.supplier_name || r.supplier) ? `<br/><span class="muted">Supplier: ${escapeHtml(r.supplier_name || r.supplier)}</span>` : ""
    }</td>
      <td class="num">${qtyFmt(r.item_qty)}<br/><span class="muted">Appr: ${qtyFmt(r.allocated_approved_quantity)}</span></td>
      <td class="num">${amtFmt(r.item_rate)}<br/><span class="muted">Disc: ${amtFmt(discAmt)}</span></td>
      <td class="num">${amtFmt(amount)}</td>
      <td class="num">${amtFmt(tax)}<br/><span class="muted">${escapeHtml(r.tx_compntcat_code_1)} @ ${pctFmt(r.tx_compnt_perc_1)}%</span></td>
      <td class="num">${amtFmt(lineTotal)}</td>
      <td class="num">${amtFmt(lcurrAfterTax)}<br/><span class="muted">${escapeHtml(r.curr_code)} @ ${rateFmt(r.currency_rate)}</span></td>
    </tr>`).join("");

  const portraitTable = `
    <table class="data-table pr-items-portrait" width="100%">
    <thead>
      <tr>
        <th width="23%">Sr. / Item / Description</th>
        <th width="9%"  class="right">Req Qty</th>
        <th width="13%" class="right">Item Rate / Disc</th>
        <th width="13%" class="right">Total Amt (E.T)</th>
        <th width="15%" class="right">Tax Amt / Type</th>
        <th width="13%" class="right">Total Amt (I.T)</th>
        <th width="14%" class="right">LCURR After Tax</th>
      </tr>
    </thead>
    <tbody>
      ${portraitLines}
      <tr class="grand-total-row">
        <td colspan="3">Total Amount</td>
        <td class="num">${amtFmt(totAmount)}</td>
        <td class="num">${amtFmt(totTax)}</td>
        <td class="num">${amtFmt(totLine)}</td>
        <td class="num">${amtFmt(totLcurr)}</td>
      </tr>
      <tr class="subtotal-row">
        <td colspan="6" class="right">Total Discount</td>
        <td class="num">${amtFmt(totDisc)}</td>
      </tr>
    </tbody>
  </table>`;

  // ── Items: LANDSCAPE = all 15 columns of the reference form, each in its own column ──
  const landscapeLines = calc.map(({ r, amount, base, tax, lineTotal, discAmt }) => `
    <tr>
      <td class="center">${escapeHtml(r.sr_no)}</td>
      <td>${escapeHtml(r.item_code)}<br/><span class="muted">${escapeHtml(r.item_desp)}</span></td>
      <td>${escapeHtml(r.supplier_part_code)}</td>
      <td class="num">${qtyFmt(r.item_qty)}</td>
      <td class="num">${amtFmt(r.item_rate)}</td>
      <td class="num">${amtFmt(discAmt)}</td>
      <td class="num">${amtFmt(r.final_rate)}</td>
      <td class="center">${escapeHtml(r.curr_code)}</td>
      <td class="num">${rateFmt(r.currency_rate)}</td>
      <td class="num">${amtFmt(amount)}<br/><span class="muted">${escapeHtml(r.supplier_name || r.supplier)}</span></td>
      <td class="num">${amtFmt(base)}</td>
      <td class="num">${escapeHtml(r.tx_compntcat_code_1)}<br/><span class="muted">${escapeHtml(r.tx_cat_code)}</span></td>
      <td class="num">${pctFmt(r.tx_compnt_perc_1)}</td>
      <td class="num">${amtFmt(tax)}</td>
      <td class="num">${amtFmt(lineTotal)}<br/><span class="muted">Appr Qty: ${qtyFmt(r.allocated_approved_quantity)}</span></td>
    </tr>`).join("");

  const landscapeTable = `
   <table class="data-table pr-items-landscape" width="100%">
    <thead>
      <tr>
        <th width="4%"  class="center">Sr. No.</th>
        <th width="13%">Item Code / Description</th>
        <th width="8%">Supplier Part Code</th>
        <th width="6%"  class="right">Request Qty</th>
        <th width="6%"  class="right">Item Rate</th>
        <th width="6%"  class="right">Discount Amt</th>
        <th width="6%"  class="right">Final Rate</th>
        <th width="5%"  class="center">Currency</th>
        <th width="5%"  class="right">Ex Rate</th>
        <th width="8%"  class="right">Amount / Supplier</th>
        <th width="8%"  class="right">Base Amount</th>
        <th width="7%"  class="right">Tax Code / Cat</th>
        <th width="5%"  class="right">TAX %</th>
        <th width="6%"  class="right">Tax Amt</th>
        <th width="7%"  class="right">Total Amt</th>
      </tr>
    </thead>
    <tbody>
      ${landscapeLines}
      <tr class="grand-total-row">
        <td colspan="9">Total Amount</td>
        <td class="num">${amtFmt(totAmount)}</td>
        <td class="num">${amtFmt(totBase)}</td>
        <td colspan="2"></td>
        <td class="num">${amtFmt(totTax)}</td>
        <td class="num">${amtFmt(totLine)}</td>
      </tr>
      <tr class="subtotal-row">
        <td colspan="14" class="right">Total Discount</td>
        <td class="num">${amtFmt(totDisc)}</td>
      </tr>
    </tbody>
  </table>`;

  const itemsHtml = items.length === 0
    ? `<div class="empty">No items found for this request.</div>`
    : orientation === "landscape" ? landscapeTable : portraitTable;
  const historyRows = history
    .map(
      (r) =>
        "<tr>" +
        "<td><b>" + escapeHtml(r.action_status) + "</b></td>" +
        "<td>" + escapeHtml(r.last_updated_by) + "</td>" +
        "<td>" + escapeHtml(dateTimeMsText(r.last_updated_dt)) + "</td>" +
        "</tr>"
    )
    .join("");

  const historyHtml = history.length === 0
    ? ""
    : '<table class="data-table prh-table" width="100%">' +
    "<thead><tr>" +
    "<th>Approval Status</th>" +
    "<th>Last Updated By</th>" +
    "<th>Last Updated Date</th>" +
    "</tr></thead>" +
    "<tbody>" + historyRows + "</tbody>" +
    "</table>";

  return `
<div class="pr-form">
  ${headerBlockHtml}

  ${itemsHtml}
  ${historyHtml}
</div>`;
}

// ─── Excel engine (raw OOXML) ───────────────────────────────────────────────

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";
const XL_HEADER_BLUE = "FF1E3A8A";
const XL_GREEN_BG = "FFD1FAE5";

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const xlCell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

const xlBorderThin = (color: string) => ({ style: "thin", color: { rgb: color } });

/** 0 -> A, 25 -> Z, 26 -> AA ... */
function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const XL_STYLE_DEFS: Record<string, any> = {
  title: {
    font: { bold: true, sz: 16, color: { rgb: XL_WHITE } },
    fill: { fgColor: { rgb: XL_BLUE } },
    alignment: { horizontal: "center", vertical: "center" },
  },
  meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
  header: {
    font: { bold: true, sz: 10, color: { rgb: XL_WHITE } },
    fill: { fgColor: { rgb: XL_BLUE } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: { top: xlBorderThin(XL_BLUE), bottom: xlBorderThin(XL_BLUE), left: xlBorderThin(XL_BLUE), right: xlBorderThin(XL_BLUE) },
  },
  groupHeader: {
    font: { bold: true, sz: 11, color: { rgb: XL_WHITE } },
    fill: { fgColor: { rgb: XL_HEADER_BLUE } },
    alignment: { horizontal: "left", vertical: "center" },
  },
  groupTotal: {
    font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
    fill: { fgColor: { rgb: XL_GREEN_BG } },
    alignment: { horizontal: "left", vertical: "center" },
    border: { top: xlBorderThin("FF065F46") },
  },
  groupTotalNum: {
    font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
    fill: { fgColor: { rgb: XL_GREEN_BG } },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.000",
    border: { top: xlBorderThin("FF065F46") },
  },
  data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: xlBorderThin("FFF3F4F6") } },
  dataNum2: {
    font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.00", border: { bottom: xlBorderThin("FFF3F4F6") },
  },
  dataNum3: {
    font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.000", border: { bottom: xlBorderThin("FFF3F4F6") },
  },
  grandTotal: {
    font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
    fill: { fgColor: { rgb: XL_BLUE } },
    alignment: { horizontal: "left", vertical: "center" },
  },
  grandTotalNum: {
    font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
    fill: { fgColor: { rgb: XL_BLUE } },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.000",
  },
  footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },
};

function buildXlsx(opts: {
  rows: XlRow[];
  merges: XlMerge[];
  colCount: number;
  colWidth: number;
  colWidths?: number[];
  sheetName: string;
}): Buffer {
  const { rows: rows_, merges, colCount, colWidth, colWidths, sheetName } = opts;
  const styleDefs = XL_STYLE_DEFS;

  // ── Style registration engine ──
  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

  const fonts: FontDef[] = [{}];
  const fills: FillDef[] = [{}, {}];
  const borders: BorderDef[] = [{}];
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[] = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164;

  const registerFont = (f: any): number => {
    const def: FontDef = { bold: !!f?.bold, italic: !!f?.italic, sz: f?.sz ?? 10, color: f?.color?.rgb };
    const key = `font:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fonts.push(def);
    const idx = fonts.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerFill = (f: any): number => {
    if (!f?.fgColor?.rgb) return 0;
    const def: FillDef = { color: f.fgColor.rgb };
    const key = `fill:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fills.push(def);
    const idx = fills.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerBorder = (b: any): number => {
    if (!b) return 0;
    const def: BorderDef = {
      top: b.top?.color?.rgb, bottom: b.bottom?.color?.rgb, left: b.left?.color?.rgb, right: b.right?.color?.rgb,
    };
    if (!def.top && !def.bottom && !def.left && !def.right) return 0;
    const key = `border:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    borders.push(def);
    const idx = borders.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerNumFmt = (code?: string): number => {
    if (!code) return 0;
    const existing = numFmts.find((n) => n.code === code);
    if (existing) return existing.id;
    const id = nextCustomNumFmtId++;
    numFmts.push({ id, code });
    return id;
  };

  const registerXf = (styleObj: any): number => {
    if (!styleObj) return 0;
    const fontId = registerFont(styleObj.font);
    const fillId = registerFill(styleObj.fill);
    const borderId = registerBorder(styleObj.border);
    const numFmtId = registerNumFmt(styleObj.numFmt);
    const align = styleObj.alignment?.horizontal;
    const wrap = !!styleObj.alignment?.wrapText;
    const key = `xf:${JSON.stringify({ fontId, fillId, borderId, numFmtId, align, wrap })}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    cellXfs.push({ fontId, fillId, borderId, numFmtId, align, wrap });
    const idx = cellXfs.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const styleIndexFor = (styleKey: string): number => registerXf(styleDefs[styleKey]);

  // ── Sheet XML ──
  const colXml = Array.from({ length: colCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${colWidths?.[i] ?? colWidth}" customWidth="1"/>`
  ).join("");

  let sheetDataXml = "";
  rows_.forEach((row, ri) => {
    const rn = ri + 1;
    let rowXml = `<row r="${rn}">`;
    row.forEach((c, ci) => {
      if (c === null) return;
      const ref = colLetter(ci) + rn;
      const s = styleIndexFor(c.styleKey);
      if (typeof c.v === "number") {
        rowXml += `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(c.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergesXml = merges.map((m) =>
    `<mergeCell ref="${colLetter(m.s.c)}${m.s.r + 1}:${colLetter(m.e.c)}${m.e.r + 1}"/>`
  ).join("");
  const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergeFinal}
</worksheet>`;

  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`).join("")}</numFmts>`
    : "";

  // OOXML order inside <font>: b, i, sz, color, name
  const fontsXml = `<fonts count="${fonts.length}">${fonts.map((f) => `
    <font>
      ${f.bold ? "<b/>" : ""}
      ${f.italic ? "<i/>" : ""}
      ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="10"/>'}
      ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
      <name val="Arial"/>
    </font>`).join("")}
</fonts>`;

  const fillsXml = `<fills count="${fills.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills.slice(2).map((f) => `
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="${f.color}"/>
        <bgColor rgb="${f.color}"/>
      </patternFill>
    </fill>`).join("")}
</fills>`;

  const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
  const bordersXml = `<borders count="${borders.length}">${borders.map((b) => `
    <border>
      <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
      <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
      <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
      <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
      <diagonal/>
    </border>`).join("")}
</borders>`;

  const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs.map((xf) => {
    const applyAlign = xf.align || xf.wrap;
    return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
      ${applyAlign ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${xf.wrap ? ` wrapText="1"` : ""} vertical="center"/>` : ""}
    </xf>`;
  }).join("")}
</cellXfs>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${numFmtsXml}
  ${fontsXml}
  ${fillsXml}
  ${bordersXml}
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  ${cellXfsXml}
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  return zip.toBuffer();
}

// Extra styles used by the Purchase Request Form sheet
XL_STYLE_DEFS.kvLabel = {
  font: { bold: true, sz: 10 },
  alignment: { horizontal: "left", vertical: "center" },
};
XL_STYLE_DEFS.kvValue = {
  font: { sz: 10 },
  alignment: { horizontal: "left", vertical: "center", wrapText: true },
  border: { bottom: xlBorderThin("FFE2E8F0") },
};
XL_STYLE_DEFS.kvValueBig = {
  font: { bold: true, sz: 12, color: { rgb: "FF0B3D91" } },
  alignment: { horizontal: "left", vertical: "center" },
  border: { bottom: xlBorderThin("FFE2E8F0") },
};
XL_STYLE_DEFS.dataNum4 = {
  font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
  numFmt: "#,##0.0000", border: { bottom: xlBorderThin("FFF3F4F6") },
};
XL_STYLE_DEFS.dataCenter = {
  font: { sz: 10 }, alignment: { horizontal: "center", vertical: "center" },
  border: { bottom: xlBorderThin("FFF3F4F6") },
};

// ─── Excel: Purchase Request Form ───────────────────────────────────────────

function buildFormExcelBuffer(data: FormData, requestNumber: string, loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const COL_COUNT = 20;
  // Sr, Code, Description, Supp Part, Supplier, Req Qty, Rate, Disc %, Disc Amt, Final Rate,
  // Currency, Ex Rate, Amount, Base Amt, Tax Cat, Tax Code, Tax %, Tax Amt, Appr Qty, Total Amt
  const colWidths = [7, 18, 34, 18, 28, 12, 12, 9, 12, 12, 10, 10, 14, 14, 10, 12, 8, 12, 12, 14];
  const blanks = (n: number): null[] => new Array(n).fill(null);
  const emptyRow = (): XlRow => blanks(COL_COUNT);
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];
  const mergeRow = (r: number, c1: number, c2: number) => merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  // Title
  let r0 = rows_.length;
  const titleRow = emptyRow(); titleRow[0] = xlCell(REPORT_TITLE, "title");
  rows_.push(titleRow); mergeRow(r0, 0, COL_COUNT - 1);

  // Meta
  r0 = rows_.length;
  const metaRow = emptyRow();
  metaRow[0] = xlCell(`Date: ${printDateTime}`, "meta");
  metaRow[3] = xlCell(`User: ${loginId}`, "meta");
  metaRow[8] = xlCell(`Report: ${REPORT_NAME}`, "meta");
  rows_.push(metaRow);
  mergeRow(r0, 0, 2); mergeRow(r0, 3, 7); mergeRow(r0, 8, 15);

  rows_.push(emptyRow());

  // Header block: left pairs (label A:B, value C:G), right pairs (label I:K, value L:O)
  const { left, right } = formHeaderPairs(data, requestNumber);
  const blockRows = Math.max(left.length, right.length);
  for (let i = 0; i < blockRows; i++) {
    const rr = rows_.length;
    const row = emptyRow();
    if (left[i]) {
      row[0] = xlCell(`${left[i][0]} :`, "kvLabel");
      row[2] = xlCell(left[i][1], i === 0 ? "kvValueBig" : "kvValue");
      mergeRow(rr, 0, 1); mergeRow(rr, 2, 6);
    }
    if (right[i]) {
      row[8] = xlCell(`${right[i][0]} :`, "kvLabel");
      row[11] = xlCell(right[i][1], "kvValue");
      mergeRow(rr, 8, 10); mergeRow(rr, 11, 14);
    }
    rows_.push(row);
  }

  rows_.push(emptyRow());

  // Items header
  const heads = [
    "Sr. No.", "Item Code", "Item Description", "Supplier Part Code", "Supplier",
    "Request Qty", "Item Rate", "Disc %", "Discount Amt", "Final Rate",
    "Currency", "Ex Rate", "Amount", "Base Amount", "Tax Category",
    "Tax Code", "TAX %", "Tax Amt", "Approved Qty", "Total Amt",
  ];
  rows_.push(heads.map((t) => xlCell(t, "header")));

  // Item lines
  let totAmount = 0, totBase = 0, totTax = 0, totLine = 0;
  data.items.forEach((r) => {
    const amount = num(r.amount);
    const base = num(r.lcurr_amt);
    const tax = num(r.tx_compnt_amt_1);
    const lineTotal = amount + tax;
    const effQty = num(r.allocated_approved_quantity) > 0 ? num(r.allocated_approved_quantity) : num(r.item_qty);
    const discAmt = (num(r.item_rate) * effQty * num(r.discount_amount)) / 100;
    totAmount += amount; totBase += base; totTax += tax; totLine += lineTotal;

    rows_.push([
      xlCell(text(r.sr_no), "dataCenter"),
      xlCell(text(r.item_code), "data"),
      xlCell(text(r.item_desp), "data"),
      xlCell(text(r.supplier_part_code), "data"),
      xlCell(text(r.supplier_name || r.supplier), "data"),
      xlCell(num(r.item_qty), "dataNum3"),
      xlCell(num(r.item_rate), "dataNum3"),
      xlCell(num(r.discount_amount), "dataNum2"),
      xlCell(discAmt, "dataNum3"),
      xlCell(num(r.final_rate), "dataNum3"),
      xlCell(text(r.curr_code), "dataCenter"),
      xlCell(num(r.currency_rate), "dataNum4"),
      xlCell(amount, "dataNum3"),
      xlCell(base, "dataNum3"),
      xlCell(text(r.tx_cat_code), "data"),
      xlCell(text(r.tx_compntcat_code_1), "data"),
      xlCell(num(r.tx_compnt_perc_1), "dataNum2"),
      xlCell(tax, "dataNum3"),
      xlCell(num(r.allocated_approved_quantity), "dataNum3"),
      xlCell(lineTotal, "dataNum3"),
    ]);
  });

  // Total row
  const tr = rows_.length;
  const totalRow: XlRow = emptyRow();
  for (let c = 0; c < COL_COUNT; c++) totalRow[c] = xlCell("", "grandTotal");
  totalRow[0] = xlCell("Total Amount", "grandTotal");
  totalRow[12] = xlCell(totAmount, "grandTotalNum");
  totalRow[13] = xlCell(totBase, "grandTotalNum");
  totalRow[17] = xlCell(totTax, "grandTotalNum");
  totalRow[19] = xlCell(totLine, "grandTotalNum");
  rows_.push(totalRow);
  mergeRow(tr, 0, 11);

  // Footer
  const foot = emptyRow(); foot[COL_COUNT - 1] = xlCell("Powered by Bayanat Technology", "footer");
  rows_.push(foot);

  return buildXlsx({ rows: rows_, merges, colCount: COL_COUNT, colWidth: 14, colWidths, sheetName: "Purchase Request" });
}

// ─── Route handlers ─────────────────────────────────────────────────────────

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
      firstQuery(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: REPORT_NAME,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderFormBody(data, params.request_number, params.orientation);

    const html = buildReportDocument({
      title: `${REPORT_TITLE} - ${params.request_number}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      autoPrint: false,
      showPrintButton: true,
      orientation: params.orientation,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("PR Form HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPrRegisterFormReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
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

    const buffer = buildFormExcelBuffer(data, params.request_number, params.loginid);
    const safeName = params.request_number.replace(/[^A-Za-z0-9_-]/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Purchase_Request_${safeName}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("PR Form Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};