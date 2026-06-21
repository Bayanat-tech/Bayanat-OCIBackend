// import { Response } from "express";
// import oracledb from "oracledb";
// import * as XLSX from "xlsx";
// import { RequestWithUser } from "../../../interfaces/common.interface";
// import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
// import TenantManager from "../../../database/TenantManager";
// const AdmZip = require("adm-zip");


// // ─── Types ────────────────────────────────────────────────────────────────────

// type TGroupBy = "group_brand" | "principal_product" | "product_group" | "site_location" | "";

// type ReportRow = Record<string, any>;

// // ─── DB Helpers ───────────────────────────────────────────────────────────────

// async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
//   let tenantId = getCurrentTenantId();
//   if (!tenantId && req.user?.loginid)
//     tenantId = await TenantManager.getTenantForUser(req.user.loginid);
//   if (!tenantId)
//     throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
//   return TenantManager.getConnection(tenantId);
// }

// async function closeConn(conn?: oracledb.Connection) {
//   if (conn)
//     try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
// }

// function normalize(rows: any[] = []): ReportRow[] {
//   return rows.map((row) =>
//     Object.keys(row).reduce((acc: ReportRow, key) => {
//       acc[key.toLowerCase()] = row[key];
//       return acc;
//     }, {}),
//   );
// }

// // ─── Formatters ───────────────────────────────────────────────────────────────

// function text(value: unknown): string {
//   if (value == null) return "";
//   return String(value);
// }

// function num(value: unknown): number {
//   const n = Number(value);
//   return Number.isFinite(n) ? n : 0;
// }

// function fmtNumber(n: number): string {
//   const abs = Math.abs(n);
//   const formatted = abs.toLocaleString("en-US", {
//     minimumFractionDigits: 0,
//     maximumFractionDigits: 0,
//   });
//   return n < 0 ? `(${formatted})` : formatted;
// }

// function dateText(value: unknown): string {
//   if (!value) return "";
//   const date = new Date(String(value));
//   if (Number.isNaN(date.getTime())) return String(value).substring(0, 10);
//   return date.toLocaleDateString("en-GB", {
//     day: "2-digit", month: "short", year: "numeric",
//   }).replace(/ /g, "-");
// }

// function escapeHtml(value: unknown): string {
//   return text(value)
//     .replace(/&/g, "&amp;")
//     .replace(/</g, "&lt;")
//     .replace(/>/g, "&gt;")
//     .replace(/"/g, "&quot;")
//     .replace(/'/g, "&#039;");
// }

// function escapeXml(value: unknown): string {
//   return text(value)
//     .replace(/&/g, "&amp;")
//     .replace(/</g, "&lt;")
//     .replace(/>/g, "&gt;")
//     .replace(/"/g, "&quot;")
//     .replace(/'/g, "&apos;");
// }

// // ─── Request Param Parser ────────────────────────────────────────────────────

// function parseParams(req: RequestWithUser) {
//   const toArr = (val: any): string[] => {
//     if (!val) return ["All"];
//     if (Array.isArray(val)) return val.length ? val : ["All"];
//     const s = text(val).trim();
//     return s ? s.split(",").map((v) => v.trim()) : ["All"];
//   };

//   const jobNo          = toArr(req.body.job_no);
//   const prodCode       = toArr(req.body.prod_code);
//   const siteCode       = toArr(req.body.site_code);
//   const prinCode       = toArr(req.body.prin_code);
//   const locationFrom   = text(req.body.location_code_from || "");
//   const locationTo     = text(req.body.location_code_to   || "");
//   const groupBy        = text(req.body.group_by) as TGroupBy;

//   return { jobNo, prodCode, siteCode, prinCode, locationFrom, locationTo, groupBy };
// }

// // ─── Data Loader ─────────────────────────────────────────────────────────────

// async function loadStockData(req: RequestWithUser): Promise<ReportRow[]> {
//   const params = parseParams(req);
//   const conn   = await getConn(req);

//   try {
//     // Build dynamic bind params for IN clauses
//     const jobBinds    = params.jobNo.map((_, i)    => `:job${i}`);
//     const prodBinds   = params.prodCode.map((_, i)  => `:prod${i}`);
//     const siteBinds   = params.siteCode.map((_, i)  => `:site${i}`);
//     const prinBinds   = params.prinCode.map((_, i)  => `:prin${i}`);

//     const sql = `
//       SELECT *
//       FROM VW_BOWM_STK_LEDGER
//       WHERE ('All' IN (${jobBinds.join(",")})  OR JOB_NO    IN (${jobBinds.join(",")}))
//         AND ('All' IN (${prodBinds.join(",")}) OR PROD_CODE  IN (${prodBinds.join(",")}))
//         AND ('All' IN (${siteBinds.join(",")}) OR SITE_CODE  IN (${siteBinds.join(",")}))
//         AND ('All' IN (${prinBinds.join(",")}) OR PRIN_CODE  IN (${prinBinds.join(",")}))
//         AND (
//           :loc_from IS NULL OR :loc_to IS NULL OR :loc_from = ''  OR :loc_to = ''
//           OR LOCATION_CODE BETWEEN :loc_from AND :loc_to
//         )
//       ORDER BY PRIN_CODE, BRAND_CODE, SITE_CODE, LOCATION_CODE, PROD_CODE
//     `;
//     console.log("Executing SQL with binds:", sql, params);

//     const binds: Record<string, any> = {};
//     params.jobNo.forEach((v, i)    => { binds[`job${i}`]  = v; });
//     params.prodCode.forEach((v, i)  => { binds[`prod${i}`] = v; });
//     params.siteCode.forEach((v, i)  => { binds[`site${i}`] = v; });
//     params.prinCode.forEach((v, i)  => { binds[`prin${i}`] = v; });
//     binds["loc_from"] = params.locationFrom || null;
//     binds["loc_to"]   = params.locationTo   || null;

//     const result = await conn.execute(sql, binds, {
//       outFormat: oracledb.OUT_FORMAT_OBJECT,
//     });

//     return normalize(result.rows as any[]);
//   } finally {
//     await closeConn(conn);
//   }
// }

// // ─── Grouping helpers ─────────────────────────────────────────────────────────

// function groupRowsBy(rows: ReportRow[], keyFn: (r: ReportRow) => string): Map<string, ReportRow[]> {
//   const map = new Map<string, ReportRow[]>();
//   rows.forEach((r) => {
//     const k = keyFn(r);
//     if (!map.has(k)) map.set(k, []);
//     map.get(k)!.push(r);
//   });
//   return map;
// }

// function sumQtyInStock(rows: ReportRow[]): number {
//   return rows.reduce((acc, r) => acc + num(r.qty_in_stock), 0);
// }

// // ─── HTML Renderer ────────────────────────────────────────────────────────────

// /**
//  * Column layout per group_by mode (matches the reference report PDFs exactly):
//  *
//  *  - "group_brand"        : Principal -> Brand (header) -> Product (header) -> rows
//  *                            row column: Product Group
//  *                            totals: Product Total, Brand Total, Principal Total, Grand Total
//  *
//  *  - "principal_product"  : Principal -> Product (header) -> rows  (flat, no brand/group header)
//  *                            row columns: Product Group, Brand
//  *                            totals: Product Total, Principal Total, Grand Total
//  *
//  *  - "product_group"      : Principal -> Product Group (header) -> Product (header) -> rows
//  *                            row column: Brand
//  *                            totals: Product Total, Product Group Total, Principal Total, Grand Total
//  *
//  *  - "site_location"      : Principal -> Site (header) -> Location (header) -> Product (header) -> rows
//  *                            row columns: Product Group, Brand
//  *                            totals: Product Total, Location Total, Site Total, Principal Total, Total
//  *
//  *  - "" (no grouping)     : Principal -> Product (header) -> rows
//  *                            row columns: none extra
//  *                            totals: Product Total, Principal Total, Grand Total
//  */

// interface ColSpec {
//   /** Extra header column labels shown above the standard columns (row 1) */
//   extraHeaders: string[];
//   /** Number of extra columns (== extraHeaders.length) reserved in every row */
//   extraColCount: number;
//   /** Builds the extra column cells (HTML <td>) for a given data row */
//   extraCellsHtml: (row: ReportRow) => string[];
// }

// function getColSpec(groupBy: TGroupBy): ColSpec {
//   switch (groupBy) {
//     case "group_brand":
//       return {
//         extraHeaders: ["Product Group"],
//         extraColCount: 1,
//         extraCellsHtml: (r) => [text(r.prod_group_name) || text(r.prod_group_code)],
//       };
//     case "principal_product":
//       return {
//         extraHeaders: ["Product Group", "Brand"],
//         extraColCount: 2,
//         extraCellsHtml: (r) => [text(r.prod_group_code), text(r.brand_code)],
//       };
//     case "product_group":
//       return {
//         extraHeaders: ["Brand"],
//         extraColCount: 1,
//         extraCellsHtml: (r) => [text(r.brand_name) || text(r.brand_code)],
//       };
//     case "site_location":
//       return {
//         extraHeaders: ["Product Group", "Brand"],
//         extraColCount: 2,
//         extraCellsHtml: (r) => [text(r.prod_group_name) || text(r.prod_group_code), text(r.brand_name) || text(r.brand_code)],
//       };
//     default:
//       return { extraHeaders: [], extraColCount: 0, extraCellsHtml: () => [] };
//   }
// }

