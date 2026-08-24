import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";
const AdmZip = require("adm-zip");

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = "Summary" | "Detail";
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
    maximumFractionDigits: 2,
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

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

function docLabel(docType: unknown, docNo: unknown): string {
  const t = text(docType).trim();
  const n = text(docNo).trim();
  if (t && n) return `${t} ${n}`;
  return t || n || "";
}

// ─── Request Param Parser ────────────────────────────────────────────────────

function parseParams(req: RequestWithUser) {
  const body = req.body || {};

  const companyCode = text(body.company_code || body.code1 || req.user?.company_code || "").trim() || "All";
  const supplierCode = text(body.supplier_code || body.code2 || "All").trim() || "All";
  const productFrom = text(body.product_from || body.code3 || "All").trim() || "All";
  const productTo = text(body.product_to || body.code4 || "All").trim() || "All";
  const cancelled = text(body.cancelled || body.code5 || "N").toUpperCase() === "Y" ? "Y" : "N";
  const docNoRaw = body.doc_no ?? body.number1 ?? 0;
  const docNo = Number(docNoRaw) || 0;

  const dateFrom = body.date_from || body.date1 || null;
  const dateTo = body.date_to || body.date2 || null; // exclusive if frontend adds +1 day

  const reportType: ReportType =
    text(body.report_type || body.reportType || "Summary") === "Detail"
      ? "Detail"
      : "Summary";

  return {
    companyCode,
    supplierCode,
    productFrom,
    productTo,
    cancelled,
    docNo,
    dateFrom,
    dateTo,
    reportType,
    loginId: req.user?.loginid ?? "",
  };
}

// ─── Data Loader ─────────────────────────────────────────────────────────────

