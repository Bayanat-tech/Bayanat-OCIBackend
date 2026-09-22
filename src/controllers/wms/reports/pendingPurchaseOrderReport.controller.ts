import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../../controllers/common/report_common";
const AdmZip = require("adm-zip");

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = "Summary" | "Detail";
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

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${formatted})` : formatted;
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

function formatDate(value: unknown): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return text(value);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function docLabel(docType: unknown, docNo: unknown): string {
  const t = text(docType).trim();
  const n = text(docNo).trim();
  if (t && n) return `${t} ${n}`;
  return t || n || "";
}

// ─── Request Param Parser ────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  const body = req.body || {};

  const companyCode = text(body.company_code || body.code1 || req.user?.company_code || "").trim() || "All";
  const supplierCode = text(body.supplier_code || body.code2 || "All").trim() || "All";
  const productFrom = text(body.product_from || body.code3 || "All").trim() || "All";
  const productTo = text(body.product_to || body.code4 || "All").trim() || "All";
  const cancelled = text(body.cancelled || body.code5 || "N").toUpperCase() === "Y" ? "Y" : "N";
  const docNoRaw = body.doc_no ?? body.number1 ?? 0;
  const docNo = Number(docNoRaw) || 0;

  const dateFrom = body.date_from || body.date1 || null;
  const dateTo = body.date_to || body.date2 || null; // exclusive if frontend adds +1 day

  const reportType: ReportType =
    text(body.report_type || body.reportType || "Summary") === "Detail"
      ? "Detail"
      : "Summary";

  return {
    companyCode,
    supplierCode,
    productFrom,
    productTo,
    cancelled,
    docNo,
    dateFrom,
    dateTo,
    reportType,
    loginId: req.user?.loginid ?? "",
  };
}

/** Company code for the letterhead lookup — independent of the (possibly "All") query filter. */
function resolveHeaderCompanyCode(req: RequestWithUser, companyCode: string): string {
  if (companyCode && companyCode.toUpperCase() !== "ALL") return companyCode;
  return text(req.user?.company_code) || text(req.query.company_code) || "BSG";
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadPendingPOData(req: RequestWithUser, p: ReturnType<typeof parseParams>): Promise<ReportRow[]> {
  const conn = await getConn(req);

  try {
    // Built dynamically: a predicate (and its bind) is only included when
    // that filter is actually set to something specific. The previous
    // ":param = 'All' OR column OP :param" form still forced Oracle to
    // evaluate/bind the second branch even when the first was true — OR
    // doesn't guarantee row-level short-circuit — so the 'All' sentinel
    // could get implicitly converted against a numeric/date column
    // (VW_ERP_PURORDER, unlike the newer WMS views, isn't guaranteed to
    // have those columns as VARCHAR2), throwing ORA-01722.
    const conditions: string[] = ["COMPANY_CODE = :companyCode"];
    const binds: Record<string, any> = { companyCode: p.companyCode };

    if (p.supplierCode !== "All") {
      conditions.push("AC_CODE = :supplierCode");
      binds.supplierCode = p.supplierCode;
    }
    if (p.productFrom !== "All") {
      conditions.push("PROD_CODE >= :productFrom");
      binds.productFrom = p.productFrom;
    }
    if (p.productTo !== "All") {
      conditions.push("PROD_CODE <= :productTo");
      binds.productTo = p.productTo;
    }
    if (p.cancelled !== "Y") {
      conditions.push("NVL(CANCELLED, 'N') <> 'Y'");
    }
    if (p.docNo) {
      conditions.push("DOC_NO = :docNo");
      binds.docNo = p.docNo;
    }
    if (p.dateFrom) {
      conditions.push("DOC_DATE >= TO_DATE(:dateFrom, 'YYYY-MM-DD')");
      binds.dateFrom = p.dateFrom;
    }
    if (p.dateTo) {
      conditions.push("DOC_DATE < TO_DATE(:dateTo, 'YYYY-MM-DD')");
      binds.dateTo = p.dateTo;
    }
    conditions.push("QTY_BALANCE > 0");

    const whereClause = conditions.join("\n          AND ");

    // Detail = line level from vw_erp_purorder
    // Summary = aggregated per document
    if (p.reportType === "Detail") {
      const sql = `
        SELECT
          DOC_TYPE,
          DOC_NO,
          DOC_DATE,
          DIV_NAME,
          AC_NAME,
          REMARKS,
          AC_CODE,
          PROD_CODE,
          PROD_NAME,
          DET_REMARKS,
          L_UOM,
          QUANTITY,
          REQUIRED_DT,
          QTY_PROCESSED,
          QTY_BALANCE,
          NVL(CANCELLED, 'N') AS CANCELLED
        FROM VW_ERP_PURORDER
        WHERE ${whereClause}
        ORDER BY DOC_DATE DESC, DOC_NO, PROD_CODE
      `;

      const result = await conn.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      return normalize(result.rows as any[]);
    }

    // Summary
    const sql = `
      SELECT
        DOC_TYPE,
        DOC_NO,
        DOC_DATE,
        MAX(DIV_NAME) AS DIV_NAME,
        MAX(AC_NAME) AS AC_NAME,
        MAX(REMARKS) AS REMARKS,
        MAX(AC_CODE) AS AC_CODE,
        SUM(QUANTITY) AS TOTAL_QTY,
        SUM(QTY_PROCESSED) AS PROCESS_QTY,
        COUNT(*) AS NO_ITEMS,
        SUM(QTY_BALANCE) AS QTY_BALANCE
      FROM VW_ERP_PURORDER
      WHERE ${whereClause}
      GROUP BY DOC_TYPE, DOC_NO, DOC_DATE
      ORDER BY DOC_DATE DESC, DOC_NO
    `;

    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping (Detail) ────────────────────────────────────────────────────────

interface DetailGroup {
  key: string;
  header: ReportRow;
  lines: ReportRow[];
  totalQty: number;
}

function groupDetailByDoc(rows: ReportRow[]): DetailGroup[] {
  const map = new Map<string, DetailGroup>();
  const order: string[] = [];

  rows.forEach((r) => {
    const key = `${text(r.doc_type)}|${text(r.doc_no)}`;
    if (!map.has(key)) {
      map.set(key, { key, header: r, lines: [], totalQty: 0 });
      order.push(key);
    }
    const g = map.get(key)!;
    g.lines.push(r);
    g.totalQty += num(r.quantity);
  });

  return order.map((k) => map.get(k)!);
}

function periodLabel(dateFrom: string | null, dateTo: string | null): { from: string; to: string } {
  const from = dateFrom ? formatDate(dateFrom) : "";
  let to = "";
  if (dateTo) {
    // dateTo is exclusive (+1 day from UI); show inclusive end as -1 day for the title
    const d = new Date(dateTo);
    to = isNaN(d.getTime()) ? formatDate(dateTo) : formatDate((() => { d.setDate(d.getDate() - 1); return d; })());
  }
  return { from, to };
}

// ─── Layout CSS — same visual system as PO Order Register ─────────────────

const PENDING_PO_EXTRA_CSS = `
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
  .doc-title-row .doc-sub {
    margin: 2px 0 0;
    font-size: 11px;
    color: #64748b;
  }
  .doc-title-row .print-meta {
    text-align: right;
    font-size: 10.5px;
    color: #475569;
    line-height: 1.4;
  }
  .status-badge {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    vertical-align: middle;
  }
  .status-CANCELLED { background: #fee2e2; color: #dc2626; }

  .po-group {
    margin-bottom: 16px;
    break-inside: avoid;
  }
  .po-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-bottom: none;
    border-radius: 10px 10px 0 0;
  }
  .po-group-header .doc-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    display: block;
  }
  .po-group-header .supplier-name {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
  }

  table.data-table.grouped {
    border: 1px solid #e2e8f0;
    border-top: none;
    border-radius: 0 0 10px 10px;
    overflow: hidden;
  }

  .subtotal-row td {
    background: #eef2f7;
    font-weight: 700;
    color: #1e3a8a;
  }

  .grand-total-box {
    margin-top: 16px;
    margin-left: auto;
    width: 260px;
    border-radius: 10px;
    overflow: hidden;
  }
  .grand-total-box .row {
    display: flex;
    justify-content: space-between;
    padding: 8px 14px;
    background: #0b4ca1;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
  }
