import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type TLevel = "l2" | "l3" | "l4";

type ReportRow = Record<string, any>;

// ─── Level Config ─────────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<
  TLevel,
  { apiParameter: string; codeField: string; codeHeader: string }
> = {
  l2: {
    apiParameter: "BOLD_REPORT_TRAIL_STATEMENT_REPORT",
    codeField: "l2_code",
    codeHeader: "L2 Code",
  },
  l3: {
    apiParameter: "BOLD_REPORT_TRAIL_STATEMENT_REPORT_L3",
    codeField: "l3_code",
    codeHeader: "L3 Code",
  },
  l4: {
    apiParameter: "BOLD_REPORT_TRAIL_STATEMENT_REPORT_L4",
    codeField: "l4_code",
    codeHeader: "L4 Code",
  },
};

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), {
      status: 400,
    });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn)
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function amount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).substring(0, 10);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
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

// ─── Data Loader ──────────────────────────────────────────────────────────────

async function loadReportData(
  req: RequestWithUser,
  level: TLevel,
  companyCode: string,
  fromDate: string,
  toDate: string,
  divisionCode: string,
  codeFilter: string
) {
  const conn = await getConn(req);
  const config = LEVEL_CONFIG[level];

  try {
    // Call PROC_BUILD_DYNAMIC_SQL_COMMON to get the dynamic SELECT SQL
    const result = await conn.execute(
      `
      DECLARE
        v_sql CLOB;
      BEGIN
        WMSTST.PROC_BUILD_DYNAMIC_SQL_COMMON(
          :parameter,
          :loginid,
          :code1,
          :code2,
          :code3,
          :code4,
          :number1,
          :number2,
          :number3,
          :number4,
          :date1,
          :date2,
          :date3,
          :date4,
          v_sql
        );
        :out_sql := v_sql;
      END;
      `,
      {
        parameter: config.apiParameter,
        loginid: req.user?.loginid ?? "",
        code1: companyCode,
        code2: divisionCode || "All",
        code3: codeFilter || "",
        code4: `${fromDate}|${toDate}`,
        number1: 0,
        number2: 0,
        number3: 0,
        number4: 0,
        date1: "",
        date2: "",
        date3: "",
        date4: "",
        out_sql: {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 32767,
        },
      }
    );

    interface ProcOut {
      out_sql: string | null;
    }

    const outBinds = result.outBinds as ProcOut;
    const dynamicSql = outBinds?.out_sql;

    if (!dynamicSql) {
      throw Object.assign(new Error("Procedure returned no SQL"), {
        status: 400,
      });
    }

    console.log("Trial Balance Dynamic SQL:", dynamicSql);

    const dataResult = await conn.execute(dynamicSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return normalize(dataResult.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderHtml(
  rows: ReportRow[],
  level: TLevel,
  params: {
    companyCode: string;
    fromDate: string;
    toDate: string;
    loginId: string;
  },
  autoPrint: boolean
): string {
  const config = LEVEL_CONFIG[level];

  const totals = rows.reduce(
    (acc, row) => ({
      opening: acc.opening + amount(row.opening),
      debit: acc.debit + amount(row.debit_amount),
      credit: acc.credit + amount(row.credit_amount),
      amount: acc.amount + amount(row.amount),
    }),
    { opening: 0, debit: 0, credit: 0, amount: 0 }
  );

  const firstRow = rows[0] ?? {};
  const fromDateDisplay = dateText(firstRow.from_date ?? params.fromDate);
  const toDateDisplay = dateText(firstRow.to_date ?? params.toDate);
  const title =
    text(firstRow.title) ||
    `Group 1 ( TB ) for the Period ${fromDateDisplay} – ${toDateDisplay}`;
  const reportName =
    text(firstRow.report) || `rpt_ac_trailbalance_${level}`;
  const username = text(firstRow.username) || params.loginId;
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const dataRows = rows
    .map(
      (row) => `
    <tr>
      <td class="center">${escapeHtml(row[config.codeField])}</td>
      <td class="left">${escapeHtml(row.ac_name)}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(row.opening)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(row.debit_amount)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(row.credit_amount)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(row.amount)))}</td>
    </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
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

    /* ── Logo / Header ── */
    .logo-area { margin-bottom: 16px; }
    .divider-thick { border-top: 2px solid #000; margin: 10px 0 6px; }
    .divider-thin  { border-top: 1px solid #000; margin: 6px 0 10px; }
    .meta-row { display: flex; align-items: baseline; font-size: 12px; margin-bottom: 3px; }
    .meta-label { font-weight: 700; width: 60px; flex-shrink: 0; }

    /* ── Data Table ── */
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th {
      border: 1px solid #000;
      padding: 3px 8px;
      text-align: center;
      font-weight: 700;
      background: #fff;
    }
    th.right { text-align: right; }
    td { border: 1px solid #ccc; padding: 2px 8px; }
    td.center { text-align: center; }
    td.left   { text-align: left; }
    td.num    { text-align: right; font-variant-numeric: tabular-nums; }

    /* ── Totals row ── */
    tr.total-row td {
      border: 2px solid #000;
      font-weight: 700;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    tr.total-row td.empty { border: 1px solid #ccc; }

    /* ── End of report ── */
    .end-of-report {
      text-align: center;
      margin-top: 16px;
      margin-bottom: 8px;
      font-size: 12px;
      border-top: 1px solid #ccc;
      padding-top: 8px;
    }

    /* ── Footer ── */
    .report-footer {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #666;
      border-top: 1px solid #ccc;
      padding-top: 6px;
      margin-top: 8px;
    }

    /* ── Print / PDF ── */
    .actions { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; }
    .actions button {
      border: 1px solid #cbd5e1;
      background: white;
      border-radius: 8px;
      padding: 8px 12px;
      font-weight: 700;
      cursor: pointer;
    }

    @media print {
      body { background: white; }
      .sheet { border: 0; margin: 0; width: auto; min-height: auto; padding: 0; }
      .actions { display: none; }
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
      .print-body-padding { padding-bottom: 40px !important; }
    }
  </style>
</head>
<body>
  <main class="sheet">

    <!-- ── Logo ── -->
    <div class="logo-area">
      <svg width="180" height="56" viewBox="0 0 360 112" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <rect width="360" height="112" rx="4" fill="#1a5f4a"/>
        <text x="16" y="46" font-family="Arial" font-size="26" font-weight="700" fill="#d4a017">al madina المدينة</text>
        <text x="16" y="72" font-family="Arial" font-size="15" font-weight="400" fill="#d4a017" letter-spacing="4">LOGISTICS اللوجستية</text>
        <polygon points="310,20 355,56 310,92" fill="#d4a017"/>
      </svg>
    </div>

    <div class="divider-thick"></div>

    <!-- ── Meta ── -->
    <div class="meta-row"><span class="meta-label">Title :</span><span>${escapeHtml(title)}</span></div>
    <div class="meta-row"><span class="meta-label">Date :</span><span>${escapeHtml(printDateTime)}</span></div>
    <div class="meta-row"><span class="meta-label">User :</span><span>${escapeHtml(username)}</span></div>
    <div class="meta-row"><span class="meta-label">Report :</span><span>${escapeHtml(reportName)}</span></div>

    <div class="divider-thin"></div>

    <!-- ── Data Table ── -->
    <div class="print-body-padding">
      <table>
        <thead>
          <tr>
            <th style="width:80px">${escapeHtml(config.codeHeader)}</th>
            <th>Account Name</th>
            <th class="right">Opening</th>
            <th class="right">Debit Amount</th>
            <th class="right">Credit Amount</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${dataRows || `<tr><td colspan="6" class="center" style="color:#666">No data found</td></tr>`}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td class="empty" colspan="2"></td>
            <td>${escapeHtml(fmtNumber(totals.opening))}</td>
            <td>${escapeHtml(fmtNumber(totals.debit))}</td>
            <td>${escapeHtml(fmtNumber(totals.credit))}</td>
            <td>${escapeHtml(fmtNumber(totals.amount))}</td>
          </tr>
        </tfoot>
      </table>

      <div class="end-of-report">End of Report</div>
    </div>

    <!-- ── Footer ── -->
    <div class="report-footer print-footer">
      <span>Report: ${escapeHtml(reportName)}</span>
      <span>Powered by Bayanat Technology</span>
    </div>

  </main>

  ${autoPrint ? "<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>" : ""}
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
      top: { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left: { style: "thin", color: { rgb: "1A5F4A" } },
      right: { style: "thin", color: { rgb: "1A5F4A" } },
    },
  },
  meta: {
    font: { bold: true, sz: 10, color: { rgb: "000000" } },
    alignment: { vertical: "center" },
  },
  tableHead: {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5F4A" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: "1A5F4A" } },
      bottom: { style: "thin", color: { rgb: "1A5F4A" } },
      left: { style: "thin", color: { rgb: "1A5F4A" } },
      right: { style: "thin", color: { rgb: "1A5F4A" } },
    },
  },
  normal: {
    alignment: { vertical: "top", wrapText: true },
    border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } },
  },
  number: {
    alignment: { horizontal: "right", vertical: "top" },
    numFmt: "#,##0.000",
    border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } },
  },
  totalLabel: {
    font: { bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "F8F8F8" } },
    border: {
      top: { style: "medium", color: { rgb: "000000" } },
      bottom: { style: "medium", color: { rgb: "000000" } },
      left: { style: "medium", color: { rgb: "000000" } },
      right: { style: "medium", color: { rgb: "000000" } },
    },
  },
  totalNumber: {
    font: { bold: true },
    fill: { fgColor: { rgb: "F8F8F8" } },
    alignment: { horizontal: "right" },
    numFmt: "#,##0.000",
    border: {
      top: { style: "medium", color: { rgb: "000000" } },
      bottom: { style: "medium", color: { rgb: "000000" } },
      left: { style: "medium", color: { rgb: "000000" } },
      right: { style: "medium", color: { rgb: "000000" } },
    },
  },
  footer: {
    font: { italic: true, color: { rgb: "64748B" } },
    alignment: { horizontal: "center" },
  },
};

const styleIdBySignature = new Map<string, number>([
  [JSON.stringify(excelStyles.title), 1],
  [JSON.stringify(excelStyles.meta), 2],
  [JSON.stringify(excelStyles.tableHead), 3],
  [JSON.stringify(excelStyles.normal), 4],
  [JSON.stringify(excelStyles.number), 5],
  [JSON.stringify(excelStyles.totalLabel), 6],
  [JSON.stringify(excelStyles.totalNumber), 7],
  [JSON.stringify(excelStyles.footer), 8],
]);

function applyStyle(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  style: Record<string, unknown>
) {
  const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  if (!ws[ref]) ws[ref] = { t: "s", v: "" };
  (ws[ref] as any).s = style;
}

function styleRange(
  ws: XLSX.WorkSheet,
  row: number,
  startCol: number,
  endCol: number,
  style: Record<string, unknown>
) {
  for (let col = startCol; col <= endCol; col++) applyStyle(ws, row, col, style);
}

function buildExcelSheet(
  rows: ReportRow[],
  level: TLevel,
  params: {
    companyCode: string;
    fromDate: string;
    toDate: string;
    loginId: string;
  }
): XLSX.WorkSheet {
  const config = LEVEL_CONFIG[level];

  const totals = rows.reduce(
    (acc, row) => ({
      opening: acc.opening + amount(row.opening),
      debit: acc.debit + amount(row.debit_amount),
      credit: acc.credit + amount(row.credit_amount),
      amount: acc.amount + amount(row.amount),
    }),
    { opening: 0, debit: 0, credit: 0, amount: 0 }
  );

  const firstRow = rows[0] ?? {};
  const fromDateDisplay = dateText(firstRow.from_date ?? params.fromDate);
  const toDateDisplay = dateText(firstRow.to_date ?? params.toDate);
  const title =
    text(firstRow.title) ||
    `Group 1 ( TB ) for the Period ${fromDateDisplay} – ${toDateDisplay}`;
  const reportName =
    text(firstRow.report) || `rpt_ac_trailbalance_${level}`;
  const username = text(firstRow.username) || params.loginId;
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Build rows array
  const sheetRows: any[][] = [
    // Row 1: Title (merged across all 6 cols)
    ["al madina LOGISTICS - Trial Balance Report", "", "", "", "", ""],
    // Row 2: blank
    [],
    // Rows 3-6: Meta
    ["Title :", title, "", "", "", ""],
    ["Date :", printDateTime, "", "", "", ""],
    ["User :", username, "", "", "", ""],
    ["Report :", reportName, "", "", "", ""],
    // Row 7: blank
    [],
    // Row 8: Table header
    [config.codeHeader, "Account Name", "Opening", "Debit Amount", "Credit Amount", "Amount"],
  ];

  const dataStartRow = sheetRows.length + 1; // 1-indexed

  // Data rows
  rows.forEach((row) => {
    sheetRows.push([
      text(row[config.codeField]),
      text(row.ac_name),
      amount(row.opening),
      amount(row.debit_amount),
      amount(row.credit_amount),
      amount(row.amount),
    ]);
  });

  if (!rows.length) {
    sheetRows.push(["", "No data found", "", "", "", ""]);
  }

  // Totals row
  const totalRowIndex = sheetRows.length + 1; // 1-indexed
  sheetRows.push(["", "", totals.opening, totals.debit, totals.credit, totals.amount]);

  // Blank + footer
  sheetRows.push([]);
  sheetRows.push(["", "", "", "", "", "Powered by Bayanat Technology"]);

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, // Code
    { wch: 40 }, // Account Name
    { wch: 18 }, // Opening
    { wch: 18 }, // Debit
    { wch: 18 }, // Credit
    { wch: 18 }, // Amount
  ];

  // Row heights
  ws["!rows"] = sheetRows.map((_, i) => {
    if (i === 0) return { hpt: 28 };
    if (i === 7) return { hpt: 22 }; // header row
    return { hpt: 18 };
  });

  // Merges: title row spans all cols
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, // Title
    { s: { r: 2, c: 1 }, e: { r: 2, c: 5 } }, // Title meta value
    { s: { r: 3, c: 1 }, e: { r: 3, c: 5 } }, // Date meta value
    { s: { r: 4, c: 1 }, e: { r: 4, c: 5 } }, // User meta value
    { s: { r: 5, c: 1 }, e: { r: 5, c: 5 } }, // Report meta value
    // Total row: empty cols 1-2 merged
    { s: { r: totalRowIndex - 1, c: 0 }, e: { r: totalRowIndex - 1, c: 1 } },
  ];

  // Freeze pane below header
  ws["!freeze"] = { xSplit: 0, ySplit: 8 };

  // Apply styles
  styleRange(ws, 1, 1, 6, excelStyles.title);          // Title row
  styleRange(ws, 3, 1, 2, excelStyles.meta);            // Meta rows
  styleRange(ws, 4, 1, 2, excelStyles.meta);
  styleRange(ws, 5, 1, 2, excelStyles.meta);
  styleRange(ws, 6, 1, 2, excelStyles.meta);
  styleRange(ws, 8, 1, 6, excelStyles.tableHead);       // Table header

  for (let r = dataStartRow; r < dataStartRow + Math.max(rows.length, 1); r++) {
    styleRange(ws, r, 1, 2, excelStyles.normal);
    styleRange(ws, r, 3, 6, excelStyles.number);
  }

  // Total row
  styleRange(ws, totalRowIndex, 1, 2, excelStyles.totalLabel);
  styleRange(ws, totalRowIndex, 3, 6, excelStyles.totalNumber);

  return ws;
}

function workbookBufferFromSheet(ws: XLSX.WorkSheet): Buffer {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

  const getStyleId = (cell: XLSX.CellObject | undefined) => {
    const style = (cell as any)?.s;
    if (!style) return 0;
    return styleIdBySignature.get(JSON.stringify(style)) || 0;
  };

  const colXml = (ws["!cols"] || [])
    .map(
      (col: any, index: number) =>
        `<col min="${index + 1}" max="${index + 1}" width="${Number(col.wch || 12)}" customWidth="1"/>`
    )
    .join("");

  let sheetData = "";
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref] as XLSX.CellObject | undefined;
      const styleId = getStyleId(cell);
      if (!cell && !styleId) continue;
      const attrs = `r="${ref}"${styleId ? ` s="${styleId}"` : ""}`;
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c ${attrs}><v>${value}</v></c>`);
      } else {
        cells.push(
          `<c ${attrs} t="inlineStr"><is><t>${escapeXml(value ?? "")}</t></is></c>`
        );
      }
    }
    if (cells.length) {
      const rowInfo = (ws["!rows"] || [])[r] as
        | { hpt?: number; hpx?: number }
        | undefined;
      const rowHeight =
        rowInfo?.hpt || (rowInfo?.hpx ? rowInfo.hpx * 0.75 : undefined);
      const rowAttrs = `r="${r + 1}"${
        rowHeight
          ? ` ht="${Number(rowHeight).toFixed(2)}" customHeight="1"`
          : ""
      }`;
      sheetData += `<row ${rowAttrs}>${cells.join("")}</row>`;
    }
  }

  const merges = (ws["!merges"] || [])
    .map((merge) => `<mergeCell ref="${XLSX.utils.encode_range(merge)}"/>`)
    .join("");
  const mergeXml = merges
    ? `<mergeCells count="${(ws["!merges"] || []).length}">${merges}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;

  // Styles for trial balance (green theme matching al madina logo)
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0.000"/>
  </numFmts>
  <fonts count="6">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Arial"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A5F4A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8F8F8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="5">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF1A5F4A"/></left>
      <right style="thin"><color rgb="FF1A5F4A"/></right>
      <top style="thin"><color rgb="FF1A5F4A"/></top>
      <bottom style="thin"><color rgb="FF1A5F4A"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border>
      <left style="medium"><color rgb="FF000000"/></left>
      <right style="medium"><color rgb="FF000000"/></right>
      <top style="medium"><color rgb="FF000000"/></top>
      <bottom style="medium"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: title -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2: meta -->
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 3: tableHead -->
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 4: normal -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <!-- 5: number -->
    <xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
    <!-- 6: totalLabel -->
    <xf numFmtId="0" fontId="4" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <!-- 7: totalNumber -->
    <xf numFmtId="164" fontId="4" fillId="3" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right"/>
    </xf>
    <!-- 8: footer -->
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
      <alignment horizontal="center"/>
    </xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Trial Balance" sheetId="1" r:id="rId1"/></sheets>
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
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Request Param Parser ─────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  // ── Level from URL param only ──
  const level = text(req.params.level).toLowerCase() as TLevel;
 
  if (!["l2", "l3", "l4"].includes(level)) {
    throw Object.assign(
      new Error("Invalid level. Must be l2, l3, or l4."),
      { status: 400 }
    );
  }
 
  // ── All other values from POST body ──
  const companyCode  = text(req.body.company_code  || req.user?.company_code);
  const fromDate     = text(req.body.from_date);
  const toDate       = text(req.body.to_date);
  const divisionCode = text(req.body.division_code || "All");
 
  if (!companyCode || !fromDate || !toDate) {
    throw Object.assign(
      new Error("company_code, from_date, and to_date are required"),
      { status: 400 }
    );
  }
 
  // ── Code filter: body key matches the level's codeField (e.g. l2_code) ──
  // Accepts an array ["10","11",...] and joins to "10,11,..."
  const config = LEVEL_CONFIG[level];
  const rawFilter =
    req.body[config.codeField] ??   // e.g. req.body.l2_code
    req.body.code_filter            ??   // fallback generic key
    [];
  const codeFilter = Array.isArray(rawFilter)
    ? rawFilter.join(",")
    : text(rawFilter);
 
  return { level, companyCode, fromDate, toDate, divisionCode, codeFilter };
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * GET /api/reports/trial-balance/:level/html
 * Query: company_code, from_date, to_date, division_code?, code_filter?
 */
export const getTrialBalanceReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadReportData(
      req,
      params.level,
      params.companyCode,
      params.fromDate,
      params.toDate,
      params.divisionCode,
      params.codeFilter
    );

    const html = renderHtml(
      rows,
      params.level,
      {
        companyCode: params.companyCode,
        fromDate: params.fromDate,
        toDate: params.toDate,
        loginId: req.user?.loginid ?? "",
      },
      req.query.print !== "false"
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Trial Balance HTML error:", error);
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message || "Unable to generate report" });
  }
};

/**
 * GET /api/reports/trial-balance/:level/excel
 * Query: company_code, from_date, to_date, division_code?, code_filter?
 */
export const exportTrialBalanceReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadReportData(
      req,
      params.level,
      params.companyCode,
      params.fromDate,
      params.toDate,
      params.divisionCode,
      params.codeFilter
    );

    const ws = buildExcelSheet(rows, params.level, {
      companyCode: params.companyCode,
      fromDate: params.fromDate,
      toDate: params.toDate,
      loginId: req.user?.loginid ?? "",
    });

    const buffer = workbookBufferFromSheet(ws);
    const filename = `trial_balance_${params.level}_${params.companyCode}_${params.fromDate}_${params.toDate}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Trial Balance Excel error:", error);
    res
      .status(error.status || 500)
      .json({ success: false, message: error.message || "Unable to export report" });
  }
};