// /** Total fixed (non-extra) columns: Job No, Site, Mfg Date, Dco Ref, Batch No, Manf Value,
//  *  Qty-in-stock(P/L), Qty-available(P/L), Qty-picked(P/L) = 6 text/num cols + 6 qty cols = 12 */
// const FIXED_COL_COUNT = 12;

// function renderHtml(rows: ReportRow[], groupBy: TGroupBy, loginId: string): string {
//   const printDateTime = new Date().toLocaleString("en-GB", {
//     day: "2-digit", month: "short", year: "numeric",
//     hour: "2-digit", minute: "2-digit", hour12: false,
//   });

//   const colSpec   = getColSpec(groupBy);
//   const totalCols = FIXED_COL_COUNT + colSpec.extraColCount;

//   let grandInStock = 0, grandAvail = 0, grandPicked = 0;

//   // ── Render one data row (line + sub-row), accumulating grand totals
//   const renderLineRow = (row: ReportRow): string => {
//     const inStock = num(row.qty_in_stock);
//     const avail   = num(row.qty_available);
//     const picked  = num(row.qty_picked);
//     grandInStock += inStock;
//     grandAvail   += avail;
//     grandPicked  += picked;

//     const extraCells = colSpec.extraCellsHtml(row).map((v) => `<td>${escapeHtml(v)}</td>`).join("");
//     const siteCell = groupBy === "site_location" ? "" : `<td>${escapeHtml(row.site_code)}</td>`;
//     const locColspanForSub = groupBy === "site_location" ? colSpec.extraColCount + 2 : colSpec.extraColCount + 2;

//     return `
//       <tr class="data-row">
//         ${extraCells}
//         <td>${escapeHtml(row.job_no)}</td>
//         ${siteCell}
//         <td>${escapeHtml(row.mfg_date ? dateText(row.mfg_date) : "")}</td>
//         <td>${escapeHtml(row.dco_ref)}</td>
//         <td>${escapeHtml(row.batch_no)}</td>
//         <td class="num">${escapeHtml(text(row.manf_value))}</td>
//         <td class="num">${fmtNumber(inStock)}</td>
//         <td class="num">0</td>
//         <td class="num">${fmtNumber(avail)}</td>
//         <td class="num">0</td>
//         <td class="num">${fmtNumber(picked)}</td>
//         <td class="num">0</td>
//       </tr>
//       <tr class="sub-row">
//         <td colspan="${locColspanForSub}">${escapeHtml(dateText(row.receipt_dt))}</td>
//         ${groupBy === "site_location" ? "" : `<td>${escapeHtml(row.location_code)}</td>`}
//         <td>${escapeHtml(row.exp_date ? dateText(row.exp_date) : "")}</td>
//         <td>${escapeHtml(row.lot_no)}</td>
//         <td>${escapeHtml(row.freeze === "Y" ? "Yes" : "No")}</td>
//         <td>${escapeHtml(row.container)}</td>
//         <td colspan="4"></td>
//       </tr>`;
//   };

//   // ── Render a product block (header + lines + Product Total)
//   const renderProductBlock = (prodRows: ReportRow[]): string => {
//     if (!prodRows.length) return "";
//     const first = prodRows[0];
//     const uppp  = num(first.uppp) || 1;
//     const pTotal = sumQtyInStock(prodRows);

//     const lines = prodRows.map(renderLineRow).join("");

//     return `
//       <tr class="product-header">
//         <td colspan="${totalCols}">
//           Product : ${escapeHtml(first.prod_code)} | ${escapeHtml(first.prod_name)}
//           &nbsp;&nbsp;&nbsp;
//           <span class="uom">Primary Unit of Measurement : ${escapeHtml(first.primary_uom)}</span>
//           &nbsp;&nbsp;&nbsp;
//           <span class="uom">Leat Unit of Measurement : ${escapeHtml(first.leat_uom)}</span>
//         </td>
//       </tr>
//       ${lines}
//       <tr class="subtotal-row">
//         <td colspan="6">UPPP : ${uppp} &nbsp;&nbsp; Product Total :</td>
//         <td class="num">${fmtNumber(pTotal)}</td>
//         <td class="num">0</td>
//         <td class="num">${fmtNumber(pTotal)}</td>
//         <td class="num">0</td>
//         <td class="num">0</td>
//         <td class="num">0</td>
//       </tr>`;
//   };

//   const byProductCode = (group: ReportRow[]): ReportRow[][] => {
//     const m = groupRowsBy(group, (r) => text(r.prod_code));
//     return Array.from(m.values());
//   };

//   // ── Group rows by principal first (always)
//   const byPrin = groupRowsBy(rows, (r) => text(r.prin_code));

//   let bodyHtml = "";
//   let extraHeaderRow2Cells = "";

//   if (colSpec.extraColCount > 0) {
//     extraHeaderRow2Cells = Array(colSpec.extraColCount).fill("<th></th>").join("");
//   }

//   byPrin.forEach((prinRows, prinCode) => {
//     const prinName  = text(prinRows[0]?.prin_name);
//     const prinTotal = sumQtyInStock(prinRows);

//     bodyHtml += `
//       <tr class="principal-header">
//         <td colspan="${totalCols}">Principal : ${escapeHtml(prinCode)} | ${escapeHtml(prinName)}</td>
//       </tr>`;

//     if (groupBy === "group_brand") {
//       // Principal -> Brand -> Product
//       const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
//       byBrand.forEach((brandRows, brandCode) => {
//         const brandName  = text(brandRows[0]?.brand_name);
//         const brandTotal = sumQtyInStock(brandRows);

//         bodyHtml += `
//           <tr class="group-header">
//             <td colspan="${totalCols}">Brand : ${escapeHtml(brandCode)} | ${escapeHtml(brandName)}</td>
//           </tr>`;

//         byProductCode(brandRows).forEach((prodRows) => {
//           bodyHtml += renderProductBlock(prodRows);
//         });

//         bodyHtml += `
//           <tr class="group-total-row">
//             <td colspan="6">Brand Total :</td>
//             <td class="num">${fmtNumber(brandTotal)}</td>
//             <td class="num">0</td>
//             <td class="num">${fmtNumber(brandTotal)}</td>
//             <td class="num">0</td>
//             <td class="num">0</td>
//             <td class="num">0</td>
//           </tr>`;
//       });

//     } else if (groupBy === "principal_product") {
//       // Principal -> Product (flat)
//       byProductCode(prinRows).forEach((prodRows) => {
//         bodyHtml += renderProductBlock(prodRows);
//       });

//     } else if (groupBy === "product_group") {
//       // Principal -> Product Group -> Product
//       const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
//       byGroup.forEach((grpRows, grpCode) => {
//         const grpName  = text(grpRows[0]?.prod_group_name);
//         const grpTotal = sumQtyInStock(grpRows);

//         bodyHtml += `
//           <tr class="group-header">
//             <td colspan="${totalCols}">Product Group : ${escapeHtml(grpCode)} | ${escapeHtml(grpName)}</td>
//           </tr>`;

//         byProductCode(grpRows).forEach((prodRows) => {
//           bodyHtml += renderProductBlock(prodRows);
//         });

//         bodyHtml += `
//           <tr class="group-total-row">
//             <td colspan="6">Product Group Total :</td>
//             <td class="num">${fmtNumber(grpTotal)}</td>
//             <td class="num">0</td>
//             <td class="num">${fmtNumber(grpTotal)}</td>
//             <td class="num">0</td>
//             <td class="num">0</td>
//             <td class="num">0</td>
//           </tr>`;
//       });

//     } else if (groupBy === "site_location") {
//       // Principal -> Site -> Location -> Product
//       const bySite = groupRowsBy(prinRows, (r) => text(r.site_code));
//       bySite.forEach((siteRows, siteCode) => {
//         const siteTotal = sumQtyInStock(siteRows);

//         bodyHtml += `
//           <tr class="site-header">
//             <td colspan="${totalCols}">Site : ${escapeHtml(siteCode)}</td>
//           </tr>`;

//         const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
//         byLoc.forEach((locRows, locationCode) => {
//           const locTotal = sumQtyInStock(locRows);

//           bodyHtml += `
//             <tr class="location-header">
//               <td colspan="${totalCols}">Site : ${escapeHtml(siteCode)} | Location : ${escapeHtml(locationCode)}</td>
//             </tr>`;

//           byProductCode(locRows).forEach((prodRows) => {
//             bodyHtml += renderProductBlock(prodRows);
//           });

//           bodyHtml += `
//             <tr class="group-total-row">
//               <td colspan="6">Site &amp; Location Total :</td>
//               <td class="num">${fmtNumber(locTotal)}</td>
//               <td class="num">0</td>
//               <td class="num">${fmtNumber(locTotal)}</td>
//               <td class="num">0</td>
//               <td class="num">0</td>
//               <td class="num">0</td>
//             </tr>`;
//         });

//         bodyHtml += `
//           <tr class="site-total-row">
//             <td colspan="6">Site Total :</td>
//             <td class="num">${fmtNumber(siteTotal)}</td>
//             <td class="num">0</td>
//             <td class="num">${fmtNumber(siteTotal)}</td>
//             <td class="num">0</td>
//             <td class="num">0</td>
//             <td class="num">0</td>
//           </tr>`;
//       });

//     } else {
//       // No grouping — just products under principal
//       byProductCode(prinRows).forEach((prodRows) => {
//         bodyHtml += renderProductBlock(prodRows);
//       });
//     }

