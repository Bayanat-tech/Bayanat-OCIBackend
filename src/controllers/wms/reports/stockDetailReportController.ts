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
// VW_BOWM_STK_LEDGER's real column names don't all match the field names the
// renderer was originally written against. Rather than rewrite every reference
// across the HTML/Excel renderers (which are laid out to mirror the reference
// report PDFs exactly), every loaded row is passed through `mapRow()` once,
// right after `normalize()`, so the rest of the file can keep using the
// original field names (qty_in_stock, prod_group_code, dco_ref, etc.) as a
// stable internal contract — independent of whatever the view happens to be
// called underneath.
//
// Mapping (left = view column actually returned, right = internal field name
// used by the rest of this file):
//   QTY_STOCK     -> qty_in_stock
//   QTY_AVL       -> qty_available
//   QTY_PICKED    -> qty_picked          (name already matched, kept for clarity)
//   GROUP_CODE    -> prod_group_code
//   GROUP_NAME    -> prod_group_name
//   DOC_REF       -> dco_ref
//   UNIT_PRICE    -> manf_value
//   TXN_DATE      -> receipt_dt
//   CONTAINER_NO  -> container
//   P_UOM         -> primary_uom
//   L_UOM         -> leat_uom
//   FREEZE_FLAG   -> freeze
//   BRAND_NAME    -> brand_name          (split out of "CODE - NAME" combined value)
//
function mapRow(row: ReportRow): ReportRow {
  // BRAND_NAME arrives as a combined "00001 - NOKIA" string; split code/name
  // back apart so brand_code/brand_name behave like every other code/name pair.
  let brandCode = row.brand_code;
  let brandName = row.brand_name;
  if (brandName && typeof brandName === "string" && brandName.includes(" - ")) {
    const idx = brandName.indexOf(" - ");
    const codePart = brandName.slice(0, idx).trim();
    const namePart = brandName.slice(idx + 3).trim();
    // Only treat it as "code - name" if the leading part actually looks like
    // the brand code we already have (defensive — avoids mis-splitting a
    // brand that legitimately has " - " in its name).
    if (!brandCode || codePart === brandCode) {
      brandCode = brandCode || codePart;
      brandName = namePart;
    }
  }

  return {
    ...row,
    qty_in_stock:    row.qty_stock,
    qty_available:   row.qty_avl,
    qty_picked:      row.qty_picked,
    prod_group_code: row.group_code,
    prod_group_name: row.group_name,
    dco_ref:         row.doc_ref,
    manf_value:      row.unit_price,
    receipt_dt:      row.txn_date,
    container:       row.container_no,
    primary_uom:     row.p_uom,
    leat_uom:        row.l_uom,
    freeze:          row.freeze_flag,
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
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

function dateText(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).substring(0, 10);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  }).replace(/ /g, "-");
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

  const jobNo          = toArr(req.body.job_no);
  const prodCode       = toArr(req.body.prod_code);
  const siteCode       = toArr(req.body.site_code);
  const prinCode       = toArr(req.body.prin_code);
  const locationFrom   = text(req.body.location_code_from || "");
  const locationTo     = text(req.body.location_code_to   || "");
  const groupBy        = text(req.body.group_by) as TGroupBy;

  return { jobNo, prodCode, siteCode, prinCode, locationFrom, locationTo, groupBy };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadStockData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  const conn   = await getConn(req);

  try {
    // Build dynamic bind params for IN clauses
    const jobBinds    = params.jobNo.map((_, i)    => `:job${i}`);
    const prodBinds   = params.prodCode.map((_, i)  => `:prod${i}`);
    const siteBinds   = params.siteCode.map((_, i)  => `:site${i}`);
    const prinBinds   = params.prinCode.map((_, i)  => `:prin${i}`);

    const sql = `
      SELECT *
      FROM VW_BOWM_STK_LEDGER
      WHERE ('All' IN (${jobBinds.join(",")})  OR JOB_NO    IN (${jobBinds.join(",")}))
        AND ('All' IN (${prodBinds.join(",")}) OR PROD_CODE  IN (${prodBinds.join(",")}))
        AND ('All' IN (${siteBinds.join(",")}) OR SITE_CODE  IN (${siteBinds.join(",")}))
        AND ('All' IN (${prinBinds.join(",")}) OR PRIN_CODE  IN (${prinBinds.join(",")}))
        AND (
          :loc_from IS NULL OR :loc_to IS NULL OR :loc_from = ''  OR :loc_to = ''
          OR LOCATION_CODE BETWEEN :loc_from AND :loc_to
        )
      ORDER BY PRIN_CODE, BRAND_CODE, SITE_CODE, LOCATION_CODE, PROD_CODE
    `;
    console.log("Executing SQL with binds:", sql, params);

    const binds: Record<string, any> = {};
    params.jobNo.forEach((v, i)    => { binds[`job${i}`]  = v; });
    params.prodCode.forEach((v, i)  => { binds[`prod${i}`] = v; });
    params.siteCode.forEach((v, i)  => { binds[`site${i}`] = v; });
    params.prinCode.forEach((v, i)  => { binds[`prin${i}`] = v; });
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

// ─── HTML Renderer ────────────────────────────────────────────────────────────

/**
 * Column layout per group_by mode (matches the reference report PDFs exactly):
 *
 *  - "group_brand"        : Principal -> Brand (header) -> Product (header) -> rows
 *                            row column: Product Group
 *                            totals: Product Total, Brand Total, Principal Total, Grand Total
 *
 *  - "principal_product"  : Principal -> Product (header) -> rows  (flat, no brand/group header)
 *                            row columns: Product Group, Brand
 *                            totals: Product Total, Principal Total, Grand Total
 *
 *  - "product_group"      : Principal -> Product Group (header) -> Product (header) -> rows
 *                            row column: Brand
 *                            totals: Product Total, Product Group Total, Principal Total, Grand Total
 *
 *  - "site_location"      : Principal -> Site (header) -> Location (header) -> Product (header) -> rows
 *                            row columns: Product Group, Brand
 *                            totals: Product Total, Location Total, Site Total, Principal Total, Total
 *
 *  - "" (no grouping)     : Principal -> Product (header) -> rows
 *                            row columns: none extra
 *                            totals: Product Total, Principal Total, Grand Total
 *
 * IMPORTANT: every <tr> in the table (header rows, data rows, sub-rows, and every
 * total/subtotal row) must add up — via its real <td> count plus any colspans — to
 * the exact same number of "logical" columns (`totalCols` below), or the table
 * renders unevenly (columns drift between rows). When `site_location` grouping is
 * active the per-row "Site" column is dropped (it's already shown via the
 * Site/Location group headers instead), so `totalCols` is one less than usual —
 * every colspan calculation below accounts for that explicitly via `includeSiteCol`.
 */

interface ColSpec {
  /** Extra header column labels shown above the standard columns (row 1) */
  extraHeaders: string[];
  /** Number of extra columns (== extraHeaders.length) reserved in every row */
  extraColCount: number;
  /** Builds the extra column cells (HTML <td>) for a given data row */
  extraCellsHtml: (row: ReportRow) => string[];
}

function getColSpec(groupBy: TGroupBy): ColSpec {
  switch (groupBy) {
    case "group_brand":
      return {
        extraHeaders: ["Product Group"],
        extraColCount: 1,
        extraCellsHtml: (r) => [text(r.prod_group_name) || text(r.prod_group_code)],
      };
    case "principal_product":
      return {
        extraHeaders: ["Product Group", "Brand"],
        extraColCount: 2,
        extraCellsHtml: (r) => [text(r.prod_group_code), text(r.brand_code)],
      };
    case "product_group":
      return {
        extraHeaders: ["Brand"],
        extraColCount: 1,
        extraCellsHtml: (r) => [text(r.brand_name) || text(r.brand_code)],
      };
    case "site_location":
      return {
        extraHeaders: ["Product Group", "Brand"],
        extraColCount: 2,
        extraCellsHtml: (r) => [text(r.prod_group_name) || text(r.prod_group_code), text(r.brand_name) || text(r.brand_code)],
      };
    default:
      return { extraHeaders: [], extraColCount: 0, extraCellsHtml: () => [] };
  }
}

/** Total fixed (non-extra) columns when the Site column is shown: Job No, Site, Mfg Date,
 *  Dco Ref, Batch No, Manf Value (6 text/num cols) + 6 qty cols (P/L x in-stock/available/picked) = 12.
 *  When groupBy === "site_location" the Site column is omitted from every row, so the
 *  effective fixed column count is 11 instead — see `includeSiteCol` below. */
const FIXED_COL_COUNT = 12;

function renderHtml(rows: ReportRow[], groupBy: TGroupBy, loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const colSpec         = getColSpec(groupBy);
  const includeSiteCol  = groupBy !== "site_location";
  const effectiveFixedCols = includeSiteCol ? FIXED_COL_COUNT : FIXED_COL_COUNT - 1;
  const totalCols        = effectiveFixedCols + colSpec.extraColCount;
  // Colspan for the "label" portion of every subtotal/total row — everything
  // before the 6 trailing numeric qty columns (in-stock, available, picked x P/L).
  const labelColspan      = (includeSiteCol ? 6 : 5) + colSpec.extraColCount;

  let grandInStock = 0, grandAvail = 0, grandPicked = 0;

  // ── Render one data row (line + sub-row), accumulating grand totals
  const renderLineRow = (row: ReportRow): string => {
    const inStock = num(row.qty_in_stock);
    const avail   = num(row.qty_available);
    const picked  = num(row.qty_picked);
    grandInStock += inStock;
    grandAvail   += avail;
    grandPicked  += picked;

    const extraCells = colSpec.extraCellsHtml(row).map((v) => `<td>${escapeHtml(v)}</td>`).join("");
    const siteCell = includeSiteCol ? `<td>${escapeHtml(row.site_code)}</td>` : "";
    // The Receipt-Date cell on the sub-row merges across the extra columns + Job No,
    // since those have no per-line sub-value of their own.
    const receiptColspan = colSpec.extraColCount + 1;

    return `
      <tr class="data-row">
        ${extraCells}
        <td>${escapeHtml(row.job_no)}</td>
        ${siteCell}
        <td>${escapeHtml(row.mfg_date ? dateText(row.mfg_date) : "")}</td>
        <td>${escapeHtml(row.dco_ref)}</td>
        <td>${escapeHtml(row.batch_no)}</td>
        <td class="num">${escapeHtml(text(row.manf_value))}</td>
        <td class="num">${fmtNumber(inStock)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(avail)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(picked)}</td>
        <td class="num">0</td>
      </tr>
      <tr class="sub-row">
        <td colspan="${receiptColspan}">${escapeHtml(dateText(row.receipt_dt))}</td>
        ${includeSiteCol ? `<td>${escapeHtml(row.location_code)}</td>` : ""}
        <td>${escapeHtml(row.exp_date ? dateText(row.exp_date) : "")}</td>
        <td>${escapeHtml(row.lot_no)}</td>
        <td>${escapeHtml(row.freeze === "Y" ? "Yes" : "No")}</td>
        <td>${escapeHtml(row.container)}</td>
        <td colspan="6"></td>
      </tr>`;
  };

  // ── Render a product block (header + lines + Product Total)
  const renderProductBlock = (prodRows: ReportRow[]): string => {
    if (!prodRows.length) return "";
    const first = prodRows[0];
    const uppp  = num(first.uppp) || 1;
    const pTotal = sumQtyInStock(prodRows);

    const lines = prodRows.map(renderLineRow).join("");

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
        <td colspan="${labelColspan}">UPPP : ${uppp} &nbsp;&nbsp; Product Total :</td>
        <td class="num">${fmtNumber(pTotal)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(pTotal)}</td>
        <td class="num">0</td>
        <td class="num">0</td>
        <td class="num">0</td>
      </tr>`;
  };

  const byProductCode = (group: ReportRow[]): ReportRow[][] => {
    const m = groupRowsBy(group, (r) => text(r.prod_code));
    return Array.from(m.values());
  };

  // ── Group rows by principal first (always)
  const byPrin = groupRowsBy(rows, (r) => text(r.prin_code));

  let bodyHtml = "";
  let extraHeaderRow2Cells = "";

  if (colSpec.extraColCount > 0) {
    extraHeaderRow2Cells = Array(colSpec.extraColCount).fill("<th></th>").join("");
  }

  byPrin.forEach((prinRows, prinCode) => {
    const prinName  = text(prinRows[0]?.prin_name);
    const prinTotal = sumQtyInStock(prinRows);

    bodyHtml += `
      <tr class="principal-header">
        <td colspan="${totalCols}">Principal : ${escapeHtml(prinCode)} | ${escapeHtml(prinName)}</td>
      </tr>`;

    if (groupBy === "group_brand") {
      // Principal -> Brand -> Product
      const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
      byBrand.forEach((brandRows, brandCode) => {
        const brandName  = text(brandRows[0]?.brand_name);
        const brandTotal = sumQtyInStock(brandRows);

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
            <td class="num">${fmtNumber(brandTotal)}</td>
            <td class="num">0</td>
            <td class="num">${fmtNumber(brandTotal)}</td>
            <td class="num">0</td>
            <td class="num">0</td>
            <td class="num">0</td>
          </tr>`;
      });

    } else if (groupBy === "principal_product") {
      // Principal -> Product (flat)
      byProductCode(prinRows).forEach((prodRows) => {
        bodyHtml += renderProductBlock(prodRows);
      });

    } else if (groupBy === "product_group") {
      // Principal -> Product Group -> Product
      const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
      byGroup.forEach((grpRows, grpCode) => {
        const grpName  = text(grpRows[0]?.prod_group_name);
        const grpTotal = sumQtyInStock(grpRows);

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
            <td class="num">${fmtNumber(grpTotal)}</td>
            <td class="num">0</td>
            <td class="num">${fmtNumber(grpTotal)}</td>
            <td class="num">0</td>
            <td class="num">0</td>
            <td class="num">0</td>
          </tr>`;
      });

    } else if (groupBy === "site_location") {
      // Principal -> Site -> Location -> Product
      const bySite = groupRowsBy(prinRows, (r) => text(r.site_code));
      bySite.forEach((siteRows, siteCode) => {
        const siteTotal = sumQtyInStock(siteRows);

        bodyHtml += `
          <tr class="site-header">
            <td colspan="${totalCols}">Site : ${escapeHtml(siteCode)}</td>
          </tr>`;

        const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
        byLoc.forEach((locRows, locationCode) => {
          const locTotal = sumQtyInStock(locRows);

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
              <td class="num">${fmtNumber(locTotal)}</td>
              <td class="num">0</td>
              <td class="num">${fmtNumber(locTotal)}</td>
              <td class="num">0</td>
              <td class="num">0</td>
              <td class="num">0</td>
            </tr>`;
        });

        bodyHtml += `
          <tr class="site-total-row">
            <td colspan="${labelColspan}">Site Total :</td>
            <td class="num">${fmtNumber(siteTotal)}</td>
            <td class="num">0</td>
            <td class="num">${fmtNumber(siteTotal)}</td>
            <td class="num">0</td>
            <td class="num">0</td>
            <td class="num">0</td>
          </tr>`;
      });

    } else {
      // No grouping — just products under principal
      byProductCode(prinRows).forEach((prodRows) => {
        bodyHtml += renderProductBlock(prodRows);
      });
    }

    bodyHtml += `
      <tr class="principal-total-row">
        <td colspan="${labelColspan}">Principal Total :</td>
        <td class="num">${fmtNumber(prinTotal)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(prinTotal)}</td>
        <td class="num">0</td>
        <td class="num">0</td>
        <td class="num">0</td>
      </tr>`;
  });

  const grandTotalLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";

  // Header row labels: site_location omits the Site column (it's a group header instead)
  const siteHeaderCell = includeSiteCol ? "<th>Site</th>" : "";
  const siteSubHeaderCell = includeSiteCol ? "<th>Location</th>" : "";

  const extraHeaderCells = colSpec.extraHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Stock Detail Report</title>
  <style>
    @media print {
      @page { size: A4 landscape; margin: 8mm; }
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
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.principal-header td {
      background: #1d4ed8;
      color: #fff;
      font-weight: 700;
      border: 1px solid #1d4ed8;
      padding: 3px 5px;
    }
    tr.group-header td, tr.site-header td, tr.location-header td {
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
    tr.sub-row td {
      background: #fafafa;
      color: #555;
      font-size: 7px;
      border-top: none;
      padding-left: 8px;
    }
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
      .title-stripe {
        text-align: center;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 3px;
        margin-bottom: 5px;
        color: #fafcfeff;
        background: #1d4ed8;
      }
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
  <div class="report-title">S t o c k &nbsp; D e t a i l &nbsp; R e p o r t</div>
  <div class="report-meta">
    <span>Print Date : ${printDateTime}</span>
    <span>Print User : ${escapeHtml(loginId)}</span>
  </div>
  <table>
    <thead>
      <tr>
        ${extraHeaderCells}
        <th>Job No.</th>
        ${siteHeaderCell}
        <th>Mfg. Date</th>
        <th>Dco. Ref</th>
        <th>Batch No</th>
        <th>Manf. Value</th>
        <th colspan="2">Quantity in Stock</th>
        <th colspan="2">Quantity Available</th>
        <th colspan="2">Quantity Picked</th>
      </tr>
      <tr>
        ${extraHeaderRow2Cells}
        <th>Receipt DT</th>
        ${siteSubHeaderCell}
        <th>Exp. Date</th>
        <th>LoT No.</th>
        <th>Freeze</th>
        <th>Container</th>
        <th>PQty</th>
        <th>LQty</th>
        <th>PQty</th>
        <th>LQty</th>
        <th>PQty</th>
        <th>LQty</th>
      </tr>
    </thead>
    <tbody>
      ${bodyHtml || `<tr><td colspan="${totalCols}" style="text-align:center;color:#666;padding:20px">No data found</td></tr>`}
    </tbody>
    <tfoot>
      <tr class="grand-total-row">
        <td colspan="${labelColspan}">${grandTotalLabel}</td>
        <td class="num">${fmtNumber(grandInStock)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(grandAvail)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(grandPicked)}</td>
        <td class="num">0</td>
      </tr>
    </tfoot>
  </table>
  <div class="report-footer">
    <span>Report: rpt_stock_detail</span>
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

  const BLUE   = "FF1D4ED8";
  const WHITE  = "FFFFFFFF";
  const LBLUE  = "FFDBEAFE";
  const LBLUE2 = "FFEFF6FF";
  const YELLOW = "FFFFFDE7";
  const SITEBLUE = "FFBFDBFE";

  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });

  const styles = {
    title: {
      font: { bold: true, sz: 14, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font: { bold: true, sz: 9, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top: borderThin(BLUE), bottom: borderThin(BLUE),
        left: borderThin(BLUE), right: borderThin(BLUE),
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
      font: { sz: 9 },
      alignment: { vertical: "top" },
      border: { bottom: borderThin("FFE2E8F0") },
    },
    dataNum: {
      font: { sz: 9 },
      alignment: { horizontal: "right", vertical: "top" },
      numFmt: "#,##0",
      border: { bottom: borderThin("FFE2E8F0") },
    },
    subRow: {
      font: { sz: 8, color: { rgb: "FF555555" } },
      fill: { fgColor: { rgb: "FFFAFAFA" } },
    },
    subtotal: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: YELLOW } },
      border: { top: borderThin("FF999999") },
    },
    subtotalNum: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: YELLOW } },
      alignment: { horizontal: "right" },
      numFmt: "#,##0",
      border: { top: borderThin("FF999999") },
    },
    groupTotal: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: "FFDBEAFE" } },
      border: { top: borderThin("FF2563EB") },
    },
    groupTotalNum: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: "FFDBEAFE" } },
      alignment: { horizontal: "right" },
      numFmt: "#,##0",
      border: { top: borderThin("FF2563EB") },
    },
    siteTotal: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: SITEBLUE } },
      border: { top: borderThin("FF1D4ED8") },
    },
    siteTotalNum: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: SITEBLUE } },
      alignment: { horizontal: "right" },
      numFmt: "#,##0",
      border: { top: borderThin("FF1D4ED8") },
    },
    grandTotal: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "right" },
      numFmt: "#,##0",
    },
    grandTotalLabel: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: BLUE } },
    },
  };

  // Column layout mirrors the HTML renderer
  const colSpec = getColSpec(groupBy);
  const includeSiteCol = groupBy !== "site_location";
  const COL_COUNT = FIXED_COL_COUNT + colSpec.extraColCount;
  const extraColOffset = colSpec.extraColCount;

  const sheetData: any[][] = [];
  const merges: XLSX.Range[] = [];
  const rowStyles: Array<Record<number, any>> = [];

  const addRow = (cells: any[], styleMap: Record<number, any>) => {
    sheetData.push(cells);
    rowStyles.push(styleMap);
  };

  // Title
  addRow(["S t o c k   D e t a i l   R e p o r t", ...Array(COL_COUNT - 1).fill("")],
    Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.title])));
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  addRow([`Print Date: ${printDateTime}`, "", `Print User: ${loginId}`, ...Array(COL_COUNT - 3).fill("")],
    { 0: styles.meta, 2: styles.meta });
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: COL_COUNT - 1 } });

  addRow(Array(COL_COUNT).fill(""), {});

  const headers1 = [
    ...colSpec.extraHeaders,
    "Job No.", ...(includeSiteCol ? ["Site"] : []), "Mfg. Date", "Dco. Ref", "Batch No", "Manf. Value",
    "Qty in Stock", "", "Qty Available", "", "Qty Picked", "",
  ];
  const headers2 = [
    ...colSpec.extraHeaders.map(() => ""),
    "Receipt DT", ...(includeSiteCol ? ["Location"] : []), "Exp. Date", "LoT No.", "Freeze", "Container",
    "PQty", "LQty", "PQty", "LQty", "PQty", "LQty",
  ];

  const hRow = sheetData.length;
  addRow(headers1, Object.fromEntries(headers1.map((_, i) => [i, styles.header])));
  addRow(headers2, Object.fromEntries(headers2.map((_, i) => [i, styles.header])));

  const qtyBase = (includeSiteCol ? 7 : 6) + extraColOffset;
  merges.push({ s: { r: hRow, c: qtyBase },     e: { r: hRow, c: qtyBase + 1 } });
  merges.push({ s: { r: hRow, c: qtyBase + 2 }, e: { r: hRow, c: qtyBase + 3 } });
  merges.push({ s: { r: hRow, c: qtyBase + 4 }, e: { r: hRow, c: qtyBase + 5 } });

  let grandTotal = 0;

  const renderProductXl = (prodRows: ReportRow[]) => {
    if (!prodRows.length) return 0;
    const first = prodRows[0];
    let prodTotal = 0;

    const pHRow = sheetData.length;
    const prodLabel = `Product : ${first.prod_code} | ${first.prod_name}   Primary UOM: ${first.primary_uom}   Leat UOM: ${first.leat_uom}`;
    addRow([prodLabel, ...Array(COL_COUNT - 1).fill("")],
      Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.product])));
    merges.push({ s: { r: pHRow, c: 0 }, e: { r: pHRow, c: COL_COUNT - 1 } });

    prodRows.forEach((r) => {
      const inStock = num(r.qty_in_stock);
      prodTotal  += inStock;
      grandTotal += inStock;

      const extras = colSpec.extraCellsHtml(r);
      const siteVal = includeSiteCol ? [text(r.site_code)] : [];
      const rowCells = [
        ...extras, text(r.job_no), ...siteVal, r.mfg_date ? dateText(r.mfg_date) : "",
        text(r.dco_ref), text(r.batch_no), num(r.manf_value),
        inStock, 0, inStock, 0, 0, 0,
      ];
      const styleMap: Record<number, any> = {};
      const numStartIdx = extras.length + (includeSiteCol ? 6 : 5);
      rowCells.forEach((_, idx) => {
        styleMap[idx] = idx >= numStartIdx ? styles.dataNum : styles.data;
      });
      addRow(rowCells, styleMap);

      const locVal = includeSiteCol ? [text(r.location_code)] : [];
      addRow([
        ...extras.map(() => ""),
        dateText(r.receipt_dt), ...locVal,
        r.exp_date ? dateText(r.exp_date) : "",
        text(r.lot_no), r.freeze === "Y" ? "Yes" : "No",
        text(r.container), "", "", "", "", "", "", "",
      ], Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.subRow])));
    });

    const stRow = sheetData.length;
    const subtotalNumStart = extraColOffset + (includeSiteCol ? 6 : 5);
    const stRowCells = Array(COL_COUNT).fill("");
    stRowCells[extraColOffset] = `UPPP : ${num(first.uppp) || 1}   Product Total :`;
    stRowCells[subtotalNumStart]     = prodTotal;
    stRowCells[subtotalNumStart + 1] = 0;
    stRowCells[subtotalNumStart + 2] = prodTotal;
    stRowCells[subtotalNumStart + 3] = 0;
    stRowCells[subtotalNumStart + 4] = 0;
    stRowCells[subtotalNumStart + 5] = 0;
    const stStyleMap: Record<number, any> = { [extraColOffset]: styles.subtotal };
    for (let i = subtotalNumStart; i < subtotalNumStart + 6; i++) stStyleMap[i] = styles.subtotalNum;
    addRow(stRowCells, stStyleMap);
    if (subtotalNumStart > 0)
      merges.push({ s: { r: stRow, c: extraColOffset }, e: { r: stRow, c: subtotalNumStart - 1 } });

    return prodTotal;
  };

  const addTotalRow = (label: string, totalVal: number, style: any, styleNum: any, numStart: number) => {
    const tRow = sheetData.length;
    const cells = Array(COL_COUNT).fill("");
    cells[0] = label;
    cells[numStart]     = totalVal;
    cells[numStart + 1] = 0;
    cells[numStart + 2] = totalVal;
    cells[numStart + 3] = 0;
    cells[numStart + 4] = 0;
    cells[numStart + 5] = 0;
    const styleMap: Record<number, any> = {};
    for (let i = 0; i < numStart; i++) styleMap[i] = style;
    for (let i = numStart; i < numStart + 6; i++) styleMap[i] = styleNum;
    addRow(cells, styleMap);
    if (numStart > 0) merges.push({ s: { r: tRow, c: 0 }, e: { r: tRow, c: numStart - 1 } });
    return tRow;
  };

  const fixedNumStart = extraColOffset + (includeSiteCol ? 6 : 5);

  const byPrin = groupRowsBy(rows, (r) => text(r.prin_code));
  byPrin.forEach((prinRows, prinCode) => {
    const prinName = text(prinRows[0]?.prin_name);
    let prinTotal = 0;

    const prRow = sheetData.length;
    addRow([`Principal : ${prinCode} | ${prinName}`, ...Array(COL_COUNT - 1).fill("")],
      Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.principal])));
    merges.push({ s: { r: prRow, c: 0 }, e: { r: prRow, c: COL_COUNT - 1 } });

    const byProductCode = (group: ReportRow[]) => Array.from(groupRowsBy(group, (r) => text(r.prod_code)).values());

    if (groupBy === "group_brand") {
      const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
      byBrand.forEach((brandRows, brandCode) => {
        const brandName = text(brandRows[0]?.brand_name);
        const gRow = sheetData.length;
        addRow([`Brand : ${brandCode} | ${brandName}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
        merges.push({ s: { r: gRow, c: 0 }, e: { r: gRow, c: COL_COUNT - 1 } });
        let brandTotal = 0;
        byProductCode(brandRows).forEach((pr) => { brandTotal += renderProductXl(pr); });
        prinTotal += brandTotal;
        addTotalRow("Brand Total :", brandTotal, styles.groupTotal, styles.groupTotalNum, fixedNumStart);
      });
    } else if (groupBy === "principal_product") {
      byProductCode(prinRows).forEach((pr) => { prinTotal += renderProductXl(pr); });
    } else if (groupBy === "product_group") {
      const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
      byGroup.forEach((grpRows, grpCode) => {
        const grpName = text(grpRows[0]?.prod_group_name);
        const gRow = sheetData.length;
        addRow([`Product Group : ${grpCode} | ${grpName}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
        merges.push({ s: { r: gRow, c: 0 }, e: { r: gRow, c: COL_COUNT - 1 } });
        let grpTotal = 0;
        byProductCode(grpRows).forEach((pr) => { grpTotal += renderProductXl(pr); });
        prinTotal += grpTotal;
        addTotalRow("Product Group Total :", grpTotal, styles.groupTotal, styles.groupTotalNum, fixedNumStart);
      });
    } else if (groupBy === "site_location") {
      const bySite = groupRowsBy(prinRows, (r) => text(r.site_code));
      bySite.forEach((siteRows, siteCode) => {
        const sRow = sheetData.length;
        addRow([`Site : ${siteCode}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
        merges.push({ s: { r: sRow, c: 0 }, e: { r: sRow, c: COL_COUNT - 1 } });

        let siteTotal = 0;
        const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
        byLoc.forEach((locRows, locationCode) => {
          const lRow = sheetData.length;
          addRow([`Site : ${siteCode} | Location : ${locationCode}`, ...Array(COL_COUNT - 1).fill("")],
            Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.location])));
          merges.push({ s: { r: lRow, c: 0 }, e: { r: lRow, c: COL_COUNT - 1 } });

          let locTotal = 0;
          byProductCode(locRows).forEach((pr) => { locTotal += renderProductXl(pr); });
          siteTotal += locTotal;
          addTotalRow("Site & Location Total :", locTotal, styles.groupTotal, styles.groupTotalNum, fixedNumStart);
        });

        prinTotal += siteTotal;
        addTotalRow("Site Total :", siteTotal, styles.siteTotal, styles.siteTotalNum, fixedNumStart);
      });
    } else {
      byProductCode(prinRows).forEach((pr) => { prinTotal += renderProductXl(pr); });
    }

    addTotalRow("Principal Total :", prinTotal, styles.subtotal, styles.grandTotal, fixedNumStart);
    // Re-style principal total label + row with the brand-blue emphasis
    const lastIdx = sheetData.length - 1;
    for (let i = 0; i < fixedNumStart; i++) rowStyles[lastIdx][i] = styles.grandTotalLabel;
    for (let i = fixedNumStart; i < COL_COUNT; i++) rowStyles[lastIdx][i] = styles.grandTotal;
  });

  const grandLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";
  addTotalRow(grandLabel, grandTotal, styles.grandTotalLabel, styles.grandTotal, fixedNumStart);

  addRow(["", ...Array(COL_COUNT - 2).fill(""), "Powered by Bayanat Technology"],
    { [COL_COUNT - 1]: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } } });

  // Build worksheet
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!merges"] = merges;
  ws["!cols"] = Array.from({ length: COL_COUNT }, (_, i) => {
    if (i < extraColOffset) return { wch: 14 };
    return { wch: 11 };
  });
  ws["!rows"] = sheetData.map((_, i) => ({ hpt: i === 0 ? 24 : 14 }));

  // Apply styles
  sheetData.forEach((row, r) => {
    const styleMap = rowStyles[r];
    row.forEach((_: any, c: number) => {
      if (styleMap[c]) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!ws[ref]) ws[ref] = { t: "s", v: "" };
        (ws[ref] as any).s = styleMap[c];
      }
    });
  });

  // ── Style table (xl/styles.xml) ──────────────────────────────────────────
  //
  // The cell XML only ever stores a *style index* (s="N") per cell — the
  // actual fonts/fills/borders/alignment live in a separate styles.xml part
  // that every cell index points into. Without this part (or without wiring
  // s="N" onto each <c>), Excel renders every cell with the default style and
  // all colors/borders disappear — which is what was happening before:
  // `ws[ref].s` was set on the in-memory worksheet object, but the
  // hand-written sheet XML never read it and no styles.xml was ever written,
  // so none of the style objects reached the file.
  //
  // Fix: register every distinct style object encountered into
  // number/font/fill/border/cellXf tables (deduped by signature so identical
  // styles share one index), then look up each cell's index when serializing.

  interface FontDef   { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
  interface FillDef   { color?: string; }
  interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
  interface XfDef     { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

  const fonts: FontDef[]     = [{}]; // index 0 = default
  const fills: FillDef[]     = [{}, {}]; // 0/1 reserved (none/gray125) per OOXML convention
  const borders: BorderDef[] = [{}]; // index 0 = no border
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[]     = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }]; // index 0 = default

  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164; // builtin IDs run 0-163; custom formats start at 164

  const registerFont = (f: any): number => {
    const def: FontDef = {
      bold: !!f?.bold,
      italic: !!f?.italic,
      sz: f?.sz ?? 9,
      color: f?.color?.rgb,
    };
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

  // Pre-register every style object used, so each cell can resolve s="N"
  const cellStyleIndex = new Map<string, number>(); // "r,c" -> xf index
  sheetData.forEach((row, r) => {
    const styleMap = rowStyles[r];
    row.forEach((_: any, c: number) => {
      if (styleMap[c]) {
        cellStyleIndex.set(`${r},${c}`, registerXf(styleMap[c]));
      }
    });
  });

  // ── Sheet XML, now with s="N" on every styled cell ───────────────────────
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  let sheetXmlData = "";
  for (let r2 = range.s.r; r2 <= range.e.r; r2++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref       = XLSX.utils.encode_cell({ r: r2, c });
      const cell      = ws[ref] as XLSX.CellObject | undefined;
      const styleIdx  = cellStyleIndex.get(`${r2},${c}`);
      if (!cell && styleIdx === undefined) continue;
      const sAttr = styleIdx !== undefined ? ` s="${styleIdx}"` : "";
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c r="${ref}"${sAttr}><v>${value}</v></c>`);
      } else if (value !== undefined && value !== null && value !== "") {
        cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`);
      } else if (styleIdx !== undefined) {
        // Empty cell that still needs its background/border to render
        cells.push(`<c r="${ref}"${sAttr}/>`);
      }
    }
    if (cells.length) sheetXmlData += `<row r="${r2 + 1}">${cells.join("")}</row>`;
  }

  const mergesXml  = merges.map(m => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`).join("");
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

  // ── styles.xml ────────────────────────────────────────────────────────────
  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts.map(n => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`).join("")}</numFmts>`
    : "";

  const fontsXml = `<fonts count="${fonts.length}">${fonts.map((f) => `
    <font>
      ${f.sz ? `<sz val="${f.sz}"/>` : "<sz val=\"9\"/>"}
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

  const borderEdge = (rgb?: string) => rgb ? `<color rgb="${rgb}"/>` : "";
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
  <sheets><sheet name="Stock Detail" sheetId="1" r:id="rId1"/></sheets>
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
  zip.addFile("[Content_Types].xml",          Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                   Buffer.from(rels));
  zip.addFile("xl/workbook.xml",               Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels",    Buffer.from(workbookRels));
  zip.addFile("xl/styles.xml",                 Buffer.from(stylesXml));
  zip.addFile("xl/worksheets/sheet1.xml",      Buffer.from(sheetXml));
  return zip.toBuffer();
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getStockDetailReportHtml = async (
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
    console.error("Stock Detail Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportStockDetailReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params   = parseParams(req);
    const rows     = await loadStockData(req);
    const buffer   = buildExcelBuffer(rows, params.groupBy, req.user?.loginid ?? "");
    const filename = `stock_detail_report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Stock Detail Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};