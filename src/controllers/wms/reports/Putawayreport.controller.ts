import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import {
  buildReportDocument,
  reportAppliedFilters,
  reportFooter,
  reportHeader,
} from "../../common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ProductGroup {
  prodCode:  string;
  prodName:  string;
  rows:      ReportRow[];
  totalPQty: number;
  totalLQty: number;
}

interface UserGroup {
  userId:    string;
  products:  ProductGroup[];
  totalPQty: number;
  totalLQty: number;
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

function dateTimeText(value: unknown): string {
  if (!value) return "\u2014";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return (
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })
  );
}

function elapsed(from: unknown, to: unknown): string {
  const a = from ? new Date(String(from)).getTime() : NaN;
  const b = to   ? new Date(String(to)).getTime()   : NaN;
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "\u2014";
  const mins = Math.round((b - a) / 60000);
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${hh}:${mm}`;
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

function numFmt(value: unknown, decimals = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "\u2014";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadTallyData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT
        COMPANY_CODE, DIV_CODE, PRIN_CODE, JOB_NO, JOB_DATE, DOC_REF,
        PORT_CODE, PACKDET_NO, PROD_CODE, SITE_CODE, LOCATION_CODE,
        QTY_PUOM, P_UOM, QTY_LUOM, L_UOM,
        PQTY_CONFIRMED, PUOM_CONFIRMED, LQTY_CONFIRMED, LUOM_CONFIRMED,
        VESSEL_NAME, CONTAINER_NO, SITE_IND, PRIN_NAME, VOLUME,
        PROD_NAME, TOT_VOLUME, TOT_WEIGHT, LOT_NO, MANU_CODE,
        MFG_DATE, EXP_DATE, DEPT_CODE, PRIN_REF1, ORIGIN_COUNTRY,
        TASK_ORDER, PALLET_ID, ASN_QTY1, ASN_QTY2, QUANTITY,
        START_TALLY_DT, END_TALLY_DT, DIFF_TALLY,
        START_PUT_DT, END_PUT_DT, DIFF_PUT,
        ASSIGNED_TALLY_USER, ASSIGNED_PDA_USER,
        DIFF_TOTAL_TIME, TOT_PLTS, TOT_PLTS_SUMM, USER_ID
       FROM VW_BOWM_PUTWAYTXN
       WHERE JOB_NO    = :job_no
         AND PRIN_CODE = :prin_code`,
      { job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

function groupRows(rows: ReportRow[]): UserGroup[] {
  const userMap: Record<string, {
    userId: string;
    products: Record<string, ProductGroup>;
    totalPQty: number;
    totalLQty: number;
  }> = {};

  for (const r of rows) {
    const userKey = text(r.user_id) || "Unassigned";
    const prodKey = text(r.prod_code) || "N/A";
    const pQty    = parseFloat(String(r.qty_puom)) || 0;
    const lQty    = parseFloat(String(r.qty_luom)) || 0;

    if (!userMap[userKey])
      userMap[userKey] = { userId: userKey, products: {}, totalPQty: 0, totalLQty: 0 };

    if (!userMap[userKey].products[prodKey])
      userMap[userKey].products[prodKey] = {
        prodCode:  text(r.prod_code),
        prodName:  text(r.prod_name),
        rows:      [],
        totalPQty: 0,
        totalLQty: 0,
      };

    userMap[userKey].products[prodKey].rows.push(r);
    userMap[userKey].products[prodKey].totalPQty += pQty;
    userMap[userKey].products[prodKey].totalLQty += lQty;
    userMap[userKey].totalPQty += pQty;
    userMap[userKey].totalLQty += lQty;
  }

  return Object.values(userMap).map((u) => ({
    ...u,
    products: Object.values(u.products),
  }));
}

// ─── Table columns (single header row so the frontend PDF widths line up) ────

type ColAlign = "left" | "center" | "right";

interface PutColumn { label: string; align: ColAlign; width: number } // width in %, sums to 100

const PUT_COLUMNS: PutColumn[] = [
  { label: "Site Ind",    align: "left",   width: 7  },
  { label: "Lot No",      align: "left",   width: 11 },
  { label: "Pallet Id",   align: "left",   width: 11 },
  { label: "Mfg. Date",   align: "center", width: 9  },
  { label: "Exp. Date",   align: "center", width: 9  },
  { label: "Site",        align: "left",   width: 7  },
  { label: "Location",    align: "left",   width: 12 },
  { label: "Primary Qty", align: "right",  width: 11 },
  { label: "UOM",         align: "left",   width: 6  },
  { label: "Least Qty",   align: "right",  width: 11 },
  { label: "UOM",         align: "left",   width: 6  },
];

const COL_COUNT  = PUT_COLUMNS.length; // 11
const LABEL_SPAN = 7;                  // total-row label spans everything before Primary Qty

// ─── Layout CSS – same look as the Quotation List PDF ────────────────────────
// Used together with fontMode: "native", so the sizes below are the real sizes.
// Letterhead / footer come from report_common; this only styles the body.
// NOTE: row selectors include "tbody" so they out-rank the zebra rule
// (tbody tr:nth-child(even) td) in report_common.

const TALLY_PUTAWAY_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm 12mm 12mm 12mm; }

  /* Make Chrome print background colors */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Letterhead – same as Enquiry List */
  .company-name       { font-size: 18px; font-weight: 700; }
  .company-address    { font-size: 11px; }
  .company-logo-wrap  { max-width: 180px; }
  .company-logo       { max-height: 56px; max-width: 180px; }

  /* Title + filter strip */
  h1.report-title {
    margin: 28px 0 14px 0;
    font-size: 20px;
    font-weight: 700;
    color: #00378c;
  }
  .applied-filters { font-size: 10px; margin-bottom: 28px; }

  table.data-table {
    width: 100%;
    table-layout: fixed;
    font-size: 10.5px;
    margin-top: 0;
    border-collapse: collapse;
  }
  table.data-table th,
  table.data-table td {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  table.data-table .left   { text-align: left   !important; }
  table.data-table .center { text-align: center !important; }
  table.data-table .right  { text-align: right  !important; font-variant-numeric: tabular-nums; }

  /* Header: solid blue bar, white bold text */
  table.data-table thead tr th {
    background: #00378c !important;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 10.5px;
    padding: 12px 8px;
    border: 0;
    text-transform: none;
  }

  /* Section banners: Principal / Group / Product */
  table.data-table tbody tr.group-header-row td { font-weight: 700; color: #00378c; text-align: left; }
  table.data-table tbody tr.prin-row  td { background: #eaf0f8; font-size: 13px; font-weight: 700; padding: 11px 8px; }
  table.data-table tbody tr.group-row td { background: #f4f7fc; font-size: 10.5px; padding: 7px 8px 7px 16px; }
  table.data-table tbody tr.prod-row  td { background: #fafbfd; font-size: 10.5px; padding: 7px 8px 7px 28px; color: #334155; }

  /* Data rows */
  table.data-table tbody tr.data-row td {
    background: #fafcfe;
    padding: 9px 8px;
    border-bottom: 1px solid #e2e8f0;
    color: #1e293b;
  }
  table.data-table tbody tr.data-row td.primary-text { color: #00378c; font-weight: 700; }

  /* Totals */
  table.data-table tbody tr.subtotal-row td {
    background: #e2e8f0; color: #00378c; font-weight: 700; padding: 8px 8px;
  }
  table.data-table tbody tr.grand-total-row td {
    background: #dbe4f0; color: #00378c; font-weight: 700; padding: 9px 8px;
    border-bottom: 1px solid #cbd5e1;
  }

  @media print {
    body::before { display: none !important; }
    table.data-table thead { display: table-header-group; }
    table.data-table tr { break-inside: avoid; page-break-inside: avoid; }
    table.data-table tr.group-header-row { break-after: avoid; page-break-after: avoid; }
    table.data-table tr.subtotal-row,
    table.data-table tr.grand-total-row  { break-before: avoid; page-break-before: avoid; }
  }
`;
// Lets the React parent page trigger printing through postMessage.
const PRINT_LISTENER_SCRIPT = `
  <script>
    window.addEventListener("message", function (e) {
      if (e.data === "print") window.print();
    });
  </script>`;

// ─── HTML body renderer ───────────────────────────────────────────────────────

function renderBodyHtml(
  userGroups: UserGroup[],
  firstRow: ReportRow | null,
  jobNo: string,
  prinCode: string,
  reportTitle: string
): string {
  const r = firstRow || {};

  const grandPQty = userGroups.reduce((s, u) => s + u.totalPQty, 0);
  const grandLQty = userGroups.reduce((s, u) => s + u.totalLQty, 0);

  const allRows    = userGroups.flatMap((u) => u.products.flatMap((p) => p.rows));
  const tallyStart = allRows.map((x) => x.start_tally_dt).filter(Boolean).sort()[0] ?? null;
  const tallyEnd   = allRows.map((x) => x.end_tally_dt).filter(Boolean).sort().reverse()[0] ?? null;
  const putStart   = allRows.map((x) => x.start_put_dt).filter(Boolean).sort()[0] ?? null;
  const putEnd     = allRows.map((x) => x.end_put_dt).filter(Boolean).sort().reverse()[0] ?? null;

  const tallyTime = elapsed(tallyStart, tallyEnd);
  const putTime   = elapsed(putStart, putEnd);
  const totalTime = elapsed(tallyStart, putEnd);

  const tallyUsers = [...new Set(allRows.map((x) => text(x.assigned_tally_user)).filter(Boolean))].join(", ");
  const pdaUsers   = [...new Set(allRows.map((x) => text(x.assigned_pda_user)).filter(Boolean))].join(", ");

  const jobNoText    = text(r.job_no) || jobNo;
  const prinCodeText = text(r.prin_code) || prinCode;
  const prinText     = prinCodeText + (r.prin_name ? " - " + text(r.prin_name) : "");

  const field = (label: string, value: unknown) =>
    `<div class="field"><span class="label">${escapeHtml(label)}</span> <span class="value">${escapeHtml(text(value) || "\u2014")}</span></div>`;

  const emptyField = `<div class="field field--empty"><span class="label"></span><span class="value"></span></div>`;
  const col = (items: string[], n: number) =>
    items.concat(Array(Math.max(0, n - items.length)).fill(emptyField)).join("");

  const filtersHtml = reportAppliedFilters([
    { label: "Job No",       value: jobNoText },
    { label: "Principal",    value: prinCodeText },
    { label: "Job Date",     value: dateText(r.job_date) },
    { label: "Container No", value: text(r.container_no) || "\u2014" },
  ]);

  const infoLeft = [
    field("Job No",          jobNoText),
    field("Job Date",        dateText(r.job_date)),
    field("Principal",       prinText),
    field("Prin. Reference", r.prin_ref1),
    field("Container No",    r.container_no),
  ];
  const infoMid = [
    field("Tally Start",   dateTimeText(tallyStart)),
    field("Tally End",     dateTimeText(tallyEnd)),
    field("Putaway Start", dateTimeText(putStart)),
    field("Putaway End",   dateTimeText(putEnd)),
  ];
  const infoRight = [
    field("Tally Time",       tallyTime),
    field("Putaway Time",     putTime),
    field("Total Time Taken", totalTime),
  ];

  const totalRow = (cls: string, label: string, p: number, l: number) =>
    `<tr class="${cls}">` +
    `<td class="right" colspan="${LABEL_SPAN}">${label}</td>` +
    `<td class="right num">${escapeHtml(numFmt(p))}</td>` +
    `<td></td>` +
    `<td class="right num">${escapeHtml(numFmt(l))}</td>` +
    `<td></td>` +
    `</tr>`;

  const C = PUT_COLUMNS;
  let bodyRows = "";

  for (const ug of userGroups) {
    bodyRows += `<tr class="group-header-row user-row"><td colspan="${COL_COUNT}">User : ${escapeHtml(ug.userId)}</td></tr>`;

    for (const pg of ug.products) {
      const prodLabel = `${escapeHtml(pg.prodCode)}${pg.prodName ? " - " + escapeHtml(pg.prodName) : ""}`;
      bodyRows += `<tr class="group-header-row prod-row"><td colspan="${COL_COUNT}">${prodLabel}</td></tr>`;

      for (const dr of pg.rows) {
        bodyRows +=
          `<tr class="data-row">` +
          `<td class="${C[0].align}">${escapeHtml(dr.site_ind || "\u2014")}</td>` +
          `<td class="${C[1].align}">${escapeHtml(dr.lot_no || "\u2014")}</td>` +
          `<td class="${C[2].align}">${escapeHtml(dr.pallet_id || "\u2014")}</td>` +
          `<td class="${C[3].align}">${escapeHtml(dateText(dr.mfg_date))}</td>` +
          `<td class="${C[4].align}">${escapeHtml(dateText(dr.exp_date))}</td>` +
          `<td class="${C[5].align}">${escapeHtml(dr.site_code || "\u2014")}</td>` +
          `<td class="${C[6].align}">${escapeHtml(dr.location_code || "\u2014")}</td>` +
          `<td class="${C[7].align} num">${escapeHtml(numFmt(dr.qty_puom))}</td>` +
          `<td class="${C[8].align}">${escapeHtml(dr.p_uom || "\u2014")}</td>` +
          `<td class="${C[9].align} num">${escapeHtml(numFmt(dr.qty_luom))}</td>` +
          `<td class="${C[10].align}">${escapeHtml(dr.l_uom || "\u2014")}</td>` +
          `</tr>`;
      }
      bodyRows += totalRow("subtotal-row", `Sub Total (${escapeHtml(pg.prodCode)}):`, pg.totalPQty, pg.totalLQty);
    }
    bodyRows += totalRow("subtotal-row", `Sub Total (User : ${escapeHtml(ug.userId)}):`, ug.totalPQty, ug.totalLQty);
  }

  bodyRows += totalRow("grand-total-row", `GRAND TOTAL (${allRows.length} Records):`, grandPQty, grandLQty);

  const colgroup    = C.map((c) => `<col style="width:${c.width}%" />`).join("");
  const headerCells = C.map((c) => `<th class="${c.align}">${escapeHtml(c.label)}</th>`).join("");

  const blankLine = "______________";

  return `
    <h1 class="report-title">${escapeHtml(reportTitle)}</h1>
    ${filtersHtml}

    <div class="info-grid">
      <div>${col(infoLeft, 5)}</div>
      <div>${col(infoMid, 5)}</div>
      <div>${col(infoRight, 5)}</div>
    </div>

    <table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <div class="group-title">Sign-off</div>
    <div class="info-grid">
      <div>
        <div class="filter-header">Tally By</div>
        ${field("User",      tallyUsers)}
        ${field("Date",      blankLine)}
        ${field("Signature", blankLine)}
      </div>
      <div>
        <div class="filter-header">Put-Away By</div>
        ${field("User",      pdaUsers)}
        ${field("Date",      blankLine)}
        ${field("Signature", blankLine)}
      </div>
      <div>
        <div class="filter-header">Supervisor</div>
        ${field("Name",      blankLine)}
        ${field("Date",      blankLine)}
        ${field("Signature", blankLine)}
      </div>
    </div>
    ${PRINT_LISTENER_SCRIPT}
  `;
}

async function renderHtml(
  req: RequestWithUser,
  userGroups: UserGroup[],
  firstRow: ReportRow | null,
  jobNo: string,
  prinCode: string,
  reportTitle: string,
  loginId: string,
  autoPrint: boolean
): Promise<string> {
  const headerHtml = await reportHeader({ company_code: text(req.user?.company_code), req });
  const bodyHtml   = renderBodyHtml(userGroups, firstRow, jobNo, prinCode, reportTitle);
  const footerHtml = reportFooter({
    reportName: "rpt_tally_putaway",
    userName:   loginId,
    endLabel:   "Powered by Bayanat Technology",
  });

  return buildReportDocument({
    title: `${reportTitle} - ${jobNo}`,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: TALLY_PUTAWAY_EXTRA_CSS,
    autoPrint,
    showPrintButton: true,
    fontMode: "native",
  });
}

// ─── Excel builder ────────────────────────────────────────────────────────────
// Same palette / Arial font as the DN Summary Excel.
// STYLE_ID values must stay in sync with <cellXfs> order in stylesXml below.

const STYLE_ID = {
  default:      0,
  header:       1,   // white on #00378c, centered
  title:        2,   // blue bold 14, no fill
  meta:         3,   // grey on #f8fafc
  secUser:      4,   // blue bold on #eaf0f8
  secProduct:   5,   // blue bold on #f4f7fc
  data:         6,   // left, light bottom border
  dataCenter:   7,   // centered, light bottom border
  dataNum:      8,   // right, #,##0.000
  subTotal:     9,   // #f1f5f9, blue bold, right
  subTotalNum: 10,   // same + #,##0.000
  grandTotal:  11,   // #e2e8f0, blue bold, right
  grandTotalNum: 12, // same + #,##0.000
  footer:      13,   // italic grey, right
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(
  userGroups: UserGroup[],
  firstRow: ReportRow | null,
  jobNo: string,
  prinCode: string,
  reportTitle: string
): Buffer {
  const NCOLS = COL_COUNT;
  const skip  = null;
  const r     = firstRow || {};

  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  const spanRow = (label: string, style: StyleKey) => {
    const row: Row = Array(NCOLS).fill(skip);
    row[0] = xc(label, style);
    rows.push(row);
  };

  // total row: label merged across first 7 cols, then Primary Qty / UOM / Least Qty / UOM
  const totalRow = (label: string, p: number, l: number, lvl: "subTotal" | "grandTotal") => {
    const row: Row = Array(NCOLS).fill(skip);
    row[0]  = xc(label, lvl);
    row[7]  = xc(p, `${lvl}Num` as StyleKey);
    row[8]  = xc("", lvl);
    row[9]  = xc(l, `${lvl}Num` as StyleKey);
    row[10] = xc("", lvl);
    rows.push(row);
  };

  const allRows    = userGroups.flatMap((u) => u.products.flatMap((p) => p.rows));
  const tallyStart = allRows.map((x) => x.start_tally_dt).filter(Boolean).sort()[0] ?? null;
  const tallyEnd   = allRows.map((x) => x.end_tally_dt).filter(Boolean).sort().reverse()[0] ?? null;
  const putStart   = allRows.map((x) => x.start_put_dt).filter(Boolean).sort()[0] ?? null;
  const putEnd     = allRows.map((x) => x.end_put_dt).filter(Boolean).sort().reverse()[0] ?? null;

  spanRow(reportTitle, "title");
  spanRow(
    `Applied Filters: Job No: ${text(r.job_no) || jobNo} | Principal: ${text(r.prin_code) || prinCode} | Job Date: ${dateText(r.job_date)} | Container No: ${text(r.container_no) || "\u2014"}`,
    "meta"
  );
  spanRow(
    `Tally: ${dateTimeText(tallyStart)} to ${dateTimeText(tallyEnd)} (${elapsed(tallyStart, tallyEnd)}) | Putaway: ${dateTimeText(putStart)} to ${dateTimeText(putEnd)} (${elapsed(putStart, putEnd)}) | Total Time: ${elapsed(tallyStart, putEnd)}`,
    "meta"
  );

  rows.push(PUT_COLUMNS.map((c) => xc(c.label, "header")));

  for (const ug of userGroups) {
    spanRow(`User : ${ug.userId}`, "secUser");

    for (const pg of ug.products) {
      spanRow(pg.prodCode + (pg.prodName ? " - " + pg.prodName : ""), "secProduct");

      for (const dr of pg.rows) {
        rows.push([
          xc(text(dr.site_ind)  || "\u2014", "data"),
          xc(text(dr.lot_no)    || "\u2014", "data"),
          xc(text(dr.pallet_id) || "\u2014", "data"),
          xc(dateText(dr.mfg_date),          "dataCenter"),
          xc(dateText(dr.exp_date),          "dataCenter"),
          xc(text(dr.site_code)     || "\u2014", "data"),
          xc(text(dr.location_code) || "\u2014", "data"),
          xc(parseFloat(String(dr.qty_puom)) || 0, "dataNum"),
          xc(text(dr.p_uom) || "\u2014", "data"),
          xc(parseFloat(String(dr.qty_luom)) || 0, "dataNum"),
          xc(text(dr.l_uom) || "\u2014", "data"),
        ]);
      }
      totalRow(`Sub Total (${pg.prodCode}):`, pg.totalPQty, pg.totalLQty, "subTotal");
    }
    totalRow(`Sub Total (User : ${ug.userId}):`, ug.totalPQty, ug.totalLQty, "subTotal");
  }

  const grandPQty = userGroups.reduce((s, u) => s + u.totalPQty, 0);
  const grandLQty = userGroups.reduce((s, u) => s + u.totalLQty, 0);
  totalRow(`GRAND TOTAL (${allRows.length} Records):`, grandPQty, grandLQty, "grandTotal");

  {
    const row: Row = Array(NCOLS).fill(skip);
    row[6] = xc("Powered by Bayanat Technology", "footer");
    rows.push(row);
  }

  const COL_WIDTHS = [11, 18, 18, 13, 13, 10, 18, 14, 8, 14, 8];
  const colXml = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  // merge each run of "value followed by nulls" into one merged range
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
    const rn = ri + 1;
    const ht = rn === 1 ? ` ht="24" customHeight="1"` : "";
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
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="14"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><sz val="9"/><color rgb="FF475569"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF00378C"/><name val="Arial"/></font>
    <font><i/><sz val="8"/><color rgb="FF64748B"/><name val="Arial"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF00378C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="5">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FFCBD5E1"/></top><bottom/><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FF00378C"/></top><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF00378C"/></left><right style="thin"><color rgb="FF00378C"/></right>
      <top style="thin"><color rgb="FF00378C"/></top><bottom style="thin"><color rgb="FF00378C"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="5" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="7" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="5" fillId="7" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Tally Putaway" sheetId="1" r:id="rId1"/></sheets>
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

export const getTallyPutawayReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Putaway Detail Report";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows       = await loadTallyData(req, jobNo, prinCode);
    const userGroups = groupRows(rows);
    const firstRow   = rows[0] ?? null;

    const html = await renderHtml(req, userGroups, firstRow, jobNo, prinCode, reportTitle, text(req.user?.loginid), autoPrint);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Tally Putaway HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getTallyPutawayReportPdf = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo    = text(req.params.job_no  || req.query.job_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows        = await loadTallyData(req, jobNo, prinCode);
    const userGroups  = groupRows(rows);
    const firstRow    = rows[0] ?? null;
    const reportTitle = "Tally & Putaway Detail Report";
    const html = await renderHtml(req, userGroups, firstRow, jobNo, prinCode, reportTitle, text(req.user?.loginid), true /* autoPrint */);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="Tally_Putaway_${jobNo}.pdf"`);
    res.send(html);
  } catch (error: any) {
    console.error("Tally Putaway PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const getTallyPutawayReportExcel = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title) || "Putaway Detail Report";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows       = await loadTallyData(req, jobNo, prinCode);
    const userGroups = groupRows(rows);
    const buffer     = buildExcelBuffer(userGroups, rows[0] ?? null, jobNo, prinCode, reportTitle);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Putaway_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Tally Putaway Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};