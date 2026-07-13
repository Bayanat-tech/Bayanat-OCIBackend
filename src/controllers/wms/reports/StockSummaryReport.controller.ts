import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";
const AdmZip = require("adm-zip");


// ─── Types ────────────────────────────────────────────────────────────────────

type TGroupBy = "group_brand" | "principal_product" | "product_group" | "site_location" | "";

type ReportRow = Record<string, any>;

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn)
    try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  );
}

// ─── Field mapping layer ──────────────────────────────────────────────────────

function mapRow(row: ReportRow): ReportRow {
  let brandCode = row.brand_code;
  let brandName = row.brand_name;
  if (brandName && typeof brandName === "string" && brandName.includes(" - ")) {
    const idx      = brandName.indexOf(" - ");
    const codePart = brandName.slice(0, idx).trim();
    const namePart = brandName.slice(idx + 3).trim();
    if (!brandCode || codePart === brandCode) {
      brandCode = brandCode || codePart;
      brandName = namePart;
    }
  }

  return {
    ...row,
    qty_rcvd:        row.qty_rcvd,
    qty_available:   row.qty_avl      ?? row.qty_available,
    qty_picked:      row.qty_picked,
    pqty_picked:     row.pqty_picked,
    lqty_picked:     row.lqty_picked,
    pqty_avl:        row.pqty_avl,
    lqty_avl:        row.lqty_avl,
    prod_group_code: row.group_code   ?? row.prod_group_code,
    prod_group_name: row.group_name   ?? row.prod_group_name,
    primary_uom:     row.p_uom        ?? row.primary_uom,
    leat_uom:        row.l_uom        ?? row.leat_uom,
    brand_code:      brandCode,
    brand_name:      brandName,
    upp:             row.upp,
    volume:          row.volume,
  };
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
  const abs       = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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

// ─── Stock Qty in L Units formula ─────────────────────────────────────────────
// (Qty Picked Primary * UPP) + Qty Picked Leat

function calcStockQtyLUnits(row: ReportRow): number {
  return num(row.pqty_picked) * num(row.upp) + num(row.lqty_picked);
}

function calcStockQtyLUnitsTotals(rows: ReportRow[]): number {
  return rows.reduce((sum, r) => sum + calcStockQtyLUnits(r), 0);
}

// ─── Request Param Parser ────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  const toArr = (val: any): string[] => {
    if (!val) return ["All"];
    if (Array.isArray(val)) return val.length ? val : ["All"];
    const s = text(val).trim();
    return s ? s.split(",").map((v) => v.trim()) : ["All"];
  };

  const prodCode     = toArr(req.body.prod_code);
  const siteCode     = toArr(req.body.site_code);
  const prinCode     = toArr(req.body.prin_code);
  const locationCode = toArr(req.body.location_code);
  const groupBy      = text(req.body.group_by) as TGroupBy;

  return { prodCode, siteCode, prinCode, locationCode, groupBy };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadStockData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  const conn   = await getConn(req);

  try {
    const prodBinds = params.prodCode.map((_, i) => `:prod${i}`);
    const siteBinds = params.siteCode.map((_, i) => `:site${i}`);
    const prinBinds = params.prinCode.map((_, i) => `:prin${i}`);
    const locBinds  = params.locationCode.map((_, i) => `:loc${i}`);

    const isGroupedBySite = params.groupBy === "site_location";

    const sql = `
      SELECT
        PRIN_CODE,
        PRIN_NAME,
        BRAND_CODE,
        BRAND_NAME,
        GROUP_CODE,
        GROUP_NAME,
        PROD_CODE,
        PROD_NAME,
        P_UOM,
        L_UOM,
        UPP,
        VOLUME,
        ${isGroupedBySite ? "SITE_CODE, LOCATION_CODE," : ""}
        SUM(QTY_RCVD)     AS QTY_RCVD,
        SUM(QTY_AVL)      AS QTY_AVL,
        SUM(QTY_PICKED)   AS QTY_PICKED,
        SUM(PQTY_PICKED)  AS PQTY_PICKED,
        SUM(LQTY_PICKED)  AS LQTY_PICKED,
        SUM(PQTY_AVL)     AS PQTY_AVL,
        SUM(LQTY_AVL)     AS LQTY_AVL
      FROM VW_BOWM_STK_LEDGER
      WHERE ('All' IN (${prinBinds.join(",")}) OR PRIN_CODE IN (${prinBinds.join(",")}))
        AND ('All' IN (${prodBinds.join(",")}) OR PROD_CODE IN (${prodBinds.join(",")}))
        AND ('All' IN (${siteBinds.join(",")}) OR SITE_CODE IN (${siteBinds.join(",")}))
        AND ('All' IN (${locBinds.join(",")}) OR LOCATION_CODE IN (${locBinds.join(",")}))
      GROUP BY
        PRIN_CODE, PRIN_NAME,
        BRAND_CODE, BRAND_NAME,
        GROUP_CODE, GROUP_NAME,
        PROD_CODE, PROD_NAME,
        P_UOM, L_UOM,
        UPP, VOLUME
        ${isGroupedBySite ? ", SITE_CODE, LOCATION_CODE" : ""}
      ORDER BY PRIN_CODE, BRAND_CODE, PROD_CODE
        ${isGroupedBySite ? ", SITE_CODE, LOCATION_CODE" : ""}
    `;

    const binds: Record<string, any> = {};
    params.prodCode.forEach((v, i) => { binds[`prod${i}`] = v; });
    params.siteCode.forEach((v, i) => { binds[`site${i}`] = v; });
    params.prinCode.forEach((v, i) => { binds[`prin${i}`] = v; });
    params.locationCode.forEach((v, i) => { binds[`loc${i}`] = v; });

    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return normalize(result.rows as any[]).map(mapRow);
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping helpers ─────────────────────────────────────────────────────────

function groupRowsBy(rows: ReportRow[], keyFn: (r: ReportRow) => string): Map<string, ReportRow[]> {
  const map = new Map<string, ReportRow[]>();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  });
  return map;
}

