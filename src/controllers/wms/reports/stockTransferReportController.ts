// src/controllers/wms/reports/stockTransferReportController.ts
import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
} from "../../common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = "Transfer" | "Confirmation";
type ReportRow = Record<string, any>;

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
    }, {}),
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value: unknown): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return text(value);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function yesNo(val: any): string {
  if (val === null || val === undefined) return "No";
  const s = String(val).trim().toUpperCase();
  return s === "Y" || s === "1" || s === "YES" || s === "TRUE" ? "Yes" : "No";
}

// ─── Request Param Parser ─────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  const body = req.body || {};
  const q = req.query || {};
  const p = req.params || {};

  const pick = (...vals: unknown[]): string => {
    for (const v of vals) {
      if (v !== undefined && v !== null && v !== "") return text(v).trim();
    }
    return "";
  };

  // Strip surrounding/embedded single & double quotes from any incoming value
  const clean = (v: string): string => v.replace(/['"]/g, "").trim();

  const companyCode =
    clean(
      pick(
        body.company_code,
        body.code1,
        q.company_code,
        p.company_code,
        req.user?.company_code,
      ),
    ) || "All";

  const prinCode =
    clean(
      pick(
        body.prin_code,
        body.principal_code,
        body.code2,
        q.prin_code,
        q.principal_code,
        p.prin_code,
      ),
    ) || "All";

  const stnNo = clean(
    pick(body.stn_no, body.number1, q.stn_no, p.stn_no, p.stnNo),
  );

  const reportType: ReportType =
    pick(body.report_type, body.reportType, q.report_type, q.reportType, "Transfer") ===
    "Confirmation"
      ? "Confirmation"
      : "Transfer";

  return {
    companyCode,
    prinCode,
    stnNo,
    reportType,
    loginId: req.user?.loginid ?? "",
  };
}

// ─── Data Loaders ────────────────────────────────────────────────────────────

async function loadStockTransferData(req: RequestWithUser): Promise<ReportRow[]> {
  const p = parseParams(req);
  const conn = await getConn(req);

  try {
    const sql = `
      SELECT
        TS_STN.STN_NO,
        TS_STN.STN_DATE,
        TS_STN.PRIN_CODE,
        TS_STN.DESCRIPTION,
        TS_STN.CONFIRMED        AS HDR_CONFIRMED,
        TS_STN.CONFIRMED_DATE,
        TS_STNDETAIL.SERIAL_NO,
        TS_STNDETAIL.PROD_CODE,
        TS_STNDETAIL.FROM_SITE,
        TS_STNDETAIL.TO_SITE,
        TS_STNDETAIL.FROM_LOC_START,
        TS_STNDETAIL.FROM_LOC_END,
        TS_STNDETAIL.TO_LOC_START,
        TS_STNDETAIL.TO_LOC_END,
        TS_STNDETAIL.QTY_PUOM,
        TS_STNDETAIL.P_UOM,
        TS_STNDETAIL.QTY_LUOM,
        TS_STNDETAIL.L_UOM,
        TS_STNDETAIL.PROCESSED,
        TS_STNDETAIL.CONFIRMED  AS DTL_CONFIRMED
      FROM TS_STN, TS_STNDETAIL
      WHERE TS_STN.STN_NO = TS_STNDETAIL.STN_NO
        AND TS_STN.PRIN_CODE = TS_STNDETAIL.PRIN_CODE
        AND TS_STN.COMPANY_CODE = TS_STNDETAIL.COMPANY_CODE
        AND TS_STN.COMPANY_CODE = :companyCode
        AND TS_STN.PRIN_CODE    = :prinCode
        AND TS_STN.STN_NO       = :stnNo
      ORDER BY TS_STNDETAIL.SERIAL_NO
    `;

    const result = await conn.execute(
      sql,
      {
        companyCode: p.companyCode,
        prinCode: p.prinCode,
        stnNo: p.stnNo,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

async function loadStockConfirmationData(req: RequestWithUser): Promise<ReportRow[]> {
  const p = parseParams(req);
  const conn = await getConn(req);

  try {
    const sql = `
      SELECT
        TS_STN.STN_NO,
        TS_STN.PRIN_CODE,
        TS_STN.DESCRIPTION,
        TS_STN.STN_DATE,
        TS_STN.ALLOCATED        AS HDR_ALLOCATED,
        TS_STN.ALLOCATED_DATE,
        TS_STN.CONFIRMED        AS HDR_CONFIRMED,
        TS_STN.CONFIRMED_DATE,

        TS_BATCH.PROD_CODE,
        TS_BATCH.TXN_TYPE,
        TS_BATCH.SITE_CODE,
        TS_BATCH.LOCATION_CODE,
        TS_BATCH.QTY_PUOM,
        TS_BATCH.P_UOM,
        TS_BATCH.QTY_LUOM,
        TS_BATCH.L_UOM,
        TS_BATCH.QUANTITY,
        TS_BATCH.PACKDET_NO,
        TS_BATCH.APPLIED_KEYNO,
        TS_BATCH.ALLOCATED      AS DTL_ALLOCATED,
        TS_BATCH.CONFIRMED      AS DTL_CONFIRMED,
        TS_BATCH.LOT_NO,
        TS_BATCH.MFG_DATE,
        TS_BATCH.EXP_DATE,
        TS_BATCH.BATCH_NO,

        MS_PRODUCT.PROD_NAME,
        MS_PRODUCT.UPPP
      FROM TS_BATCH, TS_STN, MS_PRODUCT
      WHERE TS_BATCH.COMPANY_CODE = TS_STN.COMPANY_CODE
        AND TS_BATCH.PRIN_CODE    = TS_STN.PRIN_CODE
        AND TS_BATCH.STN_NO       = TS_STN.STN_NO
        AND TS_BATCH.CONFIRMED    = 'Y'
        AND TS_STN.PRIN_CODE      = MS_PRODUCT.PRIN_CODE
        AND TS_STN.COMPANY_CODE   = MS_PRODUCT.COMPANY_CODE
        AND TS_BATCH.PROD_CODE    = MS_PRODUCT.PROD_CODE
        AND TS_BATCH.COMPANY_CODE = MS_PRODUCT.COMPANY_CODE
        AND TS_BATCH.PRIN_CODE    = MS_PRODUCT.PRIN_CODE
        AND TS_STN.COMPANY_CODE   = :companyCode
        AND TS_STN.PRIN_CODE      = :prinCode
        AND TS_STN.STN_NO         = :stnNo
    `;

    const result = await conn.execute(
      sql,
      {
        companyCode: p.companyCode,
        prinCode: p.prinCode,
        stnNo: p.stnNo,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Confirmation grouping ───────────────────────────────────────────────────

const TXN_TYPE_LABELS: Record<string, string> = {
  O: "Move from",
  OUT: "Move from",
  FROM: "Move from",
  "1": "Move from",
  I: "Move to",
  IN: "Move to",
  TO: "Move to",
  "2": "Move to",
};

function txnTypeLabel(v: any): string {
  const key = String(v ?? "").trim().toUpperCase();
  return TXN_TYPE_LABELS[key] ?? key;
}

function moveSortWeight(v: any): number {
  const label = txnTypeLabel(v);
  if (label === "Move from") return 0;
  if (label === "Move to") return 1;
  return 2;
}

interface ConfirmationLine {
  packdetNo: string;
  prodCode: string;
  prodName: string;
  uppp: string;
  rows: ReportRow[];
}

function groupConfirmationRows(rows: ReportRow[]): ConfirmationLine[] {
  const groups = new Map<string, ConfirmationLine>();
  const order: string[] = [];

  for (const row of rows) {
    const key = text(row.packdet_no ?? `${row.prod_code}-${row.applied_keyno}`);
    if (!groups.has(key)) {
      groups.set(key, {
        packdetNo: key,
        prodCode: text(row.prod_code),
        prodName: text(row.prod_name),
        uppp: text(row.uppp),
        rows: [],
      });
      order.push(key);
    }
    groups.get(key)!.rows.push(row);
  }

  order.forEach((key) => {
    groups
      .get(key)!
      .rows.sort(
        (a, b) => moveSortWeight(a.txn_type) - moveSortWeight(b.txn_type),
      );
  });

  return order
    .map((key) => groups.get(key)!)
    .sort((a, b) => {
      const na = Number(a.packdetNo);
      const nb = Number(b.packdetNo);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return 0;
    });
}

// ─── Stock Transfer CSS — report_common aligned ──────────────────────────────

const STOCK_TRANSFER_EXTRA_CSS = `
  /* No @page/body margins — from report_common COMMON_REPORT_CSS */

  .doc-title-row {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin: 4px 0 12px 0;
  }
  .doc-title-row h1 {
    margin: 0; font-size: 18px; font-weight: 800; color: #0b4ca1;
  }

  .info-block {
    display: flex; justify-content: space-between; gap: 24px;
    margin-bottom: 12px; padding-bottom: 10px;
    border-bottom: 2px solid #0b4ca1;
    font-size: 11px;
  }
  .info-left, .info-right { display: flex; flex-direction: column; gap: 3px; }
  .info-block .label { color: #64748b; font-weight: 600; }

  table.stock-transfer-table {
    width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 3px;
  }
  table.stock-transfer-table thead th {
    background: #f1f5f9; color: #0f172a; font-weight: 700;
    font-size: 10px; padding: 6px 5px; text-align: center;
    border-top: 1px solid #475569; border-bottom: 1px solid #475569;
  }
  table.stock-transfer-table tbody td {
    padding: 4px 5px; border-bottom: 1px solid #e2e8f0; color: #0f172a;
    vertical-align: top;
  }
  table.stock-transfer-table .group-header td {
    background: #0b4ca1; color: #fff; font-weight: 700;
    border-top: 2px solid #093d82;
  }
  table.stock-transfer-table .status-row td {
    border-top: none; font-style: italic; color: #64748b;
    padding-top: 0; line-height: 1.2; background: #f8fafc;
  }
  table.stock-transfer-table .subtotal td {
    background: #f1f5f9; font-weight: 700; color: #0b4ca1;
    border-top: 2px solid #0b4ca1;
  }
  .center { text-align: center; }
  .left { text-align: left; }
  .right { text-align: right; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .muted { color: #64748b; }
`;

// ─── HTML Body Renderers ─────────────────────────────────────────────────────

function renderStockTransferBody(rows: ReportRow[]): string {
  const header = rows[0] || {};
  const title = `Stock transfer entry  |  STN #${text(header.stn_no)}`;

  const bodyRows =
    rows
      .map(
        (row) => `
        <tr>
          <td class="center">${escapeHtml(row.serial_no)}</td>
          <td class="left">${escapeHtml(row.prod_code)}</td>
          <td class="center">${escapeHtml(row.from_site)}</td>
          <td class="center">${escapeHtml(row.from_loc_start)}</td>
          <td class="center">${escapeHtml(row.from_loc_end)}</td>
          <td class="center">${escapeHtml(row.to_site)}</td>
          <td class="center">${escapeHtml(row.to_loc_start)}</td>
          <td class="center">${escapeHtml(row.to_loc_end)}</td>
          <td class="num">${fmtNumber(num(row.qty_puom))}</td>
          <td class="center">${escapeHtml(row.p_uom)}</td>
          <td class="num">${fmtNumber(num(row.qty_luom))}</td>
          <td class="center">${escapeHtml(row.l_uom)}</td>
        </tr>
        <tr class="status-row">
          <td class="center"></td>
          <td colspan="11">Status: ${escapeHtml(
            yesNo(row.dtl_confirmed) === "Yes" ? "Confirmed" : "Not Confirmed",
          )}</td>
        </tr>`,
      )
      .join("") ||
    `<tr><td colspan="12" class="center muted">No data found</td></tr>`;

  return `
    <div class="doc-title-row">
      <div><h1>${escapeHtml(title)}</h1></div>
    </div>

    <div class="info-block">
      <div class="info-left">
        <div><span class="label">Principal:</span> ${escapeHtml(
          header.prin_code,
        )} ${escapeHtml(header.prin_name)}</div>
        <div><span class="label">Transfer No.:</span> ${escapeHtml(
          header.stn_no,
        )} &nbsp;&nbsp;<span class="label">Date :</span> ${escapeHtml(
          formatDate(header.stn_date),
        )}</div>
        <div><span class="label">Description:</span> ${escapeHtml(
          header.description,
        )}</div>
      </div>
      <div class="info-right">
        <div><span class="label">Confirmed :</span> ${escapeHtml(
          yesNo(header.hdr_confirmed),
        )}</div>
        <div><span class="label">Confirm Date :</span> ${escapeHtml(
          formatDate(header.confirmed_date),
        )}</div>
      </div>
    </div>

    <table class="data-table stock-transfer-table">
      <thead>
        <tr>
          <th rowspan="2" style="width:4%">No.</th>
          <th rowspan="2" style="width:12%">Product</th>
          <th colspan="3">From Site</th>
          <th colspan="3">To Site</th>
          <th colspan="4">Quantity</th>
        </tr>
        <tr>
          <th>Fr.Site</th>
          <th>Loc Start</th>
          <th>Loc End</th>
          <th>To Site</th>
          <th>Loc Start</th>
          <th>Loc End</th>
          <th>Qty Puom</th>
          <th>Uom</th>
          <th>Qty Luom</th>
          <th>Uom</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <script>
      window.addEventListener("message", (e) => {
        if (e.data === "print") window.print();
      });
    </script>
  `;
}

function renderStockConfirmationBody(rows: ReportRow[]): string {
  const header = rows[0] || {};
  const title = `Confirmation report  |  STN #${text(header.stn_no)}`;
  const lines = groupConfirmationRows(rows);

  let no = 0;
  const bodyRows =
    lines
      .map((line) => {
        no += 1;
        const detailRows = line.rows
          .map(
            (row) => `
          <tr>
            <td class="center"></td>
            <td class="left" style="font-weight:700">${escapeHtml(
              txnTypeLabel(row.txn_type),
            )}</td>
            <td class="center">${escapeHtml(row.site_code)}</td>
            <td class="center">${escapeHtml(row.location_code)}</td>
            <td class="center">${escapeHtml(formatDate(row.exp_date))}</td>
            <td class="center">${escapeHtml(row.batch_no)}</td>
            <td class="center">${escapeHtml(row.lot_no)}</td>
            <td class="num">${fmtNumber(num(row.qty_puom))}</td>
            <td class="center">${escapeHtml(row.p_uom)}</td>
            <td class="num">${fmtNumber(num(row.qty_luom))}</td>
            <td class="center">${escapeHtml(row.l_uom)}</td>
            <td class="num">${fmtNumber(num(row.quantity))}</td>
          </tr>`,
          )
          .join("");

        const totals = line.rows.reduce(
          (acc, row) => ({
            qtyPuom: acc.qtyPuom + num(row.qty_puom),
            qtyLuom: acc.qtyLuom + num(row.qty_luom),
            quantity: acc.quantity + num(row.quantity),
          }),
          { qtyPuom: 0, qtyLuom: 0, quantity: 0 },
        );

        return `
          <tr class="group-header">
            <td class="center">${no}</td>
            <td class="left" colspan="6">${escapeHtml(
              line.prodCode,
            )} ${escapeHtml(line.prodName)}</td>
            <td class="right" colspan="5">UPPP:${escapeHtml(line.uppp)}</td>
          </tr>
          ${detailRows}
          <tr class="subtotal">
            <td class="empty" colspan="7"></td>
            <td>${escapeHtml(fmtNumber(totals.qtyPuom))}</td>
            <td class="empty"></td>
            <td>${escapeHtml(fmtNumber(totals.qtyLuom))}</td>
            <td class="empty"></td>
            <td>${escapeHtml(fmtNumber(totals.quantity))}</td>
          </tr>`;
      })
      .join("") ||
    `<tr><td colspan="12" class="center muted">No data found</td></tr>`;

  return `
    <div class="doc-title-row">
      <div><h1>${escapeHtml(title)}</h1></div>
    </div>

    <div class="info-block">
      <div class="info-left">
        <div><span class="label">Principal:</span> ${escapeHtml(
          header.prin_code,
        )}</div>
        <div><span class="label">Transfer No.:</span> ${escapeHtml(
          header.stn_no,
        )} &nbsp;&nbsp;<span class="label">Date :</span> ${escapeHtml(
          formatDate(header.stn_date),
        )}</div>
        <div><span class="label">Description:</span> ${escapeHtml(
          header.description,
        )}</div>
      </div>
      <div class="info-right">
        <div><span class="label">Confirmed :</span> ${escapeHtml(
          yesNo(header.hdr_confirmed ?? header.dtl_confirmed),
        )}</div>
        <div><span class="label">Confirm Date :</span> ${escapeHtml(
          formatDate(header.confirmed_date),
        )}</div>
      </div>
    </div>

    <table class="data-table stock-transfer-table">
      <thead>
        <tr>
          <th style="width:4%">No.</th>
          <th>Product</th>
          <th style="width:8%">Site Code</th>
          <th style="width:9%">Location</th>
          <th style="width:10%">Exp Date</th>
          <th style="width:9%">Batch No</th>
          <th style="width:8%">Lot No</th>
          <th style="width:9%">Qty Puom</th>
          <th style="width:6%">Uom</th>
          <th style="width:9%">Qty Luom</th>
          <th style="width:6%">Uom</th>
          <th style="width:9%">Quantity</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <script>
      window.addEventListener("message", (e) => {
        if (e.data === "print") window.print();
      });
    </script>
  `;
}

// ─── Excel Builders ──────────────────────────────────────────────────────────

function buildTransferExcelBuffer(
  rows: ReportRow[],
  loginId: string,
): Buffer {
  const header = rows[0] || {};
  const printDate = formatDate(new Date());

  const sheetData: any[][] = [];
  sheetData.push([`Stock Transfer Entry | STN #${text(header.stn_no)}`]);
  sheetData.push([`Date : ${printDate}`, "", `User : ${loginId}`]);
  sheetData.push([]);
  sheetData.push([`Principal : ${text(header.prin_code)} ${text(header.prin_name)}`]);
  sheetData.push([`Transfer No. : ${text(header.stn_no)}`]);
  sheetData.push([`Doc Date : ${formatDate(header.stn_date)}`]);
  sheetData.push([`Description : ${text(header.description)}`]);
  sheetData.push([`Confirmed : ${yesNo(header.hdr_confirmed)}`]);
  sheetData.push([`Confirm Date : ${formatDate(header.confirmed_date)}`]);
  sheetData.push([]);
  sheetData.push([
    "No.",
    "Product",
    "Fr.Site",
    "Fr.Loc Start",
    "Fr.Loc End",
    "To Site",
    "To.Loc Start",
    "To.Loc End",
    "Qty Puom",
    "P.Uom",
    "Qty Luom",
    "L.Uom",
  ]);
  rows.forEach((row) => {
    sheetData.push([
      num(row.serial_no),
      text(row.prod_code),
      text(row.from_site),
      text(row.from_loc_start),
      text(row.from_loc_end),
      text(row.to_site),
      text(row.to_loc_start),
      text(row.to_loc_end),
      num(row.qty_puom),
      text(row.p_uom),
      num(row.qty_luom),
      text(row.l_uom),
    ]);
    sheetData.push([
      "",
      `Status: ${yesNo(row.dtl_confirmed) === "Yes" ? "Confirmed" : "Not Confirmed"}`,
    ]);
  });

  if (!rows.length) sheetData.push(["", "No data found"]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!cols"] = Array.from({ length: 12 }, () => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws, "Stock Transfer");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildConfirmationExcelBuffer(
  rows: ReportRow[],
  loginId: string,
): Buffer {
  const header = rows[0] || {};
  const printDate = formatDate(new Date());
  const lines = groupConfirmationRows(rows);

  const sheetData: any[][] = [];
  sheetData.push([`Stock Confirmation Report | STN #${text(header.stn_no)}`]);
  sheetData.push([`Date : ${printDate}`, "", `User : ${loginId}`]);
  sheetData.push([]);
  sheetData.push([`Principal : ${text(header.prin_code)}`]);
  sheetData.push([`Transfer No. : ${text(header.stn_no)}`]);
  sheetData.push([`Doc Date : ${formatDate(header.stn_date)}`]);
  sheetData.push([`Description : ${text(header.description)}`]);
  sheetData.push([`Confirmed : ${yesNo(header.hdr_confirmed ?? header.dtl_confirmed)}`]);
  sheetData.push([`Confirm Date : ${formatDate(header.confirmed_date)}`]);
  sheetData.push([]);
  sheetData.push([
    "No.",
    "Product",
    "Site Code",
    "Location",
    "Exp Date",
    "Batch No",
    "Lot No",
    "Qty Puom",
    "P.Uom",
    "Qty Luom",
    "L.Uom",
    "Quantity",
  ]);

  lines.forEach((line, idx) => {
    sheetData.push([
      idx + 1,
      `${line.prodCode} ${line.prodName}  (UPPP:${line.uppp})`,
    ]);
    const totals = { qtyPuom: 0, qtyLuom: 0, quantity: 0 };
    line.rows.forEach((row) => {
      const qtyPuom = num(row.qty_puom);
      const qtyLuom = num(row.qty_luom);
      const quantity = num(row.quantity);
      totals.qtyPuom += qtyPuom;
      totals.qtyLuom += qtyLuom;
      totals.quantity += quantity;

      sheetData.push([
        "",
        txnTypeLabel(row.txn_type),
        text(row.site_code),
        text(row.location_code),
        formatDate(row.exp_date),
        text(row.batch_no),
        text(row.lot_no),
        qtyPuom,
        text(row.p_uom),
        qtyLuom,
        text(row.l_uom),
        quantity,
      ]);
    });
    sheetData.push([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      totals.qtyPuom,
      "",
      totals.qtyLuom,
      "",
      totals.quantity,
    ]);
  });

  if (!lines.length) sheetData.push(["", "No data found"]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!cols"] = Array.from({ length: 12 }, () => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws, "Confirmation");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getStockTransferReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadStockTransferData(req);

    if (!rows.length) {
      res.status(400).json({
        success: false,
        message: `No stock transfer data found for STN ${params.stnNo}`,
      });
      return;
    }

    const headerHtml = await reportHeader({
      company_code: params.companyCode,
      req,
    });
    const bodyHtml = renderStockTransferBody(rows);
    const footerHtml = reportFooter({
      reportName: "rpt_transfer_entry",
      userName: params.loginId,
      endLabel: "End of Report",
    });

    const html = buildReportDocument({
      title: `Stock Transfer Entry | STN #${params.stnNo}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: STOCK_TRANSFER_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Stock Transfer Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportStockTransferReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadStockTransferData(req);

    if (!rows.length) {
      res.status(400).json({
        success: false,
        message: `No stock transfer data found for STN ${params.stnNo}`,
      });
      return;
    }

    const buffer = buildTransferExcelBuffer(rows, params.loginId);
    const filename = `stock_transfer_${params.stnNo}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Stock Transfer Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};

export const getStockConfirmationReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadStockConfirmationData(req);

    if (!rows.length) {
      res.status(404).json({
        success: false,
        message: `No confirmation data found for STN ${params.stnNo}`,
      });
      return;
    }

    const headerHtml = await reportHeader({
      company_code: params.companyCode,
      req,
    });
    const bodyHtml = renderStockConfirmationBody(rows);
    const footerHtml = reportFooter({
      reportName: "rpt_transfer_confirmed",
      userName: params.loginId,
      endLabel: "End of Report",
    });

    const html = buildReportDocument({
      title: `Confirmation report | STN #${params.stnNo}`,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: STOCK_TRANSFER_EXTRA_CSS,
      autoPrint: req.query.print !== "false",
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Stock Confirmation Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportStockConfirmationReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadStockConfirmationData(req);

    if (!rows.length) {
      res.status(404).json({
        success: false,
        message: `No confirmation data found for STN ${params.stnNo}`,
      });
      return;
    }

    const buffer = buildConfirmationExcelBuffer(rows, params.loginId);
    const filename = `stock_confirmation_${params.stnNo}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
  } catch (error: any) {
    console.error("Stock Confirmation Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};