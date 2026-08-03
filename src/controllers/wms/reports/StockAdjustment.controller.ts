import { Response } from "express";
import oracledb = require("oracledb");
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types No group────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

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
function getAdjustmentNo(req: RequestWithUser): string {
  return text(
    req.params.adjNo ||
    req.params.adj_no ||
    req.query.adjNo ||
    req.query.adj_no
  ).trim();
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function dateTimeText(value: unknown): string {
  if (value === null || value === undefined || text(value).trim() === "") {
    return "";
  }

  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return text(value).trim();

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
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

function quantityText(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function isConfirmed(value: unknown): boolean {
  const v = text(value).trim().toUpperCase();
  return ["Y", "YES", "1", "TRUE", "C", "CONFIRMED"].includes(v);
}

function confirmedYesNo(value: unknown): string {
  if (text(value).trim() === "") return "";
  return isConfirmed(value) ? "Yes" : "No";
}

function detailStatus(value: unknown): string {
  if (text(value).trim() === "") return "";
  return isConfirmed(value) ? "Confirmed" : "Not Confirmed";
}

function principalDisplay(row: ReportRow, fallbackPrinCode: string): string {
  const code = text(row.prin_code) || fallbackPrinCode;
  const name = text(row.prin_name);
  return name ? `${code} - ${name}` : code;
}

function countryDisplay(row: ReportRow): string {
  const countryCode = text(row.country_code).trim();
  const countryName = text(row.country_name).trim();

  if (countryCode && countryName) return `${countryCode} - ${countryName}`;
  return countryName || countryCode || "";
}

function manufacturerDisplay(row: ReportRow): string {
  const manufacturerCode = text(row.manu_code).trim();
  const manufacturerName = text(row.manu_name).trim();

  if (manufacturerCode && manufacturerName) {
    return `${manufacturerCode} - ${manufacturerName}`;
  }

  return manufacturerName || manufacturerCode || "";
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadAdjustmentData(
  req: RequestWithUser,
  prinCode: string,
  adjNo: string | number
): Promise<ReportRow[]> {
  const conn = await getConn(req);

  try {
    const result = await conn.execute(
      `SELECT
         ah.ADJ_NO,
         ah.PRIN_CODE,
         mp.PRIN_NAME,
         ah.ADJ_CODE,
         ah.COMPANY_CODE,
         ah.ADJ_DATE,
         ad.ADJ_SERIALNO,
         ad.SITE_CODE,
         ad.LOCATION_CODE,
         ad.PROD_CODE,
         ad.JOB_NO,
         ad.LOT_NO,
         ad.DOC_REF,
         ad.ADJ_TYPE,
         ad.P_UOM,
         ad.QTY_PUOM,
         ad.L_UOM,
         ad.QTY_LUOM,
         ad.MANU_CODE,
         mf.MANU_NAME,
         mf.COUNTRY_CODE,
         co.COUNTRY_NAME,
         pr.PROD_NAME,
         ah.CONFIRMED AS HEADER_CONFIRMED,
         ah.CONFIRMED_DATE,
         ad.POSTED_IND,
         ad.CONFIRMED AS DETAIL_CONFIRMED,
         ah.REMARKS
       FROM TA_ADJHEADER ah
       INNER JOIN TA_ADJDETAIL ad
         ON ad.COMPANY_CODE = ah.COMPANY_CODE
        AND ad.PRIN_CODE    = ah.PRIN_CODE
        AND ad.ADJ_NO       = ah.ADJ_NO
       INNER JOIN MS_PRODUCT pr
         ON pr.COMPANY_CODE = ad.COMPANY_CODE
        AND pr.PRIN_CODE    = ad.PRIN_CODE
        AND pr.PROD_CODE    = ad.PROD_CODE
       LEFT JOIN MS_PRINCIPAL mp
         ON mp.COMPANY_CODE = ah.COMPANY_CODE
        AND mp.PRIN_CODE    = ah.PRIN_CODE
       LEFT JOIN MS_MANUFACTURER mf
         ON mf.COMPANY_CODE = ad.COMPANY_CODE
        AND mf.PRIN_CODE    = ad.PRIN_CODE
        AND mf.MANU_CODE    = ad.MANU_CODE
       LEFT JOIN MS_COUNTRY co
         ON co.COMPANY_CODE = mf.COMPANY_CODE
        AND co.COUNTRY_CODE = mf.COUNTRY_CODE
       WHERE ah.COMPANY_CODE = '${req.user.company_code}'
         AND ah.PRIN_CODE    = :prin_code
         AND ah.ADJ_NO       = :adj_no
       ORDER BY ad.ADJ_SERIALNO ASC`,
      {
        prin_code: prinCode,
        adj_no: adjNo,
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      }
    );

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}


// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  rows: ReportRow[],
  firstRow: ReportRow | null,
  adjNo: string,
  prinCode: string,
  reportTitle: string,
  loginId: string,
  autoPrint: boolean
): string {
  const printDate = dateTimeText(new Date());

  const r = firstRow || {};
  const header = r;
  const documentTitle = autoPrint
    ? `Stock_Adjusment_${adjNo}`
    : `${reportTitle} - ${adjNo}`;
  const headerConfirmed = confirmedYesNo(r.header_confirmed);
  const headerStatusClass = isConfirmed(r.header_confirmed)
    ? "confirmed"
    : headerConfirmed
      ? "not-confirmed"
      : "empty";

  let bodyRows = "";

  for (const row of rows) {
    const serialNo = parseInt(text(row.adj_serialno), 10) || 0;
    const statusText = detailStatus(row.detail_confirmed);
    const statusClass = isConfirmed(row.detail_confirmed)
      ? "confirmed"
      : statusText
        ? "not-confirmed"
        : "empty";

    bodyRows += `
      <tbody class="item-block">
        <tr class="main-row">
          <td class="cell-center serial-cell">${escapeHtml(serialNo || "")}</td>
          <td class="cell-center">${escapeHtml(text(row.site_code).trim())}</td>
          <td>${escapeHtml(text(row.location_code).trim())}</td>
          <td class="product-code">${escapeHtml(text(row.prod_code).trim())}</td>
          <td>${escapeHtml(text(row.job_no).trim())}</td>
          <td>${escapeHtml(text(row.lot_no).trim())}</td>
          <td>${escapeHtml(text(row.doc_ref).trim())}</td>
          <td class="cell-center adj-type">${escapeHtml(text(row.adj_type).trim())}</td>
          <td class="cell-center">${escapeHtml(text(row.p_uom).trim())}</td>
          <td class="cell-number">${escapeHtml(quantityText(row.qty_puom))}</td>
          <td class="cell-center">${escapeHtml(text(row.l_uom).trim())}</td>
          <td class="cell-number">${escapeHtml(quantityText(row.qty_luom))}</td>
        </tr>

        <tr class="description-row">
          <td></td>
          <td colspan="2"></td>
          <td colspan="5" class="product-name">
            ${escapeHtml(text(row.prod_name).trim())}
          </td>
          <td colspan="4" class="status-cell">
            <span class="detail-label-inline">Status</span>
            <span class="status-pill ${statusClass}">${escapeHtml(statusText)}</span>
          </td>
        </tr>

        <tr class="detail-row">
          <td></td>
          <td colspan="2" class="detail-label">Country of Origin</td>
          <td colspan="9" class="detail-value">${escapeHtml(countryDisplay(row))}</td>
        </tr>

        <tr class="detail-row item-last-row">
          <td></td>
          <td colspan="2" class="detail-label">Manufacturer</td>
          <td colspan="9" class="detail-value">${escapeHtml(manufacturerDisplay(row))}</td>
        </tr>
      </tbody>`;
  }

  if (!bodyRows) {
    bodyRows = `
      <tbody>
        <tr class="empty-row">
          <td colspan="12">No adjustment details found.</td>
        </tr>
      </tbody>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(documentTitle)}</title>
  <style>
    :root {
      --navy: #1f3e64;
      --navy-dark: #162f4f;
      --navy-soft: #eef3f8;
      --ink: #111827;
      --muted: #64748b;
      --line: #d7dee8;
      --line-strong: #b8c4d2;
      --paper: #ffffff;
      --canvas: #eef2f7;
      --success-bg: #e8f5ee;
      --success-text: #17603a;
      --danger-bg: #fdecec;
      --danger-text: #a83232;
    }

    @page {
      size: A4 landscape;
      margin: 8mm 10mm;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
    }

    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 11px;
      line-height: 1.35;
      color: var(--ink);
      background: var(--canvas);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .sheet {
      width: 277mm;
      min-height: 190mm;
      margin: 12px auto;
      padding: 9mm 10mm 8mm;
      background: var(--paper);
      border: 1px solid #cbd5e1;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
    }

    .report-title {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      padding: 8px 16px;
      color: #ffffff;
      background: var(--navy);
      border-radius: 3px;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }

    .report-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      min-height: 28px;
      padding: 5px 2px 6px;
      color: var(--muted);
      font-size: 9.5px;
      border-bottom: 1px solid #edf1f5;
    }

    .report-meta strong {
      color: var(--ink);
      font-weight: 700;
    }

    .header-panel {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(190px, 0.75fr) minmax(190px, 0.8fr);
      gap: 18px;
      margin: 8px 0 10px;
      padding: 9px 12px;
      background: #f8fafc;
      border: 1px solid #e1e7ef;
      border-left: 4px solid var(--navy);
      border-radius: 3px;
    }

    .header-column {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .info-row {
      display: grid;
      grid-template-columns: 104px minmax(0, 1fr);
      align-items: baseline;
      gap: 7px;
      min-height: 18px;
    }

    .header-column.compact .info-row {
      grid-template-columns: 72px minmax(0, 1fr);
    }

    .info-label {
      color: var(--muted);
      font-size: 10px;
      white-space: nowrap;
    }

    .info-label::after {
      content: ":";
    }

    .info-value {
      min-width: 0;
      color: var(--ink);
      font-size: 10.5px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 19px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
    }

    .status-pill.confirmed {
      color: var(--success-text);
      background: var(--success-bg);
      border: 1px solid #c8e7d5;
    }

    .status-pill.not-confirmed {
      color: var(--danger-text);
      background: var(--danger-bg);
      border: 1px solid #f1caca;
    }

    .status-pill.empty {
      min-width: 0;
      padding: 0;
      border: 0;
      background: transparent;
    }

    .table-frame {
      border: 1px solid var(--line-strong);
      border-radius: 3px;
      overflow: hidden;
    }

    table.report-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    thead th {
      color: #ffffff;
      font-weight: 700;
      text-align: center;
      vertical-align: middle;
      border-right: 1px solid rgba(255,255,255,0.16);
    }

    thead th:last-child {
      border-right: 0;
    }

    thead tr.header-main th {
      padding: 6px 5px;
      background: var(--navy);
      font-size: 9px;
      line-height: 1.15;
    }

    thead tr.header-sub th {
      padding: 5px;
      color: #e7edf5;
      background: var(--navy-dark);
      font-size: 8.5px;
      line-height: 1.1;
    }

    tbody.item-block + tbody.item-block .main-row td {
      border-top: 2px solid var(--line-strong);
    }

    tbody td {
      padding: 5px 6px;
      color: #263445;
      font-size: 9.6px;
      vertical-align: middle;
      border-right: 1px solid #e3e8ef;
      border-bottom: 1px solid #e3e8ef;
      overflow-wrap: anywhere;
    }

    tbody td:last-child {
      border-right: 0;
    }

    .main-row td {
      min-height: 25px;
      background: #ffffff;
    }

    .serial-cell,
    .product-code,
    .adj-type,
    .cell-number {
      font-weight: 700;
      color: var(--ink);
    }

    .cell-center {
      text-align: center;
    }

    .cell-number {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .description-row td {
      padding-top: 5px;
      padding-bottom: 5px;
      background: #f6f8fb;
    }

    .product-name {
      color: #263445;
      font-weight: 600;
    }

    .status-cell {
      text-align: left;
      white-space: nowrap;
    }

    .detail-label-inline {
      margin-right: 7px;
      color: var(--ink);
      font-size: 9.5px;
      font-weight: 700;
    }

    .detail-label-inline::after {
      content: ":";
    }

    .detail-row td {
      padding-top: 4px;
      padding-bottom: 4px;
      background: #fbfcfd;
      border-right: 0;
      border-bottom: 0;
    }

    .detail-label {
      color: #334155;
      font-size: 9.3px;
      font-weight: 700;
    }

    .detail-label::after {
      content: ":";
    }

    .detail-value {
      color: #475569;
      font-size: 9.3px;
    }

    .item-last-row td {
      border-bottom: 0;
    }

    .empty-row td {
      padding: 18px;
      color: var(--muted);
      text-align: center;
      font-style: italic;
    }

    .report-ending {
      margin-top: 10px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .end-title {
      position: relative;
      padding: 9px 0 5px;
      color: var(--ink);
      font-size: 11px;
      font-weight: 800;
      text-align: center;
      border-top: 1px solid var(--line-strong);
    }

    .end-title::before {
      content: "";
      display: block;
      margin-bottom: 8px;
      border-top: 1px solid var(--line-strong);
    }

    .signature-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 52px;
      margin-top: 25px;
    }

    .signature-box {
      min-height: 72px;
      font-size: 10px;
    }

    .signature-role {
      margin-bottom: 13px;
      color: var(--ink);
      font-weight: 700;
    }

    .signature-line {
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr);
      align-items: end;
      gap: 6px;
      margin-top: 7px;
      color: #334155;
    }

    .signature-blank {
      height: 13px;
      border-bottom: 1px solid #9aa8b8;
    }

    .rpt-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-top: 24px;
      padding-top: 7px;
      border-top: 1px solid var(--line);
      color: #64748b;
      font-size: 9px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .rpt-footer code {
      color: #334155;
      font-family: "Courier New", monospace;
      font-size: 9px;
      font-weight: 600;
    }

    @media screen and (max-width: 1100px) {
      .sheet {
        width: calc(100% - 20px);
        min-width: 980px;
      }
    }

    @media print {
      body {
        background: #ffffff;
      }

      .sheet {
        width: auto;
        min-height: auto;
        margin: 0;
        padding: 0;
        border: 0;
        box-shadow: none;
      }

      .report-title,
      thead tr.header-main th,
      thead tr.header-sub th {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      thead {
        display: table-header-group;
      }

      tbody.item-block {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .header-panel,
      .report-ending,
      .signature-grid {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header>
      <div class="report-title">${escapeHtml(reportTitle)}</div>

      <div class="report-meta">
        <div>
          Print Date:&nbsp;<strong>${escapeHtml(printDate)}</strong>
          &nbsp;&nbsp;&nbsp;
          Print User:&nbsp;<strong>${escapeHtml(loginId)}</strong>
        </div>
        <div>Page&nbsp;<strong>1</strong>&nbsp;of&nbsp;<strong>1</strong></div>
      </div>

      <section class="header-panel">
        <div class="header-column">
          <div class="info-row">
            <span class="info-label">Principal</span>
            <span class="info-value">${escapeHtml(principalDisplay(r, prinCode))}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Adjustment No.</span>
            <span class="info-value">${escapeHtml(text(r.adj_no).trim() || adjNo)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Adjustment Reason</span>
            <span class="info-value">${escapeHtml(text(r.adj_code).trim())}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Remarks</span>
            <span class="info-value">${escapeHtml(text(r.remarks).trim())}</span>
          </div>
        </div>

        <div class="header-column compact">
          <div class="info-row">
            <span class="info-label">Date</span>
            <span class="info-value">${escapeHtml(dateTimeText(r.adj_date))}</span>
          </div>
        </div>

        <div class="header-column compact">
          <div class="info-row">
            <span class="info-label">Confirmed</span>
            <span class="info-value">
              <span class="status-pill ${headerStatusClass}">${escapeHtml(headerConfirmed)}</span>
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Date</span>
            <span class="info-value">${escapeHtml(dateTimeText(r.confirmed_date))}</span>
          </div>
        </div>
      </section>
    </header>

    <div class="table-frame">
      <table class="report-table">
        <colgroup>
          <col style="width: 4%" />
          <col style="width: 5%" />
          <col style="width: 11%" />
          <col style="width: 22%" />
          <col style="width: 9%" />
          <col style="width: 12%" />
          <col style="width: 12%" />
          <col style="width: 5%" />
          <col style="width: 5%" />
          <col style="width: 5%" />
          <col style="width: 5%" />
          <col style="width: 5%" />
        </colgroup>

        <thead>
          <tr class="header-main">
            <th rowspan="2">No.</th>
            <th rowspan="2">Site</th>
            <th rowspan="2">Location</th>
            <th>Product Code</th>
            <th rowspan="2">Job No</th>
            <th rowspan="2">Lot No</th>
            <th rowspan="2">Doc Ref</th>
            <th rowspan="2">Adj<br/>Type</th>
            <th colspan="4">Quantity</th>
          </tr>
          <tr class="header-sub">
            <th>Name</th>
            <th>UOM</th>
            <th>Qty1</th>
            <th>UOM</th>
            <th>Qty2</th>
          </tr>
        </thead>

        ${bodyRows}
      </table>
    </div>

    <section class="report-ending">
      <div class="end-title">End of Report</div>

      <div class="signature-grid">
        <div class="signature-box">
          <div class="signature-role">Prepared by</div>
          <div class="signature-line"><span>Name:</span><span class="signature-blank"></span></div>
          <div class="signature-line"><span>Date:</span><span class="signature-blank"></span></div>
          <div class="signature-line"><span>Signature:</span><span class="signature-blank"></span></div>
        </div>

        <div class="signature-box">
          <div class="signature-role">Checked by</div>
          <div class="signature-line"><span>Name:</span><span class="signature-blank"></span></div>
          <div class="signature-line"><span>Date:</span><span class="signature-blank"></span></div>
          <div class="signature-line"><span>Signature:</span><span class="signature-blank"></span></div>
        </div>

        <div class="signature-box">
          <div class="signature-role">Supervised by</div>
          <div class="signature-line"><span>Name:</span><span class="signature-blank"></span></div>
          <div class="signature-line"><span>Date:</span><span class="signature-blank"></span></div>
          <div class="signature-line"><span>Signature:</span><span class="signature-blank"></span></div>
        </div>
      </div>
    </section>

    <div class="rpt-footer">
      <span>Object: <code>${escapeHtml(header.company_code)}-${escapeHtml(header.adj_no)}</code></span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </main>

  <script>
    window.addEventListener("message", (event) => {
      if (event.data === "print") window.print();
    });

    ${autoPrint ? `window.addEventListener("load", () => setTimeout(() => window.print(), 300));` : ""}
  </script>
</body>
</html>`;
}

// ─── Excel builder ─────────────────────────────────────────────────────────────

const STYLE_ID = {
  default:        0,
  header:         1,
  sectionGroup:   2,
  sectionProduct: 3,
  label:          4,
  value:          5,
  totalProduct:   6,
  totalGroup:     7,
  totalGrand:     8,
  numValue:       9,
  numTotal:      10,
  numGrand:      11,
  numShort:      12,
  numExcess:     13,
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell {
  v: unknown;
  s: number;
}

function xc(v: unknown, style: StyleKey): XlCell {
  return {
    v,
    s: STYLE_ID[style],
  };
}

function buildExcelBuffer(
  reportRows: ReportRow[],
  firstRow: ReportRow | null,
  adjNo: string,
  prinCode: string
): Buffer {
  const NCOLS = 12;

  type Row = (XlCell | null)[];

  const skip = null;
  const rows: Row[] = [];
  const r = firstRow || {};

  // ── Title ────────────────────────────────────────────────────────────────

  rows.push([
    xc("Entry List", "header"),
    ...Array(NCOLS - 1).fill(skip),
  ]);

  rows.push(Array(NCOLS).fill(skip));

  // ── Adjustment header ────────────────────────────────────────────────────

  rows.push([
    xc("Principal", "label"),
    xc(principalDisplay(r, prinCode), "value"),
    ...Array(NCOLS - 2).fill(skip),
  ]);
  rows.push([
    xc("Adjustment No.", "label"),
    xc(text(r.adj_no) || adjNo, "value"),
    ...Array(NCOLS - 2).fill(skip),
  ]);
  rows.push([
    xc("Date", "label"),
    xc(dateTimeText(r.adj_date), "value"),
    ...Array(NCOLS - 2).fill(skip),
  ]);
  rows.push([
    xc("Confirmed", "label"),
    xc(confirmedYesNo(r.header_confirmed), "value"),
    ...Array(NCOLS - 2).fill(skip),
  ]);
  rows.push([
    xc("Confirmed Date", "label"),
    xc(dateTimeText(r.confirmed_date), "value"),
    ...Array(NCOLS - 2).fill(skip),
  ]);
  rows.push([
    xc("Adjustment Reason", "label"),
    xc(text(r.adj_code).trim(), "value"),
    ...Array(NCOLS - 2).fill(skip),
  ]);
  rows.push([
    xc("Remarks", "label"),
    xc(text(r.remarks).trim(), "value"),
    ...Array(NCOLS - 2).fill(skip),
  ]);

  rows.push(Array(NCOLS).fill(skip));

  // ── Column headers ───────────────────────────────────────────────────────

  rows.push([
    xc("No.", "header"),
    xc("Site", "header"),
    xc("Location", "header"),
    xc("Product Code / Name", "header"),
    xc("Job No", "header"),
    xc("Lot No", "header"),
    xc("Doc Ref", "header"),
    xc("Adj Type", "header"),
    xc("UOM", "header"),
    xc("Qty1", "header"),
    xc("UOM", "header"),
    xc("Qty2", "header"),
  ]);

  // ── Adjustment detail rows ───────────────────────────────────────────────

  for (const row of reportRows) {
    const productText = text(row.prod_name)
      ? `${text(row.prod_code)} | ${text(row.prod_name)}`
      : text(row.prod_code) || "—";

    rows.push([
      xc(parseInt(text(row.adj_serialno), 10) || "", "numValue"),
      xc(text(row.site_code) || "", "value"),
      xc(text(row.location_code) || "", "value"),
      xc(productText, "value"),
      xc(text(row.job_no) || "", "value"),
      xc(text(row.lot_no) || "", "value"),
      xc(text(row.doc_ref) || "", "value"),
      xc(text(row.adj_type) || "", "value"),
      xc(text(row.p_uom) || "", "value"),
      xc(Number(row.qty_puom) || 0, "numValue"),
      xc(text(row.l_uom) || "", "value"),
      xc(Number(row.qty_luom) || 0, "numValue"),
    ]);

    rows.push([
      xc("Country Of Origin", "label"),
      xc(countryDisplay(row), "default"),
      ...Array(6).fill(skip),
      xc("Status", "label"),
      xc(detailStatus(row.detail_confirmed), "default"),
      skip,
      skip,
    ]);

    rows.push([
      xc("Manufacturer", "label"),
      xc(text(row.manu_code) || "", "default"),
      xc(text(row.manu_name) || "", "default"),
      ...Array(NCOLS - 3).fill(skip),
    ]);
  }

  if (reportRows.length === 0) {
    rows.push([
      xc("No adjustment details found.", "value"),
      ...Array(NCOLS - 1).fill(skip),
    ]);
  }

  const COL_WIDTHS = [6, 8, 13, 34, 15, 18, 19, 10, 9, 10, 9, 10];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // Merge ranges
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
        if (end > spanStart)
          merges.push(`${String.fromCharCode(65 + spanStart)}${rn}:${String.fromCharCode(65 + end)}${rn}`);
        spanStart = -1;
      } else if (cell !== null) {
        spanStart = ci;
      }
    });
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="22" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${String.fromCharCode(65 + ci)}${rn}`;
      if (typeof cell.v === "number")
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      else
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
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
  <fonts count="8">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FFDC2626"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF16A34A"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD5DCE8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
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
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Entry List" sheetId="1" r:id="rId1"/></sheets>
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
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
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

// ─── Route handlers ───────────────────────────────────────────────────────────
export const getStockAdjusmentReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
     const adjNo = getAdjustmentNo(req);
    const prinCode = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Entry List";
    const autoPrint = req.query.print === "true";

    console.log("Stock Adjustment", {
      adjNo,
      prinCode,
      params: req.params,
      query: req.query,
    });

    if (!adjNo || !prinCode) {
      res.status(400).json({
        success: false,
        message: "adj_no and prin_code are required",
      });
      return;
    }

    const rows = await loadAdjustmentData(req, prinCode, adjNo);

    if (!rows.length) {
      res.status(404).json({
        success: false,
        message: `No adjustment data found for adjustment ${adjNo} and principal ${prinCode}`,
      });
      return;
    }

    const first = rows[0] ?? null;

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    res.send(
      renderHtml(
        rows,
        first,
        adjNo,
        prinCode,
        reportTitle,
        text(req.user?.loginid),
        autoPrint
      )
    );
  } catch (error: any) {
    console.error("Adjustment HTML error:", error);

    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const getStockAdjusmentReportPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const adjNo = getAdjustmentNo(req);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    console.log("Stock Adjustment PDF parameters:", {
      adjNo,
      prinCode,
      params: req.params,
      query: req.query,
    });

    if (!adjNo || !prinCode) {
      res.status(400).json({
        success: false,
        message: "adj_no and prin_code are required",
      });
      return;
    }

    const rows = await loadAdjustmentData(req, prinCode, adjNo);

    if (!rows.length) {
      res.status(404).json({
        success: false,
        message: `No adjustment data found for adjustment ${adjNo} and principal ${prinCode}`,
      });
      return;
    }

    const first = rows[0] ?? null;
    const reportTitle = "Entry List";

    const html = renderHtml(
      rows,
      first,
      adjNo,
      prinCode,
      reportTitle,
      text(req.user?.loginid),
      true
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="Stock_Adjusment_${adjNo}.pdf"`
    );

    res.send(html);
  } catch (error: any) {
    console.error("Adjustment PDF error:", error);

    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate PDF",
    });
  }
};

export const exportStockAdjusmentReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const adjNo = getAdjustmentNo(req);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    console.log("Stock Adjustment Excel parameters:", {
      adjNo,
      prinCode,
      params: req.params,
      query: req.query,
    });

    if (!adjNo || !prinCode) {
      res.status(400).json({
        success: false,
        message: "adj_no and prin_code are required",
      });
      return;
    }

  
    const rows = await loadAdjustmentData(req, prinCode, adjNo);

    if (!rows.length) {
      res.status(404).json({
        success: false,
        message: `No adjustment data found for adjustment ${adjNo} and principal ${prinCode}`,
      });
      return;
    }

    const first = rows[0] ?? null;
    const buffer = buildExcelBuffer(rows, first, adjNo, prinCode);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Stock_Adjusment_${adjNo}.xlsx"`
    );

    res.end(buffer);
  } catch (error: any) {
    console.error("Adjustment Excel error:", error);

    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate Excel",
    });
  }
};

