import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

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

export const OutstandingList = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        /*
         * SQL returns:
         *   l4_code, l4_description, ac_code, ac_name,
         *   inv_no, inv_date,
         *   org_amt        → Inv Amount
         *   un_allocated_amt → Un-Allocated
         *   balance_amount → Inv Balance  (age flag = 'A' sum)
         *   l4_type, div_code, company_code
         */
        const {
            loginid,
            code1, code2, code3, code4, code5, code6,
            code7, code8, code9, code10, code11, code12, code13, code14,
            code15, code16,
        } = req.body;

        const parameter = "Account_Report_VW_PERIODWISE_OUTSTD_LIST";

        let tenantId = getCurrentTenantId();
        if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
        if (!tenantId) { res.status(400).json({ success: false, message: "Tenant not found" }); return; }
        connection = await TenantManager.getConnection(tenantId);

        const binds: any = {
            parameter,
            loginid: loginid || "ADMIN",
            code1: code1 || null, code2: code2 || null, code3: code3 || null,
            code4: code4 || null, code5: code5 || null, code6: code6 || null,
            code7: code7 || null, code8: code8 || null, code9: code9 || null,
            code10: code10 || null, code11: code11 || null, code12: code12 || null,
            code13: code13 || null, code14: code14 || null, code15: code15 || null,
            code16: code16 || null,
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
            Object.keys(row).reduce((acc: any, key) => { acc[key.toLowerCase()] = row[key]; return acc; }, {})
        );

        // ─── Group: l4_code → ac_code → inv rows ─────────────────────────
        type DetailRow = (typeof rows)[0];
        type AccGroup  = { ac_code: string; ac_name: string; rows: DetailRow[] };
        type L4Group   = { l4_code: string; l4_description: string; accounts: Map<string, AccGroup> };

        const l4Map = new Map<string, L4Group>();
        rows.forEach((r) => {
            const l4Key  = text(r.l4_code);
            const l4Desc = text(r.l4_description);
            const acKey  = text(r.ac_code);
            if (!l4Map.has(l4Key)) l4Map.set(l4Key, { l4_code: l4Key, l4_description: l4Desc, accounts: new Map() });
            const l4 = l4Map.get(l4Key)!;
            if (!l4.accounts.has(acKey)) {
                l4.accounts.set(acKey, { ac_code: acKey, ac_name: text(r.ac_name), rows: [] });
            }
            l4.accounts.get(acKey)!.rows.push(r);
        });

        // ─── Build HTML body ──────────────────────────────────────────────
        let tableBodyHtml = "";
        let grandUnalloc = 0, grandBalance = 0;

        l4Map.forEach((l4) => {
            // L4 section header
            tableBodyHtml += `
            <tr class="l4-header">
              <td colspan="6"><strong>${l4.l4_code}&nbsp;&nbsp;${l4.l4_description}</strong></td>
            </tr>`;

            let l4Unalloc = 0, l4Balance = 0;

            l4.accounts.forEach((ac) => {
                // Account header
                tableBodyHtml += `
                <tr class="ac-header">
                  <td colspan="6">
                    <strong>${ac.ac_code}&nbsp;&nbsp;${ac.ac_name}</strong>
                  </td>
                </tr>`;

                let acUnalloc = 0, acBalance = 0;

                ac.rows.forEach((r) => {
                    const orgAmt   = num(r.org_amt);
                    const unalloc  = num(r.un_allocated_amt);
                    const balance  = num(r.balance_amount);

                    acUnalloc += unalloc;
                    acBalance += balance;

                    tableBodyHtml += `
                    <tr class="detail-row">
                      <td style="padding-left:18px;">${text(r.inv_no)}</td>
                      <td class="num">${formatDateStr(r.inv_date)}</td>
                      <td class="num">${money(orgAmt)}</td>
                      <td class="num">${money(unalloc)}</td>
                      <td class="num">${money(balance)}</td>
                      <td></td>
                    </tr>`;
                });

                // Account total
                tableBodyHtml += `
                <tr class="ac-total-row">
                  <td colspan="3"><strong>Total for ${ac.ac_name}</strong></td>
                  <td class="num"><strong>${money(acUnalloc)}</strong></td>
                  <td class="num"><strong>${money(acBalance)}</strong></td>
                  <td></td>
                </tr>`;

                l4Unalloc += acUnalloc;
                l4Balance += acBalance;
            });

            // L4 total
            tableBodyHtml += `
            <tr class="l4-total-row">
              <td colspan="3"><strong>Total for ${l4.l4_description}</strong></td>
              <td class="num"><strong>${money(l4Unalloc)}</strong></td>
              <td class="num"><strong>${money(l4Balance)}</strong></td>
              <td></td>
            </tr>
            <tr><td colspan="6" style="height:10px;border:none;"></td></tr>`;

            grandUnalloc += l4Unalloc;
            grandBalance += l4Balance;
        });

        // Grand total
        tableBodyHtml += `
        <tr class="grand-total-row">
          <td colspan="3"><strong>Grand Total :</strong></td>
          <td class="num"><strong>${money(grandUnalloc)}</strong></td>
          <td class="num"><strong>${money(grandBalance)}</strong></td>
          <td></td>
        </tr>`;

        const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Outstanding List Report</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; font-size:11px; color:#222; margin:30px; background:#f5f5f5; }
    .page { background:white; padding:32px 36px; box-shadow:0 0 10px rgba(0,0,0,.1); min-height:297mm; }
    .report-header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #333; padding-bottom:12px; margin-bottom:6px; }
    .company-name { font-size:18px; font-weight:700; color:#185FA5; }
    .company-sub  { font-size:10px; letter-spacing:2px; color:#555; }
    .meta-table td { padding:2px 8px 2px 0; vertical-align:top; font-size:11px; }
    .meta-label    { font-weight:600; color:#555; min-width:55px; }
    .report-title-strip { background:#185FA5; color:#fff; font-size:12px; font-weight:600; padding:5px 10px; margin-bottom:10px; border-radius:3px; }
    table.report-table { width:100%; border-collapse:collapse; }
    table.report-table th { border-top:1.5px solid #333; border-bottom:1.5px solid #333; padding:6px 5px; text-align:left; background:#fff; font-size:10px; text-transform:uppercase; white-space:nowrap; }
    table.report-table td { padding:4px 5px; vertical-align:top; border-bottom:0.5px solid #f0f0f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
    .num { text-align:right !important; font-family:'Courier New',monospace; }
    .l4-header td { background:#efefef; border-top:1.5px solid #333; border-bottom:1px solid #bbb; padding:6px 8px; font-size:12px; }
    .ac-header td { background:#fff; border-bottom:1px dashed #ccc; padding:5px 8px; font-size:11px; }
    .detail-row:hover td { background:#f9f9f9; }
    .ac-total-row td { border-top:1px solid #999; border-bottom:2px solid #999; background:#fafafa; }
    .l4-total-row td { border-top:1.5px solid #555; border-bottom:2px solid #555; background:#f3f3f3; }
    .grand-total-row td { border-top:2.5px double #333; border-bottom:2.5px double #333; background:#eef4fb; padding:6px 5px; font-size:12px; }
    .footer     { margin-top:36px; text-align:center; font-weight:600; border-top:1px solid #333; padding-top:8px; font-size:11px; color:#555; }
    .powered-by { text-align:right; font-size:10px; color:#aaa; margin-top:4px; }
    @media print { body { background:white; margin:0; } .page { box-shadow:none; padding:16px; } .no-print { display:none; } }
  </style>
</head>
<body>
<div class="no-print" style="margin-bottom:16px;text-align:right;">
  <button onclick="window.print()" style="padding:7px 20px;cursor:pointer;background:#185FA5;color:#fff;border:none;border-radius:5px;font-size:12px;">Print / Save PDF</button>
</div>
<div class="page">
  <div class="report-header">
    <table class="meta-table">
      <tr><td class="meta-label">Title :</td><td><strong>Ageing as on ${text(code6)}</strong></td></tr>
      <tr><td class="meta-label">Date :</td><td>${formatDateStr(new Date())}</td></tr>
      <tr><td class="meta-label">User :</td><td>${text(loginid)}</td></tr>
      <tr><td class="meta-label">Report :</td><td>${text(parameter)}</td></tr>
    </table>
    <div style="text-align:right;">
      <div class="company-name">AL MADINA</div>
      <div class="company-sub">LOGISTICS</div>
    </div>
  </div>
  <div class="report-title-strip">
    Ageing as on ${text(code6)}
    &nbsp;|&nbsp; Division: ${text(code2) || "All"}
    &nbsp;|&nbsp; Outstanding List
  </div>
  <table class="report-table">
    <thead>
      <tr>
        <th style="width:160px;">A/C Code / Inv No</th>
        <th class="num" style="width:75px;">Inv Date</th>
        <th class="num" style="width:110px;">Inv Amount</th>
        <th class="num" style="width:110px;">Un-Allocated</th>
        <th class="num" style="width:110px;">Inv Balance</th>
        <th style="width:60px;">Group</th>
      </tr>
    </thead>
    <tbody>
      ${tableBodyHtml || `<tr><td colspan="6" style="text-align:center;padding:40px;color:#999;">No records found.</td></tr>`}
    </tbody>
  </table>
  <div class="footer">End of Report</div>
  <div class="powered-by">powered by A W A R E</div>
</div>
</body>
</html>`;

        res.setHeader("Content-Type", "text/html");
        res.status(200).send(reportHtml);

    } catch (error: any) {
        console.error("Outstanding List Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
    }
};