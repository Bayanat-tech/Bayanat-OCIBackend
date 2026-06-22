import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";

type ReportRow = Record<string, any>;

const REPORT_FONT_FAMILY = '"Liberation Mono", "Courier New", Consolas, monospace';

function reportFontPath(fileName: string): string {
  const srcPath = path.join(process.cwd(), "src", "assets", "report-fonts", fileName);
  if (fs.existsSync(srcPath)) return srcPath;
  return path.join(process.cwd(), "build", "assets", "report-fonts", fileName);
}

function fontFace(name: string, fileName: string, weight: number, style = "normal"): string {
  const fontPath = reportFontPath(fileName);
  if (!fs.existsSync(fontPath)) return "";
  const data = fs.readFileSync(fontPath).toString("base64");
  return `
    @font-face {
      font-family: ${name};
      src: url("data:font/ttf;base64,${data}") format("truetype");
      font-weight: ${weight};
      font-style: ${style};
      font-display: swap;
    }`;
}

const REPORT_FONT_FACE_CSS = [
  fontFace('"Liberation Mono"', "CAAAAA_LiberationMono.ttf", 400),
  fontFace('"Liberation Mono"', "AAAAAA_LiberationMono-Bold.ttf", 700),
  fontFace('"Liberation Mono"', "BAAAAA_LiberationMono-BoldItalic.ttf", 700, "italic"),
].join("\n");

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

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
      invoiceDetails: [],
    };
  } finally {
    await closeConn(conn);
  }
}

