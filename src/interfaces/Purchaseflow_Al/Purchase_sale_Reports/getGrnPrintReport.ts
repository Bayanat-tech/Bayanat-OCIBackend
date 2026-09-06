import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

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
// Guards against double-prefixing in case doc_no already carries the doc_type
// (seen in some test/legacy records, e.g. doc_no = "GRN2261000002").
function formatDocNo(docType: string, docNo: string): string {
  const dt = text(docType).trim();
  const dn = text(docNo).trim();
  if (!dt) return dn;
  if (dn.toUpperCase().startsWith(dt.toUpperCase())) return dn;
  return `${dt}-${dn}`;
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  // Accept params from either the request body (POST) or query string (GET),
  // so the same handlers can be linked to directly from the printed report.
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
// GRN doesn't go through PROC_BUILD_DYNAMIC_SQL like PO — it queries
// vw_erp_grn directly, plus side queries for terms and footer signatures.
// Logo is pulled the same way PO does it: a correlated subquery on
// ms_hr_division.comp_logo joined by div_code, added right into the
// main SELECT — no separate round-trip needed.

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
              vw_erp_grn.disc_percent,
              (SELECT hr.comp_logo
                 FROM ms_hr_division hr
                WHERE hr.div_code = vw_erp_grn.div_code) AS logo_url
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
  logo_url: string | null;
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
    // Some GRNs are recorded against the account without a separate party_name
    // on the header — fall back to the account/vendor name so "To" isn't blank.
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
    // dlvr_email is the "deliver to" contact's email; e_mail is the vendor/account
    // email on the view. Prefer dlvr_email when present, otherwise fall back.
    dlvr_email: text(h.dlvr_email),
    e_mail: text(h.e_mail),
    dlvr_term: text(h.dlvr_term),
    remarks: text(h.remarks),
    cancelled: text(h.cancelled).toUpperCase() === "Y",
    logo_url: h.logo_url ? String(h.logo_url) : null,
  };
}

function computeTotals(rows: ReportRow[]) {
  const totalPQty = rows.reduce((s, r) => s + num(r.qty_puom), 0);
  const totalLQty = rows.reduce((s, r) => s + num(r.qty_luom), 0);
  const totalQty = rows.reduce((s, r) => s + num(r.quantity), 0);
  return { totalPQty, totalLQty, totalQty };
}

// ─── HTML renderer (same visual system as PO Order Report) ────────────────

const REPORT_TITLE = "Goods Receipt Note";
const REPORT_SUBTITLE = "GRN Document";

