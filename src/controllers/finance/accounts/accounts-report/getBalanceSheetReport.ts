import { Request, Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";

// Note: no XLSX import needed — Excel output is built as raw OOXML via AdmZip

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface LineItem {
  bl_code:  string;
  bl_name:  string;
  amount:   number;
}

interface HeadingGroup {
  h_code:  string;
  h_name:  string;
  total:   number;
  items:   LineItem[];
}

interface BalanceSheetSections {
  nonCurrentAssets:       HeadingGroup[];
  currentAssets:          HeadingGroup[];
  nonCurrentLiabilities:  HeadingGroup[];
  currentLiabilities:     HeadingGroup[];
  ownersEquity:           HeadingGroup[];
}

interface BalanceSheetTotals {
  totalNonCurrentAssets:      number;
  totalCurrentAssets:         number;
  totalAssets:                number;
  totalNonCurrentLiabilities: number;
  totalCurrentLiabilities:    number;
  totalLiabilities:           number;
  netAssets:                  number;
  totalOwnersEquity:          number;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: Request): Promise<oracledb.Connection> {
  const r = req as RequestWithUser;
  let tenantId = getCurrentTenantId();
  if (!tenantId && r.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(r.user.loginid);
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

function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

function dateText(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&apos;");
}

function escapeJs(value: unknown): string {
  return JSON.stringify(text(value));
}

// ─── Request Param Parser ─────────────────────────────────────────────────────

function parseParams(req: Request) {
  const r            = req as RequestWithUser;
  const companyCode  = text(req.body.company_code  || r.user?.company_code);
  const divisionCode = text(req.body.division_code || "All");
  const asOnDate     = text(req.body.as_on_date);
  const loginid      = text(req.body.loginid        || r.user?.loginid || "ADMIN");

  if (!companyCode || !asOnDate)
    throw Object.assign(
      new Error("company_code and as_on_date are required"),
      { status: 400 },
    );

  return { companyCode, divisionCode, asOnDate, loginid };
}

// ─── Data Loader ──────────────────────────────────────────────────────────────

async function loadRows(req: Request): Promise<{ rows: ReportRow[]; params: ReturnType<typeof parseParams> }> {
  const params = parseParams(req);
  const { companyCode, divisionCode, asOnDate } = params;

  // Division filter — interpolated as a literal string so Oracle's short-circuit
  // works reliably. 'All' = 'All' is always true (no division filter applied).
  // Bind parameters don't short-circuit consistently in Oracle for this pattern.
  const divLiteral     = divisionCode.replace(/'/g, "''"); // escape any rogue quotes
  const divFilter      = `('All' = '${divLiteral}' OR TR_AC_DETAIL.div_code = '${divLiteral}')`;
  const divFilterAlias = `('All' = '${divLiteral}' OR d.div_code = '${divLiteral}')`;


  

  const sql = `
    SELECT
      MS_AC_BLSETUP.BL_CODE,
      MS_AC_BLSETUP.BL_NAME,
      MS_AC_BLSETUP.h_code,
      (SELECT bl_name
       FROM   WMSTST.ms_ac_blsetup m
       WHERE  m.company_code = MS_AC_BLSETUP.company_code
         AND  m.bl_code      = MS_AC_BLSETUP.h_code) h_name,
      MS_AC_BLSETUP.BL_TYPE,
      ROUND(SUM(lcur_amount * sign_ind), 3)
        * (CASE SUBSTR(MS_AC_BLSETUP.BL_CODE, 1, 2)
             WHEN '55' THEN  1
             WHEN '51' THEN  1
             ELSE            -1
           END) lcur_amount,
      TR_AC_DETAIL.div_code
    FROM  WMSTST.MS_AC_BLSETUP
        , WMSTST.MS_ACCODES
        , WMSTST.TR_AC_DETAIL
    WHERE MS_AC_BLSETUP.company_code = MS_ACCODES.company_code
      AND MS_AC_BLSETUP.BL_CODE      = MS_ACCODES.PL_BL_CODE
      AND TR_AC_DETAIL.company_code  = MS_ACCODES.company_code
      AND TR_AC_DETAIL.ac_code       = MS_ACCODES.ac_code
      AND MS_AC_BLSETUP.BL_TYPE     <> 'H'
      AND MS_AC_BLSETUP.company_code = :companyCode
      AND TR_AC_DETAIL.CANCELLED    <> 'Y'
      AND TR_AC_DETAIL.doc_date      < TO_DATE(:asOnDate, 'YYYY-MM-DD')
      AND ${divFilter}
    GROUP BY
      TR_AC_DETAIL.div_code,
      MS_AC_BLSETUP.company_code,
      MS_AC_BLSETUP.BL_CODE,
      MS_AC_BLSETUP.BL_NAME,
      MS_AC_BLSETUP.BL_TYPE,
      MS_AC_BLSETUP.h_code

    UNION ALL

    SELECT
      MS_AC_BLSETUP.BL_CODE,
      MS_AC_BLSETUP.BL_NAME,
      MS_AC_BLSETUP.h_code,
      CAST(NULL AS VARCHAR2(200))  h_name,
      MS_AC_BLSETUP.BL_TYPE,
      (SELECT ROUND(SUM(lcur_amount * sign_ind), 3) * -1
       FROM   WMSTST.TR_AC_DETAIL d
       WHERE  SUBSTR(d.ac_code, 1, 1) IN ('4', '5')
         AND  d.company_code = MS_AC_BLSETUP.company_code
         AND  d.CANCELLED   <> 'Y'
         AND  d.doc_date     < TO_DATE(:asOnDate, 'YYYY-MM-DD')
         AND  ${divFilterAlias}) lcur_amount,
      CAST(NULL AS VARCHAR2(20))   div_code
    FROM  WMSTST.MS_AC_BLSETUP
    WHERE bl_code      = '75005'
      AND company_code = :companyCode

    ORDER BY BL_CODE
  `;

  const binds = {
    companyCode,
    asOnDate,
    // divisionCode is interpolated as a literal in the SQL, not a bind parameter
  };

  console.log("Balance Sheet SQL binds:", binds);

  const conn = await getConn(req);
  try {
    const dataResult = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    const rows = normalize(dataResult.rows as any[]);
    console.log("BS rows count:", rows.length);
    console.log("BS sample row:", JSON.stringify(rows[0], null, 2));
    console.log("BS distinct h_codes:", [...new Set(rows.map(r => r.h_code))]);
    return { rows, params };
  } finally {
    await closeConn(conn);
  }
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

function aggregateRows(rows: ReportRow[]): { sections: BalanceSheetSections; totals: BalanceSheetTotals } {
  const headingMap = new Map<string, HeadingGroup>();

  for (const r of rows) {
    const hKey = `${r.h_code}||${r.h_name}`;
    const amt  = amount(r.lcur_amount);

    if (!headingMap.has(hKey)) {
      headingMap.set(hKey, {
        h_code: text(r.h_code),
        h_name: text(r.h_name),
        total:  0,
        items:  [],
      });
    }

    const heading  = headingMap.get(hKey)!;
    heading.total += amt;

    const lineKey = `${r.bl_code}||${r.bl_name}`;
    let   item    = heading.items.find((i) => `${i.bl_code}||${i.bl_name}` === lineKey);
    if (!item) {
      item = { bl_code: text(r.bl_code), bl_name: text(r.bl_name), amount: 0 };
      heading.items.push(item);
    }
    item.amount += amt;
  }

  const allHeadings = Array.from(headingMap.values());

  const nonCurrentAssets       = allHeadings.filter((h) => h.h_code.startsWith("11"));
  const currentAssets          = allHeadings.filter((h) => h.h_code.startsWith("12"));
  const nonCurrentLiabilities  = allHeadings.filter((h) => h.h_code.startsWith("21"));
  const currentLiabilities     = allHeadings.filter((h) => h.h_code.startsWith("22"));
  const ownersEquity           = allHeadings.filter((h) => h.h_code.startsWith("3"));

  // Fallback classification for unmatched H_CODEs
  const classified = new Set([
    ...nonCurrentAssets, ...currentAssets,
    ...nonCurrentLiabilities, ...currentLiabilities, ...ownersEquity,
  ]);
  for (const h of allHeadings) {
    if (classified.has(h)) continue;
    const d = h.h_code.charAt(0);
    if      (d === "1") currentAssets.push(h);
    else if (d === "2") currentLiabilities.push(h);
    else                ownersEquity.push(h);
  }

  const sum = (arr: HeadingGroup[]) => arr.reduce((s, h) => s + h.total, 0);

  const totalNonCurrentAssets      = sum(nonCurrentAssets);
  const totalCurrentAssets         = sum(currentAssets);
  const totalAssets                = totalNonCurrentAssets + totalCurrentAssets;
  const totalNonCurrentLiabilities = sum(nonCurrentLiabilities);
  const totalCurrentLiabilities    = sum(currentLiabilities);
  const totalLiabilities           = totalNonCurrentLiabilities + totalCurrentLiabilities;
  const netAssets                  = totalAssets - totalLiabilities;
  const totalOwnersEquity          = sum(ownersEquity);

  return {
    sections: { nonCurrentAssets, currentAssets, nonCurrentLiabilities, currentLiabilities, ownersEquity },
    totals:   {
      totalNonCurrentAssets, totalCurrentAssets, totalAssets,
      totalNonCurrentLiabilities, totalCurrentLiabilities, totalLiabilities,
      netAssets, totalOwnersEquity,
    },
  };
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderHtml(
  sections:    BalanceSheetSections,
  totals:      BalanceSheetTotals,
  params:      { companyCode: string; divisionCode: string; asOnDate: string; loginid: string },
): string {
  const { nonCurrentAssets, currentAssets, nonCurrentLiabilities, currentLiabilities, ownersEquity } = sections;
  const {
    totalNonCurrentAssets, totalCurrentAssets, totalAssets,
    totalNonCurrentLiabilities, totalCurrentLiabilities, totalLiabilities,
    netAssets, totalOwnersEquity,
  } = totals;

  const asOnDisplay    = dateText(params.asOnDate);
  const divisionLabel  = (params.divisionCode && params.divisionCode !== "All")
    ? ` (Division: ${escapeHtml(params.divisionCode)})`
    : "";
  const reportTitle    = `Balance Sheet as on ${asOnDisplay}${divisionLabel}`;
  const printDateTime  = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const renderLineItems = (heading: HeadingGroup): string =>
    heading.items.map((item) => `
      <tr class="data-row" data-code="${escapeHtml(item.bl_code)}">
        <td>${escapeHtml(item.bl_name)}</td>
        <td class="num">${escapeHtml(fmtNumber(item.amount))}</td>
      </tr>`).join("");

  const renderHeadingGroup = (heading: HeadingGroup): string => `
    <tr class="sub-group-header">
      <td><strong>${escapeHtml(heading.h_name)}</strong></td>
      <td></td>
    </tr>
    ${renderLineItems(heading)}`;

  const renderSection = (title: string, sectionHeadings: HeadingGroup[], total: number): string => `
    <tr class="section-header">
      <td colspan="2"><strong>${escapeHtml(title)}</strong></td>
    </tr>
    ${sectionHeadings.length === 0
      ? `<tr class="data-row"><td colspan="2" style="padding-left:28px;color:#9ca3af;font-style:italic;">No entries</td></tr>`
      : sectionHeadings.map(renderHeadingGroup).join("")
    }
    <tr class="total-row">
      <td><strong>TOTAL ${escapeHtml(title.toUpperCase())}</strong></td>
      <td class="num"><strong>${escapeHtml(fmtNumber(total))}</strong></td>
    </tr>`;

  const bodyHtml = `
    ${renderSection("Non Current Assets",      nonCurrentAssets,      totalNonCurrentAssets)}
    ${renderSection("Current Assets",          currentAssets,         totalCurrentAssets)}
    <tr class="grand-total-row">
      <td><strong>TOTAL ASSETS</strong></td>
      <td class="num"><strong>${escapeHtml(fmtNumber(totalAssets))}</strong></td>
    </tr>
    ${renderSection("Non Current Liabilities", nonCurrentLiabilities, totalNonCurrentLiabilities)}
    ${renderSection("Current Liabilities",     currentLiabilities,    totalCurrentLiabilities)}
    <tr class="grand-total-row">
      <td><strong>TOTAL LIABILITIES</strong></td>
      <td class="num"><strong>${escapeHtml(fmtNumber(totalLiabilities))}</strong></td>
    </tr>
    <tr class="net-assets-row">
      <td><strong>NET ASSETS</strong></td>
      <td class="num"><strong>${escapeHtml(fmtNumber(netAssets))}</strong></td>
    </tr>
    ${renderSection("Owners Equity",           ownersEquity,          totalOwnersEquity)}
    <tr class="grand-total-row">
      <td><strong>TOTAL OWNERS EQUITY</strong></td>
      <td class="num"><strong>${escapeHtml(fmtNumber(totalOwnersEquity))}</strong></td>
    </tr>`;

  const drillScript = `
  <script>
    (function () {
      var COMPANY_CODE  = ${escapeJs(params.companyCode)};
      var AS_ON_DATE    = ${escapeJs(params.asOnDate)};
      var DIVISION_CODE = ${escapeJs(params.divisionCode)};

      document.querySelectorAll("tbody tr[data-code]").forEach(function (tr) {
        tr.addEventListener("mouseenter", function () { tr.style.background = "#f0f9f5"; });
        tr.addEventListener("mouseleave", function () { tr.style.background = ""; });
        tr.addEventListener("click", function () {
          var code = tr.getAttribute("data-code");
          window.parent.postMessage({
            type:          "DRILL_DOWN",
            drillLevel:    "ac",
            company_code:  COMPANY_CODE,
            as_on_date:    AS_ON_DATE,
            division_code: DIVISION_CODE,
            code:          code,
            codeField:     "bl_code",
          }, "*");
        });
      });
    })();
  </script>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #000;
      background: #eef2f7;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #fff;
      padding: 8mm;
      border: 1px solid #aab7c8;
    }
    .logo-area { margin-bottom: 16px; }
    .divider-thick { border-top: 2px solid #000; margin: 10px 0 6px; }
    .divider-thin  { border-top: 1px solid #000; margin: 6px 0 10px; }
    .meta-row { display: flex; align-items: baseline; font-size: 12px; margin-bottom: 3px; }
    .meta-label { font-weight: 700; width: 60px; flex-shrink: 0; }
    .drill-hint {
      font-size: 10px; color: #1a5f4a; background: #f0f9f5;
      border: 1px solid #a7d7c5; border-radius: 4px;
      padding: 4px 10px; margin-bottom: 8px;
      display: inline-flex; align-items: center; gap: 6px;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th {
      border: 1px solid #000;
      padding: 3px 8px;
      text-align: left;
      font-weight: 700;
      background: #fff;
    }
    th.right { text-align: right; }
    td { border: 1px solid #ccc; padding: 2px 8px; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.section-header td {
      background: #1a5f4a;
      color: #fff;
      font-weight: 700;
      padding: 5px 8px;
      border: none;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    tr.sub-group-header td {
      background: #f0f9f5;
      font-weight: 700;
      color: #1a5f4a;
      border-bottom: 1px solid #a7d7c5;
      padding-left: 14px;
      text-decoration: underline;
    }
    tbody tr[data-code] { cursor: pointer; }
    tr.data-row td { padding-left: 28px; }
    tr.total-row td {
      font-weight: 700;
      border-top: 1px solid #64748b;
      border-bottom: 2px solid #334155;
      background: #f8fafc;
    }
    tr.grand-total-row td {
      border-top: 2px solid #334155;
      border-bottom: 2px solid #334155;
      font-size: 12px;
      background: #dbeafe;
      color: #1e3a8a;
      font-weight: 800;
      padding: 5px 8px;
    }
    tr.net-assets-row td {
      font-size: 12px;
      color: #b91c1c;
      font-weight: 800;
      background: #fef2f2;
      border-top: 2px solid #334155;
      border-bottom: 2px solid #334155;
      padding: 5px 8px;
    }
    tr.grand-total-row td.num,
    tr.net-assets-row td.num,
    tr.total-row td.num { text-align: right; }
    .end-of-report {
      text-align: center;
      margin-top: 16px;
      margin-bottom: 8px;
      font-size: 12px;
      border-top: 1px solid #ccc;
      padding-top: 8px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
      gap: 10px;
    }
    .button {
      background: #1a5f4a;
      color: #fff;
      border: none;
      padding: 10px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .button:hover {
      background: #144737;
    }
    .report-footer {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #666;
      border-top: 1px solid #ccc;
      padding-top: 6px;
      margin-top: 8px;
    }
    @media print {
      body { background: white; }
      .sheet { border: 0; margin: 0; width: auto; min-height: auto; padding: 0; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tbody tr { page-break-inside: avoid; }
      .print-footer {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        padding: 6px 24px;
        border-top: 1px solid #ccc;
        background: #fff;
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #666;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <div class="logo-area">
      <svg width="180" height="56" viewBox="0 0 360 112" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <rect width="360" height="112" rx="4" fill="#1a5f4a"/>
        <text x="16" y="46" font-family="Arial" font-size="26" font-weight="700" fill="#d4a017">al madina المدينة</text>
        <text x="16" y="72" font-family="Arial" font-size="15" font-weight="400" fill="#d4a017" letter-spacing="4">LOGISTICS اللوجستية</text>
        <polygon points="310,20 355,56 310,92" fill="#d4a017"/>
      </svg>
    </div>
    <div class="divider-thick"></div>
    <div class="meta-row"><span class="meta-label">Title :</span><span>${escapeHtml(reportTitle)}</span></div>
    <div class="meta-row"><span class="meta-label">Date :</span><span>${escapeHtml(printDateTime)}</span></div>
    <div class="meta-row"><span class="meta-label">User :</span><span>${escapeHtml(params.loginid)}</span></div>
    <div class="divider-thin"></div>
    <div class="actions">
      <button class="button" onclick="window.print()">🖨 Print / Save PDF</button>
    </div>
    <div class="drill-hint">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      Click any line item to drill down
    </div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="right" style="width:160px">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${bodyHtml || `<tr><td colspan="2" style="text-align:center;padding:36px 0;color:#666">No records found.</td></tr>`}
      </tbody>
    </table>
    <div class="end-of-report">End of Report</div>
    <div class="report-footer print-footer">
      <span>Report: rpt_balance_sheet</span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </main>
  ${drillScript}
</body>
</html>`;
}

// ─── Excel Builder ────────────────────────────────────────────────────────────

const excelStyles = {
  title: {
    font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5F4A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top:    { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left:   { style: "thin", color: { rgb: "1A5F4A" } },
      right:  { style: "thin", color: { rgb: "1A5F4A" } },
    },
  },
  meta: {
    font: { bold: true, sz: 10, color: { rgb: "000000" } },
    alignment: { vertical: "center" },
  },
  sectionHeader: {
    font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5F4A" } },
    alignment: { vertical: "center" },
    border: {
      top:    { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left:   { style: "thin", color: { rgb: "1A5F4A" } },
      right:  { style: "thin", color: { rgb: "1A5F4A" } },
    },
  },
  subGroupHeader: {
    font: { bold: true, sz: 10, color: { rgb: "1A5F4A" } },
    fill: { fgColor: { rgb: "F0F9F5" } },
    border: { bottom: { style: "thin", color: { rgb: "A7D7C5" } } },
  },
  dataRow: {
    alignment: { indent: 3 },
    border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } },
  },
  dataRowNum: {
    alignment: { horizontal: "right", vertical: "top" },
    numFmt: "#,##0.000",
    border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } },
  },
  totalLabel: {
    font: { bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8FAFC" } },
    border: {
      top:    { style: "thin",   color: { rgb: "64748B" } },
      bottom: { style: "medium", color: { rgb: "334155" } },
      left:   { style: "thin",   color: { rgb: "64748B" } },
      right:  { style: "thin",   color: { rgb: "64748B" } },
    },
  },
  totalNum: {
    font: { bold: true },
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "right" },
    numFmt: "#,##0.000",
    border: {
      top:    { style: "thin",   color: { rgb: "64748B" } },
      bottom: { style: "medium", color: { rgb: "334155" } },
      left:   { style: "thin",   color: { rgb: "64748B" } },
      right:  { style: "thin",   color: { rgb: "64748B" } },
    },
  },
  grandTotalLabel: {
    font: { bold: true, sz: 11, color: { rgb: "1E3A8A" } },
    fill: { fgColor: { rgb: "DBEAFE" } },
    border: {
      top:    { style: "medium", color: { rgb: "334155" } },
      bottom: { style: "medium", color: { rgb: "334155" } },
      left:   { style: "medium", color: { rgb: "334155" } },
      right:  { style: "medium", color: { rgb: "334155" } },
    },
  },
  grandTotalNum: {
    font: { bold: true, sz: 11, color: { rgb: "1E3A8A" } },
    fill: { fgColor: { rgb: "DBEAFE" } },
    alignment: { horizontal: "right" },
    numFmt: "#,##0.000",
    border: {
      top:    { style: "medium", color: { rgb: "334155" } },
      bottom: { style: "medium", color: { rgb: "334155" } },
      left:   { style: "medium", color: { rgb: "334155" } },
      right:  { style: "medium", color: { rgb: "334155" } },
    },
  },
  netAssetsLabel: {
    font: { bold: true, sz: 11, color: { rgb: "B91C1C" } },
    fill: { fgColor: { rgb: "FEF2F2" } },
    border: {
      top:    { style: "medium", color: { rgb: "334155" } },
      bottom: { style: "medium", color: { rgb: "334155" } },
      left:   { style: "medium", color: { rgb: "334155" } },
      right:  { style: "medium", color: { rgb: "334155" } },
    },
  },
  netAssetsNum: {
    font: { bold: true, sz: 11, color: { rgb: "B91C1C" } },
    fill: { fgColor: { rgb: "FEF2F2" } },
    alignment: { horizontal: "right" },
    numFmt: "#,##0.000",
    border: {
      top:    { style: "medium", color: { rgb: "334155" } },
      bottom: { style: "medium", color: { rgb: "334155" } },
      left:   { style: "medium", color: { rgb: "334155" } },
      right:  { style: "medium", color: { rgb: "334155" } },
    },
  },
  footer: {
    font: { italic: true, color: { rgb: "64748B" } },
    alignment: { horizontal: "center" },
  },
};

const styleIdBySignature = new Map<string, number>([
  [JSON.stringify(excelStyles.title),           1],
  [JSON.stringify(excelStyles.meta),            2],
  [JSON.stringify(excelStyles.sectionHeader),   3],
  [JSON.stringify(excelStyles.subGroupHeader),  4],
  [JSON.stringify(excelStyles.dataRow),         5],
  [JSON.stringify(excelStyles.dataRowNum),      6],
  [JSON.stringify(excelStyles.totalLabel),      7],
  [JSON.stringify(excelStyles.totalNum),        8],
  [JSON.stringify(excelStyles.grandTotalLabel), 9],
  [JSON.stringify(excelStyles.grandTotalNum),  10],
  [JSON.stringify(excelStyles.netAssetsLabel), 11],
  [JSON.stringify(excelStyles.netAssetsNum),   12],
  [JSON.stringify(excelStyles.footer),         13],
]);

function applyStyle(ws: any, row: number, col: number, style: Record<string, unknown>) {
  // Encode cell (1-based → 0-based)
  const colLetter = String.fromCharCode(64 + col);
  const ref       = `${colLetter}${row}`;
  if (!ws[ref]) ws[ref] = { t: "s", v: "" };
  (ws[ref] as any).s = style;
}

function buildExcelBuffer(
  sections:  BalanceSheetSections,
  totals:    BalanceSheetTotals,
  params:    { companyCode: string; divisionCode: string; asOnDate: string; loginid: string },
): Buffer {
  const { nonCurrentAssets, currentAssets, nonCurrentLiabilities, currentLiabilities, ownersEquity } = sections;
  const {
    totalNonCurrentAssets, totalCurrentAssets, totalAssets,
    totalNonCurrentLiabilities, totalCurrentLiabilities, totalLiabilities,
    netAssets, totalOwnersEquity,
  } = totals;

  const asOnDisplay   = dateText(params.asOnDate);
  const divisionLabel = (params.divisionCode && params.divisionCode !== "All")
    ? ` (Division: ${params.divisionCode})` : "";
  const reportTitle   = `Balance Sheet as on ${asOnDisplay}${divisionLabel}`;
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  // Build rows array — track which spreadsheet row each logical row ends up in
  type SheetRow = [string | number, string | number | null, string];
  // col A = label, col B = amount (or null for header rows), col C = style tag
  const rows: SheetRow[] = [
    ["al madina LOGISTICS - Balance Sheet Report", null, "title"],
    ["", null, ""],
    ["Title :",    reportTitle,   "meta"],
    ["Date :",     printDateTime, "meta"],
    ["User :",     params.loginid,"meta"],
    ["Report :",   "rpt_balance_sheet", "meta"],
    ["", null, ""],
  ];

  const addSection = (title: string, sectionHeadings: HeadingGroup[], total: number) => {
    rows.push([title, null, "sectionHeader"]);
    if (sectionHeadings.length === 0) {
      rows.push(["No entries", null, "dataRow"]);
    } else {
      for (const heading of sectionHeadings) {
        rows.push([heading.h_name, null, "subGroupHeader"]);
        for (const item of heading.items) {
          rows.push([`    ${item.bl_name}`, item.amount, "dataRow"]);
        }
        rows.push([`Total ${heading.h_name}`, heading.total, "totalRow"]);
      }
    }
    rows.push([`TOTAL ${title.toUpperCase()}`, total, "totalRow"]);
    rows.push(["", null, ""]);
  };

  addSection("Non Current Assets",      nonCurrentAssets,      totalNonCurrentAssets);
  addSection("Current Assets",          currentAssets,         totalCurrentAssets);
  rows.push(["TOTAL ASSETS", totalAssets, "grandTotal"]);
  rows.push(["", null, ""]);
  addSection("Non Current Liabilities", nonCurrentLiabilities, totalNonCurrentLiabilities);
  addSection("Current Liabilities",     currentLiabilities,    totalCurrentLiabilities);
  rows.push(["TOTAL LIABILITIES", totalLiabilities, "grandTotal"]);
  rows.push(["", null, ""]);
  rows.push(["NET ASSETS", netAssets, "netAssets"]);
  rows.push(["", null, ""]);
  addSection("Owners Equity",           ownersEquity,          totalOwnersEquity);
  rows.push(["TOTAL OWNERS EQUITY", totalOwnersEquity, "grandTotal"]);
  rows.push(["", null, ""]);
  rows.push(["Powered by Bayanat Technology", null, "footer"]);

  // Build sheet XML
  const colA_width = 50;
  const colB_width = 20;

  let sheetData = "";
  const merges: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rNum  = i + 1;
    const [labelVal, amtVal, styleTag] = rows[i];

    const getStyleIds = (tag: string, col: "A" | "B") => {
      switch (tag) {
        case "title":       return col === "A" ? 1 : 1;
        case "meta":        return col === "A" ? 2 : 2;
        case "sectionHeader": return col === "A" ? 3 : 3;
        case "subGroupHeader": return col === "A" ? 4 : 4;
        case "dataRow":     return col === "A" ? 5 : 6;
        case "totalRow":    return col === "A" ? 7 : 8;
        case "grandTotal":  return col === "A" ? 9 : 10;
        case "netAssets":   return col === "A" ? 11 : 12;
        case "footer":      return col === "A" ? 13 : 13;
        default:            return 0;
      }
    };

    const sA = getStyleIds(styleTag, "A");
    const sB = getStyleIds(styleTag, "B");

    const cellA = `<c r="A${rNum}"${sA ? ` s="${sA}"` : ""} t="inlineStr"><is><t>${escapeXml(labelVal)}</t></is></c>`;

    let cellB = "";
    if (amtVal !== null && amtVal !== "") {
      if (typeof amtVal === "number") {
        cellB = `<c r="B${rNum}"${sB ? ` s="${sB}"` : ""}><v>${amtVal}</v></c>`;
      } else {
        cellB = `<c r="B${rNum}"${sB ? ` s="${sB}"` : ""} t="inlineStr"><is><t>${escapeXml(amtVal)}</t></is></c>`;
      }
    } else if (sB) {
      cellB = `<c r="B${rNum}" s="${sB}" t="inlineStr"><is><t></t></is></c>`;
    }

    // Merge title / section header / grand total across both columns
    if (["title", "sectionHeader", "grandTotal", "netAssets"].includes(styleTag)) {
      merges.push(`<mergeCell ref="A${rNum}:B${rNum}"/>`);
    }

    // Row height
    let ht = "";
    if (styleTag === "title")       ht = ` ht="28" customHeight="1"`;
    else if (styleTag === "sectionHeader" || styleTag === "grandTotal" || styleTag === "netAssets") ht = ` ht="20" customHeight="1"`;

    sheetData += `<row r="${rNum}"${ht}>${cellA}${cellB}</row>`;
  }

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="${colA_width}" customWidth="1"/>
    <col min="2" max="2" width="${colB_width}" customWidth="1"/>
  </cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0.000"/>
  </numFmts>
  <fonts count="8">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF1A5F4A"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF1E3A8A"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FFB91C1C"/><name val="Arial"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A5F4A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0F9F5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF2F2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="none"/></fill>
  </fills>
  <borders count="7">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF1A5F4A"/></left><right style="thin"><color rgb="FF1A5F4A"/></right>
      <top style="thin"><color rgb="FF1A5F4A"/></top><bottom style="thin"><color rgb="FF1A5F4A"/></bottom><diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFA7D7C5"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF64748B"/></left><right style="thin"><color rgb="FF64748B"/></right>
      <top style="thin"><color rgb="FF64748B"/></top><bottom style="medium"><color rgb="FF334155"/></bottom><diagonal/>
    </border>
    <border>
      <left style="medium"><color rgb="FF334155"/></left><right style="medium"><color rgb="FF334155"/></right>
      <top style="medium"><color rgb="FF334155"/></top><bottom style="medium"><color rgb="FF334155"/></bottom><diagonal/>
    </border>
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment indent="3"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="5" fillId="4" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="6" fillId="5" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="6" fillId="5" borderId="5" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="7" fillId="6" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="7" fillId="6" borderId="5" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Balance Sheet" sheetId="1" r:id="rId1"/></sheets>
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
  <Override PartName="/xl/workbook.xml"           ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"  ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"             ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
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

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getBalanceSheetReportHtml = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { rows, params } = await loadRows(req);
    const { sections, totals } = aggregateRows(rows);
    const html = renderHtml(sections, totals, params);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Balance Sheet HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportBalanceSheetReportExcel = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { rows, params } = await loadRows(req);
    const { sections, totals } = aggregateRows(rows);
    const buffer   = buildExcelBuffer(sections, totals, params);
    const filename = `balance_sheet_${params.companyCode}_${params.asOnDate}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Balance Sheet Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};