async function loadPendingPOData(req: RequestWithUser): Promise<ReportRow[]> {
  const p = parseParams(req);
  const conn = await getConn(req);

  try {
    // Detail = line level from vw_erp_purorder
    // Summary = aggregated per document
    if (p.reportType === "Detail") {
      const sql = `
        SELECT
          DOC_TYPE,
          DOC_NO,
          DOC_DATE,
          DIV_NAME,
          AC_NAME,
          REMARKS,
          AC_CODE,
          PROD_CODE,
          PROD_NAME,
          DET_REMARKS,
          L_UOM,
          QUANTITY,
          REQUIRED_DT,
          QTY_PROCESSED,
          QTY_BALANCE,
          NVL(CANCELLED, 'N') AS CANCELLED
        FROM VW_ERP_PURORDER
        WHERE COMPANY_CODE = :companyCode
          AND (:supplierCode = 'All' OR AC_CODE = :supplierCode)
          AND (:productFrom = 'All' OR PROD_CODE >= :productFrom)
          AND (:productTo = 'All' OR PROD_CODE <= :productTo)
          AND (:cancelled = 'Y' OR NVL(CANCELLED, 'N') <> 'Y')
          AND (:docNo = 0 OR DOC_NO = :docNo)
          AND (:dateFrom IS NULL OR DOC_DATE >= TO_DATE(:dateFrom, 'YYYY-MM-DD'))
          AND (:dateTo IS NULL OR DOC_DATE < TO_DATE(:dateTo, 'YYYY-MM-DD'))
          AND QTY_BALANCE > 0
        ORDER BY DOC_DATE DESC, DOC_NO, PROD_CODE
      `;

      const binds: Record<string, any> = {
        companyCode: p.companyCode,
        supplierCode: p.supplierCode,
        productFrom: p.productFrom,
        productTo: p.productTo,
        cancelled: p.cancelled,
        docNo: p.docNo,
        dateFrom: p.dateFrom || null,
        dateTo: p.dateTo || null,
      };

      const result = await conn.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      return normalize(result.rows as any[]);
    }

    // Summary
    const sql = `
      SELECT
        DOC_TYPE,
        DOC_NO,
        DOC_DATE,
        MAX(DIV_NAME) AS DIV_NAME,
        MAX(AC_NAME) AS AC_NAME,
        MAX(REMARKS) AS REMARKS,
        MAX(AC_CODE) AS AC_CODE,
        SUM(QUANTITY) AS TOTAL_QTY,
        SUM(QTY_PROCESSED) AS PROCESS_QTY,
        COUNT(*) AS NO_ITEMS,
        SUM(QTY_BALANCE) AS QTY_BALANCE
      FROM VW_ERP_PURORDER
      WHERE COMPANY_CODE = :companyCode
        AND (:supplierCode = 'All' OR AC_CODE = :supplierCode)
        AND (:productFrom = 'All' OR PROD_CODE >= :productFrom)
        AND (:productTo = 'All' OR PROD_CODE <= :productTo)
        AND (:cancelled = 'Y' OR NVL(CANCELLED, 'N') <> 'Y')
        AND (:docNo = 0 OR DOC_NO = :docNo)
        AND (:dateFrom IS NULL OR DOC_DATE >= TO_DATE(:dateFrom, 'YYYY-MM-DD'))
        AND (:dateTo IS NULL OR DOC_DATE < TO_DATE(:dateTo, 'YYYY-MM-DD'))
        AND QTY_BALANCE > 0
      GROUP BY DOC_TYPE, DOC_NO, DOC_DATE
      ORDER BY DOC_DATE DESC, DOC_NO
    `;

    const binds: Record<string, any> = {
      companyCode: p.companyCode,
      supplierCode: p.supplierCode,
      productFrom: p.productFrom,
      productTo: p.productTo,
      cancelled: p.cancelled,
      docNo: p.docNo,
      dateFrom: p.dateFrom || null,
      dateTo: p.dateTo || null,
    };

    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

// ─── Grouping (Detail) ────────────────────────────────────────────────────────

function groupDetailByDoc(rows: ReportRow[]): Array<{
  key: string;
  header: ReportRow;
  lines: ReportRow[];
  totalQty: number;
}> {
  const map = new Map<
    string,
    { key: string; header: ReportRow; lines: ReportRow[]; totalQty: number }
  >();

  rows.forEach((r) => {
    const key = `${text(r.doc_type)}|${text(r.doc_no)}`;
    if (!map.has(key)) {
      map.set(key, { key, header: r, lines: [], totalQty: 0 });
    }
    const g = map.get(key)!;
    g.lines.push(r);
    g.totalQty += num(r.quantity);
  });

  return Array.from(map.values());
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderHtml(
  rows: ReportRow[],
  reportType: ReportType,
  loginId: string,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const periodFrom = dateFrom ? formatDate(dateFrom) : "";
  const periodTo = dateTo
    ? formatDate(
        (() => {
          // dateTo is exclusive (+1 day from UI); show inclusive end as -1 day for title
          const d = new Date(dateTo);
          if (isNaN(d.getTime())) return dateTo;
          d.setDate(d.getDate() - 1);
          return d;
        })(),
      )
    : "";

  const title =
    reportType === "Summary"
      ? `Pending Purchase Orders List for the Period ${periodFrom} - ${periodTo}`
      : "Purchase Orders";

  const styles = `
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
        color: #111;
        margin: 16px;
      }
      .meta {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 8px;
        font-size: 11px;
        color: #374151;
      }
      .title {
        text-align: center;
        font-size: 15px;
        font-weight: 700;
        margin: 4px 0 12px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th {
        border: 1px solid #333;
        background: #f3f4f6;
        padding: 6px 8px;
        text-align: left;
        font-weight: 700;
        font-size: 11px;
      }
      td {
        border: 1px solid #ccc;
        padding: 5px 8px;
        font-size: 11px;
      }
      .num { text-align: right; }
      .center { text-align: center; }
      .group-header td {
        background: #f9fafb;
        font-weight: 700;
        border-top: 2px solid #185FA5;
      }
      .subtotal td {
        background: #f3f4f6;
        font-weight: 700;
      }
      .footer {
        text-align: center;
        margin-top: 16px;
        color: #6b7280;
        font-size: 11px;
      }
      .cancelled { color: #dc2626; font-weight: 700; margin-left: 12px; }
      @media print {
        body { margin: 8px; }
      }
    </style>
  `;

  let body = "";

  if (reportType === "Summary") {
    body = `
      <table>
        <thead>
          <tr>
            <th style="width:14%">Document No.</th>
            <th style="width:10%">Doc Date</th>
            <th style="width:28%">Supplier</th>
            <th style="width:12%" class="num">P.O Quantity</th>
            <th style="width:12%" class="num">Balance Quantity</th>
            <th style="width:8%" class="num">No. of Items</th>
            <th style="width:16%">Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (r) => `
            <tr>
              <td>${escapeHtml(docLabel(r.doc_type, r.doc_no))}</td>
              <td>${escapeHtml(formatDate(r.doc_date))}</td>
              <td>${escapeHtml(r.ac_name)}</td>
              <td class="num">${fmtNumber(num(r.total_qty))}</td>
              <td class="num">${fmtNumber(num(r.qty_balance))}</td>
              <td class="num">${fmtNumber(num(r.no_items))}</td>
              <td>${escapeHtml(r.remarks)}</td>
            </tr>`,
                  )
                  .join("")
              : `<tr><td colspan="7" class="center">No pending purchase orders found.</td></tr>`
          }
        </tbody>
      </table>
    `;
  } else {
    const groups = groupDetailByDoc(rows);
    body = `
      <table>
        <thead>
          <tr>
            <th style="width:12%">Product</th>
            <th style="width:28%">Description</th>
            <th style="width:8%" class="center">UOM</th>
            <th style="width:12%" class="num">P.O Qty</th>
            <th style="width:12%" class="center">Required Date</th>
            <th style="width:28%">Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${
            groups.length
              ? groups
                  .map((g) => {
                    const cancelled =
                      text(g.header.cancelled).toUpperCase() === "Y"
                        ? `<span class="cancelled">Cancelled</span>`
                        : "";
                    const lines = g.lines
                      .map(
                        (r) => `
              <tr>
                <td>${escapeHtml(r.prod_code)}</td>
                <td>${escapeHtml(r.prod_name)}</td>
                <td class="center">${escapeHtml(r.l_uom)}</td>
                <td class="num">${fmtNumber(num(r.quantity))}</td>
                <td class="center">${escapeHtml(formatDate(r.required_dt))}</td>
                <td>${escapeHtml(r.det_remarks)}</td>
              </tr>`,
                      )
                      .join("");
                    return `
              <tr class="group-header">
                <td colspan="6">
                  Doc No. : ${escapeHtml(docLabel(g.header.doc_type, g.header.doc_no))}
                  &nbsp;&nbsp; Doc Date : ${escapeHtml(formatDate(g.header.doc_date))}
                  &nbsp;&nbsp; Supplier : ${escapeHtml(g.header.ac_name)}
                  ${cancelled}
                </td>
              </tr>
              ${lines}
              <tr class="subtotal">
                <td colspan="3" style="text-align:right">
                  Total Qty for ${escapeHtml(docLabel(g.header.doc_type, g.header.doc_no))} :
                </td>
                <td class="num">${fmtNumber(g.totalQty)}</td>
                <td colspan="2"></td>
              </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="6" class="center">No pending purchase order lines found.</td></tr>`
          }
        </tbody>
      </table>
    `;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  ${styles}
</head>
<body>
  <div class="meta">
    <div>
      <div>Date : ${escapeHtml(printDate)}</div>
      <div>User : ${escapeHtml(loginId)}</div>
    </div>
  </div>
  <div class="title">${escapeHtml(title)}</div>
  ${body}
  <div class="footer">End of Report</div>
</body>
</html>`;
}

// ─── Excel Builder ────────────────────────────────────────────────────────────

function buildExcelBuffer(
  rows: ReportRow[],
  reportType: ReportType,
  loginId: string,
  dateFrom: string | null,
  dateTo: string | null,
): Buffer {
  const printDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const periodFrom = dateFrom ? formatDate(dateFrom) : "";
  let periodTo = "";
  if (dateTo) {
    const d = new Date(dateTo);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() - 1);
      periodTo = formatDate(d);
    } else periodTo = formatDate(dateTo);
  }

  const sheetData: any[][] = [];

  if (reportType === "Summary") {
    sheetData.push([
      `Pending Purchase Orders List for the Period ${periodFrom} - ${periodTo}`,
    ]);
    sheetData.push([`Date : ${printDate}`, "", `User : ${loginId}`]);
    sheetData.push([]);
    sheetData.push([
      "Document No.",
      "Doc Date",
      "Supplier",
      "P.O Quantity",
      "Balance Quantity",
      "No. of Items",
      "Remarks",
    ]);
    rows.forEach((r) => {
      sheetData.push([
        docLabel(r.doc_type, r.doc_no),
        formatDate(r.doc_date),
        text(r.ac_name),
        num(r.total_qty),
        num(r.qty_balance),
        num(r.no_items),
        text(r.remarks),
      ]);
    });
  } else {
    sheetData.push(["Purchase Orders — Detail"]);
    sheetData.push([`Date : ${printDate}`, "", `User : ${loginId}`]);
    sheetData.push([]);
    sheetData.push([
      "Doc No",
      "Doc Date",
      "Supplier",
      "Product Code",
      "Product Name",
      "UOM",
      "P.O Qty",
      "Required Date",
      "Remarks",
    ]);
    rows.forEach((r) => {
      sheetData.push([
        docLabel(r.doc_type, r.doc_no),
        formatDate(r.doc_date),
        text(r.ac_name),
        text(r.prod_code),
        text(r.prod_name),
        text(r.l_uom),
        num(r.quantity),
        formatDate(r.required_dt),
        text(r.det_remarks),
      ]);
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!cols"] = Array.from({ length: 9 }, () => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    reportType === "Summary" ? "PO Summary" : "PO Detail",
  );

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getPendingPOReportHtml = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadPendingPOData(req);
    const html = renderHtml(
      rows,
      params.reportType,
      params.loginId,
      params.dateFrom,
      params.dateTo,
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Pending PO Report HTML error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate report",
    });
  }
};

export const exportPendingPOReportExcel = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const params = parseParams(req);
    const rows = await loadPendingPOData(req);
    const buffer = buildExcelBuffer(
      rows,
      params.reportType,
      params.loginId,
      params.dateFrom,
      params.dateTo,
    );
    const filename = `pending_po_${params.reportType.toLowerCase()}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.end(buffer);
  } catch (error: any) {
    console.error("Pending PO Report Excel error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to export report",
    });
  }
};