//     bodyHtml += `
//       <tr class="principal-total-row">
//         <td colspan="6">Principal Total :</td>
//         <td class="num">${fmtNumber(prinTotal)}</td>
//         <td class="num">0</td>
//         <td class="num">${fmtNumber(prinTotal)}</td>
//         <td class="num">0</td>
//         <td class="num">0</td>
//         <td class="num">0</td>
//       </tr>`;
//   });

//   const grandTotalLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";

//   // Header row labels: site_location omits the Site column (it's a group header instead)
//   const siteHeaderCell = groupBy === "site_location" ? "" : "<th>Site</th>";
//   const siteSubHeaderCell = groupBy === "site_location" ? "" : "<th>Location</th>";

//   const extraHeaderCells = colSpec.extraHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join("");

//   return `<!doctype html>
// <html>
// <head>
//   <meta charset="utf-8"/>
//   <title>Stock Detail Report</title>
//   <style>
//     @page { size: A3 landscape; margin: 8mm; }
//     * { box-sizing: border-box; }
//     body {
//       margin: 0;
//       font-family: Arial, sans-serif;
//       font-size: 10px;
//       color: #000;
//       background: #eef2f7;
//     }
//     .sheet {
//       min-width: 420mm;
//       margin: 0 auto;
//       background: #fff;
//       padding: 6mm;
//     }
//     .report-title {
//       text-align: center;
//       font-size: 16px;
//       font-weight: 700;
//       letter-spacing: 4px;
//       margin-bottom: 6px;
//     }
//     .report-meta {
//       display: flex;
//       justify-content: space-between;
//       font-size: 9px;
//       margin-bottom: 6px;
//       color: #333;
//     }
//     table {
//       width: 100%;
//       border-collapse: collapse;
//       font-size: 9px;
//     }
//     th {
//       background: #fff;
//       border: 1px solid #000;
//       padding: 2px 4px;
//       text-align: center;
//       font-weight: 700;
//       white-space: nowrap;
//     }
//     td {
//       border: 1px solid #ccc;
//       padding: 2px 4px;
//       vertical-align: top;
//     }
//     td.num { text-align: right; font-variant-numeric: tabular-nums; }
//     tr.principal-header td {
//       background: #1a5f4a;
//       color: #fff;
//       font-weight: 700;
//       border: 1px solid #1a5f4a;
//       padding: 3px 6px;
//     }
//     tr.group-header td, tr.site-header td, tr.location-header td {
//       background: #d4edda;
//       font-weight: 700;
//       border: 1px solid #a3c9a8;
//       padding: 2px 6px;
//     }
//     tr.location-header td {
//       background: #e3f2e6;
//       padding-left: 14px;
//     }
//     tr.product-header td {
//       background: #f0f9f5;
//       font-weight: 700;
//       border: 1px solid #a7d7c5;
//       padding: 2px 6px;
//     }
//     tr.product-header .uom {
//       font-weight: normal;
//       font-size: 9px;
//       color: #444;
//     }
//     tr.data-row td { background: #fff; }
//     tr.sub-row td {
//       background: #fafafa;
//       color: #555;
//       font-size: 9px;
//       border-top: none;
//       padding-left: 10px;
//     }
//     tr.subtotal-row td {
//       background: #fffde7;
//       font-weight: 700;
//       border-top: 1px solid #999;
//     }
//     tr.subtotal-row td.num { text-align: right; }
//     tr.group-total-row td {
//       background: #e8f5e9;
//       font-weight: 700;
//       border-top: 1px solid #4caf50;
//     }
//     tr.group-total-row td.num { text-align: right; }
//     tr.site-total-row td {
//       background: #dcedc8;
//       font-weight: 700;
//       border-top: 1px solid #689f38;
//     }
//     tr.site-total-row td.num { text-align: right; }
//     tr.principal-total-row td {
//       background: #e3f2fd;
//       font-weight: 700;
//       border-top: 2px solid #1565c0;
//     }
//     tr.principal-total-row td.num { text-align: right; }
//     tr.grand-total-row td {
//       background: #1a5f4a;
//       color: #fff;
//       font-weight: 700;
//       font-size: 10px;
//       border: 2px solid #0d3d2e;
//     }
//     tr.grand-total-row td.num { text-align: right; }
//     .report-footer {
//       display: flex;
//       justify-content: space-between;
//       font-size: 9px;
//       color: #666;
//       margin-top: 8px;
//       border-top: 1px solid #ccc;
//       padding-top: 4px;
//     }
//     @media print {
//       body { background: white; }
//       .sheet { border: 0; margin: 0; }
//       .actions { display: none !important; }
//       thead { display: table-header-group; }
//       tfoot { display: table-footer-group; }
//     }
//   </style>
// </head>
// <body>
// <main class="sheet">
//   <div class="report-title">S t o c k &nbsp; D e t a i l &nbsp; R e p o r t</div>
//   <div class="report-meta">
//     <span>Print Date : ${printDateTime}</span>
//     <span>Print User : ${escapeHtml(loginId)}</span>
//   </div>
//   <table>
//     <thead>
//       <tr>
//         ${extraHeaderCells}
//         <th>Job No.</th>
//         ${siteHeaderCell}
//         <th>Mfg. Date</th>
//         <th>Dco. Ref</th>
//         <th>Batch No</th>
//         <th>Manf. Value</th>
//         <th colspan="2">Quantity in Stock</th>
//         <th colspan="2">Quantity Available</th>
//         <th colspan="2">Quantity Picked</th>
//       </tr>
//       <tr>
//         ${extraHeaderRow2Cells}
//         <th>Receipt DT</th>
//         ${siteSubHeaderCell}
//         <th>Exp. Date</th>
//         <th>LoT No.</th>
//         <th>Freeze</th>
//         <th>Container</th>
//         <th>Curr.</th>
//         <th>PQty</th>
//         <th>LQty</th>
//         <th>PQty</th>
//         <th>LQty</th>
//         <th>PQty</th>
//         <th>LQty</th>
//       </tr>
//     </thead>
//     <tbody>
//       ${bodyHtml || `<tr><td colspan="${totalCols}" style="text-align:center;color:#666;padding:20px">No data found</td></tr>`}
//     </tbody>
//     <tfoot>
//       <tr class="grand-total-row">
//         <td colspan="6">${grandTotalLabel}</td>
//         <td class="num">${fmtNumber(grandInStock)}</td>
//         <td class="num">0</td>
//         <td class="num">${fmtNumber(grandAvail)}</td>
//         <td class="num">0</td>
//         <td class="num">${fmtNumber(grandPicked)}</td>
//         <td class="num">0</td>
//       </tr>
//     </tfoot>
//   </table>
//   <div class="report-footer">
//     <span>Report: rpt_stock_detail</span>
//     <span>Powered by Bayanat Technology</span>
//   </div>
// </main>
// </body>
// </html>`;
// }

// // ─── Excel Builder ────────────────────────────────────────────────────────────

// function buildExcelBuffer(rows: ReportRow[], groupBy: TGroupBy, loginId: string): Buffer {
//   const printDateTime = new Date().toLocaleString("en-GB", {
//     day: "2-digit", month: "short", year: "numeric",
//     hour: "2-digit", minute: "2-digit", hour12: false,
//   });

//   const GREEN  = "FF1A5F4A";
//   const WHITE  = "FFFFFFFF";
//   const LGREEN = "FFD4EDDA";
//   const LGREEN2 = "FFE3F2E6";
//   const YELLOW = "FFFFFDE7";
//   const SITEGRN = "FFDCEDC8";

//   const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });

//   const styles = {
//     title: {
//       font: { bold: true, sz: 14, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: GREEN } },
//       alignment: { horizontal: "center", vertical: "center" },
//     },
//     meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
//     header: {
//       font: { bold: true, sz: 9, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: GREEN } },
//       alignment: { horizontal: "center", vertical: "center", wrapText: true },
//       border: {
//         top: borderThin(GREEN), bottom: borderThin(GREEN),
//         left: borderThin(GREEN), right: borderThin(GREEN),
//       },
//     },
//     principal: {
//       font: { bold: true, sz: 9, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: GREEN } },
//     },
//     group: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: LGREEN } },
//     },
//     location: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: LGREEN2 } },
//     },
//     product: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: "FFF0F9F5" } },
//     },
//     data: {
//       font: { sz: 9 },
//       alignment: { vertical: "top" },
//       border: { bottom: borderThin("FFE2E8F0") },
//     },
//     dataNum: {
//       font: { sz: 9 },
//       alignment: { horizontal: "right", vertical: "top" },
//       numFmt: "#,##0",
//       border: { bottom: borderThin("FFE2E8F0") },
//     },
//     subRow: {
//       font: { sz: 8, color: { rgb: "FF555555" } },
//       fill: { fgColor: { rgb: "FFFAFAFA" } },
//     },
//     subtotal: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: YELLOW } },
//       border: { top: borderThin("FF999999") },
//     },
//     subtotalNum: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: YELLOW } },
//       alignment: { horizontal: "right" },
//       numFmt: "#,##0",
//       border: { top: borderThin("FF999999") },
//     },
//     groupTotal: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: "FFE8F5E9" } },
//       border: { top: borderThin("FF4CAF50") },
//     },
//     groupTotalNum: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: "FFE8F5E9" } },
//       alignment: { horizontal: "right" },
//       numFmt: "#,##0",
//       border: { top: borderThin("FF4CAF50") },
//     },
//     siteTotal: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: SITEGRN } },
//       border: { top: borderThin("FF689F38") },
//     },
//     siteTotalNum: {
//       font: { bold: true, sz: 9 },
//       fill: { fgColor: { rgb: SITEGRN } },
//       alignment: { horizontal: "right" },
//       numFmt: "#,##0",
//       border: { top: borderThin("FF689F38") },
//     },
//     grandTotal: {
//       font: { bold: true, sz: 10, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: GREEN } },
//       alignment: { horizontal: "right" },
//       numFmt: "#,##0",
//     },
//     grandTotalLabel: {
//       font: { bold: true, sz: 10, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: GREEN } },
//     },
//   };