`;

function printMetaHtml(title: string, subtitle: string, printDateTime: string, loginId: string): string {
  return `
    <div class="doc-title-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="doc-sub">${escapeHtml(subtitle)}</div>
      </div>
      <div class="print-meta">
        <div>Print Date: ${escapeHtml(printDateTime)}</div>
        <div>Print User: ${escapeHtml(loginId)}</div>
      </div>
    </div>`;
}

// ─── Body: Summary ──────────────────────────────────────────────────────────

function renderSummaryBody(rows: ReportRow[], loginId: string, dateFrom: string | null, dateTo: string | null): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const { from, to } = periodLabel(dateFrom, dateTo);
  const subtitle = from || to ? `List for the Period ${from} - ${to}` : "List — All Periods";

  const totalQty = rows.reduce((s, r) => s + num(r.total_qty), 0);
  const totalBalance = rows.reduce((s, r) => s + num(r.qty_balance), 0);

  const lineRows = rows
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(docLabel(r.doc_type, r.doc_no))}</td>
          <td>${escapeHtml(formatDate(r.doc_date))}</td>
          <td>${escapeHtml(r.ac_name)}</td>
          <td class="right">${fmtNumber(num(r.total_qty))}</td>
          <td class="right amount">${fmtNumber(num(r.qty_balance))}</td>
          <td class="right">${fmtNumber(num(r.no_items))}</td>
          <td>${escapeHtml(r.remarks)}</td>
        </tr>`
    )
    .join("");

  return `
    ${printMetaHtml("Pending Purchase Orders", subtitle, printDateTime, loginId)}

    ${
      rows.length === 0
        ? `<div class="empty">No pending purchase orders found for the selected filters.</div>`
        : `
      <table class="data-table">
        <thead>
          <tr>
            <th>Document No.</th>
            <th>Doc Date</th>
            <th>Supplier</th>
            <th class="right">P.O Quantity</th>
            <th class="right">Balance Quantity</th>
            <th class="right">No. of Items</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>

      <div class="grand-total-box">
        <div class="row"><span>Total P.O Qty</span><span>${fmtNumber(totalQty)}</span></div>
      </div>
      <div class="grand-total-box" style="margin-top: 6px;">
        <div class="row"><span>Total Balance Qty</span><span>${fmtNumber(totalBalance)}</span></div>
      </div>`
    }
  `;
}

