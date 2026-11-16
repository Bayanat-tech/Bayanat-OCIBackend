import { Request, Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import {
  buildReportDocument,
  reportFooter,
  reportHeader,
} from "../../../common/report_common";
import { RequestWithUser } from "../../../../interfaces/common.interface";

/* ── Formatting helpers ── */
const currencyDecimals = (code?: string | null): number => {
  if (!code) return 3;
  const c = String(code).toUpperCase().trim();
  if (c === "INR" || c === "USD" || c === "EUR" || c === "AED" || c === "SAR") return 2;
  if (c === "OMR" || c === "BHD" || c === "KWD") return 3;
  return 2;
};

const makeMoney = (decimals: number) => (v: any) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const text = (v: any) => (v == null ? "" : String(v));

const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

const formatBalance = (value: number, decimals: number) => {
  const money = makeMoney(decimals);
  return value < 0 ? `(${money(Math.abs(value))})` : money(value);
};

const escapeHtml = (value: unknown): string => {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const COMMON_TABLE_CSS = `
  @page {
    size: A4 landscape;
    margin: 8mm 8mm 12mm 8mm;
  }
  .paper {
    max-width: 297mm;
    margin: 0 auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #1e293b;
  }
  .report-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #0b4ca1;
    padding-bottom: 6px;
    margin-bottom: 12px;
  }
  .meta-title {
    font-size: 16px;
    font-weight: 800;
    color: #0b4ca1;
    margin: 0;
  }
  .meta-badges {
    display: flex;
    gap: 8px;
  }
  .badge {
    background: #e2e8f0;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    padding: 2px 10px;
    font-size: 11px;
    font-weight: 600;
  }
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  table.data-table th {
    background: #1e3a5f;
    color: #ffffff;
    font-weight: 700;
    padding: 6px 5px;
    border: 1px solid #0f2744;
    text-align: left;
    white-space: nowrap;
  }
  table.data-table th.num { text-align: right; }
  table.data-table th.center { text-align: center; }
  table.data-table td {
    padding: 5px 5px;
    border: 1px solid #e2e8f0;
    vertical-align: top;
  }
  table.data-table td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  table.data-table td.center { text-align: center; }
  table.data-table tbody tr:nth-child(even) td {
    background: #f8fafc;
  }
  table.data-table tfoot tr td {
    background: #e2e8f0;
    font-weight: 700;
    border-top: 2px solid #0b4ca1;
    border-bottom: 2px solid #0b4ca1;
  }
  .empty-cell {
    padding: 30px;
    text-align: center;
    color: #64748b;
    font-size: 13px;
  }
  .doc-link-wrap {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .doc-open-link {
    color: #00378c;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
  }
  .doc-open-link:hover {
    color: #0b4ca1;
  }
  .doc-screen-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: 3px;
    background: #e2e8f0;
    border: 1px solid #cbd5e1;
    color: #1e293b;
    font-size: 10px;
    line-height: 1;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    transition: all 0.15s ease;
  }
  .doc-screen-btn:hover {
    background: #00378c;
    color: #ffffff;
    border-color: #00378c;
  }
  @media print {
    table.data-table th { background: #1e3a5f !important; color: #fff !important; }
    tbody tr { break-inside: avoid; }
    .doc-screen-btn { display: none !important; }
  }
`;

function renderDocCell(docType: unknown, docNo: unknown): string {
  const dt = escapeHtml(docType);
  const dn = escapeHtml(docNo);
  if (!dn) return "-";
  return `
    <span class="doc-link-wrap">
      <a href="javascript:void(0)" class="doc-open-link" title="Preview ${dt} ${dn} (Audit View)" onclick="event.stopPropagation(); window.parent.postMessage({ type: 'OPEN_DOCUMENT', docType: '${dt}', docNo: '${dn}' }, '*');">${dn}</a>
      <button type="button" class="doc-screen-btn" title="Open directly in ${dt} operational screen" onclick="event.stopPropagation(); window.parent.postMessage({ type: 'OPEN_DOCUMENT_SCREEN', docType: '${dt}', docNo: '${dn}' }, '*');">↗</button>
    </span>`;
}

async function getConnection(req: RequestWithUser | Request): Promise<oracledb.Connection> {
  const loginid = (req as any).user?.loginid || req.body?.loginid || "ADMIN";
  let tenantId = getCurrentTenantId();
  if (!tenantId && loginid) {
    tenantId = await TenantManager.getTenantForUser(loginid);
  }
  if (!tenantId) {
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  }
  return TenantManager.getConnection(tenantId);
}

/* ─────────────────────────────────────────────────────────────
   1. SALES REGISTER REPORT
───────────────────────────────────────────────────────────── */
export async function loadSalesRegisterData(req: Request) {
  const { code1, code2, code3, code5, code6, docno_from, docno_to, doc_type } = req.body;
  const companyCode = code1 || (req as any).user?.company_code || "BSG";
  const divCode = code2 && code2 !== "All" && code2 !== "" ? code2 : null;
  const acCode = code3 && code3 !== "All" && code3 !== "" ? code3 : null;
  const docType = doc_type && doc_type !== "ALL" ? doc_type : "SI";

  const conn = await getConnection(req);
  try {
    let sql = `
      SELECT 
        d.COMPANY_CODE, d.DOC_TYPE, d.DOC_NO, d.SERIAL_NO, d.DOC_DATE,
        d.AC_CODE, m.AC_NAME, d.DIV_CODE, h.REF_NO, h.REF_DATE,
        d.REMARKS, d.CURR_CODE, d.AMOUNT, d.LCUR_AMOUNT, d.SIGN_IND,
        CASE WHEN d.SIGN_IND > 0 THEN d.LCUR_AMOUNT ELSE 0 END AS DEBIT,
        CASE WHEN d.SIGN_IND < 0 THEN ABS(d.LCUR_AMOUNT) ELSE 0 END AS CREDIT
      FROM TR_AC_DETAIL d
      LEFT JOIN MS_ACCODES m ON m.COMPANY_CODE = d.COMPANY_CODE AND m.AC_CODE = d.AC_CODE
      LEFT JOIN TR_AC_HEADER h ON h.COMPANY_CODE = d.COMPANY_CODE AND h.DOC_TYPE = d.DOC_TYPE AND h.DOC_NO = d.DOC_NO
      WHERE d.COMPANY_CODE = :companyCode
        AND NVL(d.CANCELLED, 'N') <> 'Y'
    `;

    const binds: any = { companyCode };

    if (docType === "SI") {
      sql += ` AND d.DOC_TYPE IN ('SI', 'SV') `;
    } else if (docType) {
      sql += ` AND d.DOC_TYPE = :docType `;
      binds.docType = docType;
    }

    if (divCode) {
      sql += ` AND d.DIV_CODE = :divCode `;
      binds.divCode = divCode;
    }

    if (acCode) {
      const acList = acCode.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (acList.length === 1) {
        sql += ` AND d.AC_CODE = :acCode `;
        binds.acCode = acList[0];
      } else if (acList.length > 1) {
        const ph = acList.map((_: string, idx: number) => `:ac${idx}`).join(",");
        sql += ` AND d.AC_CODE IN (${ph}) `;
        acList.forEach((a: string, idx: number) => { binds[`ac${idx}`] = a; });
      }
    }

    if (code5) {
      sql += ` AND TRUNC(d.DOC_DATE) >= TO_DATE(:dateFrom, 'DD-MM-YYYY') `;
      binds.dateFrom = code5;
    }
    if (code6) {
      sql += ` AND TRUNC(d.DOC_DATE) <= TO_DATE(:dateTo, 'DD-MM-YYYY') `;
      binds.dateTo = code6;
    }
    if (docno_from) {
      sql += ` AND d.DOC_NO >= :docno_from `;
      binds.docno_from = docno_from;
    }
    if (docno_to) {
      sql += ` AND d.DOC_NO <= :docno_to `;
      binds.docno_to = docno_to;
    }

    sql += ` ORDER BY d.DOC_DATE DESC, d.DOC_NO, d.SERIAL_NO `;

    const res = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return (res.rows || []).map((r: any) =>
      Object.keys(r).reduce((acc: any, k) => {
        acc[k.toLowerCase()] = r[k];
        return acc;
      }, {})
    );
  } finally {
    await conn.close();
  }
}

export const getSalesRegisterReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await loadSalesRegisterData(req);
    const companyCode = req.body?.code1 || (req as any).user?.company_code || "BSG";
    const loginid = req.body?.loginid || (req as any).user?.loginid || "ADMIN";
    const reportCurrency = rows[0]?.curr_code || "OMR";
    const dec = currencyDecimals(reportCurrency);
    const money = makeMoney(dec);

    let totalDebit = 0;
    let totalCredit = 0;

    let tbody = "";
    if (rows.length === 0) {
      tbody = `<tr><td colspan="10" class="empty-cell">No sales transaction records found for the selected criteria.</td></tr>`;
    } else {
      rows.forEach((r: any, idx: number) => {
        const dr = Number(r.debit) || 0;
        const cr = Number(r.credit) || 0;
        totalDebit += dr;
        totalCredit += cr;

        tbody += `
          <tr>
            <td class="center">${idx + 1}</td>
            <td class="center"><strong>${escapeHtml(r.doc_type)}</strong></td>
            <td>${renderDocCell(r.doc_type, r.doc_no)}</td>
            <td class="center">${formatDateStr(r.doc_date)}</td>
            <td>${escapeHtml(r.ac_code)} - ${escapeHtml(r.ac_name)}</td>
            <td>${escapeHtml(r.ref_no || "-")}${r.ref_date ? ` (${formatDateStr(r.ref_date)})` : ""}</td>
            <td class="center">${escapeHtml(r.div_code || "-")}</td>
            <td>${escapeHtml(r.remarks || "-")}</td>
            <td class="num">${dr > 0 ? money(dr) : "-"}</td>
            <td class="num">${cr > 0 ? money(cr) : "-"}</td>
          </tr>
        `;
      });
    }

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "Sales Register / Sales List",
      userName: loginid,
      endLabel: "Powered by Bayanat Technology",
    });

    const bodyHtml = `
      <div class="report-meta">
        <h2 class="meta-title">Sales Register / Sales List</h2>
        <div class="meta-badges">
          <span class="badge">Period: ${escapeHtml(req.body?.code5 || "All")} to ${escapeHtml(req.body?.code6 || "All")}</span>
          <span class="badge">Division: ${escapeHtml(req.body?.code2 || "All")}</span>
          <span class="badge">Currency: ${escapeHtml(reportCurrency)}</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th class="center" style="width: 4%;">#</th>
            <th class="center" style="width: 6%;">Type</th>
            <th style="width: 12%;">Voucher No</th>
            <th class="center" style="width: 9%;">Date</th>
            <th style="width: 24%;">Customer Account</th>
            <th style="width: 13%;">Ref / Invoice No</th>
            <th class="center" style="width: 6%;">Div</th>
            <th style="width: 14%;">Remarks</th>
            <th class="num" style="width: 6%;">Debit</th>
            <th class="num" style="width: 6%;">Credit</th>
          </tr>
        </thead>
        <tbody>
          ${tbody}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="8" style="text-align: right; font-weight: 700;">Grand Total (${escapeHtml(reportCurrency)}):</td>
            <td class="num" style="font-weight: 700;">${money(totalDebit)}</td>
            <td class="num" style="font-weight: 700;">${money(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    `;

    const html = buildReportDocument({
      title: "Sales Register",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: COMMON_TABLE_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    console.error("Sales Register error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to generate Sales Register" });
  }
};

