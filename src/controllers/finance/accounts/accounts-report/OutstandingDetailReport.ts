import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { escapeHtml } from "../../../purchase_sales/report/common/formatters";
import { buildReportDocument, reportFooter, reportHeader } from "../../../common/report_common";
import { RequestWithUser } from "../../../../interfaces/common.interface";


// ─── Helpers (unchanged) ──────────────────────────────────────────────────────

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

// ─── Extra CSS – only what is specific to this report ─────────────────────────

const EXTRA_CSS = `
  /* One customer statement per page */
  .statement-block { page-break-after: always; }
  .statement-block:last-of-type { page-break-after: auto; }

  /* Title / currency banner (sits under the common company header) */
  .report-meta {
    display: flex;
    justify-content: flex-start;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 8px;
    margin-bottom: 10px;
  }
  .meta-table { border-collapse: collapse; }
  .meta-table td { padding: 2px 8px 2px 0; vertical-align: top; font-size: 11px; }
  .meta-label { font-weight: 700; color: #64748b; min-width: 70px; white-space: nowrap; }

  /* Customer block */
  .customer-block { margin: 10px 0 6px; }
  .customer-name { font-size: 12px; font-weight: 800; margin-bottom: 4px; }
  .customer-address { font-size: 10.5px; color: #334155; line-height: 1.5; margin-bottom: 8px; }
  .contact-table { width: 100%; font-size: 10.5px; border-collapse: collapse; }
  .contact-table td { padding: 2px 6px 2px 0; vertical-align: top; }
  .contact-label { font-weight: 700; color: #64748b; white-space: nowrap; }
  .right-label { text-align: right; }
  .right-value { text-align: right; font-variant-numeric: tabular-nums; }

  /* Statement table – overrides data-table defaults where needed */
  table.statement-table { margin-top: 6px; }
  table.statement-table th {
    background: #1e3a5f;
    color: #ffffff;
    border-top: 0;
    border-bottom: 0;
    white-space: nowrap;
  }
  table.statement-table td { vertical-align: middle; }
  .statement-table .neg-balance { color: #c0392b; }
  .statement-table tbody tr:hover td { background: #f8fafc; }
`;

// ─── Controller ───────────────────────────────────────────────────────────────