interface QtyTotals {
  rcvd: number;
  ppicked: number; lpicked: number;
  pavl: number; lavl: number;
  stockQtyLUnits: number;
}

function sumQty(rows: ReportRow[]): QtyTotals {
  let rcvd = 0, ppicked = 0, lpicked = 0, pavl = 0, lavl = 0;
  rows.forEach((r) => {
    rcvd    += num(r.qty_rcvd);
    ppicked += num(r.pqty_picked);
    lpicked += num(r.lqty_picked);
    pavl    += num(r.pqty_avl);
    lavl    += num(r.lqty_avl);
  });
  return { rcvd, ppicked, lpicked, pavl, lavl, stockQtyLUnits: calcStockQtyLUnitsTotals(rows) };
}

// ─── Column Spec ─────────────────────────────────────────────────────────────

interface ColSpec {
  extraHeaders: string[];
  extraColCount: number;
  extraCellsHtml: (row: ReportRow) => string[];
}

function getColSpec(groupBy: TGroupBy): ColSpec {
  switch (groupBy) {
    case "group_brand":
      return {
        extraHeaders:   ["Product Group"],
        extraColCount:  1,
        extraCellsHtml: (r) => [text(r.prod_group_name) || text(r.prod_group_code)],
      };
    case "principal_product":
      return {
        extraHeaders:   ["Product Group", "Brand"],
        extraColCount:  2,
        extraCellsHtml: (r) => [text(r.prod_group_code), text(r.brand_code)],
      };
    case "product_group":
      return {
        extraHeaders:   ["Brand"],
        extraColCount:  1,
        extraCellsHtml: (r) => [text(r.brand_name) || text(r.brand_code)],
      };
    case "site_location":
      return {
        extraHeaders:   ["Product Group", "Brand"],
        extraColCount:  2,
        extraCellsHtml: (r) => [
          text(r.prod_group_name) || text(r.prod_group_code),
          text(r.brand_name)      || text(r.brand_code),
        ],
      };
    default:
      return { extraHeaders: [], extraColCount: 0, extraCellsHtml: () => [] };
  }
}

