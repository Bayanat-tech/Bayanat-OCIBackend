import { Request, Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface PnlRow {
  h_code:       string;
  h_name:       string;
  pl_code:      string;
  pl_name:      string;
  lcur_amount:  number;
  s_order:      number;
}

interface GroupedHeader {
  h_code:  string;
  h_name:  string;
  s_order: number;
  rows:    PnlRow[];
  total:   number;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function text(v: unknown): string {
  if (v == null) return "";
  return String(v);
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

function money(v: unknown): string {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatDateStr(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  return isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

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
        h_code:  row.h_code,
        h_name:  row.h_name ?? row.h_code,
        s_order: row.s_order,
        rows:    [],
        total:   0,
      });
    }
    const grp = map.get(row.h_code)!;
    grp.rows.push(row);
    grp.total += row.lcur_amount ?? 0;
  }
  return Array.from(map.values()).sort((a, b) =>
    a.s_order !== b.s_order
      ? a.s_order - b.s_order
      : a.h_code.localeCompare(b.h_code)
  );
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getConnection(loginid?: string): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && loginid)
    tenantId = await TenantManager.getTenantForUser(loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

async function loadPnlData(
  params: {
    loginid?:   string;
    parameter?: string;
    code1?:     string | null;
    code2?:     string | null;
    code3?:     string | null;
    code4?:     string | null;
  },
  req: Request
): Promise<PnlRow[]> {
  const conn = await getConnection(params.loginid);
  try {
    const binds: any = {
      parameter: params.parameter || "Account_Report_PROFIT_AND_LOSS_VW_PROFIT_AND_LOSS",
      loginid:   params.loginid  || "ADMIN",
      code1:     params.code1    || null,
      code2:     params.code2    || null,
      code3:     params.code3    || null,
      code4:     params.code4    || null,
      out_sql:   { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    for (let i = 5; i <= 20; i++)  binds[`code${i}`]   = (req.body as any)[`code${i}`]   || null;
    for (let i = 1; i <= 4;  i++) {
      binds[`number${i}`] = (req.body as any)[`number${i}`] || null;
      binds[`date${i}`]   = (req.body as any)[`date${i}`]   || null;
    }

    const result = await conn.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_COMMON20(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,  :code5,  :code6,  :code7,  :code8,  :code9,  :code10,
           :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql as string | null;
    if (!rawSql) throw new Error("PROC_BUILD_DYNAMIC_SQL_COMMON20 returned no SQL.");

    const dataResult = await conn.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return normalize(dataResult.rows as any[]) as PnlRow[];
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  groups:      GroupedHeader[],
  reportTitle: string,
  params: {
    loginid:       string;
    division:      string;
    date_from:     string;
    date_to:       string;
    report_option: string;
  },
  autoPrint: boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const income       = groups.filter((g) => g.s_order === 1);
  const expense      = groups.filter((g) => g.s_order === 2);
  const totalIncome  = income.reduce((s, g) => s + g.total, 0);
  const totalExpense = expense.reduce((s, g) => s + g.total, 0);
  const net          = totalIncome - totalExpense;

  const autoPrintScript = autoPrint
    ? "window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 300); });"
    : "";

  function renderSection(sectionGroups: GroupedHeader[], sectionLabel: string, sectionTotal: number): string {
    let html = "";
    html += `<tr class="section-row"><td colspan="3">${escapeHtml(sectionLabel)}</td></tr>`;

    for (const g of sectionGroups) {
      html += `<tr class="group-row"><td colspan="3">${escapeHtml(g.h_name)}</td></tr>`;

      for (const r of g.rows) {
        html +=
          `<tr class="data-row">` +
          `<td>${escapeHtml(r.pl_code)}</td>` +
          `<td>${escapeHtml(r.pl_name)}</td>` +
          `<td class="num">${escapeHtml(money(r.lcur_amount))}</td>` +
          `</tr>`;
      }

      html +=
        `<tr class="group-total">` +
        `<td colspan="2">Total ${escapeHtml(g.h_name)}</td>` +
        `<td class="num">${escapeHtml(money(g.total))}</td>` +
        `</tr>`;
    }

    html +=
      `<tr class="section-total">` +
      `<td colspan="2">TOTAL ${escapeHtml(sectionLabel)}</td>` +
      `<td class="num">${escapeHtml(money(sectionTotal))}</td>` +
      `</tr>`;

    return html;
  }

  let bodyRows = "";
  if (income.length)  bodyRows += renderSection(income,  "INCOME",   totalIncome);
  if (expense.length) bodyRows += renderSection(expense, "EXPENSES", totalExpense);

  const netRow =
    `<tr class="net-row">` +
    `<td colspan="2">NET ${net >= 0 ? "PROFIT" : "LOSS"}</td>` +
    `<td class="num">${escapeHtml(money(Math.abs(net)))}</td>` +
    `</tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 12px; color: #111827;
      background: #eef1f6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 190mm; min-height: 277mm;
      margin: 18px auto; background: #fff;
      padding: 10mm 12mm;
      border: 1px solid #c4cdd9;
      border-radius: 4px;
    }
    .rpt-header {
      background: #185FA5; color: #fff; text-align: center;
      font-size: 14px; font-weight: 700; letter-spacing: .08em;
      padding: 10px 16px; text-transform: uppercase;
      border-radius: 3px 3px 0 0;
    }
    .rpt-brand {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 2px 6px;
    }
    .rpt-brand .company { font-size: 18px; font-weight: 700; color: #185FA5; }
    .rpt-brand .sub     { font-size: 10px; letter-spacing: 2px; color: #666; }
    .rpt-meta {
      display: flex; justify-content: space-between; align-items: center;
      padding: 4px 2px 8px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 10px;
      font-size: 10px; color: #4b5563;
    }
    .rpt-meta strong { color: #111827; font-weight: 600; }
    table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    col.c0 { width: 20%; } col.c1 { width: 60%; } col.c2 { width: 20%; }
    thead tr.th-main th {
      background: #185FA5; color: #fff; font-weight: 700;
      font-size: 10px; padding: 7px 10px; text-align: left;
      border-right: 1px solid rgba(255,255,255,0.15);
    }
    thead tr.th-main th:last-child { border-right: none; }
    thead tr.th-main th.num { text-align: right; }
    tr.section-row td {
      background: #185FA5; color: #fff; font-weight: 700;
      font-size: 11px; padding: 6px 10px;
      border-bottom: 1px solid rgba(255,255,255,.10);
      letter-spacing: .04em;
    }
    tr.group-row td {
      background: #dce4ef; color: #185FA5; font-weight: 700;
      font-size: 11px; padding: 5px 10px 5px 22px;
      border-bottom: 1px solid #c8d4e4;
    }
    tbody tr.data-row td {
      padding: 4px 10px 4px 32px; border-bottom: 1px solid #e5e7eb;
      color: #374151; font-size: 11px;
      white-space: normal; word-wrap: break-word; vertical-align: top;
    }
    tbody tr.data-row:nth-child(even) td { background: #f9fafb; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; font-family: "Courier New", Courier, monospace; }
    tr.group-total td {
      background: #c8d4e4; padding: 4px 10px; font-size: 10px;
      font-weight: 700; color: #185FA5; white-space: nowrap;
    }
    tr.section-total td {
      background: #a8c0dc; padding: 6px 10px; font-size: 11px;
      font-weight: 700; color: #0f2040; white-space: nowrap;
      border-top: 1px solid #185FA5;
    }
    tr.net-row td {
      background: #185FA5; color: #fff; font-weight: 700;
      font-size: 13px; padding: 9px 10px;
      border-top: 3px double #0d4a82;
    }
    .rpt-footer {
      margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px;
      display: flex; justify-content: space-between;
      font-size: 9px; color: #9ca3af;
    }
    .rpt-footer code { font-family: "Courier New", monospace; font-size: 9px; color: #6b7280; }
    @media print {
      body   { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; border-radius: 0; }
      thead  { display: table-header-group; }
      tr.section-row, tr.group-row { break-after: avoid; page-break-after: avoid; }
      tr.group-total, tr.section-total, tr.net-row { break-before: avoid; page-break-before: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="rpt-brand">
      <div>
        <div class="company">AL MADINA</div>
        <div class="sub">LOGISTICS</div>
      </div>
      <div class="rpt-header" style="border-radius:3px; padding:8px 20px; font-size:13px;">${escapeHtml(reportTitle)}</div>
    </div>
    <div class="rpt-meta">
      <span>
        Period :&nbsp;<strong>${escapeHtml(params.date_from)} &ndash; ${escapeHtml(params.date_to)}</strong>&nbsp;&nbsp;&nbsp;
        Division :&nbsp;<strong>${escapeHtml(params.division)}</strong>&nbsp;&nbsp;&nbsp;
        Report :&nbsp;<strong>${escapeHtml(params.report_option)}</strong>
      </span>
      <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;User :&nbsp;<strong>${escapeHtml(params.loginid)}</strong></span>
    </div>

    <table class="rpt-table" id="pnlTable">
      <colgroup>
        <col class="c0"/><col class="c1"/><col class="c2"/>
      </colgroup>
      <thead>
        <tr class="th-main">
          <th>Code</th>
          <th>Description</th>
          <th class="num">Amount (OMR)</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || '<tr><td colspan="3" style="text-align:center;padding:40px;color:#6b7280;">No records found for the selected criteria.</td></tr>'}
        ${netRow}
      </tbody>
    </table>

    <div class="rpt-footer">
      <span>Report Name : <code>Profit &amp; Loss</code></span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </div>

  <script>
    // Listen for print trigger from parent React page via postMessage
    window.addEventListener("message", function(e) {
      if (e.data === "print") window.print();
    });
    ${autoPrintScript}
  </script>
</body>
</html>`;
}

// ─── Excel builder (raw XML + AdmZip, matches DN Summary pattern) ─────────────

const STYLE_ID = {
  default:        0,
  header:         1,
  sectionIncome:  2,
  sectionExpense: 2,
  groupRow:       3,
  dataCode:       4,
  dataDesc:       5,
  groupTotal:     6,
  sectionTotal:   7,
  netRow:         8,
  numData:        9,
  numGroupTotal:  10,
  numSectionTotal:11,
  numNet:         12,
} as const;

type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }
function xc(v: unknown, style: StyleKey): XlCell { return { v, s: STYLE_ID[style] }; }

function buildExcelBuffer(
  groups: GroupedHeader[],
  params: {
    loginid:       string;
    division:      string;
    date_from:     string;
    date_to:       string;
    report_option: string;
  }
): Buffer {
  const NCOLS = 3;
  type Row = (XlCell | null)[];
  const skip = null;
  const rows: Row[] = [];

  // ── Title block ────────────────────────────────────────────────────────────
  rows.push([xc("AL MADINA LOGISTICS — Profit & Loss Report", "header"), skip, skip]);
  rows.push([xc(`Period: ${params.date_from} – ${params.date_to}   |   Division: ${params.division}   |   Report: ${params.report_option}`, "default"), skip, skip]);
  rows.push([xc(`Print Date: ${new Date().toLocaleDateString("en-GB")}   |   User: ${params.loginid}`, "default"), skip, skip]);
  rows.push(Array(NCOLS).fill(skip));
  rows.push([
    xc("Code",         "header"),
    xc("Description",  "header"),
    xc("Amount (OMR)", "header"),
  ]);

  // ── Sections ───────────────────────────────────────────────────────────────
  const income       = groups.filter((g) => g.s_order === 1);
  const expense      = groups.filter((g) => g.s_order === 2);
  const totalIncome  = income.reduce((s, g) => s + g.total, 0);
  const totalExpense = expense.reduce((s, g) => s + g.total, 0);
  const net          = totalIncome - totalExpense;

  function appendSection(sectionGroups: GroupedHeader[], label: string, sectionTotal: number) {
    rows.push([xc(label, "sectionIncome"), skip, skip]);

    for (const g of sectionGroups) {
      rows.push([xc(g.h_name, "groupRow"), skip, skip]);

      for (const r of g.rows) {
        rows.push([
          xc(r.pl_code,      "dataCode"),
          xc(r.pl_name,      "dataDesc"),
          xc(r.lcur_amount,  "numData"),
        ]);
      }

      rows.push([
        xc(`Total ${g.h_name}`, "groupTotal"),
        skip,
        xc(g.total, "numGroupTotal"),
      ]);
    }

    rows.push([
      xc(`TOTAL ${label}`, "sectionTotal"),
      skip,
      xc(sectionTotal, "numSectionTotal"),
    ]);
  }

  if (income.length)  appendSection(income,  "INCOME",   totalIncome);
  if (expense.length) appendSection(expense, "EXPENSES", totalExpense);

  rows.push([
    xc(`NET ${net >= 0 ? "PROFIT" : "LOSS"}`, "netRow"),
    skip,
    xc(Math.abs(net), "numNet"),
  ]);

  // ── Build XML ──────────────────────────────────────────────────────────────
  const COL_WIDTHS = [22, 50, 18];
  const colXml = COL_WIDTHS.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  ).join("");

  const merges: string[] = [];
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let ci = 0;
    while (ci < row.length) {
      if (row[ci] !== null) {
        let end = ci + 1;
        while (end < row.length && row[end] === null) end++;
        if (end - 1 > ci) {
          const startCol = String.fromCharCode(65 + ci);
          const endCol   = String.fromCharCode(65 + end - 1);
          merges.push(startCol + rn + ":" + endCol + rn);
        }
        ci = end;
      } else {
        ci++;
      }
    }
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="22" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colXml}</cols>` +
    `<sheetData>${sheetDataXml}</sheetData>` +
    mergeXml +
    `</worksheet>`;

  // ── Styles XML ─────────────────────────────────────────────────────────────
  // Fonts:  0=default  1=header-white-bold  2=section-white-bold  3=group-blue-bold
  //         4=code-dark  5=desc-dark  6=total-blue-bold  7=secTotal-dark  8=net-white-bold
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="9">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF185FA5"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF185FA5"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F2040"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF185FA5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCE4EF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC8D4E4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFA8C0DC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF9FAFB"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF185FA5"/></left>
      <right style="thin"><color rgb="FF185FA5"/></right>
      <top style="thin"><color rgb="FF185FA5"/></top>
      <bottom style="thin"><color rgb="FF185FA5"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: header (blue bg, white bold, centred) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 2: section row (blue bg, white bold) -->
    <xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <!-- 3: group row (light blue bg, blue bold, indent) -->
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="2"/></xf>
    <!-- 4: data code (normal, indent) -->
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" indent="4"/></xf>
    <!-- 5: data description (normal) -->
    <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <!-- 6: group total (medium blue bg, blue bold) -->
    <xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="2"/></xf>
    <!-- 7: section total (darker blue bg, dark bold) -->
    <xf numFmtId="0" fontId="7" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <!-- 8: net row (blue bg, white bold) -->
    <xf numFmtId="0" fontId="8" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <!-- 9: num data (right-align) -->
    <xf numFmtId="4" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="top"/></xf>
    <!-- 10: num group total (right-align, group style) -->
    <xf numFmtId="4" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 11: num section total (right-align, section style) -->
    <xf numFmtId="4" fontId="7" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 12: num net (right-align, net style) -->
    <xf numFmtId="4" fontId="8" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Profit &amp; Loss" sheetId="1" r:id="rId1"/></sheets>
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
  zip.addFile("[Content_Types].xml",        Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                Buffer.from(rels));
  zip.addFile("xl/workbook.xml",            Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml",   Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml",              Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Shared param extractor ───────────────────────────────────────────────────

function extractParams(req: Request) {
  const src = { ...req.query, ...req.body };
  const parameter = text(src.parameter) || "Account_Report_PROFIT_AND_LOSS_VW_PROFIT_AND_LOSS";
  const reportLabel =
    parameter.includes("month_wise") ? "P&L Month Wise"
    : parameter.includes("month")    ? "P&L for the Month"
    : "P&L for the Period";

  return {
    loginid:       text(src.loginid)  || "ADMIN",
    parameter,
    code1:         text(src.code1)    || null,
    code2:         text(src.code2)    || null,
    code3:         text(src.code3)    || null,
    code4:         text(src.code4)    || null,
    division:      text(src.code2)    || "All",
    date_from:     text(src.code3)    || "",
    date_to:       text(src.code4)    || "",
    report_option: reportLabel,
  };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export const getProfitLossReportHtml = async (req: Request, res: Response): Promise<void> => {
  try {
    const params    = extractParams(req);
    const autoPrint = req.query.print === "true";
    const title     = text(req.query.title as string) || "Profit & Loss Report";

    const rawRows = await loadPnlData(params, req);
    if (!rawRows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const groups = groupByHeader(rawRows);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(groups, title, params, autoPrint));
  } catch (error: any) {
    console.error("P&L HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getProfitLossReportPdf = async (req: Request, res: Response): Promise<void> => {
  try {
    const params  = extractParams(req);
    const rawRows = await loadPnlData(params, req);

    if (!rawRows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const groups = groupByHeader(rawRows);
    const html   = renderHtml(groups, "Profit & Loss Report", params, true);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", "inline; filename=\"ProfitLoss.pdf\"");
    res.send(html);
  } catch (error: any) {
    console.error("P&L PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const getProfitLossReportExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const params  = extractParams(req);
    const rawRows = await loadPnlData(params, req);

    if (!rawRows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const groups = groupByHeader(rawRows);
    const buffer = buildExcelBuffer(groups, params);

    const fileName = `ProfitLoss_${params.date_from}_${params.date_to}.xlsx`.replace(/\//g, "-");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("P&L Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};