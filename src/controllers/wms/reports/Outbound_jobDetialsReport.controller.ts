import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

export interface TOutboundJobDetails {
  COMPANY_CODE: string; JOB_NO: string; PRIN_CODE: string; DEPT_CODE: string;
  JOB_CLASS: string | null; DOC_REF: string | null;
  DESCRIPTION1: string | null; DESCRIPTION2: string | null;
  PRIN_REF1: string | null; PRIN_REF2: string | null; REMARKS: string | null;
  CANCEL_DATE: string | null; CANCELED_BY: string | null; CREATED_BY: string;
  TRANSPORT_MODE: string; TRANSPORT_MODE_DESC: string; PORT_CODE: string | null;
  ETD: string | null; SCHEDULE_DATE: string | null;
  CURR_CODE: string; EX_RATE: number;
  JOB_DATE: string; ORDER_DATE: string | null; ORDERED: string;
  PICKED_DATE: string | null; PICKED: string;
  CONFIRM_DATE: string | null; CONFIRMED: string;
  INVOICE_DATE: string | null; INVOICED: string;
  COMPLETE_DATE: string | null; COMPLETED: string;
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
// Matches the "Job Progress" table in the outbound mockup:
// Job | Order Received | Picked | Confirmed | Invoiced | Completed

const PROGRESS_COLS: { label: string; flag: string; dateKey: string }[] = [
  { label: "Job",             flag: "",           dateKey: "job_date"     },
  { label: "Order Received",  flag: "ordered",    dateKey: "order_date"   },
  { label: "Picked",          flag: "picked",     dateKey: "picked_date"  },
  { label: "Confirmed",       flag: "confirmed",  dateKey: "confirm_date" },
  { label: "Invoiced",        flag: "invoiced",   dateKey: "invoice_date" },
  { label: "Completed",       flag: "completed",  dateKey: "complete_date"},
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
       FROM VW_BOWM_JOBTXNOUB
       WHERE COMPANY_CODE = '${req.user.company_code}'
         AND job_no    = :job_no
         AND prin_code = :prin_code
         AND job_type = 'EXP'`,
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

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  d: ReportRow,
  reportTitle: string,
  loginId: string,
  autoPrint: boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)} - ${escapeHtml(d.job_no)}</title>
  <style>
    @page { size: A4; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 13px; color: #111827;
           background: #eef1f6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff;
             padding: 10mm 12mm; border: 1px solid #c4cdd9; }
    .rpt-header { background: #1e1b4b; color: #fff; text-align: center; font-size: 15px;
                  font-weight: 700; letter-spacing: .10em; padding: 10px 16px;
                  text-transform: uppercase; border-radius: 3px 3px 0 0; }
    .rpt-meta { display: flex; justify-content: space-between; align-items: center;
                padding: 8px 2px 10px; border-bottom: 2px solid #1e1b4b;
                font-size: 10.5px; color: #4b5563; margin-bottom: 14px; }
    .rpt-meta strong { color: #111827; font-weight: 600; }
    .section-label { font-size: 9.5px; font-weight: 700; color: #1e1b4b; text-transform: uppercase;
                     letter-spacing: .08em; margin-bottom: 7px; padding-bottom: 4px;
                     border-bottom: 1.5px solid #1e1b4b; }
    .field-row { display: flex; align-items: baseline; padding: 3.5px 0;
                 border-bottom: 1px solid #f1f5f9; }
    .field-row:last-child { border-bottom: none; }
    .f-label { font-size: 10px; color: #6b7280; min-width: 128px; padding-right: 8px;
               text-align: right; white-space: nowrap; flex-shrink: 0; }
    .f-value { font-size: 11px; font-weight: 600; color: #111827; }
    .nil { font-weight: 400; color: #9ca3af; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 32px; margin-bottom: 14px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;
           padding: 10px 14px; margin-bottom: 14px; }
    .box-title { font-size: 10px; font-weight: 700; color: #1e1b4b; text-transform: uppercase;
                 letter-spacing: .07em; margin-bottom: 8px; padding-bottom: 5px;
                 border-bottom: 1px solid #e2e8f0; }
    .progress-title { font-size: 10px; font-weight: 700; color: #1e1b4b; text-transform: uppercase;
                      letter-spacing: .08em; margin: 14px 0 8px; padding-bottom: 4px;
                      border-bottom: 2px solid #1e1b4b; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #1e1b4b; color: #fff; padding: 7px 8px; font-size: 9.5px;
               font-weight: 700; text-align: center; border: 1px solid #312e81; }
    .prog-cell { border: 1px solid #d1d5db; padding: 7px 8px; text-align: center; background: #fff; }
    .prog-cell.done { background: #f0fdf4; }
    .prog-date { display: block; font-size: 9.5px; color: #374151; }
    .prog-cell:not(.done) .prog-date { color: #9ca3af; }
    .rpt-footer { margin-top: 14px; border-top: 1px solid #e2e8f0; padding-top: 7px;
                  display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; }
    .rpt-footer code { font-family: "Courier New", monospace; font-size: 9px; color: #6b7280; }
    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <div class="rpt-header">${escapeHtml(reportTitle)}</div>
    <div class="rpt-meta">
      <span>Print Date:&nbsp;<strong>${escapeHtml(printDate)}</strong></span>
      <span>Print User:&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
    </div>

    <div class="section-label">Job Information</div>
    <div class="two-col">
      <div>
        ${field("Job No",         d.job_no)}
        ${field("Principal",      d.prin_code)}
        ${field("Department",     d.dept_code)}
        ${field("Classification", d.job_class)}
        ${field("Doc Ref",        d.doc_ref)}
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

    <div style="gap:16px; margin-bottom:14px; display:grid; grid-template-columns:1fr 1fr;">
      <div class="box" style="margin-bottom:0;">
        ${field("Transport Mode",  d.transport_mode_desc || d.transport_mode)}
        ${field("Discharge Port",  d.port_code)}
      </div>
      <div class="box" style="margin-bottom:0;">
        ${field("ETD",             dateText(d.etd))}
        ${field("Scheduled Date",  dateText(d.schedule_date))}
        ${field("Currency",        d.curr_code)}
        ${field("Exchange Rate",   numFmt(d.ex_rate, 4))}
      </div>
    </div>

    <div class="progress-title">Job Progress</div>
    <table>
      <thead>
        <tr>${PROGRESS_COLS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>
      </thead>
      <tbody><tr>${progressCells}</tr></tbody>
    </table>

    <div class="rpt-footer">
      <span>Object: <code>${escapeHtml(d.company_code)}-${escapeHtml(d.job_no)}</code></span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </main>
  <script>
    // Print button in the Dialog toolbar fires this via postMessage
    window.addEventListener("message", (e) => {
      if (e.data === "print") window.print();
    });
    ${autoPrint ? `window.addEventListener("load", () => setTimeout(() => window.print(), 300));` : ""}
  </script>
</body>
</html>`;
}

// ─── Excel builder ────────────────────────────────────────────────────────────
// Uses AdmZip (already in the project) — same pattern as the inbound job report.
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
  // Layout: 7 cols (A-G)
  //   A = left label   B = left value   C = spacer
  //   D = right label  E = right value  F,G = unused
  // Progress rows use all 6 cols (one per PROGRESS_COL, remaining unused).
  // null inside a row = cell is part of a merge (will be emitted as <mergeCell>).