// ─── Column layout ────────────────────────────────────────────────────────────
//
// Fixed columns (after extras):
//   [0] Product Code
//   [1] Product Name
//   [2] Primary UOM
//   [3] Leat UOM
//   [4] UPP
//   [5] Volume
//   [6] Site          (omitted when groupBy === "site_location")
//   [7] Qty Rcvd
//   --- Qty Available (parent) --- [no Total]
//   [8]  Primary
//   [9]  Leat
//   --- Qty Picked (parent) ---    [no Total]
//   [10] Primary
//   [11] Leat
//   [12] Stock Qty in L Units

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderHtml(rows: ReportRow[], groupBy: TGroupBy, loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const colSpec        = getColSpec(groupBy);
  const includeSiteCol = groupBy !== "site_location";

  const textLeafs  = 6 + (includeSiteCol ? 1 : 0);
  // Qty Available=2, Qty Picked=2, Stock Qty L=1
  const totalLeafs   = colSpec.extraColCount + textLeafs + 1 /* rcvd */ + 2 /* avl */ + 2 /* picked */ + 1 /* stock qty l */;
  const labelColspan = colSpec.extraColCount + textLeafs;

  // Grand totals accumulators
  let grandRcvd = 0;
  let grandPPicked = 0, grandLPicked = 0;
  let grandPAvl = 0, grandLAvl = 0;
  let grandStockQtyLUnits = 0;

  // ── Single product data row
  const renderProductRow = (row: ReportRow): string => {
    const rcvd    = num(row.qty_rcvd);
    const ppicked = num(row.pqty_picked);
    const lpicked = num(row.lqty_picked);
    const pavl    = num(row.pqty_avl);
    const lavl    = num(row.lqty_avl);
    const stockQtyL = calcStockQtyLUnits(row);

    grandRcvd           += rcvd;
    grandPPicked        += ppicked;
    grandLPicked        += lpicked;
    grandPAvl           += pavl;
    grandLAvl           += lavl;
    grandStockQtyLUnits += stockQtyL;

    const extraCells = colSpec.extraCellsHtml(row)
      .map((v) => `<td>${escapeHtml(v)}</td>`)
      .join("");
    const siteCell = includeSiteCol ? `<td>${escapeHtml(row.site_code)}</td>` : "";

    return `
      <tr class="data-row">
        ${extraCells}
        <td>${escapeHtml(row.prod_code)}</td>
        <td>${escapeHtml(row.prod_name)}</td>
        <td class="center">${escapeHtml(row.primary_uom)}</td>
        <td class="center">${escapeHtml(row.leat_uom)}</td>
        <td class="num">${fmtNumber(num(row.upp))}</td>
        <td class="num">${fmtNumber(num(row.volume))}</td>
        ${siteCell}
        <td class="num">${fmtNumber(rcvd)}</td>
        <td class="num">${fmtNumber(pavl)}</td>
        <td class="num">${fmtNumber(lavl)}</td>
        <td class="num">${fmtNumber(ppicked)}</td>
        <td class="num">${fmtNumber(lpicked)}</td>
        <td class="num stock-qty-l">${fmtNumber(stockQtyL)}</td>
      </tr>`;
  };

  // ── Subtotal cells: rcvd + avl(2) + picked(2) + stockQtyL(1)
  const qtySubtotalCells = (q: QtyTotals): string => `
    <td class="num">${fmtNumber(q.rcvd)}</td>
    <td class="num">${fmtNumber(q.pavl)}</td>
    <td class="num">${fmtNumber(q.lavl)}</td>
    <td class="num">${fmtNumber(q.ppicked)}</td>
    <td class="num">${fmtNumber(q.lpicked)}</td>
    <td class="num stock-qty-l">${fmtNumber(q.stockQtyLUnits)}</td>`;

  // ── Product block
  const renderProductBlock = (prodRows: ReportRow[]): string => {
    if (!prodRows.length) return "";
    const first = prodRows[0];
    const pQty  = sumQty(prodRows);
    const lines = prodRows.map(renderProductRow).join("");

    return `
      <tr class="product-header">
        <td colspan="${totalLeafs}">
          Product : ${escapeHtml(first.prod_code)} | ${escapeHtml(first.prod_name)}
          &nbsp;&nbsp;&nbsp;
          <span class="uom">Primary UOM : ${escapeHtml(first.primary_uom)}</span>
          &nbsp;&nbsp;&nbsp;
          <span class="uom">Leat UOM : ${escapeHtml(first.leat_uom)}</span>
        </td>
      </tr>
      ${lines}
      <tr class="subtotal-row">
        <td class="subtotal-label" colspan="${labelColspan}">Product Total :</td>
        ${qtySubtotalCells(pQty)}
      </tr>`;
  };

  const byProductCode = (group: ReportRow[]): ReportRow[][] =>
    Array.from(groupRowsBy(group, (r) => text(r.prod_code)).values());

  const byPrin = groupRowsBy(rows, (r) => text(r.prin_code));

  let bodyHtml = "";

  byPrin.forEach((prinRows, prinCode) => {
    const prinName = text(prinRows[0]?.prin_name);
    const prinQty  = sumQty(prinRows);

    bodyHtml += `
      <tr class="principal-header">
        <td colspan="${totalLeafs}">Principal : ${escapeHtml(prinCode)} | ${escapeHtml(prinName)}</td>
      </tr>`;

    if (groupBy === "group_brand") {
      const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
      byBrand.forEach((brandRows, brandCode) => {
        const brandName = text(brandRows[0]?.brand_name);
        const brandQty  = sumQty(brandRows);
        bodyHtml += `
          <tr class="group-header">
            <td colspan="${totalLeafs}">Brand : ${escapeHtml(brandCode)} | ${escapeHtml(brandName)}</td>
          </tr>`;
        byProductCode(brandRows).forEach((p) => { bodyHtml += renderProductBlock(p); });
        bodyHtml += `<tr class="group-total-row"><td class="subtotal-label" colspan="${labelColspan}">Brand Total :</td>${qtySubtotalCells(brandQty)}</tr>`;
      });

    } else if (groupBy === "principal_product") {
      byProductCode(prinRows).forEach((p) => { bodyHtml += renderProductBlock(p); });

    } else if (groupBy === "product_group") {
      const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
      byGroup.forEach((grpRows, grpCode) => {
        const grpName = text(grpRows[0]?.prod_group_name);
        const grpQty  = sumQty(grpRows);
        bodyHtml += `
          <tr class="group-header">
            <td colspan="${totalLeafs}">Product Group : ${escapeHtml(grpCode)} | ${escapeHtml(grpName)}</td>
          </tr>`;
        byProductCode(grpRows).forEach((p) => { bodyHtml += renderProductBlock(p); });
        bodyHtml += `<tr class="group-total-row"><td class="subtotal-label" colspan="${labelColspan}">Product Group Total :</td>${qtySubtotalCells(grpQty)}</tr>`;
      });

    } else if (groupBy === "site_location") {
      const bySite = groupRowsBy(prinRows, (r) => text(r.site_code));
      bySite.forEach((siteRows, siteCode) => {
        const siteQty = sumQty(siteRows);
        bodyHtml += `
          <tr class="site-header">
            <td colspan="${totalLeafs}">Site : ${escapeHtml(siteCode)}</td>
          </tr>`;
        const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
        byLoc.forEach((locRows, locationCode) => {
          const locQty = sumQty(locRows);
          bodyHtml += `
            <tr class="location-header">
              <td colspan="${totalLeafs}">Site : ${escapeHtml(siteCode)} | Location : ${escapeHtml(locationCode)}</td>
            </tr>`;
          byProductCode(locRows).forEach((p) => { bodyHtml += renderProductBlock(p); });
          bodyHtml += `<tr class="group-total-row"><td class="subtotal-label" colspan="${labelColspan}">Site &amp; Location Total :</td>${qtySubtotalCells(locQty)}</tr>`;
        });
        bodyHtml += `<tr class="site-total-row"><td class="subtotal-label" colspan="${labelColspan}">Site Total :</td>${qtySubtotalCells(siteQty)}</tr>`;
      });

    } else {
      byProductCode(prinRows).forEach((p) => { bodyHtml += renderProductBlock(p); });
    }

    bodyHtml += `<tr class="principal-total-row"><td class="subtotal-label" colspan="${labelColspan}">Principal Total :</td>${qtySubtotalCells(prinQty)}</tr>`;
  });

  const grandTotalLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";
  const grandQty: QtyTotals = {
    rcvd: grandRcvd,
    ppicked: grandPPicked, lpicked: grandLPicked,
    pavl: grandPAvl, lavl: grandLAvl,
    stockQtyLUnits: grandStockQtyLUnits,
  };

  const extraHeaderCells1 = colSpec.extraHeaders
    .map((h) => `<th rowspan="2">${escapeHtml(h)}</th>`)
    .join("");
  const siteHeaderCell1 = includeSiteCol ? `<th rowspan="2">Site</th>` : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Stock Summary Report</title>
  <style>
    @media print {
      @page { size: A3 landscape; margin: 8mm; }
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      font-family: Arial, sans-serif;
      font-size: 8px;
      color: #000;
      background: #eef2f7;
      overflow-x: hidden;
      overflow-y: auto;
    }
    .sheet {
      width: 100%;
      max-width: 100%;
      margin: 0 auto;
      background: #fff;
      padding: 10px 12px;
      overflow-x: auto;
    }
    .report-title {
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 3px;
      margin-bottom: 5px;
      color: #fafcfeff;
      background: #1d4ed8;
      padding: 4px 0;
    }
    .report-meta {
      display: flex;
      justify-content: space-between;
      font-size: 8px;
      margin-bottom: 6px;
      color: #333;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.5px;
      table-layout: auto;
    }
    th {
      background: #1d4ed8;
      border: 1px solid #1e3a8a;
      padding: 3px 3px;
      text-align: center;
      font-weight: 700;
      white-space: normal;
      word-break: break-word;
      color: #ffffff;
    }
    th.parent-qty {
      background: #1e40af;
      border-bottom: 2px solid #93c5fd;
    }
    th.sub-qty {
      background: #2563eb;
      font-size: 7px;
    }
    th.stock-qty-l-hdr {
      background: #0f3460;
      font-size: 7px;
      font-weight: 700;
    }
    td {
      border: 1px solid #cbd5e1;
      padding: 1px 3px;
      vertical-align: top;
      word-break: break-word;
    }
    td.num    { text-align: right; font-variant-numeric: tabular-nums; }
    td.center { text-align: center; }
    td.subtotal-label { text-align: right; font-weight: 700; padding-right: 6px; }
    th.stock-qty-l-hdr {
  background: #1d4ed8;   /* was #0f3460 */
  font-size: 7.5px;      /* was 7px */
  font-weight: 700;
}
    tr.principal-header td {
      background: #1d4ed8;
      color: #fff;
      font-weight: 700;
      border: 1px solid #1d4ed8;
      padding: 3px 5px;
    }
    tr.group-header td,
    tr.site-header td,
    tr.location-header td {
      background: #dbeafe;
      font-weight: 700;
      border: 1px solid #93c5fd;
      padding: 2px 5px;
    }
    tr.location-header td {
      background: #eff6ff;
      padding-left: 12px;
    }
    tr.product-header td {
      background: #eff6ff;
      font-weight: 700;
      border: 1px solid #bfdbfe;
      padding: 2px 5px;
    }
    tr.product-header .uom {
      font-weight: normal;
      font-size: 7.5px;
      color: #444;
    }
    tr.data-row td { background: #fff; }
    tr.subtotal-row td {
      background: #fffde7;
      font-weight: 700;
      border-top: 1px solid #999;
    }
    tr.subtotal-row td.num { text-align: right; }
    tr.group-total-row td {
      background: #dbeafe;
      font-weight: 700;
      border-top: 1px solid #2563eb;
    }
    tr.group-total-row td.num { text-align: right; }
    tr.site-total-row td {
      background: #bfdbfe;
      font-weight: 700;
      border-top: 1px solid #1d4ed8;
    }
    tr.site-total-row td.num { text-align: right; }
    tr.principal-total-row td {
      background: #93c5fd;
      font-weight: 700;
      border-top: 2px solid #1e40af;
    }
    tr.principal-total-row td.num { text-align: right; }
    tr.grand-total-row td {
      background: #1d4ed8;
      color: #fff;
      font-weight: 700;
      font-size: 8px;
      border: 2px solid #1e3a8a;
    }
    tr.grand-total-row td.num { text-align: right; }
    .report-footer {
      display: flex;
      justify-content: space-between;
      font-size: 7.5px;
      color: #666;
      margin-top: 6px;
      border-top: 1px solid #ccc;
      padding-top: 3px;
    }
    @media print {
      html, body { background: white; overflow: visible; font-size: 10px; }
      .sheet { width: auto; min-width: 420mm; padding: 6mm; overflow: visible; }
      table { font-size: 9px; }
      th, td { white-space: nowrap; }
      .actions { display: none !important; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
    }
  </style>
</head>
<body>
<main class="sheet">
  <div class="report-title">S t o c k &nbsp; S u m m a r y &nbsp; R e p o r t</div>
  <div class="report-meta">
    <span>Print Date : ${printDateTime}</span>
    <span>Print User : ${escapeHtml(loginId)}</span>
  </div>
  <table>
    <thead>
      <!-- Row 1: parent-level headers -->
      <tr>
        ${extraHeaderCells1}
        <th rowspan="2">Product Code</th>
        <th rowspan="2">Product Name</th>
        <th rowspan="2">Primary UOM</th>
        <th rowspan="2">Leat UOM</th>
        <th rowspan="2">UPP</th>
        <th rowspan="2">Volume</th>
        ${siteHeaderCell1}
        <th rowspan="2">Qty Rcvd</th>
        <th colspan="2">Qty Available</th>
        <th colspan="2">Qty Picked</th>
        <th rowspan="2">Stock Qty in L Units</th>
      </tr>
      <!-- Row 2: sub-column leaf headers -->
      <tr>
        <th class="sub-qty">Primary</th>
        <th class="sub-qty">Leat</th>
        <th class="sub-qty">Primary</th>
        <th class="sub-qty">Leat</th>
      </tr>
    </thead>
    <tbody>
      ${bodyHtml || `<tr><td colspan="${totalLeafs}" style="text-align:center;color:#666;padding:20px">No data found</td></tr>`}
    </tbody>
    <tfoot>
      <tr class="grand-total-row">
        <td class="subtotal-label" colspan="${labelColspan}">${grandTotalLabel}</td>
        ${qtySubtotalCells(grandQty)}
      </tr>
    </tfoot>
  </table>
  <div class="report-footer">
    <span>Report: rpt_stock_summary</span>
    <span>Powered by Bayanat Technology</span>
  </div>
</main>
</body>
</html>`;
}

// ─── Excel Builder ────────────────────────────────────────────────────────────

function buildExcelBuffer(rows: ReportRow[], groupBy: TGroupBy, loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const BLUE     = "FF1D4ED8";
  const BLUE2    = "FF1E40AF";
  const BLUE3    = "FF2563EB";
  const DARKBLUE = "FF0F3460";
  const INDIGO   = "FFE0E7FF";
  const WHITE    = "FFFFFFFF";
  const LBLUE    = "FFDBEAFE";
  const LBLUE2   = "FFEFF6FF";
  const YELLOW   = "FFFFFDE7";
  const SITEBLUE = "FFBFDBFE";

  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });

  const styles = {
    title: {
      font:      { bold: true, sz: 14, color: { rgb: WHITE } },
      fill:      { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font:      { bold: true, sz: 9, color: { rgb: WHITE } },
      fill:      { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top:    borderThin(BLUE), bottom: borderThin(BLUE),
        left:   borderThin(BLUE), right:  borderThin(BLUE),
      },
    },
    headerParentQty: {
      font:      { bold: true, sz: 9, color: { rgb: WHITE } },
      fill:      { fgColor: { rgb: BLUE2 } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top:    borderThin(BLUE2), bottom: borderThin("FF93C5FD"),
        left:   borderThin(BLUE2), right:  borderThin(BLUE2),
      },
    },
    headerSubQty: {
      font:      { bold: true, sz: 8, color: { rgb: WHITE } },
      fill:      { fgColor: { rgb: BLUE3 } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top:    borderThin(BLUE3), bottom: borderThin(BLUE3),
        left:   borderThin(BLUE3), right:  borderThin(BLUE3),
      },
    },
    headerStockQtyL: {
      font:      { bold: true, sz: 8, color: { rgb: WHITE } },
      fill:      { fgColor: { rgb: DARKBLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top:    borderThin(DARKBLUE), bottom: borderThin(DARKBLUE),
        left:   borderThin(DARKBLUE), right:  borderThin(DARKBLUE),
      },
    },
    principal: {
      font: { bold: true, sz: 9, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
    },
    group: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: LBLUE } },
    },
    location: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: LBLUE2 } },
    },
    product: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: "FFEFF6FF" } },
    },
    data: {
      font:      { sz: 9 },
      alignment: { vertical: "top" },
      border:    { bottom: borderThin("FFE2E8F0") },
    },
    dataNum: {
      font:      { sz: 9 },
      alignment: { horizontal: "right", vertical: "top" },
      numFmt:    "#,##0",
      border:    { bottom: borderThin("FFE2E8F0") },
    },
    dataStockQtyL: {
      font:      { bold: true, sz: 9, color: { rgb: "FF1E3A8A" } },
      fill:      { fgColor: { rgb: INDIGO } },
      alignment: { horizontal: "right", vertical: "top" },
      numFmt:    "#,##0",
      border:    { bottom: borderThin("FFE2E8F0") },
    },
    subtotal: {
      font:   { bold: true, sz: 9 },
      fill:   { fgColor: { rgb: YELLOW } },
      border: { top: borderThin("FF999999") },
    },
    subtotalNum: {
      font:      { bold: true, sz: 9 },
      fill:      { fgColor: { rgb: YELLOW } },
      alignment: { horizontal: "right" },
      numFmt:    "#,##0",
      border:    { top: borderThin("FF999999") },
    },
    subtotalStockQtyL: {
      font:      { bold: true, sz: 9, color: { rgb: "FF1E3A8A" } },
      fill:      { fgColor: { rgb: INDIGO } },
      alignment: { horizontal: "right" },
      numFmt:    "#,##0",
      border:    { top: borderThin("FF999999") },
    },
    groupTotal: {
      font:   { bold: true, sz: 9 },
      fill:   { fgColor: { rgb: LBLUE } },
      border: { top: borderThin("FF2563EB") },
    },
    groupTotalNum: {
      font:      { bold: true, sz: 9 },
      fill:      { fgColor: { rgb: LBLUE } },
      alignment: { horizontal: "right" },
      numFmt:    "#,##0",
      border:    { top: borderThin("FF2563EB") },
    },
    groupTotalStockQtyL: {
      font:      { bold: true, sz: 9, color: { rgb: "FF1E3A8A" } },
      fill:      { fgColor: { rgb: INDIGO } },
      alignment: { horizontal: "right" },
      numFmt:    "#,##0",
      border:    { top: borderThin("FF2563EB") },
    },
    siteTotal: {
      font:   { bold: true, sz: 9 },
      fill:   { fgColor: { rgb: SITEBLUE } },
      border: { top: borderThin("FF1D4ED8") },
    },
    siteTotalNum: {
      font:      { bold: true, sz: 9 },
      fill:      { fgColor: { rgb: SITEBLUE } },
      alignment: { horizontal: "right" },
      numFmt:    "#,##0",
      border:    { top: borderThin("FF1D4ED8") },
    },
    siteTotalStockQtyL: {
      font:      { bold: true, sz: 9, color: { rgb: "FF1E3A8A" } },
      fill:      { fgColor: { rgb: INDIGO } },
      alignment: { horizontal: "right" },
      numFmt:    "#,##0",
      border:    { top: borderThin("FF1D4ED8") },
    },
    grandTotal: {
      font:      { bold: true, sz: 10, color: { rgb: WHITE } },
      fill:      { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "right" },
      numFmt:    "#,##0",
    },
    grandTotalLabel: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
    },
    grandTotalStockQtyL: {
      font:      { bold: true, sz: 10, color: { rgb: WHITE } },
      fill:      { fgColor: { rgb: DARKBLUE } },
      alignment: { horizontal: "right" },
      numFmt:    "#,##0",
    },
  };

  const colSpec        = getColSpec(groupBy);
  const includeSiteCol = groupBy !== "site_location";

  const TEXT_FIXED = 6 + (includeSiteCol ? 1 : 0);
  // Qty Available=2, Qty Picked=2, Stock Qty L=1
  const COL_COUNT  = colSpec.extraColCount + TEXT_FIXED + 1 /* rcvd */ + 2 /* avl */ + 2 /* picked */ + 1 /* stock qty l */;
  const E          = colSpec.extraColCount;

  const idxRcvd      = E + TEXT_FIXED;
  const idxPAvl      = idxRcvd + 1;
  const idxLAvl      = idxRcvd + 2;
  const idxPPicked   = idxRcvd + 3;
  const idxLPicked   = idxRcvd + 4;
  const idxStockQtyL = idxRcvd + 5;

  const labelColspan = E + TEXT_FIXED;

  const sheetData: any[][]                    = [];
  const merges: XLSX.Range[]                  = [];
  const rowStyles: Array<Record<number, any>> = [];

  const addRow = (cells: any[], styleMap: Record<number, any>) => {
    sheetData.push(cells);
    rowStyles.push(styleMap);
  };

  const allStyle = (style: any) =>
    Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, style]));

  // ── Title
  const titleR = sheetData.length;
  addRow(
    ["S t o c k   S u m m a r y   R e p o r t", ...Array(COL_COUNT - 1).fill("")],
    allStyle(styles.title),
  );
  merges.push({ s: { r: titleR, c: 0 }, e: { r: titleR, c: COL_COUNT - 1 } });

  // ── Meta
  const metaR = sheetData.length;
  addRow(
    [`Print Date: ${printDateTime}`, "", `Print User: ${loginId}`, ...Array(COL_COUNT - 3).fill("")],
    { 0: styles.meta, 2: styles.meta },
  );
  merges.push({ s: { r: metaR, c: 0 }, e: { r: metaR, c: 1 } });
  merges.push({ s: { r: metaR, c: 2 }, e: { r: metaR, c: COL_COUNT - 1 } });

  // ── Blank spacer
  addRow(Array(COL_COUNT).fill(""), {});

  // ── Header row 1
  const h1Row = sheetData.length;
  const h1Cells  = Array(COL_COUNT).fill("");
  const h1Styles: Record<number, any> = {};

  colSpec.extraHeaders.forEach((h, i) => {
    h1Cells[i]  = h;
    h1Styles[i] = styles.header;
  });
  const fixedLabels = [
    "Product Code", "Product Name", "Primary UOM", "Leat UOM", "UPP", "Volume",
    ...(includeSiteCol ? ["Site"] : []),
    "Qty Rcvd",
  ];
  fixedLabels.forEach((lbl, i) => {
    h1Cells[E + i]  = lbl;
    h1Styles[E + i] = styles.header;
  });
  h1Cells[idxPAvl]      = "Qty Available";
  h1Cells[idxPPicked]   = "Qty Picked";
  h1Cells[idxStockQtyL] = "Stock Qty in L Units";
  h1Styles[idxPAvl]      = styles.headerParentQty;
  h1Styles[idxPPicked]   = styles.headerParentQty;
  h1Styles[idxStockQtyL] = styles.headerStockQtyL;

  addRow(h1Cells, h1Styles);

  // ── Header row 2
  const h2Row = sheetData.length;
  const h2Cells  = Array(COL_COUNT).fill("");
  const h2Styles: Record<number, any> = {};

  const subLabels: Array<{ idx: number; label: string }> = [
    { idx: idxPAvl,    label: "Primary" },
    { idx: idxLAvl,    label: "Leat"    },
    { idx: idxPPicked, label: "Primary" },
    { idx: idxLPicked, label: "Leat"    },
  ];
  subLabels.forEach(({ idx, label }) => {
    h2Cells[idx]  = label;
    h2Styles[idx] = styles.headerSubQty;
  });
  addRow(h2Cells, h2Styles);

  // Row-span merges for h1Row (spans both header rows)
  for (let c = 0; c < E + TEXT_FIXED + 1 /* rcvd */; c++) {
    merges.push({ s: { r: h1Row, c }, e: { r: h2Row, c } });
  }
  // Stock Qty in L Units spans 2 rows
  merges.push({ s: { r: h1Row, c: idxStockQtyL }, e: { r: h2Row, c: idxStockQtyL } });

  // Parent qty group merges: Avl=2 cols, Picked=2 cols
  merges.push({ s: { r: h1Row, c: idxPAvl    }, e: { r: h1Row, c: idxLAvl    } });
  merges.push({ s: { r: h1Row, c: idxPPicked }, e: { r: h1Row, c: idxLPicked } });

  // ── Section / total row helpers

  const addSectionRow = (label: string, style: any) => {
    const r = sheetData.length;
    addRow([label, ...Array(COL_COUNT - 1).fill("")], allStyle(style));
    merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 1 } });
  };

  const addTotalRow = (
    label: string,
    q: QtyTotals,
    labelStyle: any,
    numStyle: any,
    stockQtyLStyle: any,
  ) => {
    const r     = sheetData.length;
    const cells = Array(COL_COUNT).fill("");
    cells[0]             = label;
    cells[idxRcvd]       = q.rcvd;
    cells[idxPAvl]       = q.pavl;
    cells[idxLAvl]       = q.lavl;
    cells[idxPPicked]    = q.ppicked;
    cells[idxLPicked]    = q.lpicked;
    cells[idxStockQtyL]  = q.stockQtyLUnits;

    const styleMap: Record<number, any> = {};
    for (let i = 0; i < labelColspan; i++) styleMap[i] = labelStyle;
    [idxRcvd, idxPAvl, idxLAvl, idxPPicked, idxLPicked]
      .forEach((idx) => { styleMap[idx] = numStyle; });
    styleMap[idxStockQtyL] = stockQtyLStyle;

    addRow(cells, styleMap);
    if (labelColspan > 1) merges.push({ s: { r, c: 0 }, e: { r, c: labelColspan - 1 } });
  };



  // ── Product data row helper
  const addProductRow = (row: ReportRow) => {
    const extras  = colSpec.extraCellsHtml(row);
    const siteVal = includeSiteCol ? [text(row.site_code)] : [];
    const cells   = [
      ...extras,
      text(row.prod_code), text(row.prod_name), text(row.primary_uom), text(row.leat_uom),
      num(row.upp), num(row.volume),
      ...siteVal,
      num(row.qty_rcvd),
      num(row.pqty_avl),   num(row.lqty_avl),
      num(row.pqty_picked),num(row.lqty_picked),
      calcStockQtyLUnits(row),
    ];
    const styleMap: Record<number, any> = {};
    for (let i = 0; i < labelColspan; i++) styleMap[i] = styles.data;
    [idxRcvd, idxPAvl, idxLAvl, idxPPicked, idxLPicked]
      .forEach((idx) => { styleMap[idx] = styles.dataNum; });
    styleMap[idxStockQtyL] = styles.dataStockQtyL;
    addRow(cells, styleMap);
  };

  // ── Product block helper
  const renderProductXl = (prodRows: ReportRow[]) => {
    if (!prodRows.length) return;
    const first = prodRows[0];
    const pQty  = sumQty(prodRows);
    const pHRow = sheetData.length;
    addRow(
      [`Product : ${first.prod_code} | ${first.prod_name}   Primary UOM: ${first.primary_uom}   Leat UOM: ${first.leat_uom}`,
        ...Array(COL_COUNT - 1).fill("")],
      allStyle(styles.product),
    );
    merges.push({ s: { r: pHRow, c: 0 }, e: { r: pHRow, c: COL_COUNT - 1 } });
    prodRows.forEach(addProductRow);
    addTotalRow("Product Total :", pQty, styles.subtotal, styles.subtotalNum, styles.subtotalStockQtyL);
  };

  // ── Build data sections
  const byPrincipal = groupRowsBy(rows, (r) => text(r.prin_code));
  const byProdCode  = (g: ReportRow[]) => Array.from(groupRowsBy(g, (r) => text(r.prod_code)).values());

  byPrincipal.forEach((prinRows, prinCode) => {
    const prinName = text(prinRows[0]?.prin_name);
    const prinQty  = sumQty(prinRows);
    const prRow    = sheetData.length;
    addRow(
      [`Principal : ${prinCode} | ${prinName}`, ...Array(COL_COUNT - 1).fill("")],
      allStyle(styles.principal),
    );
    merges.push({ s: { r: prRow, c: 0 }, e: { r: prRow, c: COL_COUNT - 1 } });

    if (groupBy === "group_brand") {
      groupRowsBy(prinRows, (r) => text(r.brand_code)).forEach((brandRows, brandCode) => {
        const brandName = text(brandRows[0]?.brand_name);
        addSectionRow(`Brand : ${brandCode} | ${brandName}`, styles.group);
        byProdCode(brandRows).forEach(renderProductXl);
        addTotalRow("Brand Total :", sumQty(brandRows), styles.groupTotal, styles.groupTotalNum, styles.groupTotalStockQtyL);
      });
    } else if (groupBy === "principal_product") {
      byProdCode(prinRows).forEach(renderProductXl);
    } else if (groupBy === "product_group") {
      groupRowsBy(prinRows, (r) => text(r.prod_group_code)).forEach((grpRows, grpCode) => {
        const grpName = text(grpRows[0]?.prod_group_name);
        addSectionRow(`Product Group : ${grpCode} | ${grpName}`, styles.group);
        byProdCode(grpRows).forEach(renderProductXl);
        addTotalRow("Product Group Total :", sumQty(grpRows), styles.groupTotal, styles.groupTotalNum, styles.groupTotalStockQtyL);
      });
    } else if (groupBy === "site_location") {
      groupRowsBy(prinRows, (r) => text(r.site_code)).forEach((siteRows, siteCode) => {
        addSectionRow(`Site : ${siteCode}`, styles.group);
        groupRowsBy(siteRows, (r) => text(r.location_code)).forEach((locRows, locationCode) => {
          const locRow = sheetData.length;
          addRow(
            [`Site : ${siteCode} | Location : ${locationCode}`, ...Array(COL_COUNT - 1).fill("")],
            allStyle(styles.location),
          );
          merges.push({ s: { r: locRow, c: 0 }, e: { r: locRow, c: COL_COUNT - 1 } });
          byProdCode(locRows).forEach(renderProductXl);
          addTotalRow("Site & Location Total :", sumQty(locRows), styles.groupTotal, styles.groupTotalNum, styles.groupTotalStockQtyL);
        });
        addTotalRow("Site Total :", sumQty(siteRows), styles.siteTotal, styles.siteTotalNum, styles.siteTotalStockQtyL);
      });
    } else {
      byProdCode(prinRows).forEach(renderProductXl);
    }

    // Principal total
    addTotalRow("Principal Total :", prinQty, styles.grandTotalLabel, styles.grandTotal, styles.grandTotalStockQtyL);
    const lastIdx = sheetData.length - 1;
    for (let i = 0; i < COL_COUNT; i++) {
      if (i === idxStockQtyL) rowStyles[lastIdx][i] = styles.grandTotalStockQtyL;
      else rowStyles[lastIdx][i] = i < labelColspan ? styles.grandTotalLabel : styles.grandTotal;
    }
  });

  // ── Grand Total
  const grandLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";
  addTotalRow(grandLabel, sumQty(rows), styles.grandTotalLabel, styles.grandTotal, styles.grandTotalStockQtyL);

  // ── Footer
  addRow(
    ["", ...Array(COL_COUNT - 2).fill(""), "Powered by Bayanat Technology"],
    { [COL_COUNT - 1]: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } } },
  );

  // ── Build worksheet
  const ws      = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!merges"] = merges;
  ws["!cols"]   = Array.from({ length: COL_COUNT }, (_, i) => {
    const base = i - E;
    if (i < E)              return { wch: 16 };
    if (base === 0)          return { wch: 14 };
    if (base === 1)          return { wch: 30 };
    if (base === 2)          return { wch: 10 };
    if (base === 3)          return { wch: 10 };
    if (base === 4)          return { wch: 10 };
    if (base === 5)          return { wch: 10 };
    if (i === idxStockQtyL) return { wch: 16 };
    return { wch: 12 };
  });
  ws["!rows"] = sheetData.map((_, i) => ({ hpt: i === 0 ? 24 : i <= 3 ? 18 : 14 }));

  // ── Style engine

  interface FontDef   { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef   { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef     { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

  const fonts:   FontDef[]   = [{}];
  const fills:   FillDef[]   = [{}, {}];
  const borders: BorderDef[] = [{}];
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[]     = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164;

  const registerFont = (f: any): number => {
    const def: FontDef = { bold: !!f?.bold, italic: !!f?.italic, sz: f?.sz ?? 9, color: f?.color?.rgb };
    const key = `font:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fonts.push(def); const idx = fonts.length - 1; sigCache.set(key, idx); return idx;
  };
  const registerFill = (f: any): number => {
    if (!f?.fgColor?.rgb) return 0;
    const def: FillDef = { color: f.fgColor.rgb };
    const key = `fill:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fills.push(def); const idx = fills.length - 1; sigCache.set(key, idx); return idx;
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
    borders.push(def); const idx = borders.length - 1; sigCache.set(key, idx); return idx;
  };
  const registerNumFmt = (code?: string): number => {
    if (!code) return 0;
    const existing = numFmts.find((n) => n.code === code);
    if (existing) return existing.id;
    const id = nextCustomNumFmtId++; numFmts.push({ id, code }); return id;
  };
  const registerXf = (styleObj: any): number => {
    if (!styleObj) return 0;
    const fontId   = registerFont(styleObj.font),   fillId   = registerFill(styleObj.fill);
    const borderId = registerBorder(styleObj.border), numFmtId = registerNumFmt(styleObj.numFmt);
    const align = styleObj.alignment?.horizontal, wrap = !!styleObj.alignment?.wrapText;
    const key = `xf:${JSON.stringify({ fontId, fillId, borderId, numFmtId, align, wrap })}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    cellXfs.push({ fontId, fillId, borderId, numFmtId, align, wrap });
    const idx = cellXfs.length - 1; sigCache.set(key, idx); return idx;
  };

  const cellStyleIndex = new Map<string, number>();
  sheetData.forEach((row, r) => {
    const styleMap = rowStyles[r];
    row.forEach((_: any, c: number) => {
      if (styleMap[c]) cellStyleIndex.set(`${r},${c}`, registerXf(styleMap[c]));
    });
  });

  // ── Sheet XML
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  let sheetXmlData = "";
  for (let r2 = range.s.r; r2 <= range.e.r; r2++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref      = XLSX.utils.encode_cell({ r: r2, c });
      const cell     = ws[ref] as XLSX.CellObject | undefined;
      const styleIdx = cellStyleIndex.get(`${r2},${c}`);
      if (!cell && styleIdx === undefined) continue;
      const sAttr = styleIdx !== undefined ? ` s="${styleIdx}"` : "";
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c r="${ref}"${sAttr}><v>${value}</v></c>`);
      } else if (value !== undefined && value !== null && value !== "") {
        cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`);
      } else if (styleIdx !== undefined) {
        cells.push(`<c r="${ref}"${sAttr}/>`);
      }
    }
    if (cells.length) sheetXmlData += `<row r="${r2 + 1}">${cells.join("")}</row>`;
  }

  const mergesXml  = merges.map((m) => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`).join("");
  const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";
  const colsXml    = (ws["!cols"] || []).map((col: any, i: number) =>
    `<col min="${i+1}" max="${i+1}" width="${col.wch || 10}" customWidth="1"/>`).join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="14"/>
  <cols>${colsXml}</cols>
  <sheetData>${sheetXmlData}</sheetData>
  ${mergeFinal}
</worksheet>`;

  // ── styles.xml
  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`).join("")}</numFmts>`
    : "";

  const fontsXml = `<fonts count="${fonts.length}">${fonts.map((f) => `
    <font>
      ${f.sz    ? `<sz val="${f.sz}"/>`      : '<sz val="9"/>'}
      ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
      <name val="Arial"/>
      ${f.bold   ? "<b/>" : ""}
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

  const borderEdge = (rgb?: string) => rgb ? `<color rgb="${rgb}"/>` : "";
  const bordersXml = `<borders count="${borders.length}">${borders.map((b) => `
    <border>
      <left   style="${b.left   ? "thin" : "none"}">${borderEdge(b.left)}</left>
      <right  style="${b.right  ? "thin" : "none"}">${borderEdge(b.right)}</right>
      <top    style="${b.top    ? "thin" : "none"}">${borderEdge(b.top)}</top>
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
  <sheets><sheet name="Stock Summary" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"    Target="styles.xml"/>
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
  zip.addFile("[Content_Types].xml",        Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                Buffer.from(rels));
  zip.addFile("xl/workbook.xml",            Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/styles.xml",              Buffer.from(stylesXml));
  zip.addFile("xl/worksheets/sheet1.xml",   Buffer.from(sheetXml));
  return zip.toBuffer();
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getStockSummaryReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows   = await loadStockData(req);
    const html   = renderHtml(rows, params.groupBy, req.user?.loginid ?? "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Stock Summary Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportStockSummaryReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params   = parseParams(req);
    const rows     = await loadStockData(req);
    const buffer   = buildExcelBuffer(rows, params.groupBy, req.user?.loginid ?? "");
    const filename = `stock_summary_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Stock Summary Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};