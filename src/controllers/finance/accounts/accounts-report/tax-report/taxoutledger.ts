import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../../middleware/tenantContext.middleware";
import { escapeHtml } from "../../../../purchase_sales/report/common/formatters";
import { buildReportDocument, reportFooter, reportHeader } from "../../../../common/report_common";
import { RequestWithUser } from "../../../../../interfaces/common.interface";

const money = (v: any) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};
const text = (v: any) => (v == null ? "" : String(v));
const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};
const formatBalance = (value: number) =>
  value < 0 ? `(${money(Math.abs(value))})` : money(value);

const EXTRA_CSS = `
  @page { size: A4 landscape; margin: 6mm; }
  .paper { max-width: 297mm; }
  .report-meta {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 8px 0 10px; margin-bottom: 10px; border-bottom: 2px solid #1e3a5f;
  }
  .report-meta .meta-title { margin: 0; font-size: 14px; font-weight: 800; color: #1e3a5f; }
  .report-meta .currency-pill {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px;
    background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 20px;
    font-size: 11px; font-weight: 700; color: #1e3a5f; white-space: nowrap;
  }
  .report-meta .currency-pill .curr-label {
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;
  }
  table.statement-table {
    table-layout: fixed !important; width: 100% !important; max-width: 100% !important;
    border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 9px;
  }
  table.statement-table thead th {
    background: #1e3a5f; color: #fff; font-size: 8.5px; font-weight: 700;
    padding: 4px 2px; border: 1px solid #0f2744; white-space: nowrap; text-align: center;
  }
  table.statement-table thead th.num { text-align: right; }
  table.statement-table thead th.left { text-align: left; }
  table.statement-table tbody td {
    padding: 3px 2px; font-size: 9px; border: 1px solid #e2e8f0; vertical-align: top;
  }
  table.statement-table td.wrap {
    white-space: normal !important; overflow-wrap: anywhere; word-break: break-word; line-height: 1.3;
  }
  table.statement-table td.num {
    text-align: right; white-space: nowrap !important; font-variant-numeric: tabular-nums; overflow: visible;
  }
  table.statement-table td.center { text-align: center; white-space: nowrap; }
  table.statement-table tbody tr:nth-child(even) td { background: #f8fafc; }
  table.statement-table tbody tr.grand-row td {
    background: #e8f0fb !important; font-weight: 700;
    border-top: 2px solid #1e3a5f; border-bottom: 2px solid #1e3a5f;
  }
  .empty { padding: 32px; text-align: center; color: #64748b; font-size: 13px; }
  @media print {
    .report-meta, .currency-pill { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.statement-table thead th { background: #1e3a5f !important; color: #fff !important; }
    table.statement-table tbody tr { break-inside: avoid; }
  }
`;

