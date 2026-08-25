import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// This is the backend counterpart of PoOrderRegister.tsx (frontend).

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:       string;
  company_code:  string;
  fromdate:      string; // "All" or "YYYY-MM-DD"
  todate:        string;
  ac_code:       string; // "All" or supplier code
  po_number:     string; // "All" or numeric doc_no
  prod_code_from: string; // "All" or code
  prod_code_to:   string; // "All" or code
  with_so_ref:   string; // "Y" | "N"
}

// ─── DB helpers (same pattern as your other controllers) ──────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId) throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
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

// ─── Formatting helpers ─────────────────────────────────────────────────────

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
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function qtyFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:        text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code:   text(b.company_code),
    fromdate:       text(b.fromdate) || "All",
    todate:         text(b.todate) || "All",
    ac_code:        text(b.ac_code) || "All",
    po_number:      text(b.po_number) || "All",
    prod_code_from: text(b.prod_code_from) || "All",
    prod_code_to:   text(b.prod_code_to) || "All",
    with_so_ref:    text(b.with_so_ref) === "Y" ? "Y" : "N",
  };
}



async function loadPoOrderRegisterData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const poNumberVal =
      !p.po_number || p.po_number.toUpperCase() === "ALL" ? 0 : Number(p.po_number) || 0;
    const withSoRefVal = p.with_so_ref === "Y" ? 1 : 0;

    const toDate = (iso: string): Date | null => {
      if (!iso || iso.toUpperCase() === "ALL") return null;
      const d = new Date(iso + "T00:00:00");
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const binds: any = {
      parameter: "PORPT_ALL_19082026",
      loginid: p.loginid,
      code1: p.company_code || null,
      code2: p.ac_code || null,
      code3: p.prod_code_from || null,
      code4: p.prod_code_to || null,
      number1: poNumberVal,
      number2: withSoRefVal,
      number3: null,
      number4: null,
      date1: toDate(p.fromdate),
      date2: toDate(p.todate),
      date3: null,
      date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const result = await conn.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_COMMON(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

    console.log("=== GENERATED SQL ===\n", rawSql, "\n=== END ===");

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Generic report-line model (shared by HTML + Excel renderers) ─────────
//
// "section"    -> PO header row (Doc No / Doc Date / Supplier)
// "data"       -> a product line under that PO
// "subtotal"   -> Total Qty for that PO
// "grandtotal" -> overall total qty across all POs

interface ReportLine {
  kind: "section" | "data" | "subtotal" | "grandtotal";
  label?: string;
  cells?: (string | number)[];
}

interface ColumnDef {
  label: string;
  align: "left" | "right";
}

const COLUMNS: ColumnDef[] = [
  { label: "Product", align: "left" },
  { label: "Required Date", align: "left" },
  { label: "Remarks", align: "left" },
  { label: "P.O Qty", align: "right" },
  { label: "UOM", align: "left" },
];

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function buildReportLines(rows: ReportRow[]): { lines: ReportLine[]; columns: ColumnDef[] } {
  const columns = COLUMNS;
  const lines: ReportLine[] = [];
  let grandQty = 0;

  // Group by doc_no, preserving first-seen order
  const byDoc = new Map<string, { doc_no: string; doc_date: any; ac_name: string; cancelled: string; rows: ReportRow[] }>();
  const order: string[] = [];

  for (const r of rows) {
    const key = text(r.doc_no);
    if (!byDoc.has(key)) {
      byDoc.set(key, { doc_no: key, doc_date: r.doc_date, ac_name: text(r.ac_name), cancelled: text(r.cancelled), rows: [] });
      order.push(key);
    }
    byDoc.get(key)!.rows.push(r);
  }

  for (const key of order) {
    const po = byDoc.get(key)!;
    const isCancelled = po.cancelled.toUpperCase() === "Y";
    const header = `Doc No. : ${po.doc_no}    Doc Date : ${dateText(po.doc_date)}${isCancelled ? "    Cancelled" : ""}    Supplier: ${po.ac_name}`;
    lines.push({ kind: "section", label: header });

    let poQty = 0;
    for (const r of po.rows) {
      const qty = num(r.quantity);
      poQty += qty;
      lines.push({
        kind: "data",
        cells: [`${text(r.prod_code)} ${text(r.prod_name)}`, dateText(r.required_dt), text(r.det_remarks), qtyFmt(qty), text(r.l_uom)],
      });
    }

    lines.push({ kind: "subtotal", label: `Total Qty for ${po.doc_no}`, cells: ["", "", "", qtyFmt(poQty), ""] });
    grandQty += poQty;
  }

  lines.push({ kind: "grandtotal", label: "Grand Total Qty", cells: ["", "", "", qtyFmt(grandQty), ""] });
  return { lines, columns };
}

// ─── HTML renderer ──────────────────────────────────────────────────────────

const REPORT_TITLE = "Purchase Orders";

function renderHtml(lines: ReportLine[], columns: ColumnDef[], loginId: string): string {
  const printDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const ncols = columns.length;

  const headerCells = columns.map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`).join("");

  const rowsHtml = lines.map((line) => {
    if (line.kind === "section") {
      return `<tr class="section-row"><td colspan="${ncols}">${escapeHtml(line.label)}</td></tr>`;
    }
    if (line.kind === "subtotal") {
      return `<tr class="subtotal-row"><td colspan="${ncols - 2}">${escapeHtml(line.label)}</td><td class="num">${escapeHtml((line.cells || [])[3])}</td><td></td></tr>`;
    }
    if (line.kind === "grandtotal") {
      return `<tr class="grand-total"><td colspan="${ncols - 2}">${escapeHtml(line.label)}</td><td class="num">${escapeHtml((line.cells || [])[3])}</td><td></td></tr>`;
    }
    const cells = (line.cells || []).map((c, i) => `<td class="${columns[i]?.align === "right" ? "num" : ""}">${escapeHtml(c)}</td>`).join("");
    return `<tr class="data-row">${cells}</tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(REPORT_TITLE)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 12px; color: #111827; background: #eef1f6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { width: 190mm; min-height: 260mm; margin: 18px auto; background: #fff; padding: 10mm 12mm; border: 1px solid #c4cdd9; border-radius: 4px; }
    .rpt-header { background: #1e3a5f; color: #fff; text-align: center; font-size: 14px; font-weight: 700; letter-spacing: .08em; padding: 10px 16px; text-transform: uppercase; border-radius: 3px 3px 0 0; }
    .rpt-meta { display: flex; justify-content: space-between; align-items: center; padding: 6px 2px 8px; border-bottom: 1px solid #e2e8f0; margin-bottom: 10px; font-size: 10px; color: #4b5563; }
    .rpt-meta strong { color: #111827; font-weight: 600; }
    table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead tr th { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 10px; padding: 7px 8px; text-align: center; border-right: 1px solid rgba(255,255,255,0.15); }
    thead tr th:last-child { border-right: none; }
    thead tr th.left { text-align: left; } thead tr th.right { text-align: right; }
    tr.section-row td { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 11px; padding: 5px 8px; }
    tbody tr.data-row td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; color: #374151; font-size: 11px; }
    tbody tr.data-row:nth-child(even) td { background: #f9fafb; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    tr.subtotal-row td { background: #c8d4e4; padding: 4px 8px; font-size: 11px; font-weight: 700; color: #1e3a5f; }
    tr.grand-total td { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 12px; padding: 8px 8px; border-top: 2px solid #162d4a; }
    .rpt-footer { margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px; display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; }
    @media print { body { background: #fff; } .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; border-radius: 0; } thead { display: table-header-group; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="rpt-header">${escapeHtml(REPORT_TITLE)}</div>
    <div class="rpt-meta">
      <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;Print User :&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
      <span>Page 1 of 1</span>
    </div>
    <table class="rpt-table">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="rpt-footer">
      <span>Report Name : <code>PO Order Register</code></span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </div>
  <script>
    window.addEventListener("message", function(e) { if (e.data === "print") window.print(); });
  </script>
</body>
</html>`;
}

// ─── Excel builder (raw OOXML, same style system as PL Summary) ───────────

const STYLE_ID = { header: 1, section: 2, value: 3, numValue: 4, subtotal: 5, numSubtotal: 6, grand: 7, numGrand: 8 } as const;
type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }
function xc(v: unknown, style: StyleKey): XlCell { return { v, s: STYLE_ID[style] }; }

function buildExcelBuffer(lines: ReportLine[], columns: ColumnDef[]): Buffer {
  const ncols = columns.length;
  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  rows.push([xc(REPORT_TITLE, "header"), ...Array(ncols - 1).fill(null)]);
  rows.push(Array(ncols).fill(null));
  rows.push(columns.map((c) => xc(c.label, "header")));

  for (const line of lines) {
    if (line.kind === "section") {
      rows.push([xc(line.label, "section"), ...Array(ncols - 1).fill(null)]);
    } else if (line.kind === "data") {
      rows.push((line.cells || []).map((c, i) => xc(c, columns[i]?.align === "right" ? "numValue" : "value")));
    } else if (line.kind === "subtotal") {
      rows.push([
        xc(line.label, "subtotal"), ...Array(Math.max(0, ncols - 2)).fill(null),
        xc((line.cells || [])[3], "numSubtotal"),
      ]);
    } else if (line.kind === "grandtotal") {
      rows.push([
        xc(line.label, "grand"), ...Array(Math.max(0, ncols - 2)).fill(null),
        xc((line.cells || [])[3], "numGrand"),
      ]);
    }
  }

  const colXml = Array.from({ length: ncols }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="20" customWidth="1"/>`
  ).join("");

  const merges: string[] = [];
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let ci = 0;
    while (ci < row.length) {
      if (row[ci] !== null) {
        let end = ci + 1;
        while (end < row.length && row[end] === null) end++;
        if (end - 1 > ci) {
          merges.push(`${String.fromCharCode(65 + ci)}${rn}:${String.fromCharCode(65 + end - 1)}${rn}`);
        }
        ci = end;
      } else ci++;
    }
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let rowXml = `<row r="${rn}">`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
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
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F2040"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC8D4E4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>
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
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="PO Order Register" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Route handlers ─────────────────────────────────────────────────────────

export const getPoOrderRegisterReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPoOrderRegisterData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const { lines, columns } = buildReportLines(rows);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(lines, columns, params.loginid));
  } catch (error: any) {
    console.error("PO Order Register HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPoOrderRegisterReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadPoOrderRegisterData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }
    const { lines, columns } = buildReportLines(rows);
    const buffer = buildExcelBuffer(lines, columns);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="PO_Order_Register_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("PO Order Register Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};