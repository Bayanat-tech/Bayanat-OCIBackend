import { Response } from "express";
import oracledb = require("oracledb");
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

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

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function dateTimeText(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);

  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
  if (text(value).trim() === "") return "—";
  return isConfirmed(value) ? "Yes" : "No";
}

function detailStatus(value: unknown): string {
  if (text(value).trim() === "") return "—";
  return isConfirmed(value) ? "Confirmed" : "Not Confirmed";
}

function principalDisplay(row: ReportRow, fallbackPrinCode: string): string {
  const code = text(row.prin_code) || fallbackPrinCode;
  const name = text(row.prin_name);
  return name ? `${code} - ${name}` : code;
}

function countryDisplay(row: ReportRow): string {
  const countryCode = text(row.country_code);
  const countryName = text(row.country_name);

  if (countryCode && countryName)
    return `${countryCode} - ${countryName}`;

  return countryName || countryCode || "—";
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
       WHERE ah.COMPANY_CODE = :company_code
         AND ah.PRIN_CODE    = :prin_code
         AND ah.ADJ_NO       = :adj_no
       ORDER BY ad.ADJ_SERIALNO ASC`,
      {
        company_code: req.user.company_code,
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
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const r = firstRow || {};
  let bodyRows = "";

  for (const row of rows) {
    const serialNo = parseInt(text(row.adj_serialno), 10) || 0;

    bodyRows += `
      <tr class="data-row">
        <td class="num">${escapeHtml(serialNo || "")}</td>
        <td>${escapeHtml(text(row.site_code) || "—")}</td>
        <td>${escapeHtml(text(row.location_code) || "—")}</td>
        <td>${escapeHtml(text(row.prod_code) || "—")}</td>
        <td>${escapeHtml(text(row.job_no) || "—")}</td>
        <td>${escapeHtml(text(row.lot_no) || "—")}</td>
        <td>${escapeHtml(text(row.doc_ref) || "—")}</td>
        <td>${escapeHtml(text(row.adj_type) || "—")}</td>
        <td>${escapeHtml(text(row.p_uom) || "—")}</td>
        <td class="num">${escapeHtml(quantityText(row.qty_puom))}</td>
        <td>${escapeHtml(text(row.l_uom) || "—")}</td>
        <td class="num">${escapeHtml(quantityText(row.qty_luom))}</td>
      </tr>

      <tr class="data-row">
        <td></td>
        <td colspan="2"></td>
        <td colspan="5">${escapeHtml(text(row.prod_name) || "—")}</td>
        <td colspan="4"><strong>Status:</strong>&nbsp;&nbsp;${escapeHtml(detailStatus(row.detail_confirmed))}</td>
      </tr>

      <tr class="data-row">
        <td></td>
        <td colspan="2"><strong>Country Of Origin:</strong></td>
        <td colspan="9">${escapeHtml(countryDisplay(row))}</td>
      </tr>

      <tr class="data-row">
        <td></td>
        <td colspan="2"><strong>Manufacturer:</strong></td>
        <td>${escapeHtml(text(row.manu_code) || "—")}</td>
        <td colspan="8">${escapeHtml(text(row.manu_name) || "—")}</td>
      </tr>`;
  }

  if (!bodyRows) {
    bodyRows = `
      <tr class="data-row">
        <td colspan="12">No adjustment details found.</td>
      </tr>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)} - ${escapeHtml(adjNo)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      font-size: 12px; color: #111827;
      background: #eef1f6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 277mm;
      min-height: 190mm;
      margin: 0 auto; background: #fff;
      padding: 10mm 12mm;
      border: 1px solid #c4cdd9;
    }

    /* ── Report header banner ── */
    .rpt-header {
      background: #1e3a5f; color: #fff; text-align: center;
      font-size: 14px; font-weight: 700; letter-spacing: .08em;
      padding: 10px 16px; text-transform: uppercase;
      border-radius: 3px 3px 0 0;
    }
    .rpt-meta {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 2px 6px;
      font-size: 10px; color: #4b5563;
    }
    .rpt-meta strong { color: #111827; font-weight: 600; }

    /* ── Job header block (flat label : value, no box) ── */
    .job-header {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0 16px;
      margin-bottom: 10px;
      padding: 8px 0 10px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 11px;
    }
    .job-col { display: flex; flex-direction: column; gap: 3px; }
    .job-row { display: flex; align-items: baseline; gap: 6px; line-height: 1.6; }
    .job-label {
      font-size: 10.5px;
      color: #6b7280;
      white-space: nowrap;
    }
    .job-label::after { content: ":"; }
    .job-value {
      font-size: 11px;
      font-weight: 700;
      color: #111827;
    }
    .job-value.nil { font-weight: 400; color: #9ca3af; }

    /* ── Data table ── */
    table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }

    col.c0  { width: 8%;  } col.c1  { width: 8%;  } col.c2  { width: 9%;  }
    col.c3  { width: 9%;  } col.c4  { width: 7%;  } col.c5  { width: 7%;  }
    col.c6  { width: 14%; } col.c7  { width: 11%; }
    col.c8  { width: 14%; } col.c9  { width: 13%; }

    thead tr.th-group th {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 10px; padding: 6px 10px; text-align: center;
      border-right: 1px solid rgba(255,255,255,0.15);
      border-bottom: 1px solid rgba(255,255,255,0.12);
    }
    thead tr.th-group th:last-child { border-right: none; }
    thead tr.th-sub th {
      background: #162d4a; color: #cbd5e1; font-weight: 600;
      font-size: 9.5px; padding: 5px 10px; text-align: left;
      border-right: 1px solid rgba(255,255,255,0.10);
      white-space: nowrap;
    }
    thead tr.th-sub th.num { text-align: right; }

    tr.group-row td {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 11px; padding: 5px 10px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    tr.prod-row td {
      background: #e8ecf2; color: #1e3a5f; font-weight: 700;
      font-size: 11px; padding: 4px 10px 4px 22px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-bottom: 1px solid #d5dce8;
    }
    tr.prod-row td.prod-asn {
      background: #e8ecf2; color: #374151; font-weight: 600;
      padding-left: 10px; text-align: right; font-size: 10.5px;
    }

    tbody tr.data-row td {
      padding: 4px 10px; border-bottom: 1px solid #e5e7eb;
      color: #374151; font-size: 11px;
      white-space: normal; word-wrap: break-word; overflow-wrap: break-word;
      vertical-align: top;
    }
    tbody tr.data-row:nth-child(even) td { background: #f9fafb; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    td.dim  { color: #9ca3af !important; font-weight: 400; }
    td.short  { color: #dc2626 !important; font-weight: 700; }
    td.excess { color: #16a34a !important; font-weight: 700; }

    tr.group-total td {
      background: #d5dce8; padding: 5px 10px; font-size: 11px;
      font-weight: 700; color: #1e3a5f; white-space: nowrap;
    }
    tr.grand-total td {
      background: #1e3a5f; color: #fff; font-weight: 700;
      font-size: 12px; padding: 8px 10px;
      border-top: 2px solid #162d4a;
    }

    /* ── Footer ── */
    .rpt-footer {
      margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px;
      display: flex; justify-content: space-between;
      font-size: 9px; color: #9ca3af;
    }
    .rpt-footer code {
      font-family: "Courier New", monospace; font-size: 9px; color: #6b7280;
    }

    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; }
      thead { display: table-header-group; }

      /* Keep section headers attached to their first data row */
      tr.group-row,
      tr.prod-row {
        break-after: avoid;
        page-break-after: avoid;
      }

      /* Keep totals attached to the group above them */
      tr.group-total,
      tr.grand-total {
        break-before: avoid;
        page-break-before: avoid;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">

    <!-- ── Report title banner ── -->
    <div class="rpt-header">${escapeHtml(reportTitle)}</div>

    <!-- ── Print meta row ── -->
    <div class="rpt-meta">
      <span>Print Date :&nbsp;<strong>${escapeHtml(printDate)}</strong>&nbsp;&nbsp;&nbsp;Print User :&nbsp;<strong>${escapeHtml(loginId)}</strong></span>
      <span>Page 1 of 1</span>
    </div>

    <!-- ── Adjustment header block ── -->
    <div class="job-header">
      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Principal</span>
          <span class="job-value">${escapeHtml(principalDisplay(r, prinCode))}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Adjustment No.</span>
          <span class="job-value">${escapeHtml(text(r.adj_no) || adjNo)}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Adjustment Reason</span>
          <span class="job-value">${escapeHtml(text(r.adj_code) || "—")}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Remarks</span>
          <span class="job-value">${escapeHtml(text(r.remarks) || "—")}</span>
        </div>
      </div>

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Date</span>
          <span class="job-value">${escapeHtml(dateTimeText(r.adj_date))}</span>
        </div>
      </div>

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Confirmed</span>
          <span class="job-value">${escapeHtml(confirmedYesNo(r.header_confirmed))}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Date</span>
          <span class="job-value">${escapeHtml(dateTimeText(r.confirmed_date))}</span>
        </div>
      </div>
    </div><!-- /job-header -->

    <!-- ── Data table ── -->
    <table class="rpt-table">
      <colgroup>
        <col width="4%" />
        <col width="5%" />
        <col width="11%" />
        <col width="22%" />
        <col width="9%" />
        <col width="12%" />
        <col width="12%" />
        <col width="5%" />
        <col width="5%" />
        <col width="5%" />
        <col width="5%" />
        <col width="5%" />
      </colgroup>

      <thead>
        <tr class="th-group">
          <th rowspan="2">No.</th>
          <th rowspan="2">Site</th>
          <th rowspan="2">Location</th>
          <th>Product Code</th>
          <th rowspan="2">Job No</th>
          <th rowspan="2">Lot No</th>
          <th rowspan="2">Doc Ref</th>
          <th rowspan="2">Adj Type</th>
          <th colspan="4">Quantity</th>
        </tr>
        <tr class="th-sub">
          <th>Name</th>
          <th>UOM</th>
          <th class="num">Qty1</th>
          <th>UOM</th>
          <th class="num">Qty2</th>
        </tr>
      </thead>

      <tbody>
        ${bodyRows}
      </tbody>
    </table>

    <!-- ── End of report and approval/signature area ── -->
    <div
      style="
        margin-top: 10px;
        border-top: 1px solid #9ca3af;
        padding-top: 8px;
        break-inside: avoid;
        page-break-inside: avoid;
      "
    >
      <div
        style="
          border-top: 1px solid #9ca3af;
          padding-top: 7px;
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          color: #111827;
        "
      >
        End of Report
      </div>

      <div
        style="
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          column-gap: 70px;
          margin-top: 28px;
          font-size: 11px;
          color: #111827;
          line-height: 1.9;
        "
      >
        <div>
          <div>Prepared by:</div>
          <div>Date:</div>
          <div>Signature:</div>
        </div>

        <div>
          <div>Checked by:</div>
          <div>Date:</div>
          <div>Signature:</div>
        </div>

        <div>
          <div>Supervised by:</div>
          <div>Date:</div>
          <div>Signature:</div>
        </div>
      </div>
    </div>

  </main>
  <script>
    window.addEventListener("message", (e) => {
      if (e.data === "print") window.print();
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
    xc(`Adjustment Report ${adjNo}`, "header"),
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
    xc(text(r.adj_code) || "—", "value"),
    ...Array(NCOLS - 2).fill(skip),
  ]);
  rows.push([
    xc("Remarks", "label"),
    xc(text(r.remarks) || "—", "value"),
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
      xc(text(row.site_code) || "—", "value"),
      xc(text(row.location_code) || "—", "value"),
      xc(productText, "value"),
      xc(text(row.job_no) || "—", "value"),
      xc(text(row.lot_no) || "—", "value"),
      xc(text(row.doc_ref) || "—", "value"),
      xc(text(row.adj_type) || "—", "value"),
      xc(text(row.p_uom) || "—", "value"),
      xc(Number(row.qty_puom) || 0, "numValue"),
      xc(text(row.l_uom) || "—", "value"),
      xc(Number(row.qty_luom) || 0, "numValue"),
    ]);

    rows.push([
      xc("Country Of Origin", "label"),
      xc(countryDisplay(row), "value"),
      ...Array(6).fill(skip),
      xc("Status", "label"),
      xc(detailStatus(row.detail_confirmed), "value"),
      skip,
      skip,
    ]);

    rows.push([
      xc("Manufacturer", "label"),
      xc(text(row.manu_code) || "—", "value"),
      xc(text(row.manu_name) || "—", "value"),
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
  <sheets><sheet name="Adjustment Detail" sheetId="1" r:id="rId1"/></sheets>
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

function getAdjustmentNo(req: RequestWithUser): string {
  return text(
    req.params.adj_no ||
    req.query.adj_no ||
    req.params.job_no ||
    req.query.job_no
  );
}

export const getStockAdjusmentReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const adjNo = getAdjustmentNo(req);
    const prinCode = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Entry List";
    const autoPrint = req.query.print === "true";

   console.log('Adj no',adjNo,'prinCode',prinCode)

    if (!prinCode) {
      res.status(400).json({
        success: false,
        message: "prin_code are required",
      });
      return;
    }

    const rows = await loadAdjustmentData(req, prinCode, adjNo);
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

    if (!prinCode) {
      res.status(400).json({
        success: false,
        message: "adj_no and prin_code are required",
      });
      return;
    }

    const rows = await loadAdjustmentData(req, prinCode, adjNo);
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
      `inline; filename="ADJUSTMENT_${adjNo}.pdf"`
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

    if (!adjNo || !prinCode) {
      res.status(400).json({
        success: false,
        message: "prin_code are required",
      });
      return;
    }

    const rows = await loadAdjustmentData(req, prinCode, adjNo);
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