export const getTaxInvoiceReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const {
      parameter, loginid,
      code1, code2, code3, code4, code5, code6, code7, code8, code20,
    } = req.body;

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    const binds: any = {
      parameter: parameter || "Account_Tax_Report_VAT_OUT_ACCOUNT_LEDGER_SUMMARY_REPORT",
      loginid: loginid || "ADMIN",
      code1: code1 || null, code2: code2 || null, code3: code3 || null,
      code4: code4 || null, code5: code5 || null, code6: code6 || null,
      code7: code7 || null, code8: code8 || null, code20: code20 || null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };
    for (let i = 9; i <= 20; i++) binds[`code${i}`] = req.body[`code${i}`] || null;
    for (let i = 1; i <= 4; i++) {
      binds[`number${i}`] = req.body[`number${i}`] || null;
      if (i > 2) binds[`date${i}`] = req.body[`date${i}`] || null;
    }
    binds.date1 = null;
    binds.date2 = null;

    const result = await connection.execute(
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
    if (!rawSql) throw new Error("The procedure did not return a valid SQL query.");

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    let totalInvAmount = 0;
    let totalTaxableInvAmt = 0;
    let totalTotInvAmount = 0;
    let totalTaxAmount = 0;
    let tableBodyHtml = "";

    rows.forEach((r) => {
      const invAmount = Number(r.inv_amount) || 0;
      const taxableInvAmt = Number(r.taxable_amt) || 0;
      const totInvAmount = Number(r.inv_amount) || 0;
      const taxAmount = Number(r.tax_amount) || 0;

      totalInvAmount += invAmount;
      totalTaxableInvAmt += taxableInvAmt;
      totalTotInvAmount += totInvAmount;
      totalTaxAmount += taxAmount;

      tableBodyHtml += `
        <tr>
          <td class="center">${escapeHtml(text(r.doc_type))}</td>
          <td class="wrap">${escapeHtml(text(r.doc_no))}</td>
          <td class="center">${formatDateStr(r.doc_date)}</td>
          <td class="center">${escapeHtml(text(r.ac_code))}</td>
          <td class="wrap">${escapeHtml(text(r.ac_name))}</td>
          <td class="wrap">${escapeHtml(text(r.ref_no))}</td>
          <td class="center">${escapeHtml(text(r.ref_date))}</td>
          <td class="wrap">${escapeHtml(text(r.trn_no))}</td>
          <td class="center">${escapeHtml(text(r.country_code))}</td>
          <td class="center">${escapeHtml(text(r.territory))}</td>
          <td class="center">${escapeHtml(text(r.tax_code))}</td>
          <td class="wrap">${escapeHtml(text(r.tax_code_name))}</td>
          <td class="num">${formatBalance(invAmount)}</td>
          <td class="num">${formatBalance(taxableInvAmt)}</td>
          <td class="num">${formatBalance(totInvAmount)}</td>
          <td class="num">${formatBalance(taxAmount)}</td>
          <td class="wrap">${escapeHtml(text(r.origin_destination))}</td>
        </tr>`;
    });

    if (rows.length > 0) {
      tableBodyHtml += `
        <tr class="grand-row">
          <td colspan="12" class="num"><strong>Total :</strong></td>
          <td class="num"><strong>${formatBalance(totalInvAmount)}</strong></td>
          <td class="num"><strong>${formatBalance(totalTaxableInvAmt)}</strong></td>
          <td class="num"><strong>${formatBalance(totalTotInvAmount)}</strong></td>
          <td class="num"><strong>${formatBalance(totalTaxAmount)}</strong></td>
          <td></td>
        </tr>`;
    }

    const reportTitle = "Tax Register Report";
    const generatedBy = text(loginid) || "Unknown User";

    const headerHtml = await reportHeader({
      company_code: text(code1),
      req: req as RequestWithUser,
    });

    const bodyHtml =
      rows.length === 0
        ? `<div class="empty">No records found for the selected criteria.</div>`
        : `
        <div class="report-meta">
          <h1 class="meta-title">${escapeHtml(reportTitle)}</h1>
          <div class="currency-pill">
            <span class="curr-label">Currency</span>
            <span>OMR</span>
          </div>
        </div>
        <table class="data-table statement-table">
          <colgroup>
            <col style="width: 4%" />
            <col style="width: 7%" />
            <col style="width: 6%" />
            <col style="width: 6%" />
            <col style="width: 9%" />
            <col style="width: 7%" />
            <col style="width: 6%" />
            <col style="width: 7%" />
            <col style="width: 5%" />
            <col style="width: 5%" />
            <col style="width: 5%" />
            <col style="width: 7%" />
            <col style="width: 7%" />
            <col style="width: 7%" />
            <col style="width: 7%" />
            <col style="width: 6%" />
            <col style="width: 5%" />
          </colgroup>
          <thead>
            <tr>
              <th>Doc<br/>Type</th>
              <th class="left">Doc No</th>
              <th>Doc Date</th>
              <th>Ac Code</th>
              <th class="left">Ac Name</th>
              <th class="left">Invoice / Ref No</th>
              <th>Ref Date</th>
              <th class="left">Tax Reg. No.</th>
              <th>Country</th>
              <th>Territory</th>
              <th>Tax<br/>Code</th>
              <th class="left">Tax Description</th>
              <th class="num">Invoice<br/>Amount</th>
              <th class="num">Taxable Invoice<br/>Amount</th>
              <th class="num">Total Invoice<br/>Amount</th>
              <th class="num">Tax<br/>Amount</th>
              <th class="left">Origin / Dest</th>
            </tr>
          </thead>
          <tbody>${tableBodyHtml}</tbody>
        </table>`;

    const footerHtml = reportFooter({
      reportName: "Tax Register Report",
      userName: generatedBy,
      endLabel: "End of report",
    });

    const reportHtml = buildReportDocument({
      title: reportTitle,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("Tax Invoice Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to generate report",
      details: error.message,
    });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) { console.error(e); }
    }
  }
};