export const exportSalesRegisterExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await loadSalesRegisterData(req);
    const data = rows.map((r: any, idx: number) => ({
      "Sr No": idx + 1,
      "Doc Type": r.doc_type,
      "Voucher No": r.doc_no,
      "Doc Date": formatDateStr(r.doc_date),
      "Account Code": r.ac_code,
      "Customer Name": r.ac_name,
      "Ref No": r.ref_no,
      "Ref Date": formatDateStr(r.ref_date),
      "Division": r.div_code,
      "Remarks": r.remarks,
      "Currency": r.curr_code,
      "Debit": Number(r.debit) || 0,
      "Credit": Number(r.credit) || 0,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales_Register");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Sales_Register.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("Sales Register Excel error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to export Sales Register Excel" });
  }
};

/* ─────────────────────────────────────────────────────────────
   2. PURCHASE REGISTER REPORT
───────────────────────────────────────────────────────────── */
export async function loadPurchaseRegisterData(req: Request) {
  const { code1, code2, code3, code5, code6, docno_from, docno_to, doc_type } = req.body;
  const companyCode = code1 || (req as any).user?.company_code || "BSG";
  const divCode = code2 && code2 !== "All" && code2 !== "" ? code2 : null;
  const acCode = code3 && code3 !== "All" && code3 !== "" ? code3 : null;
  const docType = doc_type && doc_type !== "ALL" ? doc_type : "PI";

  const conn = await getConnection(req);
  try {
    let sql = `
      SELECT 
        d.COMPANY_CODE, d.DOC_TYPE, d.DOC_NO, d.SERIAL_NO, d.DOC_DATE,
        d.AC_CODE, m.AC_NAME, d.DIV_CODE, h.REF_NO, h.REF_DATE,
        d.REMARKS, d.CURR_CODE, d.AMOUNT, d.LCUR_AMOUNT, d.SIGN_IND,
        CASE WHEN d.SIGN_IND > 0 THEN d.LCUR_AMOUNT ELSE 0 END AS DEBIT,
        CASE WHEN d.SIGN_IND < 0 THEN ABS(d.LCUR_AMOUNT) ELSE 0 END AS CREDIT
      FROM TR_AC_DETAIL d
      LEFT JOIN MS_ACCODES m ON m.COMPANY_CODE = d.COMPANY_CODE AND m.AC_CODE = d.AC_CODE
      LEFT JOIN TR_AC_HEADER h ON h.COMPANY_CODE = d.COMPANY_CODE AND h.DOC_TYPE = d.DOC_TYPE AND h.DOC_NO = d.DOC_NO
      WHERE d.COMPANY_CODE = :companyCode
        AND NVL(d.CANCELLED, 'N') <> 'Y'
    `;

    const binds: any = { companyCode };

    if (docType === "PI") {
      sql += ` AND d.DOC_TYPE IN ('PI', 'PIO') `;
    } else if (docType) {
      sql += ` AND d.DOC_TYPE = :docType `;
      binds.docType = docType;
    }

    if (divCode) {
      sql += ` AND d.DIV_CODE = :divCode `;
      binds.divCode = divCode;
    }

    if (acCode) {
      const acList = acCode.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (acList.length === 1) {
        sql += ` AND d.AC_CODE = :acCode `;
        binds.acCode = acList[0];
      } else if (acList.length > 1) {
        const ph = acList.map((_: string, idx: number) => `:ac${idx}`).join(",");
        sql += ` AND d.AC_CODE IN (${ph}) `;
        acList.forEach((a: string, idx: number) => { binds[`ac${idx}`] = a; });
      }
    }

    if (code5) {
      sql += ` AND TRUNC(d.DOC_DATE) >= TO_DATE(:dateFrom, 'DD-MM-YYYY') `;
      binds.dateFrom = code5;
    }
    if (code6) {
      sql += ` AND TRUNC(d.DOC_DATE) <= TO_DATE(:dateTo, 'DD-MM-YYYY') `;
      binds.dateTo = code6;
    }
    if (docno_from) {
      sql += ` AND d.DOC_NO >= :docno_from `;
      binds.docno_from = docno_from;
    }
    if (docno_to) {
      sql += ` AND d.DOC_NO <= :docno_to `;
      binds.docno_to = docno_to;
    }

    sql += ` ORDER BY d.DOC_DATE DESC, d.DOC_NO, d.SERIAL_NO `;

    const res = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return (res.rows || []).map((r: any) =>
      Object.keys(r).reduce((acc: any, k) => {
        acc[k.toLowerCase()] = r[k];
        return acc;
      }, {})
    );
  } finally {
    await conn.close();
  }
}

export const getPurchaseRegisterReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await loadPurchaseRegisterData(req);
    const companyCode = req.body?.code1 || (req as any).user?.company_code || "BSG";
    const loginid = req.body?.loginid || (req as any).user?.loginid || "ADMIN";
    const reportCurrency = rows[0]?.curr_code || "OMR";
    const dec = currencyDecimals(reportCurrency);
    const money = makeMoney(dec);

    let totalDebit = 0;
    let totalCredit = 0;

    let tbody = "";
    if (rows.length === 0) {
      tbody = `<tr><td colspan="10" class="empty-cell">No purchase transaction records found for the selected criteria.</td></tr>`;
    } else {
      rows.forEach((r: any, idx: number) => {
        const dr = Number(r.debit) || 0;
        const cr = Number(r.credit) || 0;
        totalDebit += dr;
        totalCredit += cr;

        tbody += `
          <tr>
            <td class="center">${idx + 1}</td>
            <td class="center"><strong>${escapeHtml(r.doc_type)}</strong></td>
            <td>${renderDocCell(r.doc_type, r.doc_no)}</td>
            <td class="center">${formatDateStr(r.doc_date)}</td>
            <td>${escapeHtml(r.ac_code)} - ${escapeHtml(r.ac_name)}</td>
            <td>${escapeHtml(r.ref_no || "-")}${r.ref_date ? ` (${formatDateStr(r.ref_date)})` : ""}</td>
            <td class="center">${escapeHtml(r.div_code || "-")}</td>
            <td>${escapeHtml(r.remarks || "-")}</td>
            <td class="num">${dr > 0 ? money(dr) : "-"}</td>
            <td class="num">${cr > 0 ? money(cr) : "-"}</td>
          </tr>
        `;
      });
    }

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "Purchase Register / Purchase List",
      userName: loginid,
      endLabel: "Powered by Bayanat Technology",
    });

    const bodyHtml = `
      <div class="report-meta">
        <h2 class="meta-title">Purchase Register / Purchase List</h2>
        <div class="meta-badges">
          <span class="badge">Period: ${escapeHtml(req.body?.code5 || "All")} to ${escapeHtml(req.body?.code6 || "All")}</span>
          <span class="badge">Division: ${escapeHtml(req.body?.code2 || "All")}</span>
          <span class="badge">Currency: ${escapeHtml(reportCurrency)}</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th class="center" style="width: 4%;">#</th>
            <th class="center" style="width: 6%;">Type</th>
            <th style="width: 12%;">Voucher No</th>
            <th class="center" style="width: 9%;">Date</th>
            <th style="width: 24%;">Supplier / Vendor Account</th>
            <th style="width: 13%;">Bill / Ref No</th>
            <th class="center" style="width: 6%;">Div</th>
            <th style="width: 14%;">Remarks</th>
            <th class="num" style="width: 6%;">Debit</th>
            <th class="num" style="width: 6%;">Credit</th>
          </tr>
        </thead>
        <tbody>
          ${tbody}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="8" style="text-align: right; font-weight: 700;">Grand Total (${escapeHtml(reportCurrency)}):</td>
            <td class="num" style="font-weight: 700;">${money(totalDebit)}</td>
            <td class="num" style="font-weight: 700;">${money(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    `;

    const html = buildReportDocument({
      title: "Purchase Register",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: COMMON_TABLE_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    console.error("Purchase Register error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to generate Purchase Register" });
  }
};

