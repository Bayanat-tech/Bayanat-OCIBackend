import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  buildReportDocument,
  reportAppliedFilters,
  reportFooter,
  reportHeader,
} from "../../common/report_common";

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
  if (!value) return "\u2014";
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
  if (!Number.isFinite(n)) return "\u2014";
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

// ─── Table columns (single header row; ONE alignment per column) ─────────────

type ColAlign = "left" | "center" | "right";

interface TallyColumn { label: string; align: ColAlign; width: number } // width in %, sums to 100

const TALLY_COLUMNS: TallyColumn[] = [
  { label: "Product",   align: "left",   width: 22 },
  { label: "Pallet Id", align: "left",   width: 13 },
  { label: "Batch No",  align: "left",   width: 13 },
  { label: "Lot No",    align: "left",   width: 12 },
  { label: "Mfg Date",  align: "center", width: 11 },
  { label: "Exp Date",  align: "center", width: 11 },
  { label: "ASN Qty",   align: "right",  width: 9  },
  { label: "Tally Qty", align: "right",  width: 9  },
];

const COL_COUNT  = TALLY_COLUMNS.length; // 8
const LABEL_SPAN = 5;                    // total-row label spans everything before the pallet count

// ─── Layout CSS – same look as the Quotation List PDF ────────────────────────
// Used together with fontMode: "native", so the sizes below are the real sizes.
// Letterhead / footer come from report_common; this only styles the body.
// NOTE: row selectors include "tbody" so they out-rank the zebra rule
// (tbody tr:nth-child(even) td) in report_common.

