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

    const reportTitle = `Account Payee Wise Report ${text(code5)} - ${text(code6)}`;
    const generatedBy = text(loginid) || "Unknown User";
    const reportDate = formatDateStr(new Date());

    let tableBodyHtml = "";
    let grandTotalDebit = 0, grandTotalCredit = 0;
    const formatBalance = (value: number) => {
      return value < 0
        ? `(${money(Math.abs(value))})`
        : money(value);
    };

    Object.entries(groups).forEach(([key, groupRows]) => {
      const [ac_code, ac_name] = key.split("||");
      const opening = Number(groupRows[0]?.op_balance) || 0;
      let totalDebit = 0, totalCredit = 0;
      let runningBalance = opening;

      tableBodyHtml += `
        <tr class="group-header">
          <td colspan="8"><strong>Account: ${text(ac_code)} - ${text(ac_name)}</strong></td>
          <td class="num opening-val"><strong>Opening</strong></td>
          <td class="num opening-val"><strong>${money(opening)}</strong></td>
        </tr>`;

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

      grandTotalDebit += totalDebit;
      grandTotalCredit += totalCredit;
      const closing = opening + totalDebit - totalCredit;

      tableBodyHtml += `
        <tr class="total-row">
          <td colspan="6" class="num"><strong>Total :</strong></td>
          <td class="num"><strong>${money(totalDebit)}</strong></td>
          <td class="num"><strong>${money(totalCredit)}</strong></td>
          <td colspan="2"></td>
        </tr>
        <tr class="closing-row">
          <td colspan="8" class="num"><strong>Closing</strong></td>
          <td class="num" colspan="2"><strong>${money(closing)}</strong></td>
        </tr>`;
    });

    tableBodyHtml += `
      <tr class="grand-total-row">
        <td colspan="6" class="num"><strong>Grand Total :</strong></td>
        <td class="num"><strong>${money(grandTotalDebit)}</strong></td>
        <td class="num"><strong>${money(grandTotalCredit)}</strong></td>
        <td colspan="2"></td>
      </tr>`;

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

@page {
    size: A4 portrait;
    margin: 8mm;
}

body {
    margin: 0;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: #f2f4f7;
    color: #1f2937;
}

.page {
    width: auto;
    max-width: 100%;
    margin: 10px auto;
    padding: 12px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
    box-sizing: border-box;
}

.header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    border-bottom: 1px solid #d1d5db;
    padding-bottom: 8px;
    margin-bottom: 10px;
}

.meta-info {
    border-collapse: collapse;
}

.meta-info td {
    padding: 2px 6px;
    vertical-align: top;
    font-size: 12px;
}

.label {
    font-weight: 700;
    width: 90px;
    color: #475569;
    white-space: nowrap;
}

.report-title {
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 4px;
}

.brand-block {
    text-align: right;
}

.brand-name {
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #0d4d89;
}

.brand-subtitle {
    font-size: 12px;
    letter-spacing: 0.12em;
    color: #334155;
}

.report-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: auto;
}

.report-table th,
.report-table td {
    padding: 5px 6px;
    border: 1px solid #e2e8f0;
    font-size: 11px;
    word-break: break-word;
    white-space: normal;
}

.report-table th {
    background: #f8fafc;
    color: #334155;
    font-weight: 700;
    text-transform: uppercase;
}

.group-header td {
    background: #eff6ff;
    font-weight: 700;
    color: #1e3a8a;
}

.sub-group-header td {
    background: #f8fafc;
    font-weight: 700;
}

.opening-val {
    color: #c00;
}

.total-row td {
    background: #f8fafc;
    font-weight: 700;
}

.closing-row td {
    background: #f8fafc;
    font-weight: 700;
}

.grand-total-row td {
    background: #f8fafc;
    font-weight: 700;
}

.num {
    text-align: right;
    font-family: 'Courier New', monospace;
}

.footer {
    margin-top: 12px;
    text-align: center;
    font-size: 11px;
    border-top: 1px solid #e2e8f0;
    padding-top: 5px;
}

.no-print {
    margin-bottom: 10px;
    text-align: right;
}

.button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 16px;
    border-radius: 999px;
    border: none;
    background: #2563eb;
    color: white;
    font-weight: 700;
    cursor: pointer;
}

.button:hover {
    background: #1d4ed8;
}

@media print {

    body {
        background: white;
        min-width: 0;
    }

    .page {
        width: auto !important;
        max-width: 100% !important;
        margin: 0;
        padding: 5mm;
        box-shadow: none;
        border-radius: 0;
    }

    .no-print {
        display: none;
    }

    thead {
        display: table-header-group;
    }

    tfoot {
        display: table-footer-group;
    }

    table {
        table-layout: auto;
        page-break-inside: auto;
    }

    .report-table th,
    .report-table td {
        word-break: break-word;
        white-space: normal;
    }

    tr {
        page-break-inside: avoid;
        break-inside: avoid;
    }

    .group-header,
    .sub-group-header,
    .total-row,
    .closing-row,
    .grand-total-row {
        page-break-inside: avoid;
        break-inside: avoid;
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
                <th>Type</th>
                <th>Doc No.</th>
                <th>Doc Date</th>
                <th>Chq No.</th>
                <th>Chq Date</th>
                <th>Bank</th>
                <th class="num">Credit</th>
                <th class="num">Debit</th>
                <th class="num">Balance</th>
              </tr>
            </thead>
            <tbody>${tableBodyHtml || '<tr><td colspan="10" style="text-align:center;padding:36px 0;">No records found for the selected criteria.</td></tr>'}</tbody>
          </table>

          <div class="footer">Generated by ${generatedBy} • ${reportDate}</div>
        </div>
      </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Account Payee Wise Report Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};