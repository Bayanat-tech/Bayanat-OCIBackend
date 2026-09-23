import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../../controllers/common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:      string;
  company_code: string;
  doc_type:     string;
  doc_no:       string;
}

// ─── DB helpers (same as SalesInvoiceReports.ts) ───────────────────────────

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
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:      text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code),
    doc_type:     text(b.doc_type),
    doc_no:       text(b.doc_no),
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadPurchaseQuotationData(req: RequestWithUser, p: ReqParams, dispatchParam: string): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const binds: any = {
      parameter: dispatchParam,
      loginid: p.loginid,
      code1: p.company_code || null,
      code2: p.doc_type || null,
      code3: p.doc_no || null,
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

    const result = await conn.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_PURCHASE_QUOTATION(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

    console.log("=== GENERATED SQL (Purchase Quotation) ===\n", rawSql, "\n=== END ===");

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Header model (built from the first line-item row) ─────────────────────

interface PurchaseQuotationHeader {
  doc_no: string;
  doc_date: any;
  doc_type: string;
  div_name: string;
  ac_code: string;
  party_name: string;
  party_address: string;
  party_phone: string;
  party_fax: string;
  ref_no: string;
  ref_date: any;
  quotation_refno: string;
  delivery_to: string;
  dlvr_contact: string;
  dlvr_email: string;
  disc_hdr_price: number;
  curr_code: string;
}

function buildPurchaseQuotationHeader(rows: ReportRow[]): PurchaseQuotationHeader {
  const h = rows[0] || {};
  return {
    doc_no: text(h.doc_no),
    doc_date: h.doc_date,
    doc_type: text(h.doc_type),
    div_name: text(h.div_name),
    ac_code: text(h.ac_code),
    party_name: text(h.party_name),
    party_address: text(h.party_address),
    party_phone: text(h.party_phone),
    party_fax: text(h.party_fax),
    ref_no: text(h.ref_no),
    ref_date: h.ref_date,
    quotation_refno: text(h.quotation_refno),
    delivery_to: text(h.delivery_to),
    dlvr_contact: text(h.dlvr_contact),
    dlvr_email: text(h.dlvr_email),
    disc_hdr_price: num(h.disc_hdr_price),
    curr_code: text(h.curr_code) || "QAR",
  };
}

// ─── Shared visual system (identical extra CSS across all 3 reports) ──────

/** Report-specific layout CSS (shared header/footer/table CSS comes from report_common) */
const PQ_EXTRA_CSS = `
  .doc-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 4px 0 12px 0;
  }
  .doc-title-row h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0b4ca1;
  }
  .doc-title-row .doc-sub {
    margin: 2px 0 0;
    font-size: 11px;
    color: #64748b;
  }
  .doc-title-row .print-meta {
    text-align: right;
    font-size: 10.5px;
    color: #475569;
    line-height: 1.4;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 14px;
  }
  .info-block {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
    background: #f8fafc;
  }
  .info-block .label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    margin-bottom: 6px;
    font-weight: 700;
  }
  .info-block .value-line {
    font-size: 12px;
    color: #0f172a;
    line-height: 1.55;
  }

  .totals-box {
    margin-top: 16px;
    margin-left: auto;
    width: 300px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
  }
  .totals-box .row {
    display: flex;
    justify-content: space-between;
    padding: 7px 14px;
    font-size: 12px;
    border-bottom: 1px solid #f1f5f9;
  }
  .totals-box .row.grand {
    background: #0b4ca1;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    border-bottom: none;
  }

  table.data-table.compare th,
  table.data-table.compare td {
    font-size: 10.5px;
    padding: 6px 6px;
  }
`;

function docTitleRowHtml(title: string, subtitle: string, printDateTime: string, loginId: string): string {
  return `
    <div class="doc-title-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="doc-sub">${escapeHtml(subtitle)}</div>
      </div>
      
    </div>`;
}

function partyInfoBlockHtml(header: PurchaseQuotationHeader): string {
  return `
      <div class="info-block">
        <div class="label">To</div>
        <div class="value-line"><strong>${escapeHtml(header.party_name)}</strong></div>
        <div class="value-line">${escapeHtml(header.party_address)}</div>
        <div class="value-line">Tel: ${escapeHtml(header.party_phone)}</div>
        <div class="value-line">Fax: ${escapeHtml(header.party_fax)}</div>
        ${header.dlvr_contact ? `<div class="value-line">Contact: ${escapeHtml(header.dlvr_contact)}</div>` : ""}
        ${header.dlvr_email ? `<div class="value-line">Email: ${escapeHtml(header.dlvr_email)}</div>` : ""}
      </div>`;
}

function quotationDetailsBlockHtml(header: PurchaseQuotationHeader): string {
  return `
      <div class="info-block">
        <div class="label">Quotation Details</div>
        <div class="value-line">Quotation No: <strong>${escapeHtml(header.doc_no)}</strong></div>
        <div class="value-line">Date: ${escapeHtml(dateText(header.doc_date))}</div>
        <div class="value-line">A/C Code: ${escapeHtml(header.ac_code)}</div>
        <div class="value-line">Quot Ref: ${escapeHtml(header.quotation_refno)}</div>
        <div class="value-line">Ref No: ${escapeHtml(header.ref_no)}</div>
        <div class="value-line">Ref Date: ${escapeHtml(dateText(header.ref_date))}</div>
        <div class="value-line">Deliver To: ${escapeHtml(header.delivery_to)}</div>
      </div>`;
}

// ─── Report 1: Quotation ────────────────────────────────────────────────────

/** Body only – no full HTML document */
function renderPurchaseQuotationBody(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = buildPurchaseQuotationHeader(rows);

  const totalAmount = rows.reduce((s, r) => s + num(r.amount), 0);
  const overallDiscount = header.disc_hdr_price;
  const grandTotal = totalAmount - overallDiscount;

  const bodyRows = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
        <td class="center">${escapeHtml(r.p_uom)}</td>
        <td class="right">${qtyFmt(r.qty_puom)}</td>
        <td class="center">${escapeHtml(r.l_uom)}</td>
        <td class="right">${qtyFmt(r.qty_luom)}</td>
        <td class="right">${qtyFmt(r.quantity)}</td>
        <td class="right">${amtFmt(r.unit_price)}</td>
        <td class="right">${amtFmt(r.disc_percent)}%</td>
        <td class="right">${amtFmt(r.disc_price)}</td>
        <td class="right amount">${amtFmt(r.amount)}</td>
      </tr>`
    )
    .join("");

  return `
    ${docTitleRowHtml("Quotation", `Purchase Quotation — ${header.div_name}`, printDateTime, loginId)}

    <div class="info-grid">
      ${partyInfoBlockHtml(header)}
      ${quotationDetailsBlockHtml(header)}
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>Product / Description</th>
          <th class="center">P Uom</th>
          <th class="right">P Qty</th>
          <th class="center">L Uom</th>
          <th class="right">L Qty</th>
          <th class="right">Quantity in LUOM</th>
          <th class="right">Unit Rate</th>
          <th class="right">Disc %</th>
          <th class="right">Disc Amt</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <div class="totals-box">
      <div class="row"><span>Total</span><span>${amtFmt(totalAmount)}</span></div>
      <div class="row"><span>Overall Discount</span><span>${amtFmt(overallDiscount)}</span></div>
      <div class="row grand"><span>Grand Total</span><span>${amtFmt(grandTotal)}</span></div>
    </div>
  `;
}

// ─── Report 2: Quotation With Rates ─────────────────────────────────────────

/** Body only – no full HTML document */
function renderPurchaseQuotationWithRatesBody(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = buildPurchaseQuotationHeader(rows);

  const totalAmount = rows.reduce((s, r) => s + num(r.amount), 0);
  const totalTax = rows.reduce((s, r) => s + num(r.tx_compnt_amt_1), 0);
  const overallDiscount = header.disc_hdr_price;
  const grandTotal = totalAmount - overallDiscount + totalTax;

  const bodyRows = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
        <td class="center">${escapeHtml(r.p_uom)}</td>
        <td class="right">${qtyFmt(r.qty_puom)}</td>
        <td class="center">${escapeHtml(r.l_uom)}</td>
        <td class="right">${qtyFmt(r.qty_luom)}</td>
        <td class="right">${qtyFmt(r.quantity)}</td>
        <td class="right">${amtFmt(r.unit_price)}</td>
        <td class="right">${amtFmt(r.disc_percent)}%</td>
        <td class="right">${amtFmt(r.disc_price)}</td>
        <td class="right amount">${amtFmt(r.amount)}</td>
      </tr>`
    )
    .join("");

  return `
    ${docTitleRowHtml("Quotation", `Purchase Quotation With Rates — ${header.div_name}`, printDateTime, loginId)}

    <div class="info-grid">
      ${partyInfoBlockHtml(header)}
      ${quotationDetailsBlockHtml(header)}
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>Product / Description</th>
          <th class="center">P Uom</th>
          <th class="right">P Qty</th>
          <th class="center">L Uom</th>
          <th class="right">L Qty</th>
          <th class="right">Quantity in LUOM</th>
          <th class="right">Unit Rate</th>
          <th class="right">Disc %</th>
          <th class="right">Disc Amt</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <div class="totals-box">
      <div class="row"><span>Total</span><span>${amtFmt(totalAmount)}</span></div>
      <div class="row"><span>Overall Discount</span><span>${amtFmt(overallDiscount)}</span></div>
      <div class="row"><span>TAX Amt</span><span>${amtFmt(totalTax)}</span></div>
      <div class="row grand"><span>Grand Total</span><span>${amtFmt(grandTotal)}</span></div>
    </div>
  `;
}

// ─── Report 3: Compare Quotations ───────────────────────────────────────────

/** Body only – no full HTML document */
function renderCompareQuotationBody(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const bodyRows = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}</td>
        <td class="right">${qtyFmt(r.quantity)}</td>
        <td>${escapeHtml(r.quot_no1)}</td>
        <td>${escapeHtml(r.ac_code1)} ${escapeHtml(r.ac_name1)}</td>
        <td class="right">${r.quot_price1 != null ? amtFmt(r.quot_price1) : ""}</td>
        <td>${escapeHtml(r.quot_no2)}</td>
        <td>${escapeHtml(r.ac_code2)} ${escapeHtml(r.ac_name2)}</td>
        <td class="right">${r.quot_price2 != null ? amtFmt(r.quot_price2) : ""}</td>
        <td>${escapeHtml(r.quot_no3)}</td>
        <td>${escapeHtml(r.ac_code3)} ${escapeHtml(r.ac_name3)}</td>
        <td class="right">${r.quot_price3 != null ? amtFmt(r.quot_price3) : ""}</td>
        <td>${escapeHtml(r.quot_no4)}</td>
        <td>${escapeHtml(r.ac_code4)} ${escapeHtml(r.ac_name4)}</td>
        <td class="right">${r.quot_price4 != null ? amtFmt(r.quot_price4) : ""}</td>
        <td>${escapeHtml(r.quot_no5)}</td>
        <td>${escapeHtml(r.ac_code5)} ${escapeHtml(r.ac_name5)}</td>
        <td class="right">${r.quot_price5 != null ? amtFmt(r.quot_price5) : ""}</td>
      </tr>`
    )
    .join("");

  return `
    ${docTitleRowHtml("Compare Quotations", "Report — rpt_pquotation_compare", printDateTime, loginId)}

    <table class="data-table compare">
      <thead>
        <tr>
          <th rowspan="2">Product</th>
          <th rowspan="2">Qty</th>
          <th colspan="3" class="center">Supplier 1</th>
          <th colspan="3" class="center">Supplier 2</th>
          <th colspan="3" class="center">Supplier 3</th>
          <th colspan="3" class="center">Supplier 4</th>
          <th colspan="3" class="center">Supplier 5</th>
        </tr>
        <tr>
          <th>Quot No</th><th>A/C Name</th><th class="right">Price</th>
          <th>Quot No</th><th>A/C Name</th><th class="right">Price</th>
          <th>Quot No</th><th>A/C Name</th><th class="right">Price</th>
          <th>Quot No</th><th>A/C Name</th><th class="right">Price</th>
          <th>Quot No</th><th>A/C Name</th><th class="right">Price</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

// ─── Route handlers (HTML) ──────────────────────────────────────────────────

export const getPurchaseQuotationReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPurchaseQuotationData(req, params, "PQ_QUOTATION_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No records found for the selected document." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "Quotation",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderPurchaseQuotationBody(rows, params.loginid);

    const html = buildReportDocument({
      title: `Quotation ${buildPurchaseQuotationHeader(rows).doc_no}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PQ_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Purchase Quotation report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPurchaseQuotationWithRatesReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPurchaseQuotationData(req, params, "PQ_WTH_RATES_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No records found for the selected document." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "Quotation With Rates",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderPurchaseQuotationWithRatesBody(rows, params.loginid);

    const html = buildReportDocument({
      title: `Quotation With Rates ${buildPurchaseQuotationHeader(rows).doc_no}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PQ_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Purchase Quotation With Rates report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPurchaseQuotationCompareReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPurchaseQuotationData(req, params, "PQ_COMPARE QUOTATION_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No records found for the selected document." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_pquotation_compare",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderCompareQuotationBody(rows, params.loginid);

    const html = buildReportDocument({
      title: "Compare Quotations",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PQ_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Compare Quotation report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

// ─── Generic OOXML Excel builder engine (shared) ────────────────────────────

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";
const XL_GREEN_BG = "FFD1FAE5";

function xlCell(v: unknown, styleKey: string): XlCell {
  return { v, styleKey };
}

function defaultXlStyleDefs(): Record<string, any> {
  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
  return {
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
      border: { top: borderThin(XL_BLUE), bottom: borderThin(XL_BLUE), left: borderThin(XL_BLUE), right: borderThin(XL_BLUE) },
    },
    data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: borderThin("FFF3F4F6") } },
    dataNum: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000", border: { bottom: borderThin("FFF3F4F6") },
    },
    dataNumInt: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0", border: { bottom: borderThin("FFF3F4F6") },
    },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: XL_GREEN_BG } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { top: borderThin("FF065F46") },
    },
    groupTotalNum: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: XL_GREEN_BG } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
      border: { top: borderThin("FF065F46") },
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
}

