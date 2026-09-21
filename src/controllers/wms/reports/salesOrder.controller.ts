import { Request, Response } from "express";
import oracledb = require("oracledb");
import * as XLSX from "xlsx";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// UOM-keyed totals e.g. { "PKT": 99, "CTN": 12 }
type UomTotals = Record<string, number>;

interface ProductGroup {
  serialNo: number;
  prodCode:   string;
  prodName:   string;
    
  qty1: number; // QTY_PUOM
  uom1: string; // P_UOM

  qty2: number; // QTY_LUOM
  uom2: string; // L_UOM

  rows:       ReportRow[];

  qty1ByUom: UomTotals;
  qty2ByUom: UomTotals;

}

interface GroupSection {
  orderNo: string;
  orderDate: string;

  custCode: string;
  custName: string;

  products: ProductGroup[];

  qty1ByUom: UomTotals;
  qty2ByUom: UomTotals;
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
  if (!value) return "—";
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
  if (!Number.isFinite(n)) return "—";
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
  if (keys.length === 0) return "—";

  // Put primaryUom first if provided
  const ordered = primaryUom
    ? [primaryUom, ...keys.filter(k => k !== primaryUom)]
    : keys;

  return ordered
    .filter(k => map[k] !== undefined)
    .map(k => `${numFmt(map[k])} ${k}`)
    .join(" / ");
}

/**
 * Merge two UomTotals maps (sum values for matching keys).
 */
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

  if (diffPuom === 0 && diffLuom === 0) return { text: "—", cls: "" };

  // Drive the Short/Excess label off the primary UOM diff; fall back to L_UOM
  // if the primary UOM diff happens to be zero.
  const driver  = diffPuom !== 0 ? diffPuom : diffLuom;
  const isExcess = driver < 0;
  const prefix  = isExcess ? "Excess: +" : "Short: -";

  const parts: string[] = [];
  if (diffPuom !== 0) parts.push(`${numFmt(Math.abs(diffPuom))} ${pUom}`.trim());
  if (diffLuom !== 0 && lUom) parts.push(`${numFmt(Math.abs(diffLuom))} ${lUom}`.trim());

  return { text: `${prefix}${parts.join(" / ")}`, cls: isExcess ? "excess" : "short" };
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadOrderData(
  req: RequestWithUser,
  prinCode: string,
  jobNo: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);

  try {
    const result = await conn.execute(
      `SELECT
         o.PRIN_CODE,
         pr.PRIN_NAME,
         o.JOB_NO,
         o.CUST_CODE,
         cu.CUST_NAME,
         o.ORDER_NO,
         o.ORDER_DATE,
         od.SERIAL_NO,
         od.PROD_CODE,
         p.PROD_NAME,
         od.QTY_PUOM,
         od.P_UOM,
         od.QTY_LUOM,
         od.L_UOM,
         od.QUANTITY,
         j.JOB_DATE
       FROM TO_ORDER o
       INNER JOIN TO_ORDER_DET od
         ON od.COMPANY_CODE = o.COMPANY_CODE
        AND od.PRIN_CODE    = o.PRIN_CODE
        AND od.JOB_NO       = o.JOB_NO
        AND od.ORDER_NO     = o.ORDER_NO
       INNER JOIN MS_PRINCIPAL pr
         ON pr.COMPANY_CODE = o.COMPANY_CODE
        AND pr.PRIN_CODE    = o.PRIN_CODE
       INNER JOIN MS_CUSTOMER cu
         ON cu.COMPANY_CODE = o.COMPANY_CODE
        AND cu.PRIN_CODE    = o.PRIN_CODE
        AND cu.CUST_CODE    = o.CUST_CODE
       INNER JOIN MS_PRODUCT p
         ON p.COMPANY_CODE = od.COMPANY_CODE
        AND p.PRIN_CODE    = od.PRIN_CODE
        AND p.PROD_CODE    = od.PROD_CODE
       INNER JOIN TI_JOB j
         ON j.COMPANY_CODE = o.COMPANY_CODE
        AND j.PRIN_CODE    = o.PRIN_CODE
        AND j.JOB_NO       = o.JOB_NO
       WHERE o.COMPANY_CODE = '${req.user.company_code}'
         AND o.PRIN_CODE    = :prin_code
         AND o.JOB_NO       = :job_no
       ORDER BY
         o.ORDER_NO,
         od.SERIAL_NO,
         od.PROD_CODE`,
      {
        prin_code: prinCode,
        job_no: jobNo,
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      }
    );

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}
// ─── Grouping ─────────────────────────────────────────────────────────────────

