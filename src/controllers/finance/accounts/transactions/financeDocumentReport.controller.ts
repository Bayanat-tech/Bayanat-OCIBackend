import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import { reportHeader,
  reportFooter,
  buildReportDocument, } from "../../../common/report_common";

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

/** Finance-only CSS (document layout – not shared) */
const FINANCE_EXTRA_CSS = `
  body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #0f172a; }

  .doc-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 4px 0 10px 0;
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

  .summary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 10px 0 14px 0;
  }
  .box {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    overflow: hidden;
  }
  .box h2 {
    margin: 0;
    padding: 8px 12px 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
    background: transparent;
    border: 0;
  }
  .box-body { padding: 4px 12px 12px; min-height: auto; }
  .party-name { font-size: 13px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
  .meta { display: grid; grid-template-columns: 28mm 1fr; gap: 4px 8px; font-size: 11px; }
  .label { color: #64748b; font-weight: 600; }
  .value { color: #0f172a; font-weight: 700; }

  table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
  }
  table.data-table th {
    background: #f1f5f9;
    color: #334155;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    border: 0;
    border-bottom: 1px solid #cbd5e1;
    padding: 8px 6px;
    text-align: left;
  }
  table.data-table th.num { text-align: right; }
  table.data-table td {
    border: 0;
    border-bottom: 1px solid #f1f5f9;
    padding: 8px 6px;
    font-size: 11px;
    vertical-align: top;
  }
  table.data-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data-table td.center { text-align: center; }

  .totals-wrap {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
  .totals {
    width: 240px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
  }
  .totals td {
    padding: 8px 12px;
    border: 0;
    border-bottom: 1px solid #f1f5f9;
    font-size: 11px;
  }
  .totals tr:last-child td { border-bottom: 0; }
  .totals .grand td {
    background: #0b4ca1;
    color: #fff;
    font-weight: 800;
    font-size: 12px;
  }

  .remarks {
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    color: #475569;
    font-size: 11px;
  }
  .sign {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    margin-top: 40px;
  }
  .line {
    border-top: 1px solid #94a3b8;
    padding-top: 6px;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    color: #334155;
  }
`;

/** Body only – no <html>/<head>/<body> */
function renderFinanceBody(
  data: Awaited<ReturnType<typeof loadReportData>>,
  docType: string,
  printUser = "",
): string {
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
  const isPurchase = ["PI", "PO"].includes(docType);
  const partyLabel = isPayment(docType) ? "Payee / Account" : isPurchase ? "Supplier Details" : "Customer Details";
  const printAt = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const detailRows = visibleDetails
    .map((row, index) => {
      const lineAmount = amount(row.amount);
      const tax = amount(row.tx_compnt_amt_1);
      const rate = amount(row.price) || lineAmount;
      return `
      <tr>
        <td class="center">${index + 1}</td>
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
    })
    .join("");

  return `
    <div class="doc-title-row">
      <div>
        <h1>${escapeHtml(titleFor(docType))}</h1>
        <div class="doc-sub">${escapeHtml(header.doc_no || "")}</div>
      </div>
      <div class="print-meta">
        <div>Print Date: ${escapeHtml(printAt)}</div>
        <div>Print User: ${escapeHtml(printUser || "—")}</div>
      </div>
    </div>

    <section class="summary">
      <div class="box">
        <h2>${partyLabel}</h2>
        <div class="box-body">
          <div class="party-name">${escapeHtml(partyName || "Cash Sale")}</div>
          <div>${escapeHtml(partyAddress)}</div>
          <div>${partyPhone ? `Tel: ${escapeHtml(partyPhone)}` : "Tel:"}</div>
          <div>${partyFax ? `Fax: ${escapeHtml(partyFax)}` : "Fax:"}</div>
        </div>
      </div>
      <div class="box">
        <h2>Document Details</h2>
        <div class="box-body meta">
          <span class="label">Doc No</span><span class="value">${escapeHtml(header.doc_no)}</span>
          <span class="label">Invoice No</span><span class="value">${escapeHtml(documentNo)}</span>
          <span class="label">Doc Date</span><span class="value">${escapeHtml(dateText(header.doc_date))}</span>
          <span class="label">Account</span><span class="value">${escapeHtml(header.ac_code)}</span>
          <span class="label">Currency</span><span class="value">${escapeHtml(currency)}</span>
          <span class="label">Payment</span><span class="value">${escapeHtml(header.payment_terms || "—")}</span>
        </div>
      </div>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th class="center" style="width:8%">S.No.</th>
          <th style="width:36%">Description</th>
          <th class="num" style="width:10%">Qty</th>
          <th class="num" style="width:12%">Rate</th>
          <th class="num" style="width:12%">Excl. VAT</th>
          <th class="num" style="width:8%">VAT %</th>
          <th class="num" style="width:12%">VAT</th>
          <th class="num" style="width:12%">Incl. VAT</th>
        </tr>
      </thead>
      <tbody>${detailRows || `<tr><td colspan="8" class="center muted">No lines found</td></tr>`}</tbody>
    </table>

    ${header.remarks ? `<div class="remarks"><strong>Remarks:</strong> ${escapeHtml(header.remarks)}</div>` : ""}

    <div class="totals-wrap">
      <table class="totals">
        <tr><td>Sub Total</td><td class="num">${money(subtotal)}</td></tr>
        <tr><td>Tax Total</td><td class="num">${money(taxTotal)}</td></tr>
        <tr class="grand"><td>Grand Total ${escapeHtml(currency)}</td><td class="num">${money(total)}</td></tr>
      </table>
    </div>

    <section class="sign">
      <div class="line">Customer's Signature</div>
      <div class="line">For ${escapeHtml(companyName)}</div>
    </section>
  `;
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
    const companyCode =
      req.user?.company_code || text(req.query.company_code) || text(data.header.company_code) || "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: titleFor(docType),
      userName: text(req.user?.loginid || (req.user as any)?.username || ""),
    });

const userName = text(req.user?.loginid || (req.user as any)?.username || "");
const bodyHtml = renderFinanceBody(data, docType, userName);

const html = buildReportDocument({
  title: `${titleFor(docType)} - ${text(data.header.doc_no)}`,
  headerHtml,
  bodyHtml,
  footerHtml: reportFooter({
    reportName: titleFor(docType),
    userName,
    endLabel: "Powered by Bayanat Technology",
  }),
  extraCss: FINANCE_EXTRA_CSS,
  autoPrint: req.query.print !== "false",
});

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
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