//   // Column layout mirrors the HTML renderer
//   const colSpec = getColSpec(groupBy);
//   const includeSiteCol = groupBy !== "site_location";
//   const COL_COUNT = FIXED_COL_COUNT + colSpec.extraColCount;
//   const extraColOffset = colSpec.extraColCount;

//   const sheetData: any[][] = [];
//   const merges: XLSX.Range[] = [];
//   const rowStyles: Array<Record<number, any>> = [];

//   const addRow = (cells: any[], styleMap: Record<number, any>) => {
//     sheetData.push(cells);
//     rowStyles.push(styleMap);
//   };

//   // Title
//   addRow(["S t o c k   D e t a i l   R e p o r t", ...Array(COL_COUNT - 1).fill("")],
//     Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.title])));
//   merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

//   addRow([`Print Date: ${printDateTime}`, "", `Print User: ${loginId}`, ...Array(COL_COUNT - 3).fill("")],
//     { 0: styles.meta, 2: styles.meta });
//   merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
//   merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: COL_COUNT - 1 } });

//   addRow(Array(COL_COUNT).fill(""), {});

//   const headers1 = [
//     ...colSpec.extraHeaders,
//     "Job No.", ...(includeSiteCol ? ["Site"] : []), "Mfg. Date", "Dco. Ref", "Batch No", "Manf. Value",
//     "Qty in Stock", "", "Qty Available", "", "Qty Picked", "",
//   ];
//   const headers2 = [
//     ...colSpec.extraHeaders.map(() => ""),
//     "Receipt DT", ...(includeSiteCol ? ["Location"] : []), "Exp. Date", "LoT No.", "Freeze", "Container",
//     "Curr.", "PQty", "LQty", "PQty", "LQty", "PQty", "LQty",
//   ];

//   const hRow = sheetData.length;
//   addRow(headers1, Object.fromEntries(headers1.map((_, i) => [i, styles.header])));
//   addRow(headers2, Object.fromEntries(headers2.map((_, i) => [i, styles.header])));

//   const qtyBase = (includeSiteCol ? 7 : 6) + extraColOffset;
//   merges.push({ s: { r: hRow, c: qtyBase },     e: { r: hRow, c: qtyBase + 1 } });
//   merges.push({ s: { r: hRow, c: qtyBase + 2 }, e: { r: hRow, c: qtyBase + 3 } });
//   merges.push({ s: { r: hRow, c: qtyBase + 4 }, e: { r: hRow, c: qtyBase + 5 } });

//   let grandTotal = 0;

//   const renderProductXl = (prodRows: ReportRow[]) => {
//     if (!prodRows.length) return 0;
//     const first = prodRows[0];
//     let prodTotal = 0;

//     const pHRow = sheetData.length;
//     const prodLabel = `Product : ${first.prod_code} | ${first.prod_name}   Primary UOM: ${first.primary_uom}   Leat UOM: ${first.leat_uom}`;
//     addRow([prodLabel, ...Array(COL_COUNT - 1).fill("")],
//       Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.product])));
//     merges.push({ s: { r: pHRow, c: 0 }, e: { r: pHRow, c: COL_COUNT - 1 } });

//     prodRows.forEach((r) => {
//       const inStock = num(r.qty_in_stock);
//       prodTotal  += inStock;
//       grandTotal += inStock;

//       const extras = colSpec.extraCellsHtml(r);
//       const siteVal = includeSiteCol ? [text(r.site_code)] : [];
//       const rowCells = [
//         ...extras, text(r.job_no), ...siteVal, r.mfg_date ? dateText(r.mfg_date) : "",
//         text(r.dco_ref), text(r.batch_no), num(r.manf_value),
//         inStock, 0, inStock, 0, 0, 0,
//       ];
//       const styleMap: Record<number, any> = {};
//       const numStartIdx = extras.length + (includeSiteCol ? 6 : 5);
//       rowCells.forEach((_, idx) => {
//         styleMap[idx] = idx >= numStartIdx ? styles.dataNum : styles.data;
//       });
//       addRow(rowCells, styleMap);

//       const locVal = includeSiteCol ? [text(r.location_code)] : [];
//       addRow([
//         ...extras.map(() => ""),
//         dateText(r.receipt_dt), ...locVal,
//         r.exp_date ? dateText(r.exp_date) : "",
//         text(r.lot_no), r.freeze === "Y" ? "Yes" : "No",
//         text(r.container), "", "", "", "", "", "", "",
//       ], Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.subRow])));
//     });

//     const stRow = sheetData.length;
//     const subtotalNumStart = extraColOffset + (includeSiteCol ? 6 : 5);
//     const stRowCells = Array(COL_COUNT).fill("");
//     stRowCells[extraColOffset] = `UPPP : ${num(first.uppp) || 1}   Product Total :`;
//     stRowCells[subtotalNumStart]     = prodTotal;
//     stRowCells[subtotalNumStart + 1] = 0;
//     stRowCells[subtotalNumStart + 2] = prodTotal;
//     stRowCells[subtotalNumStart + 3] = 0;
//     stRowCells[subtotalNumStart + 4] = 0;
//     stRowCells[subtotalNumStart + 5] = 0;
//     const stStyleMap: Record<number, any> = { [extraColOffset]: styles.subtotal };
//     for (let i = subtotalNumStart; i < subtotalNumStart + 6; i++) stStyleMap[i] = styles.subtotalNum;
//     addRow(stRowCells, stStyleMap);
//     if (subtotalNumStart > 0)
//       merges.push({ s: { r: stRow, c: extraColOffset }, e: { r: stRow, c: subtotalNumStart - 1 } });

//     return prodTotal;
//   };

//   const addTotalRow = (label: string, totalVal: number, style: any, styleNum: any, numStart: number) => {
//     const tRow = sheetData.length;
//     const cells = Array(COL_COUNT).fill("");
//     cells[0] = label;
//     cells[numStart]     = totalVal;
//     cells[numStart + 1] = 0;
//     cells[numStart + 2] = totalVal;
//     cells[numStart + 3] = 0;
//     cells[numStart + 4] = 0;
//     cells[numStart + 5] = 0;
//     const styleMap: Record<number, any> = {};
//     for (let i = 0; i < numStart; i++) styleMap[i] = style;
//     for (let i = numStart; i < numStart + 6; i++) styleMap[i] = styleNum;
//     addRow(cells, styleMap);
//     if (numStart > 0) merges.push({ s: { r: tRow, c: 0 }, e: { r: tRow, c: numStart - 1 } });
//     return tRow;
//   };

//   const fixedNumStart = extraColOffset + (includeSiteCol ? 6 : 5);

//   const byPrin = groupRowsBy(rows, (r) => text(r.prin_code));
//   byPrin.forEach((prinRows, prinCode) => {
//     const prinName = text(prinRows[0]?.prin_name);
//     let prinTotal = 0;

//     const prRow = sheetData.length;
//     addRow([`Principal : ${prinCode} | ${prinName}`, ...Array(COL_COUNT - 1).fill("")],
//       Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.principal])));
//     merges.push({ s: { r: prRow, c: 0 }, e: { r: prRow, c: COL_COUNT - 1 } });

//     const byProductCode = (group: ReportRow[]) => Array.from(groupRowsBy(group, (r) => text(r.prod_code)).values());

//     if (groupBy === "group_brand") {
//       const byBrand = groupRowsBy(prinRows, (r) => text(r.brand_code));
//       byBrand.forEach((brandRows, brandCode) => {
//         const brandName = text(brandRows[0]?.brand_name);
//         const gRow = sheetData.length;
//         addRow([`Brand : ${brandCode} | ${brandName}`, ...Array(COL_COUNT - 1).fill("")],
//           Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
//         merges.push({ s: { r: gRow, c: 0 }, e: { r: gRow, c: COL_COUNT - 1 } });
//         let brandTotal = 0;
//         byProductCode(brandRows).forEach((pr) => { brandTotal += renderProductXl(pr); });
//         prinTotal += brandTotal;
//         addTotalRow("Brand Total :", brandTotal, styles.groupTotal, styles.groupTotalNum, fixedNumStart);
//       });
//     } else if (groupBy === "principal_product") {
//       byProductCode(prinRows).forEach((pr) => { prinTotal += renderProductXl(pr); });
//     } else if (groupBy === "product_group") {
//       const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
//       byGroup.forEach((grpRows, grpCode) => {
//         const grpName = text(grpRows[0]?.prod_group_name);
//         const gRow = sheetData.length;
//         addRow([`Product Group : ${grpCode} | ${grpName}`, ...Array(COL_COUNT - 1).fill("")],
//           Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
//         merges.push({ s: { r: gRow, c: 0 }, e: { r: gRow, c: COL_COUNT - 1 } });
//         let grpTotal = 0;
//         byProductCode(grpRows).forEach((pr) => { grpTotal += renderProductXl(pr); });
//         prinTotal += grpTotal;
//         addTotalRow("Product Group Total :", grpTotal, styles.groupTotal, styles.groupTotalNum, fixedNumStart);
//       });
//     } else if (groupBy === "site_location") {
//       const bySite = groupRowsBy(prinRows, (r) => text(r.site_code));
//       bySite.forEach((siteRows, siteCode) => {
//         const sRow = sheetData.length;
//         addRow([`Site : ${siteCode}`, ...Array(COL_COUNT - 1).fill("")],
//           Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
//         merges.push({ s: { r: sRow, c: 0 }, e: { r: sRow, c: COL_COUNT - 1 } });

