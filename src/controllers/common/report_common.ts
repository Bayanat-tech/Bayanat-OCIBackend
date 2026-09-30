import oracledb from "oracledb";
import { RequestWithUser } from "../../interfaces/common.interface";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";


type CompanyHeaderRow = {
  company_name: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  city: string | null;
  country: string | null;
  logo: string | null;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeRow(row: Record<string, any> | undefined): CompanyHeaderRow | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const key of Object.keys(row)) out[key.toLowerCase()] = row[key];
  return out as CompanyHeaderRow;
}

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid) {
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  }
  if (!tenantId) {
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  }
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn) {
    try {
      await conn.close();
    } catch (e) {
      console.warn("Close conn error:", e);
    }
  }
}

function printDateTimeNow(): string {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/*  Shared CSS – matches the Enquiry List PDF                          */
/* ------------------------------------------------------------------ */

export const REPORT_HEADER_CSS = `
  .company-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    width: 100%;
    box-sizing: border-box;
    padding: 0 0 14px 0;
    margin: 0 0 8px 0;
  }
  .company-logo-wrap {
    flex: 0 0 auto;
    max-width: 220px;
    display: flex;
    align-items: center;
  }
  .company-logo {
    max-height: 64px;
    max-width: 220px;
    object-fit: contain;
    display: block;
  }
  .company-name-block {
    flex: 1 1 auto;
    text-align: right;
    min-width: 0;
  }
  .company-name {
    font-size: 20px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 8px 0;
    line-height: 1.2;
  }
  .company-address {
    font-size: 11px;
    color: #64748b;
    line-height: 1.5;
    margin: 0;
  }
  .company-address-line {
    display: block;
  }
  .company-header--empty .company-name {
    color: #94a3b8;
  }
`;

export const REPORT_FOOTER_CSS = `
  .report-footer {
    width: 100%;
    box-sizing: border-box;
    border-top: 1px solid #e2e8f0;
    padding-top: 6px;
    margin-top: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    color: #64748b;
  }
  .report-footer .footer-left,
  .report-footer .footer-right {
    white-space: nowrap;
  }
`;

/** Common CSS for all HTML reports (tables, groups, print, sheet) */
export const COMMON_REPORT_CSS = `
  @page {
    size: A4;
    margin: 8mm 8mm 12mm 8mm;
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font-family: Inter;
      font-size: 11px;
      color: #64748b;
    }
  }
  * {
    box-sizing: border-box;
    /* Make browsers print background colors, borders and zebra rows exactly as on screen */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    margin: 0;
    color: #1e293b;
    font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    background: #fff;
  }
  .sheet { padding: 0; }
  .paper {
    max-width: 210mm;
    margin: 0 auto;
    background: white;
    padding: 0;
  }

  /* Outer shell table – header/footer repeat on print pages */
  table.report-shell {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  table.report-shell > thead > tr > td,
  table.report-shell > tfoot > tr > td,
  table.report-shell > tbody > tr > td {
    border: 0;
    padding: 0;
    vertical-align: top;
  }

  /* ===== Report title + section strip (same as Enquiry List) ===== */
  .report-title,
  .doc-title-row h1 {
    margin: 12px 0 16px 0;
    font-size: 20px;
    font-weight: 700;
    color: #0b4ca1;
    line-height: 1.25;
  }
  .section-strip,
  .group-title {
    background: #e8f0fa;
    color: #0b4ca1;
    font-size: 11px;
    font-weight: 700;
    padding: 9px 10px;
    margin: 0 0 12px 0;
  }
  .group { margin-top: 10px; }

  /* ===== Data table (same as Enquiry List) ===== */
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 0;
    font-size: 11px;
  }
  table.data-table th,
  table.data-table td {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  table.data-table thead th {
    background: #e8f0fa;
    color: #0b4ca1;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    padding: 9px 8px;
    border: 0;
    border-bottom: 2px solid #0b4ca1;
    line-height: 1.25;
  }
  table.data-table thead th.left { text-align: left; }
  table.data-table thead th.num  { text-align: right; }
  table.data-table tbody td {
    padding: 8px;
    font-size: 11px;
    font-weight: 400;
    color: #334155;
    vertical-align: top;
    background: #fff;
    border: 0;
    border-bottom: 1px solid #e2e8f0;
  }
  table.data-table tbody tr:nth-child(even) td { background: #f8fafc; }
  table.data-table td.num    { text-align: right; font-variant-numeric: tabular-nums; }
  table.data-table td.center { text-align: center; }
  table.data-table td.primary-text,
  table.data-table td.strong { font-weight: 700; color: #0b4ca1; }
  table.data-table td.muted  { color: #94a3b8; font-style: italic; text-align: center; }

  .right { text-align: right; }
  .center { text-align: center; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; }
  .primary-text { color: #0b4ca1; font-weight: 700; }
  .muted { color: #64748b; }

  .empty {
    border: 1px dashed #cbd5e1;
    background: #f8fafc;
    text-align: center;
    padding: 56px;
    margin-top: 14px;
    color: #64748b;
    font-weight: 700;
  }

  .actions {
    position: fixed;
    top: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    z-index: 20;
  }
  .actions button {
    height: 34px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: white;
    font-weight: 700;
    padding: 0 13px;
    cursor: pointer;
  }
  .actions button.primary {
    background: #0b4ca1;
    border-color: #0b4ca1;
    color: white;
  }

  @media print {
    html, body {
      height: 100%;
      margin: 0;
      background: white;
      color: #1e293b;
      font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .actions, .viewerbar, .no-print { display: none !important; }

    /* Same look as screen: header bar, zebra rows, strips */
    table.data-table thead { display: table-header-group; }
    table.data-table thead th {
      background: #e8f0fa !important;
      color: #0b4ca1 !important;
      font-size: 11px;
      border-bottom: 2px solid #0b4ca1 !important;
    }
    table.data-table tbody td {
      font-size: 11px;
      color: #334155;
      border-bottom: 1px solid #e2e8f0 !important;
    }
    table.data-table tbody tr:nth-child(even) td { background: #f8fafc !important; }
    .section-strip,
    .group-title {
      background: #e8f0fa !important;
      color: #0b4ca1 !important;
      break-after: avoid;
    }
    .report-title,
    .doc-title-row h1 { color: #0b4ca1 !important; }
    .company-name { font-size: 20px; color: #0f172a; }
    .company-address { font-size: 11px; color: #64748b; }
    .report-footer { font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }

    .sheet,
    .paper {
      padding: 0;
      border: 0;
      box-shadow: none;
      max-width: none;
      height: 100%;
      min-height: 100%;
    }

    /* Force the shell table to fill the page so tfoot sits at the bottom */
    table.report-shell {
      height: 100%;
      min-height: 100%;
      page-break-inside: auto;
    }

    table.report-shell thead {
      display: table-header-group;
    }

    table.report-shell tfoot {
      display: table-footer-group;
    }

    table.report-shell tbody {
      height: 100%;
    }

    table.report-shell > tbody > tr,
    table.report-shell > tbody > tr > td {
      height: 100%;
      vertical-align: top;
    }

    table.data-table tr {
      page-break-inside: avoid;
    }

    .report-footer {
      margin-top: 0;
      padding-top: 6px;
    }
  }
`;

/* ------------------------------------------------------------------ */
/*  reportHeader – logo left, name + each address line right           */
/* ------------------------------------------------------------------ */

export const reportHeader = async ({
  company_code,
  req,
}: {
  company_code: string;
  req: RequestWithUser;
}): Promise<string> => {
  const empty = `
    <div class="company-header company-header--empty">
      <div class="company-logo-wrap"></div>
      <div class="company-name-block">
        <div class="company-name">Company</div>
      </div>
    </div>`;

  if (!company_code) return empty;

  let conn: oracledb.Connection | undefined;
  try {
    conn = await getConn(req);
    const result = await conn.execute(
      `SELECT
         company_name,
         address1,
         address2,
         address3,
         city,
         country,
         company_logo AS logo
       FROM ms_company
       WHERE company_code = :company_code`,
      { company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const row = normalizeRow((result.rows as Record<string, any>[] | undefined)?.[0]);
    if (!row) return empty;
    const addressParts = [
      row.address1,
      row.address2,
      row.address3,
      [row.city, row.country].filter(Boolean).join(", "),
    ].filter((v) => v != null && String(v).trim() !== "");

    const addressHtml = addressParts
      .map((line) => `<span class="company-address-line">${escapeHtml(line)}</span>`)
      .join("");

    const logoHtml = row.logo
      ? `<img class="company-logo" src="${escapeHtml(row.logo)}" alt="Logo" />`
      : "";

    return `
    <div class="company-header">
      <div class="company-logo-wrap">${logoHtml}</div>
      <div class="company-name-block">
        <div class="company-name">${escapeHtml(row.company_name || "Company")}</div>
        <div class="company-address">${addressHtml}</div>
      </div>
    </div>`;
  } catch (error) {
    console.error("reportHeader error:", error);
    return empty;
  } finally {
    await closeConn(conn);
  }
};

/* ------------------------------------------------------------------ */
/*  reportFooter – common footer for every report                      */
/* ------------------------------------------------------------------ */

export type ReportFooterOptions = {
  reportName?: string;
  userName?: string;
  extraLeft?: string;
  extraRight?: string;
  endLabel?: string;
};

export function reportFooter(options: ReportFooterOptions = {}): string {
  const {
    reportName = "Report",
    userName = "",
    extraLeft = "",
    extraRight = "",
    endLabel = "End of report",
  } = options;

  const printed = printDateTimeNow();
  const left = extraLeft || `Print: ${escapeHtml(printed)}${userName ? ` | User: ${escapeHtml(userName)}` : ""}`;
  const right = extraRight || `Report: ${escapeHtml(reportName)} | ${escapeHtml(endLabel)}`;

  return `
    <div class="report-footer">
      <div class="footer-left">${left}</div>
      <div class="footer-right">${right}</div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  buildReportDocument – shell table: thead header, tfoot footer      */
/* ------------------------------------------------------------------ */

export type BuildReportDocumentOptions = {
  title: string;
  headerHtml: string;
  bodyHtml: string;
  footerHtml: string;
  extraCss?: string;
  autoPrint?: boolean;
  showPrintButton?: boolean;
};

/**
 * Builds full HTML document.
 * Structure:
 *   table.report-shell
 *     thead → company header (repeats on each printed page)
 *     tbody → report body (inner tables, groups, etc.)
 *     tfoot → footer (repeats on each printed page)
 */
export function buildReportDocument(opts: BuildReportDocumentOptions): string {
  const {
    title,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss = "",
    autoPrint = false,
    showPrintButton = true,
  } = opts;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
    ${REPORT_HEADER_CSS}
    ${REPORT_FOOTER_CSS}
    ${COMMON_REPORT_CSS}
    ${extraCss}
  </style>
</head>
<body>
  ${
    showPrintButton
      ? `<div class="actions no-print"><button class="primary" onclick="window.print()">Print / Save PDF</button></div>`
      : ""
  }
  <div class="sheet">
    <div class="paper">
      <table class="report-shell">
        <thead>
          <tr><td>${headerHtml}</td></tr>
        </thead>
        <tbody>
          <tr><td>${bodyHtml}</td></tr>
        </tbody>
        <tfoot>
          <tr><td>${footerHtml}</td></tr>
        </tfoot>
      </table>
    </div>
  </div>
  ${autoPrint ? `<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>` : ""}
</body>
</html>`;
}