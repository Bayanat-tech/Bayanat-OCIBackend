import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import { buildReportDocument, reportFooter, reportHeader } from "../../../common/report_common";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const money = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.000";
  return n.toLocaleString("en-US", {
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

const num = (v: any) => Number(v) || 0;

const formatBalance = (value: number) =>
  value < 0 ? `(${money(Math.abs(value))})` : money(value);

/** Extra CSS only for this report’s row types / title strip */
/** Extra CSS only for this report’s row types / title strip + landscape */
const INV_DATEWISE_EXTRA_CSS = `
  /* Landscape override (COMMON_REPORT_CSS uses portrait A4) */
  @page {
    size: A4 landscape;
    margin: 10mm;
  }
  .paper {
    max-width: 297mm; /* A4 landscape width */
  }
  @media print {
    .paper {
      max-width: none;
    }
  }

  .report-title-strip {
    background: #0b4ca1;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    padding: 6px 10px;
    margin: 0 0 10px 0;
    border-radius: 3px;
  }
  .report-meta {
    font-size: 11px;
    color: #334155;
    margin-bottom: 8px;
  }
  .report-meta strong { color: #0f172a; }
  table.data-table th {
    white-space: nowrap;
    text-transform: uppercase;
    font-size: 10px;
  }
  .l4-header td {
    background: #e2e8f0;
    border-top: 1.5px solid #475569;
    border-bottom: 1px solid #94a3b8;
    padding: 6px 8px;
    font-size: 12px;
    font-weight: 800;
  }
  .ac-header td {
    background: #f8fafc;
    border-bottom: 1px dashed #cbd5e1;
    padding: 5px 8px;
  }
  .credit-info {
    font-size: 10px;
    color: #64748b;
    margin-left: 16px;
    font-weight: 500;
  }
  .detail-row td {
    padding-left: 4px;
  }
  .detail-row td:first-child {
    padding-left: 18px;
  }
  .ac-total-row td {
    border-top: 1px solid #94a3b8;
    border-bottom: 2px solid #94a3b8;
    background: #f8fafc;
    font-weight: 700;
  }
  .l4-total-row td {
    border-top: 1.5px solid #475569;
    border-bottom: 2px solid #475569;
    background: #f1f5f9;
    font-weight: 800;
  }
  .grand-total-row td {
    border-top: 2.5px double #0f172a;
    border-bottom: 2.5px double #0f172a;
    background: #e0f2fe;
    padding: 6px 5px;
    font-size: 11px;
    font-weight: 800;
  }
  .spacer-row td {
    height: 10px;
    border: none !important;
    background: transparent;
  }
`;

// ─── Controller ───────────────────────────────────────────────────────────────
export const InvdatewiseDetail = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;
  try {
    const {
      loginid,
      code1, code2, code3, code4, code5, code6,
      code7, code8, code9, code10, code11, code12, code13, code14,
      code15, code16,
    } = req.body;

    const parameter = "Account_Report_VW_PERIODWISE_INV_DETAIL";
    const companyCode = text(code1);

    // Tenant / connection
    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) {
      tenantId = await TenantManager.getTenantForUser(loginid);
    }
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    // Procedure binds
    const binds: any = {
      parameter,
      loginid: loginid || "ADMIN",
      code1: code1 || null,
      code2: code2 || null,
      code3: code3 || null,
      code4: code4 || null,
      code5: code5 || null,
      code6: code6 || null,
      code7: code7 || null,
      code8: code8 || null,
      code9: code9 || null,
      code10: code10 || null,
      code11: code11 || null,
      code12: code12 || null,
      code13: code13 || null,
      code14: code14 || null,
      code15: code15 || null,
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

    const dataResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows = ((dataResult.rows as any[]) || []).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // Age bucket labels
    const ageLabels = [
      "Below 30",
      "30 - 60",
      "60 - 90",
      "90 - 120",
      "120 - 160",
      "160 - 200",
      "Above 200",
    ];

    // Group: l4 → account → detail rows
    type DetailRow = (typeof rows)[0];
    type AccGroup = {
      ac_code: string;
      ac_name: string;
      credit_period: string;
      credit_amount: string;
      rows: DetailRow[];
    };
    type L4Group = {
      l4_code: string;
      l4_description: string;
      accounts: Map<string, AccGroup>;
    };

    const l4Map = new Map<string, L4Group>();
    rows.forEach((r) => {
      const l4Key = text(r.l4_code);
      const l4Desc = text(r.l4_description);
      const acKey = text(r.ac_code);
      if (!l4Map.has(l4Key)) {
        l4Map.set(l4Key, {
          l4_code: l4Key,
          l4_description: l4Desc,
          accounts: new Map(),
        });
      }
      const l4 = l4Map.get(l4Key)!;
      if (!l4.accounts.has(acKey)) {
        l4.accounts.set(acKey, {
          ac_code: acKey,
          ac_name: text(r.ac_name),
          credit_period: text(r.credit_period || "0.00"),
          credit_amount: text(r.credit_amount || ""),
          rows: [],
        });
      }
      l4.accounts.get(acKey)!.rows.push(r);
    });

    // Build table body
    let tableBodyHtml = "";
    let grandOrgAmt = 0;
    let grandUnalloc = 0;
    let grand30 = 0,
      grand60 = 0,
      grand90 = 0,
      grand120 = 0,
      grand160 = 0,
      grand200 = 0,
      grandAbove = 0;
    let grandTotal = 0;

    l4Map.forEach((l4) => {
      tableBodyHtml += `
        <tr class="l4-header">
          <td colspan="13">
            <strong>${text(l4.l4_code)}&nbsp;&nbsp;${text(l4.l4_description)}</strong>
          </td>
        </tr>`;

      let l4OrgAmt = 0,
        l4Unalloc = 0;
      let l430 = 0,
        l460 = 0,
        l490 = 0,
        l4120 = 0,
        l4160 = 0,
        l4200 = 0,
        l4Above = 0;
      let l4Total = 0;

      l4.accounts.forEach((ac) => {
        tableBodyHtml += `
          <tr class="ac-header">
            <td colspan="13">
              <strong>${text(ac.ac_code)}&nbsp;&nbsp;${text(ac.ac_name)}</strong>
              <span class="credit-info">
                Credit Period : ${text(ac.credit_period)} &nbsp;&nbsp;
                Credit Limit : ${text(ac.credit_amount)}
              </span>
            </td>
          </tr>`;

        let acOrgAmt = 0,
          acUnalloc = 0;
        let ac30 = 0,
          ac60 = 0,
          ac90 = 0,
          ac120 = 0,
          ac160 = 0,
          ac200 = 0,
          acAbove = 0;
        let acTotal = 0;

        ac.rows.forEach((r) => {
          const orgAmt = num(r.org_amt);
          const unalloc = num(r.un_allocated_amt);
          const a30 = num(r.age_30);
          const a60 = num(r.age_60);
          const a90 = num(r.age_90);
          const a120 = num(r.age_120);
          const a160 = num(r.age_160);
          const a200 = num(r.age_200);
          const aAbove = num(r.age_above);
          const rowTotal = a30 + a60 + a90 + a120 + a160 + a200 + aAbove;

          acOrgAmt += orgAmt;
          acUnalloc += unalloc;
          ac30 += a30;
          ac60 += a60;
          ac90 += a90;
          ac120 += a120;
          ac160 += a160;
          ac200 += a200;
          acAbove += aAbove;
          acTotal += rowTotal;

          tableBodyHtml += `
            <tr class="detail-row">
              <td>${text(r.inv_no)}</td>
              <td class="num">${formatDateStr(r.inv_date)}</td>
              <td class="num">${formatBalance(orgAmt)}</td>
              <td class="num">${formatBalance(unalloc)}</td>
              <td class="num">${formatBalance(a30)}</td>
              <td class="num">${formatBalance(a60)}</td>
              <td class="num">${formatBalance(a90)}</td>
              <td class="num">${formatBalance(a120)}</td>
              <td class="num">${formatBalance(a160)}</td>
              <td class="num">${formatBalance(a200)}</td>
              <td class="num">${formatBalance(aAbove)}</td>
              <td class="num">${formatBalance(rowTotal)}</td>
              <td class="muted" style="font-size:10px;">${text(r.salesman_name)}</td>
            </tr>`;
        });

        tableBodyHtml += `
          <tr class="ac-total-row">
            <td><strong>Total for ${text(ac.ac_name)}</strong></td>
            <td></td>
            <td class="num"><strong>${formatBalance(acOrgAmt)}</strong></td>
            <td class="num"><strong>${formatBalance(acUnalloc)}</strong></td>
            <td class="num"><strong>${formatBalance(ac30)}</strong></td>
            <td class="num"><strong>${formatBalance(ac60)}</strong></td>
            <td class="num"><strong>${formatBalance(ac90)}</strong></td>
            <td class="num"><strong>${formatBalance(ac120)}</strong></td>
            <td class="num"><strong>${formatBalance(ac160)}</strong></td>
            <td class="num"><strong>${formatBalance(ac200)}</strong></td>
            <td class="num"><strong>${formatBalance(acAbove)}</strong></td>
            <td class="num"><strong>${formatBalance(acTotal)}</strong></td>
            <td></td>
          </tr>`;

        l4OrgAmt += acOrgAmt;
        l4Unalloc += acUnalloc;
        l430 += ac30;
        l460 += ac60;
        l490 += ac90;
        l4120 += ac120;
        l4160 += ac160;
        l4200 += ac200;
        l4Above += acAbove;
        l4Total += acTotal;
      });

      tableBodyHtml += `
        <tr class="l4-total-row">
          <td><strong>Total for ${text(l4.l4_description)}</strong></td>
          <td></td>
          <td class="num"><strong>${formatBalance(l4OrgAmt)}</strong></td>
          <td class="num"><strong>${formatBalance(l4Unalloc)}</strong></td>
          <td class="num"><strong>${formatBalance(l430)}</strong></td>
          <td class="num"><strong>${formatBalance(l460)}</strong></td>
          <td class="num"><strong>${formatBalance(l490)}</strong></td>
          <td class="num"><strong>${formatBalance(l4120)}</strong></td>
          <td class="num"><strong>${formatBalance(l4160)}</strong></td>
          <td class="num"><strong>${formatBalance(l4200)}</strong></td>
          <td class="num"><strong>${formatBalance(l4Above)}</strong></td>
          <td class="num"><strong>${formatBalance(l4Total)}</strong></td>
          <td></td>
        </tr>
        <tr class="spacer-row"><td colspan="13"></td></tr>`;

      grandOrgAmt += l4OrgAmt;
      grandUnalloc += l4Unalloc;
      grand30 += l430;
      grand60 += l460;
      grand90 += l490;
      grand120 += l4120;
      grand160 += l4160;
      grand200 += l4200;
      grandAbove += l4Above;
      grandTotal += l4Total;
    });

    tableBodyHtml += `
      <tr class="grand-total-row">
        <td><strong>Grand Total :</strong></td>
        <td></td>
        <td class="num"><strong>${formatBalance(grandOrgAmt)}</strong></td>
        <td class="num"><strong>${formatBalance(grandUnalloc)}</strong></td>
        <td class="num"><strong>${formatBalance(grand30)}</strong></td>
        <td class="num"><strong>${formatBalance(grand60)}</strong></td>
        <td class="num"><strong>${formatBalance(grand90)}</strong></td>
        <td class="num"><strong>${formatBalance(grand120)}</strong></td>
        <td class="num"><strong>${formatBalance(grand160)}</strong></td>
        <td class="num"><strong>${formatBalance(grand200)}</strong></td>
        <td class="num"><strong>${formatBalance(grandAbove)}</strong></td>
        <td class="num"><strong>${formatBalance(grandTotal)}</strong></td>
        <td></td>
      </tr>`;

    const ageHeaderCells = ageLabels
      .map((lbl) => `<th class="num" style="min-width:72px;">${lbl}</th>`)
      .join("");

    const dateTypeLabel = text(code7) === "due" ? "Due Date Wise" : "INV Date Wise";
    const optionLabel = text(code8) === "summary" ? "Summary" : "Detail";
    const asOn = text(code6) || "—";

    // Body: title strip + data table (uses common .data-table)
    const bodyHtml = `
      <div class="report-title-strip">
        Ageing as on ${asOn}
        &nbsp;|&nbsp; Division: ${text(code2) || "All"}
        &nbsp;|&nbsp; ${dateTypeLabel}
        &nbsp;|&nbsp; ${optionLabel}
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:130px; text-align:left;">A/C Code / Inv No</th>
            <th class="num" style="width:75px;">Inv Date</th>
            <th class="num" style="width:90px;">Inv Amount</th>
            <th class="num" style="width:90px;">Un-Allocated</th>
            ${ageHeaderCells}
            <th class="num" style="width:90px;">Total</th>
            <th style="width:80px; text-align:left;">Salesperson</th>
          </tr>
        </thead>
        <tbody>
          ${
            tableBodyHtml ||
            `<tr><td colspan="13" class="empty" style="padding:40px;">No records found for the selected criteria.</td></tr>`
          }
        </tbody>
      </table>
    `;

    // Shared header / footer / document shell
    const headerHtml = await reportHeader({
      company_code: companyCode,
      req: req as RequestWithUser,
    });

    const footerHtml = reportFooter({
      reportName: "Period Wise Ageing (Inv Detail)",
      userName: text(loginid),
      endLabel: "End of report",
    });

    const reportHtml = buildReportDocument({
      title: "Period Wise Ageing Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: INV_DATEWISE_EXTRA_CSS,
      showPrintButton: true,
      autoPrint: false,
    });

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("Period Wise Report Error:", error);
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