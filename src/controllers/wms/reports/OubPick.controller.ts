import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface DetailLine {
  mfg_date: unknown;
  lot_no:   unknown;
  exp_date: unknown;
  quantity: unknown;
  qty_puom: unknown;
  p_uom:    unknown;
  qty_luom: unknown;
  l_uom:    unknown;
  volume:   unknown;
  net_wt:   unknown;
}

interface GroupTotals {
  quantity: number;
  puom: Record<string, number>;   // QTY_PUOM bucketed by P_UOM
  luom: Record<string, number>;   // QTY_LUOM bucketed by L_UOM
  volume: number;
  netWt: number;
}

interface ProductGroup {
  prodCode: string;
  prodName: string;
  lines: DetailLine[];
  totals: GroupTotals;
}

interface SiteOrderGroup {
  locationCode: string;
  siteCode: string;
  orderNo: string;
  stockQty: string;
  products: ProductGroup[];
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
  const s = String(value);
  // already formatted string like "31-12-2025"
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
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

function numFmt(value: unknown, decimals = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ─── Totals accumulator ───────────────────────────────────────────────────────

function emptyGroupTotals(): GroupTotals {
  return { quantity: 0, puom: {}, luom: {}, volume: 0, netWt: 0 };
}

function addToGroupTotals(t: GroupTotals, row: ReportRow): void {
  const qty   = parseFloat(String(row.quantity)) || 0;
  const pUom  = text(row.p_uom);
  const lUom  = text(row.l_uom);
  const qtyP  = parseFloat(String(row.qty_puom)) || 0;
  const qtyL  = parseFloat(String(row.qty_luom)) || 0;
  const vol   = parseFloat(String(row.volume))   || 0;
  const netWt = parseFloat(String(row.net_wt))   || 0;

  t.quantity += qty;
  if (pUom) t.puom[pUom] = (t.puom[pUom] ?? 0) + qtyP;
  if (lUom) t.luom[lUom] = (t.luom[lUom] ?? 0) + qtyL;
  t.volume += vol;
  t.netWt  += netWt;
}

function mergeGroupTotals(into: GroupTotals, from: GroupTotals): void {
  into.quantity += from.quantity;
  into.volume   += from.volume;
  into.netWt    += from.netWt;
  for (const [u, v] of Object.entries(from.puom)) into.puom[u] = (into.puom[u] ?? 0) + v;
  for (const [u, v] of Object.entries(from.luom)) into.luom[u] = (into.luom[u] ?? 0) + v;
}

function fmtBucket(dict: Record<string, number>): string {
  const parts = Object.entries(dict).map(([u, v]) => `${numFmt(v)} ${u}`.trim());
  return parts.length ? parts.join(" / ") : "—";
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

function buildGroups(rows: ReportRow[]): SiteOrderGroup[] {
  const groups: SiteOrderGroup[] = [];
  const groupIndex   = new Map<string, SiteOrderGroup>();
  const productIndex = new Map<string, ProductGroup>();

  for (const r of rows) {
    const locationCode = text(r.location_code);
    const siteCode      = text(r.site_code);
    const orderNo       = text(r.order_no);
    const groupKey       = `${locationCode}|${siteCode}|${orderNo}`;

    let grp = groupIndex.get(groupKey);
    if (!grp) {
      grp = {
        locationCode,
        siteCode,
        orderNo,
        stockQty: text(r.qty_puom),
        products: [],
      };
      groupIndex.set(groupKey, grp);
      groups.push(grp);
    }

    const prodCode = text(r.prod_code);
    const prodKey  = `${groupKey}::${prodCode}`;
    let prod = productIndex.get(prodKey);
    if (!prod) {
      prod = {
        prodCode,
        prodName: text(r.prod_name),
        lines: [],
        totals: emptyGroupTotals(),
      };
      productIndex.set(prodKey, prod);
      grp.products.push(prod);
    }

    prod.lines.push({
      mfg_date: r.mfg_date,
      lot_no:   r.lot_no,
      exp_date: r.exp_date,
      quantity: r.quantity,
      qty_puom: r.qty_puom,
      p_uom:    r.p_uom,
      qty_luom: r.qty_luom,
      l_uom:    r.l_uom,
      volume:   r.volume,
      net_wt:   r.net_wt,
    });
    addToGroupTotals(prod.totals, r);
  }

  return groups;
}

function computeGrandTotals(groups: SiteOrderGroup[]): GroupTotals {
  const grand = emptyGroupTotals();
  for (const g of groups) for (const p of g.products) mergeGroupTotals(grand, p.totals);
  return grand;
}

// ─── Data loader ──────────────────────────────────────────────────────────────
async function loadPickListData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT
        JOB_NO, JOB_DATE, PRIN_CODE, PRIN_NAME,
        LOCATION_CODE, SITE_CODE, ORDER_NO,
        PROD_CODE, PROD_NAME,
        MFG_DATE, LOT_NO, EXP_DATE,
        QUANTITY, QTY_PUOM, P_UOM, QTY_LUOM, L_UOM,
        VOLUME, NET_WT
       FROM VW_BOWM_PICKLST
       WHERE JOB_NO    = :job_no
         AND PRIN_CODE = :prin_code
       ORDER BY LOCATION_CODE, SITE_CODE, ORDER_NO, PROD_CODE, MFG_DATE, LOT_NO`,
      { job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  rows:        ReportRow[],
  groups:      SiteOrderGroup[],
  jobNo:       string,
  prinCode:    string,
  reportTitle: string,
  loginId:     string,
  autoPrint:   boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const h = rows[0] || {};   // job-level header fields come from first row
  const grand = computeGrandTotals(groups);

  // ── Helper: render one header field ──────────────────────────────────────
  const hf = (label: string, val: unknown) => {
    const v = text(val);
    return `
      <div class="hdr-row">
        <span class="hdr-label">${label}</span>
        <span class="hdr-sep">:</span>
        <span class="hdr-value${v ? "" : " nil"}">${v ? escapeHtml(v) : ""}</span>
      </div>`;
  };

  // ── Helper: render one detail line ──────────────────────────────────────
  const renderLine = (l: DetailLine) => `
      <tr class="data-row">
        <td>${escapeHtml(dateText(l.mfg_date))}</td>
        <td>${escapeHtml(l.lot_no || "—")}</td>
        <td>${escapeHtml(dateText(l.exp_date))}</td>
        <td class="num">${escapeHtml(numFmt(l.quantity))}</td>
        <td class="num">${escapeHtml(numFmt(l.qty_puom))} ${escapeHtml(l.p_uom)}</td>
        <td class="num">${escapeHtml(numFmt(l.qty_luom))} ${escapeHtml(l.l_uom)}</td>
        <td class="num">${l.volume != null && l.volume !== "" ? escapeHtml(numFmt(l.volume)) : "—"}</td>
        <td class="num">${l.net_wt != null && l.net_wt !== "" ? escapeHtml(numFmt(l.net_wt)) : "—"}</td>
      </tr>`;

  // ── Helper: render a subtotal / grand-total row ──────────────────────────
  const renderTotalRow = (label: string, t: GroupTotals, cls: string) => `
      <tr class="${cls}">
        <td colspan="3" class="total-label">${escapeHtml(label)}</td>
        <td class="num">${escapeHtml(numFmt(t.quantity))}</td>
        <td class="num">${escapeHtml(fmtBucket(t.puom))}</td>
        <td class="num">${escapeHtml(fmtBucket(t.luom))}</td>
        <td class="num">${escapeHtml(numFmt(t.volume))}</td>
        <td class="num">${escapeHtml(numFmt(t.netWt))}</td>
      </tr>`;

  // ── Body: groups -> products -> lines -> subtotal ───────────────────────
  let bodyRows = "";
  for (const g of groups) {
    const siteLabel = [g.siteCode, g.locationCode].filter(Boolean).join(" ");
    bodyRows += `
      <tr class="grp-row">
        <td colspan="8">
          <span class="grp-field"><span class="grp-label">Site</span><span class="grp-sep">:</span><span class="grp-value">${escapeHtml(siteLabel || "—")}</span></span>
          <span class="grp-field"><span class="grp-label">Order No</span><span class="grp-sep">:</span><span class="grp-value">${escapeHtml(g.orderNo || "—")}</span></span>
          <span class="grp-field"><span class="grp-label">Stock Qty</span><span class="grp-sep">:</span><span class="grp-value">${escapeHtml(g.stockQty || "—")}</span></span>
          <span class="grp-field"><span class="grp-label">Pick Qty</span><span class="grp-sep">:</span><span class="grp-dots"></span></span>
        </td>
      </tr>`;

    for (const p of g.products) {
      bodyRows += `
      <tr class="prod-row">
        <td colspan="8"><span class="prod-code">${escapeHtml(p.prodCode || "—")}</span> ${escapeHtml(p.prodName || "")}</td>
      </tr>`;

      for (const line of p.lines) bodyRows += renderLine(line);

      bodyRows += renderTotalRow("Sub Total", p.totals, "sub-row");
    }
  }

  bodyRows += renderTotalRow("Grand Total", grand, "grand-row");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)} - ${escapeHtml(jobNo)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 11px; color: #111827;
      background: #eef1f6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 190mm;
      min-height: 277mm;
      margin: 0 auto;
      background: #fff;
      padding: 10mm 12mm;
      border: 1px solid #c4cdd9;
    }

    /* ── Banner ── */
    .rpt-banner {
      background: #1e3a5f; color: #fff;
      text-align: center; text-transform: uppercase;
      font-size: 13px; font-weight: 700; letter-spacing: .08em;
      padding: 9px 16px;
      border-radius: 3px 3px 0 0;
    }

    /* ── Print meta ── */
    .rpt-meta {
      display: flex; justify-content: space-between; align-items: center;
      padding: 5px 2px 5px;
      font-size: 9.5px; color: #4b5563;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 8px;
    }
    .rpt-meta strong { color: #111827; font-weight: 600; }

    /* ── Header block: two-column grid, flat label : value ── */
    .doc-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 24px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 2px solid #1e3a5f;
    }
    .hdr-col { display: flex; flex-direction: column; gap: 2px; }
    .hdr-row { display: flex; align-items: baseline; gap: 0; line-height: 1.8; }
    .hdr-label {
      font-size: 10.5px; color: #6b7280; white-space: nowrap;
      min-width: 120px;
    }
    .hdr-sep  { font-size: 10.5px; color: #9ca3af; margin-right: 6px; }
    .hdr-value {
      font-size: 11px; font-weight: 700; color: #111827;
    }
    .hdr-value.nil { font-weight: 400; color: #d1d5db; }

    /* ── Data table ── */
    table.rpt-table {
      width: 100%; border-collapse: collapse; table-layout: fixed;
    }

    col.c-mfg   { width: 11%; }
    col.c-lot   { width: 9%;  }
    col.c-exp   { width: 11%; }
    col.c-qty   { width: 9%;  }
    col.c-puom  { width: 16%; }
    col.c-luom  { width: 16%; }
    col.c-vol   { width: 14%; }
    col.c-wt    { width: 14%; }

    thead th {
      background: #1e3a5f; color: #fff;
      font-size: 9.5px; font-weight: 700;
      padding: 7px 8px;
      border-right: 1px solid rgba(255,255,255,0.15);
      text-align: center;
      white-space: nowrap;
    }
    thead th:last-child { border-right: none; }

    tbody tr.data-row td {
      padding: 4px 8px;
      border-bottom: 1px solid #e5e7eb;
      color: #374151;
      font-size: 10.5px;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }

    /* ── Site / order group header row ── */
    tr.grp-row td {
      background: #1e3a5f; color: #fff;
      font-weight: 700; font-size: 10.5px;
      padding: 6px 8px;
      border-top: 2px solid #162d4a;
    }
    .grp-field { margin-right: 22px; }
    .grp-label { color: #cbd5e1; font-weight: 600; margin-right: 4px; }
    .grp-sep   { color: #93a5bd; margin-right: 6px; }
    .grp-value { color: #fff; }
    .grp-dots  {
      display: inline-block; min-width: 70px;
      border-bottom: 1px dotted #93a5bd; height: 1px; vertical-align: middle;
    }

    /* ── Product sub-header row ── */
    tr.prod-row td {
      background: #dbe4ee; color: #1e3a5f;
      font-weight: 700; font-size: 10.5px;
      padding: 5px 8px;
      border-bottom: 1px solid #c4cdd9;
    }
    .prod-code { font-weight: 700; }

    /* ── Subtotal / grand total rows ── */
    tr.sub-row td {
      background: #f3f4f6; color: #1e3a5f;
      font-weight: 700; font-size: 10.5px;
      padding: 5px 8px;
      border-top: 1px solid #c4cdd9;
      border-bottom: 1px solid #c4cdd9;
    }
    tr.grand-row td {
      background: #1e3a5f; color: #fff;
      font-weight: 700; font-size: 11px;
      padding: 8px 8px;
      border-top: 2px solid #162d4a;
    }
    .total-label { text-align: right; letter-spacing: .04em; }

    /* ── Signature block ── */
    .sig-block {
      margin-top: 14px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 24px;
    }
    .sig-col  { display: flex; flex-direction: column; gap: 10px; }
    .sig-line { display: flex; align-items: flex-end; gap: 8px; font-size: 10.5px; color: #374151; line-height: 1.8; }
    .sig-label { white-space: nowrap; min-width: 110px; }
    .sig-dots  { flex: 1; border-bottom: 1px dotted #9ca3af; margin-bottom: 2px; min-width: 40px; }

    /* ── Footer ── */
    .rpt-footer {
      margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px;
      display: flex; justify-content: space-between;
      font-size: 9px; color: #9ca3af;
    }
    .rpt-footer code { font-family: "Courier New", monospace; font-size: 9px; color: #6b7280; }

    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; }
      thead { display: table-header-group; }
      tr.grp-row { break-before: avoid; page-break-before: avoid; break-after: avoid; }
      tr.prod-row { break-after: avoid; page-break-after: avoid; }
      .sig-block { break-before: avoid; page-break-before: avoid; }
    }
  </style>
</head>
<body>
<main class="sheet">

  <!-- ── Banner ── -->
  <div class="rpt-banner">${escapeHtml(reportTitle)}</div>

  <!-- ── Print meta ── -->
  <div class="rpt-meta">
    <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;Print User :&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
  </div>

  <!-- ── Document header (flat label : value, no box) ── -->
  <div class="doc-header">

    <div class="hdr-col">
      ${hf("Job No",     h.job_no || jobNo)}
      ${hf("Job Date",   dateText(h.job_date))}
      ${hf("Principal",  [text(h.prin_code) || prinCode, text(h.prin_name)].filter(Boolean).join(" | "))}
    </div>

    <div class="hdr-col">
      ${hf("Stuffing Start",     "")}
      ${hf("Stuffing End",       "")}
      ${hf("Total Time Taken",  "")}
    </div>

  </div><!-- /doc-header -->

  <!-- ── Line items table ── -->
  <table class="rpt-table">
    <colgroup>
      <col class="c-mfg"/>  <col class="c-lot"/>
      <col class="c-exp"/>  <col class="c-qty"/>
      <col class="c-puom"/> <col class="c-luom"/>
      <col class="c-vol"/>  <col class="c-wt"/>
    </colgroup>
    <thead>
      <tr>
        <th>Mfg. Date</th>
        <th>Lot No</th>
        <th>Exp Date</th>
        <th>Quantity</th>
        <th>Primary UOM</th>
        <th>Least UOM</th>
        <th>Volume</th>
        <th>Net Weight</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>

  <!-- ── Signature block ── -->
  <div class="sig-block">
    <div class="sig-col">
      <div class="sig-line"><span class="sig-label">Picked By (Name &amp; Signature)</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
    </div>
    <div class="sig-col">
      <div class="sig-line"><span class="sig-label">Checked By (Name &amp; Signature)</span><span class="sig-sep"> : </span><span class="sig-dots"></span></div>
    </div>
  </div>

  <!-- ── Footer ── -->
  <div class="rpt-footer">
    <span>Report Name : <code>${escapeHtml(jobNo)}</code></span>
    <span>Powered by Bayanat Technology</span>
  </div>

</main>
<script>
  window.addEventListener("message", (e) => {
    if (e.data === "print") window.print();
  });
  ${autoPrint ? `window.addEventListener("load", () => setTimeout(() => window.print(), 300));` : ""}
</script>
</body>
</html>`;
}

// ─── Excel builder ────────────────────────────────────────────────────────────

const STYLE_ID = {
  default:      0,
  header:       1,   // dark blue bg, white bold – title / col headers
  hdrLeft:      2,   // dark blue bg, white bold – left-aligned col header
  label:        3,   // grey text, right-align
  value:        4,   // dark bold
  dataCell:     5,   // normal data cell with thin border
  numCell:      6,   // right-aligned data cell
  totalLabel:   7,   // dark blue bg, white, right-aligned
  totalNum:     8,   // dark blue bg, white, right-aligned, numeric
  groupHeader:  9,   // medium blue bg, white bold – site/order group row
  prodHeader:   10,  // light blue bg, navy bold – product row
  subLabel:     11,  // light grey bg, navy bold, right-aligned – subtotal label
  subNum:       12,  // light grey bg, navy bold, right-aligned – subtotal numeric
} as const;

type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(
  rows:     ReportRow[],
  groups:   SiteOrderGroup[],
  jobNo:    string,
  prinCode: string
): Buffer {
  const NCOLS = 8;
  type Row    = (XlCell | null)[];
  const skip  = null;
  const xlRows: Row[] = [];

  const h = rows[0] || {};
  const grand = computeGrandTotals(groups);

  // ── Title ────────────────────────────────────────────────────────────────
  xlRows.push([xc(`Outbound Pick List — Job ${jobNo} / Principal ${prinCode}`, "header"), ...Array(NCOLS - 1).fill(skip)]);
  xlRows.push(Array(NCOLS).fill(skip));

  // ── Doc-info block: two logical columns, each label+value pair ───────────
  const metaRows: [string, unknown, string, unknown][] = [
    ["Job No",        h.job_no || jobNo,        "Stuffing Start",    ""],
    ["Job Date",      dateText(h.job_date),      "Stuffing End",      ""],
    ["Principal",     [text(h.prin_code) || prinCode, text(h.prin_name)].filter(Boolean).join(" | "), "Total Time Taken", ""],
  ];

  for (const [lbl1, val1, lbl2, val2] of metaRows) {
    xlRows.push([
      xc(lbl1,       "label"),
      xc(text(val1), "value"),
      skip, skip,
      xc(lbl2,       "label"),
      xc(text(val2), "value"),
      skip, skip,
    ]);
  }

  xlRows.push(Array(NCOLS).fill(skip));

  // ── Column headers ────────────────────────────────────────────────────────
  xlRows.push([
    xc("Mfg. Date",    "hdrLeft"),
    xc("Lot No",       "header"),
    xc("Exp Date",     "header"),
    xc("Quantity",     "header"),
    xc("Primary UOM",  "header"),
    xc("Least UOM",    "header"),
    xc("Volume",       "header"),
    xc("Net Weight",   "header"),
  ]);

  // ── Helper: a subtotal / grand-total row ─────────────────────────────────
  const totalRowCells = (label: string, t: GroupTotals, lblStyle: StyleKey, numStyle: StyleKey): Row => [
    xc(label, lblStyle), skip, skip,
    xc(numFmt(t.quantity),  numStyle),
    xc(fmtBucket(t.puom),   numStyle),
    xc(fmtBucket(t.luom),   numStyle),
    xc(numFmt(t.volume),    numStyle),
    xc(numFmt(t.netWt),     numStyle),
  ];

  // ── Body: groups -> products -> lines -> subtotal ───────────────────────
  for (const g of groups) {
    const siteLabel = [g.siteCode, g.locationCode].filter(Boolean).join(" ");
    xlRows.push([
      xc(`Site : ${siteLabel || "—"}    Order No : ${g.orderNo || "—"}    Stock Qty : ${g.stockQty || "—"}    Pick Qty :`, "groupHeader"),
      ...Array(NCOLS - 1).fill(skip),
    ]);

    for (const p of g.products) {
      xlRows.push([
        xc(`${text(p.prodCode)} | ${text(p.prodName)}`.trim(), "prodHeader"),
        ...Array(NCOLS - 1).fill(skip),
      ]);

      for (const line of p.lines) {
        xlRows.push([
          xc(dateText(line.mfg_date),                                   "dataCell"),
          xc(text(line.lot_no) || "—",                                  "dataCell"),
          xc(dateText(line.exp_date),                                   "dataCell"),
          xc(numFmt(line.quantity),                                     "numCell"),
          xc(`${numFmt(line.qty_puom)} ${text(line.p_uom)}`.trim(),     "numCell"),
          xc(`${numFmt(line.qty_luom)} ${text(line.l_uom)}`.trim(),     "numCell"),
          xc(line.volume != null && line.volume !== "" ? numFmt(line.volume) : "—", "numCell"),
          xc(line.net_wt != null && line.net_wt !== "" ? numFmt(line.net_wt) : "—", "numCell"),
        ]);
      }

      xlRows.push(totalRowCells("Sub Total", p.totals, "subLabel", "subNum"));
    }
  }

  xlRows.push(totalRowCells("Grand Total", grand, "totalLabel", "totalNum"));

  // ── Build XML ─────────────────────────────────────────────────────────────
  const COL_WIDTHS = [13, 11, 13, 11, 16, 16, 12, 12];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // Detect spans (consecutive nulls after a non-null cell)
  const merges: string[] = [];
  xlRows.forEach((row, ri) => {
    const rn = ri + 1;
    let i = 0;
    while (i < row.length) {
      if (row[i] !== null) {
        let j = i + 1;
        while (j < row.length && row[j] === null) j++;
        if (j - 1 > i)
          merges.push(`${colLetter(i)}${rn}:${colLetter(j - 1)}${rn}`);
        i = j;
      } else {
        i++;
      }
    }
  });

  let sheetDataXml = "";
  xlRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="22" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${colLetter(ci)}${rn}`;
      if (typeof cell.v === "number")
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      else
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
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

  // ── Styles ────────────────────────────────────────────────────────────────
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="6">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF3F5E82"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBE4EE"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="medium"><color rgb="FF1E3A5F"/></left>
      <right style="medium"><color rgb="FF1E3A5F"/></right>
      <top style="medium"><color rgb="FF1E3A5F"/></top>
      <bottom style="medium"><color rgb="FF1E3A5F"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: header – dark bg, white bold, centre -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2: hdrLeft – dark bg, white bold, left -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center"/>
    </xf>
    <!-- 3: label – grey text, right-align -->
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 4: value – dark bold -->
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center"/>
    </xf>
    <!-- 5: dataCell – normal with border -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <!-- 6: numCell – right-aligned with border -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="top" wrapText="1"/>
    </xf>
    <!-- 7: totalLabel – dark bg, white, right-aligned -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 8: totalNum – dark bg, white, right-aligned -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center" wrapText="1"/>
    </xf>
    <!-- 9: groupHeader – medium blue bg, white bold -->
    <xf numFmtId="0" fontId="5" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center"/>
    </xf>
    <!-- 10: prodHeader – light blue bg, navy bold -->
    <xf numFmtId="0" fontId="2" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center"/>
    </xf>
    <!-- 11: subLabel – light grey bg, navy bold, right-aligned -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 12: subNum – light grey bg, navy bold, right-aligned -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center" wrapText="1"/>
    </xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Outbound Pick List" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Column-letter helper ─────────────────────────────────────────────────────

function colLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export const getPickListHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no   || req.query.job_no);
    const prinCode    = text(req.params.prin_code || req.query.prin_code);
    const reportTitle = text(req.query.title)     || "Outbound Pick List";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadPickListData(req, jobNo, prinCode);
    const groups = buildGroups(rows);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(rows, groups, jobNo, prinCode, reportTitle, text(req.user?.loginid), autoPrint));
  } catch (error: any) {
    console.error("Pick List HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getPickListPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no   || req.query.job_no);
    const prinCode = text(req.params.prin_code || req.query.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadPickListData(req, jobNo, prinCode);
    const groups = buildGroups(rows);
    const html   = renderHtml(rows, groups, jobNo, prinCode, "Outbound Pick List", text(req.user?.loginid), true);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="PICKLIST_${jobNo}_${prinCode}.pdf"`);
    res.send(html);
  } catch (error: any) {
    console.error("Pick List PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const getPickListExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no   || req.query.job_no);
    const prinCode = text(req.params.prin_code || req.query.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadPickListData(req, jobNo, prinCode);
    const groups = buildGroups(rows);
    const buffer = buildExcelBuffer(rows, groups, jobNo, prinCode);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="PICKLIST_${jobNo}_${prinCode}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Pick List Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};