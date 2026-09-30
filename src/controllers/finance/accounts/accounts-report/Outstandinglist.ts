import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
} from "../../../common/report_common";

const money = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.000";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};
const text = (v: any) => (v == null ? "" : String(v));
const num = (v: any) => Number(v) || 0;
const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};
const escapeHtml = (v: any) =>
  text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/** Layout only – fonts, header, footer and base table style come from report_common.ts */
const OUTSTANDING_EXTRA_CSS = `
  .report-sub {
    margin: -8px 0 14px 0;
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
  }

  table.data-table tbody tr.detail-row td { background: #fff !important; }
  table.data-table tbody tr.detail-row td.inv { padding-left: 22px; font-weight: 700; color: #0b4ca1; }

  table.data-table tbody tr.l4-row td {
    background: #e8f0fa !important;
    color: #0b4ca1;
    font-weight: 700;
    border-bottom: 1px solid #b8d0ea;
  }
  table.data-table tbody tr.ac-row td {
    background: #fff !important;
    color: #0f172a;
    font-weight: 700;
    border-bottom: 1px solid #cbd5e1;
  }
  table.data-table tbody tr.ac-total td {
    background: #f8fafc !important;
    color: #0f172a;
    font-weight: 700;
    border-top: 1px solid #94a3b8;
  }
  table.data-table tbody tr.l4-total td {
    background: #f1f5f9 !important;
    color: #0f172a;
    font-weight: 700;
    border-top: 1px solid #475569;
    border-bottom: 1px solid #475569;
  }
  table.data-table tbody tr.spacer td {
    height: 10px;
    padding: 0;
    background: #fff !important;
    border: 0;
  }
  table.data-table tbody tr.grand-total td {
    background: #e8f0fa !important;
    color: #0b4ca1;
    font-weight: 700;
    border-bottom: 2px solid #0b4ca1;
  }
  table.data-table tbody tr td.wrap {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  @media print {
    table.data-table tbody tr.l4-row,
    table.data-table tbody tr.ac-row { break-after: avoid; }
    table.data-table tbody tr.ac-total,
    table.data-table tbody tr.l4-total,
    table.data-table tbody tr.grand-total { break-inside: avoid; }
  }
`;

