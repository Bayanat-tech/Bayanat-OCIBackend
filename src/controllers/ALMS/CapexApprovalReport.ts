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

const fmtRate = (v: any) => num(v).toFixed(3);

const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

const yesNo = (v: any) => {
  const s = text(v).trim().toUpperCase();
  if (s === "Y" || s === "YES") return "Yes";
  if (s === "N" || s === "NO") return "No";
  return s || "—";
};

const escapeHtml = (s: any) =>
  text(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ─── Controller ───────────────────────────────────────────────────────────────

export const CapexApprovalReport = async (req: Request, res: Response): Promise<void> => {
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
    const runDynamicSql = async (parameter: string) => {
      const binds: any = {
        parameter,
        loginid: loginid || "ADMIN",
        code1: companyCode,
        code2: requestNumber,
        code3: null,
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

    // ── Fetch header + details ──────────────────────────────────────────
    const [headerRows, detailRows] = await Promise.all([
      runDynamicSql("Amlspf_TabCPHeader"),
      runDynamicSql("Amlspf_TabCPDetails"),
    ]);

    const header = headerRows[0] || {};

    // ── Build flat item table rows (Excel-style: one row per item) ──────
    let itemRowsHtml = "";
    let totalAmount = 0;
    let totalVat = 0;
    let totalGrand = 0;

    detailRows.forEach((item, idx) => {
      const amount = num(item.amount);
      const vat = num(item.tx_compnt_amt_1);
      const grandTotal = amount + vat;

      totalAmount += amount;
      totalVat += vat;
      totalGrand += grandTotal;

      itemRowsHtml += `
        <tr>
          <td class="col-sr">${idx + 1}</td>
          <td class="col-code">${escapeHtml(item.item_code)}</td>
          <td class="col-desc">${escapeHtml(item.item_desp)}</td>
          <td class="col-num">${fmtRate(item.item_rate)}</td>
          <td class="col-num">${num(item.item_qty)}</td>
          <td class="col-num">${fmtAmt(amount)}</td>
          <td class="col-num">${fmtAmt(vat)}</td>
          <td class="col-num col-grand">${fmtAmt(grandTotal)}</td>
        </tr>`;
    });

    // ── Final HTML ────────────────────────────────────────────────────
    const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>CAPEX Approval Form — ${escapeHtml(header.request_number || requestNumber)}</title>
<style>
  :root {
    --ink: #1a1a1a;
    --ink-soft: #444;
    --rule: #333;
    --accent: #082A89;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    color: var(--ink);
    margin: 0;
    padding: 24px 32px;
    font-size: 12px;
    line-height: 1.4;
    background: #f5f5f5;
  }
  .page {
    background: #fff;
    max-width: 900px;
    margin: 0 auto;
    padding: 28px 32px;
    box-shadow: 0 0 10px rgba(0,0,0,.08);
  }

  /* ── Top banner ── */
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid var(--rule);
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .doc-header .date { font-size: 11.5px; color: var(--ink-soft); }
  .doc-header .titles { text-align: center; flex: 1; }
  .doc-header .company {
    font-size: 16px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;
  }
  .doc-header .form-title {
    font-size: 12.5px; font-weight: 600; color: var(--accent);
    letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px;
  }
  .doc-header .req-no { font-size: 11.5px; color: var(--ink-soft); text-align: right; min-width: 90px; }

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
  }
  table.header-grid td.hg-full {
    font-weight: 400;
  }

  /* ── Flat items table (Excel-style, bordered grid) ── */
  table.items-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    font-size: 11.5px;
  }
  table.items-table th {
    border: 1px solid var(--rule);
    background: var(--accent);
    color: #fff;
    padding: 6px 8px;
    text-align: left;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
  table.items-table td {
    border: 1px solid #999;
    padding: 5px 8px;
    vertical-align: top;
  }
  table.items-table .col-num { text-align: right; white-space: nowrap; }
  table.items-table .col-sr { text-align: center; width: 32px; }
  table.items-table .col-code { white-space: nowrap; font-weight: 600; }
  table.items-table .col-grand { font-weight: 700; }
  table.items-table tr.total-row td {
    border-top: 2px solid var(--rule);
    background: #f5f5f5;
    font-weight: 700;
  }

  .justification { margin-top: 20px; padding-top: 12px; border-top: 2px solid var(--rule); }
  .justification h3 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 6px 0; color: var(--ink-soft);
  }
  .justification p { margin: 0 0 4px 0; font-size: 12px; }
  .note { margin-top: 8px; font-size: 10.5px; font-style: italic; color: var(--ink-soft); }

  .signatures { margin-top: 32px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
  .signature-cell {
    text-align: center; padding-top: 26px; border-top: 1px solid var(--rule); font-size: 11px; color: var(--ink-soft);
  }

  .no-print { text-align: right; margin-bottom: 16px; }
  .no-print button {
    font-family: inherit; font-size: 12px; font-weight: 600; padding: 7px 20px;
    border-radius: 6px; border: none; background: var(--accent); color: #fff; cursor: pointer;
  }

  @media print {
    body { background: #fff; margin: 0; padding: 0 20px; }
    .page { box-shadow: none; padding: 12px; max-width: none; }
    .no-print { display: none; }
    table.items-table { break-inside: avoid; }
    @page { margin: 16mm 12mm; }
  }
</style>
</head>
<body>

<div class="no-print">
  <button onclick="window.print()">Print / Save PDF</button>
</div>

<div class="page">
  <header class="doc-header">
    <div class="date">Date:<br /><strong>${formatDateStr(new Date())}</strong></div>
    <div class="titles">
      <div class="company">AL MADINA LOGISTIC SERVICES CO SAOC</div>
      <div class="form-title">Capex Approval Form</div>
    </div>
    <div class="req-no">Req No:<br/><strong>${escapeHtml(header.request_number || requestNumber)}</strong></div>
  </header>

  <table class="header-grid">
    <tr>
      <td class="hg-label">Request Number</td>
      <td class="hg-value">${escapeHtml(header.request_number || requestNumber)}</td>
      <td class="hg-label">Request Date</td>
      <td class="hg-value">${formatDateStr(header.request_date)}</td>
    </tr>
    <tr>
      <td class="hg-label">Ref. Request Number</td>
      <td class="hg-value">${escapeHtml(header.ref_request_number)}</td>
      <td class="hg-label">Ref. Request Date</td>
      <td class="hg-value">${formatDateStr(header.ref_request_date)}</td>
    </tr>
    <tr>
      <td class="hg-label">Supplier Code</td>
      <td class="hg-value">${escapeHtml(header.supplier)}</td>
      <td class="hg-label">Supplier Name</td>
      <td class="hg-value">${escapeHtml(header.ac_name)}</td>
    </tr>
    <tr>
      <td class="hg-label">PO Number</td>
      <td class="hg-value">${escapeHtml(header.ref_doc_no)}</td>
      <td class="hg-label">Budgeted</td>
      <td class="hg-value">${yesNo(header.budgeted)}</td>
    </tr>
    <tr>
      <td class="hg-label">Board Approved</td>
      <td class="hg-value">${yesNo(header.board_approval)}</td>
      <td class="hg-label">Description</td>
      <td class="hg-value hg-full">${escapeHtml(header.description) || "GENERATED FOR CAPEX PROCESS"}</td>
    </tr>
  </table>

  <table class="items-table">
    <thead>
      <tr>
        <th>Sr No</th>
        <th>Item Code</th>
        <th>Item Description</th>
        <th>Rate (RO)</th>
        <th>Quantity</th>
        <th>Amount</th>
        <th>VAT</th>
        <th>Grand Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRowsHtml || `<tr><td colspan="8" style="text-align:center;color:#999;padding:24px;">No line items found for this request.</td></tr>`}
      ${
        detailRows.length > 0
          ? `<tr class="total-row">
               <td colspan="5" style="text-align:right;">Total</td>
               <td class="col-num">${fmtAmt(totalAmount)}</td>
               <td class="col-num">${fmtAmt(totalVat)}</td>
               <td class="col-num col-grand">${fmtAmt(totalGrand)}</td>
             </tr>`
          : ""
      }
    </tbody>
  </table>

  <section class="justification">
    <h3>Justification</h3>
    <p>${escapeHtml(header.description) || "GENERATED FOR CAPEX PROCESS"}</p>
    <p class="note">Note: This form should be filled prior to all capex purchases as per Board direction</p>
  </section>

  <section class="signatures">
    <div class="signature-cell">Requested by</div>
    <div class="signature-cell">Purchased by</div>
    <div class="signature-cell">Reviewed by FM</div>
    <div class="signature-cell">Approved by CEO/GM</div>
  </section>
</div>

</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);
  } catch (error: any) {
    console.error("Capex Approval Report Error:", error);
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