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
  loginid:        string;
  company_code:   string;
  fromdate:       string; // "All" or "YYYY-MM-DD"
  todate:         string;
  ac_code:        string; // "All" or supplier code
  po_number:      string; // "All" or numeric doc_no
  prod_code_from: string; // "All" or code
  prod_code_to:   string; // "All" or code
  with_so_ref:    string; // "Y" | "N"
}

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
  if (Number.isInteger(n)) {
    return n.toLocaleString("en-US");
  }
  return n.toLocaleString("en-US", {
    maximumFractionDigits: 3,
    minimumFractionDigits: 0,
  });
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

// ─── Data loader ────────────────────────────────────────────────────────────

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
         PROC_BUILD_DYNAMIC_SQL_PO_ORDER_REGISTER(
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

// ─── Report line model ──────────────────────────────────────────────────────

interface PoGroup {
  doc_no: string;
  doc_date: any;
  ac_name: string;
  cancelled: boolean;
  rows: ReportRow[];
  qtyTotal: number;
}

function groupByPo(rows: ReportRow[]): { groups: PoGroup[]; grandQty: number } {
  const byDoc = new Map<string, PoGroup>();
  const order: string[] = [];

  for (const r of rows) {
    const key = text(r.doc_no);
    if (!byDoc.has(key)) {
      byDoc.set(key, {
        doc_no: key,
        doc_date: r.doc_date,
        ac_name: text(r.ac_name),
        cancelled: text(r.cancelled).toUpperCase() === "Y",
        rows: [],
        qtyTotal: 0,
      });
      order.push(key);
    }
    const g = byDoc.get(key)!;
    g.rows.push(r);
    g.qtyTotal += num(r.quantity);
  }

  const groups = order.map((k) => byDoc.get(k)!);
  const grandQty = groups.reduce((s, g) => s + g.qtyTotal, 0);

  return { groups, grandQty };
}

// ─── HTML renderer (same visual system as Purchase Order report) ──────────

const REPORT_TITLE = "Purchase Orders";
const REPORT_SUBTITLE = "Order Register";

/** PO Register-only layout CSS (shared header/footer/table CSS comes from report_common) */
const PO_REGISTER_EXTRA_CSS = `
  @page {
    size: A4 landscape;
    margin: 8mm;
  }

  .po-register {
    font-size: 9.5px;
    line-height: 1.25;
    color: #1e293b;
  }

  .po-register .title {
    margin: 0 0 2px 0 !important;
    padding: 0 !important;
  }
  .po-register .title h1 {
    margin: 0 !important;
    padding: 0 !important;
    line-height: 1.2;
  }
  .po-register .title .sub {
    margin: 0 !important;
    padding: 0 !important;
    line-height: 1.3;
  }

  .po-register table.data-table {
    margin-top: 4px !important;
  }
  .po-register table.data-table th {
    padding: 5px 6px;
    font-size: 9px;
    background: #0b4ca1;
    color: #fff;
    text-align: left;
  }
  .po-register table.data-table th.right,
  .po-register table.data-table td.right {
    text-align: right;
  }
  .po-register table.data-table td {
    padding: 4px 6px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }

  .po-register .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 9px;
    font-weight: 700;
    background: #fee2e2;
    color: #dc2626;
    vertical-align: middle;
  }

  .po-register .empty {
    padding: 28px;
    margin-top: 8px;
    font-size: 11px;
    text-align: center;
    color: #64748b;
  }

  /* ── PO group header / subtotal / grand total (light blue) ── */
  .po-register tr.po-head td,
  .po-register tr.po-total td,
  .po-register tr.po-grand td {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    color: #0b3d91 !important;
    font-weight: 700;
  }
  .po-register tr.po-head td {
    background: #dce6f4 !important;
    padding: 6px 8px;
  }
  .po-register tr.po-head td:first-child { border-left: 3px solid #0b4ca1; }
  .po-register tr.po-total td {
    background: #f4f7fb !important;
    border-top: 1px solid #c5d5ea;
    padding: 5px 6px;
  }
  .po-register tr.po-grand td {
    background: #cfe0f5 !important;
    border-top: 2px solid #0b4ca1;
    padding: 8px 6px;
    font-size: 11px;
  }
  .po-register tbody.po-group { break-inside: avoid; page-break-inside: avoid; }
`;


// ─── Excel builder (raw OOXML, PR-style styling engine) ───────────────────


function renderPoRegisterBody(rows: ReportRow[], loginId: string): string {
  const { groups, grandQty } = groupByPo(rows);

  const EX = "-webkit-print-color-adjust:exact;print-color-adjust:exact;";
  const S = {
    head:  `background:#dce6f4 !important;color:#0b3d91 !important;font-weight:700;padding:6px 8px;border-left:3px solid #0b4ca1;${EX}`,
    total: `background:#f4f7fb !important;color:#0b3d91 !important;font-weight:700;padding:5px 6px;border-top:1px solid #c5d5ea;${EX}`,
    grand: `background:#cfe0f5 !important;color:#0b3d91 !important;font-weight:700;padding:8px 6px;border-top:2px solid #0b4ca1;font-size:11px;${EX}`,
    th:    `background:#e8f0fa !important;color:#0b4ca1 !important;font-weight:700;padding:5px 6px;text-align:left;border-bottom:2px solid #0b4ca1;${EX}`,
    thR:   `background:#e8f0fa !important;color:#0b4ca1 !important;font-weight:700;padding:5px 6px;text-align:right;border-bottom:2px solid #0b4ca1;${EX}`,
    td:    "padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;",
    tdR:   "padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;text-align:right;white-space:nowrap;",
  };

  const groupsHtml = groups
    .map((g) => {
      const lines = g.rows
        .map(
          (r) => `
        <tr>
          <td style="${S.td}">${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}</td>
          <td style="${S.td}">${escapeHtml(dateText(r.required_dt || r.doc_date))}</td>
          <td style="${S.td}">${escapeHtml(r.remarks || r.det_remarks)}</td>
          <td class="right num" style="${S.tdR}">${qtyFmt(r.quantity)}</td>
          <td style="${S.td}">${escapeHtml(r.l_uom)}</td>
        </tr>`
        )
        .join("");

      return `
      <tbody style="break-inside:avoid;page-break-inside:avoid;">
        <tr>
          <td colspan="5" class="section-strip" style="${S.head}">
            PO NO = ${escapeHtml(g.doc_no)}
            &nbsp;|&nbsp; PO Date = ${escapeHtml(dateText(g.doc_date))}
            &nbsp;|&nbsp; Supplier = ${escapeHtml(g.ac_name)}
            ${g.cancelled ? "&nbsp;|&nbsp; Status = Cancelled" : ""}
          </td>
        </tr>
        ${lines}
        <tr class="subtotal-row">
          <td colspan="3" style="${S.total}">Total for : ${escapeHtml(g.doc_no)}</td>
          <td class="right num" style="${S.total} text-align:right;">${qtyFmt(g.qtyTotal)}</td>
          <td style="${S.total}"></td>
        </tr>
      </tbody>`;
    })
    .join("");

  return `
  <div class="po-register" style="font-size:9.5px;line-height:1.25;color:#1e293b;">
    <div style="margin:0 0 6px 0;padding:0;">
      <h1 style="margin:0;padding:0;font-size:16px;font-weight:800;color:#0b4ca1;line-height:1.2;">
        Purchase Orders - Order Register
      </h1>
    </div>

    ${
      rows.length === 0
        ? `<div style="padding:28px;margin-top:8px;font-size:11px;text-align:center;color:#64748b;">No records found for the selected filters.</div>`
        : `
      <table class="data-table" style="margin-top:8px;border-collapse:collapse;width:100%;">
        <thead>
          <tr>
            <th style="${S.th}">Product</th>
            <th style="${S.th}">Required Date</th>
            <th style="${S.th}">Remarks</th>
            <th class="right" style="${S.thR}">P.O Qty</th>
            <th style="${S.th}">UOM</th>
          </tr>
        </thead>
        ${groupsHtml}
        <tbody>
          <tr class="grand-total-row">
            <td colspan="3" style="${S.grand}">Grand Total Qty</td>
            <td class="right num" style="${S.grand} text-align:right;">${qtyFmt(grandQty)}</td>
            <td style="${S.grand}"></td>
          </tr>
        </tbody>
      </table>`
    }
  </div>`;
}


function buildExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const BLUE = "FF1D4ED8";
  const WHITE = "FFFFFFFF";

  const COL_COUNT = 5; // Product, Required Date, Remarks, P.O Qty, UOM

interface XlCell { v: unknown; styleKey: string }
type Row = (XlCell | null)[];
const rows_: Row[] = [];
const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });
const blanks = (n: number): null[] => new Array(n).fill(null);
const mergeRow = (r: number, c1 = 0, c2 = COL_COUNT - 1) => merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