//         let siteTotal = 0;
//         const byLoc = groupRowsBy(siteRows, (r) => text(r.location_code));
//         byLoc.forEach((locRows, locationCode) => {
//           const lRow = sheetData.length;
//           addRow([`Site : ${siteCode} | Location : ${locationCode}`, ...Array(COL_COUNT - 1).fill("")],
//             Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.location])));
//           merges.push({ s: { r: lRow, c: 0 }, e: { r: lRow, c: COL_COUNT - 1 } });

//           let locTotal = 0;
//           byProductCode(locRows).forEach((pr) => { locTotal += renderProductXl(pr); });
//           siteTotal += locTotal;
//           addTotalRow("Site & Location Total :", locTotal, styles.groupTotal, styles.groupTotalNum, fixedNumStart);
//         });

//         prinTotal += siteTotal;
//         addTotalRow("Site Total :", siteTotal, styles.siteTotal, styles.siteTotalNum, fixedNumStart);
//       });
//     } else {
//       byProductCode(prinRows).forEach((pr) => { prinTotal += renderProductXl(pr); });
//     }

//     addTotalRow("Principal Total :", prinTotal, styles.subtotal, styles.grandTotal, fixedNumStart);
//     // Re-style principal total label + row with the blue look via grandTotalLabel/grandTotal-like emphasis
//     const lastIdx = sheetData.length - 1;
//     for (let i = 0; i < fixedNumStart; i++) rowStyles[lastIdx][i] = styles.grandTotalLabel;
//     for (let i = fixedNumStart; i < COL_COUNT; i++) rowStyles[lastIdx][i] = styles.grandTotal;
//   });

//   const grandLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";
//   addTotalRow(grandLabel, grandTotal, styles.grandTotalLabel, styles.grandTotal, fixedNumStart);

//   addRow(["", ...Array(COL_COUNT - 2).fill(""), "Powered by Bayanat Technology"],
//     { [COL_COUNT - 1]: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } } });

//   // Build worksheet
//   const ws = XLSX.utils.aoa_to_sheet(sheetData);
//   ws["!merges"] = merges;
//   ws["!cols"] = Array.from({ length: COL_COUNT }, (_, i) => {
//     if (i < extraColOffset) return { wch: 14 };
//     return { wch: 11 };
//   });
//   ws["!rows"] = sheetData.map((_, i) => ({ hpt: i === 0 ? 24 : 14 }));

//   // Apply styles
//   sheetData.forEach((row, r) => {
//     const styleMap = rowStyles[r];
//     row.forEach((_: any, c: number) => {
//       if (styleMap[c]) {
//         const ref = XLSX.utils.encode_cell({ r, c });
//         if (!ws[ref]) ws[ref] = { t: "s", v: "" };
//         (ws[ref] as any).s = styleMap[c];
//       }
//     });
//   });

//   // Build xlsx zip (same approach as trial balance reference)
//   const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
//   let sheetXmlData = "";
//   for (let r2 = range.s.r; r2 <= range.e.r; r2++) {
//     const cells: string[] = [];
//     for (let c = range.s.c; c <= range.e.c; c++) {
//       const ref  = XLSX.utils.encode_cell({ r: r2, c });
//       const cell = ws[ref] as XLSX.CellObject | undefined;
//       if (!cell) continue;
//       const value = cell?.v;
//       if (typeof value === "number") {
//         cells.push(`<c r="${ref}"><v>${value}</v></c>`);
//       } else {
//         cells.push(`<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value ?? "")}</t></is></c>`);
//       }
//     }
//     if (cells.length) sheetXmlData += `<row r="${r2 + 1}">${cells.join("")}</row>`;
//   }

//   const mergesXml  = merges.map(m => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`).join("");
//   const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";
//   const colsXml    = (ws["!cols"] || []).map((col: any, i: number) =>
//     `<col min="${i+1}" max="${i+1}" width="${col.wch || 10}" customWidth="1"/>`).join("");

//   const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
//   <sheetFormatPr defaultRowHeight="14"/>
//   <cols>${colsXml}</cols>
//   <sheetData>${sheetXmlData}</sheetData>
//   ${mergeFinal}
// </worksheet>`;

//   const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
//   <sheets><sheet name="Stock Detail" sheetId="1" r:id="rId1"/></sheets>
// </workbook>`;

//   const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
// </Relationships>`;

//   const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
// </Relationships>`;

//   const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
//   <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
//   <Default Extension="xml"  ContentType="application/xml"/>
//   <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
//   <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
// </Types>`;

//   const zip = new AdmZip();
//   zip.addFile("[Content_Types].xml",          Buffer.from(contentTypes));
//   zip.addFile("_rels/.rels",                   Buffer.from(rels));
//   zip.addFile("xl/workbook.xml",               Buffer.from(workbookXml));
//   zip.addFile("xl/_rels/workbook.xml.rels",    Buffer.from(workbookRels));
//   zip.addFile("xl/worksheets/sheet1.xml",      Buffer.from(sheetXml));
//   return zip.toBuffer();
// }

// // ─── Route Handlers ───────────────────────────────────────────────────────────

// export const getStockDetailReportHtml = async (
//   req: RequestWithUser,
//   res: Response,
// ): Promise<void> => {
//   try {
//     const params = parseParams(req);
//     const rows   = await loadStockData(req);
//     const html   = renderHtml(rows, params.groupBy, req.user?.loginid ?? "");

//     res.setHeader("Content-Type", "text/html; charset=utf-8");
//     res.send(html);
//   } catch (error: any) {
//     console.error("Stock Detail Report HTML error:", error);
//     res.status(error.status || 500).json({
//       success: false,
//       message: error.message || "Unable to generate report",
//     });
//   }
// };

// export const exportStockDetailReportExcel = async (
//   req: RequestWithUser,
//   res: Response,
// ): Promise<void> => {
//   try {
//     const params   = parseParams(req);
//     const rows     = await loadStockData(req);
//     const buffer   = buildExcelBuffer(rows, params.groupBy, req.user?.loginid ?? "");
//     const filename = `stock_detail_report_${new Date().toISOString().slice(0, 10)}.xlsx`;

//     res.setHeader(
//       "Content-Type",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//     );
//     res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
//     res.end(buffer);
//   } catch (error: any) {
//     console.error("Stock Detail Report Excel error:", error);
//     res.status(error.status || 500).json({
//       success: false,
//       message: error.message || "Unable to export report",
//     });
//   }
// };


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
  });
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

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────
//
// Column model (mirrors the printed "Stock Detail Report" exactly):
//
//   [extra columns depend on groupBy] | Job No. | Site* | Mfg. Date | Dco. Ref |
//   Batch No | Manf. | Value | Qty in Stock (PQty/LQty) | Qty Available (PQty/LQty) | Qty Picked (PQty/LQty)
//
// Every ledger line prints as TWO physical rows that share the same column
// grid — the header therefore has two stacked label rows:
//
//   row 1 (main line):  Job No.   | Site*     | Mfg. Date | Dco. Ref | Batch No | Manf.     | Value
//   row 2 (detail line): Receipt DT | Location* | Exp. Date | LoT No.  | Freeze   | Container | Curr.
//
// * Site / Location are omitted entirely for "site_location" grouping, since
//   that mode already breaks the report into Site/Location section headers.
//
// Extra leading columns per groupBy (matches the 4 sample reports):
//   group_brand        -> Product Group (name)               — section headers: Principal -> Product Group -> Brand -> Product
//   principal_product  -> Product Group (code), Brand (code) — section headers: Principal -> Product (no Group/Brand headers)
//   product_group      -> Brand (name)                       — section headers: Principal -> Product Group -> Product
//   site_location      -> Product Group (name), Brand (name) — section headers: Principal -> Site/Location -> Product

interface ExtraCol {
  header: string;
  getValue: (row: ReportRow) => string;
}

