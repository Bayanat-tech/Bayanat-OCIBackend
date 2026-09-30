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
/*  Base report font size – ONE value drives body text AND the header  */
/* ------------------------------------------------------------------ */

/**
 * One font size (CSS px) for all report text in every report built with
 * buildReportDocument (preview, print, PDF, new window).
 * Company header scales from it: name = 1.4×, logo height = 5×,
 * logo max width = 20×, address = 1×. Change this single value to resize
 * everything together.
 *
 * NOTE: reports that pass fontMode: "native" skip the forced font size
 * and control their own sizes through extraCss.
 */
export const REPORT_FONT_PX = 6;

/* ------------------------------------------------------------------ */
/*  Freight palette – the SINGLE source of colors for report HTML.     */
/*  Keep these values in sync with freightReportDocument.ts so PDF &   */
/*  Excel output look identical to the browser preview.                */
/* ------------------------------------------------------------------ */

export const FREIGHT_COLORS = {
  navy:         "#00378c", // header rule, title, th, accents
  navyDeep:     "#002a6b", // (optional) th bottom border
  strip:        "#eaf0f8", // applied-filters bg, group banner bg
  stripBorder:  "#cbd5e1", // strip top/bottom rules
  rule:         "#cbd5e1", // header/footer separators, top/bottom table rules
  ruleSoft:     "#e2e8f0", // row separators
  rowAlt:       "#fcfdfe", // zebra alternate row
  subtotalBg:   "#f1f5f9",
  grandTotalBg: "#e2e8f0",
  text:         "#1e293b", // body text
  muted:        "#64748b", // address, footer
  label:        "#475569", // filter-strip values
};

/* ------------------------------------------------------------------ */
/*  Shared CSS – Freight header + table                                */
/* ------------------------------------------------------------------ */

export const REPORT_HEADER_CSS = `
  .company-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    width: 100%;
    box-sizing: border-box;
    border-bottom: 2px solid ${FREIGHT_COLORS.navy};
    padding: 0 0 10px 0;
    margin: 0 0 10px 0;
  }
  .company-logo-wrap {
    flex: 0 0 auto;
    max-width: ${REPORT_FONT_PX * 20}px;
    display: flex;
    align-items: flex-start;
  }
  .company-logo {
    max-height: ${REPORT_FONT_PX * 5}px;
    max-width: ${REPORT_FONT_PX * 20}px;
    object-fit: contain;
    display: block;
  }
  .company-name-block {
    flex: 1 1 auto;
    text-align: right;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
  }
  .company-name {
    font-size: ${REPORT_FONT_PX * 1.4}px;
    font-weight: 800;
    color: #172033;
    margin: 0 0 2px 0;
    line-height: 1.2;
  }
  .company-address {
    font-size: ${REPORT_FONT_PX}px;
    color: ${FREIGHT_COLORS.muted};
    line-height: 1.4;
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
    border-top: 1px solid ${FREIGHT_COLORS.rule};
    padding-top: 6px;
    margin-top: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    font-size: 10px;
    color: ${FREIGHT_COLORS.muted};
  }
  .report-footer .footer-center {
    flex: 1;
    text-align: center;
    font-weight: 700;
    color: ${FREIGHT_COLORS.text};
  }
  .report-footer .footer-left,
  .report-footer .footer-right {
    white-space: nowrap;
  }
`;

/* ------------------------------------------------------------------ */
/*  Applied Filters strip – matches Freight's filterBoxTable layout    */
/* ------------------------------------------------------------------ */

export const REPORT_APPLIED_FILTERS_CSS = `
  .applied-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0;
    margin: 0 0 12px 0;
    padding: 7px 12px;
    background: ${FREIGHT_COLORS.strip};
    border-left: 4px solid ${FREIGHT_COLORS.navy};
    border-top: 1px solid ${FREIGHT_COLORS.ruleSoft};
    border-right: 1px solid ${FREIGHT_COLORS.ruleSoft};
    border-bottom: 1px solid ${FREIGHT_COLORS.ruleSoft};
    font-size: 10px;
    color: ${FREIGHT_COLORS.label};
  }
  .applied-filters .af-label {
    font-weight: 800;
    color: ${FREIGHT_COLORS.navy};
    margin-right: 6px;
    white-space: nowrap;
  }
  .applied-filters .af-item {
    white-space: nowrap;
  }
  .applied-filters .af-item .af-key {
    font-weight: 700;
    color: ${FREIGHT_COLORS.label};
  }
  .applied-filters .af-item .af-val {
    font-weight: 400;
    color: ${FREIGHT_COLORS.label};
  }
  .applied-filters .af-sep {
    color: ${FREIGHT_COLORS.rule};
    margin: 0 6px;
    font-weight: 700;
  }
`;

