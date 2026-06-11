import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// ─── Helpers (identical to cheque report) ────────────────────────────────────

const money = (v: any): string => {
    const n = Number(v);
    return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
    });
};

const text = (v: any): string => (v == null ? "" : String(v));

const formatDateStr = (v: any): string => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface PnlRow {
    h_code: string;
    h_name: string;
    pl_code: string;
    pl_name: string;
    lcur_amount: number;
    s_order: number;
}

interface GroupedHeader {
    h_code: string;
    h_name: string;
    s_order: number;
    rows: PnlRow[];
    total: number;
}

// ─── Group rows by header ─────────────────────────────────────────────────────

const groupByHeader = (rows: PnlRow[]): GroupedHeader[] => {
    const map = new Map<string, GroupedHeader>();
    for (const row of rows) {
        if (!map.has(row.h_code)) {
            map.set(row.h_code, {
                h_code: row.h_code,
                h_name: row.h_name ?? row.h_code,
                s_order: row.s_order,
                rows: [],
                total: 0,
            });
        }
        const grp = map.get(row.h_code)!;
        grp.rows.push(row);
        grp.total += row.lcur_amount ?? 0;
    }
    return Array.from(map.values()).sort((a, b) =>
        a.s_order !== b.s_order
            ? a.s_order - b.s_order
            : a.h_code.localeCompare(b.h_code)
    );
};

// ─── Build HTML (same structure as cheque report) ────────────────────────────

