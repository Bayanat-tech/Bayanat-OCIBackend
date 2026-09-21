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
  doc_type:     string;
  doc_no:       string;
}

// ─── DB helpers (same as PurchaseInvoiceReports.ts) ────────────────────────

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

async function loadSalesInvoiceData(req: RequestWithUser, p: ReqParams, dispatchParam: string): Promise<ReportRow[]> {
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
         PROC_BUILD_DYNAMIC_SQL_SALES_INVOICE(
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

    console.log("=== GENERATED SQL (Sales Invoice) ===\n", rawSql, "\n=== END ===");

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Header model (built from the first line-item row) ─────────────────────

interface SalesInvoiceHeader {
  doc_no: string;
  doc_date: any;
  doc_type: string;
  div_name: string;
  ac_code: string;
  party_name: string;
  party_address: string;
  party_phone: string;
  party_fax: string;
  cust_mobile: string;
  cust_email: string;
  payment_terms: string;
  credit_period: string;
  due_date: any;
  salesman_code: string;
  trn_no: string;
  company_trn_no: string;
  disc_hdr_price: number;
  curr_code: string;
  logo_url: string | null;
}

function buildSalesInvoiceHeader(rows: ReportRow[]): SalesInvoiceHeader {
  const h = rows[0] || {};
  const address = [h.party_address, h.cust_add1, h.cust_add2, h.cust_add3].filter(Boolean).join(", ");
  return {
    doc_no: text(h.doc_no),
    doc_date: h.doc_date,
    doc_type: text(h.doc_type),
    div_name: text(h.div_name),
    ac_code: text(h.ac_code),
    party_name: text(h.party_name || h.ac_name),
    party_address: address || text(h.party_address),
    party_phone: text(h.party_phone),
    party_fax: text(h.party_fax),
    cust_mobile: text(h.cust_mobile),
    cust_email: text(h.cust_email),
    payment_terms: text(h.payment_terms),
    credit_period: text(h.credit_period),
    due_date: h.due_date,
    salesman_code: text(h.salesman_code),
    trn_no: text(h.trn_no),
    company_trn_no: text(h.company_trn_no),
    disc_hdr_price: num(h.disc_hdr_price),
    curr_code: text(h.curr_code) || "QAR",
    // TODO: PROC_BUILD_DYNAMIC_SQL_SALES_INVOICE doesn't select logo_url yet — add the
    // same ms_hr_division.comp_logo subquery used in the PO Order procedure if you
    // want the letterhead logo here too.
    logo_url: h.logo_url || null,
  };
}

// ─── Shared visual system (identical classes/colors to PurchaseInvoiceReports.ts) ─

const SHARED_STYLES = `
        @media print {
            @page { size: A4 portrait; margin: 8mm; }
            .no-print { display: none !important; }
            .report-container { box-shadow: none !important; border: none !important; }
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 20px;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 12px;
            background: #f3f4f6;
            color: #111827;
        }
        .report-container {
            max-width: 1100px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 24px 28px;
        }
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
        .report-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
        .report-table thead th {
            background: #f3f4f6; padding: 8px 14px; text-align: left; font-weight: 600; color: #374151;
            border-bottom: 2px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
        }
        .report-table tbody td { padding: 7px 14px; border-bottom: 1px solid #f3f4f6; }
        .report-table .right { text-align: right; }
        .report-table .amount { font-weight: 500; color: #065f46; }
        .totals-box { margin-top: 16px; margin-left: auto; width: 320px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
        .totals-box .row { display: flex; justify-content: space-between; padding: 6px 14px; font-size: 12px; border-bottom: 1px solid #f3f4f6; }
        .totals-box .row.grand { background: #1d4ed8; color: #fff; font-weight: 700; font-size: 13px; border-bottom: none; }
        .report-footer {
            display: flex; justify-content: space-between; align-items: center;
            padding-top: 14px; margin-top: 14px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280;
        }
        @media print {
            .report-header { border-bottom-color: #000; }
            .report-table thead th { background: #e5e7eb !important; }
            .report-container { border-radius: 0; padding: 10mm; }
        }
`;

function reportHeaderHtml(title: string, subtitle: string, header: { logo_url: string | null }, printDateTime: string, loginId: string): string {
  return `
        <div class="report-header">
            <div class="report-title-area">
                ${header.logo_url ? `<img src="${escapeHtml(header.logo_url)}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />` : ""}
                <div>
                    <div class="report-title">${escapeHtml(title)}</div>
                    <div class="report-subtitle">${escapeHtml(subtitle)}</div>
                </div>
            </div>
            <div class="report-meta">
                <div><strong>Print Date:</strong> ${escapeHtml(printDateTime)}</div>
                <div><strong>Print User:</strong> ${escapeHtml(loginId)}</div>
            </div>
        </div>`;
}

function partyInfoBlockHtml(header: SalesInvoiceHeader): string {
  return `
            <div class="info-block">
                <div class="label">To</div>
                <div class="value-line"><strong>${escapeHtml(header.party_name)}</strong></div>
                <div class="value-line">${escapeHtml(header.party_address)}</div>
                <div class="value-line">Tel: ${escapeHtml(header.party_phone)}</div>
                <div class="value-line">Fax: ${escapeHtml(header.party_fax)}</div>
                ${header.cust_mobile ? `<div class="value-line">Mob: ${escapeHtml(header.cust_mobile)}</div>` : ""}
                ${header.cust_email ? `<div class="value-line">Email: ${escapeHtml(header.cust_email)}</div>` : ""}
                ${header.trn_no ? `<div class="value-line">TRN No: ${escapeHtml(header.trn_no)}</div>` : ""}
            </div>`;
}

function printFooterHtml(): string {
  return `
    <div style="text-align:center;padding:12px;font-size:11px;color:#9ca3af;">
        Powered by Bayanat Technology
    </div>`;
}

function emptyStateHtml(title: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body style="font-family:sans-serif;padding:40px;color:#6b7280;text-align:center;">
  No records found for the selected document.
</body></html>`;
}

// ─── Report 1: Sales Invoice ────────────────────────────────────────────────

function renderSalesInvoiceHtml(rows: ReportRow[], loginId: string): string {
  if (!rows.length) return emptyStateHtml("Sales Invoice");

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = buildSalesInvoiceHeader(rows);

  const totalQty = rows.reduce((s, r) => s + num(r.quantity), 0);
  const totalAmount = rows.reduce((s, r) => s + num(r.amount), 0);
  const overallDiscount = header.disc_hdr_price;
  const grandTotal = totalAmount - overallDiscount;

  let bodyRows = "";
  rows.forEach((r, i) => {
    bodyRows += `
                        <tr>
                            <td>${i + 1}</td>
                            <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.full_prod_name || r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
                            <td>${escapeHtml(r.p_uom)}</td>
                            <td class="right">${qtyFmt(r.quantity)}</td>
                            <td class="right">${amtFmt(r.unit_price)}</td>
                            <td class="right amount">${amtFmt(r.amount)}</td>
                        </tr>`;
  });

  return `<!doctype html>
<html>
<head>
    <meta charset="utf-8"/>
    <title>Sales Invoice ${escapeHtml(header.doc_no)}</title>
    <style>${SHARED_STYLES}</style>
</head>
<body>
    <div class="report-container">
        ${reportHeaderHtml("Sales Invoice", `Invoice Document — ${header.div_name}`, header, printDateTime, loginId)}

        <div class="info-grid">
            ${partyInfoBlockHtml(header)}
            <div class="info-block">
                <div class="label">Invoice Details</div>
                <div class="value-line">Doc No: <strong>${escapeHtml(header.doc_no)}</strong></div>
                <div class="value-line">Date: ${escapeHtml(dateText(header.doc_date))}</div>
                <div class="value-line">A/C Code: ${escapeHtml(header.ac_code)}</div>
                <div class="value-line">Payment Term: ${escapeHtml(header.payment_terms)}</div>
                ${header.salesman_code ? `<div class="value-line">Sold By: ${escapeHtml(header.salesman_code)}</div>` : ""}
                ${header.due_date ? `<div class="value-line">Due Date: ${escapeHtml(dateText(header.due_date))}</div>` : ""}
            </div>
        </div>

        <table class="report-table">
            <thead>
                <tr>
                    <th>S.No.</th>
                    <th>Product / Description</th>
                    <th>Unit</th>
                    <th class="right">Qty</th>
                    <th class="right">Unit Rate</th>
                    <th class="right">Gross Value</th>
                </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>

        <div class="totals-box">
            <div class="row"><span>Total Quantity</span><span>${qtyFmt(totalQty)}</span></div>
            <div class="row"><span>Total Amount</span><span>${amtFmt(totalAmount)}</span></div>
            <div class="row"><span>Overall Discount</span><span>${amtFmt(overallDiscount)}</span></div>
            <div class="row grand"><span>Grand Total</span><span>${amtFmt(grandTotal)}</span></div>
        </div>
    </div>
    ${printFooterHtml()}
</body>
</html>`;
}

// ─── Report 2: Sales Invoice (Tax) ──────────────────────────────────────────

function renderSalesInvoiceTaxHtml(rows: ReportRow[], loginId: string): string {
  if (!rows.length) return emptyStateHtml("Sales Invoice (Tax)");

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = buildSalesInvoiceHeader(rows);

  const totalQty = rows.reduce((s, r) => s + num(r.quantity), 0);
  const totalAmount = rows.reduce((s, r) => s + num(r.amount), 0);
  const totalTax = rows.reduce((s, r) => s + num(r.tx_compnt_amt_1), 0);
  const overallDiscount = header.disc_hdr_price;
  const netTotal = totalAmount - overallDiscount + totalTax;

  let bodyRows = "";
  rows.forEach((r, i) => {
    const amountInclTax = num(r.amount) + num(r.tx_compnt_amt_1);
    bodyRows += `
                        <tr>
                            <td>${i + 1}</td>
                            <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.full_prod_name || r.prod_name)}${r.det_remarks ? ` — ${escapeHtml(r.det_remarks)}` : ""}</td>
                            <td>${escapeHtml(r.p_uom)}</td>
                            <td class="right">${qtyFmt(r.quantity)}</td>
                            <td class="right">${amtFmt(r.unit_price)}</td>
                            <td class="right">${amtFmt(r.amount)}</td>
                            <td class="right">${amtFmt(r.tx_compnt_perc_1)}%</td>
                            <td class="right">${amtFmt(r.tx_compnt_amt_1)}</td>
                            <td class="right amount">${amtFmt(amountInclTax)}</td>
                        </tr>`;
  });

  return `<!doctype html>
<html>
<head>
    <meta charset="utf-8"/>
    <title>Sales Invoice Tax ${escapeHtml(header.doc_no)}</title>
    <style>${SHARED_STYLES}</style>
</head>
<body>
    <div class="report-container">
        ${reportHeaderHtml("Sales Invoice (Tax)", `Invoice Document — ${header.div_name}`, header, printDateTime, loginId)}

        <div class="info-grid">
            ${partyInfoBlockHtml(header)}
            <div class="info-block">
                <div class="label">Invoice Details</div>
                <div class="value-line">Doc No: <strong>${escapeHtml(header.doc_no)}</strong></div>
                <div class="value-line">Date: ${escapeHtml(dateText(header.doc_date))}</div>
                <div class="value-line">A/C Code: ${escapeHtml(header.ac_code)}</div>
                <div class="value-line">Payment Term: ${escapeHtml(header.payment_terms)}</div>
                ${header.salesman_code ? `<div class="value-line">Sold By: ${escapeHtml(header.salesman_code)}</div>` : ""}
                <div class="value-line">Company TRN No: ${escapeHtml(header.company_trn_no)}</div>
            </div>
        </div>

        <table class="report-table">
            <thead>
                <tr>
                    <th>S.No.</th>
                    <th>Product / Description</th>
                    <th>Unit</th>
                    <th class="right">Qty</th>
                    <th class="right">Unit Rate</th>
                    <th class="right">Amount</th>
                    <th class="right">VAT %</th>
                    <th class="right">Tax Amount</th>
                    <th class="right">Amount (Inc. Tax)</th>
                </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>

        <div class="totals-box">
            <div class="row"><span>Total Quantity</span><span>${qtyFmt(totalQty)}</span></div>
            <div class="row"><span>Total Amount</span><span>${amtFmt(totalAmount)}</span></div>
            <div class="row"><span>Overall Discount</span><span>${amtFmt(overallDiscount)}</span></div>
            <div class="row"><span>Tax Amount</span><span>${amtFmt(totalTax)}</span></div>
            <div class="row grand"><span>Total (Inclusive Tax)</span><span>${amtFmt(netTotal)}</span></div>
        </div>
    </div>
    ${printFooterHtml()}
</body>
</html>`;
}

// ─── Report 3: Sales - Account Details ─────────────────────────────────────

function renderSalesAccountDetailsHtml(rows: ReportRow[], loginId: string): string {
  if (!rows.length) return emptyStateHtml("Account Details");

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const header = { logo_url: (rows[0].logo_url || null) as string | null };

  let totalDebit = 0;
  let totalCredit = 0;
  let bodyRows = "";
  rows.forEach((r) => {
    const amount = num(r.amount);
    const isDebit = num(r.sign_ind) >= 0;
    const debit = isDebit ? amount : 0;
    const credit = !isDebit ? Math.abs(amount) : 0;
    totalDebit += debit;
    totalCredit += credit;
    bodyRows += `
                        <tr>
                            <td>${escapeHtml(r.doc_type)}</td>
                            <td>${escapeHtml(r.doc_no)}</td>
                            <td>${escapeHtml(dateText(r.doc_date))}</td>
                            <td>${escapeHtml(r.ac_code)}</td>
                            <td>${escapeHtml(r.ac_name)}</td>
                            <td>${escapeHtml(r.curr_code)}</td>
                            <td class="right">${qtyFmt(r.ex_rate)}</td>
                            <td class="right">${debit ? amtFmt(debit) : "\u2014"}</td>
                            <td class="right amount">${credit ? amtFmt(credit) : "\u2014"}</td>
                        </tr>`;
  });

  return `<!doctype html>
<html>
<head>
    <meta charset="utf-8"/>
    <title>Account Details</title>
    <style>${SHARED_STYLES}</style>
</head>
<body>
    <div class="report-container">
        ${reportHeaderHtml("Invoice", "Report — rpt_pr_accountledger", header, printDateTime, loginId)}

        <table class="report-table">
            <thead>
                <tr>
                    <th>Type</th>
                    <th>Doc No</th>
                    <th>Doc Date</th>
                    <th>Ac Code</th>
                    <th>Ac Name</th>
                    <th>Curr Code</th>
                    <th class="right">Ex. Rate</th>
                    <th class="right">Debit</th>
                    <th class="right">Credit</th>
                </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>

        <div class="totals-box" style="width: 260px;">
            <div class="row"><span>Total Debit</span><span>${amtFmt(totalDebit)}</span></div>
            <div class="row grand"><span>Total Credit</span><span>${amtFmt(totalCredit)}</span></div>
        </div>
    </div>
    ${printFooterHtml()}
</body>
</html>`;
}

// ─── Route handlers (HTML) ──────────────────────────────────────────────────

export const getSalesInvoiceReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_SI_19082026");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderSalesInvoiceHtml(rows, params.loginid));
  } catch (error: any) {
    console.error("Sales Invoice report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getSalesInvoiceTaxReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_SI_TAX_19082026");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderSalesInvoiceTaxHtml(rows, params.loginid));
  } catch (error: any) {
    console.error("Sales Invoice Tax report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getSalesAccountDetailsReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_ACCOUNT_DETAIL_19082026");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderSalesAccountDetailsHtml(rows, params.loginid));
  } catch (error: any) {
    console.error("Sales Account Details report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

// ─── Generic OOXML Excel builder engine (shared by all 3 reports) ─────────

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
      numFmt: "#,##0.00", border: { bottom: borderThin("FFF3F4F6") },
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
      numFmt: "#,##0.00",
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
      numFmt: "#,##0.00",
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

// ─── Excel builder 1: Sales Invoice ─────────────────────────────────────────

function buildSalesInvoiceExcelBuffer(rows: ReportRow[]): Buffer {
  const header = buildSalesInvoiceHeader(rows);
  const COL_COUNT = 6; // S.No, Product/Description, Unit, Qty, Unit Rate, Gross Value
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("SALES INVOICE", "title"), null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Invoice No: ${header.doc_no}`, "meta"), null,
    xlCell(`Date: ${dateText(header.doc_date)}`, "meta"), null,
    xlCell(`A/C Code: ${header.ac_code}`, "meta"), null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
  merges.push({ s: { r: 1, c: 4 }, e: { r: 1, c: 5 } });

  rows_.push([xlCell(`To: ${header.party_name}`, "meta"), null, null, null, null, null]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 5 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("S.No", "header"), xlCell("Product/Description", "header"), xlCell("Unit", "header"),
    xlCell("Qty", "header"), xlCell("Unit Rate", "header"), xlCell("Gross Value", "header"),
  ]);

  let totalQty = 0;
  let totalAmount = 0;
  rows.forEach((r, i) => {
    totalQty += num(r.quantity);
    totalAmount += num(r.amount);
    rows_.push([
      xlCell(i + 1, "dataNumInt"),
      xlCell(`${text(r.prod_code)} ${text(r.full_prod_name || r.prod_name)}`, "data"),
      xlCell(text(r.p_uom), "data"),
      xlCell(num(r.quantity), "dataNumInt"),
      xlCell(num(r.unit_price), "dataNum"),
      xlCell(num(r.amount), "dataNum"),
    ]);
  });

  const overallDiscount = header.disc_hdr_price;
  const grandTotal = totalAmount - overallDiscount;

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  rows_.push([xlCell("Total Amount", "groupTotal"), null, null, null, null, xlCell(totalAmount, "groupTotalNum")]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 4 } });

  const discRow = rows_.length;
  rows_.push([xlCell("Overall Discount", "groupTotal"), null, null, null, null, xlCell(overallDiscount, "groupTotalNum")]);
  merges.push({ s: { r: discRow, c: 0 }, e: { r: discRow, c: 4 } });

  const grandRow = rows_.length;
  rows_.push([xlCell("Grand Total", "grandTotal"), null, null, null, null, xlCell(grandTotal, "grandTotalNum")]);
  merges.push({ s: { r: grandRow, c: 0 }, e: { r: grandRow, c: 4 } });

  rows_.push([null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Sales Invoice", COL_COUNT, 18, rows_, merges, defaultXlStyleDefs());
}

// ─── Excel builder 2: Sales Invoice (Tax) ───────────────────────────────────

function buildSalesInvoiceTaxExcelBuffer(rows: ReportRow[]): Buffer {
  const header = buildSalesInvoiceHeader(rows);
  const COL_COUNT = 8; // S.No, Product/Description, Unit, Qty, Unit Rate, Amount, VAT%, Tax Amount
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("SALES INVOICE (TAX)", "title"), null, null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Invoice No: ${header.doc_no}`, "meta"), null,
    xlCell(`Date: ${dateText(header.doc_date)}`, "meta"), null,
    xlCell(`Company TRN No: ${header.company_trn_no}`, "meta"), null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
  merges.push({ s: { r: 1, c: 4 }, e: { r: 1, c: 7 } });

  rows_.push([xlCell(`To: ${header.party_name}`, "meta"), null, null, null, null, null, null, null]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 7 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("S.No", "header"), xlCell("Product/Description", "header"), xlCell("Unit", "header"),
    xlCell("Qty", "header"), xlCell("Unit Rate", "header"), xlCell("Amount", "header"),
    xlCell("VAT %", "header"), xlCell("Tax Amount", "header"),
  ]);

  let totalQty = 0;
  let totalAmount = 0;
  let totalTax = 0;
  rows.forEach((r, i) => {
    totalQty += num(r.quantity);
    totalAmount += num(r.amount);
    totalTax += num(r.tx_compnt_amt_1);
    rows_.push([
      xlCell(i + 1, "dataNumInt"),
      xlCell(`${text(r.prod_code)} ${text(r.full_prod_name || r.prod_name)}`, "data"),
      xlCell(text(r.p_uom), "data"),
      xlCell(num(r.quantity), "dataNumInt"),
      xlCell(num(r.unit_price), "dataNum"),
      xlCell(num(r.amount), "dataNum"),
      xlCell(num(r.tx_compnt_perc_1), "dataNumInt"),
      xlCell(num(r.tx_compnt_amt_1), "dataNum"),
    ]);
  });

  const overallDiscount = header.disc_hdr_price;
  const netTotal = totalAmount - overallDiscount + totalTax;

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  rows_.push([xlCell("Total Amount", "groupTotal"), null, null, null, null, xlCell(totalAmount, "groupTotalNum"), null, null]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 4 } });
  merges.push({ s: { r: totalRow, c: 5 }, e: { r: totalRow, c: 7 } });

  const discRow = rows_.length;
  rows_.push([xlCell("Overall Discount", "groupTotal"), null, null, null, null, xlCell(overallDiscount, "groupTotalNum"), null, null]);
  merges.push({ s: { r: discRow, c: 0 }, e: { r: discRow, c: 4 } });
  merges.push({ s: { r: discRow, c: 5 }, e: { r: discRow, c: 7 } });

  const taxRow = rows_.length;
  rows_.push([xlCell("Tax Amount", "groupTotal"), null, null, null, null, xlCell(totalTax, "groupTotalNum"), null, null]);
  merges.push({ s: { r: taxRow, c: 0 }, e: { r: taxRow, c: 4 } });
  merges.push({ s: { r: taxRow, c: 5 }, e: { r: taxRow, c: 7 } });

  const grandRow = rows_.length;
  rows_.push([xlCell("Total (Inclusive Tax)", "grandTotal"), null, null, null, null, xlCell(netTotal, "grandTotalNum"), null, null]);
  merges.push({ s: { r: grandRow, c: 0 }, e: { r: grandRow, c: 4 } });
  merges.push({ s: { r: grandRow, c: 5 }, e: { r: grandRow, c: 7 } });

  rows_.push([null, null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Sales Invoice Tax", COL_COUNT, 15, rows_, merges, defaultXlStyleDefs());
}

// ─── Excel builder 3: Sales - Account Details ───────────────────────────────

function buildSalesAccountDetailsExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const COL_COUNT = 9; // Type, Doc No, Doc Date, Ac Code, Ac Name, Curr Code, Ex Rate, Debit, Credit
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("ACCOUNT DETAILS", "title"), null, null, null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Date: ${dateText(new Date())}`, "meta"), null,
    xlCell(`User: ${loginId}`, "meta"), null,
    xlCell("Report: rpt_pr_accountledger", "meta"), null, null, null, null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
  merges.push({ s: { r: 1, c: 4 }, e: { r: 1, c: 8 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("Type", "header"), xlCell("Doc No", "header"), xlCell("Doc Date", "header"),
    xlCell("Ac Code", "header"), xlCell("Ac Name", "header"), xlCell("Curr Code", "header"),
    xlCell("Ex. Rate", "header"), xlCell("Debit", "header"), xlCell("Credit", "header"),
  ]);

  let totalDebit = 0;
  let totalCredit = 0;
  rows.forEach((r) => {
    const amount = num(r.amount);
    const isDebit = num(r.sign_ind) >= 0;
    const debit = isDebit ? amount : 0;
    const credit = !isDebit ? Math.abs(amount) : 0;
    totalDebit += debit;
    totalCredit += credit;
    rows_.push([
      xlCell(text(r.doc_type), "data"),
      xlCell(text(r.doc_no), "data"),
      xlCell(dateText(r.doc_date), "data"),
      xlCell(text(r.ac_code), "data"),
      xlCell(text(r.ac_name), "data"),
      xlCell(text(r.curr_code), "data"),
      xlCell(num(r.ex_rate), "dataNumInt"),
      xlCell(debit, "dataNum"),
      xlCell(credit, "dataNum"),
    ]);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  rows_.push([
    xlCell("Total", "grandTotal"), null, null, null, null, null, null,
    xlCell(totalDebit, "grandTotalNum"), xlCell(totalCredit, "grandTotalNum"),
  ]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 6 } });

  rows_.push([null, null, null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Sales Account Details", COL_COUNT, 16, rows_, merges, defaultXlStyleDefs());
}

// ─── Route handlers (Excel) ─────────────────────────────────────────────────

export const getSalesInvoiceReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_SI__19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildSalesInvoiceExcelBuffer(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Invoice.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Invoice Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};

export const getSalesInvoiceTaxReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_SI_TAX_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildSalesInvoiceTaxExcelBuffer(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Invoice_Tax.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Invoice Tax Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};

export const getSalesAccountDetailsReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesInvoiceData(req, params, "S_INVOICE_ACCOUNT_DETAIL_19082026");
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected document." });
      return;
    }
    const buffer = buildSalesAccountDetailsExcelBuffer(rows, params.loginid);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Invoice_Account_Details.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales Account Details Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};