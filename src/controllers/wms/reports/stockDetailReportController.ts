import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  reportAppliedFilters,
  buildReportDocument,
} from "../../common/report_common";

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
    qty_in_stock:    row.qty_stock     ?? row.qty_in_stock,
    qty_available:   row.qty_avl       ?? row.qty_available,
    qty_picked:      row.qty_picked,
    prod_group_code: row.group_code    ?? row.prod_group_code,
    prod_group_name: row.group_name    ?? row.prod_group_name,
    dco_ref:         row.doc_ref       ?? row.dco_ref,
    manf_value:      row.unit_price    ?? row.manf_value,
    receipt_dt:      row.txn_date      ?? row.receipt_dt,
    container:       row.container_no  ?? row.container,
    primary_uom:     row.p_uom         ?? row.primary_uom,
    leat_uom:        row.l_uom         ?? row.leat_uom,
    freeze:          row.freeze_flag   ?? row.freeze,
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

// ─── Request Param Parser ─────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  const toArr = (val: any): string[] => {
    if (!val) return ["All"];
    if (Array.isArray(val)) return val.length ? val : ["All"];
    const s = text(val).trim();
    return s ? s.split(",").map((v) => v.trim()) : ["All"];
  };

  const jobNo        = toArr(req.body.job_no);
  const prodCode     = toArr(req.body.prod_code);
  const siteCode     = toArr(req.body.site_code);
  const prinCode     = toArr(req.body.prin_code);
  const locationCode = toArr(req.body.location_code);
  const locationFrom = text(req.body.location_code_from || "");
  const locationTo   = text(req.body.location_code_to   || "");
  const groupBy      = text(req.body.group_by) as TGroupBy;
  const companyCode  = req.user?.company_code || text(req.query.company_code) || "";

  return {
    jobNo,
    prodCode,
    siteCode,
    prinCode,
    locationCode,
    locationFrom,
    locationTo,
    groupBy,
    companyCode,
    loginId: text(req.user?.loginid || (req.user as any)?.username || ""),
  };
}

// ─── Data Loader ──────────────────────────────────────────────────────────────