// ─── Body: Detail ───────────────────────────────────────────────────────────

function renderDetailBody(rows: ReportRow[], loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const groups = groupDetailByDoc(rows);
  const grandQty = groups.reduce((s, g) => s + g.totalQty, 0);

  const groupsHtml = groups
    .map((g) => {
      const cancelled = text(g.header.cancelled).toUpperCase() === "Y";
      const lineRows = g.lines
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.prod_code)} ${escapeHtml(r.prod_name)}</td>
          <td>${escapeHtml(formatDate(r.required_dt))}</td>
          <td>${escapeHtml(r.det_remarks)}</td>
          <td class="right amount">${fmtNumber(num(r.quantity))}</td>
          <td>${escapeHtml(r.l_uom)}</td>
        </tr>`
        )
        .join("");

      return `
      <div class="po-group">
        <div class="po-group-header">
          <div>
            <span class="doc-label">Doc No. ${escapeHtml(docLabel(g.header.doc_type, g.header.doc_no))} &bull; Doc Date ${escapeHtml(formatDate(g.header.doc_date))}</span>
            <span class="supplier-name">${escapeHtml(g.header.ac_name)}${
        cancelled ? `<span class="status-badge status-CANCELLED">Cancelled</span>` : ""
      }</span>
          </div>
        </div>
        <table class="data-table grouped">
          <thead>
            <tr>
              <th>Product</th>
              <th>Required Date</th>
              <th>Remarks</th>
              <th class="right">P.O Qty</th>
              <th>UOM</th>
            </tr>
          </thead>
          <tbody>
            ${lineRows}
            <tr class="subtotal-row">
              <td colspan="3">Total Qty for ${escapeHtml(docLabel(g.header.doc_type, g.header.doc_no))}</td>
              <td class="right">${fmtNumber(g.totalQty)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>`;
    })
    .join("");

  return `
    ${printMetaHtml("Purchase Orders", "Pending Order Detail", printDateTime, loginId)}

    ${
      rows.length === 0
        ? `<div class="empty">No pending purchase order lines found for the selected filters.</div>`
        : `
      ${groupsHtml}

      <div class="grand-total-box">
        <div class="row"><span>Grand Total Qty</span><span>${fmtNumber(grandQty)}</span></div>
      </div>`
    }
  `;
}

// ─── Generic OOXML Excel builder engine (shared style with po-order-register /
//     sales-invoice controllers — raw XML via AdmZip, no xlsx dependency) ────

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const XL_BLUE = "FF1D4ED8";
const XL_WHITE = "FFFFFFFF";
const XL_GREEN_BG = "FFD1FAE5";

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
      border: { top: borderThin(XL_BLUE), bottom: borderThin(XL_BLUE), left: borderThin(XL_BLUE), right: borderThin(XL_BLUE) },
    },
    data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: borderThin("FFF3F4F6") } },
    dataNum: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00", border: { bottom: borderThin("FFF3F4F6") },
    },
    dataNumInt: {
      font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0", border: { bottom: borderThin("FFF3F4F6") },
    },
    groupHeader: {
      font: { bold: true, sz: 11, color: { rgb: "FF111827" } },
      fill: { fgColor: { rgb: "FFDBEAFE" } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { bottom: borderThin("FFE5E7EB") },
    },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: XL_GREEN_BG } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { top: borderThin("FF065F46") },
    },
    groupTotalNum: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: XL_GREEN_BG } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00",
      border: { top: borderThin("FF065F46") },
    },
    grandTotal: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    grandTotalNum: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00",
    },
    footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },
  };
}

function buildXlsxBuffer(sheetName: string, colCount: number, colWidth: number, rows_: XlRow[], merges: XlMerge[], styleDefs: Record<string, any>): Buffer {
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

  const colXml = Array.from({ length: colCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${colWidth}" customWidth="1"/>`
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

// ─── Excel builder: Summary ─────────────────────────────────────────────────

function buildSummaryExcelBuffer(rows: ReportRow[], loginId: string, dateFrom: string | null, dateTo: string | null): Buffer {
  const printDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const { from, to } = periodLabel(dateFrom, dateTo);
  const COL_COUNT = 7; // Document No., Doc Date, Supplier, P.O Qty, Balance Qty, No. Items, Remarks
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("PENDING PURCHASE ORDERS", "title"), null, null, null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([
    xlCell(from || to ? `Period: ${from} - ${to}` : "Period: All", "meta"), null, null,
    xlCell(`Date: ${printDate}`, "meta"), null,
    xlCell(`User: ${loginId}`, "meta"), null,
  ]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
  merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: 4 } });
  merges.push({ s: { r: 1, c: 5 }, e: { r: 1, c: 6 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("Document No.", "header"), xlCell("Doc Date", "header"), xlCell("Supplier", "header"),
    xlCell("P.O Quantity", "header"), xlCell("Balance Quantity", "header"), xlCell("No. of Items", "header"),
    xlCell("Remarks", "header"),
  ]);

  let totalQty = 0;
  let totalBalance = 0;
  rows.forEach((r) => {
    totalQty += num(r.total_qty);
    totalBalance += num(r.qty_balance);
    rows_.push([
      xlCell(docLabel(r.doc_type, r.doc_no), "data"),
      xlCell(formatDate(r.doc_date), "data"),
      xlCell(text(r.ac_name), "data"),
      xlCell(num(r.total_qty), "dataNum"),
      xlCell(num(r.qty_balance), "dataNum"),
      xlCell(num(r.no_items), "dataNumInt"),
      xlCell(text(r.remarks), "data"),
    ]);
  });

  rows_.push(new Array(COL_COUNT).fill(null));

  const totalRow = rows_.length;
  rows_.push([
    xlCell("Grand Total", "grandTotal"), null, null,
    xlCell(totalQty, "grandTotalNum"), xlCell(totalBalance, "grandTotalNum"), null, null,
  ]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 2 } });
  merges.push({ s: { r: totalRow, c: 5 }, e: { r: totalRow, c: 6 } });

  rows_.push([null, null, null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Pending PO Summary", COL_COUNT, 18, rows_, merges, defaultXlStyleDefs());
}

// ─── Excel builder: Detail (grouped by document, same shape as PO Register) ─

function buildDetailExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const printDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const COL_COUNT = 5; // Product, Required Date, Remarks, P.O Qty, UOM
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];

  rows_.push([xlCell("PURCHASE ORDERS - PENDING DETAIL", "title"), null, null, null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  rows_.push([xlCell(`Date: ${printDate}`, "meta"), null, xlCell(`User: ${loginId}`, "meta"), null, null]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 4 } });

  rows_.push(new Array(COL_COUNT).fill(null));

  rows_.push([
    xlCell("Product", "header"), xlCell("Required Date", "header"), xlCell("Remarks", "header"),
    xlCell("P.O Qty", "header"), xlCell("UOM", "header"),
  ]);

  const groups = groupDetailByDoc(rows);
  let grandQty = 0;

  groups.forEach((g) => {
    const cancelled = text(g.header.cancelled).toUpperCase() === "Y";
    const rIdx = rows_.length;
    rows_.push([
      xlCell(
        `Doc No. ${docLabel(g.header.doc_type, g.header.doc_no)}   Doc Date ${formatDate(g.header.doc_date)}${cancelled ? "   Cancelled" : ""}   Supplier: ${text(g.header.ac_name)}`,
        "groupHeader"
      ),
      null, null, null, null,
    ]);
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: COL_COUNT - 1 } });

    g.lines.forEach((r) => {
      rows_.push([
        xlCell(`${text(r.prod_code)} ${text(r.prod_name)}`, "data"),
        xlCell(formatDate(r.required_dt), "data"),
        xlCell(text(r.det_remarks), "data"),
        xlCell(num(r.quantity), "dataNum"),
        xlCell(text(r.l_uom), "data"),
      ]);
    });

    const dtRow = rows_.length;
    rows_.push([xlCell(`Total Qty for ${docLabel(g.header.doc_type, g.header.doc_no)}`, "groupTotal"), null, null, xlCell(g.totalQty, "groupTotalNum"), null]);
    merges.push({ s: { r: dtRow, c: 0 }, e: { r: dtRow, c: 2 } });

    rows_.push(new Array(COL_COUNT).fill(null));
    grandQty += g.totalQty;
  });

  const gtRow = rows_.length;
  rows_.push([xlCell("Grand Total Qty", "grandTotal"), null, null, xlCell(grandQty, "grandTotalNum"), null]);
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 2 } });

  rows_.push([null, null, null, null, xlCell("Powered by Bayanat Technology", "footer")]);

  return buildXlsxBuffer("Pending PO Detail", COL_COUNT, 20, rows_, merges, defaultXlStyleDefs());
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getPendingPOReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadPendingPOData(req, params);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected filters." });
      return;
    }

    const companyCode = resolveHeaderCompanyCode(req, params.companyCode);
    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const reportSlug = params.reportType === "Summary" ? "rpt_pending_porder" : "rpt_pending_porder_detail";
    const footerHtml = reportFooter({
      reportName: reportSlug,
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });
    const bodyHtml =
      params.reportType === "Summary"
        ? renderSummaryBody(rows, params.loginId, params.dateFrom, params.dateTo)
        : renderDetailBody(rows, params.loginId);

    const html = buildReportDocument({
      title: params.reportType === "Summary" ? "Pending Purchase Orders" : "Purchase Orders - Pending Detail",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: PENDING_PO_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Pending PO Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportPendingPOReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadPendingPOData(req, params);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected filters." });
      return;
    }

    const buffer =
      params.reportType === "Summary"
        ? buildSummaryExcelBuffer(rows, params.loginId, params.dateFrom, params.dateTo)
        : buildDetailExcelBuffer(rows, params.loginId);

    const filename = `pending_po_${params.reportType.toLowerCase()}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.end(buffer);
  } catch (error: any) {
    console.error("Pending PO Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};