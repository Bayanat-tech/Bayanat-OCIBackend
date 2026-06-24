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

export const getAccountPayeeWiseReport = async (req: Request, res: Response): Promise<void> => {
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
      parameter: parameter || "Account_Report_Payee",
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
    console.log("Generated SQL:", rawSql);

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => { acc[key.toLowerCase()] = row[key]; return acc; }, {})
    );

    // Group by ac_code + ac_name
    const groups: Record<string, any[]> = {};
    rows.forEach((r) => {
      const key = `${r.ac_code}||${r.ac_name || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    const reportTitle = `Ledger Basic Report ${text(code5)} - ${text(code6)}`;
    const generatedBy = text(loginid) || "Unknown User";
    const reportDate = formatDateStr(new Date());
    
    const formatBalance = (value: number) =>
      value < 0 ? `(${money(Math.abs(value))})` : money(value);

    
    let tableBodyHtml = "";
    let grandTotalDebit = 0, grandTotalCredit = 0;

    Object.entries(groups).forEach(([key, groupRows]) => {
      const [ac_code, ac_name] = key.split("||");
      const opening = Number(groupRows[0]?.op_balance) || 0;
      let totalDebit = 0, totalCredit = 0;
      let runningBalance = opening;

      // group header
      tableBodyHtml += `
        <tr class="grp-hdr">
          <td colspan="6"><strong>${text(ac_code)}</strong>&nbsp;&nbsp;${text(ac_name)}</td>
          <td class="opening-label" style="text-align:right"><strong>Opening</strong></td>
          <td class="num opening-val" colspan="2"><strong>${formatBalance(opening)}</strong></td>
        </tr>`;

      // split PDC / NORMAL
      const pdcGroups: Record<string, any[]> = {};
      groupRows.forEach((r) => {
        const k = r.pdc_ind === "Y" ? "PDC" : "NORMAL";
        if (!pdcGroups[k]) pdcGroups[k] = [];
        pdcGroups[k].push(r);
      });

      Object.entries(pdcGroups).forEach(([pdcType, pdcRows]) => {
        tableBodyHtml += `
          <tr class="sub-grp-hdr">
            <td colspan="9"><strong>${pdcType === "PDC" ? "PDC CHEQUES" : "NORMAL CHEQUES"}</strong></td>
          </tr>`;

        pdcRows.forEach((r) => {
          const amount = Number(r.lcur_amount) || 0;
          const dr = r.sign_ind > 0 ? amount : 0;
          const cr = r.sign_ind < 0 ? Math.abs(amount) : 0;
          totalDebit += dr;
          totalCredit += cr;
          runningBalance += dr - cr;

          const narration = text(r.narration || r.remarks || r.details || "").trim();

          tableBodyHtml += `
  <tr class="data-row">
    <td>${text(r.doc_type || "")}</td>
    <td>${text(r.doc_no || "")}</td>
    <td>${formatDateStr(r.doc_date)}</td>
    <td>${text(r.cheque_no || "")}</td>
    <td>${formatDateStr(r.cheque_date)}</td>
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

      tableBodyHtml += `
        <tr class="total-row">
          <td colspan="5" style="text-align:right"><strong>Total :</strong></td>
          <td class="num" colspan="2"><strong>${money(totalDebit)}</strong></td>
          <td class="num"><strong>${money(totalCredit)}</strong></td>
          <td></td>
        </tr>
        <tr class="closing-row">
          <td colspan="7" style="text-align:right"><strong>Closing</strong></td>
          <td class="num" colspan="2"><strong>${formatBalance(closing)}</strong></td>
        </tr>`;
    });

    tableBodyHtml += `
      <tr class="grand-row">
        <td colspan="5" style="text-align:right"><strong>Grand Total :</strong></td>
        <td class="num" colspan="2"><strong>${formatBalance(grandTotalDebit)}</strong></td>
        <td class="num"><strong>${formatBalance(grandTotalCredit)}</strong></td>
        <td></td>
      </tr>`;
    const reportHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${reportTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      background: #e5e7eb;
      color: #111;
      padding: 10px;
    }
    .page {
      width: 277mm;
      max-width: 277mm;
      margin: 10px auto;
      background: #fff;
      padding: 14px 16px;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }

    /* header */
    .header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      border-bottom: 2.5px solid #b8860b;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .logo-block {
      background: #1a5276;
      padding: 8px 14px;
      border-radius: 4px;
      min-width: 150px;
      text-align: center;
    }
    .logo-arabic { font-size: 12px; font-weight: 700; color: #f0c040; direction: rtl; }
    .logo-name   { font-size: 18px; font-weight: 800; color: #f0c040; letter-spacing: 0.04em; }
    .logo-sub    { font-size: 9px; letter-spacing: 0.18em; color: #cce0f5; margin-top: 2px; }

    .meta-block { flex: 1; }
    .meta-block table { border-collapse: collapse; }
    .meta-block td { padding: 1.5px 6px; font-size: 11px; vertical-align: top; }
    .meta-block .lbl { font-weight: 700; color: #333; width: 72px; }

    .page-info { font-size: 10px; color: #555; white-space: nowrap; text-align: right; }

    /* table */
    table.rt {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10.5px;
    }
    table.rt th {
      background: #1a5276;
      color: #fff;
      font-weight: 600;
      padding: 5px;
      border: 1px solid #2471a3;
      text-align: center;
    }
    table.rt td {
      border: 1px solid #d5d8dc;
      padding: 3px 5px;
      vertical-align: top;
    }

    /* sub-header row */
    tr.sub-hdr th {
      background: #d6e4f0;
      color: #1a3c6e;
      font-size: 10px;
      font-weight: 600;
      border-top: none;
      text-align: center;
    }

    /* group header */
    tr.grp-hdr td {
      background: #eaf2fb;
      font-weight: 700;
      color: #1a3c6e;
      border-top: 2px solid #2471a3;
      padding: 5px;
    }
    .opening-label { color: #c00; font-weight: 700; }
    .opening-val   { color: #c00; font-weight: 700; font-family: 'Courier New', monospace; }

    /* PDC/NORMAL */
    tr.sub-grp-hdr td {
      background: #f8fafc;
      font-weight: 700;
      color: #374151;
      padding: 3px 5px;
      border-top: 1px solid #cbd5e1;
    }

    tr.data-row td { background: #fff; }
    tr.narr-row td {
      border-top: none;
      font-style: italic;
      color: #555;
      font-size: 10px;
      background: #fff;
    }

    tr.total-row td {
      background: #eaf0fb;
      font-weight: 700;
      border-top: 1.5px solid #2471a3;
    }
    tr.closing-row td {
      background: #eaf0fb;
      font-weight: 700;
    }
    tr.grand-row td {
      background: #d4e6f1;
      font-weight: 700;
      border-top: 2px solid #1a5276;
    }

    .num { text-align: right; font-family: 'Courier New', monospace; white-space: nowrap; }

    /* 9 cols */
    table.rt col.c1 { width: 6%;  }
    table.rt col.c2 { width: 11%; }
    table.rt col.c3 { width: 9%;  }
    table.rt col.c4 { width: 10%; }
    table.rt col.c5 { width: 9%;  }
    table.rt col.c6 { width: 14%; }
    table.rt col.c7 { width: 11%; }
    table.rt col.c8 { width: 11%; }
    table.rt col.c9 { width: 12%; }

    .footer {
      margin-top: 12px;
      padding-top: 6px;
      border-top: 1px solid #d5d8dc;
      font-size: 10px;
      color: #777;
      text-align: center;
    }
    .no-print { margin-bottom: 10px; text-align: right; }
    .btn {
      padding: 7px 20px; background: #1a5276; color: #fff;
      border: none; border-radius: 4px; font-size: 12px;
      font-weight: 700; cursor: pointer;
    }
    .btn:hover { background: #154360; }

    @media print {
      body { background: #fff; padding: 0; }
      .page { box-shadow: none; margin: 0; border-radius: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>

<div class="no-print">
  <button class="btn" onclick="window.print()">Print / Save PDF</button>
</div>

<div class="page">
  <div class="header">
    <div class="logo-block">
      <div class="logo-arabic">المدينة اللوجستية</div>
      <div class="logo-name">al madina</div>
      <div class="logo-sub">L O G I S T I C S</div>
    </div>
    <div class="meta-block">
      <table>
        <tr><td class="lbl">Title :</td><td>${reportTitle}</td></tr>
        <tr><td class="lbl">Date :</td><td>${reportDate}</td></tr>
        <tr><td class="lbl">User :</td><td>${generatedBy}</td></tr>
        <tr><td class="lbl">Report :</td><td>${text(parameter)}</td></tr>
        <tr><td class="lbl">Currency :</td><td>OMR</td></tr>
      </table>
    </div>
    <div class="page-info">Page 1 of 1</div>
  </div>

  <table class="rt">
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
        <th>Bank</th>
        <th class="num">Debit</th>
        <th class="num">Credit</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${tableBodyHtml || '<tr><td colspan="9" style="text-align:center;padding:36px 0;color:#888;">No records found.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">Generated by ${generatedBy} &bull; ${reportDate}</div>
</div>

</body>
</html>`;
    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Account Payee Wise Report Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};