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
//
// Maps VW_BOWM_STK_LEDGER column names to stable internal field names used
// throughout the rest of this file, matching the same contract as the
// Stock Detail report.
//
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
    qty_in_stock:    row.qty_stock   ?? row.qty_in_stock,
    qty_available:   row.qty_avl     ?? row.qty_available,
    qty_picked:      row.qty_picked,
    prod_group_code: row.group_code  ?? row.prod_group_code,
    prod_group_name: row.group_name  ?? row.prod_group_name,
    primary_uom:     row.p_uom       ?? row.primary_uom,
    leat_uom:        row.l_uom       ?? row.leat_uom,
    brand_code:      brandCode,
    brand_name:      brandName,
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
  const locationFrom = text(req.body.location_code_from || "");
  const locationTo   = text(req.body.location_code_to   || "");
  const groupBy      = text(req.body.group_by) as TGroupBy;

  return { prodCode, siteCode, prinCode, locationFrom, locationTo, groupBy };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────
//
// Stock Summary aggregates qty_in_stock / qty_available / qty_picked per
// product (and site/location when groupBy = "site_location"). Batch, lot,
// job, mfg date, etc. are intentionally excluded — summary-level only.

async function loadStockData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  const conn   = await getConn(req);

  try {
    const prodBinds = params.prodCode.map((_, i) => `:prod${i}`);
    const siteBinds = params.siteCode.map((_, i) => `:site${i}`);
    const prinBinds = params.prinCode.map((_, i) => `:prin${i}`);

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
        ${isGroupedBySite ? "SITE_CODE, LOCATION_CODE," : ""}
        SUM(QTY_STOCK)    AS QTY_STOCK,
        SUM(QTY_AVL)      AS QTY_AVL,
        SUM(QTY_PICKED)   AS QTY_PICKED
      FROM VW_BOWM_STK_LEDGER
      WHERE ('All' IN (${prinBinds.join(",")}) OR PRIN_CODE IN (${prinBinds.join(",")}))
        AND ('All' IN (${prodBinds.join(",")}) OR PROD_CODE IN (${prodBinds.join(",")}))
        AND ('All' IN (${siteBinds.join(",")}) OR SITE_CODE IN (${siteBinds.join(",")}))
        AND (
          :loc_from IS NULL OR :loc_to IS NULL OR :loc_from = '' OR :loc_to = ''
          OR LOCATION_CODE BETWEEN :loc_from AND :loc_to
        )
      GROUP BY
        PRIN_CODE, PRIN_NAME,
        BRAND_CODE, BRAND_NAME,
        GROUP_CODE, GROUP_NAME,
        PROD_CODE, PROD_NAME,
        P_UOM, L_UOM
        ${isGroupedBySite ? ", SITE_CODE, LOCATION_CODE" : ""}
      ORDER BY PRIN_CODE, BRAND_CODE, PROD_CODE
        ${isGroupedBySite ? ", SITE_CODE, LOCATION_CODE" : ""}
    `;

    const binds: Record<string, any> = {};
    params.prodCode.forEach((v, i) => { binds[`prod${i}`] = v; });
    params.siteCode.forEach((v, i) => { binds[`site${i}`] = v; });
    params.prinCode.forEach((v, i) => { binds[`prin${i}`] = v; });
    binds["loc_from"] = params.locationFrom || null;
    binds["loc_to"]   = params.locationTo   || null;

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

function sumQtyInStock(rows: ReportRow[]): number {
  return rows.reduce((acc, r) => acc + num(r.qty_in_stock), 0);
}

function sumQty(rows: ReportRow[]): { stock: number; avail: number; picked: number } {
  let stock = 0, avail = 0, picked = 0;
  rows.forEach((r) => {
    stock  += num(r.qty_in_stock);
    avail  += num(r.qty_available);
    picked += num(r.qty_picked);
  });
  return { stock, avail, picked };
}

// ─── Column Spec ─────────────────────────────────────────────────────────────
//
// Extra leading columns per groupBy — mirrors Stock Detail's getColSpec exactly.
//
//   group_brand       → Product Group
//   principal_product → Product Group, Brand
//   product_group     → Brand
//   site_location     → Product Group, Brand  (Site/Location shown as group headers)
//   "" (none)         → (no extras)

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

// Fixed columns (non-extra):
//   Product Code | Product Name | Primary UOM | Leat UOM | Qty in Stock | Qty Available | Qty Picked
//   = 4 text cols + 3 qty cols = 7 total fixed
//   When site_location the Site column is a group header, not a data column → same 7
const FIXED_COL_COUNT = 7;

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderHtml(rows: ReportRow[], groupBy: TGroupBy, loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const colSpec         = getColSpec(groupBy);
  const includeSiteCol  = groupBy !== "site_location";
  // When site_location is active the Site column is omitted from data rows
  // (it's shown as a group header). All other modes keep it.
  const effectiveFixedCols = includeSiteCol ? FIXED_COL_COUNT + 1 : FIXED_COL_COUNT;
  const totalCols           = effectiveFixedCols + colSpec.extraColCount;
  // labelColspan = everything before the 3 trailing qty columns
  const labelColspan        = (includeSiteCol ? 5 : 4) + colSpec.extraColCount;

  let grandInStock = 0, grandAvail = 0, grandPicked = 0;

  // ── One summary row per product (no batch sub-rows)
  const renderProductRow = (row: ReportRow): string => {
    const inStock = num(row.qty_in_stock);
    const avail   = num(row.qty_available);
    const picked  = num(row.qty_picked);
    grandInStock += inStock;
    grandAvail   += avail;
    grandPicked  += picked;

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
        ${siteCell}
        <td class="num">${fmtNumber(inStock)}</td>
        <td class="num">${fmtNumber(avail)}</td>
        <td class="num">${fmtNumber(picked)}</td>
      </tr>`;
  };

  // ── Product block: header row + single data row + Product Total
  const renderProductBlock = (prodRows: ReportRow[]): string => {
    if (!prodRows.length) return "";
    const first    = prodRows[0];
    const pQty     = sumQty(prodRows);

    const lines = prodRows.map(renderProductRow).join("");

    return `
      <tr class="product-header">
        <td colspan="${totalCols}">
          Product : ${escapeHtml(first.prod_code)} | ${escapeHtml(first.prod_name)}
          &nbsp;&nbsp;&nbsp;
          <span class="uom">Primary Unit of Measurement : ${escapeHtml(first.primary_uom)}</span>
          &nbsp;&nbsp;&nbsp;
          <span class="uom">Leat Unit of Measurement : ${escapeHtml(first.leat_uom)}</span>
        </td>
      </tr>
      ${lines}
      <tr class="subtotal-row">
        <td colspan="${labelColspan}">Product Total :</td>
        <td class="num">${fmtNumber(pQty.stock)}</td>
        <td class="num">${fmtNumber(pQty.avail)}</td>
        <td class="num">${fmtNumber(pQty.picked)}</td>
      </tr>`;
  };

  const byProductCode = (group: ReportRow[]): ReportRow[][] =>
    Array.from(groupRowsBy(group, (r) => text(r.prod_code)).values());

  const byPrin = groupRowsBy(rows, (r) => text(r.prin_code));

  let bodyHtml             = "";
  let extraHeaderRow2Cells = "";
  if (colSpec.extraColCount > 0) {
    extraHeaderRow2Cells = Array(colSpec.extraColCount).fill("<th></th>").join("");
  }

  byPrin.forEach((prinRows, prinCode) => {
    const prinName  = text(prinRows[0]?.prin_name);
    const prinQty   = sumQty(prinRows);

    bodyHtml += `
      <tr class="principal-header">
        <td colspan="${totalCols}">Principal : ${escapeHtml(prinCode)} | ${escapeHtml(prinName)}</td>
      </tr>`;

    if (groupBy === "group_brand") {
      // Principal → Brand → Product
      const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
      byBrand.forEach((brandRows, brandCode) => {
        const brandName = text(brandRows[0]?.brand_name);
        const brandQty  = sumQty(brandRows);

        bodyHtml += `
          <tr class="group-header">
            <td colspan="${totalCols}">Brand : ${escapeHtml(brandCode)} | ${escapeHtml(brandName)}</td>
          </tr>`;

        byProductCode(brandRows).forEach((prodRows) => {
          bodyHtml += renderProductBlock(prodRows);
        });

        bodyHtml += `
          <tr class="group-total-row">
            <td colspan="${labelColspan}">Brand Total :</td>
            <td class="num">${fmtNumber(brandQty.stock)}</td>
            <td class="num">${fmtNumber(brandQty.avail)}</td>
            <td class="num">${fmtNumber(brandQty.picked)}</td>
          </tr>`;
      });

    } else if (groupBy === "principal_product") {
      // Principal → Product (flat)
      byProductCode(prinRows).forEach((prodRows) => {
        bodyHtml += renderProductBlock(prodRows);
      });

    } else if (groupBy === "product_group") {
      // Principal → Product Group → Product
      const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
      byGroup.forEach((grpRows, grpCode) => {
        const grpName = text(grpRows[0]?.prod_group_name);
        const grpQty  = sumQty(grpRows);

        bodyHtml += `
          <tr class="group-header">
            <td colspan="${totalCols}">Product Group : ${escapeHtml(grpCode)} | ${escapeHtml(grpName)}</td>
          </tr>`;

        byProductCode(grpRows).forEach((prodRows) => {
          bodyHtml += renderProductBlock(prodRows);
        });

        bodyHtml += `
          <tr class="group-total-row">
            <td colspan="${labelColspan}">Product Group Total :</td>
            <td class="num">${fmtNumber(grpQty.stock)}</td>
            <td class="num">${fmtNumber(grpQty.avail)}</td>
            <td class="num">${fmtNumber(grpQty.picked)}</td>
          </tr>`;
      });

    } else if (groupBy === "site_location") {
      // Principal → Site → Location → Product
      const bySite = groupRowsBy(prinRows, (r) => text(r.site_code));
      bySite.forEach((siteRows, siteCode) => {
        const siteQty = sumQty(siteRows);

        bodyHtml += `
          <tr class="site-header">
            <td colspan="${totalCols}">Site : ${escapeHtml(siteCode)}</td>
          </tr>`;

        const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
        byLoc.forEach((locRows, locationCode) => {
          const locQty = sumQty(locRows);

          bodyHtml += `
            <tr class="location-header">
              <td colspan="${totalCols}">Site : ${escapeHtml(siteCode)} | Location : ${escapeHtml(locationCode)}</td>
            </tr>`;

          byProductCode(locRows).forEach((prodRows) => {
            bodyHtml += renderProductBlock(prodRows);
          });

          bodyHtml += `
            <tr class="group-total-row">
              <td colspan="${labelColspan}">Site &amp; Location Total :</td>
              <td class="num">${fmtNumber(locQty.stock)}</td>
              <td class="num">${fmtNumber(locQty.avail)}</td>
              <td class="num">${fmtNumber(locQty.picked)}</td>
            </tr>`;
        });

        bodyHtml += `
          <tr class="site-total-row">
            <td colspan="${labelColspan}">Site Total :</td>
            <td class="num">${fmtNumber(siteQty.stock)}</td>
            <td class="num">${fmtNumber(siteQty.avail)}</td>
            <td class="num">${fmtNumber(siteQty.picked)}</td>
          </tr>`;
      });

    } else {
      // No grouping — flat list under principal
      byProductCode(prinRows).forEach((prodRows) => {
        bodyHtml += renderProductBlock(prodRows);
      });
    }

    bodyHtml += `
      <tr class="principal-total-row">
        <td colspan="${labelColspan}">Principal Total :</td>
        <td class="num">${fmtNumber(prinQty.stock)}</td>
        <td class="num">${fmtNumber(prinQty.avail)}</td>
        <td class="num">${fmtNumber(prinQty.picked)}</td>
      </tr>`;
  });

  const grandTotalLabel   = groupBy === "site_location" ? "Total :" : "Grand Total :";
  const siteHeaderCell    = includeSiteCol ? "<th>Site</th>" : "";
  const extraHeaderCells  = colSpec.extraHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join("");

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
      overflow-x: hidden;
    }
    .report-title {
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 3px;
      margin-bottom: 5px;
      color: #fafcfeff;
      background: #1d4ed8;
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
      background: #fff;
      border: 1px solid #1d4ed8;
      padding: 2px 3px;
      text-align: center;
      font-weight: 700;
      white-space: normal;
      word-break: break-word;
      color: #1e3a8a;
    }
    td {
      border: 1px solid #cbd5e1;
      padding: 1px 3px;
      vertical-align: top;
      word-break: break-word;
    }
    td.num    { text-align: right; font-variant-numeric: tabular-nums; }
    td.center { text-align: center; }

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
      <tr>
        ${extraHeaderCells}
        <th>Product Code</th>
        <th>Product Name</th>
        <th>Primary UOM</th>
        <th>Leat UOM</th>
        ${siteHeaderCell}
        <th>Qty in Stock</th>
        <th>Qty Available</th>
        <th>Qty Picked</th>
      </tr>
    </thead>
    <tbody>
      ${bodyHtml || `<tr><td colspan="${totalCols}" style="text-align:center;color:#666;padding:20px">No data found</td></tr>`}
    </tbody>
    <tfoot>
      <tr class="grand-total-row">
        <td colspan="${labelColspan}">${grandTotalLabel}</td>
        <td class="num">${fmtNumber(grandInStock)}</td>
        <td class="num">${fmtNumber(grandAvail)}</td>
        <td class="num">${fmtNumber(grandPicked)}</td>
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
    groupTotal: {
      font:   { bold: true, sz: 9 },
      fill:   { fgColor: { rgb: "FFDBEAFE" } },
      border: { top: borderThin("FF2563EB") },
    },
    groupTotalNum: {
      font:      { bold: true, sz: 9 },
      fill:      { fgColor: { rgb: "FFDBEAFE" } },
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
  };

  const colSpec        = getColSpec(groupBy);
  const includeSiteCol = groupBy !== "site_location";
  // Columns: [extras...] | Prod Code | Prod Name | Primary UOM | Leat UOM | [Site?] | Stock | Avail | Picked
  const FIXED    = includeSiteCol ? 8 : 7;   // 4 text + 1 site + 3 qty  OR  4 text + 3 qty
  const COL_COUNT      = colSpec.extraColCount + FIXED;
  const extraColOffset = colSpec.extraColCount;
  // labelColspan: everything before the 3 qty columns
  const labelColspan   = extraColOffset + (includeSiteCol ? 5 : 4);
  const qtyStart       = labelColspan;

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

  // ── Header row
  const headers = [
    ...colSpec.extraHeaders,
    "Product Code", "Product Name", "Primary UOM", "Leat UOM",
    ...(includeSiteCol ? ["Site"] : []),
    "Qty in Stock", "Qty Available", "Qty Picked",
  ];
  const hRow = sheetData.length;
  addRow(headers, Object.fromEntries(headers.map((_, i) => [i, styles.header])));

  // ── Helper: section header row (full-width merge)
  const addSectionRow = (label: string, style: any) => {
    const r = sheetData.length;
    addRow([label, ...Array(COL_COUNT - 1).fill("")], allStyle(style));
    merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 1 } });
  };

  // ── Helper: total row (label spans to qty start, then 3 qty cells)
  const addTotalRow = (
    label: string,
    qty: { stock: number; avail: number; picked: number },
    labelStyle: any,
    numStyle: any,
  ) => {
    const r     = sheetData.length;
    const cells = Array(COL_COUNT).fill("");
    cells[0]           = label;
    cells[qtyStart]     = qty.stock;
    cells[qtyStart + 1] = qty.avail;
    cells[qtyStart + 2] = qty.picked;
    const styleMap: Record<number, any> = {};
    for (let i = 0; i < qtyStart; i++) styleMap[i] = labelStyle;
    styleMap[qtyStart]     = numStyle;
    styleMap[qtyStart + 1] = numStyle;
    styleMap[qtyStart + 2] = numStyle;
    addRow(cells, styleMap);
    if (qtyStart > 1) merges.push({ s: { r, c: 0 }, e: { r, c: qtyStart - 1 } });
  };

  // ── Helper: product data row
  const addProductRow = (row: ReportRow) => {
    const inStock = num(row.qty_in_stock);
    const avail   = num(row.qty_available);
    const picked  = num(row.qty_picked);
    const extras  = colSpec.extraCellsHtml(row);
    const siteVal = includeSiteCol ? [text(row.site_code)] : [];
    const cells   = [
      ...extras,
      text(row.prod_code), text(row.prod_name), text(row.primary_uom), text(row.leat_uom),
      ...siteVal,
      inStock, avail, picked,
    ];
    const styleMap: Record<number, any> = {};
    for (let i = 0; i < qtyStart; i++) styleMap[i] = styles.data;
    styleMap[qtyStart]     = styles.dataNum;
    styleMap[qtyStart + 1] = styles.dataNum;
    styleMap[qtyStart + 2] = styles.dataNum;
    addRow(cells, styleMap);
  };

  // ── Helper: product block (header + data row + Product Total)
  const renderProductXl = (prodRows: ReportRow[]) => {
    if (!prodRows.length) return;
    const first = prodRows[0];
    const pQty  = sumQty(prodRows);

    const pHRow    = sheetData.length;
    const prodLabel = `Product : ${first.prod_code} | ${first.prod_name}   Primary UOM: ${first.primary_uom}   Leat UOM: ${first.leat_uom}`;
    addRow(
      [prodLabel, ...Array(COL_COUNT - 1).fill("")],
      allStyle(styles.product),
    );
    merges.push({ s: { r: pHRow, c: 0 }, e: { r: pHRow, c: COL_COUNT - 1 } });

    prodRows.forEach(addProductRow);

    addTotalRow("Product Total :", pQty, styles.subtotal, styles.subtotalNum);
  };

  // ── Build data by principal
  const byPrincipal = groupRowsBy(rows, (r) => text(r.prin_code));

  byPrincipal.forEach((prinRows, prinCode) => {
    const prinName  = text(prinRows[0]?.prin_name);
    const prinQty   = sumQty(prinRows);

    const prRow = sheetData.length;
    addRow(
      [`Principal : ${prinCode} | ${prinName}`, ...Array(COL_COUNT - 1).fill("")],
      allStyle(styles.principal),
    );
    merges.push({ s: { r: prRow, c: 0 }, e: { r: prRow, c: COL_COUNT - 1 } });

    const byProductCode = (group: ReportRow[]) =>
      Array.from(groupRowsBy(group, (r) => text(r.prod_code)).values());

    if (groupBy === "group_brand") {
      const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
      byBrand.forEach((brandRows, brandCode) => {
        const brandName = text(brandRows[0]?.brand_name);
        addSectionRow(`Brand : ${brandCode} | ${brandName}`, styles.group);
        byProductCode(brandRows).forEach(renderProductXl);
        addTotalRow("Brand Total :", sumQty(brandRows), styles.groupTotal, styles.groupTotalNum);
      });

    } else if (groupBy === "principal_product") {
      byProductCode(prinRows).forEach(renderProductXl);

    } else if (groupBy === "product_group") {
      const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
      byGroup.forEach((grpRows, grpCode) => {
        const grpName = text(grpRows[0]?.prod_group_name);
        addSectionRow(`Product Group : ${grpCode} | ${grpName}`, styles.group);
        byProductCode(grpRows).forEach(renderProductXl);
        addTotalRow("Product Group Total :", sumQty(grpRows), styles.groupTotal, styles.groupTotalNum);
      });

    } else if (groupBy === "site_location") {
      const bySite = groupRowsBy(prinRows, (r) => text(r.site_code));
      bySite.forEach((siteRows, siteCode) => {
        addSectionRow(`Site : ${siteCode}`, styles.group);

        const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
        byLoc.forEach((locRows, locationCode) => {
          const locRow = sheetData.length;
          addRow(
            [`Site : ${siteCode} | Location : ${locationCode}`, ...Array(COL_COUNT - 1).fill("")],
            allStyle(styles.location),
          );
          merges.push({ s: { r: locRow, c: 0 }, e: { r: locRow, c: COL_COUNT - 1 } });

          byProductCode(locRows).forEach(renderProductXl);
          addTotalRow("Site & Location Total :", sumQty(locRows), styles.groupTotal, styles.groupTotalNum);
        });

        addTotalRow("Site Total :", sumQty(siteRows), styles.siteTotal, styles.siteTotalNum);
      });

    } else {
      byProductCode(prinRows).forEach(renderProductXl);
    }

    // Principal Total — styled as grand total blue bar
    const ptRow = sheetData.length;
    addTotalRow("Principal Total :", prinQty, styles.grandTotalLabel, styles.grandTotal);
    // Re-apply grand total styling to entire principal total row
    const lastIdx = sheetData.length - 1;
    for (let i = 0; i < qtyStart; i++)   rowStyles[lastIdx][i] = styles.grandTotalLabel;
    for (let i = qtyStart; i < COL_COUNT; i++) rowStyles[lastIdx][i] = styles.grandTotal;
  });

  // ── Grand Total
  const grandLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";
  const grandQty   = sumQty(rows);
  addTotalRow(grandLabel, grandQty, styles.grandTotalLabel, styles.grandTotal);

  // ── Footer
  addRow(
    ["", ...Array(COL_COUNT - 2).fill(""), "Powered by Bayanat Technology"],
    { [COL_COUNT - 1]: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } } },
  );

  // ── Build worksheet via SheetJS AOA then hand-write styled XML
  const ws        = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!merges"]   = merges;
  ws["!cols"]     = Array.from({ length: COL_COUNT }, (_, i) => {
    if (i < extraColOffset)     return { wch: 16 };
    if (i === extraColOffset)   return { wch: 14 }; // Product Code
    if (i === extraColOffset+1) return { wch: 28 }; // Product Name
    if (i === extraColOffset+2) return { wch: 11 }; // Primary UOM
    if (i === extraColOffset+3) return { wch: 11 }; // Leat UOM
    return { wch: 14 };
  });
  ws["!rows"] = sheetData.map((_, i) => ({ hpt: i === 0 ? 24 : 14 }));

  // ── Style registration (identical engine to Stock Detail) ────────────────

  interface FontDef   { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef   { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef     { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

  const fonts:   FontDef[]   = [{}];
  const fills:   FillDef[]   = [{}, {}];   // 0/1 reserved per OOXML
  const borders: BorderDef[] = [{}];
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[]     = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164;

  const registerFont = (f: any): number => {
    const def: FontDef = { bold: !!f?.bold, italic: !!f?.italic, sz: f?.sz ?? 9, color: f?.color?.rgb };
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
      top:    b.top?.color?.rgb,
      bottom: b.bottom?.color?.rgb,
      left:   b.left?.color?.rgb,
      right:  b.right?.color?.rgb,
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
    const fontId   = registerFont(styleObj.font);
    const fillId   = registerFill(styleObj.fill);
    const borderId = registerBorder(styleObj.border);
    const numFmtId = registerNumFmt(styleObj.numFmt);
    const align    = styleObj.alignment?.horizontal;
    const wrap     = !!styleObj.alignment?.wrapText;
    const key = `xf:${JSON.stringify({ fontId, fillId, borderId, numFmtId, align, wrap })}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    cellXfs.push({ fontId, fillId, borderId, numFmtId, align, wrap });
    const idx = cellXfs.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const cellStyleIndex = new Map<string, number>();
  sheetData.forEach((row, r) => {
    const styleMap = rowStyles[r];
    row.forEach((_: any, c: number) => {
      if (styleMap[c]) cellStyleIndex.set(`${r},${c}`, registerXf(styleMap[c]));
    });
  });

  // ── Sheet XML with s="N" on every styled cell
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
      ${f.sz    ? `<sz val="${f.sz}"/>`          : '<sz val="9"/>'}
      ${f.color ? `<color rgb="${f.color}"/>`     : '<color rgb="FF000000"/>'}
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
  zip.addFile("[Content_Types].xml",           Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                   Buffer.from(rels));
  zip.addFile("xl/workbook.xml",               Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels",    Buffer.from(workbookRels));
  zip.addFile("xl/styles.xml",                 Buffer.from(stylesXml));
  zip.addFile("xl/worksheets/sheet1.xml",      Buffer.from(sheetXml));
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

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
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