import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";
// import TenantManager from "../../../../database/TenantManager";
// import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const text = (v: any) => (v == null ? "" : String(v));
const num = (v: any) => Number(v) || 0;

// Whole numbers show without decimals, others show up to 3dp trimmed
const fmtAmt = (v: any) => {
  const n = num(v);
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};

const fmt3 = (v: any) =>
  num(v).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const formatDateStr = (v: any) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

const formatDateTimeStr = (v: any) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}:${ss}:${ms}`;
};

const escapeHtml = (s: any) =>
  text(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ─── Controller ───────────────────────────────────────────────────────────────

export const PRPurchaseReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code1, code2 } = req.body;
    const companyCode = text(code1);
    const requestNumber = text(code2);

    if (!companyCode || !requestNumber) {
      res.status(400).send("Missing company_code or request_number");
      return;
    }

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

    // ── Helper: run PROC_BUILD_DYNAMIC_SQL_COMMON for a given parameter ──
    const runDynamicSql = async (parameter: string, code3: string | null = null) => {
      const binds: any = {
        parameter,
        loginid: loginid || "ADMIN",
        code1: companyCode,
        code2: requestNumber,
        code3: code3,
        code4: null,
        number1: null, number2: null, number3: null, number4: null,
        date1: null, date2: null, date3: null, date4: null,
        out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
      };

      const result = await connection!.execute(
        `DECLARE
           v_sql VARCHAR2(32767);
         BEGIN
           PROC_BUILD_DYNAMIC_SQL_COMMON(
             :parameter, :loginid,
             :code1,  :code2,  :code3,  :code4,
             :number1, :number2, :number3, :number4,
             :date1,   :date2,   :date3,   :date4,
             v_sql
           );
           :out_sql := v_sql;
         END;`,
        binds
      );

      const rawSql = (result.outBinds as any).out_sql;
      if (!rawSql) throw new Error(`Procedure did not return SQL for parameter "${parameter}"`);

      const dataResult = await connection!.execute(rawSql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      return (dataResult.rows as any[]).map((row) =>
        Object.keys(row).reduce((acc: any, key) => {
          acc[key.toLowerCase()] = row[key];
          return acc;
        }, {})
      );
    };

    // ── Fetch header (report-only fields) first — flow_code from it is
    //    needed to scope the history/status-trail query ──────────────────
    const headerRows = await runDynamicSql("Amlspf_PRReport");
    const header = headerRows[0] || {};

    const [itemRows, historyRows] = await Promise.all([
      runDynamicSql("Amlspf_TabPRItems"),
      runDynamicSql("Amlspf_PRReport", header.flow_code || null),
    ]);

    // ── Build item rows + running totals ────────────────────────────────
    let itemRowsHtml = "";
    let totalAmount = 0;
    let totalTax = 0;
    let totalBase = 0;

    itemRows.forEach((item, idx) => {
      const amount = num(item.amount);
      const tax = num(item.tx_compnt_amt_1);
      const base = num(item.base_amount);
      const lineTotal = amount + tax;

      totalAmount += amount;
      totalTax += tax;
      totalBase += base;

      itemRowsHtml += `
        <tr>
          <td class="col-sr">${item.item_srno ?? idx + 1}</td>
          <td class="col-code">
            ${escapeHtml(item.item_code)}
            <span class="pr-sub">${escapeHtml(item.supplier_part_code)}</span>
          </td>
          <td class="col-num">
            ${fmt3(item.request_quantity)}
            <span class="pr-sub">${fmt3(item.allocated_approved_quantity)}</span>
          </td>
          <td class="col-num">${fmt3(item.item_rate)}</td>
          <td class="col-num">${fmt3(item.discount_amount)}</td>
          <td class="col-num">${fmt3(item.final_rate)}</td>
          <td class="col-center">${escapeHtml(item.curr_code)}</td>
          <td class="col-num">${num(item.currency_rate).toFixed(4)}</td>
          <td class="col-num">
            ${fmt3(amount)}
            <span class="pr-sub">${fmt3(base)}</span>
          </td>
          <td class="col-center">
            ${escapeHtml(item.tx_compntcat_code_1)}
            <span class="pr-sub">${escapeHtml(item.tx_cat_code)}</span>
          </td>
          <td class="col-num">${num(item.tx_compnt_perc_1).toFixed(2)}</td>
          <td class="col-num">${fmt3(tax)}</td>
          <td class="col-num col-grand">${fmt3(lineTotal)}</td>
        </tr>`;
    });

    // ── Build approval/status history rows (bottom trail section) ───────
    let historyRowsHtml = "";
    historyRows.forEach((h) => {
      historyRowsHtml += `
        <div class="history-entry">
          <div class="history-req">Request Number: <strong>${escapeHtml(h.request_number)}</strong></div>
          <div class="history-status">${escapeHtml(h.last_action)}</div>
          <div class="history-meta">Last Updated : <strong>${escapeHtml(h.last_updated)}</strong></div>
          <div class="history-meta">Last Updated Dt: ${formatDateTimeStr(h.last_updated_dt)}</div>
        </div>`;
    });

    // ── Final HTML ────────────────────────────────────────────────────
    const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Purchase Request — ${escapeHtml(header.request_number || requestNumber)}</title>
<style>
  :root {
    --ink: #111;
    --ink-soft: #444;
    --rule: #333;
    --accent: #082A89;
  }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: var(--ink);
    margin: 0;
    padding: 24px 32px;
    font-size: 12px;
    line-height: 1.4;
    background: #f5f5f5;
  }
  .page {
    background: #fff;
    max-width: 1200px;
    margin: 0 auto;
    padding: 28px 32px;
    box-shadow: 0 0 10px rgba(0,0,0,.08);
  }

  /* ── Meta line ── */
  .pr-meta { font-size: 11px; margin-bottom: 6px; color: var(--ink-soft); }
  .pr-meta strong { color: var(--ink); }

  .pr-title {
    text-align: center;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0.04em;
    margin: 4px 0 10px 0;
  }
  .pr-hr { border: none; border-top: 2px solid var(--rule); margin: 8px 0 14px 0; }

  /* ── Header info grid (label/value pairs, bordered) ── */
  table.header-grid {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
    font-size: 11.5px;
  }
  table.header-grid td {
    border: 1px solid var(--rule);
    padding: 5px 8px;
    vertical-align: middle;
  }
  table.header-grid td.hg-label {
    font-weight: 700;
    background: #f5f5f5;
    width: 15%;
    white-space: nowrap;
    color: var(--ink-soft);
  }
  table.header-grid td.hg-value {
    width: 35%;
    font-weight: 600;
    color: var(--accent);
  }
  table.header-grid td.hg-value.hg-strong {
    font-size: 13px;
    font-weight: 800;
    color: var(--ink);
  }

  /* ── Items table (Excel-style, bordered grid) ── */
  table.items-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    font-size: 10.5px;
  }
  table.items-table th {
    border: 1px solid var(--rule);
    background: var(--accent);
    color: #fff;
    padding: 5px 6px;
    text-align: center;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  table.items-table td {
    border: 1px solid #999;
    padding: 4px 6px;
    vertical-align: top;
  }
  table.items-table .col-num { text-align: right; white-space: nowrap; }
  table.items-table .col-sr { text-align: center; width: 32px; }
  table.items-table .col-center { text-align: center; }
  table.items-table .col-code { font-weight: 600; }
  table.items-table .col-grand { font-weight: 700; }
  table.items-table .pr-sub {
    display: block;
    font-size: 9px;
    color: var(--ink-soft);
    margin-top: 1px;
    font-weight: 400;
  }
  table.items-table tr.total-row td {
    border-top: 2px solid var(--rule);
    background: #f5f5f5;
    font-weight: 800;
  }

  .pr-footer-note {
    margin-top: 10px;
    font-size: 9.5px;
    color: var(--ink-soft);
    text-align: right;
  }

  /* ── Approval / status history trail ── */
  .pr-history {
    margin-top: 20px;
    padding-top: 12px;
    border-top: 2px solid var(--rule);
  }
  .pr-history h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 10px 0;
    color: var(--ink-soft);
  }
  .history-entry {
    padding: 6px 0;
    border-bottom: 1px dashed #ccc;
    font-size: 11px;
  }
  .history-entry:last-child { border-bottom: none; }
  .history-req { font-weight: 600; margin-bottom: 2px; }
  .history-status {
    display: inline-block;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 2px;
  }
  .history-meta { color: var(--ink-soft); font-size: 10.5px; }

  .no-print { text-align: right; margin-bottom: 16px; }
  .no-print button {
    font-family: inherit; font-size: 12px; font-weight: 600; padding: 7px 20px;
    border-radius: 6px; border: none; background: var(--accent); color: #fff; cursor: pointer;
  }

  @media print {
    body { background: #fff; margin: 0; padding: 0 16px; }
    .page { box-shadow: none; padding: 10px; max-width: none; }
    .no-print { display: none; }
    table.items-table { break-inside: avoid; }
    @page { size: landscape; margin: 12mm 10mm; }
  }
</style>
</head>
<body>

<div class="no-print">
  <button onclick="window.print()">Print / Save PDF</button>
</div>

<div class="page">
  <div class="pr-meta">
    <div>Date : <strong>${formatDateStr(new Date())}</strong></div>
    <div>User : <strong>${escapeHtml(loginid)}</strong></div>
    <div>Report : <strong>Purchase Request</strong></div>
  </div>

  <h1 class="pr-title">PURCHASE REQUEST</h1>
  <hr class="pr-hr" />

  <table class="header-grid">
    <tr>
      <td class="hg-label">Purchase Request Number</td>
      <td class="hg-value hg-strong">${escapeHtml(header.request_number || requestNumber)}</td>
      <td class="hg-label">Currency Rate</td>
      <td class="hg-value">${num(header.currency_rate).toFixed(4)}</td>
    </tr>
    <tr>
      <td class="hg-label">Created By</td>
      <td class="hg-value">${escapeHtml(header.create_user)}</td>
      <td class="hg-label">Currency</td>
      <td class="hg-value">${escapeHtml(header.curr_code)}</td>
    </tr>
    <tr>
      <td class="hg-label">Flow</td>
      <td class="hg-value">${escapeHtml(header.flow_code)}</td>
      <td class="hg-label">Tax Category</td>
      <td class="hg-value">${escapeHtml(header.tx_cat_name)}</td>
    </tr>
    <tr>
      <td class="hg-label">Description</td>
      <td class="hg-value">${escapeHtml(header.description)}</td>
      <td class="hg-label">Tax Code</td>
      <td class="hg-value">${escapeHtml(header.tx_compntcat_name)}</td>
    </tr>
    <tr>
      <td class="hg-label">Remarks</td>
      <td class="hg-value">${escapeHtml(header.remarks)}</td>
      <td class="hg-label">Final Approval</td>
      <td class="hg-value">${escapeHtml(header.final_approved)}</td>
    </tr>
    <tr>
      <td class="hg-label">Amount</td>
      <td class="hg-value">${fmt3(header.amount)}</td>
      <td class="hg-label">Request Date</td>
      <td class="hg-value">${formatDateStr(header.request_date)}</td>
    </tr>
    <tr>
      <td class="hg-label">Division</td>
      <td class="hg-value">${escapeHtml(header.divison_name)}</td>
      <td class="hg-label">Last Action</td>
      <td class="hg-value">${escapeHtml(header.last_action || header.purch_status)}</td>
    </tr>
  </table>

  <table class="items-table">
    <thead>
      <tr>
        <th>Sr No</th>
        <th>Item Code<span class="pr-sub" style="color:#fff;">Supplier Part Code</span></th>
        <th>Req Qty<span class="pr-sub" style="color:#fff;">Appr Qty</span></th>
        <th>Item Rate</th>
        <th>Discount Amt</th>
        <th>Final Rate</th>
        <th>Currency</th>
        <th>Ex Rate</th>
        <th>Amount<span class="pr-sub" style="color:#fff;">Base Amount</span></th>
        <th>Tax Code<span class="pr-sub" style="color:#fff;">Tax Category</span></th>
        <th>Tax %</th>
        <th>Tax Amt</th>
        <th>Total Amt</th>
      </tr>
    </thead>
    <tbody>
      ${itemRowsHtml || `<tr><td colspan="13" style="text-align:center;color:#999;padding:24px;">No line items found for this request.</td></tr>`}
      ${
        itemRows.length > 0
          ? `<tr class="total-row">
               <td colspan="8" style="text-align:center;">TOTAL</td>
               <td class="col-num">${fmt3(totalAmount)}<span class="pr-sub">${fmt3(totalBase)}</span></td>
               <td></td>
               <td></td>
               <td class="col-num">${fmt3(totalTax)}</td>
               <td class="col-num col-grand">${fmt3(totalAmount + totalTax)}</td>
             </tr>`
          : ""
      }
    </tbody>
  </table>

  ${
    historyRowsHtml
      ? `<section class="pr-history">
           <h3>Approval History</h3>
           ${historyRowsHtml}
         </section>`
      : ""
  }

  <div class="pr-footer-note">Generated by ALMS — ${formatDateStr(new Date())}</div>
</div>

</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("PR Purchase Report Error:", error);
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