export const OutstandingList = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;
  try {
    const {
      loginid,
      company_code,
      code1, code2, code3, code4, code5, code6,
      code7, code8, code9, code10, code11, code12, code13, code14,
      code15, code16,
    } = req.body;

    const parameter = "Account_Report_VW_PERIODWISE_OUTSTD_LIST";

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid)
      tenantId = await TenantManager.getTenantForUser(loginid);
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

    const dataResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // ─── Group: l4_code → ac_code → inv rows ─────────────────────────
    type DetailRow = (typeof rows)[0];
    type AccGroup = { ac_code: string; ac_name: string; rows: DetailRow[] };
    type L4Group = {
      l4_code: string;
      l4_description: string;
      accounts: Map<string, AccGroup>;
    };

    const l4Map = new Map<string, L4Group>();
    rows.forEach((r) => {
      const l4Key = text(r.l4_code);
      const acKey = text(r.ac_code);
      if (!l4Map.has(l4Key))
        l4Map.set(l4Key, {
          l4_code: l4Key,
          l4_description: text(r.l4_description),
          accounts: new Map(),
        });
      const l4 = l4Map.get(l4Key)!;
      if (!l4.accounts.has(acKey))
        l4.accounts.set(acKey, {
          ac_code: acKey,
          ac_name: text(r.ac_name),
          rows: [],
        });
      l4.accounts.get(acKey)!.rows.push(r);
    });

    // ─── Table body ───────────────────────────────────────────────────
    const COLS = 5;
    let body = "";
    let grandOrg = 0,
      grandUnalloc = 0,
      grandBalance = 0;

    l4Map.forEach((l4) => {
      body += `
        <tr class="l4-row">
          <td colspan="${COLS}" class="wrap">${escapeHtml(l4.l4_code)}&nbsp;&nbsp;${escapeHtml(l4.l4_description)}</td>
        </tr>`;

      let l4Org = 0,
        l4Unalloc = 0,
        l4Balance = 0;

      l4.accounts.forEach((ac) => {
        body += `
          <tr class="ac-row">
            <td colspan="${COLS}" class="wrap">${escapeHtml(ac.ac_code)}&nbsp;&nbsp;${escapeHtml(ac.ac_name)}</td>
          </tr>`;

        let acOrg = 0,
          acUnalloc = 0,
          acBalance = 0;

        ac.rows.forEach((r) => {
          const org = num(r.org_amt);
          const unalloc = num(r.un_allocated_amt);
          const balance = num(r.balance_amount);
          acOrg += org;
          acUnalloc += unalloc;
          acBalance += balance;

          body += `
          <tr class="detail-row">
            <td class="inv wrap">${escapeHtml(r.inv_no)}</td>
            <td class="center">${escapeHtml(formatDateStr(r.inv_date))}</td>
            <td class="num">${money(org)}</td>
            <td class="num">${money(unalloc)}</td>
            <td class="num">${money(balance)}</td>
          </tr>`;
        });

        body += `
          <tr class="ac-total">
            <td colspan="2" class="wrap">Total for ${escapeHtml(ac.ac_name)}</td>
            <td class="num">${money(acOrg)}</td>
            <td class="num">${money(acUnalloc)}</td>
            <td class="num">${money(acBalance)}</td>
          </tr>`;

        l4Org += acOrg;
        l4Unalloc += acUnalloc;
        l4Balance += acBalance;
      });

      body += `
        <tr class="l4-total">
          <td colspan="2" class="wrap">Total for ${escapeHtml(l4.l4_description)}</td>
          <td class="num">${money(l4Org)}</td>
          <td class="num">${money(l4Unalloc)}</td>
          <td class="num">${money(l4Balance)}</td>
        </tr>
        <tr class="spacer"><td colspan="${COLS}"></td></tr>`;

      grandOrg += l4Org;
      grandUnalloc += l4Unalloc;
      grandBalance += l4Balance;
    });

    if (l4Map.size) {
      body += `
        <tr class="grand-total">
          <td colspan="2">Grand Total</td>
          <td class="num">${money(grandOrg)}</td>
          <td class="num">${money(grandUnalloc)}</td>
          <td class="num">${money(grandBalance)}</td>
        </tr>`;
    }

    const tableHtml = l4Map.size
      ? `
      <table class="data-table">
        <thead>
          <tr>
            <th class="left" style="width:30%">A/C Code / Inv No</th>
            <th class="center" style="width:14%">Inv Date</th>
            <th class="num" style="width:18%">Inv Amount</th>
            <th class="num" style="width:19%">Un-Allocated</th>
            <th class="num" style="width:19%">Inv Balance</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`
      : `<div class="empty">No records found.</div>`;

    const bodyHtml = `
      <h1 class="report-title">Outstanding List</h1>
      <div class="report-sub">
        Ageing as on ${escapeHtml(code6)} &nbsp;|&nbsp; Division: ${escapeHtml(code2 || "All")}
      </div>
      ${tableHtml}`;

    // Company code is never hard coded: body -> logged-in user
    const companyCode = text(
      company_code || (req as RequestWithUser).user?.company_code
    );
    const headerHtml = await reportHeader({
      company_code: companyCode,
      req: req as RequestWithUser,
    });

    const html = buildReportDocument({
      title: "Outstanding List",
      headerHtml,
      bodyHtml,
      footerHtml: reportFooter({
        reportName: "Outstanding List",
        userName: text(loginid),
        endLabel: "Powered by Bayanat Technology",
      }),
      extraCss: OUTSTANDING_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (error: any) {
    console.error("Outstanding List Report Error:", error);
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