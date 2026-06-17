import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// Helper for OMR Formatting (3 decimals as shown in PDF)
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
  // Returns DD/MM/YYYY
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

export const getChequeMonitoringReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    // 1. Extract parameters from body (sent by the frontend button)
    const {
      parameter,
      loginid,
      code1, // company_code
      code2, // div_code
      code3, // selectedAccounts
      code4, // selectedGroups
      code5, // dateFrom string
      code6, // dateTo string
      code7, // amountFrom
      code8, // amountTo
      code20
    } = req.body;

    // 2. Database Connection Handling
    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) {
      tenantId = await TenantManager.getTenantForUser(loginid);
    }

    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // 3. Prepare Binds for PROC_BUILD_DYNAMIC_SQL_COMMON20
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
      code20: code20 || null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 }
    };

    // Initialize remaining parameters to avoid Oracle binding errors
    for (let i = 9; i <= 20; i++) {
      binds[`code${i}`] = req.body[`code${i}`] || null;
    }
    for (let i = 1; i <= 4; i++) {
      binds[`number${i}`] = req.body[`number${i}`] || null;
      if (i > 2) binds[`date${i}`] = req.body[`date${i}`] || null;
    }
    // Note: procedure call uses date1/date2 as well, but usually mapped via code5/6 in this rpt
    binds.date1 = null; binds.date2 = null;

    // 4. Execute the procedure to get the SQL
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
    if (!rawSql) {
      throw new Error("The procedure did not return a valid SQL query.");
    }

    // 5. Execute the generated SQL to get the report data
    const dataResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // 6. Group data by A/c Code (for the sub-totals)
    const groups: Record<string, any[]> = {};
    rows.forEach((r) => {
      const key = `${r.ac_code} - ${r.ac_name || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    // 7. Construct HTML Rows
    const reportTitle = `Cheque Book Monitoring ${text(code5)} - ${text(code6)} (Division: ${text(code2)})`;
    const generatedBy = text(loginid) || "Unknown User";
    const reportDate = formatDateStr(new Date());

    let tableBodyHtml = "";
    Object.entries(groups).forEach(([groupName, groupRows]) => {
      let groupTotal = 0;
      const groupLabel = text(groupName);

      // Header for the Account Group
      tableBodyHtml += `
        <tr class="group-header">
          <td colspan="9">${groupLabel}</td>
        </tr>`;

      // Data rows for this account
      groupRows.forEach((r) => {
        const amt = Number(r.lcur_amount) || 0;
        groupTotal += amt;
        tableBodyHtml += `
          <tr>
            <td>${text(r.ac_code)}</td>
            <td>${text(r.chq_no)}</td>
            <td>${text(r.payee_name || r.payee)}</td>
            <td>${text(r.remarks || r.details || r.narration)}</td>
            <td>${formatDateStr(r.chq_date)}</td>
            <td>${formatDateStr(r.doc_date)}</td>
            <td class="num">${money(amt)}</td>
            <td class="empty-cell"></td>
            <td class="empty-cell"></td>
          </tr>`;
      });

      // Total row for this account
      tableBodyHtml += `
        <tr class="total-row">
          <td colspan="6" class="num total-label">Total</td>
          <td class="num total-value">${money(groupTotal)}</td>
          <td colspan="2"></td>
        </tr>`;
    });

    // 8. Final HTML Template
    const reportHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${reportTitle}</title>
       <style>
:root {
    color-scheme: light;
}

body {
    margin: 0;
    font-family: Arial, Helvetica, sans-serif;
    background: #f2f4f7;
    color: #1f2937;
}

.page {
    width: 100%;
    max-width: 1000px;
    margin: 20px auto;
    padding: 20px;
    background: white;
    box-sizing: border-box;
}

.header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid #ccc;
    padding-bottom: 15px;
    margin-bottom: 20px;
}

.meta-info {
    border-collapse: collapse;
}

.meta-info td {
    padding: 3px 6px;
}

.label {
    width: 90px;
    font-weight: bold;
}

.report-title {
    font-size: 18px;
    font-weight: bold;
    margin-bottom: 10px;
}

.brand-block {
    text-align: right;
}

.brand-name {
    font-size: 20px;
    font-weight: bold;
    color: #0d4d89;
}

.brand-subtitle {
    font-size: 13px;
    letter-spacing: 2px;
}

/* ---------------- TABLE ---------------- */

.report-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}

.report-table th,
.report-table td {
    border: 1px solid #cfd8e3;
    padding: 6px;
    font-size: 12px;
    vertical-align: top;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: break-word;
}

.report-table th {
    background: #f4f6f9;
    font-weight: bold;
    text-align: center;
}

/* Column Widths */

.report-table th:nth-child(1),
.report-table td:nth-child(1) {
    width: 14%;
}

.report-table th:nth-child(2),
.report-table td:nth-child(2) {
    width: 10%;
}

.report-table th:nth-child(3),
.report-table td:nth-child(3) {
    width: 22%;
}

.report-table th:nth-child(4),
.report-table td:nth-child(4) {
    width: 24%;
}

.report-table th:nth-child(5),
.report-table td:nth-child(5) {
    width: 9%;
}

.report-table th:nth-child(6),
.report-table td:nth-child(6) {
    width: 9%;
}

.report-table th:nth-child(7),
.report-table td:nth-child(7) {
    width: 8%;
}

.report-table th:nth-child(8),
.report-table td:nth-child(8) {
    width: 6%;
}

.report-table th:nth-child(9),
.report-table td:nth-child(9) {
    width: 6%;
}

/* Wrap only Payee and Details */

.report-table td:nth-child(3),
.report-table td:nth-child(4) {
    white-space: normal;
    word-break: break-word;
}

/* Amount */

.num {
    text-align: right;
    white-space: nowrap;
    font-family: "Courier New", monospace;
}

/* Group Header */

.group-header td {
    background: #edf4ff;
    font-weight: bold;
    color: #0d4d89;
}

/* Total */

.total-row td {
    background: #f8fafc;
    font-weight: bold;
    border-top: 2px solid #334155;
}

.empty-cell {
    background: #fafafa;
}

.footer {
    margin-top: 25px;
    text-align: center;
    font-size: 12px;
    color: gray;
}

.no-print {
    text-align: right;
    margin-bottom: 15px;
}

.button {
    padding: 8px 16px;
    border: none;
    background: #2563eb;
    color: white;
    border-radius: 20px;
    cursor: pointer;
}

.button:hover {
    background: #1d4ed8;
}

/* PRINT */

@page {
    size: A4 portrait;
    margin: 10mm;
}

@media print {

    body {
        background: white;
    }

    .page {
        margin: 0;
        padding: 0;
        max-width: 100%;
        box-shadow: none;
    }

    .no-print {
        display: none;
    }

    .report-table th,
    .report-table td {
        font-size: 11px;
        padding: 5px;
    }
}
</style>
      </head>
      <body>
        <div class="no-print">
          <button class="button" onclick="window.print()">Print / Save PDF</button>
        </div>

        <div class="page">
          <div class="header-top">
            <div>
              <div class="report-title">${reportTitle}</div>
              <table class="meta-info">
                <tr><td class="label">Report</td><td>${text(parameter)}</td></tr>
                <tr><td class="label">Date</td><td>${reportDate}</td></tr>
                <tr><td class="label">User</td><td>${generatedBy}</td></tr>
                <tr><td class="label">Currency</td><td>OMR</td></tr>
              </table>
            </div>
            <div class="brand-block">
              <div class="brand-name">AL MADINA</div>
              <div class="brand-subtitle">LOGISTICS</div>
            </div>
          </div>

          <table class="report-table">
            <thead>
              <tr>
                <th>A/c Code</th>
                <th>Chq No.</th>
                <th>Payee</th>
                <th>Details</th>
                <th>Chq Date</th>
                <th>Doc Date</th>
                <th class="num">Amount</th>
                <th>Sign 1</th>
                <th>Sign 2</th>
              </tr>
            </thead>
            <tbody>
              ${tableBodyHtml || '<tr><td colspan="9" style="text-align:center; padding: 36px 0;">No records found for the selected criteria.</td></tr>'}
            </tbody>
          </table>

          <div class="footer">Generated by ${generatedBy} • ${reportDate}</div>
        </div>
      </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Report Generation Error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to generate report",
      details: error.message
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error("Connection close error:", e);
      }
    }
  }
};