export const OutstandingDetailReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const {
      loginid,
      code1, code2, code3, code4, code5, code6, code7, code8,
      code9, code10, code11, code12, code13, code14, code15, code16,
    } = req.body;

    const parameter = "Account_Report_Outstanding_Detail";

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
      code1:  code1  || null,  code2:  code2  || null,
      code3:  code3  || null,  code4:  code4  || null,
      code5:  code5  || null,  code6:  code6  || null,
      code7:  code7  || null,  code8:  code8  || null,
      code9:  code9  || null,  code10: code10 || null,
      code11: code11 || null,  code12: code12 || null,
      code13: code13 || null,  code14: code14 || null,
      code15: code15 || null,  code16: code16 || null,
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

    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // ── Group by ac_code (one statement block per customer) ───────────
    type DetailRow = (typeof rows)[0];
    type AcGroup = {
      ac_code: string; ac_name: string;
      address1: string; address2: string; address3: string;
      phone: string; email: string; fax: string;
      contact_person: string; cr_period: string; cr_amt: string;
      rows: DetailRow[];
    };

    const acMap = new Map<string, AcGroup>();

    rows.forEach((r) => {
      const acKey = text(r.ac_code);
      if (!acMap.has(acKey)) {
        acMap.set(acKey, {
          ac_code:        acKey,
          ac_name:        text(r.ac_name),
          address1:       text(r.address1),
          address2:       text(r.address2),
          address3:       text(r.address3),
          phone:          text(r.phone),
          email:          text(r.party_email),
          fax:            text(r.fax),
          contact_person: text(r.contact_person),
          cr_period:      text(r.cr_period),
          cr_amt:         text(r.cr_amt),
          rows:           [],
        });
      }
      acMap.get(acKey)!.rows.push(r);
    });

    // ── Currency & as-on date ─────────────────────────────────────────
    const currCode = escapeHtml(text(code5) || "OMR");
    const asOnDate = escapeHtml(formatDateStr(code6) || text(code6));

    // ── Shared company header (logo + name + address from ms_company) ─
    const headerHtml = await reportHeader({
      company_code: text(code1),
      req: req as RequestWithUser,
    });

    // ── One statement block per customer ──────────────────────────────
    const acEntries = Array.from(acMap.values());

    const blocksHtml =
      acEntries.length === 0
        ? `<div class="empty">No records found for the selected criteria.</div>`
        : acEntries
            .map((ac) => {
              let runningBalance = 0;

              const bodyRows = ac.rows
                .map((r) => {
                  const amount = num(r.amount);
                  const debit  = amount > 0 ? amount : 0;
                  const credit = amount < 0 ? Math.abs(amount) : 0;
                  runningBalance += debit - credit;

                  return `
                  <tr>
                    <td class="center">${escapeHtml(text(r.doc_type))}</td>
                    <td>${escapeHtml(text(r.inv_no))}</td>
                    <td class="center">${formatDateStr(r.inv_date)}</td>
                    <td>${escapeHtml(text(r.doc_no))}</td>
                    <td>${escapeHtml(text(r.remarks))}</td>
                    <td class="num">${debit  === 0 ? "0.000" : money(debit)}</td>
                    <td class="num">${credit === 0 ? "0.000" : money(credit)}</td>
                    <td class="num ${runningBalance < 0 ? "neg-balance" : ""}">${moneyBalance(runningBalance)}</td>
                  </tr>`;
                })
                .join("");

              const addressLines = [ac.address1, ac.address2, ac.address3]
                .filter(Boolean)
                .map((a) => `<div>${escapeHtml(a)}</div>`)
                .join("");

              return `
              <div class="statement-block">

                <div class="report-meta">
                  <table class="meta-table">
                    <tr>
                      <td class="meta-label">Title :</td>
                      <td><strong>Outstanding Statement as on ${asOnDate}</strong></td>
                    </tr>
                    <tr>
                      <td class="meta-label">Currency :</td>
                      <td><strong>${currCode}</strong></td>
                    </tr>
                  </table>
                </div>

                <div class="customer-block">
                  <div class="customer-name">${escapeHtml(ac.ac_code)} &nbsp; ${escapeHtml(ac.ac_name)}</div>
                  <div class="customer-address">${addressLines}</div>

                  <table class="contact-table">
                    <tr>
                      <td class="contact-label">Ph.</td>
                      <td>${escapeHtml(ac.phone)}</td>
                      <td class="contact-label">Fax</td>
                      <td>${escapeHtml(ac.fax)}</td>
                      <td class="contact-label right-label">Credit Period:</td>
                      <td class="right-value">${escapeHtml(ac.cr_period)}</td>
                    </tr>
                    <tr>
                      <td class="contact-label">Email</td>
                      <td colspan="3">${escapeHtml(ac.email)}</td>
                      <td class="contact-label right-label">Credit Amount:</td>
                      <td class="right-value">${money(ac.cr_amt)}</td>
                    </tr>
                    <tr>
                      <td class="contact-label">Attn.</td>
                      <td colspan="3">${escapeHtml(ac.contact_person)}</td>
                      <td></td>
                      <td></td>
                    </tr>
                  </table>
                </div>

                <table class="data-table statement-table">
                  <thead>
                    <tr>
                      <th style="width:40px;">Doc<br/>Type</th>
                      <th style="width:110px;">Doc No.</th>
                      <th style="width:70px;">Doc Date</th>
                      <th style="width:90px;">Doc Ref No.</th>
                      <th>Narration</th>
                      <th class="num" style="width:75px;">Debit</th>
                      <th class="num" style="width:75px;">Credit</th>
                      <th class="num" style="width:85px;">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${bodyRows || `
                      <tr>
                        <td colspan="8" class="center muted" style="padding:24px;">
                          No outstanding records found.
                        </td>
                      </tr>`}
                  </tbody>
                </table>

              </div>`;
            })
            .join("");

    // ── Shared footer (repeats on every printed page) ─────────────────
    const footerHtml = reportFooter({
      reportName: "Outstanding Statement Detail",
      userName: text(loginid),
      endLabel: "End of report",
    });

    // ── Final HTML via the shared shell ───────────────────────────────
    const reportHtml = buildReportDocument({
      title: "Outstanding Statement Detail",
      headerHtml,
      bodyHtml: blocksHtml,
      footerHtml,
      extraCss: EXTRA_CSS,
    });

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Outstanding Detail Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to generate report",
      details: error.message,
    });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) { console.error("Connection close error:", e); }
    }
  }
};