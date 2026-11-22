import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../../controllers/common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:      string;
  company_code: string;
  doc_type:     string; // "SDN" or "All"
  fromdate:     string; // "All" or "YYYY-MM-DD"
  todate:       string;
  ac_code:      string; // "All" or customer code
  prod_codes:   string; // "All" or comma separated product codes
}

const PROC_PARAM = "SDN_REGISTER_LISTING";
const REPORT_TITLE = "Delivery Note Listing";
const REPORT_NAME = "rpt_sales_dn_listing";
const NO_DATA_MESSAGE =
  "No delivery notes were found for the selected filters. Please adjust the date range, customer or product and try again.";

// ─── DB helpers ─────────────────────────────────────────────────────────────

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

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
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

// Same rules as the single Delivery Note report
const flagY = (v: unknown) => ["Y", "YES", "1", "TRUE"].includes(text(v).trim().toUpperCase());
const isCancelledRow = (r: ReportRow): boolean =>
  flagY(r.cancelled) || flagY(r.canceled) || flagY(r.det_cancel);

const qtyOf = (r: ReportRow) => num(r.quantity) || num(r.qty_puom);
const uomOf = (r: ReportRow) => text(r.p_uom || r.uom || r.l_uom);

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const b = req.body || {};
  return {
    loginid:      text(req.user?.loginid) || text(b.loginid) || "ADMIN",
    company_code: text(b.company_code) || text(req.user?.company_code),
    doc_type:     text(b.doc_type) || "SDN",
    fromdate:     text(b.fromdate) || "All",
    todate:       text(b.todate) || "All",
    ac_code:      text(b.ac_code) || "All",
    prod_codes:   text(b.prod_codes) || "All",
  };
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadSalesDnListingData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const toDate = (iso: string): Date | null => {
      if (!iso || iso.toUpperCase() === "ALL") return null;
      const d = new Date(iso + "T00:00:00");
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const binds: any = {
      parameter: PROC_PARAM,
      loginid: p.loginid,
      code1: p.company_code || null,
      code2: p.doc_type || null,
      code3: p.ac_code || null,
      code4: p.prod_codes || null,
      number1: null,
      number2: null,
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
         v_sql CLOB;
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_SALES_DN(
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

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping model (one group per delivery note) ──────────────────────────

interface DnGroup {
  doc_no: string;
  doc_date: any;
  customer: string;
  delivery_to: string;
  sold_by: string;
  cancelled: boolean;
  rows: ReportRow[];
  qtyTotal: number;
}

function groupByDn(rows: ReportRow[]): { groups: DnGroup[]; grandQty: number } {
  const byDoc = new Map<string, DnGroup>();
  const order: string[] = [];

  for (const r of rows) {
    const key = `${text(r.doc_type)}|${text(r.doc_no)}`;
    if (!byDoc.has(key)) {
      byDoc.set(key, {
        doc_no: text(r.doc_no),
        doc_date: r.doc_date,
        customer: text(r.party_name) || text(r.ac_name) || text(r.ac_code),
        delivery_to: text(r.delivery_to) || text(r.dlvr_term),
        sold_by: text(r.user_id),
        cancelled: false,
        rows: [],
        qtyTotal: 0,
      });
      order.push(key);
    }
    const g = byDoc.get(key)!;
    g.rows.push(r);
    g.qtyTotal += qtyOf(r);
  }

  const groups = order.map((k) => {
    const g = byDoc.get(k)!;
    g.cancelled = g.rows.length > 0 && g.rows.every(isCancelledRow);
    return g;
  });

  const grandQty = groups.reduce((s, g) => s + g.qtyTotal, 0);
  return { groups, grandQty };
}

function groupHeadParts(g: DnGroup): string[] {
  const parts = [
    `DN No = ${g.doc_no}`,
    `Date = ${dateText(g.doc_date)}`,
    `Customer = ${g.customer}`,
  ];
  if (g.delivery_to) parts.push(`Delivery To = ${g.delivery_to}`);
  if (g.sold_by) parts.push(`Sold By = ${g.sold_by}`);
  if (g.cancelled) parts.push("Status = Cancelled");
  return parts;
}

function productText(r: ReportRow): string {
  return `${text(r.prod_code)} ${text(r.full_prod_name || r.prod_name)}${r.det_remarks ? ` — ${text(r.det_remarks)}` : ""}`.trim();
}

// ─── HTML renderer ──────────────────────────────────────────────────────────
// Note: only the shared report_common classes (data-table, right, num, subtotal-row,
// grand-total-row) are reliable in the exported PDF. Inline styles are for the screen preview.

const SDN_LISTING_EXTRA_CSS = `
  .sdn-listing { font-size: 9.5px; line-height: 1.25; color: #1e293b; }
`;

const S = {
  head:  "background:#dce6f4 !important;color:#0b3d91 !important;font-weight:700;padding:6px 8px;border-left:3px solid #0b4ca1;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  total: "background:#f4f7fb !important;color:#0b3d91 !important;font-weight:700;padding:5px 6px;border-top:1px solid #c5d5ea;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  grand: "background:#cfe0f5 !important;color:#0b3d91 !important;font-weight:700;padding:8px 6px;border-top:2px solid #0b4ca1;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  th:    "background:#e8f0fa !important;color:#0b4ca1 !important;font-weight:700;padding:5px 6px;text-align:left;border-bottom:2px solid #0b4ca1;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  thR:   "background:#e8f0fa !important;color:#0b4ca1 !important;font-weight:700;padding:5px 6px;text-align:right;border-bottom:2px solid #0b4ca1;-webkit-print-color-adjust:exact;print-color-adjust:exact;",
  td:    "padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;",
  tdR:   "padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;text-align:right;white-space:nowrap;",
};

// Columns: Product, Unit, Qty
const COLS = 3;
const LABEL_COLS = 2; // label spans Product + Unit

function renderSalesDnListingBody(rows: ReportRow[]): string {
  const { groups, grandQty } = groupByDn(rows);

  const groupsHtml = groups
    .map((g) => {
      const lines = g.rows
        .map(
          (r) => `
        <tr>
          <td style="${S.td}">${escapeHtml(productText(r))}</td>
          <td style="${S.td}">${escapeHtml(uomOf(r))}</td>
          <td class="right num" style="${S.tdR}">${qtyFmt(qtyOf(r))}</td>
        </tr>`
        )
        .join("");

      return `
      <tbody style="break-inside:avoid;page-break-inside:avoid;">
        <tr class="grand-total-row">
          <td colspan="${COLS}" style="${S.head}">${groupHeadParts(g).map(escapeHtml).join(" &nbsp;|&nbsp; ")}</td>
        </tr>
        ${lines}
        <tr class="subtotal-row">
          <td colspan="${LABEL_COLS}" style="${S.total}">Total for : ${escapeHtml(g.doc_no)}</td>
          <td class="right num" style="${S.total} text-align:right;">${qtyFmt(g.qtyTotal)}</td>
        </tr>
      </tbody>`;
    })
    .join("");

  const grandHtml = `
          <tr class="grand-total-row">
            <td colspan="${LABEL_COLS}" style="${S.grand}">Grand Total Quantity</td>
            <td class="right num" style="${S.grand} text-align:right;">${qtyFmt(grandQty)}</td>
          </tr>`;

  return `
  <div class="sdn-listing" style="font-size:9.5px;line-height:1.25;color:#1e293b;">
        <table class="si-top-line"><tbody><tr><td>
      <h1 class="report-title">${escapeHtml(REPORT_TITLE)}</h1>
    </td></tr></tbody></table>

    ${
      rows.length === 0
        ? `<div style="padding:28px;margin-top:8px;font-size:11px;text-align:center;color:#64748b;">No records found for the selected filters.</div>`
        : `
      <table class="data-table" style="margin-top:8px;border-collapse:collapse;width:100%;table-layout:fixed;">
        <colgroup><col style="width:66%"/><col style="width:14%"/><col style="width:20%"/></colgroup>
        <thead>
          <tr>
            <th style="${S.th}">Product / Description</th>
            <th style="${S.th}">Unit</th>
            <th class="right" style="${S.thR}">Qty</th>
          </tr>
        </thead>
        ${groupsHtml}
        <tbody>${grandHtml}
        </tbody>
      </table>`
    }
  </div>`;
}

// ─── Excel (raw OOXML) ──────────────────────────────────────────────────────

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";

const xlCell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });
const xlBorderThin = (color: string) => ({ style: "thin", color: { rgb: color } });

const XL_STYLE_DEFS: Record<string, any> = {
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
    border: { top: xlBorderThin(XL_BLUE), bottom: xlBorderThin(XL_BLUE), left: xlBorderThin(XL_BLUE), right: xlBorderThin(XL_BLUE) },
  },
  data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: xlBorderThin("FFF3F4F6") } },
  dataNum: {
    font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.000", border: { bottom: xlBorderThin("FFF3F4F6") },
  },
  poHead: {
    font: { bold: true, sz: 10, color: { rgb: "FF0B3D91" } },
    fill: { fgColor: { rgb: "FFDCE6F4" } },
    alignment: { horizontal: "left", vertical: "center" },
  },
  poTotal: {
    font: { bold: true, sz: 10, color: { rgb: "FF0B3D91" } },
    fill: { fgColor: { rgb: "FFF4F7FB" } },
    alignment: { horizontal: "left", vertical: "center" },
  },
  poTotalNum: {
    font: { bold: true, sz: 10, color: { rgb: "FF0B3D91" } },
    fill: { fgColor: { rgb: "FFF4F7FB" } },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.000",
  },
  grandTotal: {
    font: { bold: true, sz: 11, color: { rgb: "FF0B3D91" } },
    fill: { fgColor: { rgb: "FFCFE0F5" } },
    alignment: { horizontal: "left", vertical: "center" },
  },
  grandTotalNum: {
    font: { bold: true, sz: 11, color: { rgb: "FF0B3D91" } },
    fill: { fgColor: { rgb: "FFCFE0F5" } },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.000",
  },
  footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },
};