const TALLY_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 12mm 12mm 12mm; }

  /* Make Chrome print background colors */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Letterhead – same as Enquiry List */
  .company-name       { font-size: 18px; font-weight: 700; }
  .company-address    { font-size: 11px; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  /* Title + filter strip */
  h1.report-title {
    margin: 28px 0 14px 0;
    font-size: 20px;
    font-weight: 700;
    color: #00378c;
  }
  .applied-filters { font-size: 10px; margin-bottom: 28px; }

  table.data-table {
    width: 100%;
    table-layout: fixed;
    font-size: 10.5px;
    margin-top: 0;
    border-collapse: collapse;
  }
  table.data-table th,
  table.data-table td {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  /* Header: solid blue bar, white bold text */
  table.data-table thead tr th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 12px 8px;
    border: 0;
    text-transform: none;
  }

  /* Section banners: Principal / Group / Product */
  table.data-table tbody tr.group-header-row td { font-weight: 700; color: #00378c; text-align: left; }
  table.data-table tbody tr.prin-row  td { background: #eaf0f8; font-size: 13px; font-weight: 700; padding: 11px 8px; }
  table.data-table tbody tr.group-row td { background: #f4f7fc; font-size: 10.5px; padding: 7px 8px 7px 16px; }
  table.data-table tbody tr.prod-row  td { background: #fafbfd; font-size: 10.5px; padding: 7px 8px 7px 28px; color: #334155; }

  /* Data rows */
  table.data-table tbody tr.data-row td {
    background: #fafcfe;
    padding: 9px 8px;
    border-bottom: 1px solid #e2e8f0;
    color: #1e293b;
  }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }

  /* Totals */
  table.data-table tbody tr.subtotal-row td {
    background: #e2e8f0; color: #00378c; font-weight: 700; padding: 8px 8px;
  }
  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0; color: #00378c; font-weight: 700; padding: 9px 8px;
    border-bottom: 1px solid #cbd5e1;
  }

  @media print {
    body::before { display: none !important; }
    table.data-table thead { display: table-header-group; }
    table.data-table tr { break-inside: avoid; page-break-inside: avoid; }
    table.data-table tr.group-header-row { break-after: avoid; page-break-after: avoid; }
    table.data-table tr.subtotal-row,
    table.data-table tr.grand-total-row  { break-before: avoid; page-break-before: avoid; }
  }
`;
// Lets the React parent page trigger printing through postMessage.
const PRINT_LISTENER_SCRIPT = `
  <script>
    window.addEventListener("message", function (e) {
      if (e.data === "print") window.print();
    });
  </script>`;

// ─── HTML body renderer ───────────────────────────────────────────────────────

function renderBodyHtml(
  groups:      ProductGroup[],
  firstRow:    ReportRow | null,
  jobNo:       string,
  prinCode:    string,
  reportTitle: string
): string {
  const r = firstRow || {};

  let grandPalletCount = 0, grandAsn = 0, grandTally = 0;
  for (const pg of groups) {
    grandPalletCount += pg.palletCount;
    grandAsn         += pg.asnTotal;
    grandTally       += pg.tallyTotal;
  }

  const jobNoText    = text(r.job_no) || jobNo;
  const prinCodeText = text(r.prin_code) || prinCode;
  const prinText     = prinCodeText + (r.prin_name ? " - " + text(r.prin_name) : "");

  const field = (label: string, value: unknown) =>
    `<div class="field"><span class="label">${escapeHtml(label)}</span> <span class="value">${escapeHtml(text(value) || "\u2014")}</span></div>`;

  const emptyField = `<div class="field field--empty"><span class="label"></span><span class="value"></span></div>`;
  const col = (items: string[], n: number) =>
    items.concat(Array(Math.max(0, n - items.length)).fill(emptyField)).join("");

  const filtersHtml = reportAppliedFilters([
    { label: "Job No",    value: jobNoText },
    { label: "Principal", value: prinCodeText },
    { label: "Job Date",  value: dateText(r.job_date) },
  ]);

  const infoLeft = [
    field("Job No",    jobNoText),
    field("Job Date",  dateText(r.job_date)),
    field("Principal", prinText),
  ];
  const infoMid = [
    field("Department",   r.dept_code),
    field("Document Ref", r.doc_ref),
  ];
  const infoRight = [
    field("Prin. Reference", r.prin_ref1),
  ];

  const C = TALLY_COLUMNS;

  // total row: label spans the first 5 cols, then pallet count / ASN qty / Tally qty
  const totalRow = (cls: string, label: string, pallets: number, asn: number, tally: number) =>
    `<tr class="${cls}">` +
    `<td class="right" colspan="${LABEL_SPAN}">${label}</td>` +
    `<td class="right num">${escapeHtml(qtyFmt(pallets))}</td>` +
    `<td class="right num">${escapeHtml(qtyFmt(asn))}</td>` +
    `<td class="right num">${escapeHtml(qtyFmt(tally))}</td>` +
    `</tr>`;

  let bodyRows = "";

  for (const pg of groups) {
    const prodLabel = `${escapeHtml(pg.prodCode)}${pg.prodName ? " - " + escapeHtml(pg.prodName) : ""}`;
    bodyRows += `<tr class="group-header-row"><td colspan="${COL_COUNT}">${prodLabel}</td></tr>`;

    for (const dr of pg.rows) {
      bodyRows +=
        `<tr class="data-row">` +
        `<td class="${C[0].align}">${escapeHtml(pg.prodCode || "\u2014")}</td>` +
        `<td class="${C[1].align}">${escapeHtml(dr.pallet_id || "\u2014")}</td>` +
        `<td class="${C[2].align}">${escapeHtml(dr.batch_no || "\u2014")}</td>` +
        `<td class="${C[3].align}">${escapeHtml(dr.lot_no || "\u2014")}</td>` +
        `<td class="${C[4].align}">${escapeHtml(dateText(dr.prod_mfg_date))}</td>` +
        `<td class="${C[5].align}">${escapeHtml(dateText(dr.prod_exp_date))}</td>` +
        `<td class="${C[6].align} num">${escapeHtml(qtyFmt(dr.asn_qty))}</td>` +
        `<td class="${C[7].align} num">${escapeHtml(qtyFmt(dr.tally_qty))}</td>` +
        `</tr>`;
    }

    bodyRows += totalRow("subtotal-row", `Sub Total (${escapeHtml(pg.prodCode)}) &mdash; Pallets / ASN Qty / Tally Qty:`, pg.palletCount, pg.asnTotal, pg.tallyTotal);
  }

  bodyRows += totalRow(
    "grand-total-row",
    `GRAND TOTAL (${grandPalletCount} Records) &mdash; Pallets / ASN Qty / Tally Qty:`,
    grandPalletCount, grandAsn, grandTally
  );

  const colgroup    = C.map((c) => `<col style="width:${c.width}%" />`).join("");
  const headerCells = C.map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`).join("");

  return `
    <h1 class="report-title">${escapeHtml(reportTitle)}</h1>
    ${filtersHtml}

    <div class="info-grid">
      <div>${col(infoLeft, 3)}</div>
      <div>${col(infoMid, 3)}</div>
      <div>${col(infoRight, 3)}</div>
    </div>

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    ${PRINT_LISTENER_SCRIPT}
  `;
}

async function renderHtml(
  req: RequestWithUser,
  groups: ProductGroup[],
  firstRow: ReportRow | null,
  jobNo: string,
  prinCode: string,
  reportTitle: string,
  loginId: string,
  autoPrint: boolean
): Promise<string> {
  const headerHtml = await reportHeader({ company_code: text(req.user?.company_code), req });
  const bodyHtml   = renderBodyHtml(groups, firstRow, jobNo, prinCode, reportTitle);
  const footerHtml = reportFooter({
    reportName: "rpt_tally_report",
    userName:   loginId,
    endLabel:   "Powered by Bayanat Technology",
  });

  return buildReportDocument({
    title: `${reportTitle} - ${jobNo}`,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: TALLY_EXTRA_CSS,
    autoPrint,
    showPrintButton: true,
    fontMode: "native",
  });
}

// ─── Excel builder ────────────────────────────────────────────────────────────
// Same palette / Arial font as the DN Summary Excel.
// STYLE_ID values must stay in sync with <cellXfs> order in stylesXml below.

const STYLE_ID = {
  default:       0,
  header:        1,   // white on #00378c, centered
  title:         2,   // blue bold 14, no fill
  meta:          3,   // grey on #f8fafc
  secProduct:    4,   // blue bold on #eaf0f8
  data:          5,   // left, light bottom border
  dataCenter:    6,   // centered, light bottom border
  dataNum:       7,   // right, #,##0
  subTotal:      8,   // #f1f5f9, blue bold, right
  subTotalNum:   9,   // same + #,##0
  grandTotal:   10,   // #e2e8f0, blue bold, right
  grandTotalNum:11,   // same + #,##0
  footer:       12,   // italic grey, right
} as const;

type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(
  groups: ProductGroup[],
  firstRow: ReportRow | null,
  jobNo: string,
  prinCode: string,
  reportTitle: string
): Buffer {
  const NCOLS = COL_COUNT;
  type Row = (XlCell | null)[];
  const skip = null;
  const r    = firstRow || {};
  const rows: Row[] = [];

  const spanRow = (label: string, style: StyleKey) => {
    const row: Row = Array(NCOLS).fill(skip);
    row[0] = xc(label, style);
    rows.push(row);
  };

  // total row: label merged across first 5 cols, then pallet count / ASN qty / Tally qty
  const totalRow = (label: string, pallets: number, asn: number, tally: number, lvl: "subTotal" | "grandTotal") => {
    const row: Row = Array(NCOLS).fill(skip);
    row[0] = xc(label, lvl);
    row[5] = xc(pallets, `${lvl}Num` as StyleKey);
    row[6] = xc(asn,     `${lvl}Num` as StyleKey);
    row[7] = xc(tally,   `${lvl}Num` as StyleKey);
    rows.push(row);
  };

  spanRow(reportTitle, "title");
  spanRow(
    `Applied Filters: Job No: ${text(r.job_no) || jobNo} | Principal: ${text(r.prin_code) || prinCode} | Job Date: ${dateText(r.job_date)}`,
    "meta"
  );

  rows.push(TALLY_COLUMNS.map((c) => xc(c.label, "header")));

  let grandPalletCount = 0, grandAsn = 0, grandTally = 0;

  for (const pg of groups) {
    spanRow(pg.prodCode + (pg.prodName ? " - " + pg.prodName : ""), "secProduct");

    for (const dr of pg.rows) {
      rows.push([
        xc(pg.prodCode || "\u2014",              "data"),
        xc(text(dr.pallet_id) || "\u2014",       "data"),
        xc(text(dr.batch_no)  || "\u2014",       "data"),
        xc(text(dr.lot_no)    || "\u2014",       "data"),
        xc(dateText(dr.prod_mfg_date),           "dataCenter"),
        xc(dateText(dr.prod_exp_date),           "dataCenter"),
        xc(toNum(dr.asn_qty),                    "dataNum"),
        xc(toNum(dr.tally_qty),                  "dataNum"),
      ]);
    }

    totalRow(`Sub Total (${pg.prodCode}) \u2014 Pallets / ASN Qty / Tally Qty:`, pg.palletCount, pg.asnTotal, pg.tallyTotal, "subTotal");

    grandPalletCount += pg.palletCount;
    grandAsn         += pg.asnTotal;
    grandTally       += pg.tallyTotal;
  }

  totalRow(
    `GRAND TOTAL (${grandPalletCount} Records) \u2014 Pallets / ASN Qty / Tally Qty:`,
    grandPalletCount, grandAsn, grandTally, "grandTotal"
  );

  {
    const row: Row = Array(NCOLS).fill(skip);
    row[NCOLS - 1] = xc("Powered by Bayanat Technology", "footer");
    rows.push(row);
  }

  const COL_WIDTHS = [26, 16, 16, 16, 13, 13, 12, 12];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // merge each run of "value followed by nulls" into one merged range
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
    const ht = rn === 1 ? ` ht="24" customHeight="1"` : "";
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
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="14"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><sz val="9"/><color rgb="FF475569"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><i/><sz val="8"/><color rgb="FF64748B"/><name val="Arial"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF00378C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="5">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FFCBD5E1"/></top><bottom/><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FF00378C"/></top><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF00378C"/></left><right style="thin"><color rgb="FF00378C"/></right>
      <top style="thin"><color rgb="FF00378C"/></top><bottom style="thin"><color rgb="FF00378C"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="6" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
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

    const html = await renderHtml(req, groups, first, jobNo, prinCode, reportTitle, text(req.user?.loginid), autoPrint);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
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
    const html = await renderHtml(req, groups, first, jobNo, prinCode, reportTitle, text(req.user?.loginid), true);

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
    const jobNo       = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Inbound Tally Report";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadTallyData(req, jobNo, prinCode);
    const groups = groupRows(rows);
    const buffer = buildExcelBuffer(groups, rows[0] ?? null, jobNo, prinCode, reportTitle);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Tally_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Tally Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};