function renderHtml(data: Awaited<ReturnType<typeof loadReportData>>, docType: string, autoPrint: boolean) {
  const { company, header, details } = data;
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

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(titleFor(docType))} - ${escapeHtml(header.doc_no)}</title>
  <style>
    ${REPORT_FONT_FACE_CSS}
    @page { size: A4; margin: 8mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; font-family: ${REPORT_FONT_FAMILY}; font-size: 10px; line-height: 1.18; background: #f4f4f4; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 8mm; border: 1px solid #777; }
    .top { display: grid; grid-template-columns: 1fr 58mm; gap: 10px; align-items: start; border-bottom: 1px solid #777; padding-bottom: 6px; }
    .brand { display: grid; gap: 3px; }
    .company { font-size: 14px; line-height: 1.08; font-weight: 800; letter-spacing: 0; color: #111; text-transform: uppercase; }
    .muted { color: #333; }
    .title { border: 1px solid #777; text-align: center; }
    .title h1 { margin: 0; padding: 6px 7px; color: #111; background: #fff; font-size: 12px; line-height: 1.1; text-transform: uppercase; letter-spacing: 0; border-bottom: 1px solid #777; }
    .title .pill { display: block; padding: 4px 7px; color: #111; font-size: 9.5px; font-weight: 800; background: #fff; }
    .summary { display: grid; grid-template-columns: 1.15fr .85fr; gap: 6px; margin-top: 6px; }
    .box { border: 1px solid #999; overflow: hidden; }
    .box h2 { margin: 0; padding: 4px 6px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0; color: #111; background: #fff; border-bottom: 1px solid #aaa; }
    .box-body { padding: 6px; min-height: 28mm; }
    .party-name { font-size: 10.8px; font-weight: 800; color: #111; margin-bottom: 4px; }
    .meta { display: grid; grid-template-columns: 28mm 1fr; gap: 3px 8px; }
    .label { color: #333; font-weight: 700; }
    .value { color: #111; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 7px; table-layout: fixed; }
    th { background: #f5f7fa; color: #111; padding: 4px 4px; text-align: left; font-size: 9px; font-weight: 800; border: 1px solid #888; }
    td { border: 1px solid #999; padding: 4px 4px; vertical-align: top; font-size: 9.4px; }
    td span { display: block; color: #111; margin-top: 1px; }
    .code { width: 22mm; color: #111; }
    .desc { width: auto; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
    .strong { font-weight: 800; }
    .totals-wrap { display: grid; grid-template-columns: 1fr 62mm; gap: 8px; margin-top: 6px; align-items: start; }
    .remarks { min-height: 23mm; border: 1px solid #999; padding: 6px; color: #111; }
    .totals { width: 100%; margin: 0; border: 1px solid #777; }
    .totals td { border: 0; border-bottom: 1px solid #aaa; padding: 4px 6px; }
    .totals tr:last-child td { border-bottom: 0; }
    .grand { color: #111; background: #fff; font-size: 11px; font-weight: 800; }
    .section-caption { margin-top: 7px; padding: 4px 6px; border: 1px solid #888; border-bottom: 0; color: #111; font-weight: 800; letter-spacing: 0; text-transform: uppercase; background: #f5f7fa; }
    .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 38px; margin-top: 23mm; }
    .line { border-top: 1px solid #777; padding-top: 5px; text-align: center; font-weight: 800; }
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

    <section class="sign">
      <div class="line">Customer's Signature</div>
      <div class="line">For ${escapeHtml(companyName)}</div>
    </section>
  </main>
  ${autoPrint ? "<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>" : ""}
</body>
</html>`;
}

const excelStyles = {
  title: {
    font: { bold: true, sz: 14, color: { rgb: "111111" } },
    fill: { fgColor: { rgb: "FFFFFF" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: { top: { style: "thin", color: { rgb: "777777" } }, bottom: { style: "thin", color: { rgb: "777777" } }, left: { style: "thin", color: { rgb: "777777" } }, right: { style: "thin", color: { rgb: "777777" } } },
  },
  company: {
    font: { bold: true, sz: 13, color: { rgb: "111111" } },
    alignment: { vertical: "center" },
  },
  section: {
    font: { bold: true, color: { rgb: "111111" } },
    fill: { fgColor: { rgb: "FFFFFF" } },
    border: { top: { style: "thin", color: { rgb: "999999" } }, bottom: { style: "thin", color: { rgb: "999999" } }, left: { style: "thin", color: { rgb: "999999" } }, right: { style: "thin", color: { rgb: "999999" } } },
  },
  tableHead: {
    font: { bold: true, color: { rgb: "111111" } },
    fill: { fgColor: { rgb: "FFFFFF" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: { top: { style: "thin", color: { rgb: "777777" } }, bottom: { style: "thin", color: { rgb: "777777" } }, left: { style: "thin", color: { rgb: "777777" } }, right: { style: "thin", color: { rgb: "777777" } } },
  },
  label: {
    font: { bold: true, color: { rgb: "333333" } },
    alignment: { vertical: "top" },
  },
  normal: {
    alignment: { vertical: "top", wrapText: true },
    border: { bottom: { style: "thin", color: { rgb: "999999" } } },
  },
  number: {
    alignment: { horizontal: "right", vertical: "top" },
    numFmt: "#,##0.00",
    border: { bottom: { style: "thin", color: { rgb: "999999" } } },
  },
  qty: {
    alignment: { horizontal: "right", vertical: "top" },
    numFmt: "#,##0.000",
    border: { bottom: { style: "thin", color: { rgb: "999999" } } },
  },
  totalLabel: {
    font: { bold: true, color: { rgb: "111111" } },
    fill: { fgColor: { rgb: "FFFFFF" } },
    border: { top: { style: "thin", color: { rgb: "999999" } }, bottom: { style: "thin", color: { rgb: "999999" } } },
  },
  grand: {
    font: { bold: true, color: { rgb: "111111" } },
    fill: { fgColor: { rgb: "FFFFFF" } },
    alignment: { horizontal: "right" },
    numFmt: "#,##0.00",
  },
};

function cellRef(row: number, col: number) {
  return XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
}

function applyStyle(ws: XLSX.WorkSheet, row: number, col: number, style: Record<string, unknown>) {
  const ref = cellRef(row, col);
  if (!ws[ref]) ws[ref] = { t: "s", v: "" };
  (ws[ref] as any).s = style;
}

function styleRange(ws: XLSX.WorkSheet, row: number, startCol: number, endCol: number, style: Record<string, unknown>) {
  for (let col = startCol; col <= endCol; col += 1) applyStyle(ws, row, col, style);
}

function valueLength(value: unknown): number {
  const raw = text(value).trim();
  if (!raw) return 0;
  return raw.split(/\r?\n/).reduce((max, part) => Math.max(max, part.length), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function applyExcelLayout(ws: XLSX.WorkSheet, rows: any[][], lineStartRow: number, lineCount: number) {
  const minWidths = [7, 16, 34, 11, 13, 15, 10, 15, 15];
  const maxWidths = [12, 26, 58, 13, 16, 18, 12, 18, 18];
  const computedWidths = minWidths.map((minWidth, index) => {
    const longest = rows.reduce((max, row) => Math.max(max, valueLength(row[index])), 0);
    return clamp(Math.ceil(longest * 1.08) + 2, minWidth, maxWidths[index]);
  });

  ws["!cols"] = computedWidths.map((wch) => ({ wch }));
  ws["!rows"] = rows.map((row, index) => {
    const rowNo = index + 1;
    const longest = row.reduce((max, cell) => Math.max(max, valueLength(cell)), 0);
    if (rowNo === 1) return { hpt: 24 };
    if (rowNo === 11) return { hpt: 24 };
    if (rowNo >= lineStartRow && rowNo < lineStartRow + lineCount) {
      const descriptionLength = valueLength(row[2]);
      return { hpt: descriptionLength > 48 ? 34 : descriptionLength > 28 ? 27 : 22 };
    }
    if (longest > 70) return { hpt: 36 };
    if (longest > 42) return { hpt: 28 };
    return { hpt: 21 };
  });
}

function buildReportSheet(data: Awaited<ReturnType<typeof loadReportData>>, docType: string) {
  const { company, header, details } = data;
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
  const companyTrn = text(company.trn_no || company.trn || company.vat_no || header.trn_no || "-");
  const partyLabel = isPayment(docType) ? "PAYEE / ACCOUNT" : ["PI", "PO"].includes(docType) ? "SUPPLIER DETAILS" : "CUSTOMER DETAILS";

  const rows: any[][] = [
    [companyName, "", "", "", "", "", titleFor(docType), "", ""],
    [companyAddress, "", "", "", "", "", header.canceled === "Y" ? "CANCELLED" : "ORIGINAL", "", ""],
    [`TRN: ${companyTrn}`, "", "", "", "", "", "", "", ""],
    [],
    [partyLabel, "", "", "", "", "DOCUMENT DETAILS", "", "", ""],
    [partyName, "", "", "", "", "Doc No", header.doc_no, "Invoice No", documentNo],
    [partyAddress, "", "", "", "", "Doc Date", dateText(header.doc_date), "Invoice Date", dateText(header.inv_date || header.ref_date || header.doc_date)],
    [partyPhone ? `Contact: ${partyPhone}` : "", "", "", "", "", "Account", header.ac_code, "Currency", currency],
    [partyFax ? `Fax: ${partyFax}` : "", "", "", "", "", "Payment Terms", header.payment_terms || "", "", ""],
    [],
    ["SN", "Code", "Description", "Qty", "Rate", "Excl. VAT", "VAT %", "VAT Value", "Incl. VAT"],
  ];

  visibleDetails.forEach((row, index) => {
    const lineAmount = amount(row.amount);
    const tax = amount(row.tx_compnt_amt_1);
    const rate = amount(row.price) || lineAmount;
    rows.push([
      index + 1,
      row.ac_code,
      text(row.ac_name || row.remarks),
      amount(row.qty || 1),
      rate,
      lineAmount,
      amount(row.tx_compnt_perc_1),
      tax,
      lineAmount + tax,
    ]);
  });

  if (!visibleDetails.length) rows.push(["", "", "No lines found", "", "", "", "", "", ""]);

  rows.push(
    [],
    ["Remarks", header.remarks || "", "", "", "", "Sub Total", "", "", subtotal],
    ["", "", "", "", "", "Tax Total", "", "", taxTotal],
    ["", "", "", "", "", `Grand Total ${currency}`, "", "", total],
  );

  rows.push([], ["Customer's Signature", "", "", "", "", `For ${companyName}`, "", "", ""]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  applyExcelLayout(ws, rows, 12, Math.max(visibleDetails.length, 1));
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
    { s: { r: 0, c: 6 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 6 }, e: { r: 1, c: 8 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 4 } },
    { s: { r: 4, c: 5 }, e: { r: 4, c: 8 } },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 11 };
  ws["!autofilter"] = { ref: `A11:I${11 + Math.max(visibleDetails.length, 1)}` };

  applyStyle(ws, 1, 1, excelStyles.company);
  styleRange(ws, 1, 7, 9, excelStyles.title);
  styleRange(ws, 2, 7, 9, excelStyles.section);
  styleRange(ws, 5, 1, 9, excelStyles.section);
  styleRange(ws, 11, 1, 9, excelStyles.tableHead);

  for (let row = 12; row < 12 + Math.max(visibleDetails.length, 1); row += 1) {
    styleRange(ws, row, 1, 3, excelStyles.normal);
    applyStyle(ws, row, 4, excelStyles.qty);
    styleRange(ws, row, 5, 9, excelStyles.number);
  }

  const totalsStart = 13 + Math.max(visibleDetails.length, 1);
  styleRange(ws, totalsStart, 1, 9, excelStyles.normal);
  styleRange(ws, totalsStart, 6, 8, excelStyles.totalLabel);
  applyStyle(ws, totalsStart, 9, excelStyles.number);
  styleRange(ws, totalsStart + 1, 6, 8, excelStyles.totalLabel);
  applyStyle(ws, totalsStart + 1, 9, excelStyles.number);
  styleRange(ws, totalsStart + 2, 6, 8, excelStyles.grand);
  applyStyle(ws, totalsStart + 2, 9, excelStyles.grand);

  return ws;
}

const styleIdBySignature = new Map<string, number>([
  [JSON.stringify(excelStyles.title), 1],
  [JSON.stringify(excelStyles.company), 2],
  [JSON.stringify(excelStyles.section), 3],
  [JSON.stringify(excelStyles.tableHead), 4],
  [JSON.stringify(excelStyles.label), 5],
  [JSON.stringify(excelStyles.normal), 6],
  [JSON.stringify(excelStyles.number), 7],
  [JSON.stringify(excelStyles.qty), 8],
  [JSON.stringify(excelStyles.totalLabel), 9],
  [JSON.stringify(excelStyles.grand), 10],
]);

function workbookBufferFromSheet(ws: XLSX.WorkSheet): Buffer {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const colLetter = (col: number) => XLSX.utils.encode_col(col);
  const getStyleId = (cell: XLSX.CellObject | undefined) => {
    const style = (cell as any)?.s;
    if (!style) return 0;
    return styleIdBySignature.get(JSON.stringify(style)) || 0;
  };

  const colXml = (ws["!cols"] || [])
    .map((col: any, index: number) => `<col min="${index + 1}" max="${index + 1}" width="${Number(col.wch || 12)}" customWidth="1"/>`)
    .join("");

  let sheetData = "";
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref] as XLSX.CellObject | undefined;
      const styleId = getStyleId(cell);
      if (!cell && !styleId) continue;
      const attrs = `r="${ref}"${styleId ? ` s="${styleId}"` : ""}`;
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c ${attrs}><v>${value}</v></c>`);
      } else {
        cells.push(`<c ${attrs} t="inlineStr"><is><t>${escapeXml(value ?? "")}</t></is></c>`);
      }
    }
    if (cells.length) {
      const rowInfo = (ws["!rows"] || [])[r] as { hpt?: number; hpx?: number } | undefined;
      const rowHeight = rowInfo?.hpt || (rowInfo?.hpx ? rowInfo.hpx * 0.75 : undefined);
      const rowAttrs = `r="${r + 1}"${rowHeight ? ` ht="${Number(rowHeight).toFixed(2)}" customHeight="1"` : ""}`;
      sheetData += `<row ${rowAttrs}>${cells.join("")}</row>`;
    }
  }

  const merges = (ws["!merges"] || [])
    .map((merge) => `<mergeCell ref="${XLSX.utils.encode_range(merge)}"/>`)
    .join("");
  const mergeXml = merges ? `<mergeCells count="${(ws["!merges"] || []).length}">${merges}</mergeCells>` : "";
  const autoFilter = (ws["!autofilter"] as any)?.ref ? `<autoFilter ref="${escapeXml((ws["!autofilter"] as any).ref)}"/>` : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="11" topLeftCell="A12" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${autoFilter}
  ${mergeXml}
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
  <fonts count="7">
    <font><sz val="10"/><name val="Liberation Mono"/></font>
    <font><b/><sz val="14"/><color rgb="FF111111"/><name val="Liberation Mono"/></font>
    <font><b/><sz val="13"/><color rgb="FF111111"/><name val="Liberation Mono"/></font>
    <font><b/><sz val="10"/><color rgb="FF111111"/><name val="Liberation Mono"/></font>
    <font><b/><sz val="10"/><color rgb="FF111111"/><name val="Liberation Mono"/></font>
    <font><b/><sz val="10"/><color rgb="FF333333"/><name val="Liberation Mono"/></font>
    <font><b/><sz val="10"/><color rgb="FF111111"/><name val="Liberation Mono"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF777777"/></left><right style="thin"><color rgb="FF777777"/></right><top style="thin"><color rgb="FF777777"/></top><bottom style="thin"><color rgb="FF777777"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="6" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="4" fontId="4" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  return zip.toBuffer();
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
    const buffer = workbookBufferFromSheet(buildReportSheet(data, docType));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${docType}_${docNo}_report.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to export report" });
  }
};
