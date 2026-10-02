import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { escapeHtml } from "../../../purchase_sales/report/common/formatters";
import { buildReportDocument, reportFooter, reportHeader } from "../../../common/report_common";
import { RequestWithUser } from "../../../../interfaces/common.interface";

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
const formatBalance = (value: number) =>
  value < 0 ? `(${money(Math.abs(value))})` : money(value);

const EXTRA_CSS = `
  @page { size: A4 landscape; margin: 8mm; }
  .paper { max-width: 297mm; }
  .report-title-strip {
    background: #1e3a5f; color: #fff; font-size: 12px; font-weight: 700;
    padding: 6px 10px; margin: 0 0 10px 0; border-radius: 3px;
  }
  table.statement-table {
    table-layout: fixed !important; width: 100% !important; max-width: 100% !important;
    border-collapse: collapse; border: 1px solid #cbd5e1;
  }
  table.statement-table thead th {
    background: #1e3a5f; color: #fff; font-size: 9px; font-weight: 700;
    padding: 5px 3px; border: 1px solid #0f2744; white-space: nowrap; text-align: center;
  }
  table.statement-table thead th.num { text-align: right; }
  table.statement-table thead th.left { text-align: left; }
  table.statement-table tbody td {
    padding: 3px 3px; font-size: 9.5px; border: 1px solid #e2e8f0; vertical-align: middle;
  }
  table.statement-table td.wrap {
    white-space: normal !important; overflow-wrap: anywhere; word-break: break-word;
  }
  table.statement-table td.num {
    text-align: right; white-space: nowrap !important; font-variant-numeric: tabular-nums; overflow: visible;
  }
  table.statement-table td.center { text-align: center; white-space: nowrap; }
  table.statement-table tbody tr:nth-child(even) td { background: #f8fafc; }
  table.statement-table tbody tr.l4-header td {
    background: #e2e8f0 !important; font-weight: 800; border-top: 1.5px solid #475569; padding: 6px 8px;
  }
  table.statement-table tbody tr.l4-total-row td {
    background: #f1f5f9 !important; font-weight: 800; border-top: 1.5px solid #475569; border-bottom: 2px solid #475569;
  }
  table.statement-table tbody tr.grand-total-row td {
    background: #e0f2fe !important; font-weight: 800; border-top: 2.5px double #0f172a; border-bottom: 2.5px double #0f172a;
  }
  .empty { padding: 32px; text-align: center; color: #64748b; font-size: 13px; }
  @media print {
    table.statement-table thead th { background: #1e3a5f !important; color: #fff !important; }
    table.statement-table tbody tr { break-inside: avoid; }
  }
`;

