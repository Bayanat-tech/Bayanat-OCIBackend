import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../database/TenantManager";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// UOM-keyed totals e.g. { "PKT": 99, "CTN": 12 }
type UomTotals = Record<string, number>;

interface ProductGroup {
  prodCode:   string;
  prodName:   string;
  rows:       ReportRow[];
  recvByPuom: UomTotals;  // QTYPUOM  keyed by P_UOM
  recvByLuom: UomTotals;  // QTYLUOM  keyed by L_UOM  (L_UOM rule: only if qty > 0)
  damByPuom:  UomTotals;  // QTYPUOM_DAM keyed by P_UOM
  damByLuom:  UomTotals;  // QTYLUOM_DAM keyed by L_UOM
  expByPuom:  UomTotals;  // QTYPUOM_EXPECTED keyed by P_UOM
  expByLuom:  UomTotals;
}

interface GroupSection {
  groupName:  string;
  products:   ProductGroup[];
  recvByPuom: UomTotals;
  recvByLuom: UomTotals;
  damByPuom:  UomTotals;
  damByLuom:  UomTotals;
}

interface ShortExcessCell { text: string; cls: "short" | "excess" | "" }

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

/** Add qty into a UomTotals bucket */
function addUom(map: UomTotals, uom: string, qty: number): void {
  if (!uom) return;
  map[uom] = (map[uom] ?? 0) + qty;
}

function fmtQtyCell(qtyPuom: number, pUom: string, qtyLuom: number, lUom: string): string {
  let s = `${numFmt(qtyPuom)} ${pUom}`.trim();
  if (qtyLuom !== 0 && lUom) s += ` / ${numFmt(qtyLuom)} ${lUom}`;
  return s;
}

function fmtUomTotals(map: UomTotals, primaryUom?: string): string {
  const keys = Object.keys(map);
  if (keys.length === 0) return "—";

  // Put primaryUom first if provided
  const ordered = primaryUom
    ? [primaryUom, ...keys.filter(k => k !== primaryUom)]
    : keys;

  return ordered
    .filter(k => map[k] !== undefined)
    .map(k => `${numFmt(map[k])} ${k}`)
    .join(" / ");
}

/**
 * Merge two UomTotals maps (sum values for matching keys).
 */
function mergeUomTotals(...maps: UomTotals[]): UomTotals {
  const result: UomTotals = {};
  for (const map of maps)
    for (const [uom, qty] of Object.entries(map))
      result[uom] = (result[uom] ?? 0) + qty;
  return result;
}

/**
 * Mirrors the SSRS expression:
 *   exp - recv == 0            -> blank
 *   recv > exp (negative diff) -> "Excess: +<diff>"  (green)
 *   recv < exp (positive diff) -> "Short: -<diff>"   (red)
 */
