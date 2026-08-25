import { ReportRow } from "../common/types";
import { extractHeader, extractLines, calcTotals, currencyLabel } from "../common/extract";
import {
  escapeHtml,
  fmtNumber,
  numberToWords,
  printDateTimeNow,
} from "../common/formatters";

/**
 * Delivery Note – HTML renderer
 * Layout matches the shared sales-doc style with title "DELIVERY NOTE".
 */
export function renderDnHtml(rows: ReportRow[], loginId: string): string {
  const header = extractHeader(rows);
  const lines = extractLines(rows);

  if (!header) {
    return `<!doctype html><html><head><meta charset="utf-8"/><title>Delivery Note</title></head>
<body style="font-family:Arial,sans-serif;padding:40px;text-align:center;color:#666">
  <h2>No data found</h2>
  <p>Delivery Note not found for the given document number.</p>
</body></html>`;
  }

  const { totalQty, totalAmount, overallDiscount, grandTotal } = calcTotals(
    lines,
    header.disc_hdr_price,
  );
  const amountInWords = `${currencyLabel(header.curr_code)} - ${numberToWords(grandTotal)} only`;

  const addressBlock =
    header.party_address ||
    [header.cust_add1, header.cust_add2, header.cust_add3].filter(Boolean).join(" ");

  const printDateTime = printDateTimeNow();

  const lineRows = lines
    .map(
      (l, idx) => `
    <tr class="data-row">
      <td class="center">${idx + 1}</td>
      <td>
        <div class="prod-code">${escapeHtml(l.prod_code)}</div>
        <div class="prod-name">${escapeHtml(l.prod_name)}</div>
        ${l.det_remarks ? `<div class="det-remarks">${escapeHtml(l.det_remarks)}</div>` : ""}
      </td>
      <td class="center">${escapeHtml(l.p_uom)}</td>
      <td class="num">${fmtNumber(l.quantity, 0)}</td>
      <td class="num">${fmtNumber(l.unit_price)}</td>
      <td class="num">${fmtNumber(l.amount)}</td>
    </tr>`,
    )
    .join("");

  const logoHtml = header.company_logo
    ? `<img class="company-logo" src="${escapeHtml(header.company_logo)}" alt="Logo" />`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Delivery Note - ${escapeHtml(header.doc_no)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px; color: #111; background: #f1f5f9;
    }
    .sheet {
      max-width: 210mm; margin: 12px auto; background: #fff;
      padding: 18px 22px 14px; box-shadow: 0 1px 6px rgba(0,0,0,.08);
      display: flex; flex-direction: column; min-height: 297mm;
    }
    .company-header {
      display: flex; align-items: center; gap: 12px;
      border-bottom: 2px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 8px;
    }
    .company-logo { max-height: 52px; max-width: 140px; object-fit: contain; }
    .company-name-block { flex: 1; }
    .company-name { font-size: 16px; font-weight: 700; letter-spacing: 0.5px; color: #1e3a8a; }
    .company-sub { font-size: 10px; color: #64748b; margin-top: 2px; }
    .report-title {
      text-align: center; font-size: 15px; font-weight: 700;
      letter-spacing: 3px; margin: 10px 0 14px; color: #0f172a;
    }
    .meta-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 14px;
    }
    .meta-left .party-name { font-weight: 700; font-size: 12px; margin-bottom: 2px; }
    .meta-left .party-addr { white-space: pre-line; line-height: 1.35; color: #334155; }
    .meta-left .contact-line { margin-top: 4px; color: #475569; font-size: 10.5px; }
    .meta-right { text-align: right; }
    .meta-right table { margin-left: auto; border-collapse: collapse; font-size: 11px; }
    .meta-right td { padding: 1px 0 1px 10px; vertical-align: top; }
    .meta-right td.lbl { color: #64748b; text-align: right; white-space: nowrap; }
    .meta-right td.val { font-weight: 600; text-align: left; min-width: 120px; }
    table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10.5px; }
    table.lines thead th {
      background: #1d4ed8; color: #fff; border: 1px solid #1e3a8a;
      padding: 6px 5px; text-align: center; font-weight: 700;
    }
    table.lines tbody td { border: 1px solid #cbd5e1; padding: 5px 6px; vertical-align: top; }
    table.lines td.center { text-align: center; }
    table.lines td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .prod-code { font-weight: 600; }
    .prod-name { color: #334155; margin-top: 1px; }
    .det-remarks { color: #64748b; font-size: 9.5px; margin-top: 2px; font-style: italic; }
    tr.data-row:nth-child(even) td { background: #f8fafc; }
    .totals-block {
      display: grid; grid-template-columns: 1fr auto; gap: 12px; margin-top: 12px; align-items: start;
    }
    .totals-left { font-size: 11px; }
    .totals-left .qty-line { font-weight: 600; margin-bottom: 6px; }
    .amount-words {
      font-style: italic; color: #1e293b; border-top: 1px dashed #94a3b8;
      padding-top: 6px; margin-top: 4px;
    }
    .totals-right table { border-collapse: collapse; font-size: 11px; min-width: 220px; }
    .totals-right td { padding: 3px 8px; }
    .totals-right td.lbl { text-align: right; color: #475569; }
    .totals-right td.val { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 90px; }
    .totals-right tr.grand td {
      background: #1d4ed8; color: #fff; font-weight: 700; border-top: 2px solid #1e3a8a;
    }
    .print-footer-block { margin-top: auto; }
    .sign-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding-top: 8px;
    }
    .sign-box {
      text-align: center; border-top: 1px solid #64748b; padding-top: 6px;
      font-size: 10px; color: #334155; min-height: 28px;
    }
    .footnote {
      margin-top: 18px; font-size: 9.5px; color: #64748b;
      border-top: 1px solid #e2e8f0; padding-top: 6px;
    }
    .report-footer {
      display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; margin-top: 10px;
    }
    .cancelled-banner {
      background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
      text-align: center; font-weight: 700; padding: 6px; margin-bottom: 10px; letter-spacing: 1px;
    }
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
      .no-print { display: none !important; }
      html, body { background: #fff; }
      .sheet {
        margin: 0; box-shadow: none; max-width: none; padding: 0;
        min-height: calc(297mm - 24mm);
      }
    }
  </style>
</head>
<body>
<main class="sheet">
  ${header.cancelled === "Y" ? `<div class="cancelled-banner">CANCELLED DOCUMENT</div>` : ""}

  <div class="company-header">
    ${logoHtml}
    <div class="company-name-block">
      <div class="company-name">${escapeHtml(header.div_name || "Company")}</div>
      <div class="company-sub">${escapeHtml(header.div_code ? `Division: ${header.div_code}` : "")}</div>
    </div>
  </div>

  <div class="report-title">DELIVERY NOTE</div>

  <div class="meta-grid">
    <div class="meta-left">
      <div class="party-name">To, ${escapeHtml(header.party_name)}</div>
      <div class="party-addr">${escapeHtml(addressBlock)}</div>
      <div class="contact-line">
        Tel : ${escapeHtml(header.party_phone)}
        &nbsp;&nbsp; Fax : ${escapeHtml(header.party_fax)}
        &nbsp;&nbsp; Mob No : ${escapeHtml(header.cust_mobile || header.dlvr_mobile)}
        &nbsp;&nbsp; Email : ${escapeHtml(header.cust_email || header.dlvr_email)}
      </div>
    </div>
    <div class="meta-right">
      <table>
        <tr><td class="lbl">DN No.</td><td class="val">: ${escapeHtml(header.doc_no)}</td></tr>
        <tr><td class="lbl">Date</td><td class="val">: ${escapeHtml(header.doc_date)}</td></tr>
        <tr><td class="lbl">A/C Code</td><td class="val">: ${escapeHtml(header.ac_code)}</td></tr>
        <tr><td class="lbl">Payment Term</td><td class="val">: ${escapeHtml(header.payment_terms)}</td></tr>
        <tr><td class="lbl">Sold By</td><td class="val">: ${escapeHtml(header.user_id)}</td></tr>
        <tr><td class="lbl">Delivery To</td><td class="val">: ${escapeHtml(header.delivery_to)}</td></tr>
      </table>
    </div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th style="width:6%">S.No.</th>
        <th style="width:42%">Product / Description</th>
        <th style="width:10%">Unit</th>
        <th style="width:10%">Qty</th>
        <th style="width:14%">Unit Rate</th>
        <th style="width:14%">Gross Value</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:16px">No line items</td></tr>`}
    </tbody>
  </table>

  <div class="totals-block">
    <div class="totals-left">
      <div class="qty-line">Total Quantity: ${fmtNumber(totalQty, 0)}</div>
      <div class="amount-words">${escapeHtml(amountInWords)}</div>
      ${header.remarks ? `<div style="margin-top:8px;color:#475569">Remarks: ${escapeHtml(header.remarks)}</div>` : ""}
    </div>
    <div class="totals-right">
      <table>
        <tr>
          <td class="lbl">Total Amount:</td>
          <td class="val">${fmtNumber(totalAmount)}</td>
        </tr>
        <tr>
          <td class="lbl">Overall Discount:</td>
          <td class="val">${fmtNumber(overallDiscount)}</td>
        </tr>
        <tr class="grand">
          <td class="lbl">Grand Total:</td>
          <td class="val">${fmtNumber(grandTotal)}</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="print-footer-block">
    <div class="sign-row">
      <div class="sign-box">Prepared By</div>
      <div class="sign-box">Checked By</div>
      <div class="sign-box">Delivered By</div>
      <div class="sign-box">Receiver's Name &amp; Signature</div>
    </div>
    <div class="footnote">Note: Goods once sold will not be taken back or exchanged</div>
    <div class="report-footer">
      <span>Print: ${escapeHtml(printDateTime)} &nbsp;|&nbsp; User: ${escapeHtml(loginId)}</span>
      <span>Report: rpt_sales_dn &nbsp;|&nbsp; Powered by Bayanat Technology</span>
    </div>
  </div>
</main>
</body>
</html>`;
}
