import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import {
  buildReportDocument,
  reportFooter,
  reportHeader,
} from "../../../common/report_common";

/* ── helpers ─────────────────────────────────────────────────────── */
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

const formatBalance = (value: number) =>
  value < 0 ? `(${money(Math.abs(value))})` : money(value);

/**
 * Report-specific CSS only.
 * Header, footer, data-table, print, zebra, shell → COMMON_REPORT_CSS.
 */
const LEDGER_DETAILS_EXTRA_CSS = `
  /* Wide report → landscape A4 */
  @page {
    size: A4 landscape;
    margin: 8mm 8mm 12mm 8mm;
  }

  .paper {
    max-width: 297mm;
  }

  /* Opening balance */
  .opening-label {
    color: #b91c1c;
    font-weight: 700;
    text-align: right;
  }
  .opening-val {
    color: #b91c1c;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* Account group header */
  tr.grp-hdr td {
    background: #e8f0fa !important;
    color: #0b4ca1;
    font-weight: 700;
    border-bottom: 2px solid #0b4ca1 !important;
    padding: 9px 8px;
  }

  /* PDC / NORMAL sub-group */
  tr.sub-grp-hdr td {
    background: #f1f5f9 !important;
    color: #334155;
    font-weight: 700;
    border-bottom: 1px solid #cbd5e1 !important;
    padding: 6px 8px;
  }

  /* Secondary thead row (Salesman / Ref) */
  table.data-table thead tr.sub-hdr th {
    background: #dbeafe !important;
    color: #0b4ca1;
    font-size: 10px;
    font-weight: 600;
    border-bottom: 1px solid #93c5fd !important;
    padding: 5px 8px;
  }

  /* Data + narration attachment */
  tr.data-row td {
    border-bottom: none !important;
  }
  tr.narration-row td {
    border-top: none !important;
    border-bottom: 1px solid #e2e8f0 !important;
    text-align: center;
    white-space: normal;
    font-style: italic;
    color: #64748b;
    font-size: 10px;
    background: #fff !important;
    padding-top: 2px;
    padding-bottom: 6px;
  }

  /* Salesman / Ref detail row under transaction */
  tr.narr-row td {
    border-top: none !important;
    border-bottom: 1px solid #e2e8f0 !important;
    font-style: italic;
    color: #64748b;
    font-size: 10px;
    background: #f8fafc !important;
    padding: 3px 8px;
  }

  /* Totals */
  tr.total-row td {
    background: #e8f0fa !important;
    font-weight: 700;
    color: #0b4ca1;
    border-top: 1.5px solid #0b4ca1 !important;
    border-bottom: none !important;
  }
  tr.closing-row td {
    background: #e8f0fa !important;
    font-weight: 700;
    color: #0b4ca1;
    border-bottom: 1px solid #cbd5e1 !important;
  }
  tr.grand-row td {
    background: #dbeafe !important;
    font-weight: 700;
    color: #0b4ca1;
    border-top: 2px solid #0b4ca1 !important;
  }

  td.dr-amt,
  td.cr-amt {
    color: #b45309;
  }

  /* 9 column widths */
  table.data-table col.c1 { width: 6%;  }
  table.data-table col.c2 { width: 11%; }
  table.data-table col.c3 { width: 9%;  }
  table.data-table col.c4 { width: 10%; }
  table.data-table col.c5 { width: 9%;  }
  table.data-table col.c6 { width: 14%; }
  table.data-table col.c7 { width: 11%; }
  table.data-table col.c8 { width: 11%; }
  table.data-table col.c9 { width: 12%; }
`;