const buildProfitLossHTML = (
    rows: PnlRow[],
    params: {
        loginid: string;
        division: string;
        date_from: string;
        date_to: string;
        report_option: string;
    }
): string => {
    const groups       = groupByHeader(rows);
    const income       = groups.filter((g) => g.s_order === 1);
    const expense      = groups.filter((g) => g.s_order === 2);
    const totalIncome  = income.reduce((s, g) => s + g.total, 0);
    const totalExpense = expense.reduce((s, g) => s + g.total, 0);
    const net          = totalIncome - totalExpense;

    // ── Build table body (same pattern as cheque report) ─────────────────────
    let tableBodyHtml = "";

    // INCOME section
    if (income.length > 0) {
        tableBodyHtml += `
        <tr class="section-row">
          <td colspan="3"><strong>INCOME</strong></td>
        </tr>`;

        income.forEach((g) => {
            tableBodyHtml += `
        <tr class="group-header">
          <td colspan="3"><strong>${text(g.h_name)}</strong></td>
        </tr>`;

            g.rows.forEach((r) => {
                tableBodyHtml += `
        <tr>
          <td>${text(r.pl_code)}</td>
          <td>${text(r.pl_name)}</td>
          <td class="num">${money(r.lcur_amount)}</td>
        </tr>`;
            });

            tableBodyHtml += `
        <tr class="total-row">
          <td colspan="2"><strong>Total ${text(g.h_name)} :</strong></td>
          <td class="num"><strong>${money(g.total)}</strong></td>
        </tr>`;
        });

        tableBodyHtml += `
        <tr class="grand-total-row">
          <td colspan="2"><strong>TOTAL INCOME :</strong></td>
          <td class="num"><strong>${money(totalIncome)}</strong></td>
        </tr>`;
    }

    // EXPENSE section
    if (expense.length > 0) {
        tableBodyHtml += `
        <tr class="section-row">
          <td colspan="3"><strong>EXPENSES</strong></td>
        </tr>`;

        expense.forEach((g) => {
            tableBodyHtml += `
        <tr class="group-header">
          <td colspan="3"><strong>${text(g.h_name)}</strong></td>
        </tr>`;

            g.rows.forEach((r) => {
                tableBodyHtml += `
        <tr>
          <td>${text(r.pl_code)}</td>
          <td>${text(r.pl_name)}</td>
          <td class="num">${money(r.lcur_amount)}</td>
        </tr>`;
            });

            tableBodyHtml += `
        <tr class="total-row">
          <td colspan="2"><strong>Total ${text(g.h_name)} :</strong></td>
          <td class="num"><strong>${money(g.total)}</strong></td>
        </tr>`;
        });

        tableBodyHtml += `
        <tr class="grand-total-row">
          <td colspan="2"><strong>TOTAL EXPENSES :</strong></td>
          <td class="num"><strong>${money(totalExpense)}</strong></td>
        </tr>`;
    }

    // Net Profit / Loss row
    tableBodyHtml += `
        <tr class="net-row">
          <td colspan="2"><strong>NET ${net >= 0 ? "PROFIT" : "LOSS"} :</strong></td>
          <td class="num"><strong>${money(Math.abs(net))}</strong></td>
        </tr>`;

    // ── Full HTML (identical structure to cheque report) ─────────────────────
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Profit &amp; Loss Report</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11px;
      color: #333;
      margin: 40px;
      background-color: #f5f5f5;
    }
    .page {
      background: white;
      padding: 40px;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
      min-height: 297mm;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #333;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }
    .meta-info td {
      padding: 2px 8px 2px 0;
      vertical-align: top;
    }
    .label {
      font-weight: bold;
      width: 90px;
      color: #555;
    }
    table.report-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    table.report-table th {
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 8px 5px;
      text-align: left;
      background: #fff;
      font-size: 10px;
      text-transform: uppercase;
    }
    table.report-table td {
      padding: 6px 5px;
      vertical-align: top;
      border-bottom: 1px solid #eee;
    }
    .section-row td {
      background-color: #f0f4f8;
      padding: 8px 5px;
      font-size: 11px;
      border-top: 2px solid #333;
      border-bottom: 1px solid #333;
      color: #185FA5;
      letter-spacing: 0.04em;
    }
    .group-header td {
      background-color: #ffffff;
      padding-top: 15px;
      font-size: 11px;
      border-bottom: 1px solid #333;
    }
    .total-row td {
      border-bottom: 2px solid #333;
      padding-bottom: 10px;
      background-color: #fff;
    }
    .grand-total-row td {
      background-color: #f9fafb;
      border-top: 1px solid #333;
      border-bottom: 2px solid #333;
      padding: 7px 5px;
    }
    .net-row td {
      background-color: #eef3f9;
      border-top: 3px double #185FA5;
      border-bottom: 3px double #185FA5;
      padding: 9px 5px;
      font-size: 12px;
      color: #185FA5;
    }
    .num {
      text-align: right;
      font-family: 'Courier New', Courier, monospace;
    }
    .footer {
      margin-top: 40px;
      text-align: center;
      font-weight: bold;
      border-top: 1px solid #000;
      padding-top: 10px;
      font-size: 10px;
      color: #666;
    }
    @media print {
      body  { background: white; margin: 0; }
      .page { box-shadow: none; padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>

  <div class="no-print" style="margin-bottom:20px; text-align:right;">
    <button onclick="window.print()" style="padding:8px 20px; cursor:pointer;">Print to PDF</button>
  </div>

  <div class="page">

    <div class="header-top">
      <table class="meta-info">
        <tr>
          <td class="label">Title :</td>
          <td><strong>Profit &amp; Loss ${text(params.date_from)} - ${text(params.date_to)} (Division: ${text(params.division)})</strong></td>
        </tr>
        <tr><td class="label">Date :</td><td>${formatDateStr(new Date())}</td></tr>
        <tr><td class="label">User :</td><td>${text(params.loginid)}</td></tr>
        <tr><td class="label">Report :</td><td>${text(params.report_option)}</td></tr>
        <tr><td class="label">Currency :</td><td>OMR</td></tr>
      </table>
      <div style="text-align:right;">
        <div style="font-size:18px; font-weight:bold; color:#185FA5;">AL MADINA</div>
        <div style="font-size:10px; letter-spacing:2px; color:#666;">LOGISTICS</div>
      </div>
    </div>

    <table class="report-table">
      <thead>
        <tr>
          <th style="width:120px;">Code</th>
          <th>Description</th>
          <th class="num" style="width:140px;">Amount (OMR)</th>
        </tr>
      </thead>
      <tbody>
        ${tableBodyHtml || '<tr><td colspan="3" style="text-align:center; padding:40px;">No records found for the selected criteria.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">End of Report</div>
  </div>

</body>
</html>`;
};

// ─── Express Controller ───────────────────────────────────────────────────────

export const getProfitLossReport = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        // 1. Extract parameters
        const {
            parameter,
            loginid,
            code1, // company_code
            code2, // div_code
            code3, // date_from
            code4, // date_to
        } = req.body;

        // 2. Database connection
        let tenantId = getCurrentTenantId();
        if (!tenantId && loginid) {
            tenantId = await TenantManager.getTenantForUser(loginid);
        }

        if (!tenantId) {
            res.status(400).json({ success: false, message: "Tenant not found" });
            return;
        }

        connection = await TenantManager.getConnection(tenantId);

        // 3. Prepare binds for PROC_BUILD_DYNAMIC_SQL_COMMON20
        const binds: any = {
            parameter: parameter || "Account_Report_PROFIT_AND_LOSS_VW_PROFIT_AND_LOSS",
            loginid:   loginid   || "ADMIN",
            code1:     code1     || null,
            code2:     code2     || null,
            code3:     code3     || null,
            code4:     code4     || null,
            out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
        };

        // Fill remaining bind parameters to avoid Oracle binding errors
        for (let i = 5; i <= 20; i++) {
            binds[`code${i}`] = req.body[`code${i}`] || null;
        }
        for (let i = 1; i <= 4; i++) {
            binds[`number${i}`] = req.body[`number${i}`] || null;
            binds[`date${i}`]   = req.body[`date${i}`]   || null;
        }

        // 4. Execute procedure to get the SQL
        const result = await connection.execute(
            `DECLARE
        v_sql VARCHAR2(32767);
      BEGIN
        PROC_BUILD_DYNAMIC_SQL_COMMON20(
          :parameter, :loginid,
          :code1,  :code2,  :code3,  :code4,  :code5,  :code6,  :code7,  :code8,  :code9,  :code10,
          :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
          :number1, :number2, :number3, :number4,
          :date1,   :date2,   :date3,   :date4,
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

        // 5. Execute the generated SQL
        const dataResult = await connection.execute(rawSql, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        const rows: PnlRow[] = (dataResult.rows as any[]).map((row) =>
            Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {})
        );

        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        // 6. Build and send the HTML report
        const reportLabel =
            String(parameter).includes("month_wise") ? "P&L Month Wise"
            : String(parameter).includes("month")    ? "P&L for the Month"
            : "P&L for the Period";

        const html = buildProfitLossHTML(rows, {
            loginid:       loginid || "ADMIN",
            division:      code2   || "All",
            date_from:     code3   || "",
            date_to:       code4   || "",
            report_option: reportLabel,
        });

        res.setHeader("Content-Type", "text/html");
        res.status(200).send(html);

    } catch (error: any) {
        console.error("P&L Report Generation Error:", error);
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
                console.error("Connection close error:", e);
            }
        }
    }
};