function renderHtml(rows: ReportRow[], groupBy: TGroupBy, loginId: string): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  // ── Column model for this groupBy
  const includeSite = groupBy !== "site_location";

  let extraCols: ExtraCol[] = [];
  if (groupBy === "group_brand") {
    extraCols = [
      { header: "Product Group", getValue: (r) => text(r.prod_group_name) || text(r.prod_group_code) },
    ];
  } else if (groupBy === "principal_product") {
    extraCols = [
      { header: "Product Group", getValue: (r) => text(r.prod_group_code) },
      { header: "Brand",         getValue: (r) => text(r.brand_code) },
    ];
  } else if (groupBy === "product_group") {
    extraCols = [
      { header: "Brand", getValue: (r) => text(r.brand_name) || text(r.brand_code) },
    ];
  } else if (groupBy === "site_location") {
    extraCols = [
      { header: "Product Group", getValue: (r) => text(r.prod_group_name) || text(r.prod_group_code) },
      { header: "Brand",         getValue: (r) => text(r.brand_name) || text(r.brand_code) },
    ];
  }
  const extraColCount = extraCols.length;

  const mainFixedHeaders = [
    "Job No.", ...(includeSite ? ["Site"] : []), "Mfg. Date", "Dco. Ref", "Batch No", "Manf.", "Value",
  ];
  const subFixedHeaders = [
    "Receipt DT", ...(includeSite ? ["Location"] : []), "Exp. Date", "LoT No.", "Freeze", "Container", "Curr.",
  ];
  const fixedColCount = mainFixedHeaders.length; // same length as subFixedHeaders
  const totalCols     = extraColCount + fixedColCount + 6; // +6 for the 3 PQty/LQty quantity pairs
  const labelColspan   = extraColCount + fixedColCount;     // everything before the quantity block

  // ── Grand total accumulators
  let grandInStock = 0, grandAvail = 0, grandPicked = 0;

  const sumQty = (list: ReportRow[]) => {
    let s = 0, a = 0, p = 0;
    list.forEach((r) => { s += num(r.qty_in_stock); a += num(r.qty_available); p += num(r.qty_picked); });
    return { stock: s, avail: a, picked: p };
  };

  // ── A single ledger line = main row + detail sub-row, sharing the column grid above
  const renderLineRow = (row: ReportRow): string => {
    const inStock = num(row.qty_in_stock);
    const avail   = num(row.qty_available);
    const picked  = num(row.qty_picked);
    grandInStock += inStock;
    grandAvail   += avail;
    grandPicked  += picked;

    const extraCells = extraCols.map((c) => `<td>${escapeHtml(c.getValue(row))}</td>`).join("");
    const siteCell     = includeSite ? `<td>${escapeHtml(row.site_code)}</td>` : "";
    const locationCell = includeSite ? `<td>${escapeHtml(row.location_code)}</td>` : "";

    return `
      <tr class="data-row">
        ${extraCells}
        <td>${escapeHtml(row.job_no)}</td>
        ${siteCell}
        <td>${escapeHtml(row.mfg_date ? dateText(row.mfg_date) : "")}</td>
        <td>${escapeHtml(row.dco_ref)}</td>
        <td>${escapeHtml(row.batch_no)}</td>
        <td>${escapeHtml(row.manf_code ?? row.manf ?? "")}</td>
        <td class="num">${escapeHtml(text(row.manf_value))}</td>
        <td class="num">${fmtNumber(inStock)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(avail)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(picked)}</td>
        <td class="num">0</td>
      </tr>
      <tr class="sub-row">
        ${extraColCount ? `<td colspan="${extraColCount}"></td>` : ""}
        <td>${escapeHtml(row.receipt_dt ? dateText(row.receipt_dt) : "")}</td>
        ${locationCell}
        <td>${escapeHtml(row.exp_date ? dateText(row.exp_date) : "")}</td>
        <td>${escapeHtml(row.lot_no)}</td>
        <td>${escapeHtml(row.freeze === "Y" ? "Yes" : "No")}</td>
        <td>${escapeHtml(row.container)}</td>
        <td>${escapeHtml(row.curr_code ?? row.currency ?? row.curr ?? "")}</td>
        <td colspan="6"></td>
      </tr>`;
  };

  // ── Generic full-width section header (Principal / Product Group / Brand / Site & Location)
  const sectionHeaderRow = (cls: string, label: string): string =>
    `<tr class="${cls}"><td colspan="${totalCols}">${label}</td></tr>`;

  // ── Generic totals row (Product / Brand / Product Group / Principal / Grand)
  const totalsRow = (cls: string, label: string, qty: { stock: number; avail: number; picked: number }): string => `
    <tr class="${cls}">
      <td colspan="${labelColspan}">${label}</td>
      <td class="num">${fmtNumber(qty.stock)}</td>
      <td class="num">0</td>
      <td class="num">${fmtNumber(qty.avail)}</td>
      <td class="num">0</td>
      <td class="num">${fmtNumber(qty.picked)}</td>
      <td class="num">0</td>
    </tr>`;

  // ── Product header + its lines + its "Product Total" row
  const renderProduct = (prod: ReportRow[]): string => {
    if (!prod.length) return "";
    const first = prod[0];
    const uppp  = num(first.uppp) || 1;
    const qty   = sumQty(prod);
    const lines = prod.map((r) => renderLineRow(r)).join("");

    return `
      <tr class="product-header">
        <td colspan="${totalCols}">
          <div class="product-header-row">
            <span class="product-label">Product : ${escapeHtml(first.prod_code)} | ${escapeHtml(first.prod_name)}</span>
            <span class="uom">Primary Unit of Measurement : ${escapeHtml(first.primary_uom)}</span>
            <span class="uom">Leat Unit of Measurement : ${escapeHtml(first.leat_uom)}</span>
          </div>
        </td>
      </tr>
      ${lines}
      <tr class="subtotal-row">
        <td colspan="${labelColspan}">UPPP : ${uppp} &nbsp;&nbsp; Product Total :</td>
        <td class="num">${fmtNumber(qty.stock)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(qty.avail)}</td>
        <td class="num">0</td>
        <td class="num">${fmtNumber(qty.picked)}</td>
        <td class="num">0</td>
      </tr>`;
  };

  const groupRowsBy = (list: ReportRow[], keyFn: (r: ReportRow) => string): Record<string, ReportRow[]> => {
    const out: Record<string, ReportRow[]> = {};
    list.forEach((r) => {
      const k = keyFn(r);
      if (!out[k]) out[k] = [];
      out[k].push(r);
    });
    return out;
  };

  // ── Group rows by principal first (always)
  const byPrin = groupRowsBy(rows, (r) => text(r.prin_code));

  let bodyHtml = "";

  Object.entries(byPrin).forEach(([prinCode, prinRows]) => {
    const prinName = text(prinRows[0]?.prin_name);
    const prinQty  = sumQty(prinRows);

    bodyHtml += sectionHeaderRow("principal-header", `Principal : ${escapeHtml(prinCode)} | ${escapeHtml(prinName)}`);

    if (groupBy === "group_brand") {
      // Principal -> Product Group -> Brand -> Product
      const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
      Object.entries(byGroup).forEach(([grpCode, grpRows]) => {
        bodyHtml += sectionHeaderRow(
          "group-header",
          `Product Group : ${escapeHtml(grpCode)} | ${escapeHtml(grpRows[0]?.prod_group_name)}`,
        );
        const byBrand = groupRowsBy(grpRows, (r) => text(r.brand_code));
        Object.entries(byBrand).forEach(([brandCode, brandRows]) => {
          bodyHtml += sectionHeaderRow(
            "brand-header",
            `Brand : ${escapeHtml(brandCode)} | ${escapeHtml(brandRows[0]?.brand_name)}`,
          );
          const byProd = groupRowsBy(brandRows, (r) => text(r.prod_code));
          Object.values(byProd).forEach((prodRows) => { bodyHtml += renderProduct(prodRows); });
          bodyHtml += totalsRow("brand-total-row", "Brand Total :", sumQty(brandRows));
        });
      });

    } else if (groupBy === "principal_product") {
      // Principal -> Product (Product Group / Brand shown inline per row)
      const byProd = groupRowsBy(prinRows, (r) => text(r.prod_code));
      Object.values(byProd).forEach((prodRows) => { bodyHtml += renderProduct(prodRows); });

    } else if (groupBy === "product_group") {
      // Principal -> Product Group -> Product (Brand shown inline per row)
      const byGroup = groupRowsBy(prinRows, (r) => text(r.prod_group_code));
      Object.entries(byGroup).forEach(([grpCode, grpRows]) => {
        bodyHtml += sectionHeaderRow(
          "group-header",
          `Product Group : ${escapeHtml(grpCode)} | ${escapeHtml(grpRows[0]?.prod_group_name)}`,
        );
        const byProd = groupRowsBy(grpRows, (r) => text(r.prod_code));
        Object.values(byProd).forEach((prodRows) => { bodyHtml += renderProduct(prodRows); });
        bodyHtml += totalsRow("group-total-row", "Product Group Total :", sumQty(grpRows));
      });

    } else if (groupBy === "site_location") {
      // Principal -> Site / Location -> Product (Product Group / Brand shown inline per row)
      const bySiteLoc = groupRowsBy(prinRows, (r) => `${r.site_code}||${r.location_code}`);
      Object.entries(bySiteLoc).forEach(([key, locRows]) => {
        const [siteCode, locationCode] = key.split("||");
        bodyHtml += sectionHeaderRow(
          "site-header",
          `Site : ${escapeHtml(siteCode)} &nbsp;|&nbsp; Location : ${escapeHtml(locationCode)}`,
        );
        const byProd = groupRowsBy(locRows, (r) => text(r.prod_code));
        Object.values(byProd).forEach((prodRows) => { bodyHtml += renderProduct(prodRows); });
        bodyHtml += totalsRow("group-total-row", "Site &amp; Location Total :", sumQty(locRows));
      });

    } else {
      // No grouping — just products under principal
      const byProd = groupRowsBy(prinRows, (r) => text(r.prod_code));
      Object.values(byProd).forEach((prodRows) => { bodyHtml += renderProduct(prodRows); });
    }

    // "site_location" mode reuses the "Site & Location Total" label for the principal-level
    // rollup too (matches the printed report); every other mode says "Principal Total".
    const principalTotalLabel = groupBy === "site_location" ? "Site &amp; Location Total :" : "Principal Total :";
    bodyHtml += totalsRow("principal-total-row", principalTotalLabel, prinQty);
  });

  // "site_location" mode labels the final grand total simply "Total" (matches the printed report).
  const grandTotalLabel = groupBy === "site_location" ? "Total :" : "Grand Total :";

  // ── Header cell groups
  const extraHeaderRow1 = extraCols.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const extraHeaderRow2 = extraCols.map(() => `<th></th>`).join("");
  const mainFixedTh     = mainFixedHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const subFixedTh      = subFixedHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Stock Detail Report</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      color: #000;
      background: #e9ecef;
    }
    .sheet {
      min-width: 420mm;
      margin: 0 auto;
      background: #fff;
      border: 1.5px solid #000;
      padding: 6mm;
    }
    .report-title-bar {
      background: #2e1b92;
      color: #fff;
      text-align: center;
      font-family: Georgia, 'Times New Roman', serif;
      font-style: italic;
      font-weight: 700;
      font-size: 16px;
      letter-spacing: 6px;
      padding: 8px 0;
      margin-bottom: 4px;
    }
    .report-meta {
      display: flex;
      justify-content: space-between;
      font-style: italic;
      font-weight: 700;
      font-size: 10px;
      margin-bottom: 8px;
      color: #000;
    }
    .report-meta .label { font-weight: 700; }
    .report-meta .value { font-weight: 700; margin-right: 28px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5px;
      table-layout: auto;
    }
    th {
      background: #cfcfcf;
      border: 1px solid #000;
      padding: 3px 5px;
      text-align: center;
      font-weight: 700;
      white-space: nowrap;
    }
    td {
      border: 1px solid #999;
      padding: 2px 5px;
      vertical-align: top;
      background: #fff;
    }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.principal-header td,
    tr.group-header td,
    tr.brand-header td,
    tr.site-header td,
    tr.product-header td {
      background: #fff;
      font-weight: 700;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 3px 6px;
    }
    .product-header-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 18px;
      flex-wrap: wrap;
    }
    .product-header-row .uom { font-weight: 700; white-space: nowrap; }
    tr.data-row td { background: #fff; }
    tr.sub-row td {
      background: #fff;
      color: #333;
      border-top: none;
    }
    tr.subtotal-row td,
    tr.brand-total-row td,
    tr.group-total-row td,
    tr.principal-total-row td {
      background: #fff;
      font-weight: 700;
      border-top: 1px solid #000;
    }
    tr.grand-total-row td {
      background: #fff;
      font-weight: 700;
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
    }
    .report-footer {
      display: flex;
      justify-content: space-between;
      font-style: italic;
      font-size: 9px;
      color: #555;
      margin-top: 8px;
    }
    @media print {
      body { background: white; }
      .sheet { border: 0; margin: 0; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
    }
  </style>
</head>
<body>
<main class="sheet">
  <div class="report-title-bar">S t o c k &nbsp; D e t a i l &nbsp; R e p o r t</div>
  <div class="report-meta">
    <span><span class="label">Print Date : </span><span class="value">${printDateTime}</span><span class="label">Print User : </span><span class="value">${escapeHtml(loginId)}</span></span>
  </div>
  <table>
    <thead>
      <tr>
        ${extraHeaderRow1}
        ${mainFixedTh}
        <th colspan="2">Quantity in Stock</th>
        <th colspan="2">Quantity Available</th>
        <th colspan="2">Quantity Picked</th>
      </tr>
      <tr>
        ${extraHeaderRow2}
        ${subFixedTh}
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

  const GREEN  = "FF1A5F4A";
  const WHITE  = "FFFFFFFF";
  const GOLD   = "FFD4A017";
  const LGREEN = "FFD4EDDA";
  const YELLOW = "FFFFFDE7";

  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
  const borderMed  = (color: string) => ({ style: "medium", color: { rgb: color } });

  const styles = {
    title: {
      font: { bold: true, sz: 14, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: GREEN } },
      alignment: { horizontal: "center", vertical: "center" },
    },
    meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font: { bold: true, sz: 9, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: GREEN } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top: borderThin(GREEN), bottom: borderThin(GREEN),
        left: borderThin(GREEN), right: borderThin(GREEN),
      },
    },
    principal: {
      font: { bold: true, sz: 9, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: GREEN } },
    },
    group: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: LGREEN } },
    },
    product: {
      font: { bold: true, sz: 9 },
      fill: { fgColor: { rgb: "FFF0F9F5" } },
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
    grandTotal: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: GREEN } },
      alignment: { horizontal: "right" },
      numFmt: "#,##0",
    },
    grandTotalLabel: {
      font: { bold: true, sz: 10, color: { rgb: WHITE } },
      fill: { fgColor: { rgb: GREEN } },
    },
  };

  const sheetData: any[][] = [];
  const merges: XLSX.Range[] = [];
  const rowStyles: Array<Record<number, any>> = [];

  const COL_COUNT = 14;
  const addRow = (cells: any[], styleMap: Record<number, any>, height?: number) => {
    sheetData.push(cells);
    rowStyles.push(styleMap);
  };

  // Title
  addRow(["S t o c k   D e t a i l   R e p o r t", ...Array(COL_COUNT - 1).fill("")],
    Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.title])), 24);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

  addRow([`Print Date: ${printDateTime}`, "", `Print User: ${loginId}`, ...Array(COL_COUNT - 3).fill("")],
    { 0: styles.meta, 2: styles.meta });
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
  merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: COL_COUNT - 1 } });

  addRow(Array(COL_COUNT).fill(""), {});

  const extraLabel1 = groupBy === "group_brand" ? "Product Group" :
                      groupBy === "principal_product" ? "Product Group" :
                      groupBy === "product_group" ? "Brand" :
                      groupBy === "site_location" ? "Product Group" : "";
  const extraLabel2 = groupBy === "principal_product" ? "Brand" :
                      groupBy === "site_location" ? "Brand" : "";

  const headers1 = [
    ...(extraLabel1 ? [extraLabel1] : []),
    ...(extraLabel2 ? [extraLabel2] : []),
    "Job No.", "Site", "Mfg. Date", "Dco. Ref", "Batch No", "Manf. Value",
    "Qty in Stock", "", "Qty Available", "", "Qty Picked", "",
  ];
  const headers2 = [
    ...(extraLabel1 ? [""] : []),
    ...(extraLabel2 ? [""] : []),
    "Receipt DT", "Location", "Exp. Date", "LoT No.", "Freeze", "Container",
    "Curr.", "PQty", "LQty", "PQty", "LQty", "PQty", "LQty",
  ];

  const hRow = sheetData.length;
  addRow(headers1, Object.fromEntries(headers1.map((_, i) => [i, styles.header])), 22);
  addRow(headers2, Object.fromEntries(headers2.map((_, i) => [i, styles.header])), 18);

  // Merge quantity headers
  const extraColOffset = (extraLabel1 ? 1 : 0) + (extraLabel2 ? 1 : 0);
  const qtyBase = 6 + extraColOffset;
  merges.push({ s: { r: hRow, c: qtyBase },     e: { r: hRow, c: qtyBase + 1 } });
  merges.push({ s: { r: hRow, c: qtyBase + 2 }, e: { r: hRow, c: qtyBase + 3 } });
  merges.push({ s: { r: hRow, c: qtyBase + 4 }, e: { r: hRow, c: qtyBase + 5 } });
  merges.push({ s: { r: hRow, c: 0 }, e: { r: hRow + 1, c: extraLabel1 ? 0 : -1 } });

  // Data rows
  let grandTotal = 0;

  const byPrin: Record<string, ReportRow[]> = {};
  rows.forEach(r => {
    const k = text(r.prin_code);
    if (!byPrin[k]) byPrin[k] = [];
    byPrin[k].push(r);
  });

  Object.entries(byPrin).forEach(([prinCode, prinRows]) => {
    const prinName = text(prinRows[0]?.prin_name);
    let prinTotal = 0;

    const prRow = sheetData.length;
    addRow([`Principal : ${prinCode} | ${prinName}`, ...Array(COL_COUNT - 1).fill("")],
      Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.principal])));
    merges.push({ s: { r: prRow, c: 0 }, e: { r: prRow, c: COL_COUNT - 1 } });

    const renderProductXl = (prodRows: ReportRow[], getExtra: (r: ReportRow) => string[]) => {
      if (!prodRows.length) return;
      const first = prodRows[0];
      let prodTotal = 0;

      const pHRow = sheetData.length;
      const prodLabel = `Product : ${first.prod_code} | ${first.prod_name}   Primary UOM: ${first.primary_uom}   Leat UOM: ${first.leat_uom}`;
      addRow([prodLabel, ...Array(COL_COUNT - 1).fill("")],
        Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.product])));
      merges.push({ s: { r: pHRow, c: 0 }, e: { r: pHRow, c: COL_COUNT - 1 } });

      prodRows.forEach(r => {
        const inStock = num(r.qty_in_stock);
        prodTotal  += inStock;
        prinTotal  += inStock;
        grandTotal += inStock;

        const extras = getExtra(r);
        addRow([
          ...extras,
          text(r.job_no), text(r.site_code), r.mfg_date ? dateText(r.mfg_date) : "",
          text(r.dco_ref), text(r.batch_no), num(r.manf_value),
          inStock, 0, inStock, 0, 0, 0,
        ], {
          ...Object.fromEntries(extras.map((_, i) => [i, styles.data])),
          [extras.length]: styles.data,
          [extras.length + 1]: styles.data,
          [extras.length + 2]: styles.data,
          [extras.length + 3]: styles.data,
          [extras.length + 4]: styles.data,
          [extras.length + 5]: styles.dataNum,
          [extras.length + 6]: styles.dataNum,
          [extras.length + 7]: styles.dataNum,
          [extras.length + 8]: styles.dataNum,
          [extras.length + 9]: styles.dataNum,
          [extras.length + 10]: styles.dataNum,
          [extras.length + 11]: styles.dataNum,
        });
        addRow([
          ...extras.map(() => ""),
          dateText(r.receipt_dt), text(r.location_code),
          r.exp_date ? dateText(r.exp_date) : "",
          text(r.lot_no), r.freeze === "Y" ? "Yes" : "No",
          text(r.container), "", "", "", "", "", "", "",
        ], Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.subRow])));
      });

      const stRow = sheetData.length;
      addRow([
        ...Array(extraColOffset).fill(""),
        `UPPP : ${num(first.uppp) || 1}   Product Total :`, "", "", "", "", "",
        prodTotal, 0, prodTotal, 0, 0, 0,
      ], {
        [extraColOffset]: styles.subtotal,
        [extraColOffset + 6]: styles.subtotalNum,
        [extraColOffset + 7]: styles.subtotalNum,
        [extraColOffset + 8]: styles.subtotalNum,
        [extraColOffset + 9]: styles.subtotalNum,
        [extraColOffset + 10]: styles.subtotalNum,
        [extraColOffset + 11]: styles.subtotalNum,
      });
      if (extraColOffset > 0)
        merges.push({ s: { r: stRow, c: 0 }, e: { r: stRow, c: extraColOffset - 1 } });
      merges.push({ s: { r: stRow, c: extraColOffset }, e: { r: stRow, c: extraColOffset + 5 } });
    };

    // Apply groupBy logic for Excel
    if (groupBy === "group_brand") {
      const byGroup: Record<string, ReportRow[]> = {};
      prinRows.forEach(r => { const k = text(r.prod_group_code); if (!byGroup[k]) byGroup[k] = []; byGroup[k].push(r); });
      Object.entries(byGroup).forEach(([gc, gr]) => {
        const gRow = sheetData.length;
        addRow([`Product Group : ${gc} | ${gr[0]?.prod_group_name}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
        merges.push({ s: { r: gRow, c: 0 }, e: { r: gRow, c: COL_COUNT - 1 } });
        const byBrand: Record<string, ReportRow[]> = {};
        gr.forEach(r => { const k = text(r.brand_code); if (!byBrand[k]) byBrand[k] = []; byBrand[k].push(r); });
        Object.entries(byBrand).forEach(([bc, br]) => {
          const brRow = sheetData.length;
          addRow([`Brand : ${bc} | ${br[0]?.brand_name}`, ...Array(COL_COUNT - 1).fill("")],
            Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
          merges.push({ s: { r: brRow, c: 0 }, e: { r: brRow, c: COL_COUNT - 1 } });
          const byProd2: Record<string, ReportRow[]> = {};
          br.forEach(r => { const k = text(r.prod_code); if (!byProd2[k]) byProd2[k] = []; byProd2[k].push(r); });
          Object.values(byProd2).forEach(pr => renderProductXl(pr, (r) => [text(r.prod_group_name || r.prod_group_code)]));
          let brTotal = 0;
          br.forEach(r => { brTotal += num(r.qty_in_stock); });
          const btRow = sheetData.length;
          addRow([...Array(1).fill(""), "Brand Total :", "", "", "", "", "", brTotal, 0, brTotal, 0, 0, 0], {
            1: styles.subtotal,
            7: styles.subtotalNum, 8: styles.subtotalNum, 9: styles.subtotalNum,
            10: styles.subtotalNum, 11: styles.subtotalNum, 12: styles.subtotalNum,
          });
          merges.push({ s: { r: btRow, c: 0 }, e: { r: btRow, c: 6 } });
        });
      });
    } else if (groupBy === "principal_product") {
      const byProd2: Record<string, ReportRow[]> = {};
      prinRows.forEach(r => { const k = text(r.prod_code); if (!byProd2[k]) byProd2[k] = []; byProd2[k].push(r); });
      Object.values(byProd2).forEach(pr => renderProductXl(pr, r => [text(r.prod_group_code), text(r.brand_code)]));
    } else if (groupBy === "product_group") {
      const byGroup: Record<string, ReportRow[]> = {};
      prinRows.forEach(r => { const k = text(r.prod_group_code); if (!byGroup[k]) byGroup[k] = []; byGroup[k].push(r); });
      Object.entries(byGroup).forEach(([gc, gr]) => {
        const gRow = sheetData.length;
        addRow([`Product Group : ${gc} | ${gr[0]?.prod_group_name}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
        merges.push({ s: { r: gRow, c: 0 }, e: { r: gRow, c: COL_COUNT - 1 } });
        const byProd2: Record<string, ReportRow[]> = {};
        gr.forEach(r => { const k = text(r.prod_code); if (!byProd2[k]) byProd2[k] = []; byProd2[k].push(r); });
        Object.values(byProd2).forEach(pr => renderProductXl(pr, r => [text(r.brand_name || r.brand_code)]));
      });
    } else if (groupBy === "site_location") {
      const bySL: Record<string, ReportRow[]> = {};
      prinRows.forEach(r => { const k = `${r.site_code}||${r.location_code}`; if (!bySL[k]) bySL[k] = []; bySL[k].push(r); });
      Object.entries(bySL).forEach(([key, lr]) => {
        const [sc, lc] = key.split("||");
        const slRow = sheetData.length;
        addRow([`Site : ${sc} | Location : ${lc}`, ...Array(COL_COUNT - 1).fill("")],
          Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, styles.group])));
        merges.push({ s: { r: slRow, c: 0 }, e: { r: slRow, c: COL_COUNT - 1 } });
        const byProd2: Record<string, ReportRow[]> = {};
        lr.forEach(r => { const k = text(r.prod_code); if (!byProd2[k]) byProd2[k] = []; byProd2[k].push(r); });
        Object.values(byProd2).forEach(pr => renderProductXl(pr, r => [text(r.prod_group_name || r.prod_group_code), text(r.brand_name || r.brand_code)]));
      });
    } else {
      const byProd2: Record<string, ReportRow[]> = {};
      prinRows.forEach(r => { const k = text(r.prod_code); if (!byProd2[k]) byProd2[k] = []; byProd2[k].push(r); });
      Object.values(byProd2).forEach(pr => renderProductXl(pr, () => []));
    }

    const ptRow = sheetData.length;
    addRow([...Array(extraColOffset + 6).fill(""), prinTotal, 0, prinTotal, 0, 0, 0],
      {
        ...Object.fromEntries(Array.from({ length: extraColOffset + 6 }, (_, i) => [i, styles.subtotal])),
        [extraColOffset + 6]:  styles.grandTotalLabel,
        [extraColOffset + 7]:  styles.grandTotal,
        [extraColOffset + 8]:  styles.grandTotal,
        [extraColOffset + 9]:  styles.grandTotal,
        [extraColOffset + 10]: styles.grandTotal,
        [extraColOffset + 11]: styles.grandTotal,
        [extraColOffset + 12]: styles.grandTotal,
      });
    if (extraColOffset + 6 > 0)
      merges.push({ s: { r: ptRow, c: 0 }, e: { r: ptRow, c: extraColOffset + 5 } });
  });

  // Grand total row
  const gtRow = sheetData.length;
  addRow([...Array(extraColOffset + 6).fill("Grand Total :"), grandTotal, 0, grandTotal, 0, 0, 0],
    Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) =>
      [i, i >= extraColOffset + 6 ? styles.grandTotal : styles.grandTotalLabel])));
  merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: extraColOffset + 5 } });

  addRow(["", ...Array(COL_COUNT - 2).fill(""), "Powered by Bayanat Technology"],
    { [COL_COUNT - 1]: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } } });

  // Build worksheet
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!merges"] = merges;
  ws["!cols"] = Array.from({ length: COL_COUNT }, (_, i) => {
    if (i < extraColOffset) return { wch: 14 };
    if (i === extraColOffset) return { wch: 10 };
    if (i === extraColOffset + 1) return { wch: 8 };
    if (i === extraColOffset + 2) return { wch: 10 };
    if (i === extraColOffset + 3) return { wch: 10 };
    if (i === extraColOffset + 4) return { wch: 10 };
    if (i === extraColOffset + 5) return { wch: 10 };
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

  // Build xlsx zip (same approach as trial balance reference)
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  let sheetXmlData = "";
  for (let r2 = range.s.r; r2 <= range.e.r; r2++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref  = XLSX.utils.encode_cell({ r: r2, c });
      const cell = ws[ref] as XLSX.CellObject | undefined;
      if (!cell) continue;
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c r="${ref}"><v>${value}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value ?? "")}</t></is></c>`);
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

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Stock Detail" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
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
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml",          Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                   Buffer.from(rels));
  zip.addFile("xl/workbook.xml",               Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels",    Buffer.from(workbookRels));
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