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

export interface TOutboundActivityRow {
  COMPANY_CODE: string; PRIN_CODE: string; JOB_NO: string; INVOICE_NO: string;
  ACT_CODE: string; SRNO: number; OTHER_SERVICES: string | null; JOB_TYPE: string;
  CONSOLIDATED_INVNO: string | null; CANCELLED: string | null;
  TRANSPORTER_CODE: string | null; VEHICLE_NO: string | null;
  ACTIVITY_GROUP_CODE: string | null; PRIN_NAME: string;
  BILL: number; COST: number; BILL_RATE: number; QUANTITY: number; COST_RATE: number;
  SO_NO: string | null; PO_NO: string | null;
  DESCRIPTION1: string | null; PORT_CODE: string | null; DESTINATION_PORT: string | null;
  DEST_PORT_NAME: string | null; PORT_NAME: string | null;
  TRANSPORT_MODE: string | null; QTY: number | null; CBM: number | null;
  REMARKS: string | null; TRANSPORTER_NAME: string | null;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

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
    try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

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

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadOutboundActivityData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string,
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT
         tn_invoice_det.company_code, tn_invoice_det.prin_code, tn_invoice_det.job_no,
         tn_invoice_det.invoice_no, tn_invoice_det.act_code, tn_invoice_det.srno,
         tn_invoice_det.other_services, tn_invoice_det.job_type,
         tn_invoice_det.consolidated_invno, tn_invoice_det.cancelled,
         tn_invoice_det.transporter_code, tn_invoice_det.vehicle_no,
         ms_activity.activity_group_code, ms_principal.prin_name,
         tn_invoice_det.bill, tn_invoice_det.cost, tn_invoice_det.bill_rate,
         tn_invoice_det.quantity, tn_invoice_det.cost_rate,
         (select max(order_no) from to_order
           where company_code = tn_invoice_det.company_code
             and prin_code = tn_invoice_det.prin_code
             and job_no = tn_invoice_det.job_no) so_no,
         (select max(po_no) from ti_packdet
           where company_code = tn_invoice_det.company_code
             and prin_code = tn_invoice_det.prin_code
             and job_no = tn_invoice_det.job_no) po_no,
         ti_job.description1, ti_job.port_code, ti_job.destination_port,
         (select PORT_NAME from ms_port where port_code = ti_job.port_code ) as PORT_NAME,
         (select PORT_NAME from ms_port where port_code = ti_job.destination_port ) as DEST_PORT_NAME,
         ti_job.transport_mode,
         (select sum(quantity) from vw_trans
           where company_code = tn_invoice_det.company_code
             and prin_code = tn_invoice_det.prin_code
             and job_no = tn_invoice_det.job_no) qty,
         (select sum(quantity * volume) from vw_trans
           where company_code = tn_invoice_det.company_code
             and prin_code = tn_invoice_det.prin_code
             and job_no = tn_invoice_det.job_no) cbm,
         ti_job.remarks,
         (select transporter_name from ms_transporter
           where transporter_code = tn_invoice_det.transporter_code) transporter_name
       FROM tn_invoice_det, ms_activity, ms_principal, ti_job
       WHERE ( tn_invoice_det.company_code = ms_activity.company_code )
         AND ( tn_invoice_det.act_code = ms_activity.activity_code )
         AND ( tn_invoice_det.company_code = ms_principal.company_code )
         AND ( tn_invoice_det.prin_code = ms_principal.prin_code )
         AND ( tn_invoice_det.company_code = ti_job.company_code )
         AND ( tn_invoice_det.prin_code = ti_job.prin_code )
         AND ( tn_invoice_det.job_no = ti_job.job_no )
         AND ( tn_invoice_det.company_code = :company_code )
         AND ( tn_invoice_det.prin_code = :prin_code )
         AND ( tn_invoice_det.job_no = :job_no )
       ORDER BY tn_invoice_det.srno`,
      {
        company_code: req.user.company_code,
        job_no: jobNo,
        prin_code: prinCode,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = normalize(result.rows as any[]);
    if (!rows.length)
      throw Object.assign(new Error("Job not found"), { status: 404 });
    return rows;
  } finally {
    await closeConn(conn);
  }
}

// ─── Extra CSS — Blue theme matching Adjustment Confirmation ─────────────────

const SERVICE_ACTIVITY_EXTRA_CSS = `
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
  .f-label::after { content: ":"; }
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

  .box {
    background: #f8fafc;
    border: 1px solid #e1e7ef;
    border-left: 4px solid #0b4ca1;
    border-radius: 3px;
    padding: 10px 14px;
    margin-bottom: 14px;
  }
  .box .field-row {
    border-bottom: 1px solid #e9eef5;
  }
  .box .f-label {
    min-width: 128px;
    text-align: right;
  }

