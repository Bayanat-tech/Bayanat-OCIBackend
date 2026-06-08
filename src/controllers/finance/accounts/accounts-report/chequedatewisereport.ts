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

export const getChequeDateWiseReport = async (req: Request, res: Response): Promise<void> => {
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
      parameter: parameter || "Account_Report_ChqDateWise",
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
          v_sql); :out_sql := v_sql; END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("The procedure did not return a valid SQL query.");
    console.log("Generated SQL for Cheque Date Wise Report:", rawSql);

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // Group rows by ac_code + ac_name
    const groups: Record<string, any[]> = {};
    rows.forEach((r) => {
      const key = `${r.ac_code}||${r.ac_name || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    let tableBodyHtml = "";
    let grandTotalCredit = 0;
    let grandTotalDebit = 0;
    const formatBalance = (value: number) => {
      return value < 0
        ? `(${money(Math.abs(value))})`
        : money(value);
    };

    Object.entries(groups).forEach(([key, groupRows]) => {
      const [ac_code, ac_name] = key.split("||");
      const opening = Number(groupRows[0]?.op_balance) || 0;
      let totalCredit = 0;
      let totalDebit = 0;
      let runningBalance = opening;

      // ── account header row ──
      tableBodyHtml += `
        <tr class="group-header">
          <td><strong>${text(ac_code)}</strong></td>
          <td colspan="6"><strong>${text(ac_name)}</strong></td>
          <td class="num opening-val" colspan="2"><strong>Opening</strong></td>
          <td class="num opening-val"><strong>${formatBalance(opening)}</strong></td>
        </tr>`;

      // groupRows.forEach((r) => {
      //   const amount = Number(r.lcur_amount) || 0;

      //   // negative = credit
      //   const cr = r.sign_ind < 0 ? Math.abs(amount) : 0;

      //   // positive = debit
      //   const dr = r.sign_ind > 0 ? amount : 0;

      //   totalCredit += cr;
      //   totalDebit += dr;

      //   // running balance
      //   runningBalance = runningBalance + dr - cr;

      //   const hasTransaction = cr !== 0 || dr !== 0;

      //   // ── transaction row ──
      //   tableBodyHtml += `
      //     <tr class="data-row">
      //       <td class="num">${text(r.salesman_code || "")}</td>
      //       <td>${text(r.doc_type || "")}</td>
      //       <td>${text(r.doc_no || "")}</td>
      //       <td>${formatDateStr(r.doc_date)}</td>
      //       <td>${text(r.chq_no || "")}</td>
      //       <td>${formatDateStr(r.chq_date)}</td>
      //       <td>${text(r.bank || "")}</td>
      //       <td class="num">${hasTransaction ? money(cr) : "0.000"}</td>
      //       <td class="num">${hasTransaction ? money(dr) : "0.000"}</td>
      //       <td class="num">${formatBalance(runningBalance)}</td>
      //     </tr>`;

      //   // ── narration / remarks sub-row (only if there's text) ──
      //   const narration = text(r.narration || r.remarks || r.details || "");
      //   if (narration) {
      //     tableBodyHtml += `
      //     <tr class="narration-row">
      //       <td></td>
      //       <td colspan="9" class="narration-cell">${narration}</td>
      //     </tr>`;
      //   }
      // });
      const pdcGroups: Record<string, any[]> = {};

      groupRows.forEach((r) => {
        const pdcKey = r.pdc_ind === 'Y' ? "PDC" : "NORMAL";

        if (!pdcGroups[pdcKey]) {
          pdcGroups[pdcKey] = [];
        }

        pdcGroups[pdcKey].push(r);
      });

      Object.entries(pdcGroups).forEach(([pdcType, rows]) => {

        tableBodyHtml += `
    <tr class="sub-group-header">
        <td colspan="10">
            <strong>${pdcType === "PDC" ? "PDC CHEQUES" : "NORMAL CHEQUES"}</strong>
        </td>
    </tr>`;

        rows.forEach((r) => {

          const amount = Number(r.lcur_amount) || 0;

          const cr = r.sign_ind < 0
            ? Math.abs(amount)
            : 0;

          const dr = r.sign_ind > 0
            ? amount
            : 0;

          totalCredit += cr;
          totalDebit += dr;

          runningBalance += dr - cr;

          const hasTransaction = cr !== 0 || dr !== 0;

          tableBodyHtml += `
        <tr class="data-row">
            <td class="num">${text(r.salesman_code || "")}</td>
            <td>${text(r.doc_type || "")}</td>
            <td>${text(r.doc_no || "")}</td>
            <td>${formatDateStr(r.doc_date)}</td>
            <td>${text(r.chq_no || "")}</td>
            <td>${formatDateStr(r.chq_date)}</td>
            <td>${text(r.bank || "")}</td>
            <td class="num">${hasTransaction ? money(cr) : "0.000"}</td>
            <td class="num">${hasTransaction ? money(dr) : "0.000"}</td>
            <td class="num">${formatBalance(runningBalance)}</td>
        </tr>`;
        });
      });

      grandTotalCredit += totalCredit;
      grandTotalDebit += totalDebit;

      const closing = runningBalance;
      // ── account total + closing ──
      tableBodyHtml += `
        <tr class="total-row">
          <td colspan="5"></td>
          <td colspan="2" class="num"><strong>Total :</strong></td>
          <td class="num"><strong>${money(totalCredit)}</strong></td>
          <td class="num"><strong>${money(totalDebit)}</strong></td>
          <td></td>
        </tr>
        <tr class="closing-row">
          <td colspan="7" class="num"><strong>Closing</strong></td>
          <td colspan="3" class="num closing-val"><strong>${formatBalance(closing)}</strong></td>
        </tr>`;
    });

    // ── grand total row ──
    tableBodyHtml += `
      <tr class="grand-total-row">
        <td colspan="7" class="num"></td>
        <td class="num"><strong>${money(grandTotalCredit)}</strong></td>
        <td class="num"><strong>${money(grandTotalDebit)}</strong></td>
        <td></td>
      </tr>`;

    const reportHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>A/c Ledger - Cheque Date Wise</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 10px;
            color: #333;
            margin: 40px;
            background-color: #f5f5f5;
          }
          .page {
            background: white;
            padding: 40px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
          }

          /* ── header ── */
          .header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #333;
            padding-bottom: 15px;
            margin-bottom: 20px;
          }
          .meta-info td { padding: 2px 8px 2px 0; vertical-align: top; }
          .label { font-weight: bold; width: 80px; color: #555; }

          /* ── table ── */
          table.report-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          table.report-table th {
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
            padding: 6px 5px;
            text-align: left;
            font-size: 9px;
            text-transform: uppercase;
            background: #fff;
          }
          table.report-table td {
            padding: 4px 5px;
            vertical-align: top;
          }

          /* ── row types ── */
          .group-header td {
            padding-top: 14px;
            padding-bottom: 4px;
            border-bottom: 1px solid #333;
            font-size: 10px;
          }

          .sub-group-header td {
    background: #f2f2f2;
    font-weight: bold;
    border-top: 1px solid #999;
    border-bottom: 1px solid #999;
    padding: 6px;
}
          .opening-val { color: #c00; }

          .data-row td { border-bottom: 1px solid #f0f0f0; }

          .narration-row td {
            padding: 0 5px 5px 5px;
            border-bottom: 1px solid #f0f0f0;
          }
          .narration-cell {
            font-size: 9px;
            color: #555;
            padding-left: 20px;
            white-space: pre-wrap;
          }

          .total-row td {
            border-top: 1px solid #333;
            padding-top: 5px;
            padding-bottom: 3px;
          }
          .closing-row td {
            border-bottom: 2px solid #333;
            padding-bottom: 8px;
          }
          .closing-val { color: #333; }

          .grand-total-row td {
            border-top: 2px solid #333;
            border-bottom: 2px solid #333;
            padding: 6px 5px;
            font-weight: bold;
          }

          /* ── alignment ── */
          .num { text-align: right; font-family: 'Courier New', Courier, monospace; }

          /* ── footer ── */
          .footer {
            margin-top: 30px;
            text-align: center;
            font-weight: bold;
            border-top: 1px solid #000;
            padding-top: 8px;
          }
          .powered { text-align: right; font-size: 9px; color: #999; margin-top: 5px; }

          @media print {
            body { background: white; margin: 0; }
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
          <!-- header -->
          <div class="header-top">
            <table class="meta-info">
              <tr>
                <td class="label">Title :</td>
                <td><strong>A/c Ledger for the Period ${text(code5)} - ${text(code6)}</strong></td>
              </tr>
              <tr><td class="label">Date :</td><td>${formatDateStr(new Date())}</td></tr>
              <tr><td class="label">User :</td><td>${text(loginid)}</td></tr>
              <tr><td class="label">Report :</td><td>rpt_ac_ledger_chqdatewise</td></tr>
              <tr><td class="label">Currency :</td><td></td></tr>
            </table>
            <div style="text-align:right;">
              <div style="font-size:16px; font-weight:bold; color:#185FA5;">AL MADINA</div>
              <div style="font-size:9px; letter-spacing:2px;">LOGISTICS</div>
            </div>
          </div>

          <!-- report table -->
          <table class="report-table">
            <thead>
              <tr>
                <th style="width:55px;">A/c Code</th>
                <th style="width:30px;">Type</th>
                <th style="width:80px;">Doc No.</th>
                <th style="width:70px;">Doc Date</th>
                <th style="width:70px;">Chq No.</th>
                <th style="width:70px;">Chq Date</th>
                <th style="width:70px;">Bank</th>
                <th class="num" style="width:90px;">Credit</th>
                <th class="num" style="width:90px;">Debit</th>
                <th class="num" style="width:95px;">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${tableBodyHtml || `
              <tr>
                <td colspan="10" style="text-align:center; padding:40px; color:#999;">
                  No records found for the selected criteria.
                </td>
              </tr>`}
            </tbody>
          </table>

          <div class="footer">End of Report</div>
          <div class="powered">powered by A W A R E</div>
        </div>
      </body>
      </html>`;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Cheque Date Wise Report Error:", error);
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