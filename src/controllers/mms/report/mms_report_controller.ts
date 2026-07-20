import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";

// ─── DB helpers (same pattern as the stock-transfer report controller) ────
async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId) throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
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

const raw_sql_api = async ({
  sql,
  binds = {},
  req
}: {
  sql: string;
  binds?: Record<string, any>;
  req: RequestWithUser;
}) => {
  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    return await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  } catch (err) {
    console.error("Error executing raw SQL:", err);
    throw err;
  } finally {
    await closeConn(conn);
  }
};

// ─── Query ──────────────────────────────────────────────────────────────
// Same joins/columns supplied for the inspection report, but parameterized
// with a bind variable instead of string-concatenating the id in.
function buildInspectionReportSql() {
  return `SELECT
      r.id AS report_id,
      r.report AS report_number,
      TO_CHAR(r.created_at, 'DD-Mon-YYYY') AS report_date,
      TO_CHAR(r.created_at, 'HH:MI AM') AS report_time,
      r.location,
      r.asset_number,
      r.asset_name,
      r.inventory,
      r.running_hours,
      r.running_hours_unit,
      r.inspection_form_id,
      r.overall_condition,
      r.asset_safe_to_use,
      r.maintenance_required,
      r.asset_status,
      r.additional_note,
      r.created_by AS report_created_by,
      r.update_by AS report_updated_by,
      r.created_at AS report_created_at,
      r.inspector_name,
      d.id AS detail_id,
      d.header_section_id,
      hs.header_section_title,
      d.under_section_id,
      us.under_section_title,
      d.type_status,
      d.inspection_note,
      d.upload,
      d.type_value,
      d.created_by AS detail_created_by,
      d.updated_by AS detail_updated_by,
      d.created_at AS detail_created_at
    FROM WMSTST.TB_OX_INSPECTION_REPORT r
    LEFT JOIN WMSTST.TB_OX_HEADER_INSPECTION_REPORT d ON r.id = d.report_id
    LEFT JOIN WMSTST.TB_OX_MS_HEADER_SECTION hs ON hs.header_section_id = d.header_section_id
    LEFT JOIN WMSTST.TB_OX_MS_UNDER_SECTION us ON us.under_section_id = d.under_section_id
    WHERE r.id = :report_id
    ORDER BY d.header_section_id, d.under_section_id, d.id`;
}

// ─── Formatting helpers (mirrors the stock-transfer report shell) ─────────
function text(v: unknown): string {
  return v == null ? "" : String(v);
}
function escapeHtml(v: any): string {
  if (v == null) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeXml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}
function formatDate(value: any): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${formatTime(d)}`;
}
function formatReportTimestamp(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()];
  let hours = d.getHours();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mon}/${d.getFullYear()} ${hours}:${mi} ${ampm}`;
}
function yesNo(val: any): string {
  if (val === null || val === undefined) return "No";
  const s = String(val).trim().toUpperCase();
  return s === "Y" || s === "1" || s === "YES" || s === "TRUE" ? "Yes" : "No";
}