/* ------------------------------------------------------------------ */
/*  reportAppliedFilters                                               */
/* ------------------------------------------------------------------ */

export type AppliedFilter =
  | { label: string; value: string | string[] | null | undefined }
  | { label: string; value: string | string[] | null | undefined; hidden?: boolean };

/**
 * Renders the "Applied Filters: Key: Value | Key: Value" strip.
 *
 * - By default, includes ALL filters (even those with value "All").
 * - Set `includeAll: false` to skip filters whose value is "All".
 * - Array values are joined with ", ".
 * - Returns "" when nothing to show, so it's safe to inline in a body.
 */
export function reportAppliedFilters(
  filters: AppliedFilter[],
  options: { includeAll?: boolean; label?: string } = {}
): string {
  const { includeAll = true, label = "Applied Filters:" } = options;

  const parts: string[] = [];

  for (const f of filters) {
    if (!f || !f.label) continue;

    const raw = f.value;
    let display = "";

    if (Array.isArray(raw)) {
      const cleaned = raw
        .map((v) => String(v ?? "").trim())
        .filter((v) => v !== "");
      display = cleaned.join(", ");
    } else if (raw != null) {
      display = String(raw).trim();
    }

    if (!display) continue;
    if (!includeAll && display.toLowerCase() === "all") continue;

    parts.push(
      `<span class="af-item"><span class="af-key">${escapeHtml(
        f.label
      )}:</span> <span class="af-val">${escapeHtml(display)}</span></span>`
    );
  }

  if (!parts.length) return "";

  const joined = parts.join(`<span class="af-sep">|</span>`);

  return `
    <div class="applied-filters">
      <span class="af-label">${escapeHtml(label)}</span>
      ${joined}
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Common report CSS — Freight-style shell + tables                   */
/* ------------------------------------------------------------------ */

export const COMMON_REPORT_CSS = `
  /* Freight-style page: small top margin so header hugs the top */
  @page { size: A4; margin: 6mm 12mm 12mm 12mm; }

  * {
    box-sizing: border-box;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  body {
    margin: 0;
    color: ${FREIGHT_COLORS.text};
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: 10.5px;
    line-height: 1.25;
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

  /* Report title — Freight blue */
  .doc-title-row { margin: 0 0 10px 0; }
  .doc-title-row h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: ${FREIGHT_COLORS.navy};
    letter-spacing: 0.2px;
  }

  /* ── Data tables — Freight style ── */
  table.data-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 10.5px;
    margin-top: 2px;
  }
  table.data-table th {
    background: ${FREIGHT_COLORS.navy};
    color: #ffffff;
    font-size: 10px;
    padding: 7px 6px;
    text-align: left;
    font-weight: 700;
    border: 0;
    border-bottom: 1.5px solid ${FREIGHT_COLORS.navyDeep};
  }
  table.data-table td {
    padding: 5px 6px;
    vertical-align: middle;
    border-bottom: 1px solid ${FREIGHT_COLORS.ruleSoft};
    color: ${FREIGHT_COLORS.text};
  }
  /* Freight zebra: alternate body rows are #fcfdfe */
  table.data-table tbody tr:nth-child(even) td { background: ${FREIGHT_COLORS.rowAlt}; }
  table.data-table tbody tr:last-child td { border-bottom: 0; }

  .right { text-align: right; }
  .center { text-align: center; }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .strong { font-weight: 800; }
  .primary-text { color: ${FREIGHT_COLORS.navy}; font-weight: 800; }
  .muted { color: ${FREIGHT_COLORS.muted}; }

  /* Section rows — light blue strip, Freight-styled */
  .group { margin-top: 10px; }
  .group-title {
    background: ${FREIGHT_COLORS.strip};
    padding: 4px 6px;
    font-size: 12px;
    font-weight: 800;
    color: ${FREIGHT_COLORS.navy};
  }
  /* Generic subtotal / grand-total row helpers reports can opt into */
  tr.subtotal-row td {
    background: ${FREIGHT_COLORS.subtotalBg};
    color: ${FREIGHT_COLORS.navy};
    font-weight: 700;
  }
  tr.grand-total-row td {
    background: ${FREIGHT_COLORS.grandTotalBg};
    color: ${FREIGHT_COLORS.navy};
    font-weight: 800;
  }

  .empty {
    border: 1px dashed ${FREIGHT_COLORS.rule};
    background: #f8fafc;
    text-align: center;
    padding: 56px;
    margin-top: 14px;
    color: ${FREIGHT_COLORS.muted};
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
    border: 1px solid ${FREIGHT_COLORS.rule};
    border-radius: 8px;
    background: white;
    font-weight: 700;
    padding: 0 13px;
    cursor: pointer;
  }
  .actions button.primary {
    background: ${FREIGHT_COLORS.navy};
    border-color: ${FREIGHT_COLORS.navy};
    color: white;
  }

  @media print {
    html, body {
      height: 100%;
      margin: 0;
      background: white;
    }

    .actions, .viewerbar, .no-print { display: none !important; }

    .sheet,
    .paper {
      padding: 0;
      border: 0;
      box-shadow: none;
      max-width: none;
      height: 100%;
      min-height: 100%;
    }

    /* Shell fills the page so tfoot sits at the bottom */
    table.report-shell {
      height: 100%;
      min-height: 100%;
      page-break-inside: auto;
    }
    table.report-shell thead { display: table-header-group; }
    table.report-shell tfoot { display: table-footer-group; }
    table.report-shell tbody { height: 100%; }
    table.report-shell > tbody > tr,
    table.report-shell > tbody > tr > td {
      height: 100%;
      vertical-align: top;
    }

    table.data-table tr { page-break-inside: avoid; }

    /* Colored headers survive PDF/print */
    table.data-table th {
      background: ${FREIGHT_COLORS.navy} !important;
      color: #ffffff !important;
    }
    tr.subtotal-row td {
      background: ${FREIGHT_COLORS.subtotalBg} !important;
      color: ${FREIGHT_COLORS.navy} !important;
    }
    tr.grand-total-row td {
      background: ${FREIGHT_COLORS.grandTotalBg} !important;
      color: ${FREIGHT_COLORS.navy} !important;
    }

    /* Page border — Freight navy */
    body::before {
      content: "";
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border: 1.5px solid ${FREIGHT_COLORS.navy};
      pointer-events: none;
      z-index: 9999;
    }

    .report-footer {
      margin-top: 0;
      padding-top: 6px;
    }
  }
`;

/* ------------------------------------------------------------------ */
/*  Constant report font size – applied AFTER each report's extraCss   */
/* ------------------------------------------------------------------ */

/**
 * Forces REPORT_FONT_PX on all report text.
 * Excluded (keep their own sizes): h1–h6, .company-name, .group-title.
 * Skipped entirely when buildReportDocument gets fontMode: "native".
 */
export const REPORT_FONT_CSS = `
  body,
  body *:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6):not(script):not(style):not(.company-name):not(.group-title) {
    font-size: ${REPORT_FONT_PX}px !important;
  }
`;

/* ------------------------------------------------------------------ */
/*  reportHeader – logo left, name + address right, Freight-styled     */
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
/*  reportFooter                                                       */
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
/*  buildReportDocument                                                */
/* ------------------------------------------------------------------ */

export type BuildReportDocumentOptions = {
  title: string;
  headerHtml: string;
  bodyHtml: string;
  footerHtml: string;
  extraCss?: string;
  autoPrint?: boolean;
  showPrintButton?: boolean;
  /**
   * "fixed"  (default) – every text element is forced to REPORT_FONT_PX.
   * "native"           – no forced size; the report's extraCss decides.
   */
  fontMode?: "fixed" | "native";
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
    fontMode = "fixed",
  } = opts;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${REPORT_HEADER_CSS}
    ${REPORT_FOOTER_CSS}
    ${REPORT_APPLIED_FILTERS_CSS}
    ${COMMON_REPORT_CSS}
    ${extraCss}
    ${fontMode === "fixed" ? REPORT_FONT_CSS : ""}
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