function buildXlsxBuffer(sheetName: string, colCount: number, colWidth: number, rows_: XlRow[], merges: XlMerge[], styleDefs: Record<string, any>): Buffer {
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

  const colXml = Array.from({ length: colCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${colWidth}" customWidth="1"/>`
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

// ─── Excel builder 1: Quotation ─────────────────────────────────────────────

function buildPurchaseQuotationExcelBuffer(rows: ReportRow[]): Buffer {
  const header = buildPurchaseQuotationHeader(rows);
  const COL_COUNT = 10;
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("QUOTATION", "title"), null, null, null, null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Quotation No: ${header.doc_no}`, "meta"), null, null,
    xlCell(`Date: ${dateText(header.doc_date)}`, "meta"), null, null,
    xlCell(`A/C Code: ${header.ac_code}`, "meta"), null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
  merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: 5 } });
  merges.push({ s: { r: 1, c: 6 }, e: { r: 1, c: 9 } });

  rows_.push([xlCell(`To: ${header.party_name}`, "meta"), null, null, null, null, null, null, null, null, null]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 9 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("Product/Description", "header"), xlCell("P Uom", "header"), xlCell("P Qty", "header"),
    xlCell("L Uom", "header"), xlCell("L Qty", "header"), xlCell("Quantity in LUOM", "header"),
    xlCell("Unit Rate", "header"), xlCell("Disc %", "header"), xlCell("Disc Amt", "header"), xlCell("Amount", "header"),
  ]);

  let totalAmount = 0;
  rows.forEach((r) => {
    totalAmount += num(r.amount);
    rows_.push([
      xlCell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
      xlCell(text(r.p_uom), "data"),
      xlCell(num(r.qty_puom), "dataNum"),
      xlCell(text(r.l_uom), "data"),
      xlCell(num(r.qty_luom), "dataNum"),
      xlCell(num(r.quantity), "dataNum"),
      xlCell(num(r.unit_price), "dataNum"),
      xlCell(num(r.disc_percent), "dataNum"),
      xlCell(num(r.disc_price), "dataNum"),
      xlCell(num(r.amount), "dataNum"),
    ]);
  });

  const overallDiscount = header.disc_hdr_price;
  const grandTotal = totalAmount - overallDiscount;

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  rows_.push([xlCell("Total", "groupTotal"), null, null, null, null, null, null, null, null, xlCell(totalAmount, "groupTotalNum")]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 8 } });

  const discRow = rows_.length;
  rows_.push([xlCell("Overall Discount", "groupTotal"), null, null, null, null, null, null, null, null, xlCell(overallDiscount, "groupTotalNum")]);
  merges.push({ s: { r: discRow, c: 0 }, e: { r: discRow, c: 8 } });

  const grandRow = rows_.length;
  rows_.push([xlCell("Grand Total", "grandTotal"), null, null, null, null, null, null, null, null, xlCell(grandTotal, "grandTotalNum")]);
  merges.push({ s: { r: grandRow, c: 0 }, e: { r: grandRow, c: 8 } });

  rows_.push([null, null, null, null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Quotation", COL_COUNT, 14, rows_, merges, defaultXlStyleDefs());
}

// ─── Excel builder 2: Quotation With Rates ──────────────────────────────────

function buildPurchaseQuotationWithRatesExcelBuffer(rows: ReportRow[]): Buffer {
  const header = buildPurchaseQuotationHeader(rows);
  const COL_COUNT = 10;
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("QUOTATION (WITH RATES)", "title"), null, null, null, null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Quotation No: ${header.doc_no}`, "meta"), null, null,
    xlCell(`Date: ${dateText(header.doc_date)}`, "meta"), null, null,
    xlCell(`A/C Code: ${header.ac_code}`, "meta"), null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
  merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: 5 } });
  merges.push({ s: { r: 1, c: 6 }, e: { r: 1, c: 9 } });

  rows_.push([xlCell(`To: ${header.party_name}`, "meta"), null, null, null, null, null, null, null, null, null]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 9 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("Product/Description", "header"), xlCell("P Uom", "header"), xlCell("P Qty", "header"),
    xlCell("L Uom", "header"), xlCell("L Qty", "header"), xlCell("Quantity in LUOM", "header"),
    xlCell("Unit Rate", "header"), xlCell("Disc %", "header"), xlCell("Disc Amt", "header"), xlCell("Amount", "header"),
  ]);

  let totalAmount = 0;
  let totalTax = 0;
  rows.forEach((r) => {
    totalAmount += num(r.amount);
    totalTax += num(r.tx_compnt_amt_1);
    rows_.push([
      xlCell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
      xlCell(text(r.p_uom), "data"),
      xlCell(num(r.qty_puom), "dataNum"),
      xlCell(text(r.l_uom), "data"),
      xlCell(num(r.qty_luom), "dataNum"),
      xlCell(num(r.quantity), "dataNum"),
      xlCell(num(r.unit_price), "dataNum"),
      xlCell(num(r.disc_percent), "dataNum"),
      xlCell(num(r.disc_price), "dataNum"),
      xlCell(num(r.amount), "dataNum"),
    ]);
  });

  const overallDiscount = header.disc_hdr_price;
  const grandTotal = totalAmount - overallDiscount + totalTax;

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  rows_.push([xlCell("Total", "groupTotal"), null, null, null, null, null, null, null, null, xlCell(totalAmount, "groupTotalNum")]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 8 } });

  const discRow = rows_.length;
  rows_.push([xlCell("Overall Discount", "groupTotal"), null, null, null, null, null, null, null, null, xlCell(overallDiscount, "groupTotalNum")]);
  merges.push({ s: { r: discRow, c: 0 }, e: { r: discRow, c: 8 } });

  const taxRow = rows_.length;
  rows_.push([xlCell("TAX Amt", "groupTotal"), null, null, null, null, null, null, null, null, xlCell(totalTax, "groupTotalNum")]);
  merges.push({ s: { r: taxRow, c: 0 }, e: { r: taxRow, c: 8 } });

  const grandRow = rows_.length;
  rows_.push([xlCell("Grand Total", "grandTotal"), null, null, null, null, null, null, null, null, xlCell(grandTotal, "grandTotalNum")]);
  merges.push({ s: { r: grandRow, c: 0 }, e: { r: grandRow, c: 8 } });

  rows_.push([null, null, null, null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Quotation With Rates", COL_COUNT, 14, rows_, merges, defaultXlStyleDefs());
}

// ─── Excel builder 3: Compare Quotations ────────────────────────────────────

function buildCompareQuotationExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const COL_COUNT = 17; // Product, Qty, then 5 x (Quot No, A/C Name, Price)
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("COMPARE QUOTATIONS", "title"), ...new Array(COL_COUNT - 1).fill(null)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Date: ${dateText(new Date())}`, "meta"), null,
    xlCell(`User: ${loginId}`, "meta"), null,
    xlCell("Report: rpt_pquotation_compare", "meta"), ...new Array(COL_COUNT - 5).fill(null),
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
  merges.push({ s: { r: 1, c: 4 }, e: { r: 1, c: COL_COUNT - 1 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  const headerRow: XlRow = [xlCell("Product", "header"), xlCell("Qty", "header")];
  for (let i = 1; i <= 5; i++) {
    headerRow.push(xlCell("Quot No", "header"), xlCell("A/C Name", "header"), xlCell("Price", "header"));
  }
  rows_.push(headerRow);

  rows.forEach((r) => {
    const row: XlRow = [
      xlCell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
      xlCell(num(r.quantity), "dataNum"),
    ];
    for (let i = 1; i <= 5; i++) {
      row.push(
        xlCell(text(r[`quot_no${i}`]), "data"),
        xlCell(`${text(r[`ac_code${i}`])} ${text(r[`ac_name${i}`])}`.trim(), "data"),
        xlCell(r[`quot_price${i}`] != null ? num(r[`quot_price${i}`]) : "", r[`quot_price${i}`] != null ? "dataNum" : "data"),
      );
    }
    rows_.push(row);
  });

  rows_.push(new Array(COL_COUNT).fill(null));
  rows_.push([null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Compare Quotations", COL_COUNT, 12, rows_, merges, defaultXlStyleDefs());
}

// ─── Route handlers (Excel) ─────────────────────────────────────────────────

export const getPurchaseQuotationReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPurchaseQuotationData(req, params, "PQ_QUOTATION_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildPurchaseQuotationExcelBuffer(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Purchase_Quotation.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Purchase Quotation Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};

export const getPurchaseQuotationWithRatesReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPurchaseQuotationData(req, params, "PQ_WTH_RATES_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildPurchaseQuotationWithRatesExcelBuffer(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Purchase_Quotation_With_Rates.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Purchase Quotation With Rates Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};

export const getPurchaseQuotationCompareReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPurchaseQuotationData(req, params, "PQ_COMPARE QUOTATION_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildCompareQuotationExcelBuffer(rows, params.loginid);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Compare_Quotations.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Compare Quotation Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};