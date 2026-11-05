// src/controllers/wms/reports/HrBankReport.controller.ts

import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
  reportAppliedFilters,
} from "../../common/report_common";
const AdmZip = require("adm-zip");

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), {
      status: 400,
    });
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
    }, {}),
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
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

function statusLabel(value: unknown): string {
  const s = text(value).trim().toUpperCase();
  if (s === "A" || s === "Y") return "Active";
  if (s === "I" || s === "N") return "Inactive";
  return text(value);
}

// ─── Request Param Parser ────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  const body = req.body || {};
  const pick = (v: unknown) => (v == null ? "" : String(v).trim());

  const companyCode =
    text(req.user?.company_code || pick(body.company_code) || pick(req.query.company_code) || "").trim() ||
    "All";
  const bankCode =
    text(
      body.bank_code ||
        body.main_bank_code ||
        body.code2 ||
        req.query.bank_code ||
        req.query.main_bank_code ||
        req.query.code2 ||
        "All",
    ).trim() || "All";

  return {
    companyCode,
    bankCode,
    loginId: text(req.user?.loginid || (req.user as any)?.username),
  };
}

/** Company code for the letterhead lookup — independent of the (possibly "All") query filter. */
function resolveHeaderCompanyCode(req: RequestWithUser, companyCode: string): string {
  if (companyCode && companyCode.toUpperCase() !== "ALL") return companyCode;
  return text(req.user?.company_code) || text(req.query.company_code) || "BSG";
}

