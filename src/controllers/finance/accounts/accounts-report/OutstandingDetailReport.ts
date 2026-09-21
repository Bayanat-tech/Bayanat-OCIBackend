import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

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

const moneyBalance = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "0.000";
    const abs = Math.abs(n).toLocaleString("en-US", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
    });
    return n < 0 ? `(${abs})` : abs;
};

// ─── Controller ───────────────────────────────────────────────────────────────

export const OutstandingDetailReport = async (req: Request, res: Response): Promise<void> => {
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
         *   as_on_date    → code6   e.g. "11-JUN-2026"  (DD-MON-YYYY)
         *
         * Procedure: "Account_Report_Outstanding_Detail"
         *
         * EXPECTED SQL columns (per ac_code + doc row), based on the target PDF layout:
         *   ac_code, ac_name,
         *   address1, address2, address3,     // ⚠ VERIFY: PDF shows these as the CUSTOMER's
         *                                      //   address — confirm actual column names with SP/sir
         *   phone, party_email, fax,           // customer's general contact (Ph / Email / Fax)
         *   contact_person,                    // "Attn." name
         *   cr_period, cr_amt,                 // Credit Period / Credit Amount
         *   doc_type,                          // ⚠ NEW FIELD — not present in old SP output,
         *                                      //   needs to be added/aliased in
         *                                      //   PROC_BUILD_DYNAMIC_SQL_COMMON20 (e.g. SV / BR)
         *   inv_no,    → "Doc No."
         *   inv_date,  → "Doc Date"
         *   doc_no,    → "Doc Ref No."
         *   remarks,   → "Narration"
         *   amount     → signed amount (Debit if > 0, Credit if < 0); running balance per ac_code
         */

        const {
            loginid,
            code1, code2, code3, code4, code5, code6,
            code7, code8, code9, code10, code11, code12,
            code13, code14, code15, code16,
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

        // 🔍 DEBUG: uncomment once to confirm actual column names returned by the SP,
        // then remove again. This is the fastest way to fix any remaining name mismatch.
        // if (rows.length) console.log("ROW KEYS:", Object.keys(rows[0]));

        // ── Group by ac_code (one statement block per customer) ───────────
        type DetailRow = (typeof rows)[0];
        type AcGroup = {
            ac_code: string;
            ac_name: string;
            address1: string;
            address2: string;
            address3: string;
            phone: string;
            email: string;
            fax: string;
            contact_person: string;
            cr_period: string;
            cr_amt: string;
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
        const currCode = text(code5) || "OMR";
        const asOnDate = formatDateStr(code6) || text(code6);
        const todayStr = formatDateStr(new Date());

        // ── Build one statement block per customer ─────────────────────────
        let blocksHtml = "";
        const acEntries = Array.from(acMap.values());

        acEntries.forEach((ac, blockIdx) => {
            let runningBalance = 0;
            let bodyRows = "";

            ac.rows.forEach((r) => {
                const amount  = num(r.amount);
                const debit   = amount > 0 ? amount : 0;
                const credit  = amount < 0 ? Math.abs(amount) : 0;
                runningBalance += debit - credit;

                bodyRows += `
                <tr class="detail-row">
                  <td>${text(r.doc_type)}</td>
                  <td>${text(r.inv_no)}</td>
                  <td>${formatDateStr(r.inv_date)}</td>
                  <td>${text(r.doc_no)}</td>
                  <td class="narration-cell">${text(r.remarks)}</td>
                  <td class="num">${debit  === 0 ? "0.000" : money(debit)}</td>
                  <td class="num">${credit === 0 ? "0.000" : money(credit)}</td>
                  <td class="num ${runningBalance < 0 ? "neg-balance" : ""}">${moneyBalance(runningBalance)}</td>
                </tr>`;
            });

            const addressLines = [ac.address1, ac.address2, ac.address3]
                .filter((a) => a)
                .map((a) => `<div>${a}</div>`)
                .join("");

            const isLastBlock = blockIdx === acEntries.length - 1;

            blocksHtml += `
            <div class="statement-block" ${isLastBlock ? "" : 'style="page-break-after:always;"'}>

              <div class="report-header">
                <table class="meta-table">
                  <tr>
                    <td class="meta-label">Title :</td>
                    <td><strong>Outstanding Statement as on ${asOnDate}</strong></td>
                  </tr>
                  <tr><td class="meta-label">Date :</td><td>${todayStr}</td></tr>
                  <tr>
                    <td class="meta-label">Currency :</td>
                    <td><strong>${currCode}</strong></td>
                  </tr>
                </table>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                  <div class="company-name">AL MADINA</div>
                  <div class="company-sub">LOGISTICS</div>
                </div>
              </div>

              <div class="customer-block">
                <div class="customer-name">${ac.ac_code} &nbsp; ${ac.ac_name}</div>
                <div class="customer-address">${addressLines}</div>

                <table class="contact-table">
                  <tr>
                    <td class="contact-label">Ph.</td>
                    <td>${ac.phone}</td>
                    <td class="contact-label">Fax</td>
                    <td>${ac.fax}</td>
                    <td class="contact-label right-label">Credit Period:</td>
                    <td class="right-value">${ac.cr_period}</td>
                  </tr>
                  <tr>
                    <td class="contact-label">Email</td>
                    <td colspan="3">${ac.email}</td>
                    <td class="contact-label right-label">Credit Amount:</td>
                    <td class="right-value">${money(ac.cr_amt)}</td>
                  </tr>
                  <tr>
                    <td class="contact-label">Attn.</td>
                    <td colspan="3">${ac.contact_person}</td>
                    <td></td>
                    <td></td>
                  </tr>
                </table>
              </div>

              <table class="report-table">
                <thead>
                  <tr>
                    <th style="width:40px;">Doc<br>Type</th>
                    <th style="width:120px;">Doc No.</th>
                    <th style="width:75px;">Doc Date</th>
                    <th style="width:100px;">Doc Ref No.</th>
                    <th style="width:180px;padding-right:2px;">Narration</th>
                    <th class="num" style="width:80px;padding-left:2px;">Debit</th>
                    <th class="num" style="width:80px;">Credit</th>
                    <th class="num" style="width:90px;">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  ${bodyRows || `
                    <tr>
                      <td colspan="8" style="text-align:center;padding:24px;color:#999;">
                        No outstanding records found.
                      </td>
                    </tr>`}
                </tbody>
              </table>

              ${isLastBlock ? `
                <div class="footer">End of Report</div>
                <div class="powered-by">powered by A W A R E</div>` : ""}
            </div>`;
        });

        if (acEntries.length === 0) {
            blocksHtml = `
            <div class="statement-block">
              <div style="text-align:center;padding:60px;color:#999;">
                No records found for the selected criteria.
              </div>
              <div class="footer">End of Report</div>
              <div class="powered-by">powered by A W A R E</div>
            </div>`;
        }

        // ─── Final HTML ───────────────────────────────────────────────────
        const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Outstanding Statement Detail</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
      font-size:11px; color:#222; margin:30px; background:#f5f5f5;
    }
    .statement-block {
      background:white; padding:32px 36px; margin-bottom:24px;
      box-shadow:0 0 10px rgba(0,0,0,.1); min-height:auto;
    }

    /* ── Header ── */
    .report-header {
      display:flex; justify-content:space-between; align-items:flex-start;
      border-bottom:2px solid #333; padding-bottom:12px; margin-bottom:14px;
    }
    .company-name { font-size:18px; font-weight:700; color:#185FA5; }
    .company-sub  { font-size:10px; letter-spacing:2px; color:#555; }
    .meta-table td { padding:2px 8px 2px 0; vertical-align:top; font-size:11px; }
    .meta-label    { font-weight:600; color:#555; min-width:70px; }

    /* ── Customer block ── */
    .customer-block { margin-bottom:14px; }
    .customer-name { font-size:12px; font-weight:700; margin-bottom:4px; }
    .customer-address { font-size:11px; color:#333; line-height:1.5; margin-bottom:8px; }
    .contact-table { width:100%; font-size:11px; border-collapse:collapse; }
    .contact-table td { padding:2px 6px 2px 0; vertical-align:top; }
    .contact-label { font-weight:600; color:#555; white-space:nowrap; }
    .right-label { text-align:right; }
    .right-value { text-align:right; font-family:'Courier New',monospace; }

    /* ── Table ── */
    table.report-table { width:100%; border-collapse:collapse; margin-top:8px; }
    table.report-table thead tr th {
      border:none;
      padding:8px 6px; text-align:center; background:#1E3A5F; color:#fff;
      font-size:11px; font-weight:700; text-transform:none; white-space:nowrap;
    }
    table.report-table thead tr:first-child th:first-child { border-top-left-radius:4px; }
    table.report-table thead tr:first-child th:last-child  { border-top-right-radius:4px; }
    table.report-table td {
      padding:4px 5px; vertical-align:middle;
      border-bottom:0.5px solid #f0f0f0;
      font-size:11px;
    }
    .narration-cell { white-space:normal; padding-right:2px; }
    table.report-table td.num:nth-of-type(6) { padding-left:2px; }
    .num { text-align:right !important; font-family:'Courier New',monospace; }
    .neg-balance { color:#c0392b; }
    .detail-row:hover td { background:#f9f9f9; }

    /* ── Footer ── */
    .footer     { margin-top:24px; text-align:center; font-weight:600; border-top:1px solid #333; padding-top:8px; font-size:11px; color:#555; }
    .powered-by { text-align:right; font-size:10px; color:#aaa; margin-top:4px; }

    @media print {
      body { background:white; margin:0; }
      .statement-block { box-shadow:none; padding:16px; }
      .no-print { display:none; }
    }
  </style>
</head>
<body>

<div class="no-print" style="margin-bottom:16px;text-align:right;">
  <button onclick="window.print()"
    style="padding:7px 20px;cursor:pointer;background:#185FA5;color:#fff;border:none;border-radius:5px;font-size:12px;">
    Print / Save PDF
  </button>
</div>

${blocksHtml}

</body>
</html>`;

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