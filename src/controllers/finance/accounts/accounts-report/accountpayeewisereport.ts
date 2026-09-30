import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
} from "../../../common/report_common"; // adjust path to your report_common.ts

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

export const getAccountPayeeWiseReport = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;
  try {
    const {
      parameter,
      loginid,
      code1,
      code2,
      code3,
      code4,
      code5,
      code6,
      code7,
      code8,
      code20,
      company_code,
    } = req.body;

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) {
      tenantId = await TenantManager.getTenantForUser(loginid);
    }
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const binds: any = {
      parameter: parameter || "Account_Report_Payee",
      loginid: loginid || "ADMIN",
      code1: code1 || null,
      code2: code2 || null,
      code3: code3 || null,
      code4: code4 || null,
      code5: code5 || null,
      code6: code6 || null,
      code7: code7 || null,
      code8: code8 || null,
      code20: code20 || null,
      out_sql: {
        dir: oracledb.BIND_OUT,
        type: oracledb.STRING,
        maxSize: 32767,
      },
    };

    for (let i = 9; i <= 20; i++) {
      binds[`code${i}`] = req.body[`code${i}`] || null;
    }
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
    if (!rawSql) {
      throw new Error("The procedure did not return a valid SQL query.");
    }
    console.log("Generated SQL:", rawSql);

    const dataResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // Group by ac_code + ac_name
    const groups: Record<string, any[]> = {};
    rows.forEach((r) => {
      const key = `${r.ac_code}||${r.ac_name || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    let tableRowsHtml = "";
    let grandTotalDebit = 0;
    let grandTotalCredit = 0;

    Object.entries(groups).forEach(([key, groupRows]) => {
      const [ac_code, ac_name] = key.split("||");
      const opening = Number(groupRows[0]?.op_balance) || 0;
      let totalDebit = 0;
      let totalCredit = 0;
      let runningBalance = opening;

      // Account group header + opening
      tableRowsHtml += `
        <tr class="grp-hdr">
          <td colspan="6" class="primary-text strong">${text(ac_code)}&nbsp;&nbsp;${text(ac_name)}</td>
          <td class="num strong" style="color:#b91c1c">Opening</td>
          <td class="num strong" colspan="2" style="color:#b91c1c">${formatBalance(opening)}</td>
        </tr>`;

      // Split PDC / NORMAL
      const pdcGroups: Record<string, any[]> = {};
      groupRows.forEach((r) => {
        const k = r.pdc_ind === "Y" ? "PDC" : "NORMAL";
        if (!pdcGroups[k]) pdcGroups[k] = [];
        pdcGroups[k].push(r);
      });

      Object.entries(pdcGroups).forEach(([pdcType, pdcRows]) => {
        tableRowsHtml += `
          <tr class="sub-grp-hdr">
            <td colspan="9" class="strong">${pdcType === "PDC" ? "PDC CHEQUES" : "NORMAL CHEQUES"}</td>
          </tr>`;

        pdcRows.forEach((r) => {
          const amount = Number(r.lcur_amount) || 0;
          const dr = r.sign_ind > 0 ? amount : 0;
          const cr = r.sign_ind < 0 ? Math.abs(amount) : 0;
          totalDebit += dr;
          totalCredit += cr;
          runningBalance += dr - cr;

          tableRowsHtml += `
            <tr>
              <td>${text(r.doc_type || "")}</td>
              <td>${text(r.doc_no || "")}</td>
              <td class="center">${formatDateStr(r.doc_date)}</td>
              <td>${text(r.cheque_no || "")}</td>
              <td class="center">${formatDateStr(r.cheque_date)}</td>
              <td>${text(r.bank || "")}</td>
              <td class="num" style="color:#b45309">${money(dr)}</td>
              <td class="num" style="color:#b45309">${money(cr)}</td>
              <td class="num">${formatBalance(runningBalance)}</td>
            </tr>`;
        });
      });

      grandTotalDebit += totalDebit;
      grandTotalCredit += totalCredit;
      const closing = opening + totalDebit - totalCredit;

      tableRowsHtml += `
        <tr class="total-row">
          <td colspan="5" class="right strong">Total :</td>
          <td class="num strong" colspan="2">${money(totalDebit)}</td>
          <td class="num strong">${money(totalCredit)}</td>
          <td></td>
        </tr>
        <tr class="closing-row">
          <td colspan="7" class="right strong">Closing</td>
          <td class="num strong" colspan="2">${formatBalance(closing)}</td>
        </tr>`;
    });

    tableRowsHtml += `
      <tr class="grand-row">
        <td colspan="5" class="right strong">Grand Total :</td>
        <td class="num strong" colspan="2">${formatBalance(grandTotalDebit)}</td>
        <td class="num strong">${formatBalance(grandTotalCredit)}</td>
        <td></td>
      </tr>`;

    const reportTitle = `Ledger Basic Report ${text(code5)} - ${text(code6)}`;
    const generatedBy = text(loginid) || "Unknown User";
    const companyCode = text(company_code || code1 || "");

    const extraCss = `
/* Fixed layout so column widths are respected and long text can wrap */
table.data-table {
  table-layout: fixed;
  width: 100%;
  border-collapse: collapse;
}

/* Slightly rebalanced widths – give more room to Chq No. & Bank */
table.data-table col.c1  { width: 6%; }   /* Type */
table.data-table col.c2  { width: 12%; }  /* Doc No. */
table.data-table col.c3  { width: 9%; }   /* Doc Date */
table.data-table col.c4  { width: 13%; }  /* Chq No.  – wider for long text */
table.data-table col.c5  { width: 9%; }   /* Chq Date */
table.data-table col.c6  { width: 15%; }  /* Bank     – wider */
table.data-table col.c7  { width: 12%; }  /* Debit */
table.data-table col.c8  { width: 12%; }  /* Credit */
table.data-table col.c9  { width: 12%; }  /* Balance */

/* Core wrapping – stop content overflowing into neighbouring cells */
table.data-table th,
table.data-table td {
  white-space: normal !important;
  overflow-wrap: anywhere;          /* strongest modern wrap */
  word-wrap: break-word;
  word-break: break-word;
  max-width: 0;                     /* critical with table-layout:fixed */
  overflow: hidden;                 /* never let text paint outside the cell */
  vertical-align: top;
  padding: 6px 6px;
  box-sizing: border-box;
}

/* Numeric columns stay on one line */
table.data-table td.num,
table.data-table th.num {
  white-space: nowrap !important;
  word-break: normal;
  overflow-wrap: normal;
  overflow: hidden;
  text-overflow: ellipsis;          /* safety net if still too long */
}

/* Date columns stay compact */
table.data-table td.center {
  text-align: center;
  white-space: nowrap !important;
}

/* Group / total rows (unchanged visual style) */
tr.grp-hdr td {
  background: #e8f0fa !important;
  color: #0b4ca1;
  font-weight: 700;
  border-bottom: 2px solid #0b4ca1 !important;
  padding: 9px 8px;
}
tr.sub-grp-hdr td {
  background: #f1f5f9 !important;
  color: #334155;
  font-weight: 700;
  padding: 6px 8px;
  border-bottom: 1px solid #cbd5e1 !important;
}
tr.narr-row td {
  border-top: none !important;
  font-style: italic;
  font-size: 10px;
  color: #64748b;
  background: #fff !important;
  padding-top: 2px;
  padding-bottom: 6px;
  white-space: normal !important;
  overflow-wrap: anywhere;
  word-break: break-word;
}
tr.total-row td {
  background: #e8f0fa !important;
  font-weight: 700;
  border-top: 2px solid #0b4ca1 !important;
  border-bottom: 1px solid #0b4ca1 !important;
}
tr.closing-row td {
  background: #e8f0fa !important;
  font-weight: 700;
}
tr.grand-row td {
  background: #dbeafe !important;
  font-weight: 700;
  border-top: 2px solid #0b4ca1 !important;
  color: #0b4ca1;
}
.report-meta {
  margin: 0 0 14px 0;
  font-size: 11px;
  color: #64748b;
}
.report-meta span {
  margin-right: 18px;
}
.report-meta strong {
  color: #0f172a;
}
    `;

    const bodyHtml = `
      <div class="report-title">${text(reportTitle)}</div>
      <div class="report-meta">
        <span><strong>User:</strong> ${text(generatedBy)}</span>
        <span><strong>Report:</strong> ${text(parameter || "Account_Report_Payee")}</span>
        <span><strong>Currency:</strong> OMR</span>
      </div>

      <table class="data-table">
        <colgroup>
          <col class="c1"/><col class="c2"/><col class="c3"/>
          <col class="c4"/><col class="c5"/><col class="c6"/>
          <col class="c7"/><col class="c8"/><col class="c9"/>
        </colgroup>
        <thead>
          <tr>
            <th>Type</th>
            <th>Doc No.</th>
            <th>Doc Date</th>
            <th>Chq No.</th>
            <th>Chq Date</th>
            <th class="left">Bank</th>
            <th class="num">Debit</th>
            <th class="num">Credit</th>
            <th class="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${
            tableRowsHtml ||
            `<tr><td colspan="9" class="muted" style="text-align:center;padding:40px 0">No records found.</td></tr>`
          }
        </tbody>
      </table>
    `;

    const headerHtml = await reportHeader({
      company_code: companyCode,
      req: req as RequestWithUser,
    });

    const footerHtml = reportFooter({
      reportName: "Account Payee Wise",
      userName: generatedBy,
    });

    const reportHtml = buildReportDocument({
      title: reportTitle,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss,
      showPrintButton: false,
    });

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("Account Payee Wise Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to generate report",
      details: error.message,
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error(e);
      }
    }
  }
};