  const NCOLS = 7;
  const skip  = null; // shorthand for a merged/empty cell slot

  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  // ── Row 1: title banner ───────────────────────────────────────────────────
  rows.push([xc(`WMS Outbound Job Details Report — Job ${text(d.job_no)}`, "header"), skip, skip, skip, skip, skip, skip]);

  // blank row
  rows.push(Array(NCOLS).fill(skip));

  // ── Job Information ───────────────────────────────────────────────────────
  rows.push([xc("JOB INFORMATION", "sectionTitle"), skip, skip, skip, skip, skip, skip]);

  const leftInfo: [string, unknown][] = [
    ["Job No",         d.job_no],
    ["Principal",      d.prin_code],
    ["Department",     d.dept_code],
    ["Classification", d.job_class],
    ["Doc Ref",        d.doc_ref],
  ];
  const rightInfo: [string, unknown][] = [
    ["Cancel Date",   dateText(d.cancel_date)],
    ["Cancelled By",  d.canceled_by],
    ["Created By",    d.created_by],
  ];
  for (let i = 0; i < Math.max(leftInfo.length, rightInfo.length); i++) {
    const [ll, lv] = leftInfo[i]  ?? ["", ""];
    const [rl, rv] = rightInfo[i] ?? ["", ""];
    rows.push([xc(ll, "label"), xc(lv, "value"), xc("", "default"), xc(rl, "label"), xc(rv, "value"), skip, skip]);
  }

