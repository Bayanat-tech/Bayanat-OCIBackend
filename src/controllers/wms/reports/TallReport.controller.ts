import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ProductGroup {
  prodCode:    string;
  prodName:    string;
  rows:        ReportRow[];
  palletCount: number;
  asnTotal:    number;
  tallyTotal:  number;
}

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
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
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

/** Quantities in this report are plain integers (no UOM split like the GRN report). */
function qtyFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function toNum(value: unknown): number {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadTallyData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT
        JOB_NO, JOB_DATE, PRIN_CODE, PRIN_NAME, DEPT_CODE, DOC_REF, PRIN_REF1,
        PROD_CODE, PROD_NAME, PALLET_ID, BATCH_NO, LOT_NO,
        PROD_MFG_DATE, PROD_EXP_DATE, ASN_QTY, TALLY_QTY
       FROM VW_BOWM_TALLYTXN
       WHERE JOB_NO    = :job_no
         AND PRIN_CODE = :prin_code
       ORDER BY PROD_CODE, PALLET_ID`,
      { job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

function groupRows(rows: ReportRow[]): ProductGroup[] {
  const map: Record<string, ProductGroup> = {};

  for (const r of rows) {
    const prodKey = text(r.prod_code) || "N/A";

    if (!map[prodKey])
      map[prodKey] = {
        prodCode:    text(r.prod_code),
        prodName:    text(r.prod_name),
        rows:        [],
        palletCount: 0,
        asnTotal:    0,
        tallyTotal:  0,
      };

    const pg = map[prodKey];
    pg.rows.push(r);
    pg.palletCount += 1;
    pg.asnTotal   += toNum(r.asn_qty);
    pg.tallyTotal += toNum(r.tally_qty);
  }

  return Object.values(map);
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  groups:      ProductGroup[],
  firstRow:    ReportRow | null,
  jobNo:       string,
  prinCode:    string,
  reportTitle: string,
  loginId:     string,
  autoPrint:   boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const r = firstRow || {};

  // ── Grand totals ───────────────────────────────────────────────────────────
  let grandPalletCount = 0, grandAsn = 0, grandTally = 0;
  for (const pg of groups) {
    grandPalletCount += pg.palletCount;
    grandAsn         += pg.asnTotal;
    grandTally       += pg.tallyTotal;
  }

  // ── Build body rows ────────────────────────────────────────────────────────
  let bodyRows = "";

  for (const pg of groups) {
    bodyRows += `
      <tr class="prod-row">
        <td colspan="8">${escapeHtml(pg.prodCode)} | ${escapeHtml(pg.prodName)}</td>
      </tr>`;

    for (const dr of pg.rows) {
      bodyRows += `
        <tr class="data-row">
          <td></td>
          <td>${escapeHtml(dr.pallet_id || "—")}</td>
          <td>${escapeHtml(dr.batch_no  || "—")}</td>
          <td>${escapeHtml(dr.lot_no    || "—")}</td>
          <td>${escapeHtml(dateText(dr.prod_mfg_date))}</td>
          <td>${escapeHtml(dateText(dr.prod_exp_date))}</td>
          <td class="num">${escapeHtml(qtyFmt(dr.asn_qty))}</td>
          <td class="num">${escapeHtml(qtyFmt(dr.tally_qty))}</td>
        </tr>`;
    }

    // Sub Total row — colspan 5 (Product..Mfg Date), count under Exp Date col,
    // sums under ASN Qty / Tally Qty cols (matches reference layout)
    bodyRows += `
      <tr class="sub-total">
        <td colspan="5">Sub Total :</td>
        <td class="num">${escapeHtml(qtyFmt(pg.palletCount))}</td>
        <td class="num">${escapeHtml(qtyFmt(pg.asnTotal))}</td>
        <td class="num">${escapeHtml(qtyFmt(pg.tallyTotal))}</td>
      </tr>`;
  }

  // Grand total row
  const grandRow = `
    <tr class="grand-total">
      <td colspan="5">Total :</td>
      <td class="num">${escapeHtml(qtyFmt(grandPalletCount))}</td>
      <td class="num">${escapeHtml(qtyFmt(grandAsn))}</td>
      <td class="num">${escapeHtml(qtyFmt(grandTally))}</td>
    </tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)} - ${escapeHtml(jobNo)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 12px; color: #111827;
      background: #eef1f6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 277mm;
      min-height: 190mm;
      margin: 0 auto; background: #fff;
      padding: 10mm 12mm;
      border: 1px solid #c4cdd9;
    }

    /* ── Report header banner ── */
    .rpt-header {
      background: #1e3a5f; color: #fff; text-align: center;
      font-size: 14px; font-weight: 700; letter-spacing: .08em;
      padding: 10px 16px; text-transform: uppercase;
      border-radius: 3px 3px 0 0;
    }
    .rpt-meta {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 2px 6px;
      font-size: 10px; color: #4b5563;
    }
    .rpt-meta strong { color: #111827; font-weight: 600; }

    /* ── Job header block (flat label : value, no box) ── */
    .job-header {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0 16px;
      margin-bottom: 10px;
      padding: 8px 0 10px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 11px;
    }
    .job-col { display: flex; flex-direction: column; gap: 3px; }
    .job-row { display: flex; align-items: baseline; gap: 6px; line-height: 1.6; }
    .job-label {
      font-size: 10.5px;
      color: #6b7280;
      white-space: nowrap;
    }
    .job-label::after { content: ":"; }
    .job-value {
      font-size: 11px;
      font-weight: 700;
      color: #111827;
    }
    .job-value.nil { font-weight: 400; color: #9ca3af; }

    /* ── Data table ── */
    table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }

    col.c0 { width: 26%; } col.c1 { width: 12%; } col.c2 { width: 13%; }
    col.c3 { width: 13%; } col.c4 { width: 11%; } col.c5 { width: 11%; }
    col.c6 { width: 7%;  } col.c7 { width: 7%;  }

    thead tr.th-sub th {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 10px; padding: 6px 10px; text-align: left;
      border-right: 1px solid rgba(255,255,255,0.15);
      white-space: nowrap;
    }
    thead tr.th-sub th.num { text-align: right; }
    thead tr.th-sub th:last-child { border-right: none; }

    tr.prod-row td {
      background: #e8ecf2; color: #1e3a5f; font-weight: 700;
      font-size: 11px; padding: 5px 10px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-bottom: 1px solid #d5dce8;
    }

    tbody tr.data-row td {
      padding: 4px 10px; border-bottom: 1px solid #e5e7eb;
      color: #374151; font-size: 11px;
      white-space: normal; word-wrap: break-word; overflow-wrap: break-word;
      vertical-align: top;
    }
    tbody tr.data-row:nth-child(even) td { background: #f9fafb; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

    tr.sub-total td {
      background: #d5dce8; padding: 5px 10px; font-size: 11px;
      font-weight: 700; color: #1e3a5f; white-space: nowrap;
    }
    tr.sub-total td:first-child { text-align: right; }

    tr.grand-total td {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 12px; padding: 8px 10px;
      border-top: 2px solid #162d4a;
    }
    tr.grand-total td:first-child { text-align: right; }

    /* ── Footer ── */
    .rpt-footer {
      margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px;
      display: flex; justify-content: space-between;
      font-size: 9px; color: #9ca3af;
    }
    .rpt-footer code {
      font-family: "Courier New", monospace; font-size: 9px; color: #6b7280;
    }

    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; }
      thead { display: table-header-group; }

      tr.prod-row {
        break-after: avoid;
        page-break-after: avoid;
      }
      tr.sub-total,
      tr.grand-total {
        break-before: avoid;
        page-break-before: avoid;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">

    <!-- ── Report title banner ── -->
    <div class="rpt-header">${escapeHtml(reportTitle)}</div>

    <!-- ── Print meta row ── -->
    <div class="rpt-meta">
      <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;Print User :&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
      <span>Page 1 of 1</span>
    </div>

    <!-- ── Job header block (flat, no box) ── -->
    <div class="job-header">

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Job No</span>
          <span class="job-value">${escapeHtml(text(r.job_no) || jobNo)}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Job Date</span>
          <span class="job-value${r.job_date ? "" : " nil"}">${r.job_date ? dateText(r.job_date) : "&nbsp;"}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Principal</span>
          <span class="job-value">${escapeHtml(text(r.prin_code) || prinCode)}${r.prin_name ? ` | ${escapeHtml(text(r.prin_name))}` : ""}</span>
        </div>
      </div>

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Department</span>
          <span class="job-value${r.dept_code ? "" : " nil"}">${r.dept_code ? escapeHtml(text(r.dept_code)) : "&nbsp;"}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Document Ref</span>
          <span class="job-value${r.doc_ref ? "" : " nil"}">${r.doc_ref ? escapeHtml(text(r.doc_ref)) : "&nbsp;"}</span>
        </div>
      </div>

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Principal Reference</span>
          <span class="job-value${r.prin_ref1 ? "" : " nil"}">${r.prin_ref1 ? escapeHtml(text(r.prin_ref1)) : "&nbsp;"}</span>
        </div>
      </div>

    </div><!-- /job-header -->

    <!-- ── Data table ── -->
    <table class="rpt-table">
      <colgroup>
        <col class="c0"/><col class="c1"/><col class="c2"/>
        <col class="c3"/><col class="c4"/><col class="c5"/>
        <col class="c6"/><col class="c7"/>
      </colgroup>
      <thead>
        <tr class="th-sub">
          <th>Product</th>
          <th>Pallet Id</th>
          <th>Batch No</th>
          <th>Lot No</th>
          <th>Mfg Date</th>
          <th>Exp Date</th>
          <th class="num">ASN Qty</th>
          <th class="num">Tally Qty</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        ${grandRow}
      </tbody>
    </table>

    <!-- ── Page footer ── -->
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

// ─── Excel builder ─────────────────────────────────────────────────────────────

const STYLE_ID = {
  default:      0,
  header:       1,
  sectionProd:  2,
  value:        3,
  numValue:     4,
  subTotal:     5,
  numSubTotal:  6,
  grandTotal:   7,
  numGrand:     8,
} as const;

type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(groups: ProductGroup[], jobNo: string, prinCode: string): Buffer {
  const NCOLS = 8;
  type Row = (XlCell | null)[];
  const skip = null;
  const rows: Row[] = [];

  // Title
  rows.push([xc(`Inbound Tally Report — Job ${jobNo} / ${prinCode}`, "header"), ...Array(NCOLS - 1).fill(skip)]);
  rows.push(Array(NCOLS).fill(skip));

  // Column headers
  rows.push([
    xc("Product",   "header"),
    xc("Pallet Id", "header"),
    xc("Batch No",  "header"),
    xc("Lot No",    "header"),
    xc("Mfg Date",  "header"),
    xc("Exp Date",  "header"),
    xc("ASN Qty",   "header"),
    xc("Tally Qty", "header"),
  ]);

  let grandPalletCount = 0, grandAsn = 0, grandTally = 0;

  for (const pg of groups) {
    rows.push([xc(`${pg.prodCode} | ${pg.prodName}`, "sectionProd"), ...Array(NCOLS - 1).fill(skip)]);

    for (const dr of pg.rows) {
      rows.push([
        xc("",                          "value"),
        xc(text(dr.pallet_id) || "—",  "value"),
        xc(text(dr.batch_no)  || "—",  "value"),
        xc(text(dr.lot_no)    || "—",  "value"),
        xc(dateText(dr.prod_mfg_date),       "value"),
        xc(dateText(dr.prod_exp_date),       "value"),
        xc(toNum(dr.asn_qty),            "numValue"),
        xc(toNum(dr.tally_qty),          "numValue"),
      ]);
    }

    rows.push([
      xc("Sub Total :", "subTotal"),
      skip, skip, skip, skip,
      xc(pg.palletCount, "numSubTotal"),
      xc(pg.asnTotal,    "numSubTotal"),
      xc(pg.tallyTotal,  "numSubTotal"),
    ]);

    grandPalletCount += pg.palletCount;
    grandAsn         += pg.asnTotal;
    grandTally       += pg.tallyTotal;
  }

  // Grand total
  rows.push([
    xc("Total :", "grandTotal"),
    skip, skip, skip, skip,
    xc(grandPalletCount, "numGrand"),
    xc(grandAsn,         "numGrand"),
    xc(grandTally,       "numGrand"),
  ]);

  const COL_WIDTHS = [30, 14, 16, 16, 12, 12, 12, 12];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // Merge ranges (for label cells spanning multiple columns, marked by trailing nulls)
  const merges: string[] = [];
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let spanStart = -1;
    row.forEach((cell, ci) => {
      if (cell !== null && spanStart === -1) {
        spanStart = ci;
      } else if (cell === null && spanStart !== -1) {
        let end = ci;
        while (end + 1 < row.length && row[end + 1] === null) end++;
        if (end > spanStart)
          merges.push(`${String.fromCharCode(65 + spanStart)}${rn}:${String.fromCharCode(65 + end)}${rn}`);
        spanStart = -1;
      } else if (cell !== null) {
        spanStart = ci;
      }
    });
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="22" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${String.fromCharCode(65 + ci)}${rn}`;
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

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0"/>
  </numFmts>
  <fonts count="5">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD5DCE8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0"   fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0"   fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0"   fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0"   fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0"   fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Tally Detail" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Route handlers ───────────────────────────────────────────────────────────

export const getTallyReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title)    || "Inbound Tally Report";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadTallyData(req, jobNo, prinCode);
    const groups = groupRows(rows);
    const first  = rows[0] ?? null;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(groups, first, jobNo, prinCode, reportTitle, text(req.user?.loginid), autoPrint));
  } catch (error: any) {
    console.error("Tally HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getTallyReportPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no  || req.query.job_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows        = await loadTallyData(req, jobNo, prinCode);
    const groups      = groupRows(rows);
    const first       = rows[0] ?? null;
    const reportTitle = "Inbound Tally Report";
    const html = renderHtml(groups, first, jobNo, prinCode, reportTitle, text(req.user?.loginid), true);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="Tally_${jobNo}.pdf"`);
    res.send(html);
  } catch (error: any) {
    console.error("Tally PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const getTallyReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no  || req.query.job_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadTallyData(req, jobNo, prinCode);
    const groups = groupRows(rows);
    const buffer = buildExcelBuffer(groups, jobNo, prinCode);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Tally_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Tally Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};