const REPORT_PARAMETER = "Hr_Report_BANK_MASTER";

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  if (!params.companyCode || params.companyCode.toUpperCase() === "ALL") {
    params.companyCode = resolveHeaderCompanyCode(req, params.companyCode);
  }

  const conn = await getConn(req);
  try {
    const binds: Record<string, any> = {
      p_parameter: REPORT_PARAMETER,
      p_loginid: params.loginId,
      p_code1: params.companyCode,
      p_code2: params.bankCode,
      p_number1: 0,
      p_number2: 0,
      p_number3: 0,
      p_number4: 0,
      p_date1: { val: null, type: oracledb.DATE },
      p_date2: { val: null, type: oracledb.DATE },
      p_date3: { val: null, type: oracledb.DATE },
      p_date4: { val: null, type: oracledb.DATE },
      p_return_string: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    for (let i = 3; i <= 20; i++) binds[`p_code${i}`] = null;
    const codeArgs = Array.from({ length: 20 }, (_, i) => `:p_code${i + 1}`).join(", ");

    const procResult = await conn.execute(
      `BEGIN PROC_BUILD_DYNAMIC_SQL_HR_REPORT(
         :p_parameter, :p_loginid, ${codeArgs},
         :p_number1, :p_number2, :p_number3, :p_number4,
         :p_date1, :p_date2, :p_date3, :p_date4, :p_return_string
       ); END;`,
      binds,
    );

    const builtSql = text((procResult.outBinds as any)?.p_return_string).trim();
    if (!builtSql || builtSql.toUpperCase() === "INVALID PARAMETER VALUE") {
      throw Object.assign(new Error("No query returned"), { status: 500 });
    }

    console.log("SQL:--------------->Bank", builtSql);

    const result = await conn.execute(builtSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Layout CSS — same visual system as Category Master ─────────────────────

const BANK_EXTRA_CSS = `
  .doc-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 0 !important;
    padding: 0 !important;
  }

  .doc-title-row h1 {
    margin: 0 0 2px 0 !important;
    padding: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0b4ca1;
    line-height: 1.2;
  }

  .doc-title-row .doc-sub {
    margin: 0 !important;
    padding: 0 !important;
    font-size: 11px;
    color: #64748b;
    line-height: 1.3;
  }

  table.data-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 10.5px;
    margin-top: 6px !important;
  }

  table.data-table th {
    background: #e8f0fa !important;
    color: #0b4ca1 !important;
    font-size: 11px;
    padding: 7px 6px;
    text-align: left;
    font-weight: 700;
    border-bottom: 2px solid #0b4ca1 !important;
  }

  table.data-table td {
    padding: 5px 6px;
    vertical-align: middle;
    border-bottom: 1px solid #e2e8f0 !important;
    color: #334155;
  }

  table.data-table tbody tr:nth-child(even) td { 
    background: #f8fafc !important; 
  }

  .status-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
  }
  .status-ACTIVE { background: #dcfce7; color: #166534; }
  .status-INACTIVE { background: #fee2e2; color: #dc2626; }

  @media print {
    table.data-table thead { display: table-header-group; }
    table.data-table thead th {
      background: #e8f0fa !important;
      color: #0b4ca1 !important;
      border-bottom: 2px solid #0b4ca1 !important;
    }
  }
`;

function printMetaHtml(title: string, subtitle: string): string {
  return `
    <div class="doc-title-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="doc-sub">${escapeHtml(subtitle)}</div>
      </div>
    </div>`;
}

// ─── Body Renderer ──────────────────────────────────────────────────────────

function renderBody(rows: ReportRow[], filtersHtml: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const subtitle = `List of Banks  |  Printed ${printDateTime}`;

  if (!rows.length) {
    return `
      ${printMetaHtml("Bank Master", subtitle)}
      ${filtersHtml}
      <div class="empty">No banks found for the selected filters.</div>`;
  }

  const lineRows = rows
    .map((r) => {
      const label = statusLabel(r.status);
      const badgeClass =
        label === "Active"
          ? "status-ACTIVE"
          : label === "Inactive"
            ? "status-INACTIVE"
            : "";
      return `
        <tr>
          <td class="center">${escapeHtml(r.bank_code)}</td>
          <td class="center">${escapeHtml(r.country_code)}</td>
          <td>${escapeHtml(r.bank_addr1)}</td>
          <td class="center">${
            badgeClass
              ? `<span class="status-badge ${badgeClass}">${escapeHtml(label)}</span>`
              : escapeHtml(label)
          }</td>
        </tr>`;
    })
    .join("");

  return `
    ${printMetaHtml("Bank Master", subtitle)}
    ${filtersHtml}

    <table class="data-table" style="margin-top: 3px !important;">
      <thead>
        <tr>
          <th width="12%" class="center">Bank</th>
          <th width="35%">Name</th>
          <th width="13%" class="center">Country</th>
          <th width="25%">Address</th>
          <th width="15%" class="center">Status</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>
  `;
}

// ─── Generic OOXML Excel builder engine ─────────────────────────────────────

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";

function xlCell(v: unknown, styleKey: string): XlCell {
  return { v, styleKey };
}

function defaultXlStyleDefs(): Record<string, any> {
  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
  return {
    title: {
      font: { bold: true, sz: 16, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font: { bold: true, sz: 10, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top: borderThin(XL_BLUE),
        bottom: borderThin(XL_BLUE),
        left: borderThin(XL_BLUE),
        right: borderThin(XL_BLUE),
      },
    },
    data: {
      font: { sz: 10 },
      alignment: { vertical: "center" },
      border: { bottom: borderThin("FFF3F4F6") },
    },
    dataCenter: {
      font: { sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
      border: { bottom: borderThin("FFF3F4F6") },
    },
    grandTotal: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    footer: {
      font: { italic: true, sz: 8, color: { rgb: "FF64748B" } },
      alignment: { horizontal: "right" },
    },
  };
}

function buildXlsxBuffer(
  sheetName: string,
  colCount: number,
  colWidth: number,
  rows_: XlRow[],
  merges: XlMerge[],
  styleDefs: Record<string, any>,
): Buffer {
  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string }
  interface FillDef { color?: string }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean }

  const fonts: FontDef[] = [{}];
  const fills: FillDef[] = [{}, {}];
  const borders: BorderDef[] = [{}];
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[] = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164;

  const registerFont = (f: any): number => {
    const def: FontDef = { bold: !!f?.bold, italic: !!f?.italic, sz: f?.sz ?? 10, color: f?.color?.rgb };
    const key = `font:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fonts.push(def);
    const idx = fonts.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerFill = (f: any): number => {
    if (!f?.fgColor?.rgb) return 0;
    const def: FillDef = { color: f.fgColor.rgb };
    const key = `fill:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fills.push(def);
    const idx = fills.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerBorder = (b: any): number => {
    if (!b) return 0;
    const def: BorderDef = {
      top: b.top?.color?.rgb,
      bottom: b.bottom?.color?.rgb,
      left: b.left?.color?.rgb,
      right: b.right?.color?.rgb,
    };
    if (!def.top && !def.bottom && !def.left && !def.right) return 0;
    const key = `border:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    borders.push(def);
    const idx = borders.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const registerNumFmt = (code?: string): number => {
    if (!code) return 0;
    const existing = numFmts.find((n) => n.code === code);
    if (existing) return existing.id;
    const id = nextCustomNumFmtId++;
    numFmts.push({ id, code });
    return id;
  };

  const registerXf = (styleObj: any): number => {
    if (!styleObj) return 0;
    const fontId = registerFont(styleObj.font);
    const fillId = registerFill(styleObj.fill);
    const borderId = registerBorder(styleObj.border);
    const numFmtId = registerNumFmt(styleObj.numFmt);
    const align = styleObj.alignment?.horizontal;
    const wrap = !!styleObj.alignment?.wrapText;
    const key = `xf:${JSON.stringify({ fontId, fillId, borderId, numFmtId, align, wrap })}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    cellXfs.push({ fontId, fillId, borderId, numFmtId, align, wrap });
    const idx = cellXfs.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const styleIndexFor = (styleKey: string): number => registerXf(styleDefs[styleKey]);

  const colXml = Array.from({ length: colCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${colWidth}" customWidth="1"/>`,
  ).join("");

  let sheetDataXml = "";
  rows_.forEach((row, ri) => {
    const rn = ri + 1;
    let rowXml = `<row r="${rn}">`;
    row.forEach((c, ci) => {
      if (c === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
      const s = styleIndexFor(c.styleKey);
      if (typeof c.v === "number") {
        rowXml += `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(c.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergesXml = merges
    .map(
      (m) =>
        `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`,
    )
    .join("");
  const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergeFinal}
</worksheet>`;

  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts
        .map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`)
        .join("")}</numFmts>`
    : "";

  const fontsXml = `<fonts count="${fonts.length}">${fonts
    .map(
      (f) => `
    <font>
        ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="10"/>'}
        ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
        <name val="Arial"/>
        ${f.bold ? "<b/>" : ""}
        ${f.italic ? "<i/>" : ""}
    </font>`,
    )
    .join("")}
</fonts>`;

  const fillsXml = `<fills count="${fills.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills
      .slice(2)
      .map(
        (f) => `
    <fill>
        <patternFill patternType="solid">
            <fgColor rgb="${f.color}"/>
            <bgColor rgb="${f.color}"/>
        </patternFill>
    </fill>`,
      )
      .join("")}
</fills>`;

  const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
  const bordersXml = `<borders count="${borders.length}">${borders
    .map(
      (b) => `
    <border>
        <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
        <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
        <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
        <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
        <diagonal/>
    </border>`,
    )
    .join("")}
</borders>`;

  const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs
    .map((xf) => {
      const applyAlign = xf.align || xf.wrap;
      return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
        ${applyAlign ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${xf.wrap ? ` wrapText="1"` : ""} vertical="center"/>` : ""}
    </xf>`;
    })
    .join("")}
</cellXfs>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    ${numFmtsXml}
    ${fontsXml}
    ${fillsXml}
    ${bordersXml}
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    ${cellXfsXml}
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Excel builder: HR Banks ────────────────────────────────────────────────

function buildExcelBuffer(rows: ReportRow[], bankCode: string): Buffer {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const COL_COUNT = 5;
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("LIST OF BANKS", "title"), null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(`Bank Code: ${bankCode || "All"}`, "meta"),
    null,
    null,
    null,
    xlCell(`Date: ${printDate}`, "meta"),
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 3 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("Bank", "header"),
    xlCell("Name", "header"),
    xlCell("Country", "header"),
    xlCell("Address", "header"),
    xlCell("Status", "header"),
  ]);

  rows.forEach((r) => {
    rows_.push([
      xlCell(text(r.bank_code), "dataCenter"),
      xlCell(text(r.bank_name), "data"),
      xlCell(text(r.country_code), "dataCenter"),
      xlCell(text(r.bank_addr1), "data"),
      xlCell(statusLabel(r.status), "dataCenter"),
    ]);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  rows_.push([xlCell(`Total Banks: ${rows.length}`, "grandTotal"), null, null, null, null]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: COL_COUNT - 1 } });

  rows_.push([null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Banks", COL_COUNT, 26, rows_, merges, defaultXlStyleDefs());
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getBankReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadData(req);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected filters." });
      return;
    }

    const companyCode = resolveHeaderCompanyCode(req, params.companyCode);
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_hr_bank",
      endLabel: "Powered by Bayanat Technology",
    });

    const filtersHtml = reportAppliedFilters(
      [{ label: "Bank Code", value: params.bankCode }],
      { includeAll: false },
    );

    const bodyHtml = renderBody(rows, filtersHtml);

    const html = buildReportDocument({
      title: "Bank Master",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: BANK_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Bank Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportBankReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadData(req);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected filters." });
      return;
    }

    const buffer = buildExcelBuffer(rows, params.bankCode);
    const filename = `banks_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Bank Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};