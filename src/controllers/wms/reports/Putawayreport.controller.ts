import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../common/report_common";

// ─── Shared report building blocks ─────────────────────────────────────────
// Adjust this import path to wherever reportHeader / reportFooter /
// buildReportDocument actually live in your project.


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
  if (!value) return "—";
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

function numFmt(value: unknown, decimals = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Insert the postMessage("print") listener used by the report Dialog's toolbar. */
function withPostMessagePrintListener(html: string): string {
  const script = `<script>window.addEventListener("message",(e)=>{if(e.data==="print")window.print();});</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : html + script;
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

// ─── Grouping ──────────────────────────────────────────────────────────────

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

// ─── Extra CSS specific to this report ─────────────────────────────────────
// Landscape A4 + the grouped user/product table + info panel + signature
// strip. The shared COMMON_REPORT_CSS ships a portrait @page and a generic
// .data-table — this report overrides both for its own layout.

const TALLY_PUTAWAY_EXTRA_CSS = `
  @page { size: A4 landscape; margin: 10mm 12mm; }
  .paper { max-width: 277mm; }

  /* ── Info panel ── */
  .info-panel {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0;
    border: 1px solid #c4cdd9;
    border-radius: 3px;
    margin-bottom: 12px;
    font-size: 10.5px;
  }
  .info-col { padding: 10px 14px; border-right: 1px solid #c4cdd9; }
  .info-col:last-child { border-right: none; }
  .info-row { display: flex; align-items: baseline; padding: 3px 0; border-bottom: 1px solid #f1f5f9; }
  .info-row:last-child { border-bottom: none; }
  .info-label {
    min-width: 100px; flex-shrink: 0; font-size: 9.5px; color: #6b7280;
    font-weight: 600; text-align: right; padding-right: 8px; white-space: nowrap;
  }
  .info-value { font-size: 10.5px; font-weight: 700; color: #111827; }
  .info-value.nil { font-weight: 400; color: #9ca3af; }

  .time-col { padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
  .time-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .time-box { border: 1px dashed #94a3b8; border-radius: 3px; padding: 7px 10px; text-align: center; }
  .time-box-label {
    font-size: 9px; font-weight: 700; color: #6b7280; text-transform: uppercase;
    letter-spacing: .05em; margin-bottom: 4px;
  }
  .time-box-value { font-size: 13px; font-weight: 700; color: #1e3a5f; font-variant-numeric: tabular-nums; }
  .time-box.total { grid-column: 1 / -1; border-color: #1e3a5f; background: #f0f4f9; }
  .time-box.total .time-box-label { color: #1e3a5f; }

  /* ── Grouped data table ── */
  table.rpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }

  col.c0  { width: 7%;  } col.c1  { width: 9%;  } col.c2  { width: 9%;  }
  col.c3  { width: 9%;  } col.c4  { width: 9%;  } col.c5  { width: 6%;  }
  col.c6  { width: 11%; } col.c7  { width: 9%;  } col.c8  { width: 5%;  }
  col.c9  { width: 9%;  } col.c10 { width: 5%;  }

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

  tr.user-row td {
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
  tbody tr.data-row td {
    padding: 4px 10px; border-bottom: 1px solid #e5e7eb;
    color: #374151; font-size: 11px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  tbody tr.data-row:nth-child(even) td { background: #f9fafb; }

  tr.prod-total td {
    background: #e8ecf2; padding: 4px 10px; font-size: 11px;
    font-weight: 700; color: #1e3a5f;
    border-top: 1px solid #d5dce8; white-space: nowrap;
  }
  tr.prod-total td.total-label { padding-left: 22px; }
  tr.user-total td {
    background: #d5dce8; padding: 5px 10px; font-size: 11px;
    font-weight: 700; color: #1e3a5f; white-space: nowrap;
  }
  tr.grand-total td {
    background: #1e3a5f; color: #fff; font-weight: 700;
    font-size: 12px; padding: 8px 10px;
    border-top: 2px solid #162d4a;
  }

  /* ── Signature strip ── */
  .sig-strip {
    margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 16px; border-top: 1.5px solid #c4cdd9; padding-top: 14px;
  }
  .sig-group { display: flex; flex-direction: column; gap: 8px; }
  .sig-group-title {
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .08em; color: #1e3a5f; padding-bottom: 4px;
    border-bottom: 1px solid #e2e8f0;
  }
  .sig-row { display: flex; align-items: flex-end; gap: 8px; }
  .sig-label { font-size: 9.5px; color: #6b7280; font-weight: 600; min-width: 60px; flex-shrink: 0; padding-bottom: 2px; }
  .sig-line { flex: 1; border-bottom: 1px solid #374151; min-height: 16px; }
  .sig-box { border: 1px solid #94a3b8; border-radius: 3px; min-height: 52px; width: 100%; margin-top: 4px; }
  .sig-group.supervisor .sig-row { margin-bottom: 10px; }
`;

// ─── HTML body renderer ─────────────────────────────────────────────────────
// Builds only the *body* — reportHeader()/reportFooter()/buildReportDocument()
// from reportCommon supply the company header, footer and page shell.

function renderBodyHtml(
  userGroups: UserGroup[],
  firstRow: ReportRow | null,
  jobNo: string,
  prinCode: string
): string {
  const grandPQty = userGroups.reduce((s, u) => s + u.totalPQty, 0);
  const grandLQty = userGroups.reduce((s, u) => s + u.totalLQty, 0);

  const r = firstRow || {};

  const allRows  = userGroups.flatMap((u) => u.products.flatMap((p) => p.rows));
  const tallyStart = allRows.map((x) => x.start_tally_dt).filter(Boolean).sort()[0] ?? null;
  const tallyEnd   = allRows.map((x) => x.end_tally_dt).filter(Boolean).sort().reverse()[0] ?? null;
  const putStart   = allRows.map((x) => x.start_put_dt).filter(Boolean).sort()[0] ?? null;
  const putEnd     = allRows.map((x) => x.end_put_dt).filter(Boolean).sort().reverse()[0] ?? null;

  function elapsed(from: unknown, to: unknown): string {
    const a = from ? new Date(String(from)).getTime() : NaN;
    const b = to   ? new Date(String(to)).getTime()   : NaN;
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "—";
    const mins = Math.round((b - a) / 60000);
    const hh = String(Math.floor(mins / 60)).padStart(2, "0");
    const mm = String(mins % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const tallyTime = elapsed(tallyStart, tallyEnd);
  const putTime   = elapsed(putStart, putEnd);
  const totalTime = elapsed(tallyStart, putEnd);

  function dateTimeText(value: unknown): string {
    if (!value) return "—";
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  const tallyUsers = [...new Set(allRows.map((x) => text(x.assigned_tally_user)).filter(Boolean))].join(", ");
  const pdaUsers   = [...new Set(allRows.map((x) => text(x.assigned_pda_user)).filter(Boolean))].join(", ");

  let bodyRows = "";

  for (const ug of userGroups) {
    bodyRows += `
      <tr class="user-row">
        <td colspan="11">User : ${escapeHtml(ug.userId)}</td>
      </tr>`;

    for (const pg of ug.products) {
      bodyRows += `
        <tr class="prod-row">
          <td colspan="11">${escapeHtml(pg.prodCode)} | ${escapeHtml(pg.prodName)}</td>
        </tr>`;

      for (const dr of pg.rows) {
        bodyRows += `
          <tr class="data-row">
            <td>${escapeHtml(dr.site_ind  || "—")}</td>
            <td>${escapeHtml(dr.lot_no    || "—")}</td>
            <td>${escapeHtml(dr.pallet_id || "—")}</td>
            <td>${escapeHtml(dateText(dr.mfg_date))}</td>
            <td>${escapeHtml(dateText(dr.exp_date))}</td>
            <td>${escapeHtml(dr.site_code     || "—")}</td>
            <td>${escapeHtml(dr.location_code || "—")}</td>
            <td class="num">${escapeHtml(numFmt(dr.qty_puom))}</td>
            <td>${escapeHtml(dr.p_uom || "—")}</td>
            <td class="num">${escapeHtml(numFmt(dr.qty_luom))}</td>
            <td>${escapeHtml(dr.l_uom || "—")}</td>
          </tr>`;
      }

      bodyRows += `
        <tr class="prod-total">
          <td colspan="7" class="total-label">Product Total : ${escapeHtml(pg.prodCode)}</td>
          <td class="num">${escapeHtml(numFmt(pg.totalPQty))}</td>
          <td></td>
          <td class="num">${escapeHtml(numFmt(pg.totalLQty))}</td>
          <td></td>
        </tr>`;
    }

    bodyRows += `
      <tr class="user-total">
        <td colspan="7">User Total : ${escapeHtml(ug.userId)}</td>
        <td class="num">${escapeHtml(numFmt(ug.totalPQty))}</td>
        <td></td>
        <td class="num">${escapeHtml(numFmt(ug.totalLQty))}</td>
        <td></td>
      </tr>`;
  }

  const grandRow = `
    <tr class="grand-total">
      <td colspan="7">Grand Total</td>
      <td class="num">${escapeHtml(numFmt(grandPQty))}</td>
      <td></td>
      <td class="num">${escapeHtml(numFmt(grandLQty))}</td>
      <td></td>
    </tr>`;

  return `
    <div class="info-panel">
      <div class="info-col">
        <div class="info-row">
          <span class="info-label">Job No</span>
          <span class="info-value">${escapeHtml(text(r.job_no) || jobNo)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Job Date</span>
          <span class="info-value">${escapeHtml(dateText(r.job_date))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Principal</span>
          <span class="info-value">${escapeHtml(text(r.prin_code) || prinCode)}${r.prin_name ? `&nbsp;<span style="font-weight:400;color:#4b5563;">| ${escapeHtml(text(r.prin_name))}</span>` : ""}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Prin. Reference</span>
          <span class="info-value${r.prin_ref1 ? "" : " nil"}">${r.prin_ref1 ? escapeHtml(text(r.prin_ref1)) : "—"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Container No</span>
          <span class="info-value${r.container_no ? "" : " nil"}">${r.container_no ? escapeHtml(text(r.container_no)) : "—"}</span>
        </div>
      </div>

      <div class="info-col">
        <div class="info-row">
          <span class="info-label">Tally Start</span>
          <span class="info-value${tallyStart ? "" : " nil"}">${escapeHtml(dateTimeText(tallyStart))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Tally End</span>
          <span class="info-value${tallyEnd ? "" : " nil"}">${escapeHtml(dateTimeText(tallyEnd))}</span>
        </div>
        <div class="info-row" style="margin-top:6px;">
          <span class="info-label">Putaway Start</span>
          <span class="info-value${putStart ? "" : " nil"}">${escapeHtml(dateTimeText(putStart))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Putaway End</span>
          <span class="info-value${putEnd ? "" : " nil"}">${escapeHtml(dateTimeText(putEnd))}</span>
        </div>
      </div>

      <div class="time-col">
        <div class="time-boxes">
          <div class="time-box">
            <div class="time-box-label">Tally Time</div>
            <div class="time-box-value">${escapeHtml(tallyTime)}</div>
          </div>
          <div class="time-box">
            <div class="time-box-label">Put. Time</div>
            <div class="time-box-value">${escapeHtml(putTime)}</div>
          </div>
          <div class="time-box total">
            <div class="time-box-label">Total Time Taken</div>
            <div class="time-box-value">${escapeHtml(totalTime)}</div>
          </div>
        </div>
      </div>
    </div>

    <table class="rpt-table">
      <colgroup>
        <col class="c0"/><col class="c1"/><col class="c2"/>
        <col class="c3"/><col class="c4"/><col class="c5"/>
        <col class="c6"/><col class="c7"/><col class="c8"/>
        <col class="c9"/><col class="c10"/>
      </colgroup>
      <thead>
        <tr class="th-group">
          <th colspan="7" style="text-align:left;">Item Details</th>
          <th colspan="2">Primary</th>
          <th colspan="2">Least</th>
        </tr>
        <tr class="th-sub">
          <th>Site Ind</th><th>Lot No</th><th>Pallet Id</th>
          <th>Mfg. Date</th><th>Exp. Date</th>
          <th>Site</th><th>Location</th>
          <th class="num">Quantity</th><th>UOM</th>
          <th class="num">Quantity</th><th>UOM</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        ${grandRow}
      </tbody>
    </table>

    <div class="sig-strip">
      <div class="sig-group">
        <div class="sig-group-title">Tally By</div>
        <div class="sig-row">
          <span class="sig-label">User</span>
          <span class="sig-line" style="font-size:10px;font-weight:600;color:#111827;padding-bottom:2px;">${escapeHtml(tallyUsers) || "&nbsp;"}</span>
        </div>
        <div class="sig-row">
          <span class="sig-label">Date</span>
          <span class="sig-line">&nbsp;</span>
        </div>
        <div class="sig-row" style="align-items:flex-start;margin-top:4px;">
          <span class="sig-label" style="padding-top:4px;">Signature</span>
          <div class="sig-box"></div>
        </div>
      </div>

      <div class="sig-group">
        <div class="sig-group-title">Put-Away By</div>
        <div class="sig-row">
          <span class="sig-label">User</span>
          <span class="sig-line" style="font-size:10px;font-weight:600;color:#111827;padding-bottom:2px;">${escapeHtml(pdaUsers) || "&nbsp;"}</span>
        </div>
        <div class="sig-row">
          <span class="sig-label">Date</span>
          <span class="sig-line">&nbsp;</span>
        </div>
        <div class="sig-row" style="align-items:flex-start;margin-top:4px;">
          <span class="sig-label" style="padding-top:4px;">Signature</span>
          <div class="sig-box"></div>
        </div>
      </div>

      <div class="sig-group supervisor">
        <div class="sig-group-title">Supervisor</div>
        <div class="sig-row">
          <span class="sig-label">Name</span>
          <span class="sig-line">&nbsp;</span>
        </div>
        <div class="sig-row">
          <span class="sig-label">Date</span>
          <span class="sig-line">&nbsp;</span>
        </div>
        <div class="sig-row">
          <span class="sig-label">Signature</span>
          <span class="sig-line">&nbsp;</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Assembles the full document via buildReportDocument(), using the shared
 * company reportHeader() and reportFooter(). Kept async because reportHeader
 * hits the DB for company name / address / logo.
 */
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
  const bodyHtml   = renderBodyHtml(userGroups, firstRow, jobNo, prinCode);
  const footerHtml = reportFooter({
    reportName: reportTitle,
    userName: loginId,
    extraLeft: `Object: ${escapeHtml(jobNo)}`,
  });

  const html = buildReportDocument({
    title: `${reportTitle} - ${jobNo}`,
    headerHtml,
    bodyHtml,
    footerHtml,
    extraCss: TALLY_PUTAWAY_EXTRA_CSS,
    autoPrint,
    showPrintButton: !autoPrint,
  });

  return withPostMessagePrintListener(html);
}

// ─── Excel builder ─────────────────────────────────────────────────────────────
// Unchanged — AdmZip-based xlsx generation has no shared equivalent yet.
// STYLE_ID values must stay in sync with <cellXfs> order in stylesXml below.

const STYLE_ID = {
  default:         0,
  header:          1,  // white text, navy bg, centered
  sectionUser:     2,  // white text, navy bg
  sectionProduct:  3,  // navy text, lavender bg
  label:           4,  // gray, right-aligned
  value:           5,  // dark bold, wrapping
  totalProduct:    6,  // navy text, light lavender bg
  totalUser:       7,  // navy text, mid lavender bg
  totalGrand:      8,  // white text, navy bg, bold
  numValue:        9,  // dark bold, right-aligned
  numTotal:       10,  // navy bold, right-aligned, lavender bg
  numGrand:       11,  // white bold, right-aligned, navy bg
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(userGroups: UserGroup[], jobNo: string, prinCode: string): Buffer {
  const NCOLS = 11;

  type Row = (XlCell | null)[];
  const skip = null;
  const rows: Row[] = [];

  rows.push([
    xc(`Tally & Putaway Detail Report — Job ${jobNo} / ${prinCode}`, "header"),
    skip, skip, skip, skip, skip, skip, skip, skip, skip, skip,
  ]);

  rows.push(Array(NCOLS).fill(skip));

  rows.push([
    xc("Site Ind",   "header"),
    xc("Lot No",     "header"),
    xc("Pallet Id",  "header"),
    xc("Mfg. Date",  "header"),
    xc("Exp. Date",  "header"),
    xc("Site",       "header"),
    xc("Location",   "header"),
    xc("Primary Qty","header"),
    xc("PUOM",       "header"),
    xc("Least Qty",  "header"),
    xc("LUOM",       "header"),
  ]);

  for (const ug of userGroups) {
    rows.push([xc(`User : ${ug.userId}`, "sectionUser"), skip, skip, skip, skip, skip, skip, skip, skip, skip, skip]);

    for (const pg of ug.products) {
      rows.push([xc(`${pg.prodCode} | ${pg.prodName}`, "sectionProduct"), skip, skip, skip, skip, skip, skip, skip, skip, skip, skip]);

      for (const r of pg.rows) {
        rows.push([
          xc(text(r.site_ind)      || "—", "value"),
          xc(text(r.lot_no)        || "—", "value"),
          xc(text(r.pallet_id)     || "—", "value"),
          xc(dateText(r.mfg_date),          "value"),
          xc(dateText(r.exp_date),          "value"),
          xc(text(r.site_code)     || "—", "value"),
          xc(text(r.location_code) || "—", "value"),
          xc(parseFloat(String(r.qty_puom)) || 0, "numValue"),
          xc(text(r.p_uom) || "—",             "value"),
          xc(parseFloat(String(r.qty_luom)) || 0, "numValue"),
          xc(text(r.l_uom) || "—",             "value"),
        ]);
      }

      rows.push([
        xc(`Product Total : ${pg.prodCode}`, "totalProduct"),
        skip, skip, skip, skip, skip,
        xc("", "totalProduct"),
        xc(pg.totalPQty, "numTotal"),
        xc("", "totalProduct"),
        xc(pg.totalLQty, "numTotal"),
        xc("", "totalProduct"),
      ]);
    }

    rows.push([
      xc(`User Total : ${ug.userId}`, "totalUser"),
      skip, skip, skip, skip, skip,
      xc("", "totalUser"),
      xc(ug.totalPQty, "numTotal"),
      xc("", "totalUser"),
      xc(ug.totalLQty, "numTotal"),
      xc("", "totalUser"),
    ]);
  }

  const grandPQty = userGroups.reduce((s, u) => s + u.totalPQty, 0);
  const grandLQty = userGroups.reduce((s, u) => s + u.totalLQty, 0);
  rows.push([
    xc("Grand Total", "totalGrand"),
    skip, skip, skip, skip, skip,
    xc("", "totalGrand"),
    xc(grandPQty, "numGrand"),
    xc("", "totalGrand"),
    xc(grandLQty, "numGrand"),
    xc("", "totalGrand"),
  ]);

  const COL_WIDTHS = [12, 18, 18, 13, 13, 10, 20, 14, 8, 14, 8];

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
    const ht  = rn === 1 ? ` ht="22" customHeight="1"` : "";
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
  <fonts count="6">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
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
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF1E3A5F"/></left>
      <right style="thin"><color rgb="FF1E3A5F"/></right>
      <top style="thin"><color rgb="FF1E3A5F"/></top>
      <bottom style="thin"><color rgb="FF1E3A5F"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
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
    const jobNo    = text(req.params.job_no  || req.query.job_no);
    const prinCode = text(req.query.prin_code || req.params.prin_code);

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows       = await loadTallyData(req, jobNo, prinCode);
    const userGroups = groupRows(rows);
    const buffer     = buildExcelBuffer(userGroups, jobNo, prinCode);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Putaway_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Tally Putaway Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};