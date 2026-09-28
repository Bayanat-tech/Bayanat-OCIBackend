import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../../controllers/common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ProdSection {
  prodCode:    string;
  prodName:    string;
  rows:        ReportRow[];
  totalQty:    number;
  totalVolume: number;
}

interface GroupSection {
  groupName:   string;
  prods:       ProdSection[];
  totalQty:    number;
  totalVolume: number;
}

interface PrinSection {
  prinCode:    string;
  prinName:    string;
  groups:      GroupSection[];
  totalQty:    number;
  totalVolume: number;
}

interface DnParams {
  loginid:      string;
  company_code: string;
  prinCode:     string;
  fromdate:     string;
  todate:       string;
}

// ─── DB helpers (same as Sales Invoice / PO Order Register) ────────────────

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

function volFmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.000";
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// undefined / "" / "all" (any case) → "All"
function normalizeFilter(value: unknown): string {
  const v = text(value).trim();
  if (!v || v.toUpperCase() === "ALL") return "All";
  return v;
}

// "P001,P002" → ["P001","P002"]; null for "All" or a single code (proc handles those natively)
function parseMultiCodeFilter(value: string): string[] | null {
  if (value === "All") return null;
  if (!value.includes(",")) return null;
  const list = value.split(",").map((c) => c.trim()).filter(Boolean);
  return list.length > 1 ? list : null;
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): DnParams {
  const src = { ...(req.query as any), ...(req.body || {}) };
  return {
    loginid:      text(req.user?.loginid) || text(src.loginid) || "ADMIN",
    company_code: text(src.company_code),
    prinCode:     normalizeFilter(src.code2),
    fromdate:     normalizeFilter(src.code3),
    todate:       normalizeFilter(src.code4),
  };
}

function resolveCompanyCode(req: RequestWithUser, params: DnParams): string {
  return (
    params.company_code ||
    text(req.user?.company_code) ||
    text((req.query as any).company_code) ||
    "BSG"
  );
}

// ─── Data loader ────────────────────────────────────────────────────────────

async function loadDnData(req: RequestWithUser, params: DnParams): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    // The proc only supports single-value equality on PRIN_CODE (or "All").
    // For 2+ principals we ask for everything and narrow down in JS below.
    const multiCodes   = parseMultiCodeFilter(params.prinCode);
    const procPrinCode = multiCodes ? "All" : params.prinCode;

    const binds: Record<string, any> = {
      parameter: "WMS_Stock_DN_Summary_Report",
      loginid:   params.loginid,

      code1:  (req.body || {}).code1 || null,
      code2:  procPrinCode,
      code3:  params.fromdate,
      code4:  params.todate,
      code5:  null, code6: null, code7: null, code8: null, code9: null,

      ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`code${i + 10}`, null])),

      number1: null, number2: null, number3: null, number4: null,
      date1:   null, date2:   null, date3:   null, date4:   null,

      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const procResult = await conn.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_COMMON20(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,  :code5,  :code6,  :code7,  :code8,  :code9,  :code10,
           :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      binds
    );

    const rawSql = (procResult.outBinds as any).out_sql as string | null;
    if (!rawSql) {
      throw new Error(
        "PROC_BUILD_DYNAMIC_SQL_COMMON20 returned no SQL. " +
        "Ensure the WHEN 'WMS_Stock_DN_Summary_Report' branch exists in the procedure."
      );
    }
    console.log("=== GENERATED SQL (DN Summary) ===\n", rawSql, "\n=== END ===");
    if (multiCodes) console.log("[DnSummaryReport] Multi-principal filter, narrowing client-side to:", multiCodes);

    const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    let rows = normalize(dataResult.rows as any[]);

    if (multiCodes) {
      const wanted = new Set(multiCodes.map((c) => c.toUpperCase()));
      rows = rows.filter((r) => wanted.has(text(r.prin_code).trim().toUpperCase()));
    }
    return rows;
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping ───────────────────────────────────────────────────────────────

function rowQty(r: ReportRow): number {
  return num(r.qty ?? r.quantity ?? r.qty_puom);
}

