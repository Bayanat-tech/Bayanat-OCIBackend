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

export interface TAdjConfirmHeader {
  ADJ_NO: string; PRIN_CODE: string; ADJ_CODE: string; COMPANY_CODE: string;
  ADJ_DATE: string; HEADER_CONFIRMED: string; CONFIRMED_DATE: string | null;
  REMARKS: string | null;
}

export interface TAdjConfirmDetail {
  ADJ_SERIALNO: number; SITE_CODE: string; LOCATION_CODE: string; PROD_CODE: string;
  PROD_NAME: string; JOB_NO: string | null; LOT_NO: string | null; DOC_REF: string | null;
  ADJ_TYPE: string; P_UOM: string | null; QTY_PUOM: number | null;
  L_UOM: string | null; QTY_LUOM: number | null; MANU_CODE: string | null;
  MANU_NAME: string | null; COUNTRY_CODE: string | null; COUNTRY_NAME: string | null;
  POSTED_IND: string | null; DETAIL_CONFIRMED: string;
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
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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

function numFmt(value: unknown, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function isY(value: unknown): boolean {
  return text(value).trim().toUpperCase() === "Y";
}

// ─── Data loader ──────────────────────────────────────────────────────────────

const ADJ_CONFIRM_SQL = `
SELECT  TA_ADJHEADER.ADJ_NO ,
        TA_ADJHEADER.PRIN_CODE ,
        TA_ADJHEADER.ADJ_CODE ,
        TA_ADJHEADER.COMPANY_CODE ,
        TA_ADJHEADER.ADJ_DATE ,
        TA_ADJDETAIL.ADJ_SERIALNO ,
        TA_ADJDETAIL.SITE_CODE ,
        TA_ADJDETAIL.LOCATION_CODE ,
        TA_ADJDETAIL.PROD_CODE ,
        TA_ADJDETAIL.JOB_NO ,
        TA_ADJDETAIL.LOT_NO ,
        TA_ADJDETAIL.DOC_REF ,
        TA_ADJDETAIL.ADJ_TYPE ,
        TA_ADJDETAIL.P_UOM ,
        TA_ADJDETAIL.QTY_PUOM ,
        TA_ADJDETAIL.L_UOM ,
        TA_ADJDETAIL.QTY_LUOM ,
        TA_ADJDETAIL.MANU_CODE ,
        MS_MANUFACTURER.MANU_NAME ,
        MS_MANUFACTURER.COUNTRY_CODE ,
        MS_COUNTRY.COUNTRY_NAME ,
        MS_PRODUCT.PROD_NAME ,
        TA_ADJHEADER.CONFIRMED       AS HEADER_CONFIRMED ,
        TA_ADJHEADER.CONFIRMED_DATE ,
        TA_ADJDETAIL.POSTED_IND ,
        TA_ADJDETAIL.CONFIRMED       AS DETAIL_CONFIRMED ,
        TA_ADJHEADER.REMARKS
   FROM TA_ADJDETAIL
   LEFT OUTER JOIN MS_MANUFACTURER ON
        TA_ADJDETAIL.COMPANY_CODE = MS_MANUFACTURER.COMPANY_CODE AND
        TA_ADJDETAIL.PRIN_CODE    = MS_MANUFACTURER.PRIN_CODE AND
        TA_ADJDETAIL.MANU_CODE    = MS_MANUFACTURER.MANU_CODE
   LEFT OUTER JOIN MS_COUNTRY ON
        MS_MANUFACTURER.COMPANY_CODE = MS_COUNTRY.COMPANY_CODE AND
        MS_MANUFACTURER.COUNTRY_CODE = MS_COUNTRY.COUNTRY_CODE ,
        TA_ADJHEADER ,
        MS_PRODUCT
  WHERE TA_ADJHEADER.COMPANY_CODE = TA_ADJDETAIL.COMPANY_CODE AND
        TA_ADJHEADER.PRIN_CODE    = TA_ADJDETAIL.PRIN_CODE AND
        TA_ADJHEADER.ADJ_NO       = TA_ADJDETAIL.ADJ_NO AND
        TA_ADJDETAIL.COMPANY_CODE = MS_PRODUCT.COMPANY_CODE AND
        TA_ADJDETAIL.PRIN_CODE    = MS_PRODUCT.PRIN_CODE AND
        TA_ADJDETAIL.PROD_CODE    = MS_PRODUCT.PROD_CODE AND
        TA_ADJDETAIL.CONFIRMED    = 'Y' AND
        TA_ADJHEADER.COMPANY_CODE = :as_companycode AND
        TA_ADJHEADER.PRIN_CODE    = :as_princode AND
        TA_ADJHEADER.ADJ_NO       = :ai_adjno
  ORDER BY TA_ADJDETAIL.ADJ_SERIALNO ASC`;

async function loadAdjConfirmData(
  req: RequestWithUser,
  adjNo: string,
  prinCode: string
): Promise<{ header: ReportRow; details: ReportRow[] }> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      ADJ_CONFIRM_SQL,
      {
        as_companycode: req.user.company_code,
        as_princode: prinCode,
        ai_adjno: adjNo,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = normalize(result.rows as any[]);
    if (!rows.length)
      throw Object.assign(new Error("Adjustment not found or not confirmed"), { status: 404 });
    return { header: rows[0], details: rows };
  } finally {
    await closeConn(conn);
  }
}

// ─── CSS — Stock Transfer blue theme (#0b4ca1) ────────────────────────────────

const ADJ_CONFIRM_EXTRA_CSS = `
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
    color: #0b4ca1;
  }

  .section-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #0b4ca1;
    text-transform: uppercase;
    letter-spacing: .08em;
    margin-bottom: 7px;
    padding-bottom: 4px;
    border-bottom: 1.5px solid #0b4ca1;
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
    color: #0b4ca1;
    text-transform: uppercase;
    letter-spacing: .08em;
    margin: 4px 0 8px;
    padding-bottom: 4px;
    border-bottom: 2px solid #0b4ca1;
  }

  table.adj-items-table thead th {
    background: #f1f5f9;
    color: #0f172a;
    padding: 7px 6px;
    font-size: 9px;
    font-weight: 700;
    text-align: left;
    border-top: 1px solid #475569;
    border-bottom: 1px solid #475569;
    white-space: nowrap;
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
  .c-prod { min-width: 120px; }
  .prod-code { display: block; font-weight: 700; color: #0f172a; }
  .prod-name { display: block; font-size: 9.5px; color: #64748b; margin-top: 1px; }
  .c-qty { text-align: right; white-space: nowrap; }
  .uom { font-size: 9px; color: #94a3b8; }
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
    color: #0b4ca1;
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

function renderAdjConfirmBody(
  header: ReportRow,
  details: ReportRow[],
  reportTitle: string
): string {
  const field = (label: string, value: unknown) => `
    <div class="field-row">
      <span class="f-label">${escapeHtml(label)}</span>
      <span class="f-value">${escapeHtml(value) || '<span class="nil">—</span>'}</span>
    </div>`;

  const qtyCell = (uom: unknown, qty: unknown) =>
    uom || Number(qty) ? `${escapeHtml(numFmt(qty, 2))} <span class="uom">${escapeHtml(uom)}</span>` : "—";

  const detailRows = details.map((d, i) => {
    const confirmed = isY(d.detail_confirmed);
    return `
    <tr class="item-row">
      <td class="c-num">${i + 1}</td>
      <td>${escapeHtml(d.site_code)}</td>
      <td>${escapeHtml(d.location_code)}</td>
      <td class="c-prod">
        <span class="prod-code">${escapeHtml(d.prod_code)}</span>
        <span class="prod-name">${escapeHtml(d.prod_name)}</span>
      </td>
      <td>${escapeHtml(d.job_no)}</td>
      <td>${escapeHtml(d.lot_no)}</td>
      <td>${escapeHtml(d.doc_ref)}</td>
      <td class="c-center"><span class="adj-type-pill">${escapeHtml(d.adj_type)}</span></td>
      <td class="c-qty">${qtyCell(d.p_uom, d.qty_puom)}</td>
      <td class="c-qty">${qtyCell(d.l_uom, d.qty_luom)}</td>
      <td class="c-center">
        <span class="status-pill${confirmed ? " confirmed" : ""}">${confirmed ? "Confirmed" : "Pending"}</span>
      </td>
    </tr>
    <tr class="sub-row">
      <td></td>
      <td colspan="10">
        <span class="sub-item"><span class="sub-label">Country of Origin</span>${escapeHtml(d.country_name) || "—"}</span>
        <span class="sub-item"><span class="sub-label">Manufacturer</span>${escapeHtml(d.manu_name) || "—"}</span>
      </td>
    </tr>`;
  }).join("");

  const headerConfirmed = isY(header.header_confirmed);

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
      <div>
        <h1>${escapeHtml(reportTitle)}</h1>
      </div>
    </div>

    <div class="section-label">Adjustment Information</div>
    <div class="two-col">
      <div>
        ${field("Principal",          header.prin_code)}
        ${field("Adjustment No",      header.adj_no)}
        ${field("Adjustment Date",    dateText(header.adj_date))}
      </div>
      <div>
        ${field("Adjustment Reason",  header.adj_code)}
        ${field("Confirmed",          headerConfirmed ? "Yes" : "No")}
        ${field("Confirmed Date",     dateText(header.confirmed_date))}
      </div>
    </div>

    <div class="status-banner${headerConfirmed ? "" : " pending"}">
      <span class="sb-label">${headerConfirmed ? "Adjustment Confirmed" : "Confirmation Pending"}</span>
      <span class="sb-date">${headerConfirmed ? escapeHtml(dateText(header.confirmed_date)) : ""}</span>
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
      <div class="remarks-text">${escapeHtml(header.remarks) || '<span class="nil">—</span>'}</div>
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

// ─── Excel builder (blue theme) ───────────────────────────────────────────────

const STYLE_ID = {
  default:        0,
  header:         1,
  sectionTitle:   2,
  label:          3,
  value:          4,
  tableHeader:    5,
  cellConfirmed:  6,
  cellPending:    7,
  subInfo:        8,
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(header: ReportRow, details: ReportRow[]): Buffer {
  const NCOLS = 8;
  const skip  = null;

  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  rows.push([xc(`WMS Adjustment Confirmation Report — Adj No ${text(header.adj_no)}`, "header"), skip, skip, skip, skip, skip, skip, skip]);
  rows.push(Array(NCOLS).fill(skip));

  rows.push([xc("ADJUSTMENT INFORMATION", "sectionTitle"), skip, skip, skip, skip, skip, skip, skip]);

  const headerConfirmed = isY(header.header_confirmed);
  const leftInfo: [string, unknown][] = [
    ["Principal",          header.prin_code],
    ["Adjustment No",      header.adj_no],
    ["Adjustment Date",    dateText(header.adj_date)],
  ];
  const rightInfo: [string, unknown][] = [
    ["Adjustment Reason",  header.adj_code],
    ["Confirmed",          headerConfirmed ? "Yes" : "No"],
    ["Confirmed Date",     dateText(header.confirmed_date)],
  ];
  for (let i = 0; i < Math.max(leftInfo.length, rightInfo.length); i++) {
    const [ll, lv] = leftInfo[i]  ?? ["", ""];
    const [rl, rv] = rightInfo[i] ?? ["", ""];
    rows.push([xc(ll, "label"), xc(lv, "value"), xc("", "default"), xc(rl, "label"), xc(rv, "value"), skip, skip, skip]);
  }

  rows.push([xc("Remarks", "label"), xc(header.remarks, "value"), skip, skip, skip, skip, skip, skip]);
  rows.push(Array(NCOLS).fill(skip));

  rows.push([xc("ADJUSTMENT ITEMS", "sectionTitle"), skip, skip, skip, skip, skip, skip, skip]);
  rows.push([
    xc("No.", "tableHeader"), xc("Site", "tableHeader"), xc("Location", "tableHeader"),
    xc("Product", "tableHeader"), xc("Job No", "tableHeader"), xc("Lot No", "tableHeader"),
    xc("Doc Ref", "tableHeader"), xc("Adj Type", "tableHeader"),
  ]);

  details.forEach((d, i) => {
    const confirmed = isY(d.detail_confirmed);
    const cellStyle: StyleKey = confirmed ? "cellConfirmed" : "cellPending";
    rows.push([
      xc(i + 1, cellStyle),
      xc(d.site_code, cellStyle),
      xc(d.location_code, cellStyle),
      xc(`${text(d.prod_code)} - ${text(d.prod_name)}`, cellStyle),
      xc(d.job_no, cellStyle),
      xc(d.lot_no, cellStyle),
      xc(d.doc_ref, cellStyle),
      xc(d.adj_type, cellStyle),
    ]);
    rows.push([
      xc(`Qty P.UOM: ${numFmt(d.qty_puom)} ${text(d.p_uom)}`, "subInfo"),
      xc(`Qty L.UOM: ${numFmt(d.qty_luom)} ${text(d.l_uom)}`, "subInfo"),
      skip,
      xc(`Origin: ${text(d.country_name) || "—"}`, "subInfo"),
      skip,
      xc(`Manufacturer: ${text(d.manu_name) || "—"}`, "subInfo"),
      skip,
      xc(confirmed ? "Confirmed" : "Pending", "subInfo"),
    ]);
  });

  const COL_WIDTHS = [10, 12, 14, 30, 12, 12, 14, 12];
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
        if (end > spanStart) {
          merges.push(
            `${String.fromCharCode(65 + spanStart)}${rn}:${String.fromCharCode(65 + end)}${rn}`
          );
        }
        spanStart = -1;
      } else if (cell !== null) {
        spanStart = ci;
      }
    });
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn  = ri + 1;
    const ht  = rn === 1 ? ` ht="22" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${String.fromCharCode(65 + ci)}${rn}`;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
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

  // Blue theme styles matching Stock Transfer
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0B4CA1"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="FF334155"/><name val="Calibri"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B4CA1"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0FDF4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF475569"/></left><right style="thin"><color rgb="FF475569"/></right>
      <top style="thin"><color rgb="FF475569"/></top><bottom style="thin"><color rgb="FF475569"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FF0B4CA1"/></bottom><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="3" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="3" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="6" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Adj Confirmation" sheetId="1" r:id="rId1"/></sheets>
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

export const getWmsAdjConfirmReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const adjNo       = text(req.params.adj_no || req.query.adj_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "WMS Adjustment Confirmation Report";
    const autoPrint   = req.query.print === "true";

    if (!adjNo || !prinCode) {
      res.status(400).json({ success: false, message: "adj_no and prin_code are required" });
      return;
    }
    const { header, details } = await loadAdjConfirmData(req, adjNo, prinCode);
    const companyCode = text(req.user?.company_code);
    const loginId     = text(req.user?.loginid);

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const bodyHtml   = renderAdjConfirmBody(header, details, reportTitle);
    const footerHtml = reportFooter({
      reportName: "rpt_adj_confirmation",
      userName: loginId,
      extraLeft: `Object: ${escapeHtml(header.company_code)}-${escapeHtml(header.adj_no)}`,
      extraRight: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: `${reportTitle} - ${header.adj_no}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: ADJ_CONFIRM_EXTRA_CSS,
      autoPrint,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("WMS Adjustment Confirmation HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getWmsAdjConfirmReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const adjNo    = text(req.params.adj_no || req.query.adj_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!adjNo || !prinCode) {
      res.status(400).json({ success: false, message: "adj_no and prin_code are required" });
      return;
    }
    const { header, details } = await loadAdjConfirmData(req, adjNo, prinCode);
    const buffer = buildExcelBuffer(header, details);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Adjustment_${adjNo}_Confirmation.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("WMS Adjustment Confirmation Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};