import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

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

export const getSummaryDumpReport = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        const {
            parameter, loginid,
            code1, code2, code3, code4, code5, code6, code7, code8, code20
        } = req.body;

        let tenantId = getCurrentTenantId();
        if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
        if (!tenantId) { res.status(400).json({ success: false, message: "Tenant not found" }); return; }

        connection = await TenantManager.getConnection(tenantId);

        const binds: any = {
            parameter: parameter || "Account_Report_Summary",
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
        binds.date1 = null; binds.date2 = null;

        const result = await connection.execute(
            `DECLARE v_sql VARCHAR2(32767); BEGIN PROC_BUILD_DYNAMIC_SQL_COMMON20(
          :parameter, :loginid,
          :code1, :code2, :code3, :code4, :code5, :code6, :code7, :code8, :code9, :code10,
          :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
          :number1, :number2, :number3, :number4,
          :date1, :date2, :date3, :date4,
          v_sql); :out_sql := v_sql; END;`, binds);

        const rawSql = (result.outBinds as any).out_sql;
        if (!rawSql) throw new Error("The procedure did not return a valid SQL query.");

        const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (dataResult.rows as any[]).map((row) =>
            Object.keys(row).reduce((acc: any, key) => { acc[key.toLowerCase()] = row[key]; return acc; }, {})
        );

        // Summary dump: one row per account — no sub-grouping needed
        let tableBodyHtml = "";
        let grandTotalOpeningDebit = 0, grandTotalOpeningCredit = 0;
        let grandTotalDebit = 0, grandTotalCredit = 0;

        rows.forEach((r) => {
            const opening = Number(r.opening_balance) || 0;
            const dr = Number(r.debit) || 0;
            const cr = Number(r.credit) || 0;
            const closing = Number(r.closing_balance) || 0;

            grandTotalDebit += dr;
            grandTotalCredit += cr;

            const openingDisplay = opening < 0
                ? `(${money(Math.abs(opening))})`
                : money(opening);
            const closingDisplay = closing < 0
                ? `(${money(Math.abs(closing))})`
                : money(closing);

            tableBodyHtml += `
        <tr>
          <td>${text(r.ac_name || "")}</td>
          <td class="num">${openingDisplay}</td>
          <td class="num">${dr !== 0 ? money(dr) : "0.00"}</td>
          <td class="num">${cr !== 0 ? money(cr) : "0.00"}</td>
          <td class="num ac-code-col">${text(r.ac_code || "")}</td>
          <td class="num">${closingDisplay}</td>
        </tr>`;
        });

        tableBodyHtml += `
      <tr class="grand-total-row">
        <td><strong>Grand Total :</strong></td>
        <td class="num"></td>
        <td class="num"><strong>${money(grandTotalDebit)}</strong></td>
        <td class="num"><strong>${money(grandTotalCredit)}</strong></td>
        <td></td>
        <td class="num"></td>
      </tr>`;

        const reportHtml = `
      <!DOCTYPE html><html><head><meta charset="utf-8"/>
      <title>Summary Dump Report</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 10px; color: #333; margin: 40px; background-color: #f5f5f5; }
        .page { background: white; padding: 40px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        .header-top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
        .meta-info td { padding: 2px 8px 2px 0; vertical-align: top; }
        .label { font-weight: bold; width: 90px; color: #555; }
        .company-name { font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 10px; }
        table.report-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        table.report-table th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 6px 4px; text-align: left; font-size: 9px; text-transform: uppercase; }
        table.report-table td { padding: 4px; vertical-align: middle; border-bottom: 1px solid #eee; }
        .grand-total-row td { border-top: 2px solid #333; border-bottom: 2px solid #333; font-size: 11px; background: #fff; }
        .num { text-align: right; font-family: 'Courier New', Courier, monospace; }
        .ac-code-col { color: #555; }
        .footer { margin-top: 30px; text-align: center; font-weight: bold; border-top: 1px solid #000; padding-top: 8px; }
        .powered { text-align: right; font-size: 9px; color: #999; margin-top: 5px; }
        @media print { body { background: white; margin: 0; } .page { box-shadow: none; padding: 20px; } .no-print { display: none; } }
      </style></head><body>
      <div class="no-print" style="margin-bottom:20px;text-align:right;">
        <button onclick="window.print()" style="padding:8px 20px;cursor:pointer;">Print to PDF</button>
      </div>
      <div class="page">
        <div class="header-top">
          <table class="meta-info">
            <tr><td class="label">Title :</td><td><strong>Summary for ${text(code5)} - ${text(code6)}</strong></td></tr>
            <tr><td class="label">Currency :</td><td>OMR</td></tr>
            <tr><td class="label">Date :</td><td>${formatDateStr(new Date())}</td></tr>
            <tr><td class="label">User :</td><td>${text(loginid)}</td></tr>
            <tr><td class="label">Report :</td><td>rpt_ac_ledger_summ_dmp</td></tr>
          </table>
          <div style="text-align:right">
            <div style="font-size:16px;font-weight:bold;color:#185FA5;">AL MADINA</div>
            <div style="font-size:9px;letter-spacing:2px;">LOGISTICS</div>
          </div>
        </div>
        <div class="company-name">AL MADINA LOGISTICS COMPANY</div>
        <table class="report-table">
          <thead><tr>
            <th style="width:220px;">A/c Name</th>
            <th class="num" style="width:110px;">Opening Balance</th>
            <th class="num" style="width:100px;">Debit</th>
            <th class="num" style="width:100px;">Credit</th>
            <th style="width:100px;">A/c Code</th>
            <th class="num" style="width:110px;">Closing Balance</th>
          </tr></thead>
          <tbody>${tableBodyHtml || '<tr><td colspan="6" style="text-align:center;padding:40px;">No records found.</td></tr>'}</tbody>
        </table>
        <div class="footer">End of Report</div>
        <div class="powered">powered by A W A R E</div>
      </div></body></html>`;

        res.setHeader("Content-Type", "text/html");
        res.status(200).send(reportHtml);

    } catch (error: any) {
        console.error("Summary Dump Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
    }
};