function groupRows(rows: ReportRow[]): PrinSection[] {
  const prinMap: Record<string, {
    prinCode: string; prinName: string;
    groups: Record<string, {
      groupName: string;
      prods: Record<string, ProdSection>;
      totalQty: number; totalVolume: number;
    }>;
    totalQty: number; totalVolume: number;
  }> = {};

  for (const r of rows) {
    const prinKey  = text(r.prin_code)  || "\u2014";
    const groupKey = text(r.group_name) || "Ungrouped";
    const prodKey  = text(r.prod_code)  || "\u2014";
    const qty      = rowQty(r);
    const volume   = num(r.volume);

    if (!prinMap[prinKey])
      prinMap[prinKey] = { prinCode: text(r.prin_code), prinName: text(r.prin_name), groups: {}, totalQty: 0, totalVolume: 0 };
    const ps = prinMap[prinKey];
    ps.totalQty += qty; ps.totalVolume += volume;

    if (!ps.groups[groupKey])
      ps.groups[groupKey] = { groupName: groupKey, prods: {}, totalQty: 0, totalVolume: 0 };
    const gs = ps.groups[groupKey];
    gs.totalQty += qty; gs.totalVolume += volume;

    if (!gs.prods[prodKey])
      gs.prods[prodKey] = { prodCode: text(r.prod_code), prodName: text(r.prod_name), rows: [], totalQty: 0, totalVolume: 0 };
    const prd = gs.prods[prodKey];
    prd.rows.push(r); prd.totalQty += qty; prd.totalVolume += volume;
  }

  return Object.values(prinMap).map((p) => ({
    ...p,
    groups: Object.values(p.groups).map((g) => ({ ...g, prods: Object.values(g.prods) })),
  }));
}

// ─── Column model (ONE alignment per column, used by header + every data cell) ─

type ColAlign = "left" | "center" | "right";

interface DnColumn {
  label: string;
  align: ColAlign;
  width: number; // % — must add up to 100
}

const DN_COLUMNS: DnColumn[] = [
  { label: "DN No",        align: "center", width: 10 },
  { label: "DN Date",      align: "center", width: 10 },
  { label: "Confirm Date", align: "center", width: 11 },
  { label: "Job No",       align: "center", width: 16 },
  { label: "Customer",     align: "left",   width: 18 },
  { label: "Container No", align: "center", width: 15 },
  { label: "Qty",          align: "right",  width: 8  },
  { label: "Volume",       align: "right",  width: 12 },
];

const DN_COL_COUNT = DN_COLUMNS.length;

// ─── Layout CSS – same visual system as Sales Invoice / PO Order Register ───
// (company letterhead / footer / .data-table / .right / .center come from
// report_common; this only adds what is specific to this report)

