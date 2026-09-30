import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
} from "../../common/report_common";

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
  if (conn)
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
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

function getAdjustmentNo(req: RequestWithUser): string {
  return text(
    req.params.adjNo ||
      req.params.adj_no ||
      req.query.adjNo ||
      req.query.adj_no
  ).trim();
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function dateText(value: unknown): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-GB", { month: "short" });
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
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

function numFmt(value: unknown, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function qtyDisplay(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isConfirmed(value: unknown): boolean {
  const v = text(value).trim().toUpperCase();
  return ["Y", "YES", "1", "TRUE", "C", "CONFIRMED"].includes(v);
}

function confirmedYesNo(value: unknown): string {
  if (text(value).trim() === "") return "";
  return isConfirmed(value) ? "Yes" : "No";
}

function detailStatus(value: unknown): string {
  if (text(value).trim() === "") return "";
  return isConfirmed(value) ? "Confirmed" : "Not Confirmed";
}

function principalDisplay(row: ReportRow, fallbackPrinCode: string): string {
  const code = text(row.prin_code) || fallbackPrinCode;
  const name = text(row.prin_name);
  return name ? `${code} - ${name}` : code;
}

function countryDisplay(row: ReportRow): string {
  const countryCode = text(row.country_code).trim();
  const countryName = text(row.country_name).trim();
  if (countryCode && countryName) return `${countryCode} - ${countryName}`;
  return countryName || countryCode || "—";
}

function manufacturerDisplay(row: ReportRow): string {
  const manuCode = text(row.manu_code).trim();
  const manuName = text(row.manu_name).trim();
  if (manuCode && manuName) return `${manuCode} - ${manuName}`;
  return manuName || manuCode || "—";
}

// ─── Data loader ──────────────────────────────────────────────────────────────

const STOCK_ADJ_SQL = `
SELECT
  ah.ADJ_NO,
  ah.PRIN_CODE,
  mp.PRIN_NAME,
  ah.ADJ_CODE,
  ah.COMPANY_CODE,
  ah.ADJ_DATE,
  ad.ADJ_SERIALNO,
  ad.SITE_CODE,
  ad.LOCATION_CODE,
  ad.PROD_CODE,
  ad.JOB_NO,
  ad.LOT_NO,
  ad.DOC_REF,
  ad.ADJ_TYPE,
  ad.P_UOM,
  ad.QTY_PUOM,
  ad.L_UOM,
  ad.QTY_LUOM,
  ad.MANU_CODE,
  mf.MANU_NAME,
  mf.COUNTRY_CODE,
  co.COUNTRY_NAME,
  pr.PROD_NAME,
  ah.CONFIRMED       AS HEADER_CONFIRMED,
  ah.CONFIRMED_DATE,
  ad.POSTED_IND,
  ad.CONFIRMED       AS DETAIL_CONFIRMED,
  ah.REMARKS
FROM TA_ADJHEADER ah
INNER JOIN TA_ADJDETAIL ad
   ON ad.COMPANY_CODE = ah.COMPANY_CODE
  AND ad.PRIN_CODE    = ah.PRIN_CODE
  AND ad.ADJ_NO       = ah.ADJ_NO
INNER JOIN MS_PRODUCT pr
   ON pr.COMPANY_CODE = ad.COMPANY_CODE
  AND pr.PRIN_CODE    = ad.PRIN_CODE
  AND pr.PROD_CODE    = ad.PROD_CODE
LEFT JOIN MS_PRINCIPAL mp
   ON mp.COMPANY_CODE = ah.COMPANY_CODE
  AND mp.PRIN_CODE    = ah.PRIN_CODE
LEFT JOIN MS_MANUFACTURER mf
   ON mf.COMPANY_CODE = ad.COMPANY_CODE
  AND mf.PRIN_CODE    = ad.PRIN_CODE
  AND mf.MANU_CODE    = ad.MANU_CODE
LEFT JOIN MS_COUNTRY co
   ON co.COMPANY_CODE = mf.COMPANY_CODE
  AND co.COUNTRY_CODE = mf.COUNTRY_CODE
WHERE ah.COMPANY_CODE = :company_code
  AND ah.PRIN_CODE    = :prin_code
  AND ah.ADJ_NO       = :adj_no
ORDER BY ad.ADJ_SERIALNO ASC`;

async function loadAdjustmentData(
  req: RequestWithUser,
  prinCode: string,
  adjNo: string | number
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      STOCK_ADJ_SQL,
      {
        company_code: req.user.company_code,
        prin_code: prinCode,
        adj_no: adjNo,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── CSS — Stock Adjustment theme (aligned with FREIGHT_COLORS) ───────────────
//
//   navy     = #00378c  (title, section labels, table header, item title)
//   navyDeep = #002a6b  (table header borders)

const STOCK_ADJUSTMENT_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

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
    color: #00378c;
  }

  .section-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #00378c;
    text-transform: uppercase;
    letter-spacing: .08em;
    margin-bottom: 7px;
    padding-bottom: 4px;
    border-bottom: 1.5px solid #00378c;
  }
  .field-row {
    display: flex;
    align-items: baseline;
    padding: 3.5px 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .field-row:last-child { border-bottom: none; }
  .f-label {
    font-size: 10px;
    color: #64748b;
    min-width: 128px;
    padding-right: 8px;
    text-align: right;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .f-value {
    font-size: 11px;
    font-weight: 600;
    color: #0f172a;
  }
  .nil { font-weight: 400; color: #94a3b8; }
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 32px;
    margin-bottom: 14px;
  }

  .status-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
    padding: 8px 14px;
    border-radius: 4px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
  }
  .status-banner.pending {
    background: #fef2f2;
    border-color: #fecaca;
  }
  .status-banner .sb-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: #166534;
  }
  .status-banner.pending .sb-label { color: #991b1b; }
  .status-banner .sb-date {
    font-size: 10.5px;
    color: #4b5563;
  }

  .items-title {
    font-size: 10px;
    font-weight: 700;
    color: #00378c;
    text-transform: uppercase;
    letter-spacing: .08em;
    margin: 4px 0 8px;
    padding-bottom: 4px;
    border-bottom: 2px solid #00378c;
  }

  /* Dark navy table header — matches Stock Summary */
  table.adj-items-table thead th {
    background: #00378c !important;
    color: #ffffff !important;
    padding: 7px 6px;
    font-size: 9px;
    font-weight: 700;
    text-align: left;
    border-top: 1px solid #002a6b;
    border-bottom: 1px solid #002a6b;
    white-space: nowrap;
    box-shadow: inset 0 0 0 1000px #00378c;
  }
  table.adj-items-table thead th.c-center,
  table.adj-items-table thead th.c-num { text-align: center; }
  table.adj-items-table tbody td {
    padding: 6px;
    font-size: 10.5px;
    border: 1px solid #e2e8f0;
    vertical-align: top;
  }
  table.adj-items-table .item-row td { background: #fff; }
  .c-num { text-align: center; color: #64748b; width: 26px; }
  .c-center { text-align: center; }
  .c-right { text-align: right; font-variant-numeric: tabular-nums; }
  .c-prod { min-width: 120px; }
  .prod-code { display: block; font-weight: 700; color: #0f172a; }
  .prod-name { display: block; font-size: 9.5px; color: #64748b; margin-top: 1px; }
  .adj-type-pill {
    display: inline-block;
    padding: 1.5px 7px;
    border-radius: 10px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 9px;
    font-weight: 700;
  }
  .status-pill {
    display: inline-block;
    padding: 1.5px 8px;
    border-radius: 10px;
    background: #f1f5f9;
    color: #64748b;
    font-size: 9px;
    font-weight: 700;
  }
  .status-pill.confirmed {
    background: #f0fdf4;
    color: #166534;
  }
  table.adj-items-table .sub-row td {
    background: #f8fafc;
    border-top: none;
    padding: 4px 6px 6px;
  }
  .sub-item {
    display: inline-block;
    font-size: 9.5px;
    color: #334155;
    margin-right: 26px;
  }
  .sub-label {
    display: block;
    font-size: 8.5px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  .remarks-box { margin-top: 14px; }
  .remarks-text {
    font-size: 10.5px;
    color: #334155;
    padding: 8px 0 0;
    min-height: 18px;
  }

  .sign-block {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0 24px;
    margin-top: 28px;
    page-break-inside: avoid;
  }
  .sign-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #00378c;
    text-transform: uppercase;
    letter-spacing: .05em;
    margin-bottom: 22px;
  }
  .sign-sub {
    font-size: 8.5px;
    color: #94a3b8;
    margin: 14px 0 2px;
  }
  .sign-line {
    border-bottom: 1px solid #94a3b8;
    height: 1px;
  }

  @media print {
    .sub-row, .item-row { page-break-inside: avoid; }
  }
`;

// ─── HTML Body Renderer ───────────────────────────────────────────────────────

function renderAdjustmentBody(
  rows: ReportRow[],
  firstRow: ReportRow | null,
  adjNo: string,
  prinCode: string,
  reportTitle: string
): string {
  const r = firstRow || {};
  const headerConfirmed = isConfirmed(r.header_confirmed);
  const headerConfirmedText = confirmedYesNo(r.header_confirmed);

  const field = (label: string, value: unknown) => `
    <div class="field-row">
      <span class="f-label">${escapeHtml(label)}</span>
      <span class="f-value">${escapeHtml(value) || '<span class="nil">—</span>'}</span>
    </div>`;

  const detailRows = rows.map((d, i) => {
    const confirmed = isConfirmed(d.detail_confirmed);
    const statusText = detailStatus(d.detail_confirmed);
    const statusClass = confirmed ? "confirmed" : statusText ? "not-confirmed" : "empty";

    return `
    <tr class="item-row">
      <td class="c-num">${i + 1}</td>
      <td>${escapeHtml(text(d.site_code).trim())}</td>
      <td>${escapeHtml(text(d.location_code).trim())}</td>
      <td class="c-prod">
        <span class="prod-code">${escapeHtml(text(d.prod_code).trim())}</span>
        <span class="prod-name">${escapeHtml(text(d.prod_name).trim())}</span>
      </td>
      <td>${escapeHtml(text(d.job_no).trim())}</td>
      <td>${escapeHtml(text(d.lot_no).trim())}</td>
      <td>${escapeHtml(text(d.doc_ref).trim())}</td>
      <td class="c-center"><span class="adj-type-pill">${escapeHtml(text(d.adj_type).trim())}</span></td>
      <td class="c-right">${escapeHtml(qtyDisplay(d.qty_puom))}</td>
      <td class="c-right">${escapeHtml(qtyDisplay(d.qty_luom))}</td>
      <td class="c-center">
        <span class="status-pill${confirmed ? " confirmed" : ""}">${escapeHtml(statusText)}</span>
      </td>
    </tr>
    <tr class="sub-row">
      <td></td>
      <td colspan="10">
        <span class="sub-item"><span class="sub-label">Country of Origin</span>${escapeHtml(countryDisplay(d))}</span>
        <span class="sub-item"><span class="sub-label">Manufacturer</span>${escapeHtml(manufacturerDisplay(d))}</span>
      </td>
    </tr>`;
  }).join("");

  const signBlock = (label: string) => `
    <div class="sign-col">
      <div class="sign-label">${escapeHtml(label)}</div>
      <div class="sign-line"></div>
      <div class="sign-sub">Date</div>
      <div class="sign-line"></div>
      <div class="sign-sub">Signature</div>
      <div class="sign-line"></div>
    </div>`;

  return `
    <div class="doc-title-row">
      <div><h1>${escapeHtml(reportTitle)}</h1></div>
    </div>

    <div class="section-label">Adjustment Information</div>
    <div class="two-col">
      <div>
        ${field("Principal",          text(r.prin_code).trim() || prinCode)}
        ${field("Adjustment No",      text(r.adj_no).trim() || adjNo)}
        ${field("Adjustment Date",    dateText(r.adj_date))}
      </div>
      <div>
        ${field("Adjustment Reason",  text(r.adj_code).trim())}
        ${field("Confirmed",          headerConfirmedText)}
        ${field("Confirmed Date",     r.confirmed_date ? dateText(r.confirmed_date) : "—")}
      </div>
    </div>

    <div class="status-banner${headerConfirmed ? "" : " pending"}">
      <span class="sb-label">${headerConfirmed ? "Adjustment Confirmed" : "Confirmation Pending"}</span>
      <span class="sb-date">${headerConfirmed ? escapeHtml(dateText(r.confirmed_date)) : ""}</span>
    </div>

    <div class="items-title">Adjustment Items</div>
    <table class="data-table adj-items-table">
      <thead>
        <tr>
          <th class="c-num">No.</th>
          <th>Site</th>
          <th>Location</th>
          <th>Product</th>
          <th>Job No</th>
          <th>Lot No</th>
          <th>Doc Ref</th>
          <th class="c-center">Adj Type</th>
          <th class="c-center">Qty (P.UOM)</th>
          <th class="c-center">Qty (L.UOM)</th>
          <th class="c-center">Status</th>
        </tr>
      </thead>
      <tbody>${detailRows}</tbody>
    </table>

    <div class="remarks-box">
      <div class="section-label">Remarks</div>
      <div class="remarks-text">${escapeHtml(text(r.remarks).trim()) || '<span class="nil">—</span>'}</div>
    </div>

    <div class="sign-block">
      ${signBlock("Prepared By")}
      ${signBlock("Checked By")}
      ${signBlock("Supervised By")}
    </div>

    <script>
      window.addEventListener("message", (e) => {
        if (e.data === "print") window.print();
      });
    </script>
  `;
}

// ─── Excel builder (navy theme — matches Stock Summary) ───────────────────────

const STYLE_ID = {
  default:        0,
  header:         1,
  sectionTitle:   2,
  label:          3,
  value:          4,
  tableHeader:    5,
  tableSubHeader: 6,
  cellConfirmed:  7,
  cellPending:    8,
  cellPlain:      9,
  subInfo:        10,
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(
  reportRows: ReportRow[],
  firstRow: ReportRow | null,
  adjNo: string,
  prinCode: string
): Buffer {
  const NCOLS = 12;
  const skip = null;
  const r = firstRow || {};

  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  // Title
  rows.push([xc(`Stock Adjustment Report — Adj No ${text(r.adj_no) || adjNo}`, "header"), ...Array(NCOLS - 1).fill(skip)]);
  rows.push(Array(NCOLS).fill(skip));

  // Adjustment Information section
  rows.push([xc("ADJUSTMENT INFORMATION", "sectionTitle"), ...Array(NCOLS - 1).fill(skip)]);

  const headerConfirmed = isConfirmed(r.header_confirmed);
  const leftInfo: [string, unknown][] = [
    ["Principal",         principalDisplay(r, prinCode)],
    ["Adjustment No",     text(r.adj_no).trim() || adjNo],
    ["Adjustment Reason", text(r.adj_code).trim()],
  ];
  const rightInfo: [string, unknown][] = [
    ["Date",            dateText(r.adj_date)],
    ["Confirmed",       confirmedYesNo(r.header_confirmed)],
    ["Confirmed Date",  r.confirmed_date ? dateText(r.confirmed_date) : "—"],
  ];
  for (let i = 0; i < Math.max(leftInfo.length, rightInfo.length); i++) {
    const [ll, lv] = leftInfo[i]  ?? ["", ""];
    const [rl, rv] = rightInfo[i] ?? ["", ""];
    rows.push([
      xc(ll, "label"), xc(lv, "value"),
      xc("", "default"),
      xc(rl, "label"), xc(rv, "value"),
      skip, skip, skip, skip, skip, skip, skip,
    ]);
  }
  rows.push([xc("Remarks", "label"), xc(text(r.remarks).trim(), "value"), ...Array(NCOLS - 2).fill(skip)]);
  rows.push(Array(NCOLS).fill(skip));

  // Items section
  rows.push([xc("ADJUSTMENT ITEMS", "sectionTitle"), ...Array(NCOLS - 1).fill(skip)]);

  // Table header - two rows
  rows.push([
    xc("No.", "tableHeader"),
    xc("Site", "tableHeader"),
    xc("Location", "tableHeader"),
    xc("Product Code", "tableHeader"),
    xc("Job No", "tableHeader"),
    xc("Lot No", "tableHeader"),
    xc("Doc Ref", "tableHeader"),
    xc("Adj Type", "tableHeader"),
    xc("Qty PUOM", "tableHeader"),
    xc("Qty1", "tableHeader"),
    xc("Qty LUOM", "tableHeader"),
    xc("Qty2", "tableHeader"),
  ]);

  // Data rows
  for (const d of reportRows) {
    const confirmed = isConfirmed(d.detail_confirmed);
    const cellStyle: StyleKey = confirmed ? "cellConfirmed" : "cellPending";
    rows.push([
      xc(parseInt(text(d.adj_serialno), 10) || "", cellStyle),
      xc(text(d.site_code).trim(), cellStyle),
      xc(text(d.location_code).trim(), cellStyle),
      xc(text(d.prod_code).trim(), cellStyle),
      xc(text(d.job_no).trim(), cellStyle),
      xc(text(d.lot_no).trim(), cellStyle),
      xc(text(d.doc_ref).trim(), cellStyle),
      xc(text(d.adj_type).trim(), cellStyle),
      xc(text(d.p_uom).trim(), cellStyle),
      xc(Number(d.qty_puom) || 0, cellStyle),
      xc(text(d.l_uom).trim(), cellStyle),
      xc(Number(d.qty_luom) || 0, cellStyle),
    ]);
    // Sub-row: product name + status
    rows.push([
      xc("", "subInfo"),
      xc("", "subInfo"),
      xc("", "subInfo"),
      xc(text(d.prod_name).trim(), "subInfo"),
      xc("Status:", "subInfo"),
      xc(detailStatus(d.detail_confirmed), "subInfo"),
      skip, skip, skip, skip, skip, skip,
    ]);
    // Country / Manufacturer
    rows.push([
      xc("", "subInfo"),
      xc("Country of Origin", "subInfo"),
      xc(countryDisplay(d), "subInfo"),
      xc("Manufacturer", "subInfo"),
      xc(manufacturerDisplay(d), "subInfo"),
      skip, skip, skip, skip, skip, skip, skip,
    ]);
  }

  if (reportRows.length === 0) {
    rows.push([xc("No adjustment details found.", "value"), ...Array(NCOLS - 1).fill(skip)]);
  }

  const COL_WIDTHS = [5, 7, 12, 12, 12, 13, 13, 8, 6, 8, 6, 8];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

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
  <fonts count="6">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF00378C"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF00378C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0FDF4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF2F2"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF002A6B"/></left><right style="thin"><color rgb="FF002A6B"/></right>
      <top style="thin"><color rgb="FF002A6B"/></top><bottom style="thin"><color rgb="FF002A6B"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FF00378C"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Stock Adjustment" sheetId="1" r:id="rId1"/></sheets>
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

export const getStockAdjusmentReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const adjNo = getAdjustmentNo(req);
    const prinCode = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Stock Adjustment Report";
    const autoPrint = req.query.print === "true";

    if (!adjNo || !prinCode) {
      res.status(400).json({ success: false, message: "adj_no and prin_code are required" });
      return;
    }

    const rows = await loadAdjustmentData(req, prinCode, adjNo);

    if (!rows.length) {
      res.status(404).json({
        success: false,
        message: `No adjustment data found for adjustment ${adjNo} and principal ${prinCode}`,
      });
      return;
    }

    const first = rows[0] ?? null;
    const loginId = text(req.user?.loginid);
    const companyCode = text(req.user?.company_code);

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const bodyHtml = renderAdjustmentBody(rows, first, adjNo, prinCode, reportTitle);
    const footerHtml = reportFooter({
      reportName: "rpt_stock_adjustment",
      userName: loginId,
      extraLeft: `Object: ${escapeHtml(companyCode)}-${escapeHtml(adjNo)}`,
      extraRight: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: `${reportTitle} - ${adjNo}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: STOCK_ADJUSTMENT_EXTRA_CSS,
      autoPrint,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Stock Adjustment HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const getStockAdjusmentReportPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const adjNo = getAdjustmentNo(req);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!adjNo || !prinCode) {
      res.status(400).json({ success: false, message: "adj_no and prin_code are required" });
      return;
    }

    const rows = await loadAdjustmentData(req, prinCode, adjNo);

    if (!rows.length) {
      res.status(404).json({
        success: false,
        message: `No adjustment data found for adjustment ${adjNo} and principal ${prinCode}`,
      });
      return;
    }

    const first = rows[0] ?? null;
    const reportTitle = "Stock Adjustment Report";
    const loginId = text(req.user?.loginid);
    const companyCode = text(req.user?.company_code);

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const bodyHtml = renderAdjustmentBody(rows, first, adjNo, prinCode, reportTitle);
    const footerHtml = reportFooter({
      reportName: "rpt_stock_adjustment",
      userName: loginId,
      extraLeft: `Object: ${escapeHtml(companyCode)}-${escapeHtml(adjNo)}`,
      extraRight: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: `Stock_Adjusment_${adjNo}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: STOCK_ADJUSTMENT_EXTRA_CSS,
      autoPrint: true,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="Stock_Adjusment_${adjNo}.pdf"`);
    res.send(html);
  } catch (error: any) {
    console.error("Stock Adjustment PDF error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate PDF",
    });
  }
};

export const exportStockAdjusmentReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const adjNo = getAdjustmentNo(req);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!adjNo || !prinCode) {
      res.status(400).json({ success: false, message: "adj_no and prin_code are required" });
      return;
    }

    const rows = await loadAdjustmentData(req, prinCode, adjNo);

    if (!rows.length) {
      res.status(404).json({
        success: false,
        message: `No adjustment data found for adjustment ${adjNo} and principal ${prinCode}`,
      });
      return;
    }

    const first = rows[0] ?? null;
    const buffer = buildExcelBuffer(rows, first, adjNo, prinCode);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Stock_Adjusment_${adjNo}.xlsx"`
    );
    res.end(buffer);
  } catch (error: any) {
    console.error("Stock Adjustment Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate Excel",
    });
  }
};