// ─── Shared page shell (same al-madina branding as other mms reports) ─────
function buildPage(opts: { title: string; username: string; reportName: string; infoBlockHtml: string; tableHtml: string }): string {
  const { title, username, reportName, infoBlockHtml, tableHtml } = opts;
  const printDateTime = formatReportTimestamp(new Date());

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #000; background: #eef2f7; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 8mm; border: 1px solid #aab7c8; }
    .logo-area { margin-bottom: 16px; }
    .divider-thick { border-top: 2px solid #000; margin: 10px 0 6px; }
    .divider-thin  { border-top: 1px solid #000; margin: 6px 0 10px; }
    .meta-row { display: flex; align-items: baseline; font-size: 12px; margin-bottom: 3px; }
    .meta-label { font-weight: 700; width: 70px; flex-shrink: 0; }
    .info-block { display: flex; justify-content: space-between; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 8px 0; margin-bottom: 12px; flex-wrap: wrap; gap: 12px; }
    .info-left div, .info-right div { margin-bottom: 4px; }
    .info-left .label, .info-right .label { font-weight: 700; margin-right: 4px; }
    .section-title { font-weight: 700; font-size: 13px; background: #f3f4f6; border: 1px solid #000; padding: 4px 8px; margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
    th { border: 1px solid #000; padding: 2px 6px; line-height: 1.2; text-align: center; font-weight: 700; background: #fff; }
    td { border: 1px solid #ccc; padding: 3px 6px; line-height: 1.3; vertical-align: top; }
    td.center { text-align: center; }
    td.left   { text-align: left; }
    .end-of-report { text-align: center; margin-top: 12px; margin-bottom: 6px; font-size: 11px; border-top: 1px solid #ccc; padding-top: 6px; }
    .report-footer { display: flex; justify-content: space-between; font-size: 10px; color: #666; border-top: 1px solid #ccc; padding-top: 4px; margin-top: 6px; }
    @media print {
      body { background: white; }
      .sheet { border: 0; margin: 0; width: auto; min-height: auto; padding: 0; }
      thead { display: table-header-group; }
      tbody tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="logo-area">
      <svg width="160" height="50" viewBox="0 0 360 112" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <rect width="360" height="112" rx="4" fill="#1a5f4a"/>
        <text x="16" y="46" font-family="Arial" font-size="26" font-weight="700" fill="#d4a017">al madina المدينة</text>
        <text x="16" y="72" font-family="Arial" font-size="15" font-weight="400" fill="#d4a017" letter-spacing="4">LOGISTICS اللوجستية</text>
        <polygon points="310,20 355,56 310,92" fill="#d4a017"/>
      </svg>
    </div>
    <div class="divider-thick"></div>
    <div class="meta-row"><span class="meta-label">Title :</span><span>${escapeHtml(title)}</span></div>
    <div class="meta-row"><span class="meta-label">Date :</span><span>${escapeHtml(printDateTime)}</span></div>
    <div class="meta-row"><span class="meta-label">User :</span><span>${escapeHtml(username)}</span></div>
    <div class="divider-thin"></div>

    ${infoBlockHtml}

    ${tableHtml}

    <div class="end-of-report">End of Report</div>
    <div class="report-footer">
      <span>Report: ${escapeHtml(reportName)}</span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </div>
</body>
</html>`;
}

// ─── Row grouping: header_section_title -> ordered detail items ──────────
interface InspectionDetailItem {
  underSectionTitle: string;
  typeStatus: string;
  typeValue: string;
  note: string;
  upload: string;
}
interface InspectionSection {
  title: string;
  items: InspectionDetailItem[];
}

function groupInspectionRows(rows: any[]): InspectionSection[] {
  const order: string[] = [];
  const map = new Map<string, InspectionSection>();

  for (const row of rows) {
    if (row.DETAIL_ID == null) continue; // header-only row (no detail joined)
    const key = text(row.HEADER_SECTION_TITLE) || "General";
    if (!map.has(key)) {
      map.set(key, { title: key, items: [] });
      order.push(key);
    }
    map.get(key)!.items.push({
      underSectionTitle: text(row.UNDER_SECTION_TITLE),
      typeStatus: text(row.TYPE_STATUS),
      typeValue: text(row.TYPE_VALUE),
      note: text(row.INSPECTION_NOTE),
      upload: text(row.UPLOAD)
    });
  }

  return order.map((k) => map.get(k)!);
}

function buildInspectionInfoBlockHtml(header: any): string {
  return `
    <div class="info-block">
      <div class="info-left">
        <div><span class="label">Report No.:</span>${escapeHtml(header?.REPORT_NUMBER)}
             &nbsp;&nbsp;<span class="label">Date:</span>${escapeHtml(header?.REPORT_DATE)} ${escapeHtml(header?.REPORT_TIME)}</div>
        <div><span class="label">Location:</span>${escapeHtml(header?.LOCATION)}</div>
        <div><span class="label">Asset:</span>${escapeHtml(header?.ASSET_NUMBER)} ${escapeHtml(header?.ASSET_NAME)}</div>
        <div><span class="label">Inspector:</span>${escapeHtml(header?.INSPECTOR_NAME)}</div>
        <div><span class="label">Running Hrs:</span>${escapeHtml(header?.RUNNING_HOURS)} ${escapeHtml(header?.RUNNING_HOURS_UNIT)}</div>
      </div>
      <div class="info-right">
        <div><span class="label">Overall Condition:</span>${escapeHtml(header?.OVERALL_CONDITION)}</div>
        <div><span class="label">Safe To Use:</span>${yesNo(header?.ASSET_SAFE_TO_USE)}</div>
        <div><span class="label">Maintenance Required:</span>${yesNo(header?.MAINTENANCE_REQUIRED)}</div>
        <div><span class="label">Asset Status:</span>${escapeHtml(header?.ASSET_STATUS)}</div>
        <div><span class="label">Note:</span>${escapeHtml(header?.ADDITIONAL_NOTE)}</div>
      </div>
    </div>`;
}

function buildInspectionTableHtml(sections: InspectionSection[]): string {
  if (!sections.length) {
    return `<table><tbody><tr><td class="center" style="color:#666">No inspection detail found</td></tr></tbody></table>`;
  }

  return sections
    .map((section) => {
      const rows = section.items
        .map(
          (item) => `
        <tr>
          <td class="left">${escapeHtml(item.underSectionTitle)}</td>
          <td class="center">${escapeHtml(item.typeStatus)}</td>
          <td class="center">${escapeHtml(item.typeValue)}</td>
          <td class="left">${escapeHtml(item.note)}</td>
        </tr>`
        )
        .join("");

      return `
      <div class="section-title">${escapeHtml(section.title)}</div>
      <table>
        <thead>
          <tr>
            <th style="width:28%">Item</th>
            <th style="width:16%">Status</th>
            <th style="width:16%">Value</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
    })
    .join("");
}

// ─── HTML report ──────────────────────────────────────────────────────────
export const inspectionReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { reportid } = req.query;
    const reportId = Number(reportid);
    if (!reportid || !Number.isFinite(reportId) || reportId <= 0) {
      res.status(400).json({ error: "Missing or invalid reportid parameter" });
      return;
    }

    const sql = buildInspectionReportSql();
    const result = await raw_sql_api({ sql, binds: { report_id: reportId }, req });

    const rows: any[] = result.rows || [];
    const header = rows[0];
    const userName = req.user?.loginid ?? "";

    if (!header) {
      res.status(404).json({ error: "Inspection report not found" });
      return;
    }

    const sections = groupInspectionRows(rows);
    const title = `Inspection report  |  Report #${text(header.REPORT_NUMBER ?? reportId)}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      buildPage({
        title,
        username: userName,
        reportName: "rpt_inspection_report",
        infoBlockHtml: buildInspectionInfoBlockHtml(header),
        tableHtml: buildInspectionTableHtml(sections)
      })
    );
  } catch (error: any) {
    console.error("Inspection Report HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// ─── Excel export ─────────────────────────────────────────────────────────
const excelStyles = {
  title: {
    font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5F4A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left: { style: "thin", color: { rgb: "1A5F4A" } },
      right: { style: "thin", color: { rgb: "1A5F4A" } }
    }
  },
  meta: { font: { bold: true, sz: 10, color: { rgb: "000000" } }, alignment: { vertical: "center" } },
  tableHead: {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5F4A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left: { style: "thin", color: { rgb: "1A5F4A" } },
      right: { style: "thin", color: { rgb: "1A5F4A" } }
    }
  },
  sectionRow: {
    font: { bold: true },
    fill: { fgColor: { rgb: "F3F4F6" } },
    border: { bottom: { style: "thin", color: { rgb: "000000" } } }
  },
  normal: { alignment: { vertical: "top", wrapText: true }, border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } } }
};

const styleIdBySignature = new Map<string, number>([
  [JSON.stringify(excelStyles.title), 1],
  [JSON.stringify(excelStyles.meta), 2],
  [JSON.stringify(excelStyles.tableHead), 3],
  [JSON.stringify(excelStyles.normal), 4],
  [JSON.stringify(excelStyles.sectionRow), 5]
]);

type Cell = { v: string | number; s?: Record<string, unknown> };
type SheetRow = (Cell | string | number | null | undefined)[];
function cell(v: string | number, s?: Record<string, unknown>): Cell {
  return { v, s };
}

function buildInspectionExcel(header: any, sections: InspectionSection[], username: string): Buffer {
  const printDateTime = formatReportTimestamp(new Date());

  const titleRow: SheetRow = [cell("al madina LOGISTICS - Inspection Report", excelStyles.title)];
  const metaRows: SheetRow[] = [
    [],
    [cell("Title :", excelStyles.meta), `Inspection report | Report #${text(header?.REPORT_NUMBER)}`],
    [cell("Date :", excelStyles.meta), printDateTime],
    [cell("User :", excelStyles.meta), username],
    [],
    [cell("Location :", excelStyles.meta), text(header?.LOCATION)],
    [cell("Asset :", excelStyles.meta), `${text(header?.ASSET_NUMBER)} ${text(header?.ASSET_NAME)}`],
    [cell("Inspector :", excelStyles.meta), text(header?.INSPECTOR_NAME)],
    [cell("Overall Condition :", excelStyles.meta), text(header?.OVERALL_CONDITION)],
    [cell("Safe To Use :", excelStyles.meta), yesNo(header?.ASSET_SAFE_TO_USE)],
    [cell("Maintenance Required :", excelStyles.meta), yesNo(header?.MAINTENANCE_REQUIRED)],
    [cell("Asset Status :", excelStyles.meta), text(header?.ASSET_STATUS)],
    []
  ];

  const sheetRows: SheetRow[] = [titleRow, ...metaRows];

  if (!sections.length) {
    sheetRows.push([cell("No inspection detail found", excelStyles.normal)]);
  } else {
    sections.forEach((section) => {
      sheetRows.push([cell(section.title, excelStyles.sectionRow)]);
      sheetRows.push(["Item", "Status", "Value", "Note"].map((h) => cell(h, excelStyles.tableHead)));
      section.items.forEach((item) => {
        sheetRows.push([
          cell(item.underSectionTitle, excelStyles.normal),
          cell(item.typeStatus, excelStyles.normal),
          cell(item.typeValue, excelStyles.normal),
          cell(item.note, excelStyles.normal)
        ]);
      });
      sheetRows.push([]);
    });
  }

  return buildXlsxBuffer(sheetRows, "Inspection Report", [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 40 }], [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }
  ]);
}

function buildXlsxBuffer(
  sheetRows: SheetRow[],
  sheetName: string,
  cols: { wch: number }[],
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[]
): Buffer {
  const XLSX_COL_LETTER = (c: number) => {
    let s = "";
    let n = c;
    while (n >= 0) {
      s = String.fromCharCode((n % 26) + 65) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  };
  const encodeCell = (r: number, c: number) => `${XLSX_COL_LETTER(c)}${r + 1}`;
  const encodeRange = (m: { s: { r: number; c: number }; e: { r: number; c: number } }) =>
    `${encodeCell(m.s.r, m.s.c)}:${encodeCell(m.e.r, m.e.c)}`;

  const getStyleId = (s?: Record<string, unknown>) => (s ? styleIdBySignature.get(JSON.stringify(s)) || 0 : 0);

  const colXml = cols.map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(col.wch || 12)}" customWidth="1"/>`).join("");

  let sheetData = "";
  sheetRows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((raw, c) => {
      if (raw === null || raw === undefined || raw === "") return;
      const isCellObj = typeof raw === "object";
      const value = isCellObj ? (raw as Cell).v : raw;
      const styleId = isCellObj ? getStyleId((raw as Cell).s) : 0;
      const ref = encodeCell(r, c);
      const attrs = `r="${ref}"${styleId ? ` s="${styleId}"` : ""}`;
      if (typeof value === "number") {
        cells.push(`<c ${attrs}><v>${value}</v></c>`);
      } else {
        cells.push(`<c ${attrs} t="inlineStr"><is><t>${escapeXml(value ?? "")}</t></is></c>`);
      }
    });
    if (cells.length) sheetData += `<row r="${r + 1}">${cells.join("")}</row>`;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${encodeRange(m)}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><name val="Arial"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A5F4A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF1A5F4A"/></left><right style="thin"><color rgb="FF1A5F4A"/></right>
      <top style="thin"><color rgb="FF1A5F4A"/></top><bottom style="thin"><color rgb="FF1A5F4A"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="1" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const safeName = sheetName.replace(/[\\/?*[\]]/g, "_").substring(0, 31);
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(safeName)}" sheetId="1" r:id="rId1"/></sheets>
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
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
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

function sendExcel(res: Response, buffer: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(buffer);
}

export const inspectionReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { reportid } = req.query;
    const reportId = Number(reportid);
    if (!reportid || !Number.isFinite(reportId) || reportId <= 0) {
      res.status(400).json({ error: "Missing or invalid reportid parameter" });
      return;
    }

    const sql = buildInspectionReportSql();
    const result = await raw_sql_api({ sql, binds: { report_id: reportId }, req });
    const rows: any[] = result.rows || [];
    const header = rows[0];

    if (!header) {
      res.status(404).json({ error: "Inspection report not found" });
      return;
    }

    const sections = groupInspectionRows(rows);
    const userName = req.user?.loginid ?? "";
    const buffer = buildInspectionExcel(header, sections, userName);
    sendExcel(res, buffer, `inspection_report_${text(header.REPORT_NUMBER ?? reportId)}.xlsx`);
  } catch (error: any) {
    console.error("Inspection Report Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};