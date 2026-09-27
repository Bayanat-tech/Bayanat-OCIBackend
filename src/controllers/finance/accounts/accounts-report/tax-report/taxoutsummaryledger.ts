import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../../middleware/tenantContext.middleware";
import { buildReportDocument, reportFooter, reportHeader } from "../../../../common/report_common";
import { RequestWithUser } from "../../../../../interfaces/common.interface";
import { escapeHtml } from "../../../../purchase_sales/report/common/formatters";


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

const formatBalance = (value: number) => {
  return value < 0 ? `(${money(Math.abs(value))})` : money(value);
};

/* ------------------------------------------------------------------ */
/*  Extra CSS – only what is specific to this report                   */
/* ------------------------------------------------------------------ */
const EXTRA_CSS = `
  .report-meta {
    display: flex;
    justify-content: flex-start;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 8px;
    margin-bottom: 10px;
  }
  .meta-table { border-collapse: collapse; }
  .meta-table td { padding: 2px 8px 2px 0; vertical-align: top; font-size: 11px; }
  .meta-label { font-weight: 700; color: #64748b; min-width: 70px; white-space: nowrap; }

  table.data-table col.c1 { width: 15%; }
  table.data-table col.c2 { width: 37%; }
  table.data-table col.c3 { width: 16%; }
  table.data-table col.c4 { width: 16%; }
  table.data-table col.c5 { width: 16%; }

  tr.data-row:nth-child(even) td { background: #f8fafc; }
  tr.data-row:hover td { background: #eaf2fb; }

  tr.grand-row td {
    background: #d4e6f1;
    font-weight: 700;
    border-top: 2px solid #0b4ca1;
    color: #1a3c6e;
    font-size: 10.5px;
  }

  .num-mono { font-family: 'Courier New', monospace; white-space: nowrap; }

  @media print {
    tr.grand-row { page-break-inside: avoid; break-inside: avoid; }
  }
`;

export const getTaxInvoiceSummaryReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const {
      parameter, loginid,
      code1, code2, code3, code4, code5, code6, code7, code8, code20
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
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 }
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
    console.log("Generated SQL for Tax Invoice Summary Report:", rawSql);

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // ── totals ──
    let totalInvAmount     = 0;
    let totalTaxableInvAmt = 0;
    let totalTaxAmount     = 0;
    let tableBodyHtml = "";

    rows.forEach((r) => {
      const invAmount     = Number(r.inv_amount)      || 0;
      const taxableInvAmt = Number(r.taxable_inv_amt) || 0;
      const taxAmount     = Number(r.tax_amount)      || 0;

      totalInvAmount     += invAmount;
      totalTaxableInvAmt += taxableInvAmt;
      totalTaxAmount     += taxAmount;

      tableBodyHtml += `
        <tr class="data-row">
          <td>${escapeHtml(r.ac_code)}</td>
          <td>${escapeHtml(r.ac_name)}</td>
          <td class="num num-mono">${formatBalance(invAmount)}</td>
          <td class="num num-mono">${formatBalance(taxableInvAmt)}</td>
          <td class="num num-mono">${formatBalance(taxAmount)}</td>
        </tr>`;
    });

    tableBodyHtml += `
      <tr class="grand-row">
        <td colspan="2" class="right"><strong>Total :</strong></td>
        <td class="num num-mono"><strong>${formatBalance(totalInvAmount)}</strong></td>
        <td class="num num-mono"><strong>${formatBalance(totalTaxableInvAmt)}</strong></td>
        <td class="num num-mono"><strong>${formatBalance(totalTaxAmount)}</strong></td>
      </tr>`;

    const reportTitle = `Tax Register Summary Report`;
    const generatedBy = text(loginid) || "Unknown User";
    const reportDate  = formatDateStr(new Date());

    // ── Shared company header (logo + name + address from ms_company) ──
    // company_code comes from code1, same slot the dynamic-SQL procedure uses
    const companyHeaderHtml = await reportHeader({
      company_code: text(code1),
      req: req as RequestWithUser,
    });

    const headerHtml = `
      ${companyHeaderHtml}
      <div class="report-meta">
        <table class="meta-table">
          <tr><td class="meta-label">Title :</td><td><strong>${escapeHtml(reportTitle)}</strong></td></tr>
          <tr><td class="meta-label">Date :</td><td>${escapeHtml(reportDate)}</td></tr>
          <tr><td class="meta-label">User :</td><td>${escapeHtml(generatedBy)}</td></tr>
          <tr><td class="meta-label">Report :</td><td>${escapeHtml(text(parameter))}</td></tr>
          <tr><td class="meta-label">Currency :</td><td>OMR</td></tr>
        </table>
      </div>`;

    const bodyHtml = `
      <table class="data-table">
        <colgroup>
          <col class="c1"/><col class="c2"/><col class="c3"/>
          <col class="c4"/><col class="c5"/>
        </colgroup>
        <thead>
          <tr>
            <th>Ac Code</th>
            <th>Ac Name</th>
            <th class="num">Invoice<br/>Amount</th>
            <th class="num">Taxable Invoice<br/>Amount</th>
            <th class="num">Tax<br/>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${
            tableBodyHtml ||
            '<tr><td colspan="5" style="text-align:center;padding:36px 0;color:#888;">No records found for the selected criteria.</td></tr>'
          }
        </tbody>
      </table>`;

    const footerHtml = reportFooter({
      reportName: reportTitle,
      userName: generatedBy,
    });

    const reportHtml = buildReportDocument({
      title: reportTitle,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
    });

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("Tax Invoice Summary Report Error:", error);
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