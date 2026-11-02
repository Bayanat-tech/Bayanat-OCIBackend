import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { escapeHtml } from "../../../purchase_sales/report/common/formatters";
import { buildReportDocument, reportFooter, reportHeader } from "../../../common/report_common";
import { RequestWithUser } from "../../../../interfaces/common.interface";

const money = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.000";
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};
const text = (v: any) => (v == null ? "" : String(v));
const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};
const num = (v: any) => Number(v) || 0;
const moneyBalance = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.000";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return n < 0 ? `(${abs})` : abs;
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
    padding: 4px 4px; font-size: 10px; border: 1px solid #e2e8f0; vertical-align: middle;
  }
  table.statement-table td.wrap {
    white-space: normal !important; overflow-wrap: anywhere; word-break: break-word; line-height: 1.35;
  }
  table.statement-table td.num {
    text-align: right; white-space: nowrap !important; font-variant-numeric: tabular-nums; overflow: visible;
  }
  table.statement-table td.center { text-align: center; white-space: nowrap; }
  table.statement-table .neg-balance { color: #b91c1c; font-weight: 600; }
  table.statement-table tbody tr:nth-child(even) td { background: #f8fafc; }
  table.statement-table tbody tr.ac-header-row td {
    background: #e8f0fb !important; font-weight: 700; color: #1e3a5f;
    border-top: 1.5px solid #1e3a5f; border-bottom: 1px solid #cbd5e1; padding: 6px 8px;
  }
  table.statement-table tbody tr.ac-total-row td {
    background: #f1f5f9 !important; border-top: 1.5px solid #555; border-bottom: 2px solid #555; font-weight: 700;
  }
  .empty { padding: 32px; text-align: center; color: #64748b; font-size: 13px; }
  @media print {
    .report-meta, .currency-pill { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.statement-table thead th { background: #1e3a5f !important; color: #fff !important; }
    table.statement-table tbody tr { break-inside: avoid; }
  }
`;

export const AcStatementReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const {
      loginid,
      code1, code2, code3, code4, code5, code6,
      code7, code8, code9, code10, code11, code12, code13, code14,
      code15, code16,
    } = req.body;

    const parameter = "Account_Report_AC_StatementReport";

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    const binds: any = {
      parameter,
      loginid: loginid || "ADMIN",
      code1: code1 || null, code2: code2 || null, code3: code3 || null, code4: code4 || null,
      code5: code5 || null, code6: code6 || null, code7: code7 || null, code8: code8 || null,
      code9: code9 || null, code10: code10 || null, code11: code11 || null, code12: code12 || null,
      code13: code13 || null, code14: code14 || null, code15: code15 || null, code16: code16 || null,
      code17: null, code18: null, code19: null, code20: null,
      number1: null, number2: null, number3: null, number4: null,
      date1: null, date2: null, date3: null, date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    const result = await connection.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_COMMON20(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,  :code5,
           :code6,  :code7,  :code8,  :code9,  :code10,
           :code11, :code12, :code13, :code14, :code15,
           :code16, :code17, :code18, :code19, :code20,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    type StatementRow = (typeof rows)[0];
    type AcGroup = { ac_code: string; ac_name: string; curr_code: string; rows: StatementRow[] };
    const acMap = new Map<string, AcGroup>();

    rows.forEach((r) => {
      const acKey = text(r.ac_code);
      if (!acMap.has(acKey)) {
        acMap.set(acKey, {
          ac_code: acKey,
          ac_name: text(r.ac_name),
          curr_code: text(r.curr_code),
          rows: [],
        });
      }
      acMap.get(acKey)!.rows.push(r);
    });

    const periodFrom = text(code5);
    const periodTo = text(code6);
    const periodStr =
      periodFrom && periodTo
        ? `${formatDateStr(periodFrom)} - ${formatDateStr(periodTo)}`
        : periodTo
          ? formatDateStr(periodTo)
          : "";

    const currCode = escapeHtml(rows.length > 0 ? text(rows[0].curr_code) : "OMR");
    const asOnDate = escapeHtml(periodStr);

    let tableBodyHtml = "";
    acMap.forEach((ac) => {
      tableBodyHtml += `
        <tr class="ac-header-row">
          <td colspan="9" class="wrap"><strong>${escapeHtml(ac.ac_code)}&nbsp;&nbsp;${escapeHtml(ac.ac_name)}</strong></td>
        </tr>`;

      let acDebitTotal = 0;
      let acCreditTotal = 0;

      ac.rows.forEach((r) => {
        const debit = num(r.debit_amount);
        const credit = num(r.credit_amount);
        const runBal = num(r.running_balance);
        acDebitTotal += debit;
        acCreditTotal += credit;

        tableBodyHtml += `
          <tr>
            <td class="center">${escapeHtml(text(r.div_code))}</td>
            <td class="wrap">${escapeHtml(text(r.inv_no))}</td>
            <td class="center">${formatDateStr(r.inv_date)}</td>
            <td class="center">${escapeHtml(text(r.doc_type))}</td>
            <td class="wrap">${escapeHtml(text(r.doc_no))}</td>
            <td class="center">${formatDateStr(r.doc_date)}</td>
            <td class="num">${debit === 0 ? "0.000" : money(debit)}</td>
            <td class="num">${credit === 0 ? "0.000" : money(credit)}</td>
            <td class="num ${runBal < 0 ? "neg-balance" : ""}">${moneyBalance(runBal)}</td>
          </tr>`;
      });

      const acNetBalance = acDebitTotal - acCreditTotal;
      tableBodyHtml += `
        <tr class="ac-total-row">
          <td colspan="6"></td>
          <td class="num"><strong>${money(acDebitTotal)}</strong></td>
          <td class="num"><strong>${money(acCreditTotal)}</strong></td>
          <td class="num ${acNetBalance < 0 ? "neg-balance" : ""}"><strong>${moneyBalance(acNetBalance)}</strong></td>
        </tr>
        <tr><td colspan="9" style="height:8px;border:none;background:transparent;"></td></tr>`;
    });

    const headerHtml = await reportHeader({
      company_code: text(code1),
      req: req as RequestWithUser,
    });

    const bodyHtml =
      rows.length === 0
        ? `<div class="empty">No records found for the selected criteria.</div>`
        : `
        <div class="report-meta">
          <h1 class="meta-title">Statement of A/c for the Period ${asOnDate}</h1>
          <div class="currency-pill">
            <span class="curr-label">Currency</span>
            <span>${currCode}</span>
          </div>
        </div>
        <table class="data-table statement-table">
          <colgroup>
            <col style="width: 5%" />
            <col style="width: 18%" />
            <col style="width: 10%" />
            <col style="width: 8%" />
            <col style="width: 12%" />
            <col style="width: 10%" />
            <col style="width: 12%" />
            <col style="width: 12%" />
            <col style="width: 13%" />
          </colgroup>
          <thead>
            <tr>
              <th>Div</th>
              <th class="left">INV No.</th>
              <th>INV Date</th>
              <th>Doc Type</th>
              <th class="left">Doc No.</th>
              <th>Doc Date</th>
              <th class="num">Debit</th>
              <th class="num">Credit</th>
              <th class="num">Balance</th>
            </tr>
          </thead>
          <tbody>${tableBodyHtml}</tbody>
        </table>`;

    const footerHtml = reportFooter({
      reportName: "Statement of A/c",
      userName: text(loginid),
      endLabel: "End of report",
    });

    const reportHtml = buildReportDocument({
      title: "Statement of A/c Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("AC Statement Report Error:", error);
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