import { Request, Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface PnlRow {
  h_code: string;
  h_name: string;
  pl_code: string;
  pl_name: string;
  lcur_amount: number;
  s_order: number;
}

interface GroupedHeader {
  h_code: string;
  h_name: string;
  s_order: number;
  rows: PnlRow[];
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function text(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function amount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  const fmt = abs.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return n < 0 ? `(${fmt})` : fmt;
}

function dateText(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  return isNaN(d.getTime())
    ? String(v).substring(0, 10)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function escapeJs(v: unknown): string {
  return JSON.stringify(text(v));
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

function groupByHeader(rows: PnlRow[]): GroupedHeader[] {
  const map = new Map<string, GroupedHeader>();
  for (const row of rows) {
    if (!map.has(row.h_code)) {
      map.set(row.h_code, {
        h_code: row.h_code,
        h_name: row.h_name ?? row.h_code,
        s_order: row.s_order,
        rows: [],
        total: 0,
      });
    }
    const grp = map.get(row.h_code)!;
    grp.rows.push(row);
    grp.total += amount(row.lcur_amount);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.s_order !== b.s_order
      ? a.s_order - b.s_order
      : a.h_code.localeCompare(b.h_code)
  );
}

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
  if (conn) try { await conn.close(); } catch (e) { console.warn("closeConn:", e); }
}

// ─── Param parser ─────────────────────────────────────────────────────────────

function parseCommon(req: RequestWithUser) {
  const companyCode = text(
    req.body.company_code ||
    req.body.code1 ||
    req.user?.company_code
  );

  const divisionCode = text(
    req.body.division_code ||
    req.body.code2 ||
    "All"
  );

  const fromDate = text(
    req.body.from_date ||
    req.body.code3
  );

  const toDate = text(
    req.body.to_date ||
    req.body.code4
  );

  if (!companyCode || !fromDate || !toDate)
    throw Object.assign(
      new Error("company_code, from_date, and to_date are required"),
      { status: 400 }
    );

  return { companyCode, fromDate, toDate, divisionCode };
}

// ─── Level-1 SQL ──────────────────────────────────────────────────────────────
// FIXES APPLIED:
//   1. String concatenation -> bind parameters (was vulnerable to SQL injection)
//   2. d.doc_date < TO_DATE(:toDate) -> < TO_DATE(:toDate) + 1 (inclusive range;
//      previously fromDate === toDate always produced zero rows)
//   3. d.cancelled <> 'Y' -> NVL(d.cancelled,'N') <> 'Y' (rows with NULL
//      cancelled were silently excluded, since NULL <> 'Y' evaluates to NULL/false)

async function loadPnlRows(
  conn: oracledb.Connection,
  companyCode: string,
  fromDate: string,
  toDate: string,
  divisionCode: string,
): Promise<PnlRow[]> {
  const sql = `
    SELECT
      p.h_code,
      p.pl_code,
      p.pl_name,
      SUM(lcur_amount * (sign_ind * -1)) lcur_amount,
      (
        SELECT MAX(pl_name)
        FROM   ms_ac_plsetup n
        WHERE  n.pl_type        = 'H'
          AND  p.company_code   = n.company_code
          AND  p.h_code         = n.pl_code
      ) h_name,
      (
        CASE p.h_code
          WHEN '01' THEN 1 WHEN '02' THEN 1
          WHEN '03' THEN 1 WHEN '04' THEN 1
          WHEN '05' THEN 1 WHEN '06' THEN 1
          WHEN '19' THEN 1 WHEN '20' THEN 1
          WHEN '21' THEN 1 WHEN '22' THEN 1
          WHEN '23' THEN 1 WHEN '24' THEN 1
          WHEN '25' THEN 1 WHEN '26' THEN 1
          WHEN '27' THEN 1 WHEN '28' THEN 1
          ELSE 2
        END
      ) s_order
    FROM
      ms_ac_plsetup p,
      ms_accodes    m,
      tr_ac_detail  d
    WHERE
          p.company_code   = m.company_code
      AND p.pl_code        = m.pl_bl_code
      AND m.company_code   = d.company_code
      AND m.ac_code        = d.ac_code
      AND p.company_code   = :companyCode
      AND d.doc_date      >= TO_DATE(:fromDate, 'YYYY-MM-DD')
      AND d.doc_date       <  TO_DATE(:toDate,   'YYYY-MM-DD') + 1
      AND NVL(d.cancelled, 'N') <> 'Y'
      AND d.doc_type      <> 'EJV'
      AND ('All' = :divisionCode OR d.div_code = :divisionCode)
    GROUP BY
      p.company_code,
      p.h_code,
      p.pl_code,
      p.pl_name
    ORDER BY
      s_order,
      p.h_code,
      p.pl_code
  `;

  const result = await conn.execute(
    sql,
    { companyCode, fromDate, toDate, divisionCode },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );

  return normalize(result.rows as any[]) as PnlRow[];
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderPnlHtml(
  groups: GroupedHeader[],
  params: {
    companyCode: string;
    fromDate: string;
    toDate: string;
    divisionCode: string;
    loginId: string;
  }
): string {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const income = groups.filter((g) => g.s_order === 1);
  const expense = groups.filter((g) => g.s_order === 2);
  const totalIncome = income.reduce((s, g) => s + g.total, 0);
  const totalExpense = expense.reduce((s, g) => s + g.total, 0);
  const net = totalIncome - totalExpense;

  // Drill-down postMessage. When this HTML is loaded inside the popup's inner
  // iframe, window.parent is the popup document — the popup shell itself
  // relays this message on to window.opener (the main app tab).
  const drillScript = `
  <script>
    (function () {
      var COMPANY_CODE  = ${escapeJs(params.companyCode)};
      var FROM_DATE     = ${escapeJs(params.fromDate)};
      var TO_DATE       = ${escapeJs(params.toDate)};
      var DIVISION_CODE = ${escapeJs(params.divisionCode)};

      document.querySelectorAll("tbody tr[data-plcode]").forEach(function (tr) {
        tr.style.cursor = "pointer";
        tr.addEventListener("mouseenter", function () { tr.style.background = "#f0f9f5"; });
        tr.addEventListener("mouseleave", function () { tr.style.background = ""; });
        tr.addEventListener("click", function () {
          var plCode = tr.getAttribute("data-plcode");
          window.parent.postMessage({
            type:          "PNL_DRILL_DOWN",
            drillLevel:    "l2",
            company_code:  COMPANY_CODE,
            from_date:     FROM_DATE,
            to_date:       TO_DATE,
            division_code: DIVISION_CODE,
            pl_code:       plCode,
          }, "*");
        });
      });
    })();
  </script>`;

  function renderSection(
    sectionGroups: GroupedHeader[],
    sectionLabel: string,
    sectionTotal: number
  ): string {
    let html = "";
    html += `<tr class="section-row"><td colspan="3">${escapeHtml(sectionLabel)}</td></tr>`;

    for (const g of sectionGroups) {
      html += `<tr class="group-row"><td colspan="3">${escapeHtml(g.h_name)}</td></tr>`;

      for (const r of g.rows) {
        html +=
          `<tr class="data-row" data-plcode="${escapeHtml(r.pl_code)}">` +
          `<td class="code">${escapeHtml(r.pl_code)}</td>` +
          `<td class="desc">${escapeHtml(r.pl_name)}</td>` +
          `<td class="num">${escapeHtml(fmtNumber(amount(r.lcur_amount)))}</td>` +
          `</tr>`;
      }

      html +=
        `<tr class="group-total">` +
        `<td colspan="2">Total ${escapeHtml(g.h_name)}</td>` +
        `<td class="num">${escapeHtml(fmtNumber(g.total))}</td>` +
        `</tr>`;
    }

    html +=
      `<tr class="section-total">` +
      `<td colspan="2">TOTAL ${escapeHtml(sectionLabel)}</td>` +
      `<td class="num">${escapeHtml(fmtNumber(sectionTotal))}</td>` +
      `</tr>`;

    return html;
  }

  let bodyRows = "";
  if (income.length) bodyRows += renderSection(income, "INCOME", totalIncome);
  if (expense.length) bodyRows += renderSection(expense, "EXPENSES", totalExpense);

  const netRow =
    `<tr class="net-row">` +
    `<td colspan="2">NET ${net >= 0 ? "PROFIT" : "LOSS"}</td>` +
    `<td class="num">${escapeHtml(fmtNumber(Math.abs(net)))}</td>` +
    `</tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Profit &amp; Loss</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      font-size: 12px; color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .sheet {
      width: 210mm; min-height: 297mm;
      margin: 0 auto; background: #fff;
      padding: 8mm;
      border: 1px solid #000;
    }
    .logo-area { margin-bottom: 12px; }
    .divider-thick { border-top: 2px solid #000; margin: 8px 0 5px; }
    .divider-thin  { border-top: 1px solid #000; margin: 5px 0 10px; }
    .meta-row { display: flex; align-items: baseline; font-size: 12px; margin-bottom: 3px; }
    .meta-label { font-weight: 700; width: 80px; flex-shrink: 0; }
    .drill-hint {
      font-size: 10px; color: #000; background: #fff;
      border: 1px solid #000; border-radius: 0;
      padding: 4px 10px; margin-bottom: 8px;
      display: inline-flex; align-items: center; gap: 6px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    col.c0 { width: 18%; } col.c1 { width: 62%; } col.c2 { width: 20%; }
    thead tr.th-main th {
      background: #fff; color: #000; font-weight: 700;
      font-size: 11px; padding: 6px 10px; text-align: left;
      border: 1px solid #000;
    }
    thead tr.th-main th.num { text-align: right; }
    tr.section-row td {
      background: #fff; color: #000; font-weight: 700;
      font-size: 12px; padding: 5px 10px;
      border: 1px solid #000;
      letter-spacing: .03em;
    }
    tr.group-row td {
      background: #fff; color: #000; font-weight: 700;
      font-size: 12px; padding: 4px 10px 4px 20px;
      border-bottom: 1px solid #000;
      border-left: 1px solid #000;
      border-right: 1px solid #000;
    }
    tbody tr.data-row td {
      padding: 3px 10px 3px 30px;
      border-bottom: 1px solid #ccc;
      border-left: 1px solid #000;
      border-right: 1px solid #000;
      color: #000; font-size: 11px;
      vertical-align: top;
    }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: "Courier New", monospace; }
    td.code { font-weight: 600; }
    tr.group-total td {
      background: #fff; padding: 3px 10px; font-size: 11px;
      font-weight: 700; color: #000;
      border-bottom: 1px solid #000;
      border-left: 1px solid #000;
      border-right: 1px solid #000;
    }
    tr.section-total td {
      background: #fff; padding: 5px 10px; font-size: 12px;
      font-weight: 700; color: #000;
      border: 1px solid #000;
    }
    tr.net-row td {
      background: #fff; color: #000; font-weight: 700;
      font-size: 13px; padding: 8px 10px;
      border: 2px solid #000;
    }
    .end-of-report {
      text-align: center; margin-top: 12px; margin-bottom: 6px;
      font-size: 11px; border-top: 1px solid #000; padding-top: 6px; color: #000;
    }
    .report-footer {
      display: flex; justify-content: space-between;
      font-size: 10px; color: #000;
      border-top: 1px solid #000; padding-top: 4px; margin-top: 6px;
    }
    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; border-radius: 0; }
      .drill-hint { display: none !important; }
      thead { display: table-header-group; }
      tr.section-row, tr.group-row { break-after: avoid; }
      tr.group-total, tr.section-total, tr.net-row { break-before: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="logo-area">
      <svg width="180" height="56" viewBox="0 0 360 112" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <rect width="360" height="112" rx="4" fill="#1a5f4a"/>
        <text x="16" y="46" font-family="Arial" font-size="26" font-weight="700" fill="#d4a017">al madina المدينة</text>
        <text x="16" y="72" font-family="Arial" font-size="15" font-weight="400" fill="#d4a017" letter-spacing="4">LOGISTICS اللوجستية</text>
        <polygon points="310,20 355,56 310,92" fill="#d4a017"/>
      </svg>
    </div>
    <div class="divider-thick"></div>
    <div class="meta-row"><span class="meta-label">Title :</span><span>Profit &amp; Loss Report</span></div>
    <div class="meta-row"><span class="meta-label">Period :</span><span>${escapeHtml(dateText(params.fromDate))} &ndash; ${escapeHtml(dateText(params.toDate))}</span></div>
    <div class="meta-row"><span class="meta-label">Division :</span><span>${escapeHtml(params.divisionCode)}</span></div>
    <div class="meta-row"><span class="meta-label">Date :</span><span>${escapeHtml(printDateTime)}</span></div>
    <div class="meta-row"><span class="meta-label">User :</span><span>${escapeHtml(params.loginId)}</span></div>
    <div class="divider-thin"></div>
    <div class="drill-hint">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      Click any row to drill down to account detail
    </div>
    <table>
      <colgroup><col class="c0"/><col class="c1"/><col class="c2"/></colgroup>
      <thead>
        <tr class="th-main">
          <th>Code</th>
          <th>Description</th>
          <th class="num">Amount (OMR)</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || '<tr><td colspan="3" style="text-align:center;padding:40px;color:#000;border:1px solid #000">No records found for the selected criteria.</td></tr>'}
        ${netRow}
      </tbody>
    </table>
    <div class="end-of-report">End of Report</div>
    <div class="report-footer">
      <span>Report: Profit &amp; Loss</span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </div>
  ${drillScript}
</body>
</html>`;
}

// ─── Excel builder ────────────────────────────────────────────────────────────

function buildPnlExcel(
  groups: GroupedHeader[],
  params: {
    companyCode: string;
    fromDate: string;
    toDate: string;
    divisionCode: string;
    loginId: string;
  }
): Buffer {
  const income = groups.filter((g) => g.s_order === 1);
  const expense = groups.filter((g) => g.s_order === 2);
  const totalIncome = income.reduce((s, g) => s + g.total, 0);
  const totalExpense = expense.reduce((s, g) => s + g.total, 0);
  const net = totalIncome - totalExpense;

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const S = {
    default: 0,
    titleHdr: 1,
    meta: 2,
    tableHdr: 3,
    sectionRow: 4,
    groupRow: 5,
    dataText: 6,
    groupTotal: 7,
    sectionTotal: 8,
    netRow: 9,
    numData: 10,
    numGroupTotal: 11,
    numSectionTotal: 12,
    numNet: 13,
  };

  type Cell = { v: unknown; s: number } | null;
  const rows: Cell[][] = [];

  const r = (v: unknown, s: number): Cell => ({ v, s });
  const _ = null;

  rows.push([r("AL MADINA LOGISTICS — Profit & Loss Report", S.titleHdr), _, _]);
  rows.push([r(`Period: ${dateText(params.fromDate)} – ${dateText(params.toDate)}   Division: ${params.divisionCode}   User: ${params.loginId}   Date: ${printDateTime}`, S.meta), _, _]);
  rows.push([]);
  rows.push([r("Code", S.tableHdr), r("Description", S.tableHdr), r("Amount (OMR)", S.tableHdr)]);

  function appendSection(sectionGroups: GroupedHeader[], label: string, sectionTotal: number) {
    rows.push([r(label, S.sectionRow), _, _]);
    for (const g of sectionGroups) {
      rows.push([r(g.h_name, S.groupRow), _, _]);
      for (const row of g.rows) {
        rows.push([r(row.pl_code, S.dataText), r(row.pl_name, S.dataText), r(amount(row.lcur_amount), S.numData)]);
      }
      rows.push([r(`Total ${g.h_name}`, S.groupTotal), _, r(g.total, S.numGroupTotal)]);
    }
    rows.push([r(`TOTAL ${label}`, S.sectionTotal), _, r(sectionTotal, S.numSectionTotal)]);
  }

  if (income.length) appendSection(income, "INCOME", totalIncome);
  if (expense.length) appendSection(expense, "EXPENSES", totalExpense);
  rows.push([r(`NET ${net >= 0 ? "PROFIT" : "LOSS"}`, S.netRow), _, r(Math.abs(net), S.numNet)]);

  const COL_WIDTHS = [20, 52, 20];
  const colXml = COL_WIDTHS.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const merges: string[] = [];
  let sheetData = "";

  rows.forEach((row, ri) => {
    if (!row || !row.length) return;
    const rn = ri + 1;
    let rowXml = `<row r="${rn}"${rn === 1 ? ` ht="22" customHeight="1"` : ""}>`;

    let ci = 0;
    while (ci < row.length) {
      const cell = row[ci];
      if (cell !== null) {
        let end = ci + 1;
        while (end < row.length && row[end] === null) end++;
        if (end - 1 > ci) {
          const sc = String.fromCharCode(65 + ci);
          const ec = String.fromCharCode(65 + end - 1);
          merges.push(`${sc}${rn}:${ec}${rn}`);
        }
        const ref = String.fromCharCode(65 + ci) + rn;
        if (typeof cell.v === "number") {
          rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
        } else {
          rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
        }
        ci = end;
      } else {
        ci++;
      }
    }
    rowXml += "</row>";
    sheetData += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
  <fonts count="8">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><sz val="9"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="12"/><color rgb="FF000000"/><name val="Arial"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="medium"><color rgb="FF000000"/></left>
      <right style="medium"><color rgb="FF000000"/></right>
      <top style="medium"><color rgb="FF000000"/></top>
      <bottom style="medium"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment indent="2"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" indent="3"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment indent="2"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="7" fillId="0" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="164" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="164" fontId="4" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="164" fontId="7" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  return buildXlsxZip(sheetXml, stylesXml, "Profit & Loss");
}

// ─── XLSX zip builder ─────────────────────────────────────────────────────────

function buildXlsxZip(sheetXml: string, stylesXml: string, sheetName: string): Buffer {
  const safe = sheetName.replace(/[\\/?*[\]]/g, "_").substring(0, 31);

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(safe)}" sheetId="1" r:id="rId1"/></sheets>
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
  <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function sendHtml(res: Response, html: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}

function sendExcel(res: Response, buffer: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(buffer);
}

// ─── Route: HTML ──────────────────────────────────────────────────────────────

export const getProfitLossReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    conn = await getConn(req);
    const rawRows = await loadPnlRows(conn, companyCode, fromDate, toDate, divisionCode);

    if (!rawRows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const groups = groupByHeader(rawRows);
    const html = renderPnlHtml(groups, {
      companyCode,
      fromDate,
      toDate,
      divisionCode,
      loginId: req.user?.loginid ?? "",
    });

    sendHtml(res, html);
  } catch (error: any) {
    console.error("P&L HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  } finally {
    await closeConn(conn);
  }
};

// ─── Route: Excel ─────────────────────────────────────────────────────────────

export const getProfitLossReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
    conn = await getConn(req);
    const rawRows = await loadPnlRows(conn, companyCode, fromDate, toDate, divisionCode);

    if (!rawRows.length) {
      res.status(200).json({ success: false, message: "No data found." });
      return;
    }

    const groups = groupByHeader(rawRows);
    const buffer = buildPnlExcel(groups, {
      companyCode,
      fromDate,
      toDate,
      divisionCode,
      loginId: req.user?.loginid ?? "",
    });

    sendExcel(
      res,
      buffer,
      `ProfitLoss_${companyCode}_${fromDate}_${toDate}.xlsx`.replace(/\//g, "-")
    );
  } catch (error: any) {
    console.error("P&L Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to export report" });
  } finally {
    await closeConn(conn);
  }
};