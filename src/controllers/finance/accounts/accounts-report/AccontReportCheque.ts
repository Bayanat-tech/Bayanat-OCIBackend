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
          :root { color-scheme: light; }
          body { margin: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f2f4f7; color: #1f2937; }
          .page { width: auto; max-width: 100%; margin: 24px auto; padding: 28px 32px; background: #fff; border-radius: 12px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08); box-sizing: border-box; }
          .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid #d1d5db; padding-bottom: 20px; margin-bottom: 24px; }
          .meta-info { border-collapse: collapse; width: auto; }
          .meta-info td { padding: 4px 8px; vertical-align: top; }
          .label { font-weight: 700; width: 100px; color: #475569; white-space: nowrap; }
          .report-title { font-size: 1rem; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
          .brand-block { text-align: right; }
          .brand-name { font-size: 18px; font-weight: 800; letter-spacing: 0.12em; color: #0d4d89; margin-bottom: 4px; }
          .brand-subtitle { font-size: 0.85rem; letter-spacing: 0.18em; color: #334155; }
          .report-table { width: 100%; border-collapse: collapse; table-layout: auto; }
          .report-table th,
          .report-table td { padding: 12px 10px; border: 1px solid #e2e8f0; word-break: break-word; white-space: normal; }
          .report-table th { background: #f8fafc; color: #334155; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.02em; }
          .report-table td { background: #fff; font-size: 0.88rem; }
          .report-table td:first-child { width: 110px; }
          .report-table td:nth-child(2) { width: 90px; }
          .report-table td:nth-child(3) { width: 170px; }
          .report-table td:nth-child(5),
          .report-table td:nth-child(6),
          .report-table td:nth-child(7) { text-align: right; }
          .group-header td { background: #eff6ff; font-weight: 700; color: #1e3a8a; border-top: 2px solid #c7d2fe; }
          .total-row td { background: #f8fafc; font-weight: 700; border-top: 2px solid #334155; }
          .num { text-align: right; font-family: 'Courier New', Courier, monospace; }
          .empty-cell { background: #f9fafb; }
          .footer { margin-top: 30px; text-align: center; color: #475569; font-size: 0.82rem; padding-top: 10px; border-top: 1px solid #e2e8f0; }
          .no-print { margin-bottom: 16px; text-align: right; }
          .button { display: inline-flex; align-items: center; justify-content: center; padding: 10px 18px; border-radius: 999px; border: none; background: #2563eb; color: #fff; font-weight: 700; cursor: pointer; transition: background-color 0.2s ease; }
          .button:hover { background: #1d4ed8; }
          @media print {
            body { background: #fff; }
            .page { box-shadow: none; margin: 0; border-radius: 0; }
            .no-print { display: none; }
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

