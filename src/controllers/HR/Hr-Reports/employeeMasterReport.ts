/**
 * Employee Master Print Controller (single-employee report)
 * Route:  POST /hr-reports/employee-master/print/:type      type = html | excel
 * Body :  { employee_id, company_code?, loginid? }
 *
 * Uses PROC_BUILD_DYNAMIC_SQL_HR_REPORT with P_PARAMETER = 'Hr_Report_EMPLOYEE_MASTER_PRINT'
 *   code1 = company code, code2 = employee id
 * and report_common (header / footer / CSS) – same pattern as the dynamic HR reports controller.
 *
 * If the employee is not found (or no employee_id is given), a report with a
 * meaningful "No record found" message is returned for both html and excel.
 */

import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  buildReportDocument,
  reportFooter,
  reportHeader,
  FREIGHT_COLORS,
} from "../../../controllers/common/report_common";

type ReportRow = Record<string, any>;

const PROCEDURE_PARAM = "Hr_Report_EMPLOYEE_MASTER_PRINT";
const REPORT_TITLE = "Employee Report";
const NO_RECORD_MSG = "No record found for the selected employee.";

// ─── Helpers ──────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) {
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  }
  if (!tenantId) {
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  }
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) {
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
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

const text = (v: unknown): string => (v == null ? "" : String(v).trim());

function escapeHtml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pick(req: RequestWithUser, ...keys: string[]): string {
  const b = req.body || {};
  const q = req.query || {};
  for (const k of keys) {
    const v = b[k] ?? q[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** DD/MM/YYYY – uses local getters because oracledb returns DATE columns as local-time JS Dates */
function fmtDate(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return text(v).substring(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** 'Y' / 'N' / 1 / 0 / 'YES' ... -> Yes / No (anything else is shown as-is) */
function yesNo(v: unknown): string {
  const s = text(v).toUpperCase();
  if (!s) return "";
  if (["Y", "YES", "1", "TRUE"].includes(s)) return "Yes";
  if (["N", "NO", "0", "FALSE"].includes(s)) return "No";
  return text(v);
}

function fmtNum(v: unknown, digits = 2): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : text(v);
}

// ─── Data loader ──────────────────────────────────────────────────────────

async function loadEmployee(
  req: RequestWithUser,
  companyCode: string,
  employeeId: string,
  loginid: string
): Promise<ReportRow | null> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
           :parameter, :loginid,
           :code1,  :code2,  NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      {
        parameter: PROCEDURE_PARAM,
        loginid,
        code1: companyCode,
        code2: employeeId,
        out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
      }
    );

    const rawSql = (result.outBinds as any).out_sql as string;
    if (!rawSql || rawSql === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("Procedure did not return a valid SQL query."), { status: 400 });
    }

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = normalize(dataResult.rows as any[]);
    return rows[0] || null;
  } finally {
    await closeConn(conn);
  }
}

// ─── Report model (shared by HTML + Excel) ────────────────────────────────

interface Cell {
  label: string;
  value: string;
  strong?: boolean;
}

interface Section {
  title: string;
  /** each entry is one printed row; cells per row = grid columns used by that row */
  rows: Cell[][];
  /** HTML grid columns for this section (3 = general layout, 1 = narrow side-by-side blocks) */
  cols: 1 | 2 | 3;
  /** HTML only: render beside the previous side-by-side section */
  side?: boolean;
}

const c = (label: string, value: unknown, strong = false): Cell => ({
  label,
  value: text(value),
  strong,
});

/** Builds the report layout. With an empty row every value is blank (blank report). */
function buildSections(r: ReportRow): Section[] {
  return [
    {
      title: "",
      cols: 3,
      rows: [
        [c("Employee Code", r.employee_code, true), c("Alternate Id", r.alternate_id), c("Report Name", r.rpt_name)],
        [c("Company", r.comp_name), c("Division", r.div_name)],
        [c("Department", r.dept_name), c("Section", r.section_name)],
        [c("Grade", r.grade_name), c("Category", r.category_name)],
        [c("Designation", r.desg_name), c("Labour Designation", r.labour_desg_name)],
        [
          c("Date of Join", fmtDate(r.join_date)),
          c("Emp Status", r.emp_status_name),
          c("Probation End Dt", fmtDate(r.probation_end_date)),
        ],
        [c("Probation Confirmed", fmtDate(r.probation_confirm_date))],
      ],
    },
    {
      title: "Payroll",
      cols: 3,
      rows: [
        [
          c("Include In Payroll", yesNo(r.include_in_payroll)),
          c("Payroll Start Dt", fmtDate(r.payroll_start_date)),
          c("Mode of Payment", r.payment_mode),
        ],
        [c("Bank", r.bank_name), c("Acct. No", r.salary_acct_no)],
        [c("Currency", r.curr_name), c("Exch Rate", fmtNum(r.exch_rate))],
      ],
    },
    {
      title: "Contract",
      cols: 3,
      rows: [
        [c("Contract Type", r.contract_type_desc), c("Renewable", yesNo(r.contract_renewable))],
        [c("Start Date", fmtDate(r.contract_start_date)), c("End Date", fmtDate(r.contract_end_date))],
      ],
    },
    {
      title: "Sponsor",
      cols: 1,
      rows: [
        [c("Sponsor Name", r.sponsor_name)],
        [c("Visa Type", r.visa_type)],
        [c("Valid From", fmtDate(r.visa_valid_from))],
        [c("Valid To", fmtDate(r.visa_valid_to))],
      ],
    },
    {
      title: "Labourcard",
      cols: 1,
      side: true,
      rows: [
        [c("Status", r.labourcard_status)],
        [c("Labourcard No", r.labourcard_no)],
        [c("Valid From", fmtDate(r.labourcard_valid_from))],
        [c("Valid To", fmtDate(r.labourcard_valid_to))],
      ],
    },
    {
      title: "Airfare Entitlement",
      cols: 3,
      rows: [
        [c("Eligibility", yesNo(r.ticket_eligibility)), c("Airport", r.airport_name)],
        [c("No of Adults", r.ta_no), c("No of Children", r.tc_no), c("No of Infants", r.ti_no)],
      ],
    },
  ];
}

// ─── HTML renderer ────────────────────────────────────────────────────────

const EMP_PRINT_CSS = `
  /* Title */
  .doc-title-row {
    margin: 0 0 10px 0;
    padding-bottom: 6px;
    border-bottom: 2px solid ${FREIGHT_COLORS.navy};
  }
  .doc-title-row h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: ${FREIGHT_COLORS.navy};
    text-transform: uppercase;
  }

  /* Sections */
  .emp-sec {
    margin-top: 14px;
  }
  .emp-sec:first-of-type {
    margin-top: 6px;
  }
  .emp-sec-title {
    background: ${FREIGHT_COLORS.strip};
    color: ${FREIGHT_COLORS.navy};
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 5px 8px;
    margin: 0 0 6px 0;
    border-left: 4px solid ${FREIGHT_COLORS.navy};
  }

  /* Side-by-side pair (Sponsor + Labourcard) */
  .emp-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 14px;
  }
  .emp-pair .emp-sec {
    margin-top: 0;
  }

  /* Rows & cells */
  .emp-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: 16px;
    row-gap: 2px;
    margin: 0 0 3px 0;
    min-height: 16px;
  }
  .emp-row.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .emp-row.cols-1 { grid-template-columns: minmax(0, 1fr); }

  .emp-cell {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    line-height: 1.35;
  }
  .emp-cell .lbl {
    flex: 0 0 auto;
    min-width: 42%;
    max-width: 48%;
    text-align: right;
    font-weight: 700;
    color: ${FREIGHT_COLORS.label};
  }
  .emp-cell .val {
    flex: 1 1 auto;
    min-width: 0;
    word-break: break-word;
    color: ${FREIGHT_COLORS.text};
  }
  .emp-cell .val.strong {
    font-weight: 800;
    color: #0f172a;
  }

  /* Subtle divider under the first (header) block */
  .emp-sec--header {
    padding-bottom: 8px;
    border-bottom: 1px solid ${FREIGHT_COLORS.ruleSoft};
    margin-bottom: 4px;
  }

  /* Empty / no-record state */
  .emp-empty {
    border: 1px dashed ${FREIGHT_COLORS.rule};
    background: #f8fafc;
    text-align: center;
    padding: 48px 24px;
    margin-top: 18px;
    color: ${FREIGHT_COLORS.muted};
    font-weight: 700;
    font-size: 13px;
    border-radius: 4px;
  }
  .emp-empty .emp-empty-icon {
    font-size: 28px;
    margin-bottom: 10px;
    opacity: 0.55;
  }
  .emp-empty .emp-empty-msg {
    margin: 0;
    color: ${FREIGHT_COLORS.label};
  }

  /* Screen compact */
  @media screen {
    .doc-title-row { margin: 0 0 6px 0; padding-bottom: 4px; }
    .doc-title-row h1 { font-size: 12px; letter-spacing: 0.08em; }
    .emp-sec { margin-top: 10px; }
    .emp-sec-title { font-size: 9.5px; padding: 3px 6px; }
    .emp-cell { font-size: 9.5px; }
    .emp-pair { gap: 12px; margin-top: 10px; }
    .emp-empty { padding: 32px 16px; font-size: 11px; margin-top: 12px; }
    .emp-empty .emp-empty-icon { font-size: 22px; margin-bottom: 6px; }
  }

  /* Print polish */
  @media print {
    .doc-title-row h1 { color: #0b4ca1 !important; }
    .emp-sec-title {
      background: #e8f0fa !important;
      color: #0b4ca1 !important;
      border-left-color: #0b4ca1 !important;
    }
    .emp-cell .lbl { color: #475569; }
    .emp-cell .val { color: #334155; }
    .emp-cell .val.strong { color: #0f172a; }
    .emp-empty {
      background: #f8fafc !important;
      border-color: #cbd5e1 !important;
      color: #64748b !important;
    }
  }
`;

function renderSection(s: Section, isHeaderBlock = false): string {
  const rowCols = (cells: Cell[]) => (s.cols === 1 ? 1 : cells.length >= 3 ? 3 : 2);
  const rowsHtml = s.rows
    .map((cells) => {
      const n = rowCols(cells);
      const inner = cells
        .map(
          (x) =>
            `<div class="emp-cell">
              <span class="lbl">${escapeHtml(x.label)}:</span>
              <span class="val${x.strong ? " strong" : ""}">${escapeHtml(x.value)}</span>
            </div>`
        )
        .join("");
      return `<div class="emp-row cols-${n}">${inner}</div>`;
    })
    .join("");

  const extraClass = isHeaderBlock ? " emp-sec--header" : "";
  return `<div class="emp-sec${extraClass}">${
    s.title ? `<div class="emp-sec-title">${escapeHtml(s.title)}</div>` : ""
  }${rowsHtml}</div>`;
}

function renderBody(sections: Section[], hasData: boolean): string {
  let html = `
    <div class="doc-title-row">
      <h1>${escapeHtml(REPORT_TITLE)}</h1>
    </div>`;

  if (!hasData) {
    html += `
      <div class="emp-empty">
        <div class="emp-empty-icon">—</div>
        <p class="emp-empty-msg">${escapeHtml(NO_RECORD_MSG)}</p>
      </div>`;
    return html;
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const next = sections[i + 1];
    const isFirst = i === 0;

    if (next && next.side) {
      html += `<div class="emp-pair">${renderSection(s)}${renderSection(next)}</div>`;
      i++;
    } else {
      html += renderSection(s, isFirst);
    }
  }
  return html;
}

// ─── Excel builder (lightweight OOXML) ────────────────────────────────────

const XL_COLS = 6; // 3 × (label, value)
const colLetter = (i: number) => String.fromCharCode(65 + i);

function buildExcelBuffer(sections: Section[], loginid: string, hasData: boolean): Buffer {
  // style ids: 1 title, 2 meta, 3 section, 4 label, 5 value, 6 value strong, 7 empty message
  type XlCell = { v: string; s: number } | null;
  const rows: XlCell[][] = [];
  const merges: string[] = [];

  const blank = (): XlCell[] => Array(XL_COLS).fill(null);
  const mergeRow = (r: number) => merges.push(`A${r + 1}:${colLetter(XL_COLS - 1)}${r + 1}`);

  // title
  let r0 = rows.length;
  let row = blank();
  row[0] = { v: REPORT_TITLE, s: 1 };
  rows.push(row);
  mergeRow(r0);

  // meta
  const printed = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  r0 = rows.length;
  row = blank();
  row[0] = { v: `Print: ${printed}  |  User: ${loginid}`, s: 2 };
  rows.push(row);
  mergeRow(r0);
  rows.push(blank());

  if (!hasData) {
    r0 = rows.length;
    row = blank();
    row[0] = { v: NO_RECORD_MSG, s: 7 };
    rows.push(row);
    mergeRow(r0);
  } else {
    for (const sec of sections) {
      if (sec.title) {
        r0 = rows.length;
        row = blank();
        row[0] = { v: sec.title.toUpperCase(), s: 3 };
        for (let i = 1; i < XL_COLS; i++) row[i] = { v: "", s: 3 };
        rows.push(row);
        mergeRow(r0);
      }
      for (const cells of sec.rows) {
        row = blank();
        cells.forEach((x, i) => {
          if (i > 2) return;
          row[i * 2] = { v: `${x.label}:`, s: 4 };
          row[i * 2 + 1] = { v: x.value, s: x.strong ? 6 : 5 };
        });
        rows.push(row);
      }
      rows.push(blank());
    }
  }

  const sheetData = rows
    .map((rw, ri) => {
      const rn = ri + 1;
      const cellsXml = rw
        .map((cl, ci) =>
          cl
            ? `<c r="${colLetter(ci)}${rn}" s="${cl.s}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
                cl.v
              )}</t></is></c>`
            : ""
        )
        .join("");
      return `<row r="${rn}">${cellsXml}</row>`;
    })
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="22" customWidth="1"/>
    <col min="2" max="2" width="30" customWidth="1"/>
    <col min="3" max="3" width="22" customWidth="1"/>
    <col min="4" max="4" width="30" customWidth="1"/>
    <col min="5" max="5" width="22" customWidth="1"/>
    <col min="6" max="6" width="30" customWidth="1"/>
  </cols>
  <sheetData>${sheetData}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><sz val="9"/><color rgb="FF475569"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF64748B"/><name val="Arial"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF00378C"/><bgColor rgb="FF00378C"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/><bgColor rgb="FFEAF0F8"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Employee Report" sheetId="1" r:id="rId1"/></sheets>
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
  <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Route handler ────────────────────────────────────────────────────────

/**
 * POST /hr-reports/employee-master/print/:type      (type = html | excel; defaults to html)
 * Body: { employee_id, company_code?, loginid? }
 */
export const getEmployeeMasterPrint = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const type = String(req.params.type || "html").toLowerCase();
    if (type !== "html" && type !== "excel") {
      res.status(400).json({ success: false, message: "type must be 'html' or 'excel'" });
      return;
    }

    const employeeId = pick(req, "employee_id", "as_empid");
    const companyCode = pick(req, "company_code", "as_companycode") || text(req.user?.company_code);
    if (!companyCode) {
      res.status(400).json({ success: false, message: "company_code is required" });
      return;
    }
    const loginid = pick(req, "loginid", "user_id") || text(req.user?.loginid) || "ADMIN";

    // No employee found (or no id given) → report with "No record found" message
    const row = employeeId ? await loadEmployee(req, companyCode, employeeId, loginid) : null;
    const hasData = !!row;
    const sections = buildSections(row || {});

    if (type === "excel") {
      const buffer = buildExcelBuffer(sections, loginid, hasData);
      const filename = `Employee_Report_${employeeId || "blank"}_${Date.now()}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.end(buffer);
      return;
    }

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: REPORT_TITLE,
      userName: loginid,
      endLabel: "Powered by AWARE",
    });

    const html = buildReportDocument({
      title: REPORT_TITLE,
      headerHtml,
      bodyHtml: renderBody(sections, hasData),
      footerHtml,
      extraCss: EMP_PRINT_CSS,
      autoPrint: false,
      showPrintButton: true,
      orientation: "portrait",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Employee master print error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};