export const exportPurchaseRegisterExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await loadPurchaseRegisterData(req);
    const data = rows.map((r: any, idx: number) => ({
      "Sr No": idx + 1,
      "Doc Type": r.doc_type,
      "Voucher No": r.doc_no,
      "Doc Date": formatDateStr(r.doc_date),
      "Account Code": r.ac_code,
      "Supplier Name": r.ac_name,
      "Bill Ref No": r.ref_no,
      "Bill Date": formatDateStr(r.ref_date),
      "Division": r.div_code,
      "Remarks": r.remarks,
      "Currency": r.curr_code,
      "Debit": Number(r.debit) || 0,
      "Credit": Number(r.credit) || 0,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Purchase_Register");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Purchase_Register.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("Purchase Register Excel error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to export Purchase Register Excel" });
  }
};

/* ─────────────────────────────────────────────────────────────
   3. DAY BOOK REPORT
───────────────────────────────────────────────────────────── */
export async function loadDayBookData(req: Request) {
  const { code1, code2, code5, code6, doc_type } = req.body;
  const companyCode = code1 || (req as any).user?.company_code || "BSG";
  const divCode = code2 && code2 !== "All" && code2 !== "" ? code2 : null;
  const docType = doc_type && doc_type !== "ALL" ? doc_type : null;

  const conn = await getConnection(req);
  try {
    let sql = `
      SELECT 
        COMPANY_CODE, DOC_DATE, DOC_TYPE, DOC_NO, DIV_CODE, TRANS_NO,
        HDR_AC_CODE, PARTY_NAME, AC_CODE, AC_NAME,
        DEBIT, CREDIT, CHEQUE_NO, CHEQUE_DATE, CHEQUE_DESC, REMARKS, REF_NO
      FROM VW_REP_AC_DAYBOOK
      WHERE COMPANY_CODE = :companyCode
    `;

    const binds: any = { companyCode };

    if (divCode) {
      sql += ` AND DIV_CODE = :divCode `;
      binds.divCode = divCode;
    }
    if (docType) {
      sql += ` AND DOC_TYPE = :docType `;
      binds.docType = docType;
    }
    if (code5) {
      sql += ` AND TRUNC(DOC_DATE) >= TO_DATE(:dateFrom, 'DD-MM-YYYY') `;
      binds.dateFrom = code5;
    }
    if (code6) {
      sql += ` AND TRUNC(DOC_DATE) <= TO_DATE(:dateTo, 'DD-MM-YYYY') `;
      binds.dateTo = code6;
    }

    sql += ` ORDER BY DOC_DATE DESC, TRANS_NO, AC_CODE `;

    const res = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return (res.rows || []).map((r: any) =>
      Object.keys(r).reduce((acc: any, k) => {
        acc[k.toLowerCase()] = r[k];
        return acc;
      }, {})
    );
  } finally {
    await conn.close();
  }
}

export const getDayBookReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await loadDayBookData(req);
    const companyCode = req.body?.code1 || (req as any).user?.company_code || "BSG";
    const loginid = req.body?.loginid || (req as any).user?.loginid || "ADMIN";
    const dec = 3;
    const money = makeMoney(dec);

    let totalDebit = 0;
    let totalCredit = 0;

    let tbody = "";
    if (rows.length === 0) {
      tbody = `<tr><td colspan="10" class="empty-cell">No Day Book records found for the selected criteria.</td></tr>`;
    } else {
      rows.forEach((r: any, idx: number) => {
        const dr = Number(r.debit) || 0;
        const cr = Number(r.credit) || 0;
        totalDebit += dr;
        totalCredit += cr;

        tbody += `
          <tr>
            <td class="center">${idx + 1}</td>
            <td class="center">${formatDateStr(r.doc_date)}</td>
            <td>${renderDocCell(r.doc_type, r.doc_no)}</td>
            <td class="center">${escapeHtml(r.div_code || "-")}</td>
            <td><strong>${escapeHtml(r.party_name || "-")}</strong></td>
            <td>${escapeHtml(r.ac_code)} - ${escapeHtml(r.ac_name)}</td>
            <td>${escapeHtml(r.cheque_no || "-")}${r.cheque_date ? ` (${formatDateStr(r.cheque_date)})` : ""}</td>
            <td>${escapeHtml(r.remarks || "-")}</td>
            <td class="num">${dr > 0 ? money(dr) : "-"}</td>
            <td class="num">${cr > 0 ? money(cr) : "-"}</td>
          </tr>
        `;
      });
    }

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "Day Book Report",
      userName: loginid,
      endLabel: "Powered by Bayanat Technology",
    });

    const bodyHtml = `
      <div class="report-meta">
        <h2 class="meta-title">Day Book Report</h2>
        <div class="meta-badges">
          <span class="badge">Period: ${escapeHtml(req.body?.code5 || "All")} to ${escapeHtml(req.body?.code6 || "All")}</span>
          <span class="badge">Division: ${escapeHtml(req.body?.code2 || "All")}</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th class="center" style="width: 3%;">#</th>
            <th class="center" style="width: 8%;">Date</th>
            <th style="width: 14%;">Voucher / Trans No</th>
            <th class="center" style="width: 5%;">Div</th>
            <th style="width: 18%;">Party / Contra Name</th>
            <th style="width: 20%;">Account Detail</th>
            <th style="width: 12%;">Cheque Detail</th>
            <th style="width: 12%;">Remarks</th>
            <th class="num" style="width: 6%;">Debit</th>
            <th class="num" style="width: 6%;">Credit</th>
          </tr>
        </thead>
        <tbody>
          ${tbody}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="8" style="text-align: right; font-weight: 700;">Grand Total:</td>
            <td class="num" style="font-weight: 700;">${money(totalDebit)}</td>
            <td class="num" style="font-weight: 700;">${money(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    `;

    const html = buildReportDocument({
      title: "Day Book Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: COMMON_TABLE_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    console.error("Day Book error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to generate Day Book report" });
  }
};

