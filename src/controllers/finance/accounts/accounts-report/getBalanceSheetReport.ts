import { Request, Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
} from "../../../common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface LineItem {
  bl_code: string;
  bl_name: string;
  amount:  number;
}

interface HeadingGroup {
  h_code: string;
  h_name: string;
  total:  number;
  items:  LineItem[];
}

interface BalanceSheetSections {
  nonCurrentAssets:      HeadingGroup[];
  currentAssets:         HeadingGroup[];
  nonCurrentLiabilities: HeadingGroup[];
  currentLiabilities:    HeadingGroup[];
  ownersEquity:          HeadingGroup[];
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
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  const day   = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-GB", { month: "short" });
  const year  = d.getFullYear();
  return `${day} ${month} ${year}`;
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

  const divLiteral     = divisionCode.replace(/'/g, "''");
  const divFilter      = `('All' = '${divLiteral}' OR TR_AC_DETAIL.div_code = '${divLiteral}')`;
  const divFilterAlias = `('All' = '${divLiteral}' OR d.div_code = '${divLiteral}')`;

  const sql = `
    SELECT
      MS_AC_BLSETUP.BL_CODE,
      MS_AC_BLSETUP.BL_NAME,
      MS_AC_BLSETUP.h_code,
      (SELECT bl_name
       FROM   ms_ac_blsetup m
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
    FROM  MS_AC_BLSETUP
        , MS_ACCODES
        , TR_AC_DETAIL
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
       FROM   TR_AC_DETAIL d
       WHERE  SUBSTR(d.ac_code, 1, 1) IN ('4', '5')
         AND  d.company_code = MS_AC_BLSETUP.company_code
         AND  d.CANCELLED   <> 'Y'
         AND  d.doc_date     < TO_DATE(:asOnDate, 'YYYY-MM-DD')
         AND  ${divFilterAlias}) lcur_amount,
      CAST(NULL AS VARCHAR2(20))   div_code
    FROM  MS_AC_BLSETUP
    WHERE bl_code      = '75005'
      AND company_code = :companyCode

    ORDER BY BL_CODE
  `;

  const conn = await getConn(req);
  try {
    const dataResult = await conn.execute(sql, { companyCode, asOnDate }, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return { rows: normalize(dataResult.rows as any[]), params };
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

  const nonCurrentAssets      = allHeadings.filter((h) => h.h_code.startsWith("11"));
  const currentAssets         = allHeadings.filter((h) => h.h_code.startsWith("12"));
  const nonCurrentLiabilities = allHeadings.filter((h) => h.h_code.startsWith("21"));
  const currentLiabilities    = allHeadings.filter((h) => h.h_code.startsWith("22"));
  const ownersEquity          = allHeadings.filter((h) => h.h_code.startsWith("3"));

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
    sections: {
      nonCurrentAssets, currentAssets,
      nonCurrentLiabilities, currentLiabilities,
      ownersEquity,
    },
    totals: {
      totalNonCurrentAssets, totalCurrentAssets, totalAssets,
      totalNonCurrentLiabilities, totalCurrentLiabilities, totalLiabilities,
      netAssets, totalOwnersEquity,
    },
  };
}

// ─── Extra CSS — Blue theme ─────────────────────────────────────────────────

const BALANCE_SHEET_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  .doc-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 4px 0 12px 0;
  }
  .doc-title-row h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0b4ca1;
  }

  .drill-hint {
    font-size: 10px;
    color: #0b4ca1;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 4px;
    padding: 4px 10px;
    margin-bottom: 8px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  @media print { .drill-hint { display: none !important; } }

  .table-frame {
    border: 1px solid #b8c4d2;
    border-radius: 3px;
    overflow: hidden;
  }

  table.bs-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  table.bs-table thead th {
    background: #0b4ca1;
    color: #ffffff;
    padding: 7px 8px;
    font-size: 9.5px;
    font-weight: 700;
    text-align: left;
    border-right: 1px solid rgba(255,255,255,0.16);
  }
  table.bs-table thead th:last-child { border-right: 0; }
  table.bs-table thead th.right { text-align: right; }

  table.bs-table tbody td {
    padding: 5px 8px;
    font-size: 10px;
    color: #263445;
    border-bottom: 1px solid #e3e8ef;
    vertical-align: middle;
  }
  table.bs-table tbody td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  table.bs-table tr.section-header td {
    background: #0b4ca1;
    color: #ffffff;
    font-weight: 700;
    padding: 6px 8px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .05em;
    border: none;
  }

  table.bs-table tr.sub-group-header td {
    background: #eff6ff;
    color: #0b4ca1;
    font-weight: 700;
    padding: 5px 8px;
    border-bottom: 1px solid #bfdbfe;
    text-decoration: underline;
    text-decoration-color: #93c5fd;
  }

  table.bs-table tr.data-row td:first-child { padding-left: 28px; }

  table.bs-table tbody tr[data-code] { cursor: pointer; }
  table.bs-table tbody tr[data-code]:hover { background: #eff6ff !important; }

  table.bs-table tr.data-row.empty td {
    color: #94a3b8;
    font-style: italic;
    padding-left: 28px;
  }

  table.bs-table tr.total-row td {
    background: #f8fafc;
    font-weight: 700;
    color: #0f172a;
    border-top: 1px solid #64748b;
    border-bottom: 2px solid #334155;
    padding: 6px 8px;
  }
  table.bs-table tr.total-row td.num { text-align: right; }

  table.bs-table tr.grand-total-row td {
    background: #dbeafe;
    color: #1e3a8a;
    font-weight: 800;
    padding: 6px 8px;
    border-top: 2px solid #334155;
    border-bottom: 2px solid #334155;
    font-size: 10.5px;
  }
  table.bs-table tr.grand-total-row td.num { text-align: right; }

  table.bs-table tr.net-assets-row td {
    background: #fef2f2;
    color: #b91c1c;
    font-weight: 800;
    padding: 6px 8px;
    border-top: 2px solid #334155;
    border-bottom: 2px solid #334155;
    font-size: 10.5px;
  }
  table.bs-table tr.net-assets-row td.num { text-align: right; }

  @media print {
    table.bs-table thead { display: table-header-group; }
    table.bs-table tbody tr { page-break-inside: avoid; }
  }
`;

// ─── HTML Body Renderer ──────────────────────────────────────────────────────

function renderBodyHtml(
  sections: BalanceSheetSections,
  totals: BalanceSheetTotals,
  params: { companyCode: string; divisionCode: string; asOnDate: string; loginid: string },
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

  const renderLineItems = (heading: HeadingGroup): string =>
    heading.items.map((item) => `
      <tr class="data-row" data-code="${escapeHtml(item.bl_code)}">
        <td>${escapeHtml(item.bl_name)}</td>
        <td class="num">${escapeHtml(fmtNumber(item.amount))}</td>
      </tr>`).join("");

  const renderHeadingGroup = (heading: HeadingGroup): string => `
    <tr class="sub-group-header">
      <td colspan="2"><strong>${escapeHtml(heading.h_name)}</strong></td>
    </tr>
    ${renderLineItems(heading)}`;

  const renderSection = (title: string, sectionHeadings: HeadingGroup[], total: number): string => `
    <tr class="section-header">
      <td colspan="2">${escapeHtml(title)}</td>
    </tr>
    ${sectionHeadings.length === 0
      ? `<tr class="data-row empty"><td colspan="2">No entries</td></tr>`
      : sectionHeadings.map(renderHeadingGroup).join("")
    }
    <tr class="total-row">
      <td>TOTAL ${escapeHtml(title.toUpperCase())}</td>
      <td class="num">${escapeHtml(fmtNumber(total))}</td>
    </tr>`;

  const bodyHtml = `
    ${renderSection("Non Current Assets",      nonCurrentAssets,      totalNonCurrentAssets)}
    ${renderSection("Current Assets",          currentAssets,         totalCurrentAssets)}
    <tr class="grand-total-row">
      <td>TOTAL ASSETS</td>
      <td class="num">${escapeHtml(fmtNumber(totalAssets))}</td>
    </tr>
    ${renderSection("Non Current Liabilities", nonCurrentLiabilities, totalNonCurrentLiabilities)}
    ${renderSection("Current Liabilities",     currentLiabilities,    totalCurrentLiabilities)}
    <tr class="grand-total-row">
      <td>TOTAL LIABILITIES</td>
      <td class="num">${escapeHtml(fmtNumber(totalLiabilities))}</td>
    </tr>
    <tr class="net-assets-row">
      <td>NET ASSETS</td>
      <td class="num">${escapeHtml(fmtNumber(netAssets))}</td>
    </tr>
    ${renderSection("Owners Equity",           ownersEquity,          totalOwnersEquity)}
    <tr class="grand-total-row">
      <td>TOTAL OWNERS EQUITY</td>
      <td class="num">${escapeHtml(fmtNumber(totalOwnersEquity))}</td>
    </tr>`;

  const drillScript = `
  <script>
    (function () {
      var COMPANY_CODE  = ${escapeJs(params.companyCode)};
      var AS_ON_DATE    = ${escapeJs(params.asOnDate)};
      var DIVISION_CODE = ${escapeJs(params.divisionCode)};

      document.querySelectorAll("tbody tr[data-code]").forEach(function (tr) {
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

  return `
    <div class="doc-title-row">
      <div><h1>${escapeHtml(reportTitle)}</h1></div>
    </div>

    <div class="drill-hint">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      Click any line item to drill down
    </div>

    <div class="table-frame">
      <table class="bs-table">
        <colgroup>
          <col style="width: 70%" />
          <col style="width: 30%" />
        </colgroup>
        <thead>
          <tr>
            <th>Description</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${bodyHtml}
        </tbody>
      </table>
    </div>

    ${drillScript}
  `;
}

// ─── Excel Builder — blue theme via AdmZip ───────────────────────────────────

const STYLE_ID = {
  default:        0,
  title:          1,
  meta:           2,
  sectionHeader:  3,
  subGroupHeader: 4,
  dataRow:        5,
  dataRowNum:     6,
  totalRow:       7,
  totalNum:       8,
  grandTotal:     9,
  grandTotalNum: 10,
  netAssets:     11,
  netAssetsNum:  12,
  footer:        13,
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(
  sections: BalanceSheetSections,
  totals: BalanceSheetTotals,
  params: { companyCode: string; divisionCode: string; asOnDate: string; loginid: string },
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

  const NCOLS = 2;
  const skip  = null;

  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  rows.push([xc(`Balance Sheet — ${reportTitle}`, "title"), skip]);
  rows.push(Array(NCOLS).fill(skip));

  rows.push([xc("Title", "meta"), xc(reportTitle, "meta")]);
  rows.push([xc("Date",  "meta"), xc(printDateTime, "meta")]);
  rows.push([xc("User",  "meta"), xc(params.loginid, "meta")]);
  rows.push(Array(NCOLS).fill(skip));

  rows.push([xc("Description", "sectionHeader"), xc("Amount", "sectionHeader")]);

  const addSection = (title: string, headings: HeadingGroup[], total: number) => {
    rows.push([xc(title, "sectionHeader"), skip]);
    if (headings.length === 0) {
      rows.push([xc("No entries", "dataRow"), skip]);
    } else {
      for (const h of headings) {
        rows.push([xc(h.h_name, "subGroupHeader"), skip]);
        for (const item of h.items) {
          rows.push([xc(`    ${item.bl_name}`, "dataRow"), xc(item.amount, "dataRowNum")]);
        }
        rows.push([xc(`Total ${h.h_name}`, "totalRow"), xc(h.total, "totalNum")]);
      }
    }
    rows.push([xc(`TOTAL ${title.toUpperCase()}`, "totalRow"), xc(total, "totalNum")]);
    rows.push(Array(NCOLS).fill(skip));
  };

  addSection("Non Current Assets",      nonCurrentAssets,      totalNonCurrentAssets);
  addSection("Current Assets",          currentAssets,         totalCurrentAssets);
  rows.push([xc("TOTAL ASSETS", "grandTotal"), xc(totalAssets, "grandTotalNum")]);
  rows.push(Array(NCOLS).fill(skip));
  addSection("Non Current Liabilities", nonCurrentLiabilities, totalNonCurrentLiabilities);
  addSection("Current Liabilities",     currentLiabilities,    totalCurrentLiabilities);
  rows.push([xc("TOTAL LIABILITIES", "grandTotal"), xc(totalLiabilities, "grandTotalNum")]);
  rows.push(Array(NCOLS).fill(skip));
  rows.push([xc("NET ASSETS", "netAssets"), xc(netAssets, "netAssetsNum")]);
  rows.push(Array(NCOLS).fill(skip));
  addSection("Owners Equity", ownersEquity, totalOwnersEquity);
  rows.push([xc("TOTAL OWNERS EQUITY", "grandTotal"), xc(totalOwnersEquity, "grandTotalNum")]);
  rows.push(Array(NCOLS).fill(skip));
  rows.push([xc("Powered by Bayanat Technology", "footer"), skip]);

  const COL_WIDTHS = [55, 20];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

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
        if (end > spanStart) {
          merges.push(
            `${String.fromCharCode(65 + spanStart)}${rn}:${String.fromCharCode(65 + end)}${rn}`
          );
        }
        spanStart = -1;
      } else if (cell !== null) {
        spanStart = ci;
      }
    });
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn  = ri + 1;
    const ht  = rn === 1 ? ` ht="24" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${String.fromCharCode(65 + ci)}${rn}`;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
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
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
  <fonts count="8">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0B4CA1"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B4CA1"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF2F2"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="6">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF0B4CA1"/></left><right style="thin"><color rgb="FF0B4CA1"/></right>
      <top style="thin"><color rgb="FF0B4CA1"/></top><bottom style="thin"><color rgb="FF0B4CA1"/></bottom><diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFBFDBFE"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF64748B"/></left><right style="thin"><color rgb="FF64748B"/></right>
      <top style="thin"><color rgb="FF64748B"/></top><bottom style="medium"><color rgb="FF334155"/></bottom><diagonal/>
    </border>
    <border>
      <left style="medium"><color rgb="FF334155"/></left><right style="medium"><color rgb="FF334155"/></right>
      <top style="medium"><color rgb="FF334155"/></top><bottom style="medium"><color rgb="FF334155"/></bottom><diagonal/>
    </border>
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
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
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

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS  (exports required by transactions_finance.routes.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export const getBalanceSheetReportHtml = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { rows, params } = await loadRows(req);
    const { sections, totals } = aggregateRows(rows);

    const asOnDisplay   = dateText(params.asOnDate);
    const divisionLabel = (params.divisionCode && params.divisionCode !== "All")
      ? ` (Division: ${params.divisionCode})` : "";
    const reportTitle = `Balance Sheet as on ${asOnDisplay}${divisionLabel}`;

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const bodyHtml   = renderBodyHtml(sections, totals, params);
    const footerHtml = reportFooter({
      reportName: "rpt_balance_sheet",
      userName: params.loginid,
      extraLeft: `Object: ${escapeHtml(params.companyCode)} — ${escapeHtml(params.divisionCode || "All")}`,
      extraRight: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: reportTitle,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: BALANCE_SHEET_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

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

export const getBalanceSheetReportPdf = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { rows, params } = await loadRows(req);
    const { sections, totals } = aggregateRows(rows);

    const asOnDisplay   = dateText(params.asOnDate);
    const divisionLabel = (params.divisionCode && params.divisionCode !== "All")
      ? ` (Division: ${params.divisionCode})` : "";
    const reportTitle = `Balance Sheet as on ${asOnDisplay}${divisionLabel}`;

    const headerHtml = await reportHeader({ company_code: params.companyCode, req });
    const bodyHtml   = renderBodyHtml(sections, totals, params);
    const footerHtml = reportFooter({
      reportName: "rpt_balance_sheet",
      userName: params.loginid,
      extraLeft: `Object: ${escapeHtml(params.companyCode)} — ${escapeHtml(params.divisionCode || "All")}`,
      extraRight: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title: `Balance_Sheet_${params.companyCode}_${params.asOnDate}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: BALANCE_SHEET_EXTRA_CSS,
      autoPrint: true,
      showPrintButton: true,
    });

    const filename = `balance_sheet_${params.companyCode}_${params.asOnDate}.pdf`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(html);
  } catch (error: any) {
    console.error("Balance Sheet PDF error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate PDF",
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