function renderHtml(data: GrnData, loginId: string, p: ReqParams): string {
  const { rows, terms, footer } = data;
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = buildHeader(rows);
  const totals = computeTotals(rows);

  const contactMobile = [header.dlvr_contact, header.dlvr_mobile || header.mobile_no].filter((v) => v).join(" / ");
  const emailToShow = header.dlvr_email || header.e_mail;

  let bodyRows = "";
  rows.forEach((r) => {
    bodyRows += `
                        <tr>
                            <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
                            <td class="right">${escapeHtml(r.p_uom)}</td>
                            <td class="right">${qtyFmt(r.qty_puom)}</td>
                            <td class="right">${escapeHtml(r.l_uom)}</td>
                            <td class="right">${qtyFmt(r.qty_luom)}</td>
                            <td class="right amount">${qtyFmt(r.quantity)}</td>
                        </tr>`;
  });

  let termsHtml = "";
  terms.forEach((t) => {
    termsHtml += `<div class="term-line">${escapeHtml(t.term)}</div>`;
  });

  return `<!doctype html>
<html>
<head>
    <meta charset="utf-8"/>
    <title>${escapeHtml(REPORT_TITLE)} ${escapeHtml(header.doc_no)}</title>
    <style>
        /* Single layout used for both on-screen preview and PDF/print output —
           deliberately NOT relying on @media print to restructure the page,
           since the PDF renderer does not reliably honour that switch.
           Page margins come from .report-container padding; @page margin is
           zeroed so the two don't stack and double the whitespace. */
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        html, body {
            height: 100%;
        }
        body {
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 12px;
            background: #ffffff;
            color: #111827;
        }
        .report-container {
            width: 100%;
            max-width: 210mm;      /* A4 width, so it reads correctly both on screen and in PDF */
            margin: 0 auto;
            background: #ffffff;
            padding: 15mm 12mm;    /* acts as the page margin */
            min-height: 100vh;     /* fills one page so the footer can anchor to the bottom */
            display: flex;
            flex-direction: column;
        }
        .report-body {
            flex: 0 0 auto;
        }
        .report-footer-block {
            margin-top: auto;      /* pins signatures + footer line to the bottom of the page */
            padding-top: 24px;
        }
        @media print {
            .no-print { display: none !important; }
        }
        .action-toolbar {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-bottom: 16px;
        }
        .action-toolbar button,
        .action-toolbar .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            border: none;
            text-decoration: none;
            transition: background 0.15s ease;
        }
        .btn-pdf { background: #1d4ed8; color: #fff; }
        .btn-pdf:hover { background: #1e40af; }
        .report-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #1d4ed8;
            padding-bottom: 14px;
            margin-bottom: 20px;
        }
        .report-title-area { display: flex; align-items: center; gap: 14px; }
        .logo-img { max-height: 50px; max-width: 120px; object-fit: contain; }
        .report-title { font-size: 18px; font-weight: 700; color: #1e3a8a; letter-spacing: 1px; }
        .report-subtitle { font-size: 12px; color: #6b7280; font-weight: 400; letter-spacing: 0.5px; }
        .report-meta { text-align: right; font-size: 11px; color: #6b7280; line-height: 1.6; }
        .report-meta strong { color: #374151; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; margin-bottom: 18px; }
        .info-block { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; background: #f8fafc; }
        .info-block .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 6px; }
        .info-block .value-line { font-size: 12px; color: #111827; line-height: 1.6; }
        .status-badge { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; display: inline-block; }
        .status-CANCELLED { background: #fee2e2; color: #dc2626; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; table-layout: fixed; }
        .report-table thead th {
            background: #f3f4f6; padding: 8px 10px; text-align: left; font-weight: 600; color: #374151;
            border-bottom: 2px solid #d1d5db; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.03em;
            white-space: nowrap;
        }
        .report-table thead th:first-child { width: auto; }
        .report-table thead th:not(:first-child) { width: 90px; }
        .report-table tbody td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; word-break: break-word; }
        .report-table .right { text-align: right; }
        .report-table .amount { font-weight: 500; color: #065f46; }
        .totals-box { margin-top: 16px; margin-left: auto;margin-bottom: 60px;  width: 320px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
        .totals-box .row { display: flex; justify-content: space-between; padding: 6px 14px; font-size: 12px; border-bottom: 1px solid #f3f4f6; }
        .totals-box .row.grand { background: #1d4ed8; color: #fff; font-weight: 700; font-size: 13px; border-bottom: none; }
        .remarks-box { margin-top: 16px; font-size: 12px; }
        .remarks-box .label { font-weight: 600; margin-right: 4px; color: #374151; }
        .terms-section { margin-top: 10px; font-size: 11px; color: #6b7280; }
        .term-line { margin-bottom: 2px; }
        .footer-sign { display: flex; justify-content: space-between; text-align: center; font-size: 11px; color: #6b7280; }
        .footer-sign div { border-top: 1px solid #d1d5db; padding-top: 6px; width: 20%; }
        .report-footer {
            display: flex; justify-content: space-between; align-items: center;
            padding-top: 14px; margin-top: 40px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280;
        }
    </style>
</head>
<body>
    <div class="report-container">
        <div class="action-toolbar no-print">
            <button type="button" class="btn-pdf" onclick="window.print()">🖨️ Save as PDF</button>
        </div>

        <div class="report-body">
        <div class="report-header">
            <div class="report-title-area">
                ${header.logo_url ? `<img src="${escapeHtml(header.logo_url)}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />` : ""}
                <div>
                    <div class="report-title">${escapeHtml(REPORT_TITLE)}</div>
                    <div class="report-subtitle">${escapeHtml(REPORT_SUBTITLE)} — ${escapeHtml(header.div_name)}</div>
                    ${header.cancelled ? `<div><span class="status-badge status-CANCELLED">Cancelled</span></div>` : ""}
                </div>
            </div>
            <div class="report-meta">
                <div><strong>Print Date:</strong> ${escapeHtml(printDateTime)}</div>
                <div><strong>Print User:</strong> ${escapeHtml(loginId)}</div>
            </div>
        </div>

        <div class="info-grid">
            <div class="info-block">
                <div class="label">To</div>
                <div class="value-line"><strong>${escapeHtml(header.party_name)}</strong></div>
                <div class="value-line">${escapeHtml(header.party_address)}</div>
                <div class="value-line">Tel: ${escapeHtml(header.party_phone)} &nbsp;&nbsp; Fax: ${escapeHtml(header.party_fax)}</div>
            </div>
            <div class="info-block">
                <div class="label">GRN Details</div>
                <div class="value-line">GRN No: <strong>${escapeHtml(formatDocNo(header.doc_type, header.doc_no))}</strong></div>
                <div class="value-line">Date: ${escapeHtml(dateText(header.doc_date))}</div>
                <div class="value-line">A/C Code: ${escapeHtml(header.ac_code)}</div>
                <div class="value-line">Ref No: ${escapeHtml(header.ref_no)} ${header.ref_date ? `(${escapeHtml(dateText(header.ref_date))})` : ""}</div>
                <div class="value-line">Deliver To: ${escapeHtml(header.delivery_to)}</div>
                <div class="value-line">Contact: ${escapeHtml(contactMobile)}</div>
                <div class="value-line">Email: ${escapeHtml(emailToShow)}</div>
            </div>
        </div>

        <div style="font-size:12px;color:#374151;margin-bottom:8px;">Delivery Terms: ${escapeHtml(header.dlvr_term)}</div>

        ${rows.length === 0 ? `
            <div style="text-align:center;padding:40px 20px;color:#6b7280;">No line items found for this GRN.</div>
        ` : `
            <table class="report-table">
                <thead>
                    <tr>
                        <th>Product / Description</th>
                        <th class="right">PUOM</th>
                        <th class="right">P. Qty</th>
                        <th class="right">LUOM</th>
                        <th class="right">L. Qty</th>
                        <th class="right">Quantity<br/>in LUOM</th>
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>

            <div class="totals-box">
                <div class="row"><span>Total P. Qty</span><span>${qtyFmt(totals.totalPQty)}</span></div>
                <div class="row"><span>Total L. Qty</span><span>${qtyFmt(totals.totalLQty)}</span></div>
                <div class="row grand"><span>Total Quantity</span><span>${qtyFmt(totals.totalQty)}</span></div>
            </div>
        `}

        ${header.remarks ? `<div class="remarks-box"><span class="label">Remarks:</span>${escapeHtml(header.remarks)}</div>` : ""}

        ${termsHtml ? `<div class="terms-section">${termsHtml}</div>` : ""}
        </div>

        <div class="report-footer-block">
            <div class="footer-sign">
                <div>${escapeHtml(footer.prepared) || "Prepared By"}</div>
                <div>${escapeHtml(footer.verified) || "Verified By"}</div>
                <div>${escapeHtml(footer.approved) || "Approved By"}</div>
                <div>${escapeHtml(footer.received) || "Received By"}</div>
            </div>

            
        </div>
    </div>
</body>
</html>`;
}

// ─── Excel builder (same raw-OOXML engine as PO Order Report) ─────────────

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

  const COL_COUNT = 6; // Product/Description, PUOM, P.Qty, LUOM, L.Qty, Quantity

  interface XlCell { v: unknown; styleKey: string }
  type Row = (XlCell | null)[];
  const rows_: Row[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

  rows_.push([cell(`${REPORT_TITLE} - ${header.doc_no}`, "title"), null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([cell(`Print Date: ${printDateTime}`, "meta"), null, cell(`Print User: ${loginId}`, "meta"), null, null, null]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 5 } });

  rows_.push([
    cell(`To: ${header.party_name}, ${header.party_address}`, "meta"), null, null,
    cell(`Date: ${dateText(header.doc_date)}   A/C: ${header.ac_code}`, "meta"), null, null,
  ]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 2 } });
  merges.push({ s: { r: 2, c: 3 }, e: { r: 2, c: 5 } });

  rows_.push([null, null, null, null, null, null]);

  rows_.push([
    cell("Product / Description", "header"), cell("PUOM", "header"), cell("P. Qty", "header"),
    cell("LUOM", "header"), cell("L. Qty", "header"), cell("Quantity", "header"),
  ]);

  rows.forEach((r) => {
    rows_.push([
      cell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
      cell(text(r.p_uom), "data"),
      cell(num(r.qty_puom), "dataNum"),
      cell(text(r.l_uom), "data"),
      cell(num(r.qty_luom), "dataNum"),
      cell(num(r.quantity), "dataNum"),
    ]);
  });

  rows_.push([null, null, null, null, null, null]);

  const totalRows: [string, number][] = [
    ["Total P. Qty", totals.totalPQty],
    ["Total L. Qty", totals.totalLQty],
  ];
  totalRows.forEach(([label, value]) => {
    const r = rows_.length;
    rows_.push([cell(label, "groupTotal"), null, null, null, cell(value, "groupTotalNum"), null]);
    merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
  });

  const gtRow = rows_.length;
  rows_.push([cell("Total Quantity", "grandTotal"), null, null, null, cell(totals.totalQty, "grandTotalNum"), null]);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 3 } });

 

  // ── Style registration engine (identical to PO Order Report) ──
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
    footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },
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
    res.send(renderHtml(data, params.loginid, params));
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