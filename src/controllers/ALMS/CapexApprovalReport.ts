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
// (95.000 -> "95", 31.500 -> "31.5") — matches the reference PDF's style.
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
    /*
     * Frontend sends (query string, since this is opened as a direct
     * new-tab navigation via window.open — GET, not POST):
     *   loginid          → loginid
     *   company_code     → code1
     *   request_number   → code2
     *
     * Procedure parameters used:
     *   "Amlspf_TabCPHeader"  -> SELECT * FROM VW_CAPEX_HEADER  WHERE company_code = :code1 AND request_number = :code2
     *   "Amlspf_TabCPDetails" -> SELECT * FROM VW_CAPEX_DETAILS WHERE company_code = :code1 AND request_number = :code2
     */
    const loginid = text(req.query.loginid) || "ADMIN";
    const companyCode = text(req.query.company_code || req.query.code1);
    const requestNumber = text(req.query.request_number || req.query.code2);

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

    // ── Helper: run PROC_BUILD_DYNAMIC_SQL_COMMON20 for a given parameter ──
    const runDynamicSql = async (parameter: string) => {
      const binds: any = {
        parameter,
        loginid,
        code1: companyCode,
        code2: requestNumber,
        code3: null, code4: null, code5: null, code6: null, code7: null,
        code8: null, code9: null, code10: null, code11: null, code12: null,
        code13: null, code14: null, code15: null, code16: null, code17: null,
        code18: null, code19: null, code20: null,
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

    // ── Build item blocks (matches reference PDF layout) ────────────────
    let itemsHtml = "";
    let grandTotalSum = 0;

    detailRows.forEach((item) => {
      const amount = num(item.amount);
      const vat = num(item.tx_compnt_amt_1);
      const grandTotal = amount + vat;
      grandTotalSum += grandTotal;

      itemsHtml += `
        <section class="item-block">
          <table class="line-table">
            <thead>
              <tr>
                <th class="col-desc">Item Description</th>
                <th class="col-num">Rate (RO)</th>
                <th class="col-num">Quantity</th>
                <th class="col-num">Total RO</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="col-desc">
                  <span class="item-code">${escapeHtml(item.item_code)}</span><br />
                  <span class="item-name">${escapeHtml(item.item_desp)}</span>
                </td>
                <td class="col-num">${fmtRate(item.item_rate)}</td>
                <td class="col-num">${num(item.item_qty)}</td>
                <td class="col-num">${fmtAmt(amount)}</td>
              </tr>
              ${
                item.ref_doc_no
                  ? `<tr class="sub-row"><td colspan="4" class="ref-doc">${escapeHtml(item.ref_doc_no)}</td></tr>`
                  : ""
              }
              <tr class="sub-row">
                <td colspan="3" class="label-cell">VAT</td>
                <td class="col-num">${fmtAmt(vat)}</td>
              </tr>
              <tr class="total-row">
                <td colspan="3" class="label-cell">GRAND TOTAL</td>
                <td class="col-num">${fmtAmt(grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          <table class="meta-table">
            <tbody>
              <tr>
                <td class="meta-label">Sl Supplier:</td>
                <td class="meta-value">${escapeHtml(header.supplier)}</td>
                <td class="meta-label align-right">Total Cost RO</td>
                <td class="meta-value align-right">${fmtAmt(grandTotal)}</td>
              </tr>
              <tr>
                <td class="meta-label">Budgeted:</td>
                <td class="meta-value">${yesNo(header.budgeted)}</td>
                <td class="meta-label align-right">Board Approved:</td>
                <td class="meta-value align-right">${yesNo(header.board_approval)}</td>
              </tr>
            </tbody>
          </table>
        </section>`;
    });

    // ── Final HTML (matches reference PDF layout) ────────────────────────
    const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>CAPEX Approval Form — ${escapeHtml(header.request_number || requestNumber)}</title>
<style>
  :root {
    --ink: #1a1a1a;
    --ink-soft: #444;
    --rule: #1a1a1a;
    --rule-soft: #bbb;
    --accent: #082A89;
  }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    color: var(--ink);
    margin: 0;
    padding: 32px 40px;
    font-size: 13px;
    line-height: 1.45;
    background: #f5f5f5;
  }
  .page {
    background: #fff;
    max-width: 800px;
    margin: 0 auto;
    padding: 32px 36px;
    box-shadow: 0 0 10px rgba(0,0,0,.08);
  }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid var(--rule);
    padding-bottom: 10px;
    margin-bottom: 18px;
  }
  .doc-header .date { font-size: 12px; color: var(--ink-soft); }
  .doc-header .titles { text-align: center; flex: 1; }
  .doc-header .company {
    font-size: 16px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;
  }
  .doc-header .form-title {
    font-size: 13px; font-weight: 600; color: var(--accent);
    letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px;
  }
  .doc-header .req-no { font-size: 12px; color: var(--ink-soft); text-align: right; min-width: 90px; }

  .item-block {
    border: 1px solid var(--rule); border-radius: 4px; margin-bottom: 16px; padding: 10px 12px;
    page-break-inside: avoid;
  }
  table.line-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  table.line-table thead th {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft);
    text-align: left; border-bottom: 1px solid var(--rule-soft); padding: 4px 6px; font-weight: 600;
  }
  table.line-table .col-num { text-align: right; white-space: nowrap; }
  table.line-table td { padding: 6px 6px; vertical-align: top; }
  .item-code { font-weight: 700; font-size: 12.5px; }
  .item-name { color: var(--ink-soft); font-size: 12px; }
  .sub-row td { padding-top: 2px; padding-bottom: 2px; border-top: 1px dashed var(--rule-soft); }
  .ref-doc { font-size: 11.5px; color: var(--ink-soft); letter-spacing: 0.03em; }
  .label-cell { text-align: right; font-weight: 600; color: var(--ink-soft); }
  .total-row td { border-top: 1px solid var(--rule); font-weight: 700; font-size: 13.5px; }

  table.meta-table {
    width: 100%; border-collapse: collapse; background: #fafafa; border: 1px solid var(--rule-soft); border-radius: 3px;
  }
  table.meta-table td { padding: 5px 10px; font-size: 12px; }
  .meta-label { color: var(--ink-soft); font-weight: 600; white-space: nowrap; }
  .meta-value { font-weight: 700; }
  .align-right { text-align: right; }

  .justification { margin-top: 20px; padding-top: 14px; border-top: 2px solid var(--rule); }
  .justification h3 {
    font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 6px 0; color: var(--ink-soft);
  }
  .justification p { margin: 0 0 4px 0; font-size: 12.5px; }
  .note { margin-top: 10px; font-size: 11px; font-style: italic; color: var(--ink-soft); }

  .signatures { margin-top: 36px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
  .signature-cell {
    text-align: center; padding-top: 28px; border-top: 1px solid var(--rule); font-size: 11.5px; color: var(--ink-soft);
  }

  .no-print { text-align: right; margin-bottom: 16px; }
  .no-print button {
    font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 20px;
    border-radius: 6px; border: none; background: var(--accent); color: #fff; cursor: pointer;
  }

  @media print {
    body { background: #fff; margin: 0; padding: 0 24px; }
    .page { box-shadow: none; padding: 16px; max-width: none; }
    .no-print { display: none; }
    .item-block { break-inside: avoid; }
    @page { margin: 18mm 14mm; }
  }
</style>
</head>
<body>

<div class="no-print">
  <button onclick="window.print()">Print / Save PDF</button>
</div>

<div class="page">
  <header class="doc-header">
    <div class="date">Date:<br /><strong>${formatDateStr(header.request_date || new Date())}</strong></div>
    <div class="titles">
      <div class="company">AL MADINA LOGISTIC SERVICES CO SAOC</div>
      <div class="form-title">Capex Approval Form</div>
    </div>
    <div class="req-no">Req No:<br/><strong>${escapeHtml(header.request_number || requestNumber)}</strong></div>
  </header>

  ${itemsHtml || `<p style="text-align:center;color:#999;padding:40px;">No line items found for this request.</p>`}

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