function groupRows(rows: ReportRow[]): GroupSection[] {
  const groupMap: Record<string, {

    orderNo:    string;
    orderDate:  string;
    custCode:   string;
    custName:   string;
    products:   Record<string, ProductGroup>;
    qty1ByUom:  UomTotals;
    qty2ByUom:  UomTotals;

  }> = {};

  for (const r of rows) {

    const groupKey = text(r.order_no) || "No Order";
    const prodKey  = `${text(r.serial_no)}-${text(r.prod_code)}`;
    const pUom     = text(r.p_uom);
    const lUom     = text(r.l_uom);

    const qtyPuom = parseFloat(String(r.qty_puom)) || 0;
    const qtyLuom = parseFloat(String(r.qty_luom)) || 0;

if (!groupMap[groupKey])
      groupMap[groupKey] = {
        orderNo:   text(r.order_no),
        orderDate: text(r.order_date),
        custCode:  text(r.cust_code),
        custName:  text(r.cust_name),
        products:  {},
        qty1ByUom: {},
        qty2ByUom: {},
      };

    if (!groupMap[groupKey].products[prodKey])
      groupMap[groupKey].products[prodKey] = {
        serialNo: parseInt(String(r.serial_no), 10) || 0,
        prodCode: text(r.prod_code),
        prodName: text(r.prod_name),

        qty1: 0,
        uom1: pUom,

        qty2: 0,
        uom2: lUom,

        rows: [],

        qty1ByUom: {},
        qty2ByUom: {},
      };

    const pg = groupMap[groupKey].products[prodKey];

    pg.rows.push(r);

    pg.qty1 += qtyPuom;
    pg.qty2 += qtyLuom;

    // Always accumulate PUOM
    addUom(pg.qty1ByUom, pUom, qtyPuom);

    // L_UOM rule: only if qty is not zero
    if (qtyLuom !== 0)
      addUom(pg.qty2ByUom, lUom, qtyLuom);

    const gs = groupMap[groupKey];

    addUom(gs.qty1ByUom, pUom, qtyPuom);

    if (qtyLuom !== 0)
      addUom(gs.qty2ByUom, lUom, qtyLuom);
  }

  return Object.values(groupMap).map((g) => ({
    ...g,
    products: Object.values(g.products),
  }));
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  groups:      GroupSection[],
  firstRow:    ReportRow | null,
  jobNo:       string,
  prinCode:    string,
  reportTitle: string,
  loginId:     string,
  autoPrint:   boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const r = firstRow || {};

  // ── Grand-level UOM totals ────────────────────────────────────────────────
  const grandTotalPuom = mergeUomTotals(...groups.map(g => g.qty1ByUom));
  const grandTotalLuom = mergeUomTotals(...groups.map(g => g.qty2ByUom));


  // ── Build body rows ────────────────────────────────────────────────────────
  let bodyRows = "";

  for (const gs of groups) {
    bodyRows += `
      <tr class="group-row">
       <td colspan="6">
        Order No./ Date:
        ${escapeHtml(gs.orderNo || "—")} /
        ${escapeHtml(dateText(gs.orderDate))}
        &nbsp;&nbsp;&nbsp;
        Customer:
        ${escapeHtml(gs.custName || "—")}
        ${gs.custCode ? `(${escapeHtml(gs.custCode)})` : ""}
      </td>
      </tr>`;

 for (const pg of gs.products) {
    bodyRows += `
      <tr class="data-row">
        <td class="num">
          ${escapeHtml(String(pg.serialNo || ""))}
        </td>

        <td>
          ${escapeHtml(pg.prodCode || "—")}
          ${pg.prodName ? ` | ${escapeHtml(pg.prodName)}` : ""}
        </td>

        <td class="num">
          ${escapeHtml(String(pg.qty1 || 0))}
        </td>

        <td>
          ${escapeHtml(pg.uom1 || "—")}
        </td>

        <td class="num">
          ${escapeHtml(String(pg.qty2 || 0))}
        </td>

        <td>
          ${escapeHtml(pg.uom2 || "—")}
        </td>
      </tr>`;
  }

  // Order total
  bodyRows += `
    <tr class="group-total">
      <td colspan="2">
        Total
      </td>

      <td colspan="2" class="num">
        ${escapeHtml(fmtUomTotals(gs.qty1ByUom))}
      </td>

      <td colspan="2" class="num">
        ${escapeHtml(fmtUomTotals(gs.qty2ByUom))}
      </td>
    </tr>`;
}

// Grand total row
const grandRow = `
  <tr class="grand-total">
    <td colspan="2">
      Grand Total
    </td>

    <td colspan="2" class="num">
      ${escapeHtml(fmtUomTotals(grandTotalPuom))}
    </td>

    <td colspan="2" class="num">
      ${escapeHtml(fmtUomTotals(grandTotalLuom))}
    </td>
  </tr>`;


  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)} - ${escapeHtml(jobNo)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 12px; color: #111827;
      background: #eef1f6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 277mm;
      min-height: 190mm;
      margin: 0 auto; background: #fff;
      padding: 10mm 12mm;
      border: 1px solid #c4cdd9;
    }

    /* ── Report header banner ── */
    .rpt-header {
      background: #1e3a5f; color: #fff; text-align: center;
      font-size: 14px; font-weight: 700; letter-spacing: .08em;
      padding: 10px 16px; text-transform: uppercase;
      border-radius: 3px 3px 0 0;
    }
    .rpt-meta {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 2px 6px;
      font-size: 10px; color: #4b5563;
    }
    .rpt-meta strong { color: #111827; font-weight: 600; }

    /* ── Job header block (flat label : value, no box) ── */
    .job-header {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0 16px;
      margin-bottom: 10px;
      padding: 8px 0 10px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 11px;
    }
    .job-col { display: flex; flex-direction: column; gap: 3px; }
    .job-row { display: flex; align-items: baseline; gap: 6px; line-height: 1.6; }
    .job-label {
      font-size: 10.5px;
      color: #6b7280;
      white-space: nowrap;
    }
    .job-label::after { content: ":"; }
    .job-value {
      font-size: 11px;
      font-weight: 700;
      color: #111827;
    }
    .job-value.nil { font-weight: 400; color: #9ca3af; }

    /* ── Data table ── */
    table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }

    col.c0  { width: 8%;  } col.c1  { width: 8%;  } col.c2  { width: 9%;  }
    col.c3  { width: 9%;  } col.c4  { width: 7%;  } col.c5  { width: 7%;  }
    col.c6  { width: 14%; } col.c7  { width: 11%; }
    col.c8  { width: 14%; } col.c9  { width: 13%; }

    thead tr.th-group th {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 10px; padding: 6px 10px; text-align: center;
      border-right: 1px solid rgba(255,255,255,0.15);
      border-bottom: 1px solid rgba(255,255,255,0.12);
    }
    thead tr.th-group th:last-child { border-right: none; }
    thead tr.th-sub th {
      background: #162d4a; color: #cbd5e1; font-weight: 600;
      font-size: 9.5px; padding: 5px 10px; text-align: left;
      border-right: 1px solid rgba(255,255,255,0.10);
      white-space: nowrap;
    }
    thead tr.th-sub th.num { text-align: right; }

    tr.group-row td {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 11px; padding: 5px 10px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    tr.prod-row td {
      background: #e8ecf2; color: #1e3a5f; font-weight: 700;
      font-size: 11px; padding: 4px 10px 4px 22px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-bottom: 1px solid #d5dce8;
    }
    tr.prod-row td.prod-asn {
      background: #e8ecf2; color: #374151; font-weight: 600;
      padding-left: 10px; text-align: right; font-size: 10.5px;
    }

    tbody tr.data-row td {
      padding: 4px 10px; border-bottom: 1px solid #e5e7eb;
      color: #374151; font-size: 11px;
      white-space: normal; word-wrap: break-word; overflow-wrap: break-word;
      vertical-align: top;
    }
    tbody tr.data-row:nth-child(even) td { background: #f9fafb; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    td.dim  { color: #9ca3af !important; font-weight: 400; }
    td.short  { color: #dc2626 !important; font-weight: 700; }
    td.excess { color: #16a34a !important; font-weight: 700; }

    tr.group-total td {
      background: #d5dce8; padding: 5px 10px; font-size: 11px;
      font-weight: 700; color: #1e3a5f; white-space: nowrap;
    }
    tr.grand-total td {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 12px; padding: 8px 10px;
      border-top: 2px solid #162d4a;
    }

    /* ── Footer ── */
    .rpt-footer {
      margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px;
      display: flex; justify-content: space-between;
      font-size: 9px; color: #9ca3af;
    }
    .rpt-footer code {
      font-family: "Courier New", monospace; font-size: 9px; color: #6b7280;
    }

    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; }
      thead { display: table-header-group; }

      /* Keep section headers attached to their first data row */
      tr.group-row,
      tr.prod-row {
        break-after: avoid;
        page-break-after: avoid;
      }

      /* Keep totals attached to the group above them */
      tr.group-total,
      tr.grand-total {
        break-before: avoid;
        page-break-before: avoid;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">

    <!-- ── Report title banner ── -->
    <div class="rpt-header">${escapeHtml(reportTitle)}</div>

    <!-- ── Print meta row ── -->
    <div class="rpt-meta">
      <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;Print User :&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
      <span>Page 1 of 1</span>
    </div>

    <!-- ── Job header block (flat, no box) ── -->
    <div class="job-header">

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Job No:</span>
          <span class="job-value">${escapeHtml(text(r.job_no) || jobNo)}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Job Date</span>
          <span class="job-value">  ${escapeHtml(text(r.job_date) || "—")}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Principal</span>
          <span class="job-value">${escapeHtml(text(r.prin_code) || prinCode)}${r.prin_name ? ` - ${escapeHtml(text(r.prin_name))}` : ""}</span>
        </div>
      </div>

    </div><!-- /job-header -->

    <!-- ── Data table ── -->
<table class="rpt-table">
  <colgroup>
    <col class="c0" />
    <col class="c1" />
    <col class="c2" />
    <col class="c3" />
    <col class="c4" />
    <col class="c5" />
  </colgroup>

  <thead>
    <tr class="th-group">
      <th class="col-no">No.</th>
      <th class="col-product">Product</th>
      <th class="col-qty">Quantity1</th>
      <th class="col-uom">UOM</th>
      <th class="col-qty">Quantity2</th>
      <th class="col-uom">UOM</th>
    </tr>
  </thead>

  <tbody>
    ${bodyRows}
    ${grandRow}
  </tbody>
</table>

    <!-- ── Page footer ── -->
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

// ─── Excel builder ─────────────────────────────────────────────────────────────

const STYLE_ID = {
  default:        0,
  header:         1,
  sectionGroup:   2,
  sectionProduct: 3,
  label:          4,
  value:          5,
  totalProduct:   6,
  totalGroup:     7,
  totalGrand:     8,
  numValue:       9,
  numTotal:      10,
  numGrand:      11,
  numShort:      12,
  numExcess:     13,
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell {
  v: unknown;
  s: number;
}

function xc(v: unknown, style: StyleKey): XlCell {
  return {
    v,
    s: STYLE_ID[style],
  };
}

function buildExcelBuffer(
  groups: GroupSection[],
  jobNo: string,
  prinCode: string
): Buffer {
  const NCOLS = 6;

  type Row = (XlCell | null)[];

  const skip = null;
  const rows: Row[] = [];

  // Total quantity from UOM-keyed totals
  const sumUomTotals = (totals: UomTotals): number =>
    Object.values(totals).reduce(
      (sum, qty) => sum + Number(qty || 0),
      0
    );

  // UOM names, for example: CTR / PCS
  const getUomNames = (totals: UomTotals): string =>
    Object.keys(totals)
      .filter((uom) => uom.trim() !== "")
      .join(" / ");

  // ── Title ────────────────────────────────────────────────────────────────

  rows.push([
    xc(
      `Sales Order Report ${jobNo} / ${prinCode}`,
      "header"
    ),
    ...Array(NCOLS - 1).fill(skip),
  ]);

  rows.push(Array(NCOLS).fill(skip));

  // ── Column headers ───────────────────────────────────────────────────────

  rows.push([
    xc("No.",       "header"),
    xc("Product",   "header"),
    xc("Quantity1", "header"),
    xc("UOM",       "header"),
    xc("Quantity2", "header"),
    xc("UOM",       "header"),
  ]);

  // ── Order sections ───────────────────────────────────────────────────────

  for (const gs of groups) {
    const orderDate = dateText(gs.orderDate) || "—";

    const customer = gs.custCode
      ? `${gs.custName} (${gs.custCode})`
      : gs.custName || "—";

    // Order header
    rows.push([
      xc(
        `Order No./ Date: ${gs.orderNo || "—"} / ${orderDate}` +
        `    Customer: ${customer}`,
        "sectionGroup"
      ),
      ...Array(NCOLS - 1).fill(skip),
    ]);

    // Product rows
    for (const pg of gs.products) {
      const product = pg.prodName
        ? `${pg.prodCode} | ${pg.prodName}`
        : pg.prodCode || "—";

      rows.push([
        xc(pg.serialNo || "", "numValue"),
        xc(product,            "value"),
        xc(pg.qty1,            "numValue"),
        xc(pg.uom1 || "",      "value"),
        xc(pg.qty2,            "numValue"),
        xc(pg.uom2 || "",      "value"),
      ]);
    }

    // Order total
    rows.push([
      xc("Total:", "totalGroup"),
      xc("",       "totalGroup"),

      xc(
        sumUomTotals(gs.qty1ByUom),
        "numTotal"
      ),

      xc(
        getUomNames(gs.qty1ByUom),
        "totalGroup"
      ),

      xc(
        sumUomTotals(gs.qty2ByUom),
        "numTotal"
      ),

      xc(
        getUomNames(gs.qty2ByUom),
        "totalGroup"
      ),
    ]);
  }

  // ── Grand-level UOM totals ───────────────────────────────────────────────

  const grandTotalPuom = mergeUomTotals(
    ...groups.map((g) => g.qty1ByUom)
  );

  const grandTotalLuom = mergeUomTotals(
    ...groups.map((g) => g.qty2ByUom)
  );

  // Grand total row
  rows.push([
    xc("Grand Total", "totalGrand"),
    xc("",            "totalGrand"),

    xc(
      sumUomTotals(grandTotalPuom),
      "numGrand"
    ),

    xc(
      getUomNames(grandTotalPuom),
      "totalGrand"
    ),

    xc(
      sumUomTotals(grandTotalLuom),
      "numGrand"
    ),

    xc(
      getUomNames(grandTotalLuom),
      "totalGrand"
    ),
  ]);

  // Keep your existing Excel XML/workbook generation code below this point.
  // It should use:
  //
  // rows
  // NCOLS = 6

  const COL_WIDTHS = [13, 13, 16, 16, 10, 10, 22, 22, 22, 18];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // Merge ranges
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
    const ht = rn === 1 ? ` ht="22" customHeight="1"` : "";
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
  <fonts count="8">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FFDC2626"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF16A34A"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD5DCE8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF1E3A5F"/></left><right style="thin"><color rgb="FF1E3A5F"/></right>
      <top style="thin"><color rgb="FF1E3A5F"/></top><bottom style="thin"><color rgb="FF1E3A5F"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
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

export const getSalesOrderReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
   // const companyCode     = text(req.params.companyCode  || req.query.companyCode);
    const  jobNo     = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title)    || "Sales Order Report";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message:  "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadOrderData(req, prinCode, jobNo);
    const groups = groupRows(rows);
    const first  = rows[0] ?? null;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(groups, first,jobNo,prinCode, reportTitle, text(req.user?.loginid), autoPrint));
  } catch (error: any) {
    console.error("GRN HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getSalesOrderReportPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const companyCode     = text(req.params.companyCode  || req.query.companyCode);
    const jobNo    = text(req.params.job_no  || req.query.job_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!companyCode || !jobNo || !prinCode) {
      res.status(400).json({ success: false, message: " job_no and prin_code are required" });
      return;
    }

    const rows        = await loadOrderData(req, prinCode, jobNo);
    const groups      = groupRows(rows);
    const first       = rows[0] ?? null;
    const reportTitle = "Sales Order Report";
    const html = renderHtml(groups, first, jobNo, prinCode, reportTitle, text(req.user?.loginid), true);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="ORDER_${jobNo}.pdf"`);
    res.send(html);
  } catch (error: any) {
    console.error("GRN PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const exportSalesOrderReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const companyCode     = text(req.params.companyCode  || req.query.companyCode);
    const jobNo    = text(req.params.job_no  || req.query.job_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "company_code, job_no and prin_code are required" });
      return;
    }
    
    const rows   = await loadOrderData(req, prinCode, jobNo);
    const groups = groupRows(rows);
    const buffer = buildExcelBuffer(groups, jobNo, prinCode);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="ORDER_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("GRN Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};