  .table-frame {
    border: 1px solid #b8c4d2;
    border-radius: 3px;
    overflow: hidden;
  }

  table.activity-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 14px;
    table-layout: fixed;
  }
  table.activity-table thead th {
    background: #0b4ca1;
    color: #ffffff;
    padding: 7px 8px;
    font-size: 9.5px;
    font-weight: 700;
    text-align: left;
    border-right: 1px solid rgba(255,255,255,0.16);
  }
  table.activity-table thead th:last-child { border-right: 0; }
  table.activity-table thead th.num { text-align: right; }

  table.activity-table tbody td {
    border-bottom: 1px solid #e3e8ef;
    border-right: 1px solid #e3e8ef;
    padding: 6px 8px;
    font-size: 10.5px;
    color: #263445;
    vertical-align: middle;
  }
  table.activity-table tbody td:last-child { border-right: 0; }
  table.activity-table tbody td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  table.activity-table tbody tr:nth-child(even) { background: #f8fafc; }

  .remarks-text {
    font-size: 11px;
    color: #0f172a;
    white-space: pre-wrap;
    min-height: 18px;
  }

  @media print {
    table.activity-table thead { display: table-header-group; }
    table.activity-table tbody tr { page-break-inside: avoid; }
  }
`;

// ─── HTML Body Renderer ──────────────────────────────────────────────────────

function renderServiceActivityBody(rows: ReportRow[], reportTitle: string): string {
  const d = rows[0];

  const field = (label: string, value: unknown) => `
    <div class="field-row">
      <span class="f-label">${escapeHtml(label)}</span>
      <span class="f-value">${escapeHtml(value) || '<span class="nil">—</span>'}</span>
    </div>`;

  const activityRows = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.act_code)}</td>
      <td>${escapeHtml(r.other_services)}</td>
      <td class="num">${numFmt(r.quantity, 3)}</td>
      <td>${escapeHtml(r.transporter_name)}</td>
    </tr>`).join("");

  return `
    <div class="doc-title-row">
      <div><h1>${escapeHtml(reportTitle)}</h1></div>
    </div>

    <div class="section-label">Job Information</div>
    <div class="two-col">
      <div>
        ${field("Job No",    `${text(d.job_type)} ${text(d.job_no)}`.trim())}
        ${field("Principal", `${text(d.prin_code)} — ${text(d.prin_name)}`)}
        ${field("Invoice No", d.invoice_no)}
      </div>
      <div>
        ${field("Ref #",  d.description1)}
        ${field("SO No",  d.so_no)}
        ${field("PO No",  d.po_no)}
      </div>
    </div>

    <div class="section-label">Activities</div>
    <div class="table-frame">
      <table class="activity-table">
        <colgroup>
          <col style="width: 12%" />
          <col style="width: 50%" />
          <col style="width: 14%" />
          <col style="width: 24%" />
        </colgroup>
        <thead>
          <tr>
            <th>Code</th>
            <th>Description</th>
            <th class="num">Quantity</th>
            <th>Supplier</th>
          </tr>
        </thead>
        <tbody>${activityRows}</tbody>
      </table>
    </div>

    <div class="two-col">
      <div class="box" style="margin-bottom:0;">
        <div class="section-label" style="border:none; margin-bottom:6px;">Movement</div>
        ${field("Type of Movement", d.transport_mode)}
        ${field("From",             `${text(d.port_code)}  ${text(d.port_name)}`.trim())}
        ${field("To",               `${text(d.destination_port)} ${text(d.dest_port_name)}`.trim())}
        ${field("Quantity",         numFmt(d.qty, 0))}
        ${field("Volume (CBM)",     numFmt(d.cbm, 3))}
      </div>
      <div class="box" style="margin-bottom:0;">
        <div class="section-label" style="border:none; margin-bottom:6px;">Remarks</div>
        <div class="remarks-text">${escapeHtml(d.remarks) || '<span class="nil">—</span>'}</div>
      </div>
    </div>

    <script>
      window.addEventListener("message", (e) => {
        if (e.data === "print") window.print();
      });
    </script>
  `;
}

// ─── Excel Builder — blue theme via AdmZip ───────────────────────────────────

