import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
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

// ─── Formatting helpers ───────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function dateText(value: unknown): string {
  if (!value) return "—";
  const s = String(value);
  // already formatted string like "31-12-2025"
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function numFmt(value: unknown, decimals = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format quantity cell:
 * Always show: QTY_PUOM P_UOM
 * Conditionally append: / QTY_LUOM L_UOM  (only when qty_luom != 0 and not null)
 */
function fmtQtyCell(
  qtyPuom: number, pUom: string,
  qtyLuom: number | null, lUom: string
): string {
  let s = `${numFmt(qtyPuom)} ${pUom}`.trim();
  if (qtyLuom !== null && qtyLuom !== 0 && lUom)
    s += ` , ${numFmt(qtyLuom)} ${lUom}`;
  return s;
}

// ─── Totals accumulator ───────────────────────────────────────────────────────

interface QtyTotals {
  puom: Record<string, number>;  // keyed by P_UOM
  luom: Record<string, number>;  // keyed by L_UOM (only when qty > 0)
}

function emptyTotals(): QtyTotals { return { puom: {}, luom: {} }; }

function addToTotals(t: QtyTotals, row: ReportRow): void {
  const pUom    = text(row.p_uom);
  const lUom    = text(row.l_uom);
  const qtyP    = parseFloat(String(row.qty_puom)) || 0;
  const qtyL    = parseFloat(String(row.qty_luom)) || 0;
  if (pUom) t.puom[pUom] = (t.puom[pUom] ?? 0) + qtyP;
  if (lUom && qtyL !== 0) t.luom[lUom] = (t.luom[lUom] ?? 0) + qtyL;
}

function fmtTotals(t: QtyTotals): string {
  const puomParts = Object.entries(t.puom).map(([u, v]) => `${numFmt(v)} ${u}`).join(" / ");
  const luomParts = Object.entries(t.luom).map(([u, v]) => `${numFmt(v)} ${u}`).join(" / ");
  if (!puomParts) return "—";
  return luomParts ? `${puomParts} , ${luomParts}` : puomParts;
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadDnData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT
        CUST_CODE, CUST_NAME, CUST_REF, ORDER_NO,
        VEH_TEMP, GOODS_TEMP,
        JOB_NO, DN_NO, DN_DATE,
        LOAD_START, LOAD_END,
        PROD_CODE, PROD_NAME,
        BATCH_NO, EXP_DATE_CLEAN,
        QTY_PUOM, QTY_LUOM, P_UOM, L_UOM,
        VOLUME, NET_WT
       FROM VW_BOWM_OUBDN
       WHERE JOB_NO    = :job_no
         AND PRIN_CODE = :prin_code
       ORDER BY PROD_CODE`,
      { job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  rows:        ReportRow[],
  jobNo:       string,
  prinCode:    string,
  reportTitle: string,
  loginId:     string,
  autoPrint:   boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const h = rows[0] || {};   // header fields come from first row

  // ── Totals ────────────────────────────────────────────────────────────────
  const totals   = emptyTotals();
  let   totVol   = 0;
  let   totNetWt = 0;
  for (const r of rows) {
    addToTotals(totals, r);
    totVol   += parseFloat(String(r.volume))  || 0;
    totNetWt += parseFloat(String(r.net_wt))  || 0;
  }

  // ── Table body rows ───────────────────────────────────────────────────────
  let bodyRows = "";
  for (const r of rows) {
    const qtyP   = parseFloat(String(r.qty_puom)) || 0;
    const qtyL   = r.qty_luom != null && String(r.qty_luom).trim() !== ""
                     ? parseFloat(String(r.qty_luom)) : null;
    const pUom   = text(r.p_uom);
    const lUom   = text(r.l_uom);
    const qtyStr = fmtQtyCell(qtyP, pUom, qtyL, lUom);

    bodyRows += `
      <tr class="data-row">
        <td class="td-prod"><span class="prod-code">${escapeHtml(r.prod_code || "—")}</span> ${escapeHtml(r.prod_name || "")}</td>
        <td>${escapeHtml(r.batch_no || "—")}</td>
        <td>${escapeHtml(dateText(r.exp_date_clean))}</td>
        <td class="num">${escapeHtml(qtyStr)}</td>
        <td class="num">${r.volume  != null && r.volume  !== "" ? escapeHtml(numFmt(r.volume,  3)) : "—"}</td>
        <td class="num">${r.net_wt  != null && r.net_wt  !== "" ? escapeHtml(numFmt(r.net_wt,  3)) : "—"}</td>
      </tr>`;
  }

  // ── Total row ─────────────────────────────────────────────────────────────
  const totalRow = `
    <tr class="total-row">
      <td colspan="3" class="total-label">Total</td>
      <td class="num">${escapeHtml(fmtTotals(totals))}</td>
      <td class="num">${escapeHtml(numFmt(totVol,   3))}</td>
      <td class="num">${escapeHtml(numFmt(totNetWt, 3))}</td>
    </tr>`;

  // ── Helper: render one header field ──────────────────────────────────────
  const hf = (label: string, val: unknown) => {
    const v = text(val);
    return `
      <div class="hdr-row">
        <span class="hdr-label">${label}</span>
        <span class="hdr-sep">:</span>
        <span class="hdr-value${v ? "" : " nil"}">${v ? escapeHtml(v) : ""}</span>
      </div>`;
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)} - ${escapeHtml(jobNo)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 11px; color: #111827;
      background: #eef1f6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 190mm;
      min-height: 277mm;
      margin: 0 auto;
      background: #fff;
      padding: 10mm 12mm;
      border: 1px solid #c4cdd9;
    }

    /* ── Banner ── */
    .rpt-banner {
      background: #1e3a5f; color: #fff;
      text-align: center; text-transform: uppercase;
      font-size: 13px; font-weight: 700; letter-spacing: .08em;
      padding: 9px 16px;
      border-radius: 3px 3px 0 0;
    }

    /* ── Print meta ── */
    .rpt-meta {
      display: flex; justify-content: space-between; align-items: center;
      padding: 5px 2px 5px;
      font-size: 9.5px; color: #4b5563;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 8px;
    }
    .rpt-meta strong { color: #111827; font-weight: 600; }

    /* ── Header block: two-column grid, flat label : value ── */
    .doc-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 24px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 2px solid #1e3a5f;
    }
    .hdr-col { display: flex; flex-direction: column; gap: 2px; }
    .hdr-row { display: flex; align-items: baseline; gap: 0; line-height: 1.8; }
    .hdr-label {
      font-size: 10.5px; color: #6b7280; white-space: nowrap;
      min-width: 120px;
    }
    .hdr-sep  { font-size: 10.5px; color: #9ca3af; margin-right: 6px; }
    .hdr-value {
      font-size: 11px; font-weight: 700; color: #111827;
    }
    .hdr-value.nil { font-weight: 400; color: #d1d5db; }

    /* ── Data table ── */
    table.rpt-table {
      width: 100%; border-collapse: collapse; table-layout: fixed;
    }

    col.c-prod  { width: 38%; }
    col.c-batch { width: 12%; }
    col.c-exp   { width: 12%; }
    col.c-qty   { width: 20%; }
    col.c-vol   { width: 9%;  }
    col.c-wt    { width: 9%;  }

    thead th {
      background: #1e3a5f; color: #fff;
      font-size: 10px; font-weight: 700;
      padding: 7px 10px;
      border-right: 1px solid rgba(255,255,255,0.15);
      text-align: center;
      white-space: nowrap;
    }
    thead th:first-child { text-align: left; }
    thead th:last-child  { border-right: none; }

    tbody tr.data-row td {
      padding: 5px 10px;
      border-bottom: 1px solid #e5e7eb;
      color: #374151;
      font-size: 11px;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    tbody tr.data-row:nth-child(even) td { background: #f9fafb; }
    .td-prod { line-height: 1.5; }
    .prod-code { font-weight: 700; color: #1e3a5f; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }

    tr.total-row td {
      background: #1e3a5f; color: #fff;
      font-weight: 700; font-size: 11px;
      padding: 7px 10px;
      border-top: 2px solid #162d4a;
    }
    tr.total-row .total-label {
      text-align: right; letter-spacing: .04em;
    }
    tr.total-row td.num { text-align: right; }

    /* ── Signature block ── */
    .sig-block {
      margin-top: 14px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 24px;
    }
    .sig-col  { display: flex; flex-direction: column; gap: 10px; }
    .sig-line { display: flex; align-items: flex-end; gap: 8px; font-size: 10.5px; color: #374151; line-height: 1.8; }
    .sig-label { white-space: nowrap; min-width: 120px; }
    .sig-dots  { flex: 1; border-bottom: 1px dotted #9ca3af; margin-bottom: 2px; min-width: 40px; }

    /* ── Legal notice ── */
    .legal-notice {
      margin-top: 14px;
      padding: 7px 10px;
      border: 1px solid #e2e8f0;
      background: #f9fafb;
      font-size: 9.5px;
      font-style: italic;
      color: #6b7280;
      text-align: center;
      line-height: 1.6;
    }

    /* ── Footer ── */
    .rpt-footer {
      margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px;
      display: flex; justify-content: space-between;
      font-size: 9px; color: #9ca3af;
    }
    .rpt-footer code { font-family: "Courier New", monospace; font-size: 9px; color: #6b7280; }

    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; }
      thead { display: table-header-group; }
      tr.total-row { break-before: avoid; page-break-before: avoid; }
      .sig-block   { break-before: avoid; page-break-before: avoid; }
      .legal-notice{ break-before: avoid; page-break-before: avoid; }
    }
  </style>
</head>
<body>
<main class="sheet">

  <!-- ── Banner ── -->
  <div class="rpt-banner">${escapeHtml(reportTitle)}</div>

  <!-- ── Print meta ── -->
  <div class="rpt-meta">
    <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;Print User :&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
    <span>Page 1 of 1</span>
  </div>

  <!-- ── Document header (flat label : value, no box) ── -->
  <div class="doc-header">

    <div class="hdr-col">
      ${hf("Customer Code",  h.cust_code)}
      ${hf("Customer Name",  h.cust_name)}
      ${hf("Customer Ref",   h.cust_ref)}
      ${hf("Order No",       h.order_no)}
      ${hf("Truck Temp",     h.veh_temp)}
      ${hf("Goods Temp",     h.goods_temp)}
    </div>

    <div class="hdr-col">
      ${hf("Job No",         h.job_no   || jobNo)}
      ${hf("DN No",          h.dn_no  || "" )}
      ${hf("DN Date",        dateText(h.dn_date))}
      ${hf("Shift",          "")}
      ${hf("Load Start",     h.load_start)}
      ${hf("Load End",       h.load_end)}
    </div>

  </div><!-- /doc-header -->

  <!-- ── Line items table ── -->
  <table class="rpt-table">
    <colgroup>
      <col class="c-prod"/> <col class="c-batch"/>
      <col class="c-exp"/>  <col class="c-qty"/>
      <col class="c-vol"/>  <col class="c-wt"/>
    </colgroup>
    <thead>
      <tr>
        <th>Product</th>
        <th>Batch No</th>
        <th>Exp Date</th>
        <th>Quantity</th>
        <th>Volume</th>
        <th>Weight</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      ${totalRow}
    </tbody>
  </table>

  <!-- ── Signature block ── -->
  <div class="sig-block">
    <div class="sig-col">
      <div class="sig-line"><span class="sig-label">DN Issued By (Name &amp; Signature)</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
      <div class="sig-line"><span class="sig-label">Vehicle Number</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
      <div class="sig-line"><span class="sig-label">Picking By</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
      <div class="sig-line"><span class="sig-label">Supervisor Sign</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
    </div>
    <div class="sig-col">
      <div class="sig-line"><span class="sig-label">Driver (Name &amp; Signature)</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
      <div class="sig-line"><span class="sig-label">Driver ID</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
      <div class="sig-line"><span class="sig-label">Loading By</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
      <div class="sig-line"><span class="sig-label">Team Leader Sign</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
    </div>
  </div>

  <!-- ── Legal notice ── -->
  <div class="legal-notice">
    THE PRODUCTS MENTIONED IN THIS DELIVERY NOTE HAS BEEN RECEIVED IN GOOD CONDITION AND AS PER DETAILS MENTIONED ABOVE
  </div>

  <!-- ── Footer ── -->
  <div class="rpt-footer">
    <span>Report Name : <code>${escapeHtml(jobNo)}</code></span>
    <span>Powered by Bayanat Technology</span>
  </div>

</main>
<script>
  window.addEventListener("message", (e) => {
    if (e.data === "print") window.print();
  });
  ${autoPrint ? `window.addEventListener("load", () => setTimeout(() => window.print(), 300));` : ""}
</script>
</body>
</html>`;
}

// ─── Excel builder ────────────────────────────────────────────────────────────

const STYLE_ID = {
  default:      0,
  header:       1,   // dark blue bg, white bold – title / col headers
  hdrLeft:      2,   // dark blue bg, white bold – left-aligned col header
  label:        3,   // grey text, right-align
  value:        4,   // dark bold
  dataCell:     5,   // normal data cell with thin border
  numCell:      6,   // right-aligned data cell
  totalLabel:   7,   // dark blue bg, white, right-aligned
  totalNum:     8,   // dark blue bg, white, right-aligned, numeric
  sectionMeta:  9,   // light grey bg for doc-info rows
} as const;

type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(
  rows:     ReportRow[],
  jobNo:    string,
  prinCode: string
): Buffer {
  const NCOLS = 6;
  type Row    = (XlCell | null)[];
  const skip  = null;
  const xlRows: Row[] = [];

  const h = rows[0] || {};

  // ── Title ────────────────────────────────────────────────────────────────
  xlRows.push([xc(`Delivery Note — Job ${jobNo} / Principal ${prinCode}`, "header"), ...Array(NCOLS - 1).fill(skip)]);
  xlRows.push(Array(NCOLS).fill(skip));

  // ── Doc-info block: two logical columns, each label+value pair ───────────
  const metaRows: [string, unknown, string, unknown][] = [
    ["Customer Code", h.cust_code,  "Job No",      h.job_no    || jobNo],
    ["Customer Name", h.cust_name,  "DN No",       h.dn_no],
    ["Customer Ref",  h.cust_ref,   "DN Date",     dateText(h.dn_date)],
    ["Order No",      h.order_no,   "Shift",       ""],
    ["Truck Temp",    h.veh_temp,   "Load Start",  h.load_start],
    ["Goods Temp",    h.goods_temp, "Load End",    h.load_end],
  ];

  // Each doc-info row uses columns A(label) B(value) | D(label) E(value); C & F blank
  for (const [lbl1, val1, lbl2, val2] of metaRows) {
    xlRows.push([
      xc(lbl1,          "label"),
      xc(text(val1),    "value"),
      skip,
      xc(lbl2,          "label"),
      xc(text(val2),    "value"),
      skip,
    ]);
  }

  xlRows.push(Array(NCOLS).fill(skip));

  // ── Column headers ────────────────────────────────────────────────────────
  xlRows.push([
    xc("Product",   "hdrLeft"),
    xc("Batch No",  "header"),
    xc("Exp Date",  "header"),
    xc("Quantity",  "header"),
    xc("Volume",    "header"),
    xc("Weight",    "header"),
  ]);

  // ── Data rows ─────────────────────────────────────────────────────────────
  const totals   = emptyTotals();
  let   totVol   = 0;
  let   totNetWt = 0;

  for (const r of rows) {
    const qtyP   = parseFloat(String(r.qty_puom)) || 0;
    const qtyL   = r.qty_luom != null && String(r.qty_luom).trim() !== ""
                     ? parseFloat(String(r.qty_luom)) : null;
    const pUom   = text(r.p_uom);
    const lUom   = text(r.l_uom);
    const qtyStr = fmtQtyCell(qtyP, pUom, qtyL, lUom);
    const vol    = parseFloat(String(r.volume))  || 0;
    const netWt  = parseFloat(String(r.net_wt))  || 0;

    addToTotals(totals, r);
    totVol   += vol;
    totNetWt += netWt;

    xlRows.push([
      xc(`${text(r.prod_code)} ${text(r.prod_name)}`.trim(), "dataCell"),
      xc(text(r.batch_no) || "—",                            "dataCell"),
      xc(dateText(r.exp_date_clean),                         "dataCell"),
      xc(qtyStr,                                             "numCell"),
      xc(vol   !== 0 ? numFmt(vol,   3) : "—",              "numCell"),
      xc(netWt  !== 0 ? numFmt(netWt, 3) : "—",             "numCell"),
    ]);
  }

  // ── Total row ─────────────────────────────────────────────────────────────
  xlRows.push([
    xc("Total", "totalLabel"),
    skip,
    skip,
    xc(fmtTotals(totals),    "totalNum"),
    xc(numFmt(totVol,   3),  "totalNum"),
    xc(numFmt(totNetWt, 3),  "totalNum"),
  ]);

  // ── Build XML ─────────────────────────────────────────────────────────────
  const COL_WIDTHS = [42, 16, 14, 28, 12, 12];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // Detect spans (consecutive nulls after a non-null cell)
  const merges: string[] = [];
  xlRows.forEach((row, ri) => {
    const rn = ri + 1;
    let i = 0;
    while (i < row.length) {
      if (row[i] !== null) {
        let j = i + 1;
        while (j < row.length && row[j] === null) j++;
        if (j - 1 > i)
          merges.push(`${colLetter(i)}${rn}:${colLetter(j - 1)}${rn}`);
        i = j;
      } else {
        i++;
      }
    }
  });

  let sheetDataXml = "";
  xlRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="22" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${colLetter(ci)}${rn}`;
      if (typeof cell.v === "number")
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      else
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
    });
    rowXml += `</row>`;
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergeXml}
</worksheet>`;

  // ── Styles ────────────────────────────────────────────────────────────────
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="medium"><color rgb="FF1E3A5F"/></left>
      <right style="medium"><color rgb="FF1E3A5F"/></right>
      <top style="medium"><color rgb="FF1E3A5F"/></top>
      <bottom style="medium"><color rgb="FF1E3A5F"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: header – dark bg, white bold, centre -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2: hdrLeft – dark bg, white bold, left -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center"/>
    </xf>
    <!-- 3: label – grey text, right-align -->
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 4: value – dark bold -->
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center"/>
    </xf>
    <!-- 5: dataCell – normal with border -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <!-- 6: numCell – right-aligned with border -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="top" wrapText="1"/>
    </xf>
    <!-- 7: totalLabel – dark bg, white, right-aligned -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 8: totalNum – dark bg, white, right-aligned -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center" wrapText="1"/>
    </xf>
    <!-- 9: sectionMeta – light grey bg -->
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Delivery Note" sheetId="1" r:id="rId1"/></sheets>
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
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml",        Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                Buffer.from(rels));
  zip.addFile("xl/workbook.xml",            Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml",   Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml",              Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Column-letter helper ─────────────────────────────────────────────────────

function colLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export const getDnReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no   || req.query.job_no);
    const prinCode    = text(req.params.prin_code || req.query.prin_code);
    const reportTitle = text(req.query.title)     || "Delivery Note";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows = await loadDnData(req, jobNo, prinCode);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(rows, jobNo, prinCode, reportTitle, text(req.user?.loginid), autoPrint));
  } catch (error: any) {
    console.error("DN HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getDnReportPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no   || req.query.job_no);
    const prinCode = text(req.params.prin_code || req.query.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows = await loadDnData(req, jobNo, prinCode);
    const html = renderHtml(rows, jobNo, prinCode, "Delivery Note", text(req.user?.loginid), true);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="DN_${jobNo}_${prinCode}.pdf"`);
    res.send(html);
  } catch (error: any) {
    console.error("DN PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const getDnReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no   || req.query.job_no);
    const prinCode = text(req.params.prin_code || req.query.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadDnData(req, jobNo, prinCode);
    const buffer = buildExcelBuffer(rows, jobNo, prinCode);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="DN_${jobNo}_${prinCode}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("DN Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};