export const InvdatewiseSummary = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const {
      loginid,
      code1, code2, code3, code4, code5, code6,
      code7, code8, code9, code10, code11, code12, code13, code14,
      code15, code16,
    } = req.body;

    const parameter = "Account_Report_VW_PERIODWISE_INV_SUMMARY";

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
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
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    const ageLabels = ["Below 30", "30 - 60", "60 - 90", "90 - 120", "120 - 160", "160 - 200", "Above 200"];

    type SummaryRow = (typeof rows)[0];
    type L4Group = { l4_code: string; l4_description: string; rows: SummaryRow[] };
    const l4Map = new Map<string, L4Group>();
    rows.forEach((r) => {
      const l4Key = text(r.l4_code);
      if (!l4Map.has(l4Key)) {
        l4Map.set(l4Key, { l4_code: l4Key, l4_description: text(r.l4_description), rows: [] });
      }
      l4Map.get(l4Key)!.rows.push(r);
    });

    let tableBodyHtml = "";
    let grandUnalloc = 0;
    let grand30 = 0, grand60 = 0, grand90 = 0, grand120 = 0, grand160 = 0, grand200 = 0, grandAbove = 0;
    let grandTotal = 0;

    l4Map.forEach((l4) => {
      tableBodyHtml += `
        <tr class="l4-header">
          <td colspan="14" class="wrap"><strong>${escapeHtml(l4.l4_code)}&nbsp;&nbsp;${escapeHtml(l4.l4_description)}</strong></td>
        </tr>`;

      let l4Unalloc = 0;
      let l430 = 0, l460 = 0, l490 = 0, l4120 = 0, l4160 = 0, l4200 = 0, l4Above = 0, l4Total = 0;

      l4.rows.forEach((r) => {
        const unalloc = num(r.un_allocated_amt);
        const a30 = num(r.age_30), a60 = num(r.age_60), a90 = num(r.age_90);
        const a120 = num(r.age_120), a160 = num(r.age_160), a200 = num(r.age_200);
        const aAbove = num(r.age_above);
        const rowTotal = a30 + a60 + a90 + a120 + a160 + a200 + aAbove;

        l4Unalloc += unalloc;
        l430 += a30; l460 += a60; l490 += a90; l4120 += a120; l4160 += a160; l4200 += a200; l4Above += aAbove;
        l4Total += rowTotal;

        tableBodyHtml += `
          <tr>
            <td class="wrap">
              <strong>${escapeHtml(text(r.ac_code))}</strong> ${escapeHtml(text(r.ac_name))}
            </td>
            <td class="wrap">${escapeHtml(text(r.salesman_name))}</td>
            <td class="center">${escapeHtml(text(r.dept_code))}</td>
            <td class="num">${formatBalance(num(r.credit_amount))}</td>
            <td class="center">${escapeHtml(text(r.credit_period))}</td>
            <td class="num">${formatBalance(unalloc)}</td>
            <td class="num">${formatBalance(a30)}</td>
            <td class="num">${formatBalance(a60)}</td>
            <td class="num">${formatBalance(a90)}</td>
            <td class="num">${formatBalance(a120)}</td>
            <td class="num">${formatBalance(a160)}</td>
            <td class="num">${formatBalance(a200)}</td>
            <td class="num">${formatBalance(aAbove)}</td>
            <td class="num">${formatBalance(rowTotal)}</td>
          </tr>`;
      });

      tableBodyHtml += `
        <tr class="l4-total-row">
          <td colspan="5" class="wrap"><strong>Total for ${escapeHtml(l4.l4_description)}</strong></td>
          <td class="num"><strong>${formatBalance(l4Unalloc)}</strong></td>
          <td class="num"><strong>${formatBalance(l430)}</strong></td>
          <td class="num"><strong>${formatBalance(l460)}</strong></td>
          <td class="num"><strong>${formatBalance(l490)}</strong></td>
          <td class="num"><strong>${formatBalance(l4120)}</strong></td>
          <td class="num"><strong>${formatBalance(l4160)}</strong></td>
          <td class="num"><strong>${formatBalance(l4200)}</strong></td>
          <td class="num"><strong>${formatBalance(l4Above)}</strong></td>
          <td class="num"><strong>${formatBalance(l4Total)}</strong></td>
        </tr>
        <tr><td colspan="14" style="height:8px;border:none;background:transparent;"></td></tr>`;

      grandUnalloc += l4Unalloc;
      grand30 += l430; grand60 += l460; grand90 += l490; grand120 += l4120; grand160 += l4160; grand200 += l4200; grandAbove += l4Above;
      grandTotal += l4Total;
    });

    tableBodyHtml += `
      <tr class="grand-total-row">
        <td colspan="5" class="wrap"><strong>Grand Total :</strong></td>
        <td class="num"><strong>${formatBalance(grandUnalloc)}</strong></td>
        <td class="num"><strong>${formatBalance(grand30)}</strong></td>
        <td class="num"><strong>${formatBalance(grand60)}</strong></td>
        <td class="num"><strong>${formatBalance(grand90)}</strong></td>
        <td class="num"><strong>${formatBalance(grand120)}</strong></td>
        <td class="num"><strong>${formatBalance(grand160)}</strong></td>
        <td class="num"><strong>${formatBalance(grand200)}</strong></td>
        <td class="num"><strong>${formatBalance(grandAbove)}</strong></td>
        <td class="num"><strong>${formatBalance(grandTotal)}</strong></td>
      </tr>`;

    const ageHeaderCells = ageLabels.map((lbl) => `<th class="num">${lbl}</th>`).join("");
    const dateTypeLabel = text(code7) === "due" ? "Due Date Wise" : "INV Date Wise";

    const headerHtml = await reportHeader({
      company_code: text(code1),
      req: req as RequestWithUser,
    });

    const bodyHtml =
      rows.length === 0
        ? `<div class="empty">No records found.</div>`
        : `
        <div class="report-title-strip">
          Ageing as on ${escapeHtml(text(code6))}
          &nbsp;|&nbsp; Division: ${escapeHtml(text(code2) || "All")}
          &nbsp;|&nbsp; ${escapeHtml(dateTypeLabel)}
          &nbsp;|&nbsp; Summary
        </div>
        <table class="data-table statement-table">
          <colgroup>
            <col style="width: 16%" />
            <col style="width: 9%" />
            <col style="width: 5%" />
            <col style="width: 7%" />
            <col style="width: 6%" />
            <col style="width: 8%" />
            <col style="width: 6%" />
            <col style="width: 6%" />
            <col style="width: 6%" />
            <col style="width: 6%" />
            <col style="width: 6%" />
            <col style="width: 6%" />
            <col style="width: 6%" />
            <col style="width: 7%" />
          </colgroup>
          <thead>
            <tr>
              <th class="left">A/C Code</th>
              <th class="left">Salesperson</th>
              <th>Dept.</th>
              <th class="num">Credit Limit</th>
              <th>Credit Period</th>
              <th class="num">Un-Allocated</th>
              ${ageHeaderCells}
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>${tableBodyHtml}</tbody>
        </table>`;

    const footerHtml = reportFooter({
      reportName: "Period Wise Summary",
      userName: text(loginid),
      endLabel: "End of report",
    });

    const reportHtml = buildReportDocument({
      title: "Period Wise Summary Report",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("Inv Date Wise Summary Report Error:", error);
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