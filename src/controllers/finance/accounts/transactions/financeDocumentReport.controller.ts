import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";

type ReportRow = Record<string, any>;

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

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function amount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function money(value: unknown): string {
  return amount(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value: unknown): string {
  return amount(value).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function dateText(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).substring(0, 10);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function titleFor(docType: string): string {
  const map: Record<string, string> = {
    PI: "Tax Purchase Invoice",
    SI: "Tax Sales Invoice",
    SV: "Service Invoice",
    PO: "Local Purchase Order",
    BP: "Bank Payment Voucher",
    CP: "Cash Payment Voucher",
    BR: "Bank Receipt Voucher",
    CR: "Cash Receipt Voucher",
    DN: "Debit Note",
    CN: "Credit Note",
    JV: "Journal Voucher",
  };
  return map[docType] || `${docType} Document`;
}

function isPayment(docType: string): boolean {
  return ["BP", "BR", "CP", "CR"].includes(docType);
}

async function loadReportData(req: RequestWithUser, docType: string, docNo: string) {
  const conn = await getConn(req);
  try {
    const companyCode = req.user?.company_code || text(req.query.company_code) || "BSG";
    const headerResult = await conn.execute(
      `SELECT h.*,
              a.ac_name
       FROM TR_AC_HEADER h
       LEFT JOIN MS_ACCODES a
              ON a.company_code = h.company_code
             AND a.ac_code = h.ac_code
       WHERE h.company_code = :company_code
         AND h.doc_type = :doc_type
         AND h.doc_no = :doc_no`,
      { company_code: companyCode, doc_type: docType, doc_no: docNo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const header = normalize(headerResult.rows as any[])[0];
    if (!header) throw Object.assign(new Error("Document not found"), { status: 404 });

    const detailResult = await conn.execute(
      `SELECT d.*,
              a.ac_name
       FROM TR_AC_DETAIL d
       LEFT JOIN MS_ACCODES a
              ON a.company_code = d.company_code
             AND a.ac_code = d.ac_code
       WHERE d.company_code = :company_code
         AND d.doc_type = :doc_type
         AND d.doc_no = :doc_no
         AND NVL(d.cancelled, 'N') = 'N'
       ORDER BY d.serial_no`,
      { company_code: companyCode, doc_type: docType, doc_no: docNo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const invoiceResult = await conn.execute(
      `SELECT *
       FROM TR_AC_INVDETAIL
       WHERE company_code = :company_code
         AND doc_type = :doc_type
         AND doc_no = :doc_no
       ORDER BY serial_no, dtl_sr_no`,
      { company_code: companyCode, doc_type: docType, doc_no: docNo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let company: ReportRow = { company_code: companyCode };
    try {
      const companyResult = await conn.execute(
        `SELECT *
         FROM VW_COMPANY_INFO
         WHERE company_code = :company_code`,
        { company_code: companyCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      company = normalize(companyResult.rows as any[])[0] || company;
    } catch (companyError) {
      console.warn("Company information lookup failed for finance report:", companyError);
    }

    return {
      company,
      header,
      details: normalize(detailResult.rows as any[]),
      invoiceDetails: normalize(invoiceResult.rows as any[]),
    };
  } finally {
    await closeConn(conn);
  }
}

function renderHtml(data: Awaited<ReturnType<typeof loadReportData>>, docType: string, autoPrint: boolean) {
  const { company, header, details, invoiceDetails } = data;
  const visibleDetails = details.filter((row) => Number(row.serial_no) < 9000);
  const subtotal = visibleDetails.reduce((sum, row) => sum + amount(row.amount), 0);
  const taxTotal = visibleDetails.reduce((sum, row) => sum + amount(row.tx_compnt_amt_1), 0);
  const total = subtotal + taxTotal;
  const currency = text(header.curr_code || "QAR");
  const partyName = text(header.party_name || header.ac_name || header.ac_payee);
  const partyAddress = text(header.party_address);
  const partyPhone = text(header.party_phone);
  const partyFax = text(header.party_fax);
  const documentNo = text(header.invoice_no || header.inv_no || header.ref_no || header.doc_no);
  const companyName = text(company.company_name || company.name || company.company_code || header.company_code);
  const companyAddress = text(company.address || company.company_address || company.addr1 || company.addr2);
  const companyTrn = text(company.trn_no || company.trn || company.vat_no || header.trn_no);
  const isPurchase = ["PI", "PO"].includes(docType);
  const partyLabel = isPayment(docType) ? "Payee / Account" : isPurchase ? "Supplier Details" : "Customer Details";

  const detailRows = visibleDetails.map((row, index) => {
    const lineAmount = amount(row.amount);
    const tax = amount(row.tx_compnt_amt_1);
    const rate = amount(row.price) || lineAmount;
    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td class="code">${escapeHtml(row.ac_code)}</td>
        <td class="desc">
          <strong>${escapeHtml(row.ac_code)}</strong>
          <span>${escapeHtml(row.ac_name || row.remarks)}</span>
        </td>
        <td class="num">${qty(row.qty || 1)}</td>
        <td class="num">${money(rate)}</td>
        <td class="num">${money(lineAmount)}</td>
        <td class="num">${money(row.tx_compnt_perc_1)}</td>
        <td class="num">${money(tax)}</td>
        <td class="num strong">${money(lineAmount + tax)}</td>
      </tr>`;
  }).join("");

  const paymentRows = invoiceDetails.map((row) => `
    <tr>
      <td>${escapeHtml(row.inv_no || header.ref_no || header.cheque_no)}</td>
      <td>${escapeHtml(header.cheque_bank || "")}</td>
      <td>${escapeHtml(header.ac_code || "")}</td>
      <td>${escapeHtml(header.cheque_no || "")}</td>
      <td>${escapeHtml(dateText(header.cheque_date || row.inv_date || row.doc_date))}</td>
      <td class="num">${money(row.amount || total)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(titleFor(docType))} - ${escapeHtml(header.doc_no)}</title>
  <style>
    @page { size: A4; margin: 8mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; font-family: "Liberation Mono", "Courier New", Consolas, monospace; font-size: 10px; line-height: 1.22; background: #eef2f7; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 8mm; border: 1px solid #aab7c8; }
    .top { display: grid; grid-template-columns: 1fr 54mm; gap: 12px; align-items: start; border-bottom: 1.5px solid #0b459f; padding-bottom: 7px; }
    .brand { display: grid; gap: 3px; }
    .company { font-size: 16px; line-height: 1.1; font-weight: 800; letter-spacing: 0; color: #0b1f3a; text-transform: uppercase; }
    .muted { color: #64748b; }
    .title { border: 1px solid #0b459f; border-radius: 4px; overflow: hidden; text-align: center; }
    .title h1 { margin: 0; padding: 7px 8px; color: #fff; background: #0b459f; font-size: 13px; line-height: 1.1; text-transform: uppercase; letter-spacing: 0; }
    .title .pill { display: block; padding: 5px 8px; color: #0b459f; font-size: 9.5px; font-weight: 800; background: #f8fbff; }
    .summary { display: grid; grid-template-columns: 1.15fr .85fr; gap: 6px; margin-top: 7px; }
    .box { border: 1px solid #b7c2d2; border-radius: 4px; overflow: hidden; }
    .box h2 { margin: 0; padding: 5px 7px; font-size: 10px; text-transform: uppercase; letter-spacing: 0; color: #0b459f; background: #f3f7fc; border-bottom: 1px solid #d8e0eb; }
    .box-body { padding: 7px; min-height: 30mm; }
    .party-name { font-size: 11.5px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
    .meta { display: grid; grid-template-columns: 28mm 1fr; gap: 3px 8px; }
    .label { color: #64748b; font-weight: 700; }
    .value { color: #111827; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
    th { background: #0b459f; color: white; padding: 5px 5px; text-align: left; font-size: 9.3px; font-weight: 800; border: 1px solid #0b459f; }
    td { border: 1px solid #cfd8e5; padding: 4.5px 5px; vertical-align: top; font-size: 9.7px; }
    td span { display: block; color: #475569; margin-top: 1px; }
    .code { width: 22mm; color: #334155; }
    .desc { width: auto; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
    .strong { font-weight: 800; }
    .totals-wrap { display: grid; grid-template-columns: 1fr 62mm; gap: 8px; margin-top: 7px; align-items: start; }
    .remarks { min-height: 24mm; border: 1px solid #cfd8e5; padding: 7px; color: #334155; }
    .totals { width: 100%; margin: 0; border: 1px solid #0b459f; }
    .totals td { border: 0; border-bottom: 1px solid #d8e0eb; padding: 5px 7px; }
    .totals tr:last-child td { border-bottom: 0; }
    .grand { color: #fff; background: #0b459f; font-size: 12px; font-weight: 800; }
    .section-caption { margin-top: 8px; padding: 5px 7px; border: 1px solid #cfd8e5; border-bottom: 0; color: #0b459f; font-weight: 800; letter-spacing: 0; text-transform: uppercase; background: #f8fbff; }
    .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 38px; margin-top: 23mm; }
    .line { border-top: 1px solid #64748b; padding-top: 5px; text-align: center; font-weight: 800; }
    .actions { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; }
    .actions button { border: 1px solid #cbd5e1; background: white; border-radius: 8px; padding: 8px 12px; font-weight: 700; cursor: pointer; }
    @media print { body { background: white; } .sheet { border: 0; margin: 0; width: auto; min-height: auto; padding: 0; } .actions { display: none; } }
  </style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">Print / Save PDF</button></div>
  <main class="sheet">
    <section class="top">
      <div class="brand">
        <div class="company">${escapeHtml(companyName)}</div>
        <div>${escapeHtml(companyAddress)}</div>
        <div class="muted">TRN: ${escapeHtml(companyTrn || "-")}</div>
      </div>
      <div class="title">
        <h1>${escapeHtml(titleFor(docType))}</h1>
        <div class="pill">${escapeHtml(header.canceled === "Y" ? "CANCELLED" : "ORIGINAL")}</div>
      </div>
    </section>

    <section class="summary">
      <div class="box">
        <h2>${partyLabel}</h2>
        <div class="box-body">
          <div class="party-name">${escapeHtml(partyName || "Cash Sale")}</div>
          <div>${escapeHtml(partyAddress)}</div>
          <div>${partyPhone ? `Contact: ${escapeHtml(partyPhone)}` : ""}</div>
          <div>${partyFax ? `Fax: ${escapeHtml(partyFax)}` : ""}</div>
          <div>${header.payment_terms ? `Payment Terms: ${escapeHtml(header.payment_terms)}` : ""}</div>
        </div>
      </div>
      <div class="box">
        <h2>Document Details</h2>
        <div class="box-body meta">
          <span class="label">Doc No</span><span class="value">${escapeHtml(header.doc_no)}</span>
          <span class="label">Invoice No</span><span class="value">${escapeHtml(documentNo)}</span>
          <span class="label">Doc Date</span><span class="value">${escapeHtml(dateText(header.doc_date))}</span>
          <span class="label">Invoice Date</span><span class="value">${escapeHtml(dateText(header.inv_date || header.ref_date || header.doc_date))}</span>
          <span class="label">Account</span><span class="value">${escapeHtml(header.ac_code)}</span>
          <span class="label">Currency</span><span class="value">${escapeHtml(currency)}</span>
        </div>
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th class="center">SN</th>
          <th>Code</th>
          <th>Description</th>
          <th class="num">Qty</th>
          <th class="num">Rate</th>
          <th class="num">Excl. VAT</th>
          <th class="num">VAT %</th>
          <th class="num">VAT Value</th>
          <th class="num">Incl. VAT</th>
        </tr>
      </thead>
      <tbody>${detailRows || `<tr><td colspan="9" class="center muted">No lines found</td></tr>`}</tbody>
    </table>

    <section class="totals-wrap">
      <div class="remarks"><strong>Remarks:</strong> ${escapeHtml(header.remarks || "")}</div>
      <table class="totals">
        <tr><td>Sub Total ${escapeHtml(currency)}</td><td class="num">${money(subtotal)}</td></tr>
        <tr><td>Tax Total ${escapeHtml(currency)}</td><td class="num">${money(taxTotal)}</td></tr>
        <tr><td class="grand">Grand Total ${escapeHtml(currency)}</td><td class="num grand">${money(total)}</td></tr>
      </table>
    </section>

    ${isPayment(docType) || paymentRows ? `
      <div class="section-caption">Payment / Allocation Details</div>
      <table>
        <thead><tr><th>PDC No.</th><th>Bank Name</th><th>A/c No.</th><th>Cheque No.</th><th>Cheque Date</th><th class="num">Amount (${escapeHtml(currency)})</th></tr></thead>
        <tbody>${paymentRows || `<tr><td colspan="6" class="center muted">No payment allocation found</td></tr>`}</tbody>
      </table>
    ` : ""}

    <section class="sign">
      <div class="line">Customer's Signature</div>
      <div class="line">For ${escapeHtml(companyName)}</div>
    </section>
  </main>
  ${autoPrint ? "<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>" : ""}
</body>
</html>`;
}

export const getFinanceDocumentReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const docType = text(req.params.doc_type || req.query.doc_type).toUpperCase();
    const docNo = text(req.params.doc_no || req.query.doc_no);
    if (!docType || !docNo) {
      res.status(400).json({ success: false, message: "doc_type and doc_no are required" });
      return;
    }
    const data = await loadReportData(req, docType, docNo);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(data, docType, req.query.print !== "false"));
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const exportFinanceDocumentReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const docType = text(req.params.doc_type || req.query.doc_type).toUpperCase();
    const docNo = text(req.params.doc_no || req.query.doc_no);
    if (!docType || !docNo) {
      res.status(400).json({ success: false, message: "doc_type and doc_no are required" });
      return;
    }
    const data = await loadReportData(req, docType, docNo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([data.company]), "Company");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([data.header]), "Header");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.details), "Lines");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.invoiceDetails), "Allocations");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${docType}_${docNo}_report.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to export report" });
  }
};