export const getLedgerWithDetailsReport = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;
  try {
    const {
      parameter,
      loginid,
      code1,
      code2,
      code3,
      code4,
      code5,
      code6,
      code7,
      code8,
      code20,
    } = req.body;

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) {
      tenantId = await TenantManager.getTenantForUser(loginid);
    }
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const binds: any = {
      parameter: parameter || "Account_Report_Ledger_Details",
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
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    for (let i = 9; i <= 20; i++) {
      binds[`code${i}`] = req.body[`code${i}`] || null;
    }
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
    if (!rawSql) {
      throw new Error("The procedure did not return a valid SQL query.");
    }

    console.log("Generated SQL for Ledger With Details Report:", rawSql);

    const dataResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows = ((dataResult.rows as any[]) || []).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // Group by account
    const groups: Record<string, any[]> = {};
    rows.forEach((r) => {
      const key = `${r.ac_code}||${r.ac_name || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    let tableBodyHtml = "";
    let grandTotalDebit = 0;
    let grandTotalCredit = 0;

    Object.entries(groups).forEach(([key, groupRows]) => {
      const [ac_code, ac_name] = key.split("||");
      const opening = Number(groupRows[0]?.op_balance) || 0;
      let totalDebit = 0;
      let totalCredit = 0;
      let runningBalance = opening;

      // Account header + opening
      tableBodyHtml += `
        <tr class="grp-hdr">
          <td colspan="6"><strong>${text(ac_code)}</strong>&nbsp;&nbsp;${text(ac_name)}</td>
          <td class="opening-label">Opening</td>
          <td class="num opening-val" colspan="2">${formatBalance(opening)}</td>
        </tr>`;

      // PDC / NORMAL
      const pdcGroups: Record<string, any[]> = {};
      groupRows.forEach((r) => {
        const k = r.pdc_ind === "Y" ? "PDC" : "NORMAL";
        if (!pdcGroups[k]) pdcGroups[k] = [];
        pdcGroups[k].push(r);
      });

      Object.entries(pdcGroups).forEach(([pdcType, pdcRows]) => {
        tableBodyHtml += `
          <tr class="sub-grp-hdr">
            <td colspan="9">${pdcType === "PDC" ? "PDC CHEQUES" : "NORMAL CHEQUES"}</td>
          </tr>`;

        pdcRows.forEach((r) => {
          const amount = Number(r.lcur_amount) || 0;
          const dr = r.sign_ind > 0 ? amount : 0;
          const cr = r.sign_ind < 0 ? Math.abs(amount) : 0;
          totalDebit += dr;
          totalCredit += cr;
          runningBalance += dr - cr;

          const narration = text(r.narration || r.remarks || r.details || "").trim();
          const wrappedNarration =
            narration.match(/.{1,80}(\s|$)/g)?.join("<br/>") || narration;

          // Main data row (properly closed)
          tableBodyHtml += `
            <tr class="data-row">
              <td>${text(r.doc_type || "")}</td>
              <td>${text(r.doc_no || "")}</td>
              <td class="center">${formatDateStr(r.doc_date)}</td>
              <td>${text(r.cheque_no || "")}</td>
              <td class="center">${formatDateStr(r.cheque_date)}</td>
              <td>${text(r.bank || "")}</td>
              <td class="num dr-amt">${money(dr)}</td>
              <td class="num cr-amt">${money(cr)}</td>
              <td class="num">${formatBalance(runningBalance)}</td>
            </tr>`;

          // Narration as its own row (fixed broken nesting from original)
          if (narration) {
            tableBodyHtml += `
              <tr class="narration-row">
                <td colspan="9">${wrappedNarration}</td>
              </tr>`;
          }

          // Salesman / Ref account detail row
          if (r.salesman_code || r.salesman_name || r.ref_ac_code || r.ref_ac_name) {
            tableBodyHtml += `
              <tr class="narr-row">
                <td colspan="2">${text(r.salesman_code || "")} ${text(r.salesman_name || "")}</td>
                <td colspan="4">${text(r.ref_ac_code || "")} ${text(r.ref_ac_name || "")}</td>
                <td colspan="3"></td>
              </tr>`;
          }
        });
      });

      grandTotalDebit += totalDebit;
      grandTotalCredit += totalCredit;
      const closing = opening + totalDebit - totalCredit;

      tableBodyHtml += `
        <tr class="total-row">
          <td colspan="6" class="right"><strong>Total :</strong></td>
          <td class="num"><strong>${money(totalDebit)}</strong></td>
          <td class="num"><strong>${money(totalCredit)}</strong></td>
          <td></td>
        </tr>
        <tr class="closing-row">
          <td colspan="7" class="right"><strong>Closing</strong></td>
          <td class="num" colspan="2"><strong>${formatBalance(closing)}</strong></td>
        </tr>`;
    });

    tableBodyHtml += `
      <tr class="grand-row">
        <td colspan="6" class="right"><strong>Grand Total :</strong></td>
        <td class="num"><strong>${money(grandTotalDebit)}</strong></td>
        <td class="num"><strong>${money(grandTotalCredit)}</strong></td>
        <td></td>
      </tr>`;

    const reportTitle = `Ledger With Details Report ${text(code5)} - ${text(code6)}`;
    const generatedBy = text(loginid) || "Unknown User";

    const headerHtml = await reportHeader({
      company_code: text(req.body.company_code || code1 || ""),
      req: req as any,
    });

    const footerHtml = reportFooter({
      reportName: "Ledger With Details Report",
      userName: generatedBy,
    });

    const bodyHtml = `
      <div class="report-title">${reportTitle}</div>
      <div class="section-strip">
        Date: ${formatDateStr(new Date())}
        &nbsp;|&nbsp; User: ${generatedBy}
        &nbsp;|&nbsp; Currency: OMR
        ${parameter ? `&nbsp;|&nbsp; Report: ${text(parameter)}` : ""}
      </div>
      <table class="data-table">
        <colgroup>
          <col class="c1"/><col class="c2"/><col class="c3"/>
          <col class="c4"/><col class="c5"/><col class="c6"/>
          <col class="c7"/><col class="c8"/><col class="c9"/>
        </colgroup>
        <thead>
          <tr>
            <th class="left">Type</th>
            <th class="left">Doc No.</th>
            <th>Doc Date</th>
            <th class="left">Chq No.</th>
            <th>Chq Date</th>
            <th class="left">Bank</th>
            <th class="num">Debit</th>
            <th class="num">Credit</th>
            <th class="num">Balance</th>
          </tr>
          <tr class="sub-hdr">
            <th colspan="2">Salesman Code/Name</th>
            <th colspan="4">Ref Ac Code/Name</th>
            <th colspan="3"></th>
          </tr>
        </thead>
        <tbody>
          ${
            tableBodyHtml ||
            `<tr><td colspan="9" class="muted center" style="padding:36px 0;">No records found.</td></tr>`
          }
        </tbody>
      </table>`;

    const reportHtml = buildReportDocument({
      title: reportTitle,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: LEDGER_DETAILS_EXTRA_CSS,
      showPrintButton: false,
    });

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("Ledger With Details Report Error:", error);
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
        console.error(e);
      }
    }
  }
};