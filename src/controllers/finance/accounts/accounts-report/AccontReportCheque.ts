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
        let tableBodyHtml = "";
        Object.entries(groups).forEach(([groupName, groupRows]) => {
            let groupTotal = 0;
            // Header for the Account Group
            tableBodyHtml += `
        <tr class="group-header">
          <td colspan="9"><strong>${text(groupName)}</strong></td>
        </tr>`;

            // Data rows for this account
            groupRows.forEach((r) => {
                const amt = Number(r.amount) || 0;
                groupTotal += amt;
                tableBodyHtml += `
          <tr>
            <td></td> <!-- A/c Code column is empty in rows, shown in group header -->
            <td>${text(r.chq_no)}</td>
            <td>${text(r.payee_name || r.payee)}</td>
            <td>${text(r.remarks || r.details || r.narration)}</td>
            <td>${formatDateStr(r.chq_date)}</td>
            <td>${formatDateStr(r.doc_date)}</td>
            <td class="num">${money(amt)}</td>
            <td></td> <!-- Sign 1 -->
            <td></td> <!-- Sign 2 -->
          </tr>`;
            });

            // Total row for this account
            tableBodyHtml += `
        <tr class="total-row">
          <td colspan="6" class="num"><strong>Total :</strong></td>
          <td class="num"><strong>${money(groupTotal)}</strong></td>
          <td colspan="2"></td>
        </tr>`;
        });

        // 8. Final HTML Template (Matching the PDF Screenshot)
        const reportHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Cheque Book Monitoring Report</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11px; color: #333; margin: 40px; background-color: #f5f5f5; }
          .page { background: white; padding: 40px; box-shadow: 0 0 10px rgba(0,0,0,0.1); min-height: 297mm; }
          .header-top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
          .meta-info td { padding: 2px 8px 2px 0; vertical-align: top; }
          .label { font-weight: bold; width: 90px; color: #555; }
          table.report-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          table.report-table th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 8px 5px; text-align: left; background: #fff; font-size: 10px; text-transform: uppercase; }
          table.report-table td { padding: 6px 5px; vertical-align: top; border-bottom: 1px solid #eee; }
          .group-header td { background-color: #ffffff; padding-top: 15px; font-size: 11px; border-bottom: 1px solid #333; }
          .total-row td { border-bottom: 2px solid #333; padding-bottom: 10px; background-color: #fff; }
          .num { text-align: right; font-family: 'Courier New', Courier, monospace; }
          .footer { margin-top: 40px; text-align: center; font-weight: bold; border-top: 1px solid #000; padding-top: 10px; }
          @media print {
            body { background: white; margin: 0; }
            .page { box-shadow: none; padding: 20px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 20px; text-align: right;">
          <button onclick="window.print()" style="padding: 8px 20px; cursor: pointer;">Print to PDF</button>
        </div>

        <div class="page">
          <div class="header-top">
            <table class="meta-info">
              <tr><td class="label">Title :</td><td><strong>Cheque Book Monitoring ${text(code5)} - ${text(code6)} (Division: ${text(code2)})</strong></td></tr>
              <tr><td class="label">Date :</td><td>${formatDateStr(new Date())}</td></tr>
              <tr><td class="label">User :</td><td>${text(loginid)}</td></tr>
              <tr><td class="label">Report :</td><td>${text(parameter)}</td></tr>
              <tr><td class="label">Currency :</td><td>OMR</td></tr>
            </table>
            <!-- Replace with actual logo URL -->
            <div style="text-align:right">
               <div style="font-size: 18px; font-weight: bold; color: #185FA5;">AL MADINA</div>
               <div style="font-size: 10px; letter-spacing: 2px;">LOGISTICS</div>
            </div>
          </div>

          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 100px;">A/c Code</th>
                <th style="width: 80px;">Chq No.</th>
                <th style="width: 150px;">Payee</th>
                <th>Details</th>
                <th style="width: 80px;">Chq Date</th>
                <th style="width: 80px;">Doc Date</th>
                <th class="num" style="width: 100px;">Amount</th>
                <th style="width: 70px;">Sign 1</th>
                <th style="width: 70px;">Sign 2</th>
              </tr>
            </thead>
            <tbody>
              ${tableBodyHtml || '<tr><td colspan="9" style="text-align:center; padding: 40px;">No records found for the selected criteria.</td></tr>'}
            </tbody>
          </table>

          <div class="footer">End of Report</div>
        </div>

        <script>
          // Optional: auto-trigger print dialog
          // window.onload = () => { setTimeout(() => window.print(), 500); };
        </script>
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

