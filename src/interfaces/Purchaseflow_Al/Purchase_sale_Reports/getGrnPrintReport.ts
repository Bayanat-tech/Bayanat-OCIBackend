import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../../controllers/common/report_common";

// ─── Shared report shell (header / footer / css / document wrapper) ───────
// NOTE: adjust this relative path to wherever ReportCommon.ts actually lives
// in your project (it's the file that exports reportHeader / reportFooter /
// buildReportDocument / COMMON_REPORT_CSS).

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:      string;
  company_code: string;
  doc_type:     string; // "GRN"
  doc_no:       string;
}

// ─── DB helpers (same as PoOrderRegisterReport.ts) ─────────────────────────

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
  if (!value) return "\u2014";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function qtyFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function amtFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Matches the original DataWindow computed field: doc_type + '-' + doc_no.
function formatDocNo(docType: string, docNo: string): string {
  const dt = text(docType).trim();
  const dn = text(docNo).trim();
  if (!dt) return dn;
  if (dn.toUpperCase().startsWith(dt.toUpperCase())) return dn;
  return `${dt}-${dn}`;
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  const q = (req.query || {}) as Record<string, any>;
  return {
    loginid:      text(req.user?.loginid) || text(b.loginid) || text(q.loginid) || "ADMIN",
    company_code: text(b.company_code) || text(q.company_code),
    doc_type:     text(b.doc_type) || text(q.doc_type) || "GRN",
    doc_no:       text(b.doc_no) || text(q.doc_no),
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

interface GrnData {
  rows: ReportRow[];
  terms: ReportRow[];
  footer: ReportRow;
}

async function loadGrnData(req: RequestWithUser, p: ReqParams): Promise<GrnData> {
  const conn = await getConn(req);
  try {
    const grnResult = await conn.execute(
      `SELECT vw_erp_grn.company_code, vw_erp_grn.doc_type, vw_erp_grn.doc_no, vw_erp_grn.doc_date,
              vw_erp_grn.div_code, vw_erp_grn.div_name, vw_erp_grn.dept_code, vw_erp_grn.remarks,
              vw_erp_grn.ref_no, vw_erp_grn.ref_date, vw_erp_grn.ac_code, vw_erp_grn.ac_name, vw_erp_grn.curr_code,
              vw_erp_grn.ex_rate, vw_erp_grn.disc_hdr_percent, vw_erp_grn.disc_hdr_price,
              vw_erp_grn.payment_terms, vw_erp_grn.credit_period, vw_erp_grn.due_date,
              vw_erp_grn.party_name, vw_erp_grn.party_address, vw_erp_grn.party_phone, vw_erp_grn.party_fax,
              vw_erp_grn.inv_generated, vw_erp_grn.delivery_to, vw_erp_grn.dlvr_contact,
              vw_erp_grn.dlvr_email, vw_erp_grn.e_mail, vw_erp_grn.mobile_no, vw_erp_grn.dlvr_mobile, vw_erp_grn.dlvr_term,
              vw_erp_grn.ref_doc_type, vw_erp_grn.ref_doc_no, vw_erp_grn.job_no,
              vw_erp_grn.cancelled, vw_erp_grn.cancelled_dt, vw_erp_grn.approved,
              vw_erp_grn.approved_by, vw_erp_grn.approved_dt, vw_erp_grn.serial_no,
              vw_erp_grn.prod_code, vw_erp_grn.prod_name, vw_erp_grn.det_remarks,
              vw_erp_grn.p_uom, vw_erp_grn.qty_puom, vw_erp_grn.l_uom, vw_erp_grn.qty_luom,
              vw_erp_grn.uppp, vw_erp_grn.quantity, vw_erp_grn.amount, vw_erp_grn.required_dt,
              vw_erp_grn.sign_ind, vw_erp_grn.qty_processed, vw_erp_grn.det_cancel,
              vw_erp_grn.det_cancel_date, vw_erp_grn.unit_price, vw_erp_grn.disc_price,
              vw_erp_grn.disc_percent
       FROM vw_erp_grn
       WHERE company_code = :company_code
         AND doc_type = :doc_type
         AND TO_CHAR(doc_no) = TO_CHAR(:doc_no)`,
      { company_code: p.company_code, doc_type: p.doc_type, doc_no: p.doc_no },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const termsResult = await conn.execute(
      `SELECT srno, term, is_payterm
       FROM ms_ac_setup_terms
       WHERE doc_id = :doc_type
       ORDER BY srno`,
      { doc_type: p.doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const footerResult = await conn.execute(
      `SELECT prepared, verified, approved, received
       FROM ms_ac_setup_doc
       WHERE doc_id = :doc_type`,
      { doc_type: p.doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return {
      rows: normalize(grnResult.rows as any[]),
      terms: normalize(termsResult.rows as any[]),
      footer: normalize(footerResult.rows as any[])[0] || {},
    };
  } finally {
    await closeConn(conn);
  }
}

// ─── Report line model ──────────────────────────────────────────────────────

interface GrnHeader {
  doc_no: string;
  doc_date: any;
  doc_type: string;
  div_name: string;
  ac_code: string;
  ac_name: string;
  party_name: string;
  party_address: string;
  party_phone: string;
  party_fax: string;
  ref_no: string;
  ref_date: any;
  delivery_to: string;
  dlvr_contact: string;
  dlvr_mobile: string;
  mobile_no: string;
  dlvr_email: string;
  e_mail: string;
  dlvr_term: string;
  remarks: string;
  cancelled: boolean;
}

function buildHeader(rows: ReportRow[]): GrnHeader {
  const h = rows[0] || {};
  return {
    doc_no: text(h.doc_no),
    doc_date: h.doc_date,
    doc_type: text(h.doc_type),
    div_name: text(h.div_name),
    ac_code: text(h.ac_code),
    ac_name: text(h.ac_name),
    party_name: text(h.party_name) || text(h.ac_name),
    party_address: text(h.party_address),
    party_phone: text(h.party_phone),
    party_fax: text(h.party_fax),
    ref_no: text(h.ref_no),
    ref_date: h.ref_date,
    delivery_to: text(h.delivery_to),
    dlvr_contact: text(h.dlvr_contact),
    dlvr_mobile: text(h.dlvr_mobile),
    mobile_no: text(h.mobile_no),
    dlvr_email: text(h.dlvr_email),
    e_mail: text(h.e_mail),
    dlvr_term: text(h.dlvr_term),
    remarks: text(h.remarks),
    cancelled: text(h.cancelled).toUpperCase() === "Y",
  };
}

function computeTotals(rows: ReportRow[]) {
  const totalPQty = rows.reduce((s, r) => s + num(r.qty_puom), 0);
  const totalLQty = rows.reduce((s, r) => s + num(r.qty_luom), 0);
  const totalQty = rows.reduce((s, r) => s + num(r.quantity), 0);
  return { totalPQty, totalLQty, totalQty };
}

// ─── HTML renderer (built entirely on the shared report shell) ────────────

const REPORT_TITLE = "Goods Receipt Note";

// A key/value line rendered as a <tr> inside a .data-table so it inherits
// the exact same borders/spacing/font as every other report on the shared
// shell — no bespoke "info-table" CSS needed anymore.
function kvRow(label: string, value: string, strongValue = false): string {
  const v = escapeHtml(value) || "&nbsp;";
  return `<tr>
        <td class="muted" style="width:100px;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="width:12px;">:</td>
        <td class="${strongValue ? "strong" : ""}">${v}</td>
      </tr>`;
}

// A couple of small, purely layout-level rules (two-column split, status chip)
// that the shared CSS doesn't define. Everything else (fonts, colors, table
// borders, header, footer, print rules) comes straight from COMMON_REPORT_CSS.
const GRN_EXTRA_CSS = `
  .grn-two-col { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 4px; }
  .grn-two-col > tbody > tr > td { border: 0; padding: 0; vertical-align: top; width: 50%; }
  .grn-two-col > tbody > tr > td:first-child { padding-right: 10px; }
  .grn-two-col > tbody > tr > td:last-child { padding-left: 10px; }
  .grn-status { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 10.5px; font-weight: 700; background: #fee2e2; color: #dc2626; margin-top: 4px; }
  .grn-totals { width: 260px; margin-left: auto; margin-top: 10px; border-collapse: collapse; }
  .grn-totals td { padding: 5px 8px; font-size: 10.5px; border-bottom: 1px solid #e2e8f0; }
  .grn-totals tr.grand td { background: #0b4ca1; color: #fff; font-weight: 800; font-size: 12px; border-bottom: none; }
  .grn-sign { display: flex; justify-content: space-between; text-align: center; font-size: 10px; color: #64748b; margin-top: 26px; }
  .grn-sign div { border-top: 1px solid #94a3b8; padding-top: 6px; width: 20%; }
`;

async function renderHtml(data: GrnData, loginId: string, p: ReqParams, req: RequestWithUser): Promise<string> {
  const { rows, terms, footer } = data;
  const header = buildHeader(rows);
  const totals = computeTotals(rows);

  const contactMobile = [header.dlvr_contact, header.dlvr_mobile || header.mobile_no].filter((v) => v).join(" / ");
  const emailToShow = header.dlvr_email || header.e_mail;

  // ── Shared company header (logo + name + address), same as every other report ──
  const headerHtml = await reportHeader({ company_code: p.company_code, req });

  // ── Party / GRN details, two data-tables side by side ──
  const detailsHtml = `
    <table class="grn-two-col">
      <tbody>
        <tr>
          <td>
            <div class="group-title">To</div>
            <table class="data-table">
              ${kvRow("Name", header.party_name, true)}
              ${kvRow("Address", header.party_address)}
              ${kvRow("Tel", header.party_phone)}
              ${kvRow("Fax", header.party_fax)}
            </table>
          </td>
          <td>
            <div class="group-title">GRN Details</div>
            <table class="data-table">
              ${kvRow("GRN No", formatDocNo(header.doc_type, header.doc_no), true)}
              ${kvRow("Date", dateText(header.doc_date))}
              ${kvRow("A/C Code", header.ac_code)}
              ${kvRow("Ref No", header.ref_no + (header.ref_date ? ` (${dateText(header.ref_date)})` : ""))}
              ${kvRow("Deliver To", header.delivery_to)}
              ${kvRow("Contact", contactMobile)}
              ${kvRow("Email", emailToShow)}
              ${kvRow("Delivery Term", header.dlvr_term)}
            </table>
          </td>
        </tr>
      </tbody>
    </table>
    ${header.cancelled ? `<div class="grn-status">Cancelled</div>` : ""}`;

  // ── Line items, using the shared data-table look exactly like every other report ──
  let itemsHtml: string;
  if (!rows.length) {
    itemsHtml = `<div class="empty">No line items found for this GRN.</div>`;
  } else {
    let bodyRows = "";
    rows.forEach((r, i) => {
      bodyRows += `
        <tr>
          <td class="center">${i + 1}</td>
          <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
          <td class="center">${escapeHtml(r.p_uom)}</td>
          <td class="num">${qtyFmt(r.qty_puom)}</td>
          <td class="center">${escapeHtml(r.l_uom)}</td>
          <td class="num">${qtyFmt(r.qty_luom)}</td>
          <td class="num strong">${qtyFmt(r.quantity)}</td>
        </tr>`;
    });

    itemsHtml = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:36px;">S.No.</th>
            <th>Product / Description</th>
            <th style="width:50px;">PUOM</th>
            <th style="width:80px;">P. Qty</th>
            <th style="width:50px;">LUOM</th>
            <th style="width:80px;">L. Qty</th>
            <th style="width:90px;">Qty in LUOM</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <table class="grn-totals">
        <tbody>
          <tr><td>Total P. Qty</td><td class="num">${qtyFmt(totals.totalPQty)}</td></tr>
          <tr><td>Total L. Qty</td><td class="num">${qtyFmt(totals.totalLQty)}</td></tr>
          <tr class="grand"><td>Total Quantity</td><td class="num">${qtyFmt(totals.totalQty)}</td></tr>
        </tbody>
      </table>`;
  }

  // ── Remarks / terms ──
  const remarksHtml = header.remarks
    ? `<div class="group"><span class="strong">Remarks: </span><span class="muted">${escapeHtml(header.remarks)}</span></div>`
    : "";

  const termsHtml = terms.length
    ? `<div class="group"><div class="group-title">Terms</div>${terms
        .map((t) => `<div class="muted">${escapeHtml(t.term)}</div>`)
        .join("")}</div>`
    : "";

  // ── Signature strip ──
  const signHtml = `
    <div class="grn-sign">
      <div>${escapeHtml(footer.prepared) || "Prepared By"}</div>
      <div>${escapeHtml(footer.verified) || "Verified By"}</div>
      <div>${escapeHtml(footer.approved) || "Approved By"}</div>
      <div>${escapeHtml(footer.received) || "Received By"}</div>
    </div>`;

  const bodyHtml = `
    ${detailsHtml}
    <div class="group">
      <div class="group-title">Items</div>
      ${itemsHtml}
    </div>
    ${remarksHtml}
    ${termsHtml}
    ${signHtml}`;

  // ── Shared footer (print date / user / report name) ──
  const footerHtml = reportFooter({
    reportName: REPORT_TITLE,
    userName: loginId,
    endLabel: "End of GRN",
  });

  // ── Assemble the whole page using the same shell every other report uses ──
  return buildReportDocument({
    title: `${REPORT_TITLE} ${header.doc_no}`,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: GRN_EXTRA_CSS,
    showPrintButton: true,
  });
}

// ─── Excel builder (unchanged — separate output format, no HTML CSS involved) ─

function buildExcelBuffer(data: GrnData, loginId: string): Buffer {
  const { rows, footer } = data;
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";
  const GREEN_BG = "FFD1FAE5";

  const header = buildHeader(rows);
  const totals = computeTotals(rows);

  const COL_COUNT = 7; // S.No, Product/Description, PUOM, P.Qty, LUOM, L.Qty, Quantity

  interface XlCell { v: unknown; styleKey: string }
  type Row = (XlCell | null)[];
  const rows_: Row[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

  rows_.push([cell(`${REPORT_TITLE} - ${header.doc_no}`, "title"), null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([cell(`Print Date: ${printDateTime}`, "meta"), null, null, cell(`Print User: ${loginId}`, "meta"), null, null, null]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
  merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: 6 } });

  rows_.push([
    cell(`To: ${header.party_name}, ${header.party_address}`, "meta"), null, null, null,
    cell(`Date: ${dateText(header.doc_date)}   A/C: ${header.ac_code}`, "meta"), null, null,
  ]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 3 } });
  merges.push({ s: { r: 2, c: 4 }, e: { r: 2, c: 6 } });

  rows_.push([null, null, null, null, null, null, null]);

  rows_.push([
    cell("S.No", "header"), cell("Product / Description", "header"), cell("PUOM", "header"),
    cell("P. Qty", "header"), cell("LUOM", "header"), cell("L. Qty", "header"), cell("Quantity", "header"),
  ]);

  rows.forEach((r, i) => {
    rows_.push([
      cell(i + 1, "data"),
      cell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
      cell(text(r.p_uom), "data"),
      cell(num(r.qty_puom), "dataNum"),
      cell(text(r.l_uom), "data"),
      cell(num(r.qty_luom), "dataNum"),
      cell(num(r.quantity), "dataNum"),
    ]);
  });

  rows_.push([null, null, null, null, null, null, null]);

  const totalRows: [string, number][] = [
    ["Total P. Qty", totals.totalPQty],
    ["Total L. Qty", totals.totalLQty],
  ];
  totalRows.forEach(([label, value]) => {
    const r = rows_.length;
    rows_.push([cell(label, "groupTotal"), null, null, null, null, cell(value, "groupTotalNum"), null]);
    merges.push({ s: { r, c: 0 }, e: { r, c: 4 } });
  });

  const gtRow = rows_.length;
  rows_.push([cell("Total Quantity", "grandTotal"), null, null, null, null, cell(totals.totalQty, "grandTotalNum"), null]);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 4 } });

  // ── Style registration engine ──
  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

  const styleDefs: Record<string, any> = {
    title: {
      font: { bold: true, sz: 16, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: { top: { color: { rgb: BLUE } }, bottom: { color: { rgb: BLUE } }, left: { color: { rgb: BLUE } }, right: { color: { rgb: BLUE } } },
    },
    data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: { color: { rgb: "FFF3F4F6" } } } },
    dataNum: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000", border: { bottom: { color: { rgb: "FFF3F4F6" } } },
    },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    groupTotalNum: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: GREEN_BG } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
    },
    grandTotal: {
      font: { bold: true, sz: 12, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    grandTotalNum: {
      font: { bold: true, sz: 12, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
    },
  };

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

  const colXml = Array.from({ length: COL_COUNT }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="18" customWidth="1"/>`
  ).join("");

  let sheetDataXml = "";
  rows_.forEach((row, ri) => {
    const rn = ri + 1;
    let rowXml = `<row r="${rn}">`;
    row.forEach((c, ci) => {
      if (c === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
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
    `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`
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

  const fontsXml = `<fonts count="${fonts.length}">${fonts.map((f) => `
    <font>
        ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="10"/>'}
        ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
        <name val="Arial"/>
        ${f.bold ? "<b/>" : ""}
        ${f.italic ? "<i/>" : ""}
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
  <sheets><sheet name="GRN" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Route handlers ─────────────────────────────────────────────────────────

export const getGrnPrintReport = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const data = await loadGrnData(req, params);
    if (!data.rows.length) {
      res.status(200).json({ success: false, message: "GRN not found." });
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(await renderHtml(data, params.loginid, params, req));
  } catch (error: any) {
    console.error("GRN Report HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate GRN report" });
  }
};

export const getGrnPrintReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const data = await loadGrnData(req, params);
    if (!data.rows.length) {
      res.status(200).json({ success: false, message: "GRN not found." });
      return;
    }
    const buffer = buildExcelBuffer(data, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="GRN.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("GRN Report Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};