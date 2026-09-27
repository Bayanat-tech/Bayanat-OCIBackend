import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../common/report_common";

// ─── Shared report building blocks ─────────────────────────────────────────
// Adjust this import path to wherever reportHeader / reportFooter /
// buildReportDocument actually live in your project.


// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

export interface TJobDetails {
  COMPANY_CODE: string; DIV_CODE: string; PRIN_CODE: string; JOB_NO: string;
  JOB_DATE: string; JOB_TYPE: string; JOB_CLASS: string; DEPT_CODE: string;
  TRANSPORT_MODE_DESC: string; TRANSPORT_MODE: string; DOC_REF: string | null;
  PORT_CODE: string | null; DESCRIPTION1: string | null; DESCRIPTION2: string | null;
  PRIN_REF1: string | null; PRIN_REF2: string | null; REMARKS: string | null;
  ETA: string | null; ATA: string | null; ETD: string | null;
  SCHEDULE_DATE: string | null; PAYMENT_TERMS: string | null;
  CURR_CODE: string; EX_RATE: number; FRIEGHT_VALUE: number; INSURANCE_VALUE: number;
  CUST_CODE: string | null; CONTAINER_FLAG: string | null; CONTAINER: string | null;
  CONTAINER_DATE: string | null; PACKDET: string; PACKDET_DATE: string | null;
  ALLOCATED: string; ALLOCATE_DATE: string | null; CANCELED: string;
  CANCEL_DATE: string | null; CONFIRMED: string; CONFIRM_DATE: string | null;
  GRN_NO: string | null; GRN_DATE: string | null; INVOICED: string;
  INVOICE_DATE: string | null; COMPLETED: string | null; COMPLETE_DATE: string | null;
  CREATED_BY: string; CREATED_AT: string; EXP_JOBNO: string | null;
  PICKED: string; PICKED_DATE: string | null; ORDER_DATE: string | null;
  ORDERED: string; REF_CUSTOMS: string | null; REF_CUSTOMS_DATE: string | null;
  CANCELED_BY: string | null; CANCEL_REMARKS: string | null;
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

// ─── Progress columns ─────────────────────────────────────────────────────────

const PROGRESS_COLS: { label: string; flag: string; dateKey: string }[] = [
  { label: "Job",       flag: "",               dateKey: "job_date"       },
  { label: "Container", flag: "container_flag", dateKey: "container_date" },
  { label: "Packdet",   flag: "packdet",        dateKey: "packdet_date"   },
  { label: "Allocate",  flag: "allocated",      dateKey: "allocate_date"  },
  { label: "Confirm",   flag: "confirmed",      dateKey: "confirm_date"   },
  { label: "Completed", flag: "completed",      dateKey: "complete_date"  },
  { label: "Invoiced",  flag: "invoiced",       dateKey: "invoice_date"   },
];

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadJobData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT *
       FROM VW_BOWM_JOBTXN
       WHERE COMPANY_CODE = '${req.user.company_code}'
         AND job_no    = :job_no
         AND prin_code = :prin_code`,
      { job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = normalize(result.rows as any[]);
    if (!rows.length)
      throw Object.assign(new Error("Job not found"), { status: 404 });
    return rows[0];
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS specific to this report ─────────────────────────────────────
// (record/field layout — the shared COMMON_REPORT_CSS only ships table/list
// styles, so the field-row/box/progress-cell rules live here as extraCss)

const JOB_DETAILS_EXTRA_CSS = `
  .section-label {
    font-size: 9.5px; font-weight: 700; color: #0b4ca1; text-transform: uppercase;
    letter-spacing: .08em; margin: 14px 0 7px; padding-bottom: 4px;
    border-bottom: 1.5px solid #0b4ca1;
  }
  .field-row {
    display: flex; align-items: baseline; padding: 3.5px 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .field-row:last-child { border-bottom: none; }
  .f-label {
    font-size: 10px; color: #6b7280; min-width: 128px; padding-right: 8px;
    text-align: right; white-space: nowrap; flex-shrink: 0;
  }
  .f-value { font-size: 11px; font-weight: 600; color: #111827; }
  .nil { font-weight: 400; color: #9ca3af; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 32px; margin-bottom: 14px; }
  .box {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;
    padding: 10px 14px; margin-bottom: 14px;
  }
  .box-title {
    font-size: 10px; font-weight: 700; color: #0b4ca1; text-transform: uppercase;
    letter-spacing: .07em; margin-bottom: 8px; padding-bottom: 5px;
    border-bottom: 1px solid #e2e8f0;
  }
  .prog-cell { text-align: center; background: #fff; }
  .prog-cell.done { background: #f0fdf4; }
  .prog-date { display: block; font-size: 9.5px; color: #374151; }
  .prog-cell:not(.done) .prog-date { color: #9ca3af; }
`;

// ─── HTML body renderer ─────────────────────────────────────────────────────
// Builds only the *body* — reportHeader()/reportFooter()/buildReportDocument()
// from reportCommon supply the company header, footer and page shell.

function renderBodyHtml(d: ReportRow): string {
  const progressCells = PROGRESS_COLS.map((col) => {
    const dateVal = dateText(d[col.dateKey]);
    const isDone  = col.flag ? text(d[col.flag]) === "Y" : !!d[col.dateKey];
    return `<td class="prog-cell${isDone ? " done" : ""}">
      <span class="prog-date">${isDone ? escapeHtml(dateVal) : ""}</span>
    </td>`;
  }).join("");

  const field = (label: string, value: unknown) => `
    <div class="field-row">
      <span class="f-label">${escapeHtml(label)}</span>
      <span class="f-value">${escapeHtml(value) || '<span class="nil"></span>'}</span>
    </div>`;

  return `
    <div class="section-label">Job Information</div>
    <div class="two-col">
      <div>
        ${field("Job No",         d.job_no)}
        ${field("Job Date",       dateText(d.job_date))}
        ${field("Department",     d.dept_code)}
        ${field("Transport Mode", d.transport_mode_desc || d.transport_mode)}
        ${field("Document Ref",   d.doc_ref)}
        ${field("Principal",      d.prin_code)}
      </div>
      <div>
        ${field("Cancel Date",  dateText(d.cancel_date))}
        ${field("Cancelled By", d.canceled_by)}
        ${field("Created By",   d.created_by)}
      </div>
    </div>

    <div class="section-label">References &amp; Remarks</div>
    <div class="box" style="margin-bottom:14px;">
      ${field("Description",   d.description1)}
      ${field("Description 2", d.description2)}
      ${field("Principal Ref", d.prin_ref1)}
      ${field("Other Ref",     d.prin_ref2)}
      ${field("Remarks",       d.remarks)}
    </div>

    <div class="section-label">FIRS Details</div>
    <div style="gap:16px; margin-bottom:14px; display:grid; grid-template-columns:1fr 1fr;">
      <div class="box" style="margin-bottom:0;">
        <div class="box-title">Logistics</div>
        ${field("Port Code",     d.port_code)}
        ${field("ETA",           dateText(d.eta))}
        ${field("ATA",           dateText(d.ata))}
        ${field("ETD",           dateText(d.etd))}
        ${field("Schedule Date", dateText(d.schedule_date))}
      </div>
      <div class="box" style="margin-bottom:0;">
        <div class="box-title">Financial</div>
        ${field("Payment Terms",   d.payment_terms)}
        ${field("Currency",        d.curr_code)}
        ${field("Exchange Rate",   numFmt(d.ex_rate, 4))}
        ${field("Freight Value",   numFmt(d.frieght_value))}
        ${field("Insurance Value", numFmt(d.insurance_value))}
      </div>
    </div>

    <div class="section-label">Job Progress</div>
    <table class="data-table">
      <thead>
        <tr>${PROGRESS_COLS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>
      </thead>
      <tbody><tr>${progressCells}</tr></tbody>
    </table>
  `;
}

/**
 * Assembles the full document via buildReportDocument(), using the shared
 * company reportHeader() and reportFooter(). Kept async because reportHeader
 * hits the DB for company name / address / logo.
 */
async function renderHtml(
  req: RequestWithUser,
  d: ReportRow,
  reportTitle: string,
  loginId: string,
  autoPrint: boolean
): Promise<string> {
  const headerHtml = await reportHeader({ company_code: text(d.company_code), req });
  const bodyHtml   = renderBodyHtml(d);
  const footerHtml = reportFooter({
    reportName: reportTitle,
    userName: loginId,
    extraLeft: `Object: ${escapeHtml(d.company_code)}-${escapeHtml(d.job_no)}`,
  });

  return buildReportDocument({
    title: `${reportTitle} - ${text(d.job_no)}`,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: JOB_DETAILS_EXTRA_CSS,
    autoPrint,
    showPrintButton: !autoPrint,
  });
}

// ─── Excel builder ────────────────────────────────────────────────────────────
// Unchanged — AdmZip-based xlsx generation has no shared equivalent yet.
// STYLE_ID values must stay in sync with <cellXfs> order in stylesXml below.

const STYLE_ID = {
  default:         0,
  header:          1,  // white text, dark-indigo bg, centered
  sectionTitle:    2,  // indigo text, lavender bg, bottom border
  label:           3,  // gray bold, right-aligned
  value:           4,  // dark bold, wrapping
  progressDone:    5,  // green-tint bg, centered
  progressPending: 6,  // white bg, gray text, centered
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(d: ReportRow): Buffer {
  const NCOLS = 7;
  const skip  = null;

  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  rows.push([xc(`WMS Job Details Report — Job ${text(d.job_no)}`, "header"), skip, skip, skip, skip, skip, skip]);
  rows.push(Array(NCOLS).fill(skip));

  rows.push([xc("JOB INFORMATION", "sectionTitle"), skip, skip, skip, skip, skip, skip]);

  const leftInfo: [string, unknown][] = [
    ["Job No",         d.job_no],
    ["Job Date",       dateText(d.job_date)],
    ["Department",     d.dept_code],
    ["Transport Mode", d.transport_mode_desc || d.transport_mode],
    ["Document Ref",   d.doc_ref],
    ["Principal",      d.prin_code],
  ];
  const rightInfo: [string, unknown][] = [
    ["Cancel Date",  dateText(d.cancel_date)],
    ["Cancelled By", d.canceled_by],
    ["Created By",   d.created_by],
  ];
  for (let i = 0; i < Math.max(leftInfo.length, rightInfo.length); i++) {
    const [ll, lv] = leftInfo[i]  ?? ["", ""];
    const [rl, rv] = rightInfo[i] ?? ["", ""];
    rows.push([xc(ll, "label"), xc(lv, "value"), xc("", "default"), xc(rl, "label"), xc(rv, "value"), skip, skip]);
  }

  rows.push(Array(NCOLS).fill(skip));

  rows.push([xc("REFERENCES & REMARKS", "sectionTitle"), skip, skip, skip, skip, skip, skip]);
  for (const [label, val] of [
    ["Description",   d.description1],
    ["Description 2", d.description2],
    ["Principal Ref", d.prin_ref1],
    ["Other Ref",     d.prin_ref2],
    ["Remarks",       d.remarks],
  ] as [string, unknown][]) {
    rows.push([xc(label, "label"), xc(val, "value"), skip, skip, skip, skip, skip]);
  }

  rows.push(Array(NCOLS).fill(skip));

  rows.push([xc("FIRS DETAILS", "sectionTitle"), skip, skip, skip, skip, skip, skip]);
  rows.push([xc("Logistics", "sectionTitle"), skip, xc("", "default"), xc("Financial", "sectionTitle"), skip, skip, skip]);

  const logistics: [string, unknown][] = [
    ["Port Code",     d.port_code],
    ["ETA",           dateText(d.eta)],
    ["ATA",           dateText(d.ata)],
    ["ETD",           dateText(d.etd)],
    ["Schedule Date", dateText(d.schedule_date)],
  ];
  const financial: [string, unknown][] = [
    ["Payment Terms",   d.payment_terms],
    ["Currency",        d.curr_code],
    ["Exchange Rate",   numFmt(d.ex_rate, 4)],
    ["Freight Value",   numFmt(d.frieght_value)],
    ["Insurance Value", numFmt(d.insurance_value)],
  ];
  for (let i = 0; i < 5; i++) {
    const [ll, lv] = logistics[i] ?? ["", ""];
    const [rl, rv] = financial[i] ?? ["", ""];
    rows.push([xc(ll, "label"), xc(lv, "value"), xc("", "default"), xc(rl, "label"), xc(rv, "value"), skip, skip]);
  }

  rows.push(Array(NCOLS).fill(skip));

  rows.push([xc("JOB PROGRESS", "sectionTitle"), skip, skip, skip, skip, skip, skip]);
  rows.push(PROGRESS_COLS.map((col) => xc(col.label, "header")));
  rows.push(PROGRESS_COLS.map((col) => {
    const isDone = col.flag ? text(d[col.flag]) === "Y" : !!d[col.dateKey];
    return xc(isDone ? dateText(d[col.dateKey]) : "—", isDone ? "progressDone" : "progressPending");
  }));
  rows.push(PROGRESS_COLS.map((col) => {
    const isDone = col.flag ? text(d[col.flag]) === "Y" : !!d[col.dateKey];
    return xc(isDone ? "Done" : "Pending", isDone ? "progressDone" : "progressPending");
  }));

  const COL_WIDTHS = [18, 30, 3, 18, 30, 2, 2];
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

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E1B4B"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E1B4B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0FDF4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF312E81"/></left><right style="thin"><color rgb="FF312E81"/></right>
      <top style="thin"><color rgb="FF312E81"/></top><bottom style="thin"><color rgb="FF312E81"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFC7D2FE"/></bottom><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="3" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="3" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Job Details" sheetId="1" r:id="rId1"/></sheets>
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

/**
 * GET /api/wms/inbound/reports/job-details/:job_no
 *
 * Returns self-contained HTML for the Dialog iframe, built on the shared
 * reportCommon shell (company header + footer + print CSS).
 */
export const getWmsJobDetailsReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "WMS Job Details Report";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }
    const jobData = await loadJobData(req, jobNo, prinCode);
    const html = await renderHtml(req, jobData, reportTitle, text(req.user?.loginid), autoPrint);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("WMS Job Details HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

/**
 * GET /api/wms/inbound/reports/job-details/:job_no/excel
 *
 * Streams a styled .xlsx using AdmZip — unchanged from before, since
 * reportCommon currently only covers HTML reports.
 */
export const getWmsJobDetailsReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no || req.query.job_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }
    const jobData = await loadJobData(req, jobNo, prinCode);
    const buffer  = buildExcelBuffer(jobData);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Job_${jobNo}_Details.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("WMS Job Details Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};