  rows.push(Array(NCOLS).fill(skip));

  // ── References & Remarks ──────────────────────────────────────────────────
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

  // ── Transport / Schedule ──────────────────────────────────────────────────
  rows.push([xc("TRANSPORT", "sectionTitle"), skip, skip, xc("SCHEDULE", "sectionTitle"), skip, skip, skip]);

  const transport: [string, unknown][] = [
    ["Transport Mode", d.transport_mode_desc || d.transport_mode],
    ["Discharge Port", d.port_code],
  ];
  const schedule: [string, unknown][] = [
    ["ETD",            dateText(d.etd)],
    ["Scheduled Date", dateText(d.schedule_date)],
    ["Currency",       d.curr_code],
    ["Exchange Rate",  numFmt(d.ex_rate, 4)],
  ];
  for (let i = 0; i < Math.max(transport.length, schedule.length); i++) {
    const [ll, lv] = transport[i] ?? ["", ""];
    const [rl, rv] = schedule[i]  ?? ["", ""];
    rows.push([xc(ll, "label"), xc(lv, "value"), xc("", "default"), xc(rl, "label"), xc(rv, "value"), skip, skip]);
  }

  rows.push(Array(NCOLS).fill(skip));

  // ── Job Progress ──────────────────────────────────────────────────────────
  rows.push([xc("JOB PROGRESS", "sectionTitle"), skip, skip, skip, skip, skip, skip]);

  // Header row — one per progress col
  rows.push([...PROGRESS_COLS.map((col) => xc(col.label, "header")), xc("", "default")]);

  // Dates row
  rows.push([...PROGRESS_COLS.map((col) => {
    const isDone = col.flag ? text(d[col.flag]) === "Y" : !!d[col.dateKey];
    return xc(isDone ? dateText(d[col.dateKey]) : "—", isDone ? "progressDone" : "progressPending");
  }), xc("", "default")]);

  // Status row
  rows.push([...PROGRESS_COLS.map((col) => {
    const isDone = col.flag ? text(d[col.flag]) === "Y" : !!d[col.dateKey];
    return xc(isDone ? "Done" : "Pending", isDone ? "progressDone" : "progressPending");
  }), xc("", "default")]);

  // ── Build sheet XML ───────────────────────────────────────────────────────
  const COL_WIDTHS = [18, 30, 3, 18, 30, 2, 2];

  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // Collect merge ranges: a run of nulls following a non-null cell = merge
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

  // ── Styles XML — order must match STYLE_ID above ──────────────────────────
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

  // AdmZip — same pattern as the inbound job report
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
 * GET /api/wms/outbound/reports/job-details/:job_no
 *
 * Returns self-contained HTML for the Dialog iframe.
 * The embedded <script> listens for postMessage("print") from the Dialog toolbar
 * so Print/PDF are handled natively without a new tab.
 */
export const getWmsOutboundJobDetailsReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "WMS Outbound Job Details Report";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }
    const jobData = await loadJobData(req, jobNo, prinCode);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(jobData, reportTitle, text(req.user?.loginid), autoPrint));
  } catch (error: any) {
    console.error("WMS Outbound Job Details HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

/**
 * GET /api/wms/outbound/reports/job-details/:job_no/excel
 *
 * Streams a styled .xlsx using AdmZip — fast, no third-party spreadsheet library.
 * Uses res.end() (not res.send()) to avoid Express double-encoding the binary buffer.
 */
export const getWmsOutboundJobDetailsReportExcel = async (
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
    res.setHeader("Content-Disposition", `attachment; filename="Outbound_Job_${jobNo}_Details.xlsx"`);
    res.end(buffer); // res.end() matches the sample — prevents Express buffer re-encoding
  } catch (error: any) {
    console.error("WMS Outbound Job Details Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};