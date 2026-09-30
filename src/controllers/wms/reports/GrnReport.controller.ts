import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  buildReportDocument,
  reportAppliedFilters,
  reportFooter,
  reportHeader,
} from "../../common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;
type Orientation = "portrait" | "landscape" | "auto";

// UOM-keyed totals e.g. { "PKT": 99, "CTN": 12 }
type UomTotals = Record<string, number>;

interface ProductGroup {
  prodCode:   string;
  prodName:   string;
  rows:       ReportRow[];
  recvByPuom: UomTotals;  // QTYPUOM  keyed by P_UOM
  recvByLuom: UomTotals;  // QTYLUOM  keyed by L_UOM  (L_UOM rule: only if qty > 0)
  damByPuom:  UomTotals;  // QTYPUOM_DAM keyed by P_UOM
  damByLuom:  UomTotals;  // QTYLUOM_DAM keyed by L_UOM
  expByPuom:  UomTotals;  // QTYPUOM_EXPECTED keyed by P_UOM
  expByLuom:  UomTotals;
}

interface GroupSection {
  groupName:  string;
  products:   ProductGroup[];
  recvByPuom: UomTotals;
  recvByLuom: UomTotals;
  damByPuom:  UomTotals;
  damByLuom:  UomTotals;
}

interface ShortExcessCell { text: string; cls: "short" | "excess" | "" }

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
  if (!value) return "\u2014";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
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
  if (!Number.isFinite(n)) return "\u2014";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Add qty into a UomTotals bucket */
function addUom(map: UomTotals, uom: string, qty: number): void {
  if (!uom) return;
  map[uom] = (map[uom] ?? 0) + qty;
}

function fmtQtyCell(qtyPuom: number, pUom: string, qtyLuom: number, lUom: string): string {
  let s = `${numFmt(qtyPuom)} ${pUom}`.trim();
  if (qtyLuom !== 0 && lUom) s += ` / ${numFmt(qtyLuom)} ${lUom}`;
  return s;
}

function fmtUomTotals(map: UomTotals, primaryUom?: string): string {
  const keys = Object.keys(map);
  if (keys.length === 0) return "\u2014";

  const ordered = primaryUom
    ? [primaryUom, ...keys.filter((k) => k !== primaryUom)]
    : keys;

  return ordered
    .filter((k) => map[k] !== undefined)
    .map((k) => `${numFmt(map[k])} ${k}`)
    .join(" / ");
}

/** "99.000 PKT / 12.000 CTN" — primary totals, then least-UOM totals when present */
function fmtBothTotals(pMap: UomTotals, lMap: UomTotals): string {
  return fmtUomTotals(pMap) + (Object.keys(lMap).length ? " / " + fmtUomTotals(lMap) : "");
}

/** Merge UomTotals maps (sum values for matching keys). */
function mergeUomTotals(...maps: UomTotals[]): UomTotals {
  const result: UomTotals = {};
  for (const map of maps)
    for (const [uom, qty] of Object.entries(map))
      result[uom] = (result[uom] ?? 0) + qty;
  return result;
}

/**
 * Mirrors the SSRS expression:
 *   exp - recv == 0            -> blank
 *   recv > exp (negative diff) -> "Excess: +<diff>"  (green)
 *   recv < exp (positive diff) -> "Short: -<diff>"   (red)
 */
function fmtShortExcessCell(
  expPuom: number, recvPuom: number, pUom: string,
  expLuom: number, recvLuom: number, lUom: string
): ShortExcessCell {
  const diffPuom = expPuom - recvPuom;
  const diffLuom = expLuom - recvLuom;

  if (diffPuom === 0 && diffLuom === 0) return { text: "\u2014", cls: "" };

  const driver   = diffPuom !== 0 ? diffPuom : diffLuom;
  const isExcess = driver < 0;
  const prefix   = isExcess ? "Excess: +" : "Short: -";

  const parts: string[] = [];
  if (diffPuom !== 0) parts.push(`${numFmt(Math.abs(diffPuom))} ${pUom}`.trim());
  if (diffLuom !== 0 && lUom) parts.push(`${numFmt(Math.abs(diffLuom))} ${lUom}`.trim());

  return { text: `${prefix}${parts.join(" / ")}`, cls: isExcess ? "excess" : "short" };
}