// Title
rows_.push([cell("Purchase Orders - Order Register", "title"), ...blanks(4)]);
mergeRow(0);

// Meta
rows_.push([cell(`Print Date: ${printDateTime}`, "meta"), null, cell(`Print User: ${loginId}`, "meta"), null, null]);
mergeRow(1, 0, 1);
mergeRow(1, 2, 4);

rows_.push(blanks(COL_COUNT));

// Header
rows_.push([
  cell("Product", "header"), cell("Required Date", "header"), cell("Remarks", "header"),
  cell("P.O Qty", "header"), cell("UOM", "header"),
]);

// Groups
const { groups, grandQty } = groupByPo(rows);

groups.forEach((g) => {
  const hr = rows_.length;
  rows_.push([
    cell(
      `PO NO = ${g.doc_no}   |   PO Date = ${dateText(g.doc_date)}   |   Supplier = ${g.ac_name}${g.cancelled ? "   |   Status = Cancelled" : ""}`,
      "poHead"
    ),
    ...blanks(4),
  ]);
  mergeRow(hr);

  g.rows.forEach((r) => {
    rows_.push([
      cell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
      cell(dateText(r.required_dt || r.doc_date), "data"),
      cell(text(r.remarks || r.det_remarks), "data"),
      cell(num(r.quantity), "dataNum"),
      cell(text(r.l_uom), "data"),
    ]);
  });

  const tr = rows_.length;
  rows_.push([cell(`Total for : ${g.doc_no}`, "poTotal"), null, null, cell(g.qtyTotal, "poTotalNum"), null]);
  mergeRow(tr, 0, 2);
});