function fmtShortExcessCell(
  expPuom: number, recvPuom: number, pUom: string,
  expLuom: number, recvLuom: number, lUom: string
): ShortExcessCell {
  const diffPuom = expPuom - recvPuom;
  const diffLuom = expLuom - recvLuom;

  if (diffPuom === 0 && diffLuom === 0) return { text: "—", cls: "" };

  // Drive the Short/Excess label off the primary UOM diff; fall back to L_UOM
  // if the primary UOM diff happens to be zero.
  const driver  = diffPuom !== 0 ? diffPuom : diffLuom;
  const isExcess = driver < 0;
  const prefix  = isExcess ? "Excess: +" : "Short: -";

  const parts: string[] = [];
  if (diffPuom !== 0) parts.push(`${numFmt(Math.abs(diffPuom))} ${pUom}`.trim());
  if (diffLuom !== 0 && lUom) parts.push(`${numFmt(Math.abs(diffLuom))} ${lUom}`.trim());

  return { text: `${prefix}${parts.join(" / ")}`, cls: isExcess ? "excess" : "short" };
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadGrnData(
  req: RequestWithUser,
  jobNo: string,
  prinCode: string
): Promise<ReportRow[]> {
  const conn = await getConn(req);
  try {
    const result = await conn.execute(
      `SELECT
        BATCH_NO, CONTAINER_NO, CONTAINER_SIZE, DOC_REF,
        EXCESS_SHORT_QTY, EXP_DATE, GRN_DATE, GRN_NO,
        GROSSWT, GROUP_NAME, JOB_NO, LOT_NO, L_UOM,
        MFG_DATE, NETWT, PALLET_ID, PRIN_CODE, PRIN_NAME,
        PRIN_REF1, PROD_CODE, PROD_NAME, P_UOM,
        QTYLUOM, QTYLUOM_DAM, QTYLUOM_EXPECTED,
        QTYPUOM, QTYPUOM_DAM, QTYPUOM_EXPECTED,
        UPPP, USER_ID, VOLUME
       FROM VW_BOWM_GRNTXN_FINAL
       WHERE JOB_NO    = :job_no
         AND PRIN_CODE = :prin_code
       ORDER BY GROUP_NAME, PROD_CODE`,
      { job_no: jobNo, prin_code: prinCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

function groupRows(rows: ReportRow[]): GroupSection[] {
  const groupMap: Record<string, {
    groupName:  string;
    products:   Record<string, ProductGroup>;
    recvByPuom: UomTotals;
    recvByLuom: UomTotals;
    damByPuom:  UomTotals;
    damByLuom:  UomTotals;
  }> = {};

  for (const r of rows) {
    const groupKey = text(r.group_name) || "Ungrouped";
    const prodKey  = text(r.prod_code)  || "N/A";
    const pUom     = text(r.p_uom);
    const lUom     = text(r.l_uom);

    const qtyPuom    = parseFloat(String(r.qtypuom))          || 0;
    const qtyLuom    = parseFloat(String(r.qtyluom))          || 0;
    const qtyPuomDam = parseFloat(String(r.qtypuom_dam))      || 0;
    const qtyLuomDam = parseFloat(String(r.qtyluom_dam))      || 0;
    const qtyPuomExp = parseFloat(String(r.qtypuom_expected)) || 0;
    const qtyLuomExp = parseFloat(String(r.qtyluom_expected)) || 0;

    if (!groupMap[groupKey])
      groupMap[groupKey] = {
        groupName:  groupKey,
        products:   {},
        recvByPuom: {}, recvByLuom: {},
        damByPuom:  {}, damByLuom:  {},
      };

    if (!groupMap[groupKey].products[prodKey])
      groupMap[groupKey].products[prodKey] = {
        prodCode:   text(r.prod_code),
        prodName:   text(r.prod_name),
        rows:       [],
        recvByPuom: {}, recvByLuom: {},
        damByPuom:  {}, damByLuom:  {},
        expByPuom:  {}, expByLuom:  {},
      };

    const pg = groupMap[groupKey].products[prodKey];
    pg.rows.push(r);

    // Always accumulate PUOM
    addUom(pg.recvByPuom, pUom, qtyPuom);
    addUom(pg.damByPuom,  pUom, qtyPuomDam);
    addUom(pg.expByPuom,  pUom, qtyPuomExp);

    // L_UOM rule: only if qty > 0
    if (qtyLuom    !== 0) addUom(pg.recvByLuom, lUom, qtyLuom);
    if (qtyLuomDam !== 0) addUom(pg.damByLuom,  lUom, qtyLuomDam);
    if (qtyLuomExp !== 0) addUom(pg.expByLuom,  lUom, qtyLuomExp);

    const gs = groupMap[groupKey];
    addUom(gs.recvByPuom, pUom, qtyPuom);
    addUom(gs.damByPuom,  pUom, qtyPuomDam);
    if (qtyLuom    !== 0) addUom(gs.recvByLuom, lUom, qtyLuom);
    if (qtyLuomDam !== 0) addUom(gs.damByLuom,  lUom, qtyLuomDam);
  }

  return Object.values(groupMap).map((g) => ({
    ...g,
    products: Object.values(g.products),
  }));
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(
  groups:      GroupSection[],
  firstRow:    ReportRow | null,
  jobNo:       string,
  prinCode:    string,
  reportTitle: string,
  loginId:     string,
  autoPrint:   boolean
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const r = firstRow || {};

  // ── Grand-level UOM totals ────────────────────────────────────────────────
  const grandRecvPuom = mergeUomTotals(...groups.map(g => g.recvByPuom));
  const grandRecvLuom = mergeUomTotals(...groups.map(g => g.recvByLuom));
  const grandDamPuom  = mergeUomTotals(...groups.map(g => g.damByPuom));
  const grandDamLuom  = mergeUomTotals(...groups.map(g => g.damByLuom));

  // Total (Good + Damaged) = recv + dam per UOM
  const grandTotalPuom = mergeUomTotals(grandRecvPuom, grandDamPuom);
  const grandTotalLuom = mergeUomTotals(grandRecvLuom, grandDamLuom);

  // ── Build body rows ────────────────────────────────────────────────────────
  let bodyRows = "";

  for (const gs of groups) {
    bodyRows += `
      <tr class="group-row">
        <td colspan="10">Group : ${escapeHtml(gs.groupName)}</td>
      </tr>`;

    for (const pg of gs.products) {
      // Determine primary UOM for this product (first row's P_UOM)
      const pUom = text(pg.rows[0]?.p_uom || "");
      const lUom = text(pg.rows[0]?.l_uom || "");

      // ASN expected qty string for the product header
      const asnStr = fmtUomTotals(pg.expByPuom, pUom)
        + (Object.keys(pg.expByLuom).length ? " " + fmtUomTotals(pg.expByLuom, lUom) : "");

      bodyRows += `
        <tr class="prod-row">
          <td colspan="7">${escapeHtml(pg.prodCode)} | ${escapeHtml(pg.prodName)}</td>
          <td colspan="3" class="prod-asn">ASN Qty : ${escapeHtml(asnStr)}</td>
        </tr>`;

      // Data rows
      for (const dr of pg.rows) {
        const qtyPuom    = parseFloat(String(dr.qtypuom))          || 0;
        const qtyLuom    = parseFloat(String(dr.qtyluom))          || 0;
        const qtyPuomDam = parseFloat(String(dr.qtypuom_dam))      || 0;
        const qtyLuomDam = parseFloat(String(dr.qtyluom_dam))      || 0;
        const drPuom     = text(dr.p_uom);
        const drLuom     = text(dr.l_uom);

        // 1) Qty Received: QTYPUOM P_UOM [/ QTYLUOM L_UOM if != 0]
        const recvStr = fmtQtyCell(qtyPuom, drPuom, qtyLuom, drLuom);

        // 2) Qty Damaged: QTYPUOM_DAM P_UOM [/ QTYLUOM_DAM L_UOM if != 0]
        const damStr  = fmtQtyCell(qtyPuomDam, drPuom, qtyLuomDam, drLuom);

        // 3) Total (Good + Damaged): (QTYPUOM + QTYPUOM_DAM) P_UOM [/ (QTYLUOM + QTYLUOM_DAM) L_UOM if != 0]
        const totalPuomQty = qtyPuom + qtyPuomDam;
        const totalLuomQty = qtyLuom + qtyLuomDam;
        const totalStr = fmtQtyCell(totalPuomQty, drPuom, totalLuomQty, drLuom);

        // 4) Short / Excess
        const qtyPuomExp = parseFloat(String(dr.qtypuom_expected)) || 0;
        const qtyLuomExp = parseFloat(String(dr.qtyluom_expected)) || 0;
        const shortExcess = fmtShortExcessCell(qtyPuomExp, qtyPuom, drPuom, qtyLuomExp, qtyLuom, drLuom);

        bodyRows += `
          <tr class="data-row">
            <td>${escapeHtml(dateText(dr.mfg_date))}</td>
            <td>${escapeHtml(dateText(dr.exp_date))}</td>
            <td>${escapeHtml(dr.batch_no  || "—")}</td>
            <td>${escapeHtml(dr.lot_no    || "—")}</td>
            <td>${escapeHtml(dr.grosswt   || "—")}</td>
            <td>${escapeHtml(dr.netwt     || "—")}</td>
            <td class="num">${escapeHtml(recvStr)}</td>
            <td class="num dim">${escapeHtml(damStr)}</td>
            <td class="num">${escapeHtml(totalStr)}</td>
            <td class="num${shortExcess.cls ? " " + shortExcess.cls : ""}">${escapeHtml(shortExcess.text)}</td>
          </tr>`;
      }
    } // ← closes "for (const pg of gs.products)"

    // Group total
    const gsTotalPuom = mergeUomTotals(gs.recvByPuom, gs.damByPuom);
    const gsTotalLuom = mergeUomTotals(gs.recvByLuom, gs.damByLuom);

    bodyRows += `
      <tr class="group-total">
        <td colspan="6">Group Total : ${escapeHtml(gs.groupName)}</td>
        <td class="num">${escapeHtml(fmtUomTotals(gs.recvByPuom))}${Object.keys(gs.recvByLuom).length ? " " + escapeHtml(fmtUomTotals(gs.recvByLuom)) : ""}</td>
        <td class="num dim">${escapeHtml(fmtUomTotals(gs.damByPuom))}${Object.keys(gs.damByLuom).length ? " " + escapeHtml(fmtUomTotals(gs.damByLuom)) : ""}</td>
        <td class="num">${escapeHtml(fmtUomTotals(gsTotalPuom))}${Object.keys(gsTotalLuom).length ? " " + escapeHtml(fmtUomTotals(gsTotalLuom)) : ""}</td>
        <td></td>
      </tr>`;
  } // ← closes "for (const gs of groups)"

  // Grand total row
  const grandRow = `
    <tr class="grand-total">
      <td colspan="6">Grand Total</td>
      <td class="num">${escapeHtml(fmtUomTotals(grandRecvPuom))}${Object.keys(grandRecvLuom).length ? " " + escapeHtml(fmtUomTotals(grandRecvLuom)) : ""}</td>
      <td class="num">${escapeHtml(fmtUomTotals(grandDamPuom))}${Object.keys(grandDamLuom).length ? " " + escapeHtml(fmtUomTotals(grandDamLuom)) : ""}</td>
      <td class="num">${escapeHtml(fmtUomTotals(grandTotalPuom))}${Object.keys(grandTotalLuom).length ? " " + escapeHtml(fmtUomTotals(grandTotalLuom)) : ""}</td>
      <td></td>
    </tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(reportTitle)} - ${escapeHtml(jobNo)}</title>
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

    <!-- ── Job header block (flat, no box) ── -->
    <div class="job-header">

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Job Number</span>
          <span class="job-value">${escapeHtml(text(r.job_no) || jobNo)}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Principal</span>
          <span class="job-value">${escapeHtml(text(r.prin_code) || prinCode)}${r.prin_name ? ` - ${escapeHtml(text(r.prin_name))}` : ""}</span>
        </div>
        <div class="job-row">
          <span class="job-label">GRN Remark</span>
          <span class="job-value nil">&nbsp;</span>
        </div>
        <div class="job-row">
          <span class="job-label">GRN Number</span>
          <span class="job-value${r.grn_no ? "" : " nil"}">${r.grn_no ? escapeHtml(text(r.grn_no)) : "&nbsp;"}</span>
        </div>
      </div>

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">WMS GRN Date</span>
          <span class="job-value${r.grn_date ? "" : " nil"}">${r.grn_date ? dateText(r.grn_date) : "&nbsp;"}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Container No</span>
          <span class="job-value${r.container_no ? "" : " nil"}">${r.container_no ? escapeHtml(text(r.container_no)) : "&nbsp;"}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Container Size</span>
          <span class="job-value${r.container_size != null ? "" : " nil"}">${r.container_size != null ? escapeHtml(text(r.container_size)) : "&nbsp;"}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Doc Ref</span>
          <span class="job-value${r.doc_ref ? "" : " nil"}">${r.doc_ref ? escapeHtml(text(r.doc_ref)) : "&nbsp;"}</span>
        </div>
      </div>

      <div class="job-col">
        <div class="job-row">
          <span class="job-label">Cust Ref No</span>
          <span class="job-value nil">&nbsp;</span>
        </div>
        <div class="job-row">
          <span class="job-label">WMS GRN No</span>
          <span class="job-value${r.grn_no ? "" : " nil"}">${r.grn_no ? escapeHtml(text(r.grn_no)) : "&nbsp;"}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Created By</span>
          <span class="job-value${r.user_id ? "" : " nil"}">${r.user_id ? escapeHtml(text(r.user_id)) : "&nbsp;"}</span>
        </div>
        <div class="job-row">
          <span class="job-label">Prin. Reference</span>
          <span class="job-value${r.prin_ref1 ? "" : " nil"}">${r.prin_ref1 ? escapeHtml(text(r.prin_ref1)) : "&nbsp;"}</span>
        </div>
      </div>

    </div><!-- /job-header -->

    <!-- ── Data table ── -->
    <table class="rpt-table">
      <colgroup>
        <col class="c0"/><col class="c1"/><col class="c2"/>
        <col class="c3"/><col class="c4"/><col class="c5"/>
        <col class="c6"/><col class="c7"/>
        <col class="c8"/><col class="c9"/>
      </colgroup>
      <thead>
        <tr class="th-group">
          <th colspan="6" style="text-align:left;">Item Details</th>
          <th>Quantity Received</th>
          <th>Damaged Qty</th>
          <th>Total (Good + Damaged)</th>
          <th>Short / Excess</th>
        </tr>
        <tr class="th-sub">
          <th>Mfg. Date</th>
          <th>Exp. Date</th>
          <th>Batch No</th>
          <th>Lot No</th>
          <th>Gross WT</th>
          <th>Net WT</th>
          <th class="num">Qty (Primary + Least)</th>
          <th class="num">Qty (Primary + Least)</th>
          <th class="num">Qty (Primary + Least)</th>
          <th class="num">Qty (Primary + Least)</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        ${grandRow}
      </tbody>
    </table>

    <!-- ── Page footer ── -->
    <div class="rpt-footer">
      <span>Report Name : <code>${escapeHtml(jobNo)}</code></span>
      <span>Powered by Bayanat Technology</span>
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
interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

function buildExcelBuffer(groups: GroupSection[], jobNo: string, prinCode: string): Buffer {
  const NCOLS = 10;
  type Row = (XlCell | null)[];
  const skip = null;
  const rows: Row[] = [];

  // Title
  rows.push([xc(`Goods Receipt Note — Job ${jobNo} / ${prinCode}`, "header"), ...Array(NCOLS - 1).fill(skip)]);
  rows.push(Array(NCOLS).fill(skip));

  // Column headers
  rows.push([
    xc("Mfg. Date",              "header"),
    xc("Exp. Date",              "header"),
    xc("Batch No",               "header"),
    xc("Lot No",                 "header"),
    xc("Gross WT",               "header"),
    xc("Net WT",                 "header"),
    xc("Qty Received",           "header"),
    xc("Qty Damaged",            "header"),
    xc("Total (Good + Damaged)", "header"),
    xc("Short / Excess",         "header"),
  ]);

  for (const gs of groups) {
    rows.push([xc(`Group : ${gs.groupName}`, "sectionGroup"), ...Array(NCOLS - 1).fill(skip)]);

    for (const pg of gs.products) {
      rows.push([xc(`${pg.prodCode} | ${pg.prodName}`, "sectionProduct"), ...Array(NCOLS - 1).fill(skip)]);

      for (const dr of pg.rows) {
        const qtyPuom    = parseFloat(String(dr.qtypuom))          || 0;
        const qtyLuom    = parseFloat(String(dr.qtyluom))          || 0;
        const qtyPuomDam = parseFloat(String(dr.qtypuom_dam))      || 0;
        const qtyLuomDam = parseFloat(String(dr.qtyluom_dam))      || 0;
        const qtyPuomExp = parseFloat(String(dr.qtypuom_expected)) || 0;
        const qtyLuomExp = parseFloat(String(dr.qtyluom_expected)) || 0;
        const drPuom     = text(dr.p_uom);
        const drLuom     = text(dr.l_uom);

        const recvStr  = fmtQtyCell(qtyPuom, drPuom, qtyLuom, drLuom);
        const damStr   = fmtQtyCell(qtyPuomDam, drPuom, qtyLuomDam, drLuom);
        const totalStr = fmtQtyCell(qtyPuom + qtyPuomDam, drPuom, qtyLuom + qtyLuomDam, drLuom);
        const shortExcess = fmtShortExcessCell(qtyPuomExp, qtyPuom, drPuom, qtyLuomExp, qtyLuom, drLuom);

        rows.push([
          xc(dateText(dr.mfg_date),        "value"),
          xc(dateText(dr.exp_date),        "value"),
          xc(text(dr.batch_no)  || "—",   "value"),
          xc(text(dr.lot_no)    || "—",   "value"),
          xc(text(dr.grosswt)   || "—",   "value"),
          xc(text(dr.netwt)     || "—",   "value"),
          xc(recvStr,                      "numValue"),
          xc(damStr,                       "numValue"),
          xc(totalStr,                     "numValue"),
          xc(
            shortExcess.text,
            shortExcess.cls === "excess" ? "numExcess" : shortExcess.cls === "short" ? "numShort" : "numValue"
          ),
        ]);
      }
    }

    // Group total
    const gsTotalPuom = mergeUomTotals(gs.recvByPuom, gs.damByPuom);
    const gsTotalLuom = mergeUomTotals(gs.recvByLuom, gs.damByLuom);
    const gsTotalStr  = fmtUomTotals(gsTotalPuom) + (Object.keys(gsTotalLuom).length ? " / " + fmtUomTotals(gsTotalLuom) : "");
    const gsRecvStr   = fmtUomTotals(gs.recvByPuom) + (Object.keys(gs.recvByLuom).length ? " / " + fmtUomTotals(gs.recvByLuom) : "");
    const gsDamStr    = fmtUomTotals(gs.damByPuom)  + (Object.keys(gs.damByLuom).length  ? " / " + fmtUomTotals(gs.damByLuom)  : "");

    rows.push([
      xc(`Group Total : ${gs.groupName}`, "totalGroup"),
      skip, skip, skip, skip,
      xc("", "totalGroup"),
      xc(gsRecvStr, "numTotal"),
      xc(gsDamStr,  "numTotal"),
      xc(gsTotalStr, "numTotal"),
      xc("", "totalGroup"),
    ]);
  }

  // ── Grand-level UOM totals ────────────────────────────────────────────────
  const grandRecvPuom  = mergeUomTotals(...groups.map(g => g.recvByPuom));
  const grandRecvLuom  = mergeUomTotals(...groups.map(g => g.recvByLuom));
  const grandDamPuom   = mergeUomTotals(...groups.map(g => g.damByPuom));
  const grandDamLuom   = mergeUomTotals(...groups.map(g => g.damByLuom));
  const grandTotalPuom = mergeUomTotals(grandRecvPuom, grandDamPuom);
  const grandTotalLuom = mergeUomTotals(grandRecvLuom, grandDamLuom);

  const grandTotalStr = fmtUomTotals(grandTotalPuom) + (Object.keys(grandTotalLuom).length ? " / " + fmtUomTotals(grandTotalLuom) : "");
  const grandRecvStr  = fmtUomTotals(grandRecvPuom) + (Object.keys(grandRecvLuom).length ? " / " + fmtUomTotals(grandRecvLuom) : "");
  const grandDamStr   = fmtUomTotals(grandDamPuom)  + (Object.keys(grandDamLuom).length  ? " / " + fmtUomTotals(grandDamLuom)  : "");

  rows.push([
    xc("Grand Total", "totalGrand"),
    skip, skip, skip, skip,
    xc("", "totalGrand"),
    xc(grandRecvStr, "numGrand"),
    xc(grandDamStr,  "numGrand"),
    xc(grandTotalStr, "numGrand"),
    xc("", "totalGrand"),
  ]);

  const COL_WIDTHS = [13, 13, 16, 16, 10, 10, 22, 22, 22, 18];
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
  <sheets><sheet name="GRN Detail" sheetId="1" r:id="rId1"/></sheets>
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

export const getGrnReportHtml = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const jobNo       = text(req.params.job_no  || req.query.job_no);
    const prinCode    = text(req.query.prin_code || req.params.prin_code);
    const reportTitle = text(req.query.title)    || "Goods Receipt Note";
    const autoPrint   = req.query.print === "true";

    if (!jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "job_no and prin_code are required" });
      return;
    }

    const rows   = await loadGrnData(req, jobNo, prinCode);
    const groups = groupRows(rows);
    const first  = rows[0] ?? null;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHtml(groups, first, jobNo, prinCode, reportTitle, text(req.user?.loginid), autoPrint));
  } catch (error: any) {
    console.error("GRN HTML error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
  }
};

export const getGrnReportPdf = async (
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

    const rows        = await loadGrnData(req, jobNo, prinCode);
    const groups      = groupRows(rows);
    const first       = rows[0] ?? null;
    const reportTitle = "Goods Receipt Note";
    const html = renderHtml(groups, first, jobNo, prinCode, reportTitle, text(req.user?.loginid), true);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="GRN_${jobNo}.pdf"`);
    res.send(html);
  } catch (error: any) {
    console.error("GRN PDF error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate PDF" });
  }
};

export const getGrnReportExcel = async (
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

    const rows   = await loadGrnData(req, jobNo, prinCode);
    const groups = groupRows(rows);
    const buffer = buildExcelBuffer(groups, jobNo, prinCode);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="GRN_${jobNo}.xlsx"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("GRN Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
  }
};