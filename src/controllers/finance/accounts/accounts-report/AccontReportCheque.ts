import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { escapeHtml } from "../../../purchase_sales/report/common/formatters";
import { buildReportDocument, reportFooter, reportHeader } from "../../../common/report_common";
import { RequestWithUser } from "../../../../interfaces/common.interface";

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

const EXTRA_CSS = `
  .report-meta {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 8px 0 10px; margin-bottom: 12px; border-bottom: 2px solid #1e3a5f;
  }
  .report-meta .meta-title { margin: 0; font-size: 15px; font-weight: 800; color: #1e3a5f; }
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
    margin-top: 4px; border-collapse: collapse; border: 1px solid #cbd5e1;
  }
  table.statement-table thead th {
    background: #1e3a5f; color: #fff; font-size: 9.5px; font-weight: 700;
    padding: 6px 4px; border: 1px solid #0f2744; white-space: nowrap; text-align: center;
  }
  table.statement-table thead th.left { text-align: left; }
  table.statement-table thead th.num  { text-align: right; }
  table.statement-table tbody td {
    padding: 4px 4px; font-size: 10px; border: 1px solid #e2e8f0; vertical-align: top;
  }
  table.statement-table td.wrap {
    white-space: normal !important; overflow-wrap: anywhere; word-break: break-word; line-height: 1.35;
  }
  table.statement-table td.num {
    text-align: right; white-space: nowrap !important; font-variant-numeric: tabular-nums; overflow: visible;
  }
  table.statement-table td.center { text-align: center; white-space: nowrap; }
  table.statement-table tbody tr:nth-child(even) td { background: #f8fafc; }
  table.statement-table tbody tr.group-header td {
    background: #e8f0fb !important; font-weight: 700; color: #1e3a5f;
    border-top: 1.5px solid #1e3a5f; padding: 6px 8px;
  }
  table.statement-table tbody tr.total-row td {
    background: #f1f5f9 !important; font-weight: 700; border-top: 2px solid #334155;
  }
  .empty { padding: 32px; text-align: center; color: #64748b; font-size: 13px; }
  @media print {
    .report-meta, .currency-pill { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.statement-table thead th { background: #1e3a5f !important; color: #fff !important; }
    table.statement-table tbody tr { break-inside: avoid; }
  }
`;

export const getChequeMonitoringReport = async (req: Request, res: Response): Promise<void> => {
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
      parameter: parameter || "Account_Report_Transaction",
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
      `DECLARE 
        v_sql VARCHAR2(32767); 
      BEGIN 
        PROC_BUILD_DYNAMIC_SQL_COMMON20(
          :parameter, :loginid, 
          :code1, :code2, :code3, :code4, :code5, :code6, :code7, :code8, :code9, :code10, 
          :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20, 
          :number1, :number2, :number3, :number4, 
          :date1, :date2, :date3, :date4, 
          v_sql
        ); 
        :out_sql := v_sql; 
      END;`,
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

    const groups: Record<string, any[]> = {};
    rows.forEach((r) => {
      const key = `${r.ac_code} - ${r.ac_name || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    let tableBodyHtml = "";
    Object.entries(groups).forEach(([groupName, groupRows]) => {
      let groupTotal = 0;
      tableBodyHtml += `
        <tr class="group-header">
          <td colspan="9" class="wrap">${escapeHtml(groupName)}</td>
        </tr>`;

      groupRows.forEach((r) => {
        const amt = Number(r.lcur_amount) || 0;
        groupTotal += amt;
        tableBodyHtml += `
          <tr>
            <td class="center">${escapeHtml(text(r.ac_code))}</td>
            <td class="center">${escapeHtml(text(r.chq_no))}</td>
            <td class="wrap">${escapeHtml(text(r.payee_name || r.payee))}</td>
            <td class="wrap">${escapeHtml(text(r.remarks || r.details || r.narration))}</td>
            <td class="center">${formatDateStr(r.chq_date)}</td>
            <td class="center">${formatDateStr(r.doc_date)}</td>
            <td class="num">${money(amt)}</td>
            <td class="center"></td>
            <td class="center"></td>
          </tr>`;
      });

      tableBodyHtml += `
        <tr class="total-row">
          <td colspan="6" class="num"><strong>Total</strong></td>
          <td class="num"><strong>${money(groupTotal)}</strong></td>
          <td colspan="2"></td>
        </tr>`;
    });

    const reportTitle = `Cheque Book Monitoring ${text(code5)} - ${text(code6)} (Division: ${text(code2)})`;
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
            <col style="width: 12%" />
            <col style="width: 10%" />
            <col style="width: 18%" />
            <col style="width: 22%" />
            <col style="width: 9%" />
            <col style="width: 9%" />
            <col style="width: 10%" />
            <col style="width: 5%" />
            <col style="width: 5%" />
          </colgroup>
          <thead>
            <tr>
              <th>A/c Code</th>
              <th>Chq No.</th>
              <th class="left">Payee</th>
              <th class="left">Details</th>
              <th>Chq Date</th>
              <th>Doc Date</th>
              <th class="num">Amount</th>
              <th>Sign 1</th>
              <th>Sign 2</th>
            </tr>
          </thead>
          <tbody>${tableBodyHtml}</tbody>
        </table>`;

    const footerHtml = reportFooter({
      reportName: "Cheque Book Monitoring",
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
    console.error("Report Generation Error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to generate report",
      details: error.message,
    });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) { console.error("Connection close error:", e); }
    }
  }
};