rows_.push(blanks(COL_COUNT));

// Grand total
const gtRow = rows_.length;
rows_.push([cell("Grand Total Qty", "grandTotal"), null, null, cell(grandQty, "grandTotalNum"), null]);
mergeRow(gtRow, 0, 2);

// Footer
rows_.push([null, null, null, null, cell("Powered by Bayanat Technology", "footer")]);

  // ── Style definitions ──
  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
    const styleDefs: Record<string, any> = {
    title: {
      font: { bold: true, sz: 16, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top: borderThin(BLUE), bottom: borderThin(BLUE),
        left: borderThin(BLUE), right: borderThin(BLUE),
      },
    },
    data: {
      font: { sz: 10 },
      alignment: { vertical: "center" },
      border: { bottom: borderThin("FFF3F4F6") },
    },
    dataNum: {
      font: { sz: 10 },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
      border: { bottom: borderThin("FFF3F4F6") },
    },
    footer: {
      font: { italic: true, sz: 8, color: { rgb: "FF64748B" } },
      alignment: { horizontal: "right" },
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
  };

  // ── Style registration engine ──
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
      top: b.top?.color?.rgb, bottom: b.bottom?.color?.rgb,
      left: b.left?.color?.rgb, right: b.right?.color?.rgb,
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

  // ── Sheet XML ──
  const colWidths = [42, 16, 32, 14, 10];
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

  const mergesXml = merges.map((m) =>
    `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`
  ).join("");
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
  console.log(">>> PO ORDER REGISTER V2 CODE LOADED <<<");
  try {
    const params = extractParams(req);
    const rows = await loadPoOrderRegisterData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const companyCode =
      params.company_code ||
      text(req.user?.company_code) ||
      text(req.query.company_code) ||
      "BSG";

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "rpt_po_order_register",
      userName: params.loginid,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml = renderPoRegisterBody(rows, params.loginid);

    const html = buildReportDocument({
      title: `${REPORT_TITLE} - ${REPORT_SUBTITLE}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PO_REGISTER_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
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
    const buffer = buildExcelBuffer(rows, params.loginid);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="PO_Order_Register_Report.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("PO Order Register Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};