const DN_EXTRA_CSS = `
  /* wide report → landscape (overrides the A4 portrait @page in report_common) */
  @page { size: A4 landscape; margin: 10mm 12mm; }
  .paper { max-width: none; }

  .left { text-align: left; }

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

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px 100px;
    margin-bottom: 14px;
  }
  .info-block {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 14px;
    background: #f8fafc;
  }
  .info-block .label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    margin-bottom: 6px;
  }
  .info-block .value-line {
    font-size: 11px;
    color: #0f172a;
    line-height: 1.55;
  }

  /* data table */
  table.data-table { table-layout: fixed; }
  table.data-table th,
  table.data-table td { overflow-wrap: anywhere; word-break: break-word; }
  table.data-table th.left,   table.data-table td.left   { text-align: left   !important; }
  table.data-table th.center, table.data-table td.center { text-align: center !important; }
  table.data-table th.right,  table.data-table td.right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  table.data-table tr.prin-row  td { background: #0b4ca1; color: #fff;    font-weight: 700; font-size: 11px;   padding: 6px 8px; border-bottom: none; }
  table.data-table tr.group-row td { background: #dbe6f6; color: #0b4ca1; font-weight: 700; font-size: 11px;   padding: 5px 8px 5px 20px; }
  table.data-table tr.prod-row  td { background: #eef2f7; color: #334155; font-weight: 700; font-size: 10.5px; padding: 4px 8px 4px 32px; }
  table.data-table tr.data-row:nth-child(even) td { background: #f8fafc; }

  table.data-table tr.prod-total  td { background: #eef2f7; color: #334155; font-weight: 700; font-size: 10.5px; }
  table.data-table tr.group-total td { background: #dbe6f6; color: #0b4ca1; font-weight: 700; font-size: 11px; }
  table.data-table tr.prin-total  td { background: #c7d8f0; color: #0b4ca1; font-weight: 700; font-size: 11px; }

  .totals-box {
    margin-top: 16px;
    margin-left: auto;
    width: 280px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
  }
  .totals-box .row {
    display: flex;
    justify-content: space-between;
    padding: 6px 14px;
    font-size: 11.5px;
    border-bottom: 1px solid #f1f5f9;
  }
  .totals-box .row.grand {
    background: #0b4ca1;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    border-bottom: none;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    table.data-table thead { display: table-header-group; }
    table.data-table tr, table.data-table td, table.data-table th {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    /* keep section headings attached to the row after them */
    table.data-table tr.prin-row,
    table.data-table tr.group-row,
    table.data-table tr.prod-row { break-after: avoid; page-break-after: avoid; }
    /* keep total rows attached to the row before them */
    table.data-table tr.prod-total,
    table.data-table tr.group-total,
    table.data-table tr.prin-total { break-before: avoid; page-break-before: avoid; }
    .totals-box { break-inside: avoid; page-break-inside: avoid; }
  }
`;

// Lets the React parent page trigger printing through postMessage
// (report_common only provides the built-in button, so this is added to the body).
const PRINT_LISTENER_SCRIPT = `
  <script>
    window.addEventListener("message", function (e) {
      if (e.data === "print") window.print();
    });
  </script>`;

// ─── Body pieces ────────────────────────────────────────────────────────────

function titleHtml(title: string, subtitle: string): string {
  return `
    <div class="doc-title-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="doc-sub">${escapeHtml(subtitle)}</div>
      </div>
    </div>`;
}

function filterInfoHtml(p: DnParams): string {
  return `
    <div class="info-grid">
      <div class="info-block">
        <div class="label">Filters</div>
        <div class="value-line">Principal: <strong>${escapeHtml(p.prinCode)}</strong></div>
        <div class="value-line">From Date: ${escapeHtml(p.fromdate)}</div>
        <div class="value-line">To Date: ${escapeHtml(p.todate)}</div>
      </div>
      <div class="info-block">
        <div class="label">Report Details</div>
        <div class="value-line">Report: <strong>Delivery Note Summary</strong></div>
        <div class="value-line">User: ${escapeHtml(p.loginid)}</div>
      </div>
    </div>`;
}

