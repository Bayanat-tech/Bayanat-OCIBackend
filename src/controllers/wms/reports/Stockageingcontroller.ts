import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";
const AdmZip = require("adm-zip");

// ─── Types ────────────────────────────────────────────────────────────────────

type TMetric = "quantity" | "volume";
type TGroupBy = "product_group" | "product" | "principal";
type ReportRow = Record<string, any>;

interface AgeBuckets {
  b1: number; b2: number; b3: number; b4: number; b5: number; b6: number;
  total: number;
}

interface AgeingRow {
  prin_code:  string; prin_name:  string;
  group_code: string; group_name: string;
  prod_code:  string; prod_name:  string;
  l_uom:      string;
  qty: AgeBuckets;
  vol: AgeBuckets;
}

interface AgeingParams {
  prinCode: string[];
  deptCode: string[];
  prodCode: string[];
  age1: number; age2: number; age3: number; age4: number; age5: number;
  groupBy: TGroupBy;
}

const DEFAULT_AGES: [number, number, number, number, number] = [30, 60, 90, 120, 150];

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

// ─── Param Parser ─────────────────────────────────────────────────────────────

function parseAgeingParams(req: RequestWithUser): AgeingParams {
  const toArr = (val: any): string[] => {
    if (!val) return ["All"];
    if (Array.isArray(val)) return val.length ? val : ["All"];
    const s = text(val).trim();
    return s ? s.split(",").map((v) => v.trim()) : ["All"];
  };

  const toAge = (val: any, fallback: number): number => {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const prinCode = toArr(req.body.prin_code);
  const deptCode = toArr(req.body.dept_code);
  const prodCode = toArr(req.body.prod_code);

  const age1 = toAge(req.body.age1, DEFAULT_AGES[0]);
  const age2 = toAge(req.body.age2, DEFAULT_AGES[1]);
  const age3 = toAge(req.body.age3, DEFAULT_AGES[2]);
  const age4 = toAge(req.body.age4, DEFAULT_AGES[3]);
  const age5 = toAge(req.body.age5, DEFAULT_AGES[4]);

  const groupByRaw = text(req.body.group_by || "").trim().toLowerCase();
  const groupBy: TGroupBy = groupByRaw === "product" ? "product"
    : groupByRaw === "principal" ? "principal"
    : "product_group";

  return { prinCode, deptCode, prodCode, age1, age2, age3, age4, age5, groupBy };
}

function bucketLabels(p: AgeingParams): string[] {
  return [
    `Below ${p.age1}`,
    `${p.age1} - ${p.age2}`,
    `${p.age2} - ${p.age3}`,
    `${p.age3} - ${p.age4}`,
    `${p.age4} - ${p.age5}`,
    `Above ${p.age5}`,
  ];
}

// ─── Data Loader ──────────────────────────────────────────────────────────────

async function loadAgeingData(
  req: RequestWithUser,
): Promise<{ rows: AgeingRow[]; params: AgeingParams }> {
  const params = parseAgeingParams(req);
  const conn   = await getConn(req);

  try {
    const prinBinds = params.prinCode.includes("All") ? [] : params.prinCode.map((_, i) => `:prin${i}`);
const deptBinds = params.deptCode.includes("All") ? [] : params.deptCode.map((_, i) => `:dept${i}`);
const prodBinds = params.prodCode.includes("All") ? [] : params.prodCode.map((_, i) => `:prod${i}`);

const whereParts = [
  prinBinds.length ? `PRIN_CODE IN (${prinBinds.join(",")})` : "",
  deptBinds.length ? `DEPT_CODE IN (${deptBinds.join(",")})` : "",
  prodBinds.length ? `PROD_CODE IN (${prodBinds.join(",")})` : "",
].filter(Boolean);

const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const ageExpr = "(TRUNC(SYSDATE) - TRUNC(TXN_DATE))";
    const bucketCase = (col: string, alias: string) => `
        SUM(CASE WHEN ${ageExpr} < :age1 THEN ${col} ELSE 0 END) AS ${alias}_B1,
        SUM(CASE WHEN ${ageExpr} >= :age1 AND ${ageExpr} < :age2 THEN ${col} ELSE 0 END) AS ${alias}_B2,
        SUM(CASE WHEN ${ageExpr} >= :age2 AND ${ageExpr} < :age3 THEN ${col} ELSE 0 END) AS ${alias}_B3,
        SUM(CASE WHEN ${ageExpr} >= :age3 AND ${ageExpr} < :age4 THEN ${col} ELSE 0 END) AS ${alias}_B4,
        SUM(CASE WHEN ${ageExpr} >= :age4 AND ${ageExpr} < :age5 THEN ${col} ELSE 0 END) AS ${alias}_B5,
        SUM(CASE WHEN ${ageExpr} >= :age5 THEN ${col} ELSE 0 END) AS ${alias}_B6,
        SUM(${col}) AS ${alias}_TOTAL`;

    const sql = `
      SELECT
        PRIN_CODE, PRIN_NAME,
        GROUP_CODE, GROUP_NAME,
        PROD_CODE, PROD_NAME,
        L_UOM,
        ${bucketCase("STOCK", "QTY")},
        ${bucketCase("VOLUME", "VOL")}
      FROM VW_BOWM_STKLED_FOREXPAGEING
      ${whereSql}
      GROUP BY PRIN_CODE, PRIN_NAME, GROUP_CODE, GROUP_NAME, PROD_CODE, PROD_NAME, L_UOM
    `;

    const binds: Record<string, any> = {
      age1: params.age1, age2: params.age2, age3: params.age3,
      age4: params.age4, age5: params.age5,
    };
    if (!params.prinCode.includes("All")) params.prinCode.forEach((v, i) => { binds[`prin${i}`] = v; });
    if (!params.deptCode.includes("All")) params.deptCode.forEach((v, i) => { binds[`dept${i}`] = v; });
    if (!params.prodCode.includes("All")) params.prodCode.forEach((v, i) => { binds[`prod${i}`] = v; });

    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const raw    = normalize(result.rows as any[]);

    const rows: AgeingRow[] = raw.map((r) => ({
      prin_code:  text(r.prin_code),
      prin_name:  text(r.prin_name),
      group_code: text(r.group_code),
      group_name: text(r.group_name),
      prod_code:  text(r.prod_code),
      prod_name:  text(r.prod_name),
      l_uom:      text(r.l_uom),
      qty: {
        b1: num(r.qty_b1), b2: num(r.qty_b2), b3: num(r.qty_b3),
        b4: num(r.qty_b4), b5: num(r.qty_b5), b6: num(r.qty_b6),
        total: num(r.qty_total),
      },
      vol: {
        b1: num(r.vol_b1), b2: num(r.vol_b2), b3: num(r.vol_b3),
        b4: num(r.vol_b4), b5: num(r.vol_b5), b6: num(r.vol_b6),
        total: num(r.vol_total),
      },
    }));

    return { rows, params };
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping / Totals helpers ────────────────────────────────────────────────

function groupRowsBy(rows: AgeingRow[], keyFn: (r: AgeingRow) => string): Map<string, AgeingRow[]> {
  const map = new Map<string, AgeingRow[]>();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  });
  return map;
}

function emptyBuckets(): AgeBuckets {
  return { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0, total: 0 };
}

function sumBuckets(rows: AgeingRow[], metric: TMetric): AgeBuckets {
  const acc = emptyBuckets();
  rows.forEach((r) => {
    const b = metric === "quantity" ? r.qty : r.vol;
    acc.b1 += b.b1; acc.b2 += b.b2; acc.b3 += b.b3;
    acc.b4 += b.b4; acc.b5 += b.b5; acc.b6 += b.b6;
    acc.total += b.total;
  });
  return acc;
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────

const COL_COUNT = 8; // Product + 6 buckets + Total

function renderAgeingHtml(
  rows: AgeingRow[], params: AgeingParams, metric: TMetric,
  loginId: string, reportTitle: string,
): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const labels = bucketLabels(params);

  const bucketCells = (b: AgeBuckets): string => `
    <td class="num">${fmtNumber(b.b1)}</td>
    <td class="num">${fmtNumber(b.b2)}</td>
    <td class="num">${fmtNumber(b.b3)}</td>
    <td class="num">${fmtNumber(b.b4)}</td>
    <td class="num">${fmtNumber(b.b5)}</td>
    <td class="num">${fmtNumber(b.b6)}</td>
    <td class="num total-col">${fmtNumber(b.total)}</td>`;

  const renderProductRows = (rowsForProd: AgeingRow[]): string => {
    let html = "";
    const byProd = groupRowsBy(rowsForProd, (r) => r.prod_code);
    byProd.forEach((prodRows, prodCode) => {
      const prodName = text(prodRows[0]?.prod_name);

      prodRows.forEach((r) => {
        const b = metric === "quantity" ? r.qty : r.vol;
        html += `
          <tr class="data-row">
            <td>${escapeHtml(r.prod_code)} | ${escapeHtml(r.prod_name)}</td>
            ${bucketCells(b)}
          </tr>`;
      });

      if (prodRows.length > 1) {
        const prodTotal = sumBuckets(prodRows, metric);
        html += `
          <tr class="product-total-row">
            <td class="subtotal-label">Total For ${escapeHtml(prodCode)} | ${escapeHtml(prodName)} :</td>
            ${bucketCells(prodTotal)}
          </tr>`;
      }
    });
    return html;
  };

  const renderPrincipalSummaryRow = (prinRows: AgeingRow[], prinCode: string): string => {
    const prinName = text(prinRows[0]?.prin_name);
    const prinTotal = sumBuckets(prinRows, metric);
    return `
      <tr class="principal-total-row">
        <td class="principal-label">${escapeHtml(prinCode)} | ${escapeHtml(prinName)}</td>
        ${bucketCells(prinTotal)}
      </tr>`;
  };

  const byPrin = groupRowsBy(rows, (r) => r.prin_code);
  let bodyHtml = "";

  byPrin.forEach((prinRows, prinCode) => {
    const prinName = text(prinRows[0]?.prin_name);
    if (params.groupBy !== "principal") {
      bodyHtml += `
      <tr class="principal-header">
        <td colspan="${COL_COUNT}">${escapeHtml(prinCode)} &nbsp;|&nbsp; ${escapeHtml(prinName)}</td>
      </tr>`;
    }

    if (params.groupBy === "principal") {
      bodyHtml += renderPrincipalSummaryRow(prinRows, prinCode);
    } else if (params.groupBy === "product") {
      bodyHtml += renderProductRows(prinRows);
    } else {
      const byGroup = groupRowsBy(prinRows, (r) => r.group_code);
      byGroup.forEach((grpRows, grpCode) => {
        const grpName = text(grpRows[0]?.group_name);
        bodyHtml += `
          <tr class="group-header">
            <td colspan="${COL_COUNT}">${escapeHtml(grpCode)} &nbsp;|&nbsp; ${escapeHtml(grpName)}</td>
          </tr>`;

        bodyHtml += renderProductRows(grpRows);

        const grpTotal = sumBuckets(grpRows, metric);
        bodyHtml += `
          <tr class="group-total-row">
            <td class="subtotal-label">Total For ${escapeHtml(grpCode)} | ${escapeHtml(grpName)} :</td>
            ${bucketCells(grpTotal)}
          </tr>`;
      });
    }

    if (params.groupBy !== "principal") {
      const prinTotal = sumBuckets(prinRows, metric);
      bodyHtml += `
        <tr class="principal-total-row">
          <td class="subtotal-label">Total For ${escapeHtml(prinName)} :</td>
          ${bucketCells(prinTotal)}
        </tr>`;
    }
  });

  const grandTotal = sumBuckets(rows, metric);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    /* ── Base layout ───────────────────────────────────────────────────── */
    * { box-sizing: border-box; }
    html, body {
      margin: 0; font-family: Arial, sans-serif; font-size: 9px; color: #000;
      background: #eef2f7;
    }
    .sheet { width: 100%; margin: 0 auto; background: #fff; padding: 10px 12px; }

    .report-title {
      text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 3px;
      margin-bottom: 5px; color: #fff;
      background-color: #1d4ed8;
      /* box-shadow keeps the fill in print even when background-color is stripped */
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      padding: 6px 0;
    }
    .report-meta {
      display: flex; justify-content: space-between; font-size: 9px;
      margin-bottom: 8px; color: #333;
    }

    /* ── Table base ────────────────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; font-size: 9px; }
    th {
      background-color: #1d4ed8;
      border: 1px solid #1e3a8a; padding: 5px 4px;
      text-align: center; font-weight: 700; color: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    th.total-col-hdr {
      background-color: #0f3460;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    td { border: 1px solid #cbd5e1; padding: 3px 5px; vertical-align: top; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.total-col { font-weight: 700; background-color: #eff6ff; }
    td.subtotal-label { text-align: right; font-weight: 700; padding-right: 8px; }
    td.principal-label { text-align: left; font-weight: 700; padding-right: 8px; }


    /* ── Row types ─────────────────────────────────────────────────────── */
    tr.principal-header td {
      background-color: #1d4ed8;
      color: #fff;
      font-weight: 700;
      border: 1px solid #1d4ed8;
      padding: 4px 6px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tr.group-header td {
      background-color: #dbeafe;
      font-weight: 700;
      border: 1px solid #93c5fd;
      padding: 3px 6px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tr.data-row td { background-color: #fff; }
    tr.product-total-row td {
      background-color: #e0f2fe;
      font-weight: 700;
      border-top: 1px solid #7dd3fc;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tr.group-total-row td {
      background-color: #fffde7;
      font-weight: 700;
      border-top: 1px solid #999;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tr.principal-total-row td {
      background-color: #bfdbfe;
      font-weight: 700;
      border-top: 2px solid #1d4ed8;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tr.grand-total-row td {
      background-color: #1d4ed8;
      color: #fff;
      font-weight: 700;
      font-size: 9.5px;
      border: 2px solid #1e3a8a;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .filter-criteria {
      font-size: 8px; font-style: italic; color: #555; margin-top: 8px;
    }
    .report-footer {
      display: flex; justify-content: space-between; font-size: 8px; color: #666;
      margin-top: 6px; border-top: 1px solid #ccc; padding-top: 3px;
    }

    /* ── Print overrides ───────────────────────────────────────────────────
       Three-layer defence against browsers stripping backgrounds in print:
       1. -webkit-print-color-adjust / print-color-adjust: exact  (set above
          on every coloured element individually — most reliable approach)
       2. The @media print block forces it globally as a last resort.
       3. box-shadow: inset 0 0 0 1000px repaint — treated as a foreground
          paint op so it survives even the most aggressive stripping.
          White-text rows also get an explicit color:#fff here.
    ─────────────────────────────────────────────────────────────────── */
    @media print {
      @page { size: A4 landscape; margin: 8mm; }

      /* Global force — some Chromium versions need this at the page level */
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }

      html, body { background: white; font-size: 10px; }
      .sheet { padding: 0; }
      .actions { display: none !important; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }

      /* ── Dark-blue rows — repaint via box-shadow + keep text white ── */
      .report-title {
        background-color: #1d4ed8 !important;
        box-shadow: inset 0 0 0 1000px #1d4ed8 !important;
        color: #fff !important;
      }
      th {
        background-color: #1d4ed8 !important;
        box-shadow: inset 0 0 0 1000px #1d4ed8 !important;
        color: #fff !important;
      }
      th.total-col-hdr {
        background-color: #0f3460 !important;
        box-shadow: inset 0 0 0 1000px #0f3460 !important;
        color: #fff !important;
      }
      tr.principal-header td {
        background-color: #1d4ed8 !important;
        box-shadow: inset 0 0 0 1000px #1d4ed8 !important;
        color: #fff !important;
      }
      tr.grand-total-row td {
        background-color: #1d4ed8 !important;
        box-shadow: inset 0 0 0 1000px #1d4ed8 !important;
        color: #fff !important;
      }

      /* ── Light-colour rows — repaint via box-shadow ── */
      tr.group-header td {
        background-color: #dbeafe !important;
        box-shadow: inset 0 0 0 1000px #dbeafe !important;
      }
      tr.product-total-row td {
        background-color: #e0f2fe !important;
        box-shadow: inset 0 0 0 1000px #e0f2fe !important;
      }
      tr.group-total-row td {
        background-color: #fffde7 !important;
        box-shadow: inset 0 0 0 1000px #fffde7 !important;
      }
      tr.principal-total-row td {
        background-color: #bfdbfe !important;
        box-shadow: inset 0 0 0 1000px #bfdbfe !important;
      }
      td.total-col {
        background-color: #eff6ff !important;
        box-shadow: inset 0 0 0 1000px #eff6ff !important;
      }
    }
  </style>
</head>
<body>
<main class="sheet">
  <div class="report-title">${escapeHtml(reportTitle)}</div>
  <div class="report-meta">
    <span>Print Date : ${printDateTime}</span>
    <span>Print User : ${escapeHtml(loginId)}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(params.groupBy === "principal" ? "Principal" : "Product")}</th>
        ${labels.map((l) => `<th>${escapeHtml(l)}</th>`).join("")}
        <th class="total-col-hdr">Total</th>
      </tr>
    </thead>
    <tbody>
      ${bodyHtml || `<tr><td colspan="${COL_COUNT}" style="text-align:center;color:#666;padding:20px">No data found</td></tr>`}
    </tbody>
    <tfoot>
      <tr class="grand-total-row">
        <td class="subtotal-label">Grand Total :</td>
        ${bucketCells(grandTotal)}
      </tr>
    </tfoot>
  </table>
  <div class="filter-criteria">
    Filter Criteria : Principal Code: [${params.prinCode.join(", ")}], Department Code: [${params.deptCode.join(", ")}], Product Code: [${params.prodCode.join(", ")}], Ages: [Age1=${params.age1}, Age2=${params.age2}, Age3=${params.age3}, Age4=${params.age4}, Age5=${params.age5}], Group By: [${params.groupBy === "product" ? "Product" : params.groupBy === "principal" ? "Principal" : "Product Group → Product"}]
  </div>
  <div class="report-footer">
    <span>Report: rpt_stock_ageing_${metric}</span>
    <span>Powered by Bayanat Technology</span>
  </div>
</main>
</body>
</html>`;
}

// ─── Excel Builder ────────────────────────────────────────────────────────────

function buildAgeingExcelBuffer(
  rows: AgeingRow[], params: AgeingParams, metric: TMetric,
  loginId: string, reportTitle: string,
): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const labels = bucketLabels(params);

  const BLUE = "FF1D4ED8", DARKBLUE = "FF0F3460", WHITE = "FFFFFFFF";
  const LBLUE = "FFDBEAFE", YELLOW = "FFFFFDE7", SITEBLUE = "FFBFDBFE", INDIGO = "FFEFF6FF";
  const PRODBLUE = "FFE0F2FE", PRODBLUE_BORDER = "FF7DD3FC";

  const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });

  const styles = {
    title:  { font: { bold: true, sz: 14, color: { rgb: WHITE } }, fill: { fgColor: { rgb: BLUE } }, alignment: { horizontal: "center", vertical: "center" } },
    meta:   { font: { sz: 9, color: { rgb: "FF333333" } } },
    header: {
      font: { bold: true, sz: 9, color: { rgb: WHITE } }, fill: { fgColor: { rgb: BLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: { top: borderThin(BLUE), bottom: borderThin(BLUE), left: borderThin(BLUE), right: borderThin(BLUE) },
    },
    headerTotal: {
      font: { bold: true, sz: 9, color: { rgb: WHITE } }, fill: { fgColor: { rgb: DARKBLUE } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: { top: borderThin(DARKBLUE), bottom: borderThin(DARKBLUE), left: borderThin(DARKBLUE), right: borderThin(DARKBLUE) },
    },
    principal: { font: { bold: true, sz: 9, color: { rgb: WHITE } }, fill: { fgColor: { rgb: BLUE } } },
    group:     { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: LBLUE } } },
    data:      { font: { sz: 9 }, border: { bottom: borderThin("FFE2E8F0") } },
    dataNum:   { font: { sz: 9 }, alignment: { horizontal: "right" }, numFmt: "#,##0", border: { bottom: borderThin("FFE2E8F0") } },
    dataTotal: { font: { bold: true, sz: 9, color: { rgb: "FF1E3A8A" } }, fill: { fgColor: { rgb: INDIGO } }, alignment: { horizontal: "right" }, numFmt: "#,##0", border: { bottom: borderThin("FFE2E8F0") } },
    productTotalLabel: { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: PRODBLUE } }, border: { top: borderThin(PRODBLUE_BORDER) } },
    productTotalNum:   { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: PRODBLUE } }, alignment: { horizontal: "right" }, numFmt: "#,##0", border: { top: borderThin(PRODBLUE_BORDER) } },
    groupTotalLabel: { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: YELLOW } }, border: { top: borderThin("FF999999") } },
    groupTotalNum:   { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: YELLOW } }, alignment: { horizontal: "right" }, numFmt: "#,##0", border: { top: borderThin("FF999999") } },
    prinTotalLabel:  { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: SITEBLUE } }, border: { top: borderThin(BLUE) } },
    prinTotalNum:    { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: SITEBLUE } }, alignment: { horizontal: "right" }, numFmt: "#,##0", border: { top: borderThin(BLUE) } },
    grandLabel: { font: { bold: true, sz: 10, color: { rgb: WHITE } }, fill: { fgColor: { rgb: BLUE } } },
    grandNum:   { font: { bold: true, sz: 10, color: { rgb: WHITE } }, fill: { fgColor: { rgb: BLUE } }, alignment: { horizontal: "right" }, numFmt: "#,##0" },
    footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } },
  };

  const sheetData: any[][] = [];
  const merges: XLSX.Range[] = [];
  const rowStyles: Array<Record<number, any>> = [];

  const addRow = (cells: any[], styleMap: Record<number, any>) => {
    sheetData.push(cells);
    rowStyles.push(styleMap);
  };
  const allStyle = (style: any) =>
    Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, style]));

  // Title
  const titleR = sheetData.length;
  addRow([reportTitle, ...Array(COL_COUNT - 1).fill("")], allStyle(styles.title));
  merges.push({ s: { r: titleR, c: 0 }, e: { r: titleR, c: COL_COUNT - 1 } });

  // Meta
  const metaR = sheetData.length;
  addRow([`Print Date: ${printDateTime}`, "", "", `Print User: ${loginId}`, "", "", "", ""], { 0: styles.meta, 3: styles.meta });
  merges.push({ s: { r: metaR, c: 0 }, e: { r: metaR, c: 2 } });
  merges.push({ s: { r: metaR, c: 3 }, e: { r: metaR, c: COL_COUNT - 1 } });

  addRow(Array(COL_COUNT).fill(""), {});

  // Header
  const hRow = sheetData.length;
  const hCells = [params.groupBy === "principal" ? "Principal" : "Product", ...labels, "Total"];
  const hStyles: Record<number, any> = {};
  hCells.forEach((_, i) => { hStyles[i] = i === COL_COUNT - 1 ? styles.headerTotal : styles.header; });
  addRow(hCells, hStyles);

  const bucketVals = (b: AgeBuckets) => [b.b1, b.b2, b.b3, b.b4, b.b5, b.b6, b.total];

  const addTotalRow = (label: string, b: AgeBuckets, labelStyle: any, numStyle: any) => {
    const cells = [label, ...bucketVals(b)];
    const styleMap: Record<number, any> = { 0: labelStyle };
    for (let i = 1; i < COL_COUNT; i++) styleMap[i] = numStyle;
    addRow(cells, styleMap);
  };

  const addSectionRow = (label: string, style: any) => {
    const r = sheetData.length;
    addRow([label, ...Array(COL_COUNT - 1).fill("")], allStyle(style));
    merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 1 } });
  };

  const addProductRows = (rowsForProd: AgeingRow[]) => {
    const byProd = groupRowsBy(rowsForProd, (r) => r.prod_code);
    byProd.forEach((prodRows, prodCode) => {
      const prodName = text(prodRows[0]?.prod_name);

      prodRows.forEach((r) => {
        const b = metric === "quantity" ? r.qty : r.vol;
        const cells = [`${r.prod_code} | ${r.prod_name}`, ...bucketVals(b)];
        const styleMap: Record<number, any> = { 0: styles.data };
        for (let i = 1; i < COL_COUNT - 1; i++) styleMap[i] = styles.dataNum;
        styleMap[COL_COUNT - 1] = styles.dataTotal;
        addRow(cells, styleMap);
      });

      if (prodRows.length > 1) {
        addTotalRow(`Total For ${prodCode} | ${prodName} :`, sumBuckets(prodRows, metric), styles.productTotalLabel, styles.productTotalNum);
      }
    });
  };

  const byPrin = groupRowsBy(rows, (r) => r.prin_code);
  byPrin.forEach((prinRows, prinCode) => {
    const prinName = text(prinRows[0]?.prin_name);
    addSectionRow(`${prinCode} | ${prinName}`, styles.principal);

    if (params.groupBy === "product") {
      addProductRows(prinRows);
    } else {
      const byGroup = groupRowsBy(prinRows, (r) => r.group_code);
      byGroup.forEach((grpRows, grpCode) => {
        const grpName = text(grpRows[0]?.group_name);
        addSectionRow(`${grpCode} | ${grpName}`, styles.group);
        addProductRows(grpRows);
        addTotalRow(`Total For ${grpCode} | ${grpName} :`, sumBuckets(grpRows, metric), styles.groupTotalLabel, styles.groupTotalNum);
      });
    }

    addTotalRow(`Total For ${prinName} :`, sumBuckets(prinRows, metric), styles.prinTotalLabel, styles.prinTotalNum);
  });

  addTotalRow("Grand Total :", sumBuckets(rows, metric), styles.grandLabel, styles.grandNum);
  addRow(["", "", "", "", "", "", "", "Powered by Bayanat Technology"], { [COL_COUNT - 1]: styles.footer });

  // Worksheet
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 40 },
    ...Array.from({ length: 6 }, () => ({ wch: 13 })),
    { wch: 14 },
  ];
  ws["!rows"] = sheetData.map((_, i) => ({ hpt: i === 0 ? 24 : i <= 3 ? 18 : 14 }));

  // ── Style engine ─────────────────────────────────────────────────────────
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
    const def: BorderDef = { top: b.top?.color?.rgb, bottom: b.bottom?.color?.rgb, left: b.left?.color?.rgb, right: b.right?.color?.rgb };
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
    const fontId = registerFont(styleObj.font), fillId = registerFill(styleObj.fill);
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
      const ref = XLSX.utils.encode_cell({ r: r2, c });
      const cell = ws[ref] as XLSX.CellObject | undefined;
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

  const mergesXml = merges.map((m) => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`).join("");
  const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";
  const colsXml = (ws["!cols"] || []).map((col: any, i: number) =>
    `<col min="${i + 1}" max="${i + 1}" width="${col.wch || 10}" customWidth="1"/>`).join("");

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
      ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="9"/>'}
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
    <fill><patternFill patternType="solid"><fgColor rgb="${f.color}"/><bgColor rgb="${f.color}"/></patternFill></fill>`).join("")}
  </fills>`;
  const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
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
  ${numFmtsXml}${fontsXml}${fillsXml}${bordersXml}
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  ${cellXfsXml}
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Stock Ageing" sheetId="1" r:id="rId1"/></sheets>
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
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  return zip.toBuffer();
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleHtml(req: RequestWithUser, res: Response, metric: TMetric, reportTitle: string) {
  try {
    const { rows, params } = await loadAgeingData(req);
    const html = renderAgeingHtml(rows, params, metric, req.user?.loginid ?? "", reportTitle);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error(`Stock Ageing (${metric}) HTML error:`, error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
}

async function handleExcel(req: RequestWithUser, res: Response, metric: TMetric, reportTitle: string, fileSlug: string) {
  try {
    const { rows, params } = await loadAgeingData(req);
    const buffer = buildAgeingExcelBuffer(rows, params, metric, req.user?.loginid ?? "", reportTitle);
    const filename = `${fileSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error(`Stock Ageing (${metric}) Excel error:`, error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to export report" });
  }
}

export const getStockAgeingQuantityReportHtml = (req: RequestWithUser, res: Response) =>
  handleHtml(req, res, "quantity", "Stock Ageing Detail (Quantity) Report");

export const exportStockAgeingQuantityReportExcel = (req: RequestWithUser, res: Response) =>
  handleExcel(req, res, "quantity", "Stock Ageing Detail (Quantity) Report", "stock_ageing_quantity_report");

export const getStockAgeingVolumeReportHtml = (req: RequestWithUser, res: Response) =>
  handleHtml(req, res, "volume", "Stock Ageing Detail (Volume) Report");

export const exportStockAgeingVolumeReportExcel = (req: RequestWithUser, res: Response) =>
  handleExcel(req, res, "volume", "Stock Ageing Detail (Volume) Report", "stock_ageing_volume_report");