function buildXlsx(sheetName: string, colWidths: number[], rows_: XlRow[], merges: XlMerge[]): Buffer {
  const styleDefs = XL_STYLE_DEFS;

  interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

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
      top: b.top?.color?.rgb, bottom: b.bottom?.color?.rgb, left: b.left?.color?.rgb, right: b.right?.color?.rgb,
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

  const colXml = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

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
    .map((m) => `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`)
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
    ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`).join("")}</numFmts>`
    : "";

  const fontsXml = `<fonts count="${fonts.length}">${fonts.map((f) => `
    <font>
        ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="10"/>'}
        ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
        <name val="Arial"/>
        ${f.bold ? "<b/>" : ""}
        ${f.italic ? "<i/>" : ""}
    </font>`).join("")}
</fonts>`;

  const fillsXml = `<fills count="${fills.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills.slice(2).map((f) => `
    <fill>
        <patternFill patternType="solid">
            <fgColor rgb="${f.color}"/>
            <bgColor rgb="${f.color}"/>
        </patternFill>
    </fill>`).join("")}
</fills>`;

  const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
  const bordersXml = `<borders count="${borders.length}">${borders.map((b) => `
    <border>
        <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
        <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
        <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
        <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
        <diagonal/>
    </border>`).join("")}
</borders>`;

  const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs.map((xf) => {
    const applyAlign = xf.align || xf.wrap;
    return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
        ${applyAlign ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${xf.wrap ? ` wrapText="1"` : ""} vertical="center"/>` : ""}
    </xf>`;
  }).join("")}
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

function buildSalesDnListingExcel(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const { groups, grandQty } = groupByDn(rows);
  const COL_COUNT = 3;
  const blanks = (n: number): null[] => new Array(n).fill(null);
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];
  const mergeRow = (r: number, c1 = 0, c2 = COL_COUNT - 1) => merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  // Title
  rows_.push([xlCell(REPORT_TITLE, "title"), ...blanks(COL_COUNT - 1)]);
  mergeRow(0);

  // Meta
  rows_.push([
    xlCell(`Print Date: ${printDateTime}`, "meta"), null,
    xlCell(`Print User: ${loginId}`, "meta"),
  ]);
  mergeRow(1, 0, 1);

  rows_.push(blanks(COL_COUNT));

  // Header
  rows_.push([
    xlCell("Product / Description", "header"), xlCell("Unit", "header"), xlCell("Qty", "header"),
  ]);

  // Groups
  groups.forEach((g) => {
    const hr = rows_.length;
    rows_.push([xlCell(groupHeadParts(g).join("   |   "), "poHead"), ...blanks(COL_COUNT - 1)]);
    mergeRow(hr);

    g.rows.forEach((r) => {
      rows_.push([
        xlCell(productText(r), "data"),
        xlCell(uomOf(r), "data"),
        xlCell(qtyOf(r), "dataNum"),
      ]);
    });

    const tr = rows_.length;
    rows_.push([xlCell(`Total for : ${g.doc_no}`, "poTotal"), null, xlCell(g.qtyTotal, "poTotalNum")]);
    mergeRow(tr, 0, 1);
  });

  rows_.push(blanks(COL_COUNT));

  // Grand total
  const gr = rows_.length;
  rows_.push([xlCell("Grand Total Quantity", "grandTotal"), null, xlCell(grandQty, "grandTotalNum")]);
  mergeRow(gr, 0, 1);

  // Footer
  rows_.push([...blanks(COL_COUNT - 1), xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsx("DN Listing", [60, 12, 16], rows_, merges);
}

// ─── Route handlers ─────────────────────────────────────────────────────────

export const getSalesDnListingReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesDnListingData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: NO_DATA_MESSAGE });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: REPORT_NAME,
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderSalesDnListingBody(rows);

    const html = buildReportDocument({
      title: REPORT_TITLE,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: SDN_LISTING_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      orientation: "portrait",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Sales DN Listing HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getSalesDnListingReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows = await loadSalesDnListingData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: NO_DATA_MESSAGE });
      return;
    }
    const buffer = buildSalesDnListingExcel(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Delivery_Note_Listing.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("Sales DN Listing Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};