/**
 * Reads the orientation from the query string. If the viewer sends nothing,
 * returns "auto" and the CSS falls back to a width-based media query.
 */
function getOrientation(req: RequestWithUser): Orientation {
  const raw = text(
    req.query.orientation || req.query.view || req.query.layout || req.query.page_orientation
  ).toLowerCase();
  if (raw === "portrait" || raw === "p") return "portrait";
  if (raw === "landscape" || raw === "l") return "landscape";
  return "auto";
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadGrnData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT
        BATCH_NO, CONTAINER_NO, CONTAINER_SIZE, DOC_REF,
        EXCESS_SHORT_QTY, EXP_DATE, GRN_DATE, GRN_NO,
        GROSSWT, GROUP_NAME, JOB_NO, LOT_NO, L_UOM,
        MFG_DATE, NETWT, PALLET_ID, PRIN_CODE, PRIN_NAME,
        PRIN_REF1, PROD_CODE, PROD_NAME, P_UOM,
        QTYLUOM, QTYLUOM_DAM, QTYLUOM_EXPECTED,
        QTYPUOM, QTYPUOM_DAM, QTYPUOM_EXPECTED,
        UPPP, USER_ID, VOLUME
       FROM VW_BOWM_GRNTXN_FINAL
       WHERE JOB_NO    = :job_no
         AND PRIN_CODE = :prin_code
       ORDER BY GROUP_NAME, PROD_CODE`,
      { job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

function groupRows(rows: ReportRow[]): GroupSection[] {
  const groupMap: Record<string, {
    groupName:  string;
    products:   Record<string, ProductGroup>;
    recvByPuom: UomTotals;
    recvByLuom: UomTotals;
    damByPuom:  UomTotals;
    damByLuom:  UomTotals;
  }> = {};

  for (const r of rows) {
    const groupKey = text(r.group_name) || "Ungrouped";
    const prodKey  = text(r.prod_code)  || "N/A";
    const pUom     = text(r.p_uom);
    const lUom     = text(r.l_uom);

    const qtyPuom    = parseFloat(String(r.qtypuom))          || 0;
    const qtyLuom    = parseFloat(String(r.qtyluom))          || 0;
    const qtyPuomDam = parseFloat(String(r.qtypuom_dam))      || 0;
    const qtyLuomDam = parseFloat(String(r.qtyluom_dam))      || 0;
    const qtyPuomExp = parseFloat(String(r.qtypuom_expected)) || 0;
    const qtyLuomExp = parseFloat(String(r.qtyluom_expected)) || 0;

    if (!groupMap[groupKey])
      groupMap[groupKey] = {
        groupName:  groupKey,
        products:   {},
        recvByPuom: {}, recvByLuom: {},
        damByPuom:  {}, damByLuom:  {},
      };

    if (!groupMap[groupKey].products[prodKey])
      groupMap[groupKey].products[prodKey] = {
        prodCode:   text(r.prod_code),
        prodName:   text(r.prod_name),
        rows:       [],
        recvByPuom: {}, recvByLuom: {},
        damByPuom:  {}, damByLuom:  {},
        expByPuom:  {}, expByLuom:  {},
      };

    const pg = groupMap[groupKey].products[prodKey];
    pg.rows.push(r);

    addUom(pg.recvByPuom, pUom, qtyPuom);
    addUom(pg.damByPuom,  pUom, qtyPuomDam);
    addUom(pg.expByPuom,  pUom, qtyPuomExp);

    if (qtyLuom    !== 0) addUom(pg.recvByLuom, lUom, qtyLuom);
    if (qtyLuomDam !== 0) addUom(pg.damByLuom,  lUom, qtyLuomDam);
    if (qtyLuomExp !== 0) addUom(pg.expByLuom,  lUom, qtyLuomExp);

    const gs = groupMap[groupKey];
    addUom(gs.recvByPuom, pUom, qtyPuom);
    addUom(gs.damByPuom,  pUom, qtyPuomDam);
    if (qtyLuom    !== 0) addUom(gs.recvByLuom, lUom, qtyLuom);
    if (qtyLuomDam !== 0) addUom(gs.damByLuom,  lUom, qtyLuomDam);
  }

  return Object.values(groupMap).map((g) => ({
    ...g,
    products: Object.values(g.products),
  }));
}

// ─── Table columns (single header row; ONE alignment per column) ─────────────

type ColAlign = "left" | "center" | "right";

interface GrnColumn { label: string; align: ColAlign }

const GRN_COLUMNS: GrnColumn[] = [
  { label: "Mfg. Date",              align: "center" },
  { label: "Exp. Date",              align: "center" },
  { label: "Batch No",               align: "left"   },
  { label: "Lot No",                 align: "left"   },
  { label: "Gross WT",               align: "right"  },
  { label: "Net WT",                 align: "right"  },
  { label: "Qty Received",           align: "right"  },
  { label: "Qty Damaged",            align: "right"  },
  { label: "Total (Good + Damaged)", align: "right"  },
  { label: "Short / Excess",         align: "right"  },
];

const COL_COUNT  = GRN_COLUMNS.length; // 10
const LABEL_SPAN = 6;                  // total-row label spans everything before Qty Received

/** ASN (expected) qty text shown on the product banner */
function asnText(pg: ProductGroup): string {
  const pUom = text(pg.rows[0]?.p_uom || "");
  const lUom = text(pg.rows[0]?.l_uom || "");
  return fmtUomTotals(pg.expByPuom, pUom)
    + (Object.keys(pg.expByLuom).length ? " / " + fmtUomTotals(pg.expByLuom, lUom) : "");
}

// ─── Layout CSS – same look as the Quotation List PDF (LANDSCAPE = default) ──
// Used together with fontMode: "native", so the sizes below are the real sizes.
// Letterhead / footer come from report_common; this only styles the body.
// NOTE: row selectors include "tbody" so they out-rank the zebra rule
// (tbody tr:nth-child(even) td) in report_common.
// Short/Excess red/green are business-meaning colours and are kept.

const JOB_DETAILS_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 12mm 12mm 12mm; }

  /* Make Chrome print background colors */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Letterhead – same as Enquiry List */
  .company-name       { font-size: 18px; font-weight: 700; }
  .company-address    { font-size: 11px; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  /* Title + filter strip */
  h1.report-title {
    margin: 28px 0 14px 0;
    font-size: 20px;
    font-weight: 700;
    color: #00378c;
  }
  .applied-filters { font-size: 10px; margin-bottom: 28px; }

  table.data-table {
    width: 100%;
    table-layout: fixed;
    font-size: 10.5px;
    margin-top: 0;
    border-collapse: collapse;
  }
  table.data-table th,
  table.data-table td {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  /* Header: solid blue bar, white bold text */
  table.data-table thead tr th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 12px 8px;
    border: 0;
    text-transform: none;
  }

  /* Section banners: Principal / Group / Product */
  table.data-table tbody tr.group-header-row td { font-weight: 700; color: #00378c; text-align: left; }
  table.data-table tbody tr.prin-row  td { background: #eaf0f8; font-size: 13px; font-weight: 700; padding: 11px 8px; }
  table.data-table tbody tr.group-row td { background: #f4f7fc; font-size: 10.5px; padding: 7px 8px 7px 16px; }
  table.data-table tbody tr.prod-row  td { background: #fafbfd; font-size: 10.5px; padding: 7px 8px 7px 28px; color: #334155; }

  /* Data rows */
  table.data-table tbody tr.data-row td {
    background: #fafcfe;
    padding: 9px 8px;
    border-bottom: 1px solid #e2e8f0;
    color: #1e293b;
  }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }

  /* Totals */
  table.data-table tbody tr.subtotal-row td {
    background: #e2e8f0; color: #00378c; font-weight: 700; padding: 8px 8px;
  }
  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0; color: #00378c; font-weight: 700; padding: 9px 8px;
    border-bottom: 1px solid #cbd5e1;
  }

  @media print {
    body::before { display: none !important; }
    table.data-table thead { display: table-header-group; }
    table.data-table tr { break-inside: avoid; page-break-inside: avoid; }
    table.data-table tr.group-header-row { break-after: avoid; page-break-after: avoid; }
    table.data-table tr.subtotal-row,
    table.data-table tr.grand-total-row  { break-before: avoid; page-break-before: avoid; }
  }
`;

// ─── PORTRAIT override CSS ──────────────────────────────────────────────────
// A4 portrait has ~186mm usable width (landscape has ~273mm). Applied when:
//   1. orientation=portrait  -> always
//   2. no orientation sent   -> automatically when the page/iframe is narrower than 900px

const PORTRAIT_RULES = `
  table.data-table th,
  table.data-table td {
    font-size: 8.5px !important;
    padding: 3px 3px !important;
    line-height: 1.2 !important;
  }
  table.data-table tbody tr.group-row td { font-size: 9.5px !important; }
  table.data-table tbody tr.prod-row td  { font-size: 8.5px !important; padding-left: 10px !important; }
  table.data-table tbody tr.grand-total-row td { font-size: 9px !important; }

  /* 10 columns, total = 100% */
  table.data-table col.c0 { width: 8%  !important; }
  table.data-table col.c1 { width: 8%  !important; }
  table.data-table col.c2 { width: 8%  !important; }
  table.data-table col.c3 { width: 8%  !important; }
  table.data-table col.c4 { width: 6%  !important; }
  table.data-table col.c5 { width: 6%  !important; }
  table.data-table col.c6 { width: 18% !important; }
  table.data-table col.c7 { width: 12% !important; }
  table.data-table col.c8 { width: 16% !important; }
  table.data-table col.c9 { width: 10% !important; }

  .info-grid { gap: 0 12px !important; }
  .field .label { flex: 0 0 80px !important; }
`;

const GRN_PORTRAIT_CSS = `
  @page { size: A4 portrait; margin: 6mm 8mm 12mm 8mm; }
  ${PORTRAIT_RULES}
`;

const GRN_AUTO_NARROW_CSS = `
  @media (max-width: 900px) {
    ${PORTRAIT_RULES}
  }
`;

// Lets the React parent page trigger printing through postMessage.
const PRINT_LISTENER_SCRIPT = `
  <script>
    window.addEventListener("message", function (e) {
      if (e.data === "print") window.print();
    });
  </script>`;

// ─── HTML body renderer ───────────────────────────────────────────────────────

function renderBodyHtml(
  groups:      GroupSection[],
  firstRow:    ReportRow | null,
  jobNo:       string,
  prinCode:    string,
  reportTitle: string
): string {
  const r = firstRow || {};

  const grandRecvPuom  = mergeUomTotals(...groups.map((g) => g.recvByPuom));
  const grandRecvLuom  = mergeUomTotals(...groups.map((g) => g.recvByLuom));
  const grandDamPuom   = mergeUomTotals(...groups.map((g) => g.damByPuom));
  const grandDamLuom   = mergeUomTotals(...groups.map((g) => g.damByLuom));
  const grandTotalPuom = mergeUomTotals(grandRecvPuom, grandDamPuom);
  const grandTotalLuom = mergeUomTotals(grandRecvLuom, grandDamLuom);

  const recordCount = groups.reduce((s, g) => s + g.products.reduce((ps, p) => ps + p.rows.length, 0), 0);

  const jobNoText    = text(r.job_no) || jobNo;
  const prinCodeText = text(r.prin_code) || prinCode;
  const prinText     = prinCodeText + (r.prin_name ? " - " + text(r.prin_name) : "");

  const field = (label: string, value: unknown) =>
    `<div class="field"><span class="label">${escapeHtml(label)}</span> <span class="value">${escapeHtml(text(value) || "\u2014")}</span></div>`;

  const emptyField = `<div class="field field--empty"><span class="label"></span><span class="value"></span></div>`;
  const col = (items: string[], n: number) =>
    items.concat(Array(Math.max(0, n - items.length)).fill(emptyField)).join("");

  const filtersHtml = reportAppliedFilters([
    { label: "Job No",    value: jobNoText },
    { label: "Principal", value: prinCodeText },
    { label: "GRN No",    value: text(r.grn_no) },
    { label: "GRN Date",  value: dateText(r.grn_date) },
  ]);

  const infoLeft = [
    field("Job Number", jobNoText),
    field("Principal",  prinText),
    field("GRN Number", r.grn_no),
  ];
  const infoMid = [
    field("GRN Date",       dateText(r.grn_date)),
    field("Container No",   r.container_no),
    field("Container Size", r.container_size),
  ];
  const infoRight = [
    field("Doc Ref",         r.doc_ref),
    field("Created By",      r.user_id),
    field("Prin. Reference", r.prin_ref1),
  ];

  // total row: label spans the first 6 cols, then Received / Damaged / Total, then empty Short/Excess
  const totalRow = (cls: string, label: string, recv: string, dam: string, total: string) =>
    `<tr class="${cls}">` +
    `<td class="right" colspan="${LABEL_SPAN}">${label}</td>` +
    `<td class="right">${escapeHtml(recv)}</td>` +
    `<td class="right">${escapeHtml(dam)}</td>` +
    `<td class="right">${escapeHtml(total)}</td>` +
    `<td class="right"></td>` +
    `</tr>`;

  const C = GRN_COLUMNS;
  let bodyRows = "";

  for (const gs of groups) {
    bodyRows += `<tr class="group-header-row group-row"><td colspan="${COL_COUNT}">Group : ${escapeHtml(gs.groupName)}</td></tr>`;

    for (const pg of gs.products) {
      const prodLabel = `${escapeHtml(pg.prodCode)}${pg.prodName ? " - " + escapeHtml(pg.prodName) : ""}`;
      bodyRows += `<tr class="group-header-row prod-row"><td colspan="${COL_COUNT}">${prodLabel} | ASN Qty : ${escapeHtml(asnText(pg))}</td></tr>`;

      for (const dr of pg.rows) {
        const qtyPuom    = parseFloat(String(dr.qtypuom))          || 0;
        const qtyLuom    = parseFloat(String(dr.qtyluom))          || 0;
        const qtyPuomDam = parseFloat(String(dr.qtypuom_dam))      || 0;
        const qtyLuomDam = parseFloat(String(dr.qtyluom_dam))      || 0;
        const qtyPuomExp = parseFloat(String(dr.qtypuom_expected)) || 0;
        const qtyLuomExp = parseFloat(String(dr.qtyluom_expected)) || 0;
        const drPuom     = text(dr.p_uom);
        const drLuom     = text(dr.l_uom);

        const recvStr  = fmtQtyCell(qtyPuom, drPuom, qtyLuom, drLuom);
        const damStr   = fmtQtyCell(qtyPuomDam, drPuom, qtyLuomDam, drLuom);
        const totalStr = fmtQtyCell(qtyPuom + qtyPuomDam, drPuom, qtyLuom + qtyLuomDam, drLuom);
        const se       = fmtShortExcessCell(qtyPuomExp, qtyPuom, drPuom, qtyLuomExp, qtyLuom, drLuom);

        bodyRows +=
          `<tr class="data-row">` +
          `<td class="${C[0].align}">${escapeHtml(dateText(dr.mfg_date))}</td>` +
          `<td class="${C[1].align}">${escapeHtml(dateText(dr.exp_date))}</td>` +
          `<td class="${C[2].align}">${escapeHtml(dr.batch_no || "\u2014")}</td>` +
          `<td class="${C[3].align}">${escapeHtml(dr.lot_no || "\u2014")}</td>` +
          `<td class="${C[4].align}">${escapeHtml(dr.grosswt || "\u2014")}</td>` +
          `<td class="${C[5].align}">${escapeHtml(dr.netwt || "\u2014")}</td>` +
          `<td class="${C[6].align}">${escapeHtml(recvStr)}</td>` +
          `<td class="${C[7].align} dim">${escapeHtml(damStr)}</td>` +
          `<td class="${C[8].align}">${escapeHtml(totalStr)}</td>` +
          `<td class="${C[9].align}${se.cls ? " " + se.cls : ""}">${escapeHtml(se.text)}</td>` +
          `</tr>`;
      }
    }

    const gsTotalPuom = mergeUomTotals(gs.recvByPuom, gs.damByPuom);
    const gsTotalLuom = mergeUomTotals(gs.recvByLuom, gs.damByLuom);

    bodyRows += totalRow(
      "subtotal-row",
      `Sub Total (Group : ${escapeHtml(gs.groupName)}):`,
      fmtBothTotals(gs.recvByPuom, gs.recvByLuom),
      fmtBothTotals(gs.damByPuom, gs.damByLuom),
      fmtBothTotals(gsTotalPuom, gsTotalLuom)
    );
  }

  bodyRows += totalRow(
    "grand-total-row",
    `GRAND TOTAL (${recordCount} Records):`,
    fmtBothTotals(grandRecvPuom, grandRecvLuom),
    fmtBothTotals(grandDamPuom, grandDamLuom),
    fmtBothTotals(grandTotalPuom, grandTotalLuom)
  );

  const colgroup    = C.map((_, i) => `<col class="c${i}" />`).join("");
  const headerCells = C.map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`).join("");

  return `
    <h1 class="report-title">${escapeHtml(reportTitle)}</h1>
    ${filtersHtml}

    <div class="info-grid">
      <div>${col(infoLeft, 3)}</div>
      <div>${col(infoMid, 3)}</div>
      <div>${col(infoRight, 3)}</div>
    </div>

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    ${PRINT_LISTENER_SCRIPT}
  `;
}

async function renderHtml(
  req: RequestWithUser,
  groups: GroupSection[],
  firstRow: ReportRow | null,
  jobNo: string,
  prinCode: string,
  reportTitle: string,
  loginId: string,
  autoPrint: boolean,
  orientation: Orientation = "auto"
): Promise<string> {
  const headerHtml = await reportHeader({ company_code: text(req.user?.company_code), req });
  const bodyHtml   = renderBodyHtml(groups, firstRow, jobNo, prinCode, reportTitle);
  const footerHtml = reportFooter({
    reportName: "rpt_grn",
    userName:   loginId,
    endLabel:   "Powered by Bayanat Technology",
  });

  return buildReportDocument({
    title: `${reportTitle} - ${jobNo}`,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss:
      orientation === "portrait"  ? JOB_DETAILS_EXTRA_CSS + GRN_PORTRAIT_CSS :
      orientation === "landscape" ? JOB_DETAILS_EXTRA_CSS :
                                    JOB_DETAILS_EXTRA_CSS + GRN_AUTO_NARROW_CSS,
    autoPrint,
    showPrintButton: true,
    fontMode: "native",
  });
}

// ─── Excel builder ────────────────────────────────────────────────────────────
// Same palette / Arial font as the DN Summary Excel.
// STYLE_ID values must stay in sync with <cellXfs> order in stylesXml below.

const STYLE_ID = {
  default:     0,
  header:      1,   // white on #00378c, centered
  title:       2,   // blue bold 14, no fill
  meta:        3,   // grey on #f8fafc
  secGroup:    4,   // blue bold on #eaf0f8
  secProduct:  5,   // slate bold on #f4f7fc
  data:        6,   // left, light bottom border
  dataCenter:  7,   // centered, light bottom border
  dataRight:   8,   // right, light bottom border
  subTotal:    9,   // #f1f5f9, blue bold, right
  grandTotal: 10,   // #e2e8f0, blue bold, right
  short:      11,   // red, right
  excess:     12,   // green bold, right
  footer:     13,   // italic grey, right
} as const;

type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(
  groups: GroupSection[],
  firstRow: ReportRow | null,
  jobNo: string,
  prinCode: string,
  reportTitle: string
): Buffer {
  const NCOLS = COL_COUNT;
  type Row = (XlCell | null)[];
  const skip = null;
  const r    = firstRow || {};
  const rows: Row[] = [];

  const spanRow = (label: string, style: StyleKey) => {
    const row: Row = Array(NCOLS).fill(skip);
    row[0] = xc(label, style);
    rows.push(row);
  };

  // total row: label merged across first 6 cols, then Received / Damaged / Total / blank
  const totalRow = (label: string, recv: string, dam: string, total: string, lvl: "subTotal" | "grandTotal") => {
    const row: Row = Array(NCOLS).fill(skip);
    row[0] = xc(label, lvl);
    row[6] = xc(recv,  lvl);
    row[7] = xc(dam,   lvl);
    row[8] = xc(total, lvl);
    row[9] = xc("",    lvl);
    rows.push(row);
  };

  const recordCount = groups.reduce((s, g) => s + g.products.reduce((ps, p) => ps + p.rows.length, 0), 0);

  spanRow(reportTitle, "title");
  spanRow(
    `Applied Filters: Job No: ${text(r.job_no) || jobNo} | Principal: ${text(r.prin_code) || prinCode} | GRN No: ${text(r.grn_no) || "\u2014"} | GRN Date: ${dateText(r.grn_date)}`,
    "meta"
  );

  rows.push(GRN_COLUMNS.map((c) => xc(c.label, "header")));

  for (const gs of groups) {
    spanRow(`Group : ${gs.groupName}`, "secGroup");

    for (const pg of gs.products) {
      spanRow(
        `${pg.prodCode}${pg.prodName ? " - " + pg.prodName : ""} | ASN Qty : ${asnText(pg)}`,
        "secProduct"
      );

      for (const dr of pg.rows) {
        const qtyPuom    = parseFloat(String(dr.qtypuom))          || 0;
        const qtyLuom    = parseFloat(String(dr.qtyluom))          || 0;
        const qtyPuomDam = parseFloat(String(dr.qtypuom_dam))      || 0;
        const qtyLuomDam = parseFloat(String(dr.qtyluom_dam))      || 0;
        const qtyPuomExp = parseFloat(String(dr.qtypuom_expected)) || 0;
        const qtyLuomExp = parseFloat(String(dr.qtyluom_expected)) || 0;
        const drPuom     = text(dr.p_uom);
        const drLuom     = text(dr.l_uom);

        const recvStr  = fmtQtyCell(qtyPuom, drPuom, qtyLuom, drLuom);
        const damStr   = fmtQtyCell(qtyPuomDam, drPuom, qtyLuomDam, drLuom);
        const totalStr = fmtQtyCell(qtyPuom + qtyPuomDam, drPuom, qtyLuom + qtyLuomDam, drLuom);
        const se       = fmtShortExcessCell(qtyPuomExp, qtyPuom, drPuom, qtyLuomExp, qtyLuom, drLuom);

        rows.push([
          xc(dateText(dr.mfg_date),          "dataCenter"),
          xc(dateText(dr.exp_date),          "dataCenter"),
          xc(text(dr.batch_no) || "\u2014",  "data"),
          xc(text(dr.lot_no)   || "\u2014",  "data"),
          xc(text(dr.grosswt)  || "\u2014",  "dataRight"),
          xc(text(dr.netwt)    || "\u2014",  "dataRight"),
          xc(recvStr,                        "dataRight"),
          xc(damStr,                         "dataRight"),
          xc(totalStr,                       "dataRight"),
          xc(se.text, se.cls === "excess" ? "excess" : se.cls === "short" ? "short" : "dataRight"),
        ]);
      }
    }

    const gsTotalPuom = mergeUomTotals(gs.recvByPuom, gs.damByPuom);
    const gsTotalLuom = mergeUomTotals(gs.recvByLuom, gs.damByLuom);
    totalRow(
      `Sub Total (Group : ${gs.groupName}):`,
      fmtBothTotals(gs.recvByPuom, gs.recvByLuom),
      fmtBothTotals(gs.damByPuom, gs.damByLuom),
      fmtBothTotals(gsTotalPuom, gsTotalLuom),
      "subTotal"
    );
  }

  const grandRecvPuom  = mergeUomTotals(...groups.map((g) => g.recvByPuom));
  const grandRecvLuom  = mergeUomTotals(...groups.map((g) => g.recvByLuom));
  const grandDamPuom   = mergeUomTotals(...groups.map((g) => g.damByPuom));
  const grandDamLuom   = mergeUomTotals(...groups.map((g) => g.damByLuom));
  const grandTotalPuom = mergeUomTotals(grandRecvPuom, grandDamPuom);
  const grandTotalLuom = mergeUomTotals(grandRecvLuom, grandDamLuom);

  totalRow(
    `GRAND TOTAL (${recordCount} Records):`,
    fmtBothTotals(grandRecvPuom, grandRecvLuom),
    fmtBothTotals(grandDamPuom, grandDamLuom),
    fmtBothTotals(grandTotalPuom, grandTotalLuom),
    "grandTotal"
  );

  {
    const row: Row = Array(NCOLS).fill(skip);
    row[NCOLS - 1] = xc("Powered by Bayanat Technology", "footer");
    rows.push(row);
  }

  const COL_WIDTHS = [13, 13, 16, 16, 11, 11, 24, 22, 26, 22];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // merge each run of "value followed by nulls" into one merged range
  const merges: string[] = [];
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let spanStart = -1;
    row.forEach((cell, ci) => {
      if (cell !== null && spanStart === -1) {
        spanStart = ci;
      } else if (cell === null && spanStart !== -1) {
        let end = ci;
        while (end + 1 < row.length && row[end + 1] === null) end++;
        if (end > spanStart)
          merges.push(`${String.fromCharCode(65 + spanStart)}${rn}:${String.fromCharCode(65 + end)}${rn}`);
        spanStart = -1;
      } else if (cell !== null) {
        spanStart = ci;
      }
    });
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="24" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${String.fromCharCode(65 + ci)}${rn}`;
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

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="10">
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="14"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><sz val="9"/><color rgb="FF475569"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF334155"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFDC2626"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF16A34A"/><name val="Arial"/></font>
    <font><i/><sz val="8"/><color rgb="FF64748B"/><name val="Arial"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF00378C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="5">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FFCBD5E1"/></top><bottom/><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FF00378C"/></top><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF00378C"/></left><right style="thin"><color rgb="FF00378C"/></right>
      <top style="thin"><color rgb="FF00378C"/></top><bottom style="thin"><color rgb="FF00378C"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="9" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="GRN Detail" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Route handlers ───────────────────────────────────────────────────────────

export const getGrnReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title)    || "Goods Receipt Note";
    const autoPrint   = req.query.print === "true";
    const orientation = getOrientation(req);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadGrnData(req, jobNo, prinCode);
    const groups = groupRows(rows);
    const first  = rows[0] ?? null;

    const html = await renderHtml(
      req, groups, first, jobNo, prinCode, reportTitle,
      text(req.user?.loginid), autoPrint, orientation
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("GRN HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getGrnReportPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const orientation = getOrientation(req);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows        = await loadGrnData(req, jobNo, prinCode);
    const groups      = groupRows(rows);
    const first       = rows[0] ?? null;
    const reportTitle = "Goods Receipt Note";
    const html = await renderHtml(
      req, groups, first, jobNo, prinCode, reportTitle,
      text(req.user?.loginid), true, orientation
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="GRN_${jobNo}.pdf"`);
    res.send(html);
  } catch (error: any) {
    console.error("GRN PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const getGrnReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Goods Receipt Note";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadGrnData(req, jobNo, prinCode);
    const groups = groupRows(rows);
    const buffer = buildExcelBuffer(groups, rows[0] ?? null, jobNo, prinCode, reportTitle);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="GRN_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("GRN Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};