const STYLE_ID = {
  default:      0,
  header:       1,
  sectionTitle: 2,
  label:        3,
  value:        4,
  tableHeader:  5,
  tableCell:    6,
  tableCellNum: 7,
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(rows: ReportRow[]): Buffer {
  const d     = rows[0];
  const NCOLS = 7;
  const skip  = null;

  type Row = (XlCell | null)[];
  const xlRows: Row[] = [];

  // Title banner
  xlRows.push([xc(`Outbound Activity Service Report — Job ${text(d.job_type)} ${text(d.job_no)}`, "header"), skip, skip, skip, skip, skip, skip]);
  xlRows.push(Array(NCOLS).fill(skip));

  // Job Information
  xlRows.push([xc("JOB INFORMATION", "sectionTitle"), skip, skip, skip, skip, skip, skip]);

  const leftInfo: [string, unknown][] = [
    ["Job No",     `${text(d.job_type)} ${text(d.job_no)}`.trim()],
    ["Principal",  `${text(d.prin_code)} — ${text(d.prin_name)}`],
    ["Invoice No", d.invoice_no],
  ];
  const rightInfo: [string, unknown][] = [
    ["Ref #", d.description1],
    ["SO No", d.so_no],
    ["PO No", d.po_no],
  ];
  for (let i = 0; i < Math.max(leftInfo.length, rightInfo.length); i++) {
    const [ll, lv] = leftInfo[i]  ?? ["", ""];
    const [rl, rv] = rightInfo[i] ?? ["", ""];
    xlRows.push([xc(ll, "label"), xc(lv, "value"), xc("", "default"), xc(rl, "label"), xc(rv, "value"), skip, skip]);
  }

  xlRows.push(Array(NCOLS).fill(skip));

  // Activities
  xlRows.push([xc("ACTIVITIES", "sectionTitle"), skip, skip, skip, skip, skip, skip]);
  xlRows.push([
    xc("Code", "tableHeader"), xc("Description", "tableHeader"),
    xc("Quantity", "tableHeader"), xc("Supplier", "tableHeader"),
    skip, skip, skip,
  ]);
  for (const r of rows) {
    xlRows.push([
      xc(r.act_code, "tableCell"),
      xc(r.other_services, "tableCell"),
      xc(Number(r.quantity) || 0, "tableCellNum"),
      xc(r.transporter_name, "tableCell"),
      skip, skip, skip,
    ]);
  }

  xlRows.push(Array(NCOLS).fill(skip));

  // Movement / Remarks
  xlRows.push([xc("MOVEMENT", "sectionTitle"), skip, skip, xc("REMARKS", "sectionTitle"), skip, skip, skip]);

  const movement: [string, unknown][] = [
    ["Type of Movement", d.transport_mode],
    ["From",             `${text(d.port_code)}  ${text(d.port_name)}`.trim()],
    ["To",               `${text(d.destination_port)} ${text(d.dest_port_name)}`.trim()],
    ["Quantity",         numFmt(d.qty, 0)],
    ["Volume (CBM)",     numFmt(d.cbm, 3)],
  ];
  for (let i = 0; i < movement.length; i++) {
    const [ml, mv] = movement[i];
    const remarksCell = i === 0 ? xc(d.remarks ?? "", "value") : skip;
    xlRows.push([xc(ml, "label"), xc(mv, "value"), xc("", "default"), remarksCell, skip, skip, skip]);
  }

  // Column widths
  const COL_WIDTHS = [18, 30, 3, 22, 22, 2, 2];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // Merges
  const merges: string[] = [];
  xlRows.forEach((row, ri) => {
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
  xlRows.forEach((row, ri) => {
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

  // Styles — blue theme
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="6">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0B4CA1"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B4CA1"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF0B4CA1"/></left><right style="thin"><color rgb="FF0B4CA1"/></right>
      <top style="thin"><color rgb="FF0B4CA1"/></top><bottom style="thin"><color rgb="FF0B4CA1"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="2" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="2" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Service Activity" sheetId="1" r:id="rId1"/></sheets>
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

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/wms/outbound/reports/service-activity/:job_no
 *
 * Returns self-contained HTML via report_common (company header + footer).
 * Print is handled by postMessage("print").
 */
export const getWmsOutboundServiceActivityReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Outbound Activity Service Report";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const activityRows = await loadOutboundActivityData(req, jobNo, prinCode);
    const companyCode  = text(req.user?.company_code);
    const loginId      = text(req.user?.loginid);
    const d            = activityRows[0];

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const bodyHtml   = renderServiceActivityBody(activityRows, reportTitle);
    const footerHtml = reportFooter({
      reportName: "rpt_outbound_service_activity",
      userName: loginId,
      extraLeft: `Object: ${escapeHtml(d.company_code)}-${escapeHtml(d.job_no)}`,
      extraRight: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: `${reportTitle} - ${d.job_no}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SERVICE_ACTIVITY_EXTRA_CSS,
      autoPrint,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Outbound Service Activity HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getWmsOutboundServiceActivityReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no || req.query.job_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const activityRows = await loadOutboundActivityData(req, jobNo, prinCode);
    const buffer       = buildExcelBuffer(activityRows);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Outbound_Service_Activity_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Outbound Service Activity Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};