export const exportDayBookExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await loadDayBookData(req);
    const data = rows.map((r: any, idx: number) => ({
      "Sr No": idx + 1,
      "Date": formatDateStr(r.doc_date),
      "Voucher No": r.trans_no || `${r.doc_type}/${r.doc_no}`,
      "Type": r.doc_type,
      "Division": r.div_code,
      "Party Name": r.party_name,
      "Account Code": r.ac_code,
      "Account Name": r.ac_name,
      "Cheque No": r.cheque_no,
      "Cheque Date": formatDateStr(r.cheque_date),
      "Remarks": r.remarks,
      "Debit": Number(r.debit) || 0,
      "Credit": Number(r.credit) || 0,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Day_Book");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Day_Book.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("Day Book Excel error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to export Day Book Excel" });
  }
};

/* ─────────────────────────────────────────────────────────────
   4. GENERAL TRANSACTION LISTING REPORT (PAYMENTS, RECEIPTS, VOUCHERS)
───────────────────────────────────────────────────────────── */
export async function loadTransactionListingData(req: Request) {
  const { code1, code2, code3, code5, code6, docno_from, docno_to, doc_type } = req.body;
  const companyCode = code1 || (req as any).user?.company_code || "BSG";
  const divCode = code2 && code2 !== "All" && code2 !== "" ? code2 : null;
  const acCode = code3 && code3 !== "All" && code3 !== "" ? code3 : null;
  const docType = doc_type && doc_type !== "ALL" ? doc_type : null;

  const conn = await getConnection(req);
  try {
    let sql = `
      SELECT 
        d.COMPANY_CODE, d.DOC_TYPE, d.DOC_NO, d.SERIAL_NO, d.DOC_DATE,
        d.AC_CODE, a.AC_NAME, d.BANK_AC_CODE, b.AC_NAME AS BANK_NAME,
        d.CHEQUE_NO, d.CHEQUE_DATE, d.DIV_CODE, h.REF_NO, h.REF_DATE,
        d.REMARKS, d.CURR_CODE, d.AMOUNT, d.LCUR_AMOUNT, d.SIGN_IND,
        CASE WHEN d.SIGN_IND > 0 THEN d.LCUR_AMOUNT ELSE 0 END AS DEBIT,
        CASE WHEN d.SIGN_IND < 0 THEN ABS(d.LCUR_AMOUNT) ELSE 0 END AS CREDIT
      FROM TR_AC_DETAIL d
      LEFT JOIN MS_ACCODES a ON a.COMPANY_CODE = d.COMPANY_CODE AND a.AC_CODE = d.AC_CODE
      LEFT JOIN MS_ACCODES b ON b.COMPANY_CODE = d.COMPANY_CODE AND b.AC_CODE = d.BANK_AC_CODE
      LEFT JOIN TR_AC_HEADER h ON h.COMPANY_CODE = d.COMPANY_CODE AND h.DOC_TYPE = d.DOC_TYPE AND h.DOC_NO = d.DOC_NO
      WHERE d.COMPANY_CODE = :companyCode
        AND NVL(d.CANCELLED, 'N') <> 'Y'
    `;

    const binds: any = { companyCode };

    if (docType) {
      sql += ` AND d.DOC_TYPE = :docType `;
      binds.docType = docType;
    }

    if (divCode) {
      sql += ` AND d.DIV_CODE = :divCode `;
      binds.divCode = divCode;
    }

    if (acCode) {
      const acList = acCode.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (acList.length === 1) {
        sql += ` AND d.AC_CODE = :acCode `;
        binds.acCode = acList[0];
      } else if (acList.length > 1) {
        const ph = acList.map((_: string, idx: number) => `:ac${idx}`).join(",");
        sql += ` AND d.AC_CODE IN (${ph}) `;
        acList.forEach((a: string, idx: number) => { binds[`ac${idx}`] = a; });
      }
    }

    if (code5) {
      sql += ` AND TRUNC(d.DOC_DATE) >= TO_DATE(:dateFrom, 'DD-MM-YYYY') `;
      binds.dateFrom = code5;
    }
    if (code6) {
      sql += ` AND TRUNC(d.DOC_DATE) <= TO_DATE(:dateTo, 'DD-MM-YYYY') `;
      binds.dateTo = code6;
    }
    if (docno_from) {
      sql += ` AND d.DOC_NO >= :docno_from `;
      binds.docno_from = docno_from;
    }
    if (docno_to) {
      sql += ` AND d.DOC_NO <= :docno_to `;
      binds.docno_to = docno_to;
    }

    sql += ` ORDER BY d.DOC_DATE DESC, d.DOC_NO, d.SERIAL_NO `;

    const res = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return (res.rows || []).map((r: any) =>
      Object.keys(r).reduce((acc: any, k) => {
        acc[k.toLowerCase()] = r[k];
        return acc;
      }, {})
    );
  } finally {
    await conn.close();
  }
}

const docTypeLabels: Record<string, string> = {
  BP: "Bank Payment",
  CP: "Cash Payment",
  BR: "Bank Receipt",
  CR: "Cash Receipt",
  JV: "Journal Voucher",
  RJV: "Reverse JV",
  EJV: "Year End JV",
  DN: "Debit Note",
  CN: "Credit Note",
  SI: "Sales Invoice",
  PI: "Purchase Invoice",
  PO: "Purchase Order (LPO)",
  ALL: "All Transactions",
};

export const getTransactionListingReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await loadTransactionListingData(req);
    const companyCode = req.body?.code1 || (req as any).user?.company_code || "BSG";
    const loginid = req.body?.loginid || (req as any).user?.loginid || "ADMIN";
    const docType = req.body?.doc_type || "ALL";
    const title = docTypeLabels[docType] ? `${docTypeLabels[docType]} Listing` : "Transaction Listing Report";
    const reportCurrency = rows[0]?.curr_code || "OMR";
    const dec = currencyDecimals(reportCurrency);
    const money = makeMoney(dec);

    let totalDebit = 0;
    let totalCredit = 0;

    let tbody = "";
    if (rows.length === 0) {
      tbody = `<tr><td colspan="11" class="empty-cell">No transaction records found for the selected criteria.</td></tr>`;
    } else {
      rows.forEach((r: any, idx: number) => {
        const dr = Number(r.debit) || 0;
        const cr = Number(r.credit) || 0;
        totalDebit += dr;
        totalCredit += cr;

        tbody += `
          <tr>
            <td class="center">${idx + 1}</td>
            <td class="center"><strong>${escapeHtml(r.doc_type)}</strong></td>
            <td>${renderDocCell(r.doc_type, r.doc_no)}</td>
            <td class="center">${formatDateStr(r.doc_date)}</td>
            <td>${escapeHtml(r.ac_code)} - ${escapeHtml(r.ac_name)}</td>
            <td>${r.bank_name ? `${escapeHtml(r.bank_ac_code)} - ${escapeHtml(r.bank_name)}` : "-"}</td>
            <td>${escapeHtml(r.cheque_no || "-")}${r.cheque_date ? ` (${formatDateStr(r.cheque_date)})` : ""}</td>
            <td class="center">${escapeHtml(r.div_code || "-")}</td>
            <td>${escapeHtml(r.remarks || "-")}</td>
            <td class="num">${dr > 0 ? money(dr) : "-"}</td>
            <td class="num">${cr > 0 ? money(cr) : "-"}</td>
          </tr>
        `;
      });
    }

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: title,
      userName: loginid,
      endLabel: "Powered by Bayanat Technology",
    });

    const bodyHtml = `
      <div class="report-meta">
        <h2 class="meta-title">${escapeHtml(title)}</h2>
        <div class="meta-badges">
          <span class="badge">Period: ${escapeHtml(req.body?.code5 || "All")} to ${escapeHtml(req.body?.code6 || "All")}</span>
          <span class="badge">Type: ${escapeHtml(docType)}</span>
          <span class="badge">Division: ${escapeHtml(req.body?.code2 || "All")}</span>
          <span class="badge">Currency: ${escapeHtml(reportCurrency)}</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th class="center" style="width: 3%;">#</th>
            <th class="center" style="width: 5%;">Type</th>
            <th style="width: 11%;">Voucher No</th>
            <th class="center" style="width: 8%;">Date</th>
            <th style="width: 22%;">Account Name</th>
            <th style="width: 16%;">Contra / Bank Account</th>
            <th style="width: 10%;">Cheque No</th>
            <th class="center" style="width: 5%;">Div</th>
            <th style="width: 10%;">Remarks</th>
            <th class="num" style="width: 5%;">Debit</th>
            <th class="num" style="width: 5%;">Credit</th>
          </tr>
        </thead>
        <tbody>
          ${tbody}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="9" style="text-align: right; font-weight: 700;">Grand Total (${escapeHtml(reportCurrency)}):</td>
            <td class="num" style="font-weight: 700;">${money(totalDebit)}</td>
            <td class="num" style="font-weight: 700;">${money(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    `;

    const html = buildReportDocument({
      title,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: COMMON_TABLE_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    console.error("Transaction Listing error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to generate Transaction Listing report" });
  }
};

