import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { escapeHtml } from "../../../purchase_sales/report/common/formatters";
import { buildReportDocument, reportFooter, reportHeader } from "../../../common/report_common";
import { RequestWithUser } from "../../../../interfaces/common.interface";

/* ───────────────────────── helpers ───────────────────────── */
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

const moneyBalance = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.000";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return n < 0 ? `(${abs})` : abs;
};

/* ───────────────────────── Extra CSS (aligned with Detail) ───────────────────────── */
const EXTRA_CSS = `
  /* ── Title / Currency banner ── */
  .report-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 0 10px;
    margin-bottom: 12px;
    border-bottom: 2px solid #1e3a5f;
  }
  .report-meta .meta-title {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #1e3a5f;
    letter-spacing: 0.2px;
  }
  .report-meta .currency-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    color: #1e3a5f;
    white-space: nowrap;
  }
  .report-meta .currency-pill .curr-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
  }

  /* ── Summary table – NEVER overflows ── */
  table.statement-table {
    table-layout: fixed !important;
    width: 100% !important;
    max-width: 100% !important;
    margin-top: 4px;
    border-collapse: collapse;
    border: 1px solid #cbd5e1;
    box-sizing: border-box;
  }
  table.statement-table * {
    box-sizing: border-box;
  }
  table.statement-table thead th {
    background: #1e3a5f;
    color: #ffffff;
    font-size: 9.5px;
    font-weight: 700;
    padding: 6px 4px;
    border: 1px solid #0f2744;
    white-space: nowrap;
    text-align: center;
    overflow: hidden;
  }
  table.statement-table thead th.left { text-align: left; }
  table.statement-table thead th.num  { text-align: right; }

  table.statement-table tbody td {
    padding: 4px 4px;
    font-size: 10px;
    border: 1px solid #e2e8f0;
    vertical-align: middle;
    overflow: hidden;
  }

  table.statement-table td.wrap {
    white-space: normal !important;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.35;
  }

  table.statement-table td.num {
    text-align: right;
    white-space: nowrap !important;
    font-variant-numeric: tabular-nums;
    overflow: visible;
  }
  table.statement-table td.center {
    text-align: center;
    white-space: nowrap;
  }
  table.statement-table .neg-balance {
    color: #b91c1c;
    font-weight: 600;
  }
  table.statement-table tbody tr:nth-child(even) td { background: #f8fafc; }

  /* Grand total row */
  table.statement-table tbody tr.grand-total-row td {
    background: #e8f0fb !important;
    border-top: 2px solid #1e3a5f;
    border-bottom: 2px solid #1e3a5f;
    font-weight: 700;
    padding: 6px 4px;
  }

  /* Empty state */
  .empty {
    padding: 32px;
    text-align: center;
    color: #64748b;
    font-size: 13px;
  }

  /* ── Print safety ── */
  @media print {
    .report-meta, .currency-pill {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    table.statement-table {
      width: 100% !important;
      max-width: 100% !important;
    }
    table.statement-table thead th {
      background: #1e3a5f !important;
      color: #fff !important;
    }
    table.statement-table tbody tr { break-inside: avoid; }
  }
`;

