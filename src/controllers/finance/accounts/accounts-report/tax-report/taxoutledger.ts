import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../../middleware/tenantContext.middleware";

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
const formatBalance = (value: number) => {
  return value < 0 ? `(${money(Math.abs(value))})` : money(value);
};

export const getTaxInvoiceReport = async (req: Request, res: Response): Promise<void> => {
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
      parameter: parameter || "Account_Tax_Report_VAT_OUT_ACCOUNT_LEDGER_SUMMARY_REPORT",
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
    if (!rawSql) throw new Error("The procedure did not return a valid SQL query.");
    console.log("Generated SQL for Tax Invoice Report:", rawSql);

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // ── totals ──
    let totalInvAmount = 0;
    let totalTaxableInvAmt = 0;
    let totalTotInvAmount = 0;
    let totalTaxAmount = 0;

    let tableBodyHtml = "";

    rows.forEach((r) => {
      const invAmount     = Number(r.inv_amount)       || 0;
      const taxableInvAmt = Number(r.taxable_amt)  || 0;
      const totInvAmount  = Number(r.inv_amount)   || 0;
      const taxAmount     = Number(r.tax_amount)       || 0;

      totalInvAmount     += invAmount;
      totalTaxableInvAmt += taxableInvAmt;
      totalTotInvAmount  += totInvAmount;
      totalTaxAmount     += taxAmount;

      tableBodyHtml += `
        <tr class="data-row">
          <td style="text-align:center">${text(r.doc_type)}</td>
          <td>${text(r.doc_no)}</td>
          <td style="text-align:center">${formatDateStr(r.doc_date)}</td>
          <td>${text(r.ac_code)}</td>
          <td>${text(r.ac_name)}</td>
          <td>${text(r.ref_no)}</td>
          <td>${text(r.ref_date)}</td>
          <td>${text(r.trn_no)}</td>
          <td style="text-align:center">${text(r.country_code)}</td>
          <td style="text-align:center">${text(r.territory)}</td>
          <td style="text-align:center">${text(r.tax_code)}</td>
          <td>${text(r.tax_code_name)}</td>
          <td class="num">${formatBalance(invAmount)}</td>
          <td class="num">${formatBalance(taxableInvAmt)}</td>
          <td class="num">${formatBalance(totInvAmount)}</td>
          <td class="num">${formatBalance(taxAmount)}</td>
          <td>${text(r.origin_destination)}</td>
        </tr>`;
    });

    // ── summary row ──
    tableBodyHtml += `
      <tr class="grand-row">
        <td colspan="12" style="text-align:right"><strong>Total :</strong></td>
        <td class="num"><strong>${formatBalance(totalInvAmount)}</strong></td>
        <td class="num"><strong>${formatBalance(totalTaxableInvAmt)}</strong></td>
        <td class="num"><strong>${formatBalance(totalTotInvAmount)}</strong></td>
        <td class="num"><strong>${formatBalance(totalTaxAmount)}</strong></td>
        <td></td>
      </tr>`;

    const reportTitle = `Tax Register Report`;
    const generatedBy = text(loginid) || "Unknown User";
    const reportDate  = formatDateStr(new Date());

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
      font-size: 9.5px;
    }
    table.rt th {
      background: #1a5276;
      color: #fff;
      font-weight: 600;
      padding: 5px 4px;
      border: 1px solid #2471a3;
      text-align: center;
      line-height: 1.3;
    }
    table.rt td {
      border: 1px solid #d5d8dc;
      padding: 3px 4px;
      vertical-align: middle;
      word-break: break-word;
      overflow-wrap: break-word;
    }

    tr.data-row td { background: #fff; }
    tr.data-row:nth-child(even) td { background: #f8fafc; }
    tr.data-row:hover td { background: #eaf2fb; }

    tr.grand-row td {
      background: #d4e6f1;
      font-weight: 700;
      border-top: 2px solid #1a5276;
      color: #1a3c6e;
      font-size: 10px;
    }

    .num { text-align: right; font-family: 'Courier New', monospace; white-space: nowrap; }

    /* 17 cols */
    table.rt col.c1  { width: 4%;  }
    table.rt col.c2  { width: 10%;  }
    table.rt col.c3  { width: 8%;  }
    table.rt col.c4  { width: 8%;  }
    table.rt col.c5  { width: 10%; }
    table.rt col.c6  { width: 10%;  }
    table.rt col.c7  { width: 10%;  }
    table.rt col.c8  { width: 10%;  }
    table.rt col.c9  { width: 10%;  }
    table.rt col.c10 { width: 10%;  }
    table.rt col.c11 { width: 10%;  }
    table.rt col.c12 { width: 10%;  }
    table.rt col.c13 { width: 10%;  }
    table.rt col.c14 { width: 15%;  }
    table.rt col.c15 { width: 15%;  }
    table.rt col.c16 { width: 10%; }

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
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; break-inside: avoid; }
      tr.grand-row { page-break-inside: avoid; break-inside: avoid; }
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
      <col class="c1"/><col class="c2"/><col class="c3"/><col class="c4"/>
      <col class="c5"/><col class="c6"/><col class="c7"/><col class="c8"/>
      <col class="c9"/><col class="c10"/><col class="c11"/><col class="c12"/>
      <col class="c13"/><col class="c14"/><col class="c15"/><col class="c16"/>
    </colgroup>
    <thead>
      <tr>
        <th>Doc<br/>Type</th>
        <th>Doc No</th>
        <th>Doc Date</th>
        <th>Ac Code</th>
        <th>Ac Name</th>
        <th>Invoice /<br/>Ref No</th>
        <th>Ref Date</th>
        <th>Tax Reg. No.</th>
        <th>Country</th>
        <th>Territory</th>
        <th>Tax<br/>Code</th>
        <th>Tax<br/>Description</th>
        <th class="num">Invoice<br/>Amount</th>
        <th class="num">Taxable Invoice<br/>Amount</th>
        <th class="num">Total Invoice<br/>Amount</th>
        <th class="num">Tax<br/>Amount</th>
       
      </tr>
    </thead>
    <tbody>
      ${tableBodyHtml || '<tr><td colspan="17" style="text-align:center;padding:36px 0;color:#888;">No records found for the selected criteria.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">Generated by ${generatedBy} &bull; ${reportDate}</div>
</div>

</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Tax Invoice Report Error:", error);
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