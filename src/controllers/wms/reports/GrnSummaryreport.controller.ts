import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface GroupSection {
  groupName:    string;
  rows:         ReportRow[];
  totalQty:     number;
  totalVolume:  number;
  totalGrossWt: number;
}

interface PrinSection {
  prinCode:     string;
  prinName:     string;
  groups:       GroupSection[];
  totalQty:     number;
  totalVolume:  number;
  totalGrossWt: number;
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
  if (conn) try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function dateText(value: unknown): string {
  if (!value) return "\u2014";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function numFmt(value: unknown, decimals = 0): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "\u2014";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function normalizeFilter(value: unknown): string {
  const v = text(value).trim();
  if (!v || v.toUpperCase() === "ALL") return "All";
  return v;
}

function parseMultiCodeFilter(value: string): string[] | null {
  if (value === "All") return null;
  if (!value.includes(",")) return null; // single code — proc handles it natively
  const list = value.split(",").map((c) => c.trim()).filter(Boolean);
  return list.length > 1 ? list : null;
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadGrnData(
  req: RequestWithUser,
  params: {
    loginid?:  string;
    prinCode?: string; 
    fromdate?: string;  
    todate?:   string; 
  } = {}
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const requestedPrin = normalizeFilter(params.prinCode);


    const multiCodes  = parseMultiCodeFilter(requestedPrin);
    const procPrinCode = multiCodes ? "All" : requestedPrin;

    const binds: Record<string, any> = {
      parameter: "WMS_Stock_GRN_Summary_Report",
      loginid:   params.loginid || text(req.user?.loginid) || "ADMIN",

      code1:  req.body.code1 || null,
      code2:  procPrinCode,
      code3:  normalizeFilter(params.fromdate),
      code4:  normalizeFilter(params.todate),
      code5:  null, code6: null, code7: null, code8: null, code9: null,

      ...Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`code${i + 10}`, null])
      ),

      number1: null, number2: null, number3: null, number4: null,
      date1:   null, date2:   null, date3:   null, date4:   null,

      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const procResult = await conn.execute(
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

    const rawSql = (procResult.outBinds as any).out_sql as string | null;
    console.log("[GrnSummaryReport] Generated SQL:", rawSql);
    if (multiCodes) {
      console.log("[GrnSummaryReport] Multi-principal filter requested, narrowing client-side to:", multiCodes);
    }

    if (!rawSql) {
      throw new Error(
        "PROC_BUILD_DYNAMIC_SQL_COMMON20 returned no SQL. " +
        "Ensure the WHEN 'WMS_Stock_GRN_Summary_Report' branch exists in the procedure."
      );
    }

    const dataResult = await conn.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    let rows = normalize(dataResult.rows as any[]);

    // Narrow down to just the selected principals when multiple were
    // requested. Case/whitespace-insensitive compare to be safe.
    if (multiCodes) {
      const wanted = new Set(multiCodes.map((c) => c.toUpperCase()));
      rows = rows.filter((r) => wanted.has(text(r.prin_code).trim().toUpperCase()));
    }

    return rows;
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping ─────────────────────────────────────────────────────────────────
// PRIN_CODE -> GROUP_NAME -> data rows -> group total -> principal total -> grand total

function groupRows(rows: ReportRow[]): PrinSection[] {
  const prinMap: Record<string, {
    prinCode: string; prinName: string;
    groups: Record<string, {
      groupName: string; rows: ReportRow[];
      totalQty: number; totalVolume: number; totalGrossWt: number;
    }>;
    totalQty: number; totalVolume: number; totalGrossWt: number;
  }> = {};

  for (const r of rows) {
    const prinKey  = text(r.prin_code)   || "\u2014";
    const groupKey = text(r.group_name)  || "Ungrouped";
    const qty      = parseFloat(String(r.qty_puom ?? r.qty ?? r.quantity)) || 0;
    const volume   = parseFloat(String(r.volume))    || 0;
    const grossWt  = parseFloat(String(r.gross_wt))  || 0;

    if (!prinMap[prinKey])
      prinMap[prinKey] = {
        prinCode: text(r.prin_code), prinName: text(r.prin_name),
        groups: {}, totalQty: 0, totalVolume: 0, totalGrossWt: 0,
      };
    const ps = prinMap[prinKey];
    ps.totalQty += qty; ps.totalVolume += volume; ps.totalGrossWt += grossWt;

    if (!ps.groups[groupKey])
      ps.groups[groupKey] = { groupName: groupKey, rows: [], totalQty: 0, totalVolume: 0, totalGrossWt: 0 };
    const gs = ps.groups[groupKey];
    gs.totalQty += qty; gs.totalVolume += volume; gs.totalGrossWt += grossWt;
    gs.rows.push(r);
  }

  return Object.values(prinMap).map((p) => ({
    ...p,
    groups: Object.values(p.groups),
  }));
}


function renderHtml(
  prins:       PrinSection[],
  reportTitle: string,
  loginId:     string,
  autoPrint:   boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const grandQty     = prins.reduce((s, p) => s + p.totalQty,     0);
  const grandVolume  = prins.reduce((s, p) => s + p.totalVolume,  0);
  const grandGrossWt = prins.reduce((s, p) => s + p.totalGrossWt, 0);

  const autoPrintScript = autoPrint
    ? "window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 300); });"
    : "";

  let bodyRows = "";

  for (const ps of prins) {
    bodyRows += "<tr class=\"prin-row\"><td colspan=\"12\">" +
      escapeHtml(ps.prinCode) + (ps.prinName ? " | " + escapeHtml(ps.prinName) : "") +
      "</td></tr>";

    for (const gs of ps.groups) {
      bodyRows += "<tr class=\"group-row\"><td colspan=\"12\">Group : " +
        escapeHtml(gs.groupName) + "</td></tr>";

      for (const dr of gs.rows) {
        const qty     = parseFloat(String(dr.qty_puom ?? dr.qty ?? dr.quantity)) || 0;
        const volume  = parseFloat(String(dr.volume))   || 0;
        const grossWt = parseFloat(String(dr.gross_wt)) || 0;
        bodyRows +=
          "<tr class=\"data-row\">" +
          "<td>" + escapeHtml(dr.grn_number || "\u2014") + "</td>" +
          "<td>" + escapeHtml(dr.job_no || "\u2014") + "</td>" +
          "<td>" + escapeHtml(dateText(dr.job_date)) + "</td>" +
          "<td>" + escapeHtml(dateText(dr.confirm_date)) + "</td>" +
          "<td>" + escapeHtml(dateText(dr.grn_date)) + "</td>" +
          "<td>" + escapeHtml(dr.container_no || "\u2014") + "</td>" +
          "<td>" + escapeHtml(dr.container_size || "\u2014") + "</td>" +
          "<td class=\"num\">" + escapeHtml(numFmt(qty)) + "</td>" +
          "<td class=\"num\">" + escapeHtml(numFmt(volume, 3)) + "</td>" +
          "<td>" + escapeHtml(dr.pallet_id || "\u2014") + "</td>" +
          "<td class=\"num\">" + escapeHtml(numFmt(grossWt, 3)) + "</td>" +
          "<td>" + escapeHtml(dr.user_id || "\u2014") + "</td>" +
          "</tr>";
      }

      bodyRows +=
        "<tr class=\"group-total\">" +
        "<td colspan=\"7\">Total For " + escapeHtml(gs.groupName) + "</td>" +
        "<td class=\"num\">" + escapeHtml(numFmt(gs.totalQty)) + "</td>" +
        "<td class=\"num\">" + escapeHtml(numFmt(gs.totalVolume, 3)) + "</td>" +
        "<td></td>" +
        "<td class=\"num\">" + escapeHtml(numFmt(gs.totalGrossWt, 3)) + "</td>" +
        "<td></td>" +
        "</tr>";
    }

    bodyRows +=
      "<tr class=\"prin-total\">" +
      "<td colspan=\"7\">Total For " + escapeHtml(ps.prinCode) +
      (ps.prinName ? " | " + escapeHtml(ps.prinName) : "") + "</td>" +
      "<td class=\"num\">" + escapeHtml(numFmt(ps.totalQty)) + "</td>" +
      "<td class=\"num\">" + escapeHtml(numFmt(ps.totalVolume, 3)) + "</td>" +
      "<td></td>" +
      "<td class=\"num\">" + escapeHtml(numFmt(ps.totalGrossWt, 3)) + "</td>" +
      "<td></td>" +
      "</tr>";
  }

  const grandRow =
    "<tr class=\"grand-total\">" +
    "<td colspan=\"7\">Grand Total</td>" +
    "<td class=\"num\">" + escapeHtml(numFmt(grandQty)) + "</td>" +
    "<td class=\"num\">" + escapeHtml(numFmt(grandVolume, 3)) + "</td>" +
    "<td></td>" +
    "<td class=\"num\">" + escapeHtml(numFmt(grandGrossWt, 3)) + "</td>" +
    "<td></td>" +
    "</tr>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 11px; color: #111827;
      background: #eef1f6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 297mm; min-height: 190mm;
      margin: 18px auto; background: #fff;
      padding: 10mm 12mm;
      border: 1px solid #c4cdd9;
      border-radius: 4px;
    }
    .rpt-header {
      background: #1e3a5f; color: #fff; text-align: center;
      font-size: 14px; font-weight: 700; letter-spacing: .08em;
      padding: 10px 16px; text-transform: uppercase;
      border-radius: 3px 3px 0 0;
    }
    .rpt-meta {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 2px 8px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 10px;
      font-size: 10px; color: #4b5563;
    }
    .rpt-meta strong { color: #111827; font-weight: 600; }
    table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    col.c0  { width: 9%;  } col.c1  { width: 8%;  } col.c2 { width: 8%; }
    col.c3  { width: 8%;  } col.c4  { width: 8%;  } col.c5 { width: 10%; }
    col.c6  { width: 7%;  } col.c7  { width: 6%;  } col.c8 { width: 8%; }
    col.c9  { width: 8%;  } col.c10 { width: 8%;  } col.c11 { width: 12%; }
    thead tr.th-main th {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 9.5px; padding: 7px 6px; text-align: center;
      border-right: 1px solid rgba(255,255,255,0.15);
    }
    thead tr.th-main th:last-child { border-right: none; }
    thead tr.th-main th.left { text-align: left; }
    thead tr.th-main th.num  { text-align: right; }
    tr.prin-row td {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 11px; padding: 5px 10px;
      border-bottom: 1px solid rgba(255,255,255,.10);
    }
    tr.group-row td {
      background: #dce4ef; color: #1e3a5f; font-weight: 700;
      font-size: 11px; padding: 4px 10px 4px 20px;
      border-bottom: 1px solid #c8d4e4;
    }
    tbody tr.data-row td {
      padding: 4px 6px; border-bottom: 1px solid #e5e7eb;
      color: #374151; font-size: 10.5px;
      white-space: normal; word-wrap: break-word; vertical-align: top;
    }
    tbody tr.data-row td:first-child { padding-left: 24px; }
    tbody tr.data-row:nth-child(even) td { background: #f9fafb; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    tr.group-total td {
      background: #c8d4e4; padding: 4px 6px; font-size: 10.5px;
      font-weight: 700; color: #1e3a5f; white-space: nowrap;
    }
    tr.prin-total td {
      background: #a8b8d0; padding: 5px 6px; font-size: 10.5px;
      font-weight: 700; color: #0f2040; white-space: nowrap;
    }
    tr.grand-total td {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 11px; padding: 8px 6px;
      border-top: 2px solid #162d4a;
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
      tr.prin-row, tr.group-row { break-after: avoid; page-break-after: avoid; }
      tr.group-total, tr.prin-total, tr.grand-total { break-before: avoid; page-break-before: avoid; }
    }
  </style>
</head>
<body>

  <div class="sheet">
    <div class="rpt-header">${escapeHtml(reportTitle)}</div>
    <div class="rpt-meta">
      <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;
            Print User :&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
      <span>Page 1 of 1</span>
    </div>

    <table class="rpt-table" id="grnTable">
      <colgroup>
        <col class="c0"/><col class="c1"/><col class="c2"/><col class="c3"/>
        <col class="c4"/><col class="c5"/><col class="c6"/><col class="c7"/>
        <col class="c8"/><col class="c9"/><col class="c10"/><col class="c11"/>
      </colgroup>
      <thead>
        <tr class="th-main">
          <th class="left">GRN No</th>
          <th class="left">Job No</th>
          <th>Job Date</th>
          <th>Confirm Date</th>
          <th>GRN Date</th>
          <th class="left">Container No</th>
          <th>Size</th>
          <th class="num">Qty</th>
          <th class="num">Volume</th>
          <th class="left">Pallet Id</th>
          <th class="num">Gross Wt</th>
          <th class="left">User Id</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        ${grandRow}
      </tbody>
    </table>

    <div class="rpt-footer">
      <span>Report Name : <code>GRN Summary</code></span>
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

// ─── Excel builder ────────────────────────────────────────────────────────────

const STYLE_ID = {
  default:       0,
  header:        1,
  sectionPrin:   2,
  sectionGroup:  3,
  value:         4,
  totalGroup:    5,
  totalPrin:     6,
  totalGrand:    7,
  numValue:      8,
  numTotalGroup: 9,
  numTotalPrin:  10,
  numGrand:      11,
} as const;

type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }
function xc(v: unknown, style: StyleKey): XlCell { return { v, s: STYLE_ID[style] }; }

function buildExcelBuffer(prins: PrinSection[]): Buffer {
  const NCOLS = 12;
  type Row = (XlCell | null)[];
  const skip = null;
  const rows: Row[] = [];

  rows.push([xc("GRN Report (Summary)", "header"), ...Array(NCOLS - 1).fill(skip)]);
  rows.push(Array(NCOLS).fill(skip));
  rows.push([
    xc("GRN No",      "header"), xc("Job No",       "header"), xc("Job Date",     "header"),
    xc("Confirm Date","header"), xc("GRN Date",      "header"), xc("Container No", "header"),
    xc("Size",        "header"), xc("Qty",           "header"), xc("Volume",       "header"),
    xc("Pallet Id",   "header"), xc("Gross Wt",       "header"), xc("User Id",      "header"),
  ]);

  for (const ps of prins) {
    rows.push([xc(ps.prinCode + (ps.prinName ? " | " + ps.prinName : ""), "sectionPrin"), ...Array(NCOLS - 1).fill(skip)]);

    for (const gs of ps.groups) {
      rows.push([xc("Group : " + gs.groupName, "sectionGroup"), ...Array(NCOLS - 1).fill(skip)]);

      for (const dr of gs.rows) {
        const qty     = parseFloat(String(dr.qty_puom ?? dr.qty ?? dr.quantity)) || 0;
        const volume  = parseFloat(String(dr.volume))   || 0;
        const grossWt = parseFloat(String(dr.gross_wt)) || 0;
        rows.push([
          xc(text(dr.grn_number)      || "\u2014", "value"),
          xc(text(dr.job_no)          || "\u2014", "value"),
          xc(dateText(dr.job_date),                "value"),
          xc(dateText(dr.confirm_date),             "value"),
          xc(dateText(dr.grn_date),                 "value"),
          xc(text(dr.container_no)    || "\u2014", "value"),
          xc(text(dr.container_size)  || "\u2014", "value"),
          xc(numFmt(qty),                           "numValue"),
          xc(numFmt(volume, 3),                     "numValue"),
          xc(text(dr.pallet_id)       || "\u2014", "value"),
          xc(numFmt(grossWt, 3),                    "numValue"),
          xc(text(dr.user_id)         || "\u2014", "value"),
        ]);
      }

      rows.push([
        xc("Total For " + gs.groupName, "totalGroup"),
        skip, skip, skip, skip, skip, skip,
        xc(numFmt(gs.totalQty), "numTotalGroup"),
        xc(numFmt(gs.totalVolume, 3), "numTotalGroup"),
        skip,
        xc(numFmt(gs.totalGrossWt, 3), "numTotalGroup"),
        skip,
      ]);
    }

    rows.push([
      xc("Total For " + ps.prinCode + (ps.prinName ? " | " + ps.prinName : ""), "totalPrin"),
      skip, skip, skip, skip, skip, skip,
      xc(numFmt(ps.totalQty), "numTotalPrin"),
      xc(numFmt(ps.totalVolume, 3), "numTotalPrin"),
      skip,
      xc(numFmt(ps.totalGrossWt, 3), "numTotalPrin"),
      skip,
    ]);
  }

  const grandQty     = prins.reduce((s, p) => s + p.totalQty,     0);
  const grandVolume  = prins.reduce((s, p) => s + p.totalVolume,  0);
  const grandGrossWt = prins.reduce((s, p) => s + p.totalGrossWt, 0);
  rows.push([
    xc("Grand Total", "totalGrand"),
    skip, skip, skip, skip, skip, skip,
    xc(numFmt(grandQty), "numGrand"),
    xc(numFmt(grandVolume, 3), "numGrand"),
    skip,
    xc(numFmt(grandGrossWt, 3), "numGrand"),
    skip,
  ]);

  const COL_WIDTHS = [14, 14, 12, 12, 12, 16, 10, 10, 10, 12, 10, 12];
  const colXml = COL_WIDTHS.map((w, i) =>
    "<col min=\"" + (i + 1) + "\" max=\"" + (i + 1) + "\" width=\"" + w + "\" customWidth=\"1\"/>"
  ).join("");

  const colLetter = (i: number) =>
    i < 26 ? String.fromCharCode(65 + i) : "A" + String.fromCharCode(65 + i - 26);

  const merges: string[] = [];
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let ci = 0;
    while (ci < row.length) {
      if (row[ci] !== null) {
        let end = ci + 1;
        while (end < row.length && row[end] === null) end++;
        if (end - 1 > ci) {
          const startCol = colLetter(ci);
          const endCol   = colLetter(end - 1);
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
    const ht = rn === 1 ? " ht=\"22\" customHeight=\"1\"" : "";
    let rowXml = "<row r=\"" + rn + "\"" + ht + ">";
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = colLetter(ci) + rn;
      if (typeof cell.v === "number") {
        rowXml += "<c r=\"" + ref + "\" s=\"" + cell.s + "\"><v>" + cell.v + "</v></c>";
      } else {
        rowXml += "<c r=\"" + ref + "\" s=\"" + cell.s + "\" t=\"inlineStr\"><is><t>" +
          escapeXml(cell.v ?? "") + "</t></is></c>";
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? "<mergeCells count=\"" + merges.length + "\">" +
      merges.map((m) => "<mergeCell ref=\"" + m + "\"/>").join("") +
      "</mergeCells>"
    : "";

  const sheetXml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"" +
    " xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
    "<sheetFormatPr defaultRowHeight=\"15\"/>" +
    "<cols>" + colXml + "</cols>" +
    "<sheetData>" + sheetDataXml + "</sheetData>" +
    mergeXml +
    "</worksheet>";

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F2040"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCE4EF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC8D4E4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFA8B8D0"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF1E3A5F"/></left><right style="thin"><color rgb="FF1E3A5F"/></right>
      <top style="thin"><color rgb="FF1E3A5F"/></top><bottom style="thin"><color rgb="FF1E3A5F"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="2"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1" indent="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="2"/></xf>
    <xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="GRN Summary" sheetId="1" r:id="rId1"/></sheets>
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

// ─── Route helpers ────────────────────────────────────────────────────────────

function extractParams(req: RequestWithUser) {
  const src = { ...req.query, ...req.body };
  return {
    loginid:  text(req.user?.loginid),
    prinCode: normalizeFilter(src.code2),
    fromdate: normalizeFilter(src.code3),
    todate:   normalizeFilter(src.code4),
  };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export const getGrnSummaryReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const reportTitle = text(req.query.title as string) || "GRN Report (Summary)";
    const autoPrint   = req.query.print === "true";
    const params      = extractParams(req);
    console.log("GRN Summary HTML params:", params);
    console.log("GRN summary req", req.body)

    const rows = await loadGrnData(req, params);
    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const prins = groupRows(rows);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(prins, reportTitle, params.loginid, autoPrint));
  } catch (error: any) {
    console.error("GRN Summary HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getGrnSummaryReportPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows   = await loadGrnData(req, params);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const prins = groupRows(rows);
    const html  = renderHtml(prins, "GRN Report (Summary)", params.loginid, true);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", "inline; filename=\"GRN_Summary.pdf\"");
    res.send(html);
  } catch (error: any) {
    console.error("GRN Summary PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const getGrnSummaryReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const params = extractParams(req);
    const rows   = await loadGrnData(req, params);

    if (!rows.length) {
      res.status(200).json({ success: false, message: "No data found for the selected criteria." });
      return;
    }

    const prins  = groupRows(rows);
    const buffer = buildExcelBuffer(prins);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"GRN_Summary.xlsx\"");
    res.end(buffer);
  } catch (error: any) {
    console.error("GRN Summary Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};