export const exportTransactionListingExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await loadTransactionListingData(req);
    const data = rows.map((r: any, idx: number) => ({
      "Sr No": idx + 1,
      "Doc Type": r.doc_type,
      "Voucher No": r.doc_no,
      "Doc Date": formatDateStr(r.doc_date),
      "Account Code": r.ac_code,
      "Account Name": r.ac_name,
      "Bank/Contra Code": r.bank_ac_code,
      "Bank/Contra Name": r.bank_name,
      "Cheque No": r.cheque_no,
      "Cheque Date": formatDateStr(r.cheque_date),
      "Division": r.div_code,
      "Remarks": r.remarks,
      "Currency": r.curr_code,
      "Debit": Number(r.debit) || 0,
      "Credit": Number(r.credit) || 0,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transaction_List");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Transaction_Listing.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("Transaction Listing Excel error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to export Transaction Listing Excel" });
  }
};

/* ─────────────────────────────────────────────────────────────
   5. LEDGER BASIC REPORT
───────────────────────────────────────────────────────────── */
export async function loadLedgerBasicData(req: Request) {
  const {
    parameter, loginid,
    code1, code2, code3, code4, code5, code6, code7, code8, code9, code10
  } = req.body;

  const conn = await getConnection(req);
  try {
    const binds: any = {
      parameter: parameter || "Account_Report_Transaction",
      loginid: loginid || "ADMIN",
      code1: code1 || null,
      code2: code2 || null,
      code3: code3 || null,
      code4: code4 || null,
      code5: code5 || null,
      code6: code6 || null,
      code7: code7 || null,
      code8: code8 || null,
      code9: code9 || null,
      code10: code10 || code5 || null,
      code11: null, code12: null, code13: null, code14: null, code15: null,
      code16: null, code17: null, code18: null, code19: null, code20: null,
      number1: null, number2: null, number3: null, number4: null,
      date1: null, date2: null, date3: null, date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const result = await conn.execute(
      `DECLARE v_sql VARCHAR2(32767); BEGIN PROC_BUILD_DYNAMIC_SQL_COMMON20(
          :parameter, :loginid,
          :code1, :code2, :code3, :code4, :code5, :code6, :code7, :code8, :code9, :code10,
          :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
          :number1, :number2, :number3, :number4,
          :date1, :date2, :date3, :date4,
          v_sql); :out_sql := v_sql; END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) {
      throw new Error("PROC_BUILD_DYNAMIC_SQL_COMMON20 did not return a valid SQL query.");
    }

    const dataResult = await conn.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    return ((dataResult.rows as any[]) || []).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );
  } finally {
    await conn.close();
  }
}

export const getLedgerBasicReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRows = await loadLedgerBasicData(req);
    const companyCode = req.body?.code1 || (req as any).user?.company_code || "BSG";
    const loginid = req.body?.loginid || (req as any).user?.loginid || "ADMIN";
    const reportCurrency = rawRows[0]?.curr_code || "OMR";
    const dec = currencyDecimals(reportCurrency);
    const money = makeMoney(dec);

    // Group by Account
    const groups: Record<string, any[]> = {};
    rawRows.forEach((r) => {
      const key = `${r.ac_code}||${r.ac_name || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    let tableBodyHtml = "";
    let grandTotalDebit = 0;
    let grandTotalCredit = 0;

    if (rawRows.length === 0) {
      tableBodyHtml = `<tr><td colspan="9" class="empty-cell">No ledger records found for the selected criteria.</td></tr>`;
    } else {
      Object.entries(groups).forEach(([key, groupRows]) => {
        const [ac_code, ac_name] = key.split("||");
        const opening = Number(groupRows[0]?.op_balance) || 0;
        let totalDebit = 0;
        let totalCredit = 0;
        let runningBalance = opening;

        // Account header
        tableBodyHtml += `
          <tr style="background: #e2e8f0; font-weight: 700;">
            <td colspan="6" style="padding: 7px 8px;"><strong>Account:</strong> ${escapeHtml(ac_code)} - ${escapeHtml(ac_name)}</td>
            <td style="text-align: right; padding: 7px 8px;">Opening Balance:</td>
            <td colspan="2" class="num" style="padding: 7px 8px;">${formatBalance(opening, dec)}</td>
          </tr>
        `;

        groupRows.forEach((r) => {
          const amount = Number(r.lcur_amount) || 0;
          const dr = r.sign_ind > 0 ? amount : 0;
          const cr = r.sign_ind < 0 ? Math.abs(amount) : 0;
          totalDebit += dr;
          totalCredit += cr;
          runningBalance += dr - cr;

          tableBodyHtml += `
            <tr>
              <td class="center"><strong>${escapeHtml(r.doc_type)}</strong></td>
              <td>${renderDocCell(r.doc_type, r.doc_no)}</td>
              <td class="center">${formatDateStr(r.doc_date)}</td>
              <td>${escapeHtml(r.cheque_no || "-")}${r.cheque_date ? ` (${formatDateStr(r.cheque_date)})` : ""}</td>
              <td>${escapeHtml(r.bank_ac_name || "-")}</td>
              <td>${escapeHtml(r.remarks || "-")}</td>
              <td class="num">${dr > 0 ? money(dr) : "-"}</td>
              <td class="num">${cr > 0 ? money(cr) : "-"}</td>
              <td class="num" style="font-weight: 600;">${formatBalance(runningBalance, dec)}</td>
            </tr>
          `;
        });

        grandTotalDebit += totalDebit;
        grandTotalCredit += totalCredit;

        // Account subtotal row
        tableBodyHtml += `
          <tr style="background: #f1f5f9; font-weight: 700; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8;">
            <td colspan="6" style="text-align: right;">Total for ${escapeHtml(ac_code)}:</td>
            <td class="num">${money(totalDebit)}</td>
            <td class="num">${money(totalCredit)}</td>
            <td class="num" style="color: #0b4ca1;">${formatBalance(runningBalance, dec)}</td>
          </tr>
        `;
      });
    }

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const footerHtml = reportFooter({
      reportName: "A/c Ledger Basic",
      userName: loginid,
      endLabel: "Powered by Bayanat Technology",
    });

    const bodyHtml = `
      <div class="report-meta">
        <h2 class="meta-title">A/c Ledger Basic</h2>
        <div class="meta-badges">
          <span class="badge">Period: ${escapeHtml(req.body?.code5 || "All")} to ${escapeHtml(req.body?.code6 || "All")}</span>
          <span class="badge">Division: ${escapeHtml(req.body?.code2 || "All")}</span>
          <span class="badge">Currency: ${escapeHtml(reportCurrency)}</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th class="center" style="width: 5%;">Type</th>
            <th style="width: 12%;">Doc No</th>
            <th class="center" style="width: 8%;">Doc Date</th>
            <th style="width: 12%;">Cheque No</th>
            <th style="width: 18%;">Bank / Contra</th>
            <th style="width: 21%;">Remarks</th>
            <th class="num" style="width: 8%;">Debit</th>
            <th class="num" style="width: 8%;">Credit</th>
            <th class="num" style="width: 8%;">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${tableBodyHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" style="text-align: right; font-weight: 700;">Grand Total (${escapeHtml(reportCurrency)}):</td>
            <td class="num" style="font-weight: 700;">${money(grandTotalDebit)}</td>
            <td class="num" style="font-weight: 700;">${money(grandTotalCredit)}</td>
            <td class="num"></td>
          </tr>
        </tfoot>
      </table>
    `;

    const html = buildReportDocument({
      title: "A/c Ledger Basic",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: COMMON_TABLE_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    console.error("Ledger Basic error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to generate Ledger Basic report" });
  }
};

export const exportLedgerBasicExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRows = await loadLedgerBasicData(req);
    const data = rawRows.map((r: any, idx: number) => ({
      "Sr No": idx + 1,
      "Account Code": r.ac_code,
      "Account Name": r.ac_name,
      "Doc Type": r.doc_type,
      "Doc No": r.doc_no,
      "Doc Date": formatDateStr(r.doc_date),
      "Cheque No": r.cheque_no,
      "Cheque Date": formatDateStr(r.cheque_date),
      "Bank Name": r.bank_ac_name,
      "Remarks": r.remarks,
      "Division": r.div_code,
      "Currency": r.curr_code,
      "Amount": Number(r.amount) || 0,
      "Sign": r.sign_ind,
      "Debit": r.sign_ind > 0 ? Number(r.lcur_amount) || 0 : 0,
      "Credit": r.sign_ind < 0 ? Math.abs(Number(r.lcur_amount) || 0) : 0,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ledger_Basic");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Ledger_Basic.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    console.error("Ledger Basic Excel error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to export Ledger Basic Excel" });
  }
};