/* ───────────────────────── Controller ───────────────────────── */
export const OutstandingSummaryReport = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;
  try {
    /*
     * Frontend sends:
     *   loginid       → loginid
     *   company_code  → code1
     *   division      → code2   ("All" or div_code)
     *   ac_codes      → code3   (comma-sep or "All")
     *   l4_codes      → code4   (comma-sep or "All")
     *   curr_code     → code5
     *   as_on_date    → code6   e.g. "11-JUN-2026" (DD-MON-YYYY)
     *
     * Procedure: "Account_Report_Outstanding_Summary"
     *
     * SQL returns (per ac_code — no inv_no grouping):
     *   company_code, ac_code, ac_name,
     *   cr_period, cr_amt, amount,
     *   div_code, master_ex_rate,
     *   company_name, address1..3, etc.
     */

    const {
      loginid,
      code1, code2, code3, code4, code5, code6,
      code7, code8, code9, code10, code11, code12,
      code13, code14, code15, code16,
    } = req.body;

    const parameter = "Account_Report_Outstanding_Summary";

    // ── Tenant / connection ───────────────────────────────────────────
    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) {
      tenantId = await TenantManager.getTenantForUser(loginid);
    }
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    // ── Binds ─────────────────────────────────────────────────────────
    const binds: any = {
      parameter,
      loginid: loginid || "ADMIN",
      code1:  code1  || null,
      code2:  code2  || null,
      code3:  code3  || null,
      code4:  code4  || null,
      code5:  code5  || null,
      code6:  code6  || null,
      code7:  code7  || null,
      code8:  code8  || null,
      code9:  code9  || null,
      code10: code10 || null,
      code11: code11 || null,
      code12: code12 || null,
      code13: code13 || null,
      code14: code14 || null,
      code15: code15 || null,
      code16: code16 || null,
      code17: null, code18: null, code19: null, code20: null,
      number1: null, number2: null, number3: null, number4: null,
      date1: null,   date2: null,   date3: null,   date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    // ── Execute procedure → dynamic SQL ───────────────────────────────
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

    // ── Execute dynamic SQL ───────────────────────────────────────────
    const dataResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    console.log("rawsql------======:", rawSql);

    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // ── Currency & as-on date ─────────────────────────────────────────
    const currCode = escapeHtml(text(code5) || "OMR");
    const asOnDate = escapeHtml(formatDateStr(code6) || text(code6));

    // ── Shared company header ─────────────────────────────────────────
    const headerHtml = await reportHeader({
      company_code: text(code1),
      req: req as RequestWithUser,
    });

    // ── Grand total ───────────────────────────────────────────────────
    let grandDebit = 0;
    let grandCredit = 0;
    let grandBalance = 0;

    // ── Build table body ──────────────────────────────────────────────
    // Summary = one row per ac_code (SP already grouped, no inv_no)
    let tableBodyHtml = "";

    rows.forEach((r) => {
      const amount = num(r.amount);
      const debit = amount > 0 ? amount : 0;
      const credit = amount < 0 ? Math.abs(amount) : 0;
      const balance = debit - credit;

      grandDebit += debit;
      grandCredit += credit;
      grandBalance += balance;

      tableBodyHtml += `
        <tr>
          <td class="center">${escapeHtml(text(r.div_code))}</td>
          <td class="center">${escapeHtml(text(r.ac_code))}</td>
          <td class="wrap">${escapeHtml(text(r.ac_name))}</td>
          <td class="center">${escapeHtml(text(r.cr_period))}</td>
          <td class="num">${money(r.cr_amt)}</td>
          <td class="num">${debit === 0 ? "0.000" : money(debit)}</td>
          <td class="num">${credit === 0 ? "0.000" : money(credit)}</td>
          <td class="num ${balance < 0 ? "neg-balance" : ""}">${moneyBalance(balance)}</td>
        </tr>`;
    });

    // ── Grand total row ───────────────────────────────────────────────
    if (rows.length > 0) {
      tableBodyHtml += `
        <tr class="grand-total-row">
          <td colspan="5" style="text-align:right; padding-right:8px;">
            Total
          </td>
          <td class="num">${money(grandDebit)}</td>
          <td class="num">${money(grandCredit)}</td>
          <td class="num ${grandBalance < 0 ? "neg-balance" : ""}">${moneyBalance(grandBalance)}</td>
        </tr>`;
    }

    // ── Body HTML ─────────────────────────────────────────────────────
    const bodyHtml =
      rows.length === 0
        ? `<div class="empty">No records found for the selected criteria.</div>`
        : `
        <!-- Title + Currency banner -->
        <div class="report-meta">
          <h1 class="meta-title">Outstanding Statement Summary as on ${asOnDate}</h1>
          <div class="currency-pill">
            <span class="curr-label">Currency</span>
            <span>${currCode}</span>
          </div>
        </div>

        <!-- Fixed-layout table -->
        <table class="data-table statement-table">
          <colgroup>
            <col style="width: 6%" />    <!-- Div Code -->
            <col style="width: 12%" />   <!-- Ac Code -->
            <col style="width: 28%" />   <!-- A/C Name -->
            <col style="width: 8%" />    <!-- Credit Period -->
            <col style="width: 12%" />   <!-- Credit Amount -->
            <col style="width: 11%" />   <!-- Debit -->
            <col style="width: 11%" />   <!-- Credit -->
            <col style="width: 12%" />   <!-- Balance -->
          </colgroup>
          <thead>
            <tr>
              <th>Div<br/>Code</th>
              <th>Ac Code</th>
              <th class="left">A/C Name</th>
              <th>Credit<br/>Period</th>
              <th class="num">Credit<br/>Amount</th>
              <th class="num">Debit</th>
              <th class="num">Credit</th>
              <th class="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${tableBodyHtml}
          </tbody>
        </table>`;

    // ── Shared footer ─────────────────────────────────────────────────
    const footerHtml = reportFooter({
      reportName: "Outstanding Statement Summary",
      userName: text(loginid),
      endLabel: "End of report",
    });

    // ── Final HTML ────────────────────────────────────────────────────
    const reportHtml = buildReportDocument({
      title: "Outstanding Statement Summary",
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("Outstanding Summary Report Error:", error);
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