async function loadStockData(req: RequestWithUser): Promise<ReportRow[]> {
  const params = parseParams(req);
  const conn   = await getConn(req);

  try {
    const jobBinds  = params.jobNo.map((_, i)    => `:job${i}`);
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
        ${isGroupedBySite ? "SITE_CODE, LOCATION_CODE," : ""}
        SUM(QTY_STOCK)    AS QTY_STOCK,
        SUM(QTY_AVL)      AS QTY_AVL,
        SUM(QTY_PICKED)   AS QTY_PICKED,
        SUM(UNIT_PRICE)   AS UNIT_PRICE,
        MAX(TXN_DATE)     AS TXN_DATE,
        MAX(DOC_REF)      AS DOC_REF
      FROM VW_BOWM_STK_LEDGER
      WHERE ('All' IN (${jobBinds.join(",")})  OR JOB_NO    IN (${jobBinds.join(",")}))
        AND ('All' IN (${prodBinds.join(",")}) OR PROD_CODE  IN (${prodBinds.join(",")}))
        AND ('All' IN (${siteBinds.join(",")}) OR SITE_CODE  IN (${siteBinds.join(",")}))
        AND ('All' IN (${prinBinds.join(",")}) OR PRIN_CODE  IN (${prinBinds.join(",")}))
        AND ('All' IN (${locBinds.join(",")})  OR LOCATION_CODE IN (${locBinds.join(",")}))
        AND (
          :loc_from IS NULL OR :loc_to IS NULL OR :loc_from = '' OR :loc_to = ''
          OR LOCATION_CODE BETWEEN :loc_from AND :loc_to
        )
      GROUP BY
        PRIN_CODE, PRIN_NAME,
        BRAND_CODE, BRAND_NAME,
        GROUP_CODE, GROUP_NAME,
        PROD_CODE, PROD_NAME,
        P_UOM, L_UOM, UPP
        ${isGroupedBySite ? ", SITE_CODE, LOCATION_CODE" : ""}
      ORDER BY PRIN_CODE, BRAND_CODE, PROD_CODE
        ${isGroupedBySite ? ", SITE_CODE, LOCATION_CODE" : ""}
    `;

    const binds: Record<string, any> = {};
    params.jobNo.forEach((v, i)    => { binds[`job${i}`]  = v; });
    params.prodCode.forEach((v, i)  => { binds[`prod${i}`] = v; });
    params.siteCode.forEach((v, i)  => { binds[`site${i}`] = v; });
    params.prinCode.forEach((v, i)  => { binds[`prin${i}`] = v; });
    params.locationCode.forEach((v, i) => { binds[`loc${i}`] = v; });
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

// ─── Column Spec ──────────────────────────────────────────────────────────────

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

/** Total fixed columns: Job No, Site, Mfg Date, Dco Ref, Batch No, Manf Value
 *  (6) + 6 qty cols = 12. Site dropped when groupBy === "site_location" → 11. */
const FIXED_COL_COUNT = 12;

// ─── Extra CSS ────────────────────────────────────────────────────────────────

const STOCK_DETAIL_EXTRA_CSS = `
  /* ─────────────────────────────────────────────────────────────────
     Preserve background colors on print / PDF export.
     ───────────────────────────────────────────────────────────────── */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  /* ─────────────────────────────────────────────────────────────────
     Data table — fixed layout with explicit <colgroup> widths
     (added in the renderer). This combination guarantees the table
     never overflows the A4 landscape printable area.
     ───────────────────────────────────────────────────────────────── */
  table.data-table {
    width: 100% !important;
    max-width: 100% !important;
    table-layout: fixed !important;
    border-collapse: collapse !important;
    font-size: 7px !important;
    margin-top: 2px !important;
  }

  table.data-table th,
  table.data-table td {
    padding: 1px 2px !important;
    font-size: 7px !important;
    line-height: 1.15 !important;
    white-space: normal !important;
    word-break: break-word !important;
    overflow: hidden;
    vertical-align: top;
  }

  table.data-table th {
    font-size: 6.5px !important;
    font-weight: 700 !important;
    text-align: center !important;
    background: #0b4ca1 !important;
    color: #ffffff !important;
    border: 1px solid #0b4ca1 !important;
    padding: 2px 2px !important;
  }

  table.data-table td.num {
    text-align: right !important;
    font-variant-numeric: tabular-nums;
    white-space: nowrap !important;
  }

  table.data-table td.center {
    text-align: center !important;
  }

  table.data-table th.sub-qty {
    background: #00378c !important;
  }

  /* ─────────────────────────────────────────────────────────────────
     Section / group rows
     ───────────────────────────────────────────────────────────────── */
  tr.principal-header td {
    background: #0b4ca1 !important;
    color: #ffffff !important;
    font-weight: 800 !important;
    font-size: 8px !important;
    padding: 4px 8px !important;
    border: 1px solid #0b4ca1 !important;
  }

  tr.group-header td,
  tr.site-header td,
  tr.location-header td {
    background: #f1f5f9 !important;
    color: #1e293b !important;
    font-weight: 700 !important;
    font-size: 7.5px !important;
    border-top: 2px solid #0b4ca1 !important;
    border-bottom: 1px solid #cbd5e1 !important;
    padding: 3px 8px !important;
  }

  tr.location-header td { padding-left: 16px !important; }

  tr.product-header td {
    background: #eff6ff !important;
    color: #1e293b !important;
    font-weight: 700 !important;
    font-size: 7.5px !important;
    padding: 2px 8px !important;
    border-top: 1px solid #bfdbfe !important;
  }

  tr.product-header .uom {
    font-weight: normal !important;
    font-size: 6.5px !important;
    color: #64748b !important;
  }

  /* ─────────────────────────────────────────────────────────────────
     Data rows + sub-rows
     ───────────────────────────────────────────────────────────────── */
  tr.data-row td {
    background: #ffffff !important;
    color: #1e293b !important;
    border-bottom: 1px solid #e2e8f0 !important;
  }

  tr.sub-row td {
    background: #fafafa !important;
    color: #555555 !important;
    font-size: 6.5px !important;
    border-top: none !important;
    border-bottom: 1px solid #e2e8f0 !important;
    padding-left: 4px !important;
  }

  /* ─────────────────────────────────────────────────────────────────
     Total rows
     ───────────────────────────────────────────────────────────────── */
  tr.subtotal-row td {
    background: #fffde7 !important;
    color: #1e293b !important;
    font-weight: 700 !important;
    border-top: 1px solid #999999 !important;
  }
  tr.subtotal-row td.num { text-align: right !important; }

  tr.group-total-row td {
    background: #dbeafe !important;
    color: #1e293b !important;
    font-weight: 700 !important;
    border-top: 1px solid #2563eb !important;
  }
  tr.group-total-row td.num { text-align: right !important; }

  tr.site-total-row td {
    background: #bfdbfe !important;
    color: #1e293b !important;
    font-weight: 700 !important;
    border-top: 1px solid #1d4ed8 !important;
  }
  tr.site-total-row td.num { text-align: right !important; }

  tr.principal-total-row td {
    background: #e0e7ff !important;
    color: #1e293b !important;
    font-weight: 800 !important;
    border-top: 2px solid #0b4ca1 !important;
  }
  tr.principal-total-row td.num { text-align: right !important; }

  tr.grand-total-row td {
    background: #0b4ca1 !important;
    color: #ffffff !important;
    font-weight: 800 !important;
    font-size: 8px !important;
    border-top: 2px solid #0b4ca1 !important;
  }
  tr.grand-total-row td.num { text-align: right !important; }

  td.subtotal-label {
    text-align: right !important;
    font-weight: 700 !important;
    padding-right: 8px !important;
  }

  tr td.muted {
    color: #64748b !important;
    text-align: center !important;
    padding: 20px !important;
  }

  /* ─────────────────────────────────────────────────────────────────
     PRINT-SPECIFIC tightening
     ───────────────────────────────────────────────────────────────── */
  @media print {
    html, body {
      background: #ffffff !important;
      overflow: visible !important;
      margin: 0 !important;
    }

    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }

    /* Reclaim horizontal space — the .paper wrapper from report_common
       has 8px padding by default which steals ~16px of printable width. */
    .paper {
      padding: 3px !important;
    }

    /* Shrink the fixed page-border so it doesn't overlap the table edge */
    .page-border {
      left: 0 !important;
      right: 0 !important;
      top: 0 !important;
      bottom: 0 !important;
    }

    table.data-table thead {
      display: table-header-group !important;
    }

    table.data-table tfoot {
      display: table-footer-group !important;
    }

    table.data-table tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    /* Absolute minimum font to guarantee 18 cols fit */
    table.data-table,
    table.data-table th,
    table.data-table td {
      font-size: 5.5px !important;
      line-height: 1.05 !important;
      padding: 0.5px 1px !important;
    }

    table.data-table th {
      font-size: 5px !important;
      padding: 1px 1px !important;
    }

    tr.sub-row td {
      font-size: 5px !important;
    }

    tr.principal-header td {
      font-size: 7px !important;
      padding: 3px 6px !important;
    }

    tr.product-header td {
      font-size: 6px !important;
      padding: 2px 6px !important;
    }

    tr.grand-total-row td {
      font-size: 6.5px !important;
    }
  }
`;

// ─── HTML Body Renderer ───────────────────────────────────────────────────────

function renderStockDetailBody(rows: ReportRow[], groupBy: TGroupBy, filtersHtml = ""): string {
  const colSpec        = getColSpec(groupBy);
  const includeSiteCol = groupBy !== "site_location";
  const effectiveFixedCols = includeSiteCol ? FIXED_COL_COUNT : FIXED_COL_COUNT - 1;
  const totalLeafs     = effectiveFixedCols + colSpec.extraColCount;
  const labelColspan   = (includeSiteCol ? 6 : 5) + colSpec.extraColCount;

  // ── Build the <colgroup> with explicit widths that sum to exactly 100%.
  //    This is what makes `table-layout: fixed` actually constrain columns
  //    to the printable width instead of letting content push them wider.
  const buildColgroup = (): string => {
    const weights: number[] = [];
    // Extra cols (Product Group / Brand)
    for (let i = 0; i < colSpec.extraColCount; i++) weights.push(6);
    weights.push(7);                            // Job No.
    if (includeSiteCol) weights.push(5);        // Site
    weights.push(7);                            // Mfg. Date
    weights.push(7);                            // Dco. Ref
    weights.push(7);                            // Batch No
    weights.push(7);                            // Manf. Value
    weights.push(6);                            // Qty in Stock PQty
    weights.push(5);                            // Qty in Stock LQty
    weights.push(6);                            // Qty Available PQty
    weights.push(5);                            // Qty Available LQty
    weights.push(6);                            // Qty Picked PQty
    weights.push(5);                            // Qty Picked LQty

    const total = weights.reduce((s, w) => s + w, 0);
    return weights
      .map((w) => `<col style="width:${((w / total) * 100).toFixed(3)}%" />`)
      .join("");
  };

  let grandInStock = 0, grandAvail = 0, grandPicked = 0;

  // ── Data row (line + sub-row)
  const renderLineRow = (row: ReportRow): string => {
    const inStock = num(row.qty_in_stock);
    const avail   = num(row.qty_available);
    const picked  = num(row.qty_picked);
    grandInStock += inStock;
    grandAvail   += avail;
    grandPicked  += picked;

    const extraCells = colSpec.extraCellsHtml(row).map((v) => `<td>${escapeHtml(v)}</td>`).join("");
    const siteCell   = includeSiteCol ? `<td class="center">${escapeHtml(row.site_code)}</td>` : "";
    const receiptColspan = colSpec.extraColCount + 1;

    return `
      <tr class="data-row">
        ${extraCells}
        <td>${escapeHtml(row.job_no)}</td>
        ${siteCell}
        <td class="center">${escapeHtml(row.mfg_date ? dateText(row.mfg_date) : "")}</td>
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
        ${includeSiteCol ? `<td class="center">${escapeHtml(row.location_code)}</td>` : ""}
        <td class="center">${escapeHtml(row.exp_date ? dateText(row.exp_date) : "")}</td>
        <td>${escapeHtml(row.lot_no)}</td>
        <td class="center">${escapeHtml(row.freeze === "Y" ? "Yes" : "No")}</td>
        <td>${escapeHtml(row.container)}</td>
        <td colspan="6"></td>
      </tr>`;
  };

  // ── Product block (header + lines + Product Total)
  const renderProductBlock = (prodRows: ReportRow[]): string => {
    if (!prodRows.length) return "";
    const first  = prodRows[0];
    const uppp   = num(first.uppp) || 1;
    const pTotal = sumQtyInStock(prodRows);
    const lines  = prodRows.map(renderLineRow).join("");

    return `
      <tr class="product-header">
        <td colspan="${totalLeafs}">
          Product : ${escapeHtml(first.prod_code)} | ${escapeHtml(first.prod_name)}
          &nbsp;&nbsp;&nbsp;
          <span class="uom">Primary Unit of Measurement : ${escapeHtml(first.primary_uom)}</span>
          &nbsp;&nbsp;&nbsp;
          <span class="uom">Leat Unit of Measurement : ${escapeHtml(first.leat_uom)}</span>
        </td>
      </tr>
      ${lines}
      <tr class="subtotal-row">
        <td class="subtotal-label" colspan="${labelColspan}">UPPP : ${uppp} &nbsp;&nbsp; Product Total :</td>
        <td class="num">${fmtNumber(pTotal)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(pTotal)}</td>
        <td class="num">0</td>
        <td class="num">0</td>
        <td class="num">0</td>
      </tr>`;
  };

  const byProductCode = (group: ReportRow[]): ReportRow[][] =>
    Array.from(groupRowsBy(group, (r) => text(r.prod_code)).values());

  const byPrin = groupRowsBy(rows, (r) => text(r.prin_code));

  let bodyHtml = "";

  byPrin.forEach((prinRows, prinCode) => {
    const prinName  = text(prinRows[0]?.prin_name);
    const prinTotal = sumQtyInStock(prinRows);

    bodyHtml += `
      <tr class="principal-header">
        <td colspan="${totalLeafs}">Principal : ${escapeHtml(prinCode)} | ${escapeHtml(prinName)}</td>
      </tr>`;

    if (groupBy === "group_brand") {
      const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
      byBrand.forEach((brandRows, brandCode) => {
        const brandName  = text(brandRows[0]?.brand_name);
        const brandTotal = sumQtyInStock(brandRows);

        bodyHtml += `
          <tr class="group-header">
            <td colspan="${totalLeafs}">Brand : ${escapeHtml(brandCode)} | ${escapeHtml(brandName)}</td>
          </tr>`;

        byProductCode(brandRows).forEach((prodRows) => { bodyHtml += renderProductBlock(prodRows); });

        bodyHtml += `
          <tr class="group-total-row">
            <td class="subtotal-label" colspan="${labelColspan}">Brand Total :</td>
            <td class="num">${fmtNumber(brandTotal)}</td>
            <td class="num">0</td>
            <td class="num">${fmtNumber(brandTotal)}</td>
            <td class="num">0</td>
            <td class="num">0</td>
            <td class="num">0</td>
          </tr>`;
      });

    } else if (groupBy === "principal_product") {
      byProductCode(prinRows).forEach((prodRows) => { bodyHtml += renderProductBlock(prodRows); });

    } else if (groupBy === "product_group") {
      const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
      byGroup.forEach((grpRows, grpCode) => {
        const grpName  = text(grpRows[0]?.prod_group_name);
        const grpTotal = sumQtyInStock(grpRows);

        bodyHtml += `
          <tr class="group-header">
            <td colspan="${totalLeafs}">Product Group : ${escapeHtml(grpCode)} | ${escapeHtml(grpName)}</td>
          </tr>`;

        byProductCode(grpRows).forEach((prodRows) => { bodyHtml += renderProductBlock(prodRows); });

        bodyHtml += `
          <tr class="group-total-row">
            <td class="subtotal-label" colspan="${labelColspan}">Product Group Total :</td>
            <td class="num">${fmtNumber(grpTotal)}</td>
            <td class="num">0</td>
            <td class="num">${fmtNumber(grpTotal)}</td>
            <td class="num">0</td>
            <td class="num">0</td>
            <td class="num">0</td>
          </tr>`;
      });

    } else if (groupBy === "site_location") {
      const bySite = groupRowsBy(prinRows, (r) => text(r.site_code));
      bySite.forEach((siteRows, siteCode) => {
        const siteTotal = sumQtyInStock(siteRows);

        bodyHtml += `
          <tr class="site-header">
            <td colspan="${totalLeafs}">Site : ${escapeHtml(siteCode)}</td>
          </tr>`;

        const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
        byLoc.forEach((locRows, locationCode) => {
          const locTotal = sumQtyInStock(locRows);

          bodyHtml += `
            <tr class="location-header">
              <td colspan="${totalLeafs}">Site : ${escapeHtml(siteCode)} | Location : ${escapeHtml(locationCode)}</td>
            </tr>`;

          byProductCode(locRows).forEach((prodRows) => { bodyHtml += renderProductBlock(prodRows); });

          bodyHtml += `
            <tr class="group-total-row">
              <td class="subtotal-label" colspan="${labelColspan}">Site &amp; Location Total :</td>
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
            <td class="subtotal-label" colspan="${labelColspan}">Site Total :</td>
            <td class="num">${fmtNumber(siteTotal)}</td>
            <td class="num">0</td>
            <td class="num">${fmtNumber(siteTotal)}</td>
            <td class="num">0</td>
            <td class="num">0</td>
            <td class="num">0</td>
          </tr>`;
      });

    } else {
      byProductCode(prinRows).forEach((prodRows) => { bodyHtml += renderProductBlock(prodRows); });
    }

    bodyHtml += `
      <tr class="principal-total-row">
        <td class="subtotal-label" colspan="${labelColspan}">Principal Total :</td>
        <td class="num">${fmtNumber(prinTotal)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(prinTotal)}</td>
        <td class="num">0</td>
        <td class="num">0</td>
        <td class="num">0</td>
      </tr>`;
  });

  const grandTotalLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";
  const siteHeaderCell1 = includeSiteCol ? `<th>Site</th>` : "";
  const siteSubHeaderCell1 = includeSiteCol ? `<th>Location</th>` : "";

  // Header row 1 and row 2 must each add up to the same number of leaf
  // columns as the data rows (totalLeafs). No rowspan on the fixed headers —
  // row 2 carries the sub-labels (Receipt DT, Location, ...) so both rows
  // have exactly 12 (+extra) cells and nothing overflows into phantom columns.
  const extraHeaderCells1 = colSpec.extraHeaders
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");
  const receiptHeaderColspan = colSpec.extraColCount + 1;

  return `
    <div class="doc-title-row">
      <div><h1>Stock Detail Report</h1></div>
    </div>

    ${filtersHtml}

    <table class="data-table">
      <colgroup>${buildColgroup()}</colgroup>
      <thead>
        <tr>
          ${extraHeaderCells1}
          <th>Job No.</th>
          ${siteHeaderCell1}
          <th>Mfg. Date</th>
          <th>Dco. Ref</th>
          <th>Batch No</th>
          <th>Manf. Value</th>
          <th colspan="2">Quantity in Stock</th>
          <th colspan="2">Quantity Available</th>
          <th colspan="2">Quantity Picked</th>
        </tr>
        <tr>
          <th colspan="${receiptHeaderColspan}">Receipt DT</th>
          ${siteSubHeaderCell1}
          <th>Exp. Date</th>
          <th>LoT No.</th>
          <th>Freeze</th>
          <th>Container</th>
          <th class="sub-qty">PQty</th>
          <th class="sub-qty">LQty</th>
          <th class="sub-qty">PQty</th>
          <th class="sub-qty">LQty</th>
          <th class="sub-qty">PQty</th>
          <th class="sub-qty">LQty</th>
        </tr>
      </thead>
      <tbody>
        ${bodyHtml || `<tr><td colspan="${totalLeafs}" class="center muted">No data found</td></tr>`}
      </tbody>
      <tfoot>
        <tr class="grand-total-row">
          <td class="subtotal-label" colspan="${labelColspan}">${grandTotalLabel}</td>
          <td class="num">${fmtNumber(grandInStock)}</td>
          <td class="num">0</td>
          <td class="num">${fmtNumber(grandAvail)}</td>
          <td class="num">0</td>
          <td class="num">${fmtNumber(grandPicked)}</td>
          <td class="num">0</td>
        </tr>
      </tfoot>
    </table>
  `;
}

// ─── Excel Builder (full OOXML style engine) ──────────────────────────────────

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
    subRow: {
      font: { sz: 8, color: { rgb: "FF555555" } },
      fill: { fgColor: { rgb: "FFFAFAFA" } },
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
  const COL_COUNT      = FIXED_COL_COUNT + colSpec.extraColCount;
  const extraColOffset = colSpec.extraColCount;

  const sheetData: any[][]                    = [];
  const merges: XLSX.Range[]                  = [];
  const rowStyles: Array<Record<number, any>> = [];

  const addRow = (cells: any[], styleMap: Record<number, any>) => {
    sheetData.push(cells);
    rowStyles.push(styleMap);
  };

  addRow(
    ["S t o c k   D e t a i l   R e p o r t", ...Array(COL_COUNT - 1).fill("")],
    Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.title])),
  );
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  addRow(
    [`Print Date: ${printDateTime}`, "", `Print User: ${loginId}`, ...Array(COL_COUNT - 3).fill("")],
    { 0: styles.meta, 2: styles.meta },
  );
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
    addRow(
      [`Product : ${first.prod_code} | ${first.prod_name}   Primary UOM: ${first.primary_uom}   Leat UOM: ${first.leat_uom}`,
        ...Array(COL_COUNT - 1).fill("")],
      Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.product])),
    );
    merges.push({ s: { r: pHRow, c: 0 }, e: { r: pHRow, c: COL_COUNT - 1 } });

    prodRows.forEach((r) => {
      const inStock = num(r.qty_in_stock);
      prodTotal  += inStock;
      grandTotal += inStock;

      const extras  = colSpec.extraCellsHtml(r);
      const siteVal = includeSiteCol ? [text(r.site_code)] : [];
      const rowCells = [
        ...extras, text(r.job_no), ...siteVal,
        r.mfg_date ? dateText(r.mfg_date) : "",
        text(r.dco_ref), text(r.batch_no), num(r.manf_value),
        inStock, 0, inStock, 0, 0, 0,
      ];
      const numStartIdx = extras.length + (includeSiteCol ? 6 : 5);
      const styleMap: Record<number, any> = {};
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
        text(r.container), "", "", "", "", "", "",
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
    const tRow  = sheetData.length;
    const cells = Array(COL_COUNT).fill("");
    cells[0]            = label;
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
    addRow(
      [`Principal : ${prinCode} | ${prinName}`, ...Array(COL_COUNT - 1).fill("")],
      Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.principal])),
    );
    merges.push({ s: { r: prRow, c: 0 }, e: { r: prRow, c: COL_COUNT - 1 } });

    const byProductCode = (group: ReportRow[]) =>
      Array.from(groupRowsBy(group, (r) => text(r.prod_code)).values());

    if (groupBy === "group_brand") {
      const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
      byBrand.forEach((brandRows, brandCode) => {
        const brandName = text(brandRows[0]?.brand_name);
        const gRow = sheetData.length;
        addRow(
          [`Brand : ${brandCode} | ${brandName}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])),
        );
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
        addRow(
          [`Product Group : ${grpCode} | ${grpName}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])),
        );
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
        addRow(
          [`Site : ${siteCode}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])),
        );
        merges.push({ s: { r: sRow, c: 0 }, e: { r: sRow, c: COL_COUNT - 1 } });

        let siteTotal = 0;
        const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
        byLoc.forEach((locRows, locationCode) => {
          const lRow = sheetData.length;
          addRow(
            [`Site : ${siteCode} | Location : ${locationCode}`, ...Array(COL_COUNT - 1).fill("")],
            Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.location])),
          );
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
    const lastIdx = sheetData.length - 1;
    for (let i = 0; i < fixedNumStart; i++) rowStyles[lastIdx][i] = styles.grandTotalLabel;
    for (let i = fixedNumStart; i < COL_COUNT; i++) rowStyles[lastIdx][i] = styles.grandTotal;
  });

  const grandLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";
  addTotalRow(grandLabel, grandTotal, styles.grandTotalLabel, styles.grandTotal, fixedNumStart);

  addRow(
    ["", ...Array(COL_COUNT - 2).fill(""), "Powered by Bayanat Technology"],
    { [COL_COUNT - 1]: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } } },
  );

  const ws      = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!merges"] = merges;
  ws["!cols"]   = Array.from({ length: COL_COUNT }, (_, i) =>
    i < extraColOffset ? { wch: 14 } : { wch: 11 });
  ws["!rows"]   = sheetData.map((_, i) => ({ hpt: i === 0 ? 24 : 14 }));

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
  <sheets><sheet name="Stock Detail" sheetId="1" r:id="rId1"/></sheets>
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

const GROUP_BY_LABELS: Record<string, string> = {
  group_brand:       "Product Group → Brand",
  principal_product: "Principal → Product",
  product_group:     "Product Group",
  site_location:     "Site / Location",
};

export const getStockDetailReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows   = await loadStockData(req);

    const headerHtml  = await reportHeader({ company_code: params.companyCode, req });
    const filtersHtml = reportAppliedFilters([
      { label: "Principal", value: params.prinCode },
      { label: "Product",   value: params.prodCode },
      { label: "Site",      value: params.siteCode },
      { label: "Location",  value: params.locationCode },
      { label: "Job No",    value: params.jobNo },
      { label: "Group By",  value: GROUP_BY_LABELS[params.groupBy] || "No grouping" },
    ]);
    const bodyHtml    = renderStockDetailBody(rows, params.groupBy, filtersHtml);
    const footerHtml  = reportFooter({
      reportName: "rpt_stock_detail",
      userName: params.loginId,
      endLabel: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: "Stock Detail Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: STOCK_DETAIL_EXTRA_CSS,
      orientation: "landscape",
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
    });

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
    const buffer   = buildExcelBuffer(rows, params.groupBy, params.loginId);
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