function renderDnBody(prins: PrinSection[], params: DnParams, reportTitle: string): string {
  const grandQty    = prins.reduce((s, p) => s + p.totalQty,    0);
  const grandVolume = prins.reduce((s, p) => s + p.totalVolume, 0);
  const labelSpan   = DN_COL_COUNT - 2;
  const C = DN_COLUMNS;

  const totalRow = (cls: string, label: string, qty: number, vol: number) =>
    `<tr class="${cls}">` +
    `<td class="left" colspan="${labelSpan}">${label}</td>` +
    `<td class="${C[6].align} num">${escapeHtml(qtyFmt(qty))}</td>` +
    `<td class="${C[7].align} num">${escapeHtml(volFmt(vol))}</td>` +
    `</tr>`;

  let bodyRows = "";

  for (const ps of prins) {
    const prinLabel = `${escapeHtml(ps.prinCode)}${ps.prinName ? " | " + escapeHtml(ps.prinName) : ""}`;
    bodyRows += `<tr class="prin-row"><td colspan="${DN_COL_COUNT}">${prinLabel}</td></tr>`;

    for (const gs of ps.groups) {
      bodyRows += `<tr class="group-row"><td colspan="${DN_COL_COUNT}">Group : ${escapeHtml(gs.groupName)}</td></tr>`;

      for (const prd of gs.prods) {
        const prodLabel = `${escapeHtml(prd.prodCode)}${prd.prodName ? " | " + escapeHtml(prd.prodName) : ""}`;
        bodyRows += `<tr class="prod-row"><td colspan="${DN_COL_COUNT}">${prodLabel}</td></tr>`;

        for (const dr of prd.rows) {
          bodyRows +=
            `<tr class="data-row">` +
            `<td class="${C[0].align}">${escapeHtml(dr.dn_no || "\u2014")}</td>` +
            `<td class="${C[1].align}">${escapeHtml(dateText(dr.dn_date ?? dr.receipt_date))}</td>` +
            `<td class="${C[2].align}">${escapeHtml(dateText(dr.principal_confirm_date ?? dr.confirm_date))}</td>` +
            `<td class="${C[3].align}">${escapeHtml(dr.job_no || "\u2014")}</td>` +
            `<td class="${C[4].align}">${escapeHtml(dr.customer || dr.cust_code || "\u2014")}</td>` +
            `<td class="${C[5].align}">${escapeHtml(dr.container_no || "\u2014")}</td>` +
            `<td class="${C[6].align} num">${escapeHtml(qtyFmt(rowQty(dr)))}</td>` +
            `<td class="${C[7].align} num">${escapeHtml(volFmt(num(dr.volume)))}</td>` +
            `</tr>`;
        }
        bodyRows += totalRow("prod-total", `Total For ${prodLabel}`, prd.totalQty, prd.totalVolume);
      }
      bodyRows += totalRow("group-total", `Total For ${escapeHtml(gs.groupName)}`, gs.totalQty, gs.totalVolume);
    }
    bodyRows += totalRow("prin-total", `Total For ${prinLabel}`, ps.totalQty, ps.totalVolume);
  }

  const colgroup    = C.map((c) => `<col style="width:${c.width}%" />`).join("");
  const headerCells = C.map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`).join("");

  return `
    ${titleHtml(reportTitle, "Delivery Note Summary — grouped by Principal / Group / Product")}
    ${filterInfoHtml(params)}

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <div class="totals-box">
      <div class="row"><span>Total Quantity</span><span>${qtyFmt(grandQty)}</span></div>
      <div class="row grand"><span>Total Volume</span><span>${volFmt(grandVolume)}</span></div>
    </div>
    ${PRINT_LISTENER_SCRIPT}`;
}

// ─── HTML document (shared report_common builders) ──────────────────────────

async function buildDnHtml(
  req: RequestWithUser,
  params: DnParams,
  prins: PrinSection[],
  reportTitle: string,
  autoPrint: boolean
): Promise<string> {
  const companyCode = resolveCompanyCode(req, params);
  const headerHtml  = await reportHeader({ company_code: companyCode, req });
  const footerHtml  = reportFooter({
    reportName: "rpt_dn_summary",
    userName:   params.loginid,
    endLabel:   "Powered by Bayanat Technology",
  });
  const bodyHtml = renderDnBody(prins, params, reportTitle);

  return buildReportDocument({
    title: reportTitle,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: DN_EXTRA_CSS,
    autoPrint,
    showPrintButton: true,
  });
}

// ─── Route handlers (HTML / PDF) ────────────────────────────────────────────

export const getDnSummaryReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const reportTitle = text(req.query.title as string) || "Delivery Note Report (Summary)";
    const autoPrint   = req.query.print === "true";
    const params      = extractParams(req);

    const rows = await loadDnData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const html = await buildDnHtml(req, params, groupRows(rows), reportTitle, autoPrint);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("DN Summary HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getDnSummaryReportPdf = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows   = await loadDnData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const html = await buildDnHtml(req, params, groupRows(rows), "Delivery Note Report (Summary)", true);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="DN_Summary.pdf"');
    res.send(html);
  } catch (error: any) {
    console.error("DN Summary PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

// ─── Generic OOXML Excel builder engine (same as Sales Invoice) ─────────────

interface XlCell { v: unknown; styleKey: string }
type XlRow = (XlCell | null)[];
interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

const XL_BLUE     = "FF1D4ED8";
const XL_WHITE    = "FFFFFFFF";
const XL_GREEN_BG = "FFD1FAE5";

function xlCell(v: unknown, styleKey: string): XlCell {
  return { v, styleKey };
}

function defaultXlStyleDefs(): Record<string, any> {
  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
  const rowBorder  = { bottom: borderThin("FFF3F4F6") };

  const defs: Record<string, any> = {
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
    data:       { font: { sz: 10 }, alignment: { vertical: "center" }, border: rowBorder },
    dataCenter: { font: { sz: 10 }, alignment: { horizontal: "center", vertical: "center" }, border: rowBorder },
    dataNum:    { font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" }, numFmt: "#,##0.00",  border: rowBorder },
    dataNumInt: { font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" }, numFmt: "#,##0",     border: rowBorder },
    dataNum3:   { font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" }, numFmt: "#,##0.000", border: rowBorder },
    groupTotal: {
      font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
      fill: { fgColor: { rgb: XL_GREEN_BG } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { top: borderThin("FF065F46") },
    },
    grandTotal: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "left", vertical: "center" },
    },
    grandTotalQty: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0",
    },
    grandTotalVol: {
      font: { bold: true, sz: 12, color: { rgb: XL_WHITE } },
      fill: { fgColor: { rgb: XL_BLUE } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.000",
    },
    footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },

    // section heading rows (Principal / Group / Product)
    secPrin:  { font: { bold: true, sz: 11, color: { rgb: XL_WHITE } },   fill: { fgColor: { rgb: XL_BLUE } },     alignment: { horizontal: "left", vertical: "center" } },
    secGroup: { font: { bold: true, sz: 10, color: { rgb: "FF0B4CA1" } }, fill: { fgColor: { rgb: "FFDBE6F6" } }, alignment: { horizontal: "left", vertical: "center" } },
    secProd:  { font: { bold: true, sz: 10, color: { rgb: "FF334155" } }, fill: { fgColor: { rgb: "FFEEF2F7" } }, alignment: { horizontal: "left", vertical: "center" } },
  };

  // per-level total rows: label / qty / volume
  const totalLevel = (name: string, fill: string, color: string) => {
    const base = { font: { bold: true, sz: 10, color: { rgb: color } }, fill: { fgColor: { rgb: fill } }, border: { top: borderThin(color) } };
    defs[name]         = { ...base, alignment: { horizontal: "left",  vertical: "center" } };
    defs[`${name}Qty`] = { ...base, alignment: { horizontal: "right", vertical: "center" }, numFmt: "#,##0" };
    defs[`${name}Vol`] = { ...base, alignment: { horizontal: "right", vertical: "center" }, numFmt: "#,##0.000" };
  };
  totalLevel("totProd",  "FFEEF2F7", "FF334155");
  totalLevel("totGroup", "FFDBE6F6", "FF0B4CA1");
  totalLevel("totPrin",  "FFC7D8F0", "FF0B4CA1");

  return defs;
}

function buildXlsxBuffer(
  sheetName: string,
  colCount: number,
  colWidth: number | number[],
  rows_: XlRow[],
  merges: XlMerge[],
  styleDefs: Record<string, any>
): Buffer {
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

  const widthAt = (i: number) => (Array.isArray(colWidth) ? colWidth[i] ?? 15 : colWidth);
  const colXml = Array.from({ length: colCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${widthAt(i)}" customWidth="1"/>`
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

// ─── Excel builder: DN Summary ──────────────────────────────────────────────

function buildDnSummaryExcelBuffer(prins: PrinSection[], params: DnParams): Buffer {
  const COL_COUNT = DN_COL_COUNT; // 8
  const LAST = COL_COUNT - 1;
  const rows_: XlRow[] = [];
  const merges: XlMerge[] = [];
  const blank = (): XlRow => new Array(COL_COUNT).fill(null);

  // a full-width, merged row with one styled cell (title / section headings)
  const spanRow = (label: string, styleKey: string) => {
    const r = rows_.length;
    const row = blank();
    row[0] = xlCell(label, styleKey);
    rows_.push(row);
    merges.push({ s: { r, c: 0 }, e: { r, c: LAST } });
  };

  // total row: label merged across first 6 cols, qty + volume in their own cells
  const totalRow = (label: string, qty: number, vol: number, labelKey: string, qtyKey: string, volKey: string) => {
    const r = rows_.length;
    const row = blank();
    row[0] = xlCell(label, labelKey);
    row[6] = xlCell(qty, qtyKey);
    row[7] = xlCell(vol, volKey);
    rows_.push(row);
    merges.push({ s: { r, c: 0 }, e: { r, c: 5 } });
  };

  spanRow("DELIVERY NOTE REPORT (SUMMARY)", "title");

  // meta row
  {
    const r = rows_.length;
    const row = blank();
    row[0] = xlCell(`Principal: ${params.prinCode}`, "meta");
    row[3] = xlCell(`From: ${params.fromdate}   To: ${params.todate}`, "meta");
    row[6] = xlCell(`User: ${params.loginid}`, "meta");
    rows_.push(row);
    merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
    merges.push({ s: { r, c: 3 }, e: { r, c: 5 } });
    merges.push({ s: { r, c: 6 }, e: { r, c: 7 } });
  }

  rows_.push(blank());

  rows_.push(DN_COLUMNS.map((c) => xlCell(c.label, "header")));

  for (const ps of prins) {
    const prinLabel = ps.prinCode + (ps.prinName ? " | " + ps.prinName : "");
    spanRow(prinLabel, "secPrin");

    for (const gs of ps.groups) {
      spanRow("Group : " + gs.groupName, "secGroup");

      for (const prd of gs.prods) {
        const prodLabel = prd.prodCode + (prd.prodName ? " | " + prd.prodName : "");
        spanRow(prodLabel, "secProd");

        for (const dr of prd.rows) {
          rows_.push([
            xlCell(text(dr.dn_no) || "\u2014", "dataCenter"),
            xlCell(dateText(dr.dn_date ?? dr.receipt_date), "dataCenter"),
            xlCell(dateText(dr.principal_confirm_date ?? dr.confirm_date), "dataCenter"),
            xlCell(text(dr.job_no) || "\u2014", "dataCenter"),
            xlCell(text(dr.customer ?? dr.cust_code) || "\u2014", "data"),
            xlCell(text(dr.container_no) || "\u2014", "dataCenter"),
            xlCell(rowQty(dr), "dataNumInt"),
            xlCell(num(dr.volume), "dataNum3"),
          ]);
        }
        totalRow("Total For " + prodLabel, prd.totalQty, prd.totalVolume, "totProd", "totProdQty", "totProdVol");
      }
      totalRow("Total For " + gs.groupName, gs.totalQty, gs.totalVolume, "totGroup", "totGroupQty", "totGroupVol");
    }
    totalRow("Total For " + prinLabel, ps.totalQty, ps.totalVolume, "totPrin", "totPrinQty", "totPrinVol");
  }

  const grandQty    = prins.reduce((s, p) => s + p.totalQty,    0);
  const grandVolume = prins.reduce((s, p) => s + p.totalVolume, 0);

  rows_.push(blank());
  totalRow("Grand Total", grandQty, grandVolume, "grandTotal", "grandTotalQty", "grandTotalVol");

  {
    const row = blank();
    row[LAST] = xlCell("Powered by Bayanat Technology", "footer");
    rows_.push(row);
  }

  const COL_WIDTHS = [12, 14, 14, 18, 24, 18, 12, 14];
  return buildXlsxBuffer("DN Summary", COL_COUNT, COL_WIDTHS, rows_, merges, defaultXlStyleDefs());
}

// ─── Route handler (Excel) ──────────────────────────────────────────────────

export const getDnSummaryReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows   = await loadDnData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const buffer = buildDnSummaryExcelBuffer(groupRows(rows), params);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="DN_Summary.xlsx"');
    res.end(buffer);
  } catch (error: any) {
    console.error("DN Summary Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};