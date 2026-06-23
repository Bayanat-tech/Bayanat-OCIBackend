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

// Negative balances shown in parentheses e.g. (3,486.021)
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

export const AcStatementReport = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        /*
         * Frontend sends:
         *   loginid             → loginid
         *   company_code        → code1
         *   div_code            → code2   (comma-sep or "All")
         *   ac_codes            → code3   (comma-sep or "All")
         *   l4_codes            → code4   (comma-sep or "All")
         *   from_date           → code5   e.g. "01-JUN-2025"
         *   to_date             → code6   e.g. "09-JUN-2026"
         *
         * Procedure parameter:
         *   "Account_Report_AC_StatementReport"
         *
         * SQL returns (per row / per inv_no):
         *   company_code, ac_code, ac_name,
         *   div_code, div_name, curr_code,
         *   inv_no, inv_date, doc_date, doc_type, doc_no,
         *   debit_amount, credit_amount, balance_amount, running_balance,
         *   company_name, address1, address2, address3,
         *   email, fax_no, tel_no,
         *   company_short_name, signatory_1, signatory_2
         */
        const {
            loginid,
            code1, code2, code3, code4, code5, code6,
            code7, code8, code9, code10, code11, code12, code13, code14,
            code15, code16,
        } = req.body;

        const parameter = "Account_Report_AC_StatementReport";

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

        // Lowercase all Oracle column names
        const rows = (dataResult.rows as any[]).map((row) =>
            Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {})
        );

        // ── Group rows by ac_code ─────────────────────────────────────────
        type StatementRow = (typeof rows)[0];
        type AcGroup = {
            ac_code: string;
            ac_name: string;
            curr_code: string;
            rows: StatementRow[];
        };

        const acMap = new Map<string, AcGroup>();

        rows.forEach((r) => {
            const acKey = text(r.ac_code);
            if (!acMap.has(acKey)) {
                acMap.set(acKey, {
                    ac_code:   acKey,
                    ac_name:   text(r.ac_name),
                    curr_code: text(r.curr_code),
                    rows:      [],
                });
            }
            acMap.get(acKey)!.rows.push(r);
        });

        // ── Derive period string from code5 / code6 ───────────────────────
        const periodFrom = text(code5);
        const periodTo   = text(code6);
        const periodStr  = periodFrom && periodTo
            ? `${formatDateStr(periodFrom)} - ${formatDateStr(periodTo)}`
            : periodTo
                ? formatDateStr(periodTo)
                : "";

        // ── Build HTML body ───────────────────────────────────────────────
        let tableBodyHtml = "";

        acMap.forEach((ac) => {
            // ── Ac section header ─────────────────────────────────────────
            tableBodyHtml += `
            <tr class="ac-header-row">
              <td colspan="8">
                <strong>${ac.ac_code}&nbsp;&nbsp;&nbsp;${ac.ac_name}</strong>
              </td>
            </tr>`;

            let acDebitTotal  = 0;
            let acCreditTotal = 0;

            ac.rows.forEach((r) => {
                const debit    = num(r.debit_amount);
                const credit   = num(r.credit_amount);
                const runBal   = num(r.running_balance);

                acDebitTotal  += debit;
                acCreditTotal += credit;

                tableBodyHtml += `
                <tr class="detail-row">
                  <td class="div-cell">${text(r.div_code)}</td>
                  <td class="inv-cell">${text(r.inv_no)}</td>
                  <td class="date-cell">${formatDateStr(r.inv_date)}</td>
                  <td class="doctype-cell">${text(r.doc_type)}</td>
                  <td class="docno-cell">${text(r.doc_no)}</td>
                  <td class="date-cell">${formatDateStr(r.doc_date)}</td>
                  <td class="num">${debit  === 0 ? "0.000" : money(debit)}</td>
                  <td class="num">${credit === 0 ? "0.000" : money(credit)}</td>
                  <td class="num ${runBal < 0 ? "neg-balance" : ""}">${moneyBalance(runBal)}</td>
                </tr>`;
            });

            // ── Ac totals row ─────────────────────────────────────────────
            const acNetBalance = acDebitTotal - acCreditTotal;
            tableBodyHtml += `
            <tr class="ac-total-row">
              <td colspan="6"></td>
              <td class="num"><strong>${money(acDebitTotal)}</strong></td>
              <td class="num"><strong>${money(acCreditTotal)}</strong></td>
              <td class="num ${acNetBalance < 0 ? "neg-balance" : ""}"><strong>${moneyBalance(acNetBalance)}</strong></td>
            </tr>
            <tr><td colspan="9" style="height:10px;border:none;"></td></tr>`;
        });

        // ── Currency (from first row) ──────────────────────────────────────
        const currCode = rows.length > 0 ? text(rows[0].curr_code) : "OMR";

        // ─── Final HTML ───────────────────────────────────────────────────
        const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Statement of A/c Report</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
      font-size:11px; color:#222; margin:30px; background:#f5f5f5;
    }
    .page {
      background:white; padding:32px 36px;
      box-shadow:0 0 10px rgba(0,0,0,.1); min-height:297mm;
    }

    /* ── Header ── */
    .report-header {
      display:flex; justify-content:space-between; align-items:flex-start;
      border-bottom:2px solid #333; padding-bottom:12px; margin-bottom:6px;
    }
    .company-logo-area {
      display:flex; flex-direction:column; align-items:flex-end; gap:4px;
    }
    .company-name { font-size:18px; font-weight:700; color:#185FA5; }
    .company-sub  { font-size:10px; letter-spacing:2px; color:#555; }
    .meta-table td { padding:2px 8px 2px 0; vertical-align:top; font-size:11px; }
    .meta-label    { font-weight:600; color:#555; min-width:70px; }

    /* ── Currency line ── */
    .currency-line {
      text-align:right; font-size:11px; font-weight:700;
      margin-bottom:6px; padding-right:2px;
    }
    .currency-line span { color:#333; }

    /* ── Table ── */
    table.report-table { width:100%; border-collapse:collapse; }
    table.report-table thead tr th {
      border-top:1.5px solid #333; border-bottom:1.5px solid #333;
      padding:6px 5px; text-align:left; background:#fff;
      font-size:10px; text-transform:uppercase; white-space:nowrap;
    }
    table.report-table td {
      padding:4px 5px; vertical-align:middle;
      border-bottom:0.5px solid #f0f0f0;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      font-size:11px;
    }
    .num { text-align:right !important; font-family:'Courier New',monospace; }
    .neg-balance { color:#c0392b; }

    /* ── Column sizing ── */
    .div-cell    { width:28px;  color:#888; font-size:10px; }
    .inv-cell    { width:160px; }
    .date-cell   { width:80px;  }
    .doctype-cell{ width:42px;  }
    .docno-cell  { width:100px; }

    /* ── Row types ── */
    .ac-header-row td {
      background:#f5f5f5;
      border-top:1.5px solid #333;
      border-bottom:1px solid #ccc;
      padding:6px 8px; font-size:12px;
    }
    .detail-row:hover td { background:#f9f9f9; }
    .ac-total-row td {
      border-top:1.5px solid #555;
      border-bottom:2px solid #555;
      background:#f3f3f3; padding:5px 5px;
    }

    /* ── Footer ── */
    .footer     { margin-top:36px; text-align:center; font-weight:600; border-top:1px solid #333; padding-top:8px; font-size:11px; color:#555; }
    .powered-by { text-align:right; font-size:10px; color:#aaa; margin-top:4px; }

    @media print {
      body { background:white; margin:0; }
      .page { box-shadow:none; padding:16px; }
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

<div class="page">

  <!-- ── Page header ── -->
  <div class="report-header">
    <table class="meta-table">
      <tr>
        <td class="meta-label">Title :</td>
        <td><strong>Statement of A/c for the Period ${periodStr}</strong></td>
      </tr>
      <tr><td class="meta-label">Date :</td><td>${formatDateStr(new Date())}</td></tr>
      <tr><td class="meta-label">User :</td><td>${text(loginid)}</td></tr>
      <tr><td class="meta-label">Report :</td><td>${text(parameter)}</td></tr>
      <tr>
        <td class="meta-label">Currency :</td>
        <td><strong>${currCode}</strong></td>
      </tr>
    </table>
    <div class="company-logo-area">
      <div class="company-name">AL MADINA</div>
      <div class="company-sub">LOGISTICS</div>
    </div>
  </div>

  <!-- ── Main table ── -->
  <table class="report-table">
    <thead>
      <tr>
        <th style="width:28px;"></th>
        <th style="width:160px;">INV No.</th>
        <th style="width:80px;">INV Date</th>
        <th style="width:42px;">Doc<br>Type</th>
        <th style="width:100px;">Doc No.</th>
        <th style="width:80px;">Doc Date</th>
        <th class="num" style="width:90px;">Debit</th>
        <th class="num" style="width:90px;">Credit</th>
        <th class="num" style="width:95px;">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${tableBodyHtml || `
        <tr>
          <td colspan="9" style="text-align:center;padding:40px;color:#999;">
            No records found for the selected criteria.
          </td>
        </tr>`}
    </tbody>
  </table>

  <div class="footer">End of Report</div>
  <div class="powered-by">powered by A W A R E</div>
</div>

</body>
</html>`;

        res.setHeader("Content-Type", "text/html");
        res.status(200).send(reportHtml);

    } catch (error: any) {
        console.error("AC Statement Report Error:", error);
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