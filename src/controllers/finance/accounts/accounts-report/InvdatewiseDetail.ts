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

// ─── Controller ───────────────────────────────────────────────────────────────

export const InvdatewiseDetail = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        /*
         * Frontend (PeriodWisePage → reportValues) sends:
         *
         *   loginid             → loginid
         *   company_code        → code1
         *   div_code            → code2
         *   ac_codes            → code3   (comma-sep or "All")
         *   l4_codes            → code4   (comma-sep or "All")
         *   salesman_codes      → code5   (comma-sep or "All")
         *   as_on_date_oracle   → code6   e.g. "07-JUN-2026"
         *   date_type           → code7   "inv" | "due"
         *   option              → code8   "summary" | "detail"
         *   age1 … age6         → code9 … code14
         *   outstanding_list    → code15  "true"/"false"
         *   salesman_wise       → code16  "true"/"false"
         *
         * Procedure parameter used:
         *   "Account_Report_VW_PERIODWISE_INV_DETAIL"
         *
         * SQL returns these exact columns:
         *   l4_code, l4_description, ac_code, ac_name,
         *   inv_no, inv_date,
         *   age_30, age_60, age_90, age_120, age_160, age_200, age_above,
         *   org_amt, un_allocated_amt,
         *   credit_period, credit_amount,
         *   salesman_code, salesman_name, lpo,
         *   div_code, company_code
         */
        const {
            loginid,
            code1, code2, code3, code4, code5, code6,
            code7, code8, code9, code10, code11, code12, code13, code14,
            code15, code16,
        } = req.body;

        // Always use this parameter for period-wise report
        const parameter = "Account_Report_VW_PERIODWISE_INV_DETAIL";

        // 2. Tenant / connection
        let tenantId = getCurrentTenantId();
        if (!tenantId && loginid) {
            tenantId = await TenantManager.getTenantForUser(loginid);
        }
        if (!tenantId) {
            res.status(400).json({ success: false, message: "Tenant not found" });
            return;
        }
        connection = await TenantManager.getConnection(tenantId);

        // 3. Binds for PROC_BUILD_DYNAMIC_SQL_COMMON20
        const binds: any = {
            parameter,
            loginid: loginid || "ADMIN",
            code1:  code1  || null,  // company_code
            code2:  code2  || null,  // div_code
            code3:  code3  || null,  // ac_codes
            code4:  code4  || null,  // l4_codes
            code5:  code5  || null,  // salesman_codes
            code6:  code6  || null,  // as_on_date_oracle
            code7:  code7  || null,  // date_type
            code8:  code8  || null,  // option
            code9:  code9  || null,  // age1
            code10: code10 || null,  // age2
            code11: code11 || null,  // age3
            code12: code12 || null,  // age4
            code13: code13 || null,  // age5
            code14: code14 || null,  // age6
            code15: code15 || null,  // outstanding_list
            code16: code16 || null,  // salesman_wise
            code17: null, code18: null, code19: null, code20: null,
            number1: null, number2: null, number3: null, number4: null,
            date1: null,   date2: null,   date3: null,   date4: null,
            out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
        };

        // 4. Execute procedure → get dynamic SQL
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
        console.log("Generated SQL:", rawSql);

        // 5. Execute dynamic SQL → rows
        const dataResult = await connection.execute(rawSql, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        // Lowercase all column names (Oracle returns uppercase)
        const rows = (dataResult.rows as any[]).map((row) =>
            Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {})
        );

        const formatBalance = (value: number) => {
      return value < 0
        ? `(${money(Math.abs(value))})`
        : money(value);
    };

        // ─── Age bucket labels (header row uses fixed SQL buckets) ─────────
        // SQL has 7 buckets: <=30, 30-60, 60-90, 90-120, 120-160, 160-200, >200
        // (matching age_30, age_60, age_90, age_120, age_160, age_200, age_above)
        const ageLabels = [
            "Below 30",
            "30 - 60",
            "60 - 90",
            "90 - 120",
            "120 - 160",
            "160 - 200",
            "Above 200",
        ];

        // ─── Group: l4_code → ac_code → detail rows ───────────────────────
        type DetailRow = (typeof rows)[0];
        type AccGroup  = {
            ac_code: string; ac_name: string;
            credit_period: string; credit_amount: string;
            rows: DetailRow[];
        };
        type L4Group = {
            l4_code: string; l4_description: string;
            accounts: Map<string, AccGroup>;
        };

        const l4Map = new Map<string, L4Group>();

        rows.forEach((r) => {
            const l4Key  = text(r.l4_code);
            const l4Desc = text(r.l4_description);
            const acKey  = text(r.ac_code);

            if (!l4Map.has(l4Key)) {
                l4Map.set(l4Key, { l4_code: l4Key, l4_description: l4Desc, accounts: new Map() });
            }
            const l4 = l4Map.get(l4Key)!;

            if (!l4.accounts.has(acKey)) {
                l4.accounts.set(acKey, {
                    ac_code:        acKey,
                    ac_name:        text(r.ac_name),
                    credit_period:  text(r.credit_period  || "0.00"),
                    credit_amount:  text(r.credit_amount  || ""),
                    rows: [],
                });
            }
            l4.accounts.get(acKey)!.rows.push(r);
        });

        // ─── Build HTML body ──────────────────────────────────────────────
        let tableBodyHtml = "";

        // Grand totals
        let grandOrgAmt   = 0;
        let grandUnalloc  = 0;
        let grand30       = 0, grand60 = 0, grand90 = 0;
        let grand120      = 0, grand160 = 0, grand200 = 0, grandAbove = 0;
        let grandTotal    = 0;

        l4Map.forEach((l4) => {
            // ── L4 section header ─────────────────────────────────────────
            tableBodyHtml += `
            <tr class="l4-header">
              <td colspan="13">
                <strong>${l4.l4_code}&nbsp;&nbsp;${l4.l4_description}</strong>
              </td>
            </tr>`;

            let l4OrgAmt  = 0, l4Unalloc = 0;
            let l430 = 0, l460 = 0, l490 = 0, l4120 = 0, l4160 = 0, l4200 = 0, l4Above = 0;
            let l4Total = 0;

            l4.accounts.forEach((ac) => {
                // ── Account header ────────────────────────────────────────
                tableBodyHtml += `
                <tr class="ac-header">
                  <td colspan="13">
                    <strong>${ac.ac_code}&nbsp;&nbsp;${ac.ac_name}</strong>
                    <span class="credit-info">
                      Credit Period : ${ac.credit_period} &nbsp;&nbsp;
                      Credit Limit : ${ac.credit_amount}
                    </span>
                  </td>
                </tr>`;

                let acOrgAmt  = 0, acUnalloc = 0;
                let ac30 = 0, ac60 = 0, ac90 = 0, ac120 = 0, ac160 = 0, ac200 = 0, acAbove = 0;
                let acTotal = 0;

                ac.rows.forEach((r) => {
                    // Direct SQL column names (exact match)
                    const orgAmt  = num(r.org_amt);
                    const unalloc = num(r.un_allocated_amt);
                    const a30     = num(r.age_30);
                    const a60     = num(r.age_60);
                    const a90     = num(r.age_90);
                    const a120    = num(r.age_120);
                    const a160    = num(r.age_160);
                    const a200    = num(r.age_200);
                    const aAbove  = num(r.age_above);
                    const rowTotal = a30 + a60 + a90 + a120 + a160 + a200 + aAbove;

                    acOrgAmt  += orgAmt;
                    acUnalloc += unalloc;
                    ac30 += a30; ac60 += a60; ac90 += a90;
                    ac120 += a120; ac160 += a160; ac200 += a200; acAbove += aAbove;
                    acTotal += rowTotal;

                    tableBodyHtml += `
                    <tr class="detail-row">
                      <td style="padding-left:18px;">${text(r.inv_no)}</td>
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
                      <td style="font-size:10px;color:#666;">${text(r.salesman_name)}</td>
                    </tr>`;
                });

                // ── Account total ─────────────────────────────────────────
                tableBodyHtml += `
                <tr class="ac-total-row">
                  <td><strong>Total for ${ac.ac_name}</strong></td>
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

                l4OrgAmt += acOrgAmt; l4Unalloc += acUnalloc;
                l430 += ac30; l460 += ac60; l490 += ac90;
                l4120 += ac120; l4160 += ac160; l4200 += ac200; l4Above += acAbove;
                l4Total += acTotal;
            });

            // ── L4 total ──────────────────────────────────────────────────
            tableBodyHtml += `
            <tr class="l4-total-row">
              <td><strong>Total for ${l4.l4_description}</strong></td>
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
            <tr><td colspan="13" style="height:10px;border:none;"></td></tr>`;

            grandOrgAmt += l4OrgAmt; grandUnalloc += l4Unalloc;
            grand30 += l430; grand60 += l460; grand90 += l490;
            grand120 += l4120; grand160 += l4160; grand200 += l4200; grandAbove += l4Above;
            grandTotal += l4Total;
        });

        // ── Grand total ───────────────────────────────────────────────────
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

        // ─── Age header cells ─────────────────────────────────────────────
        const ageHeaderCells = ageLabels
            .map((lbl) => `<th class="num" style="min-width:80px;">${lbl}</th>`)
            .join("");

        // ─── Final HTML ───────────────────────────────────────────────────
        const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Period Wise Ageing Report</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
      font-size:11px; color:#222;
      margin:30px; background:#f5f5f5;
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
    .company-name { font-size:18px; font-weight:700; color:#185FA5; }
    .company-sub  { font-size:10px; letter-spacing:2px; color:#555; }
    .meta-table td { padding:2px 8px 2px 0; vertical-align:top; font-size:11px; }
    .meta-label    { font-weight:600; color:#555; min-width:55px; }

    /* ── Title strip ── */
    .report-title-strip {
      background:#185FA5; color:#fff; font-size:12px; font-weight:600;
      padding:5px 10px; margin-bottom:10px; border-radius:3px;
    }

    /* ── Table ── */
    table.report-table { width:100%; border-collapse:collapse; }
    table.report-table th {
      border-top:1.5px solid #333; border-bottom:1.5px solid #333;
      padding:6px 4px; text-align:left; background:#fff;
      font-size:10px; text-transform:uppercase; white-space:nowrap;
    }
    table.report-table td {
      padding:4px 4px; vertical-align:top;
      border-bottom:0.5px solid #f0f0f0;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      font-size:11px;
    }
    .num { text-align:right !important; font-family:'Courier New',monospace; }

    /* ── Row types ── */
    .l4-header td {
      background:#efefef; border-top:1.5px solid #333;
      border-bottom:1px solid #bbb; padding:6px 8px; font-size:12px;
    }
    .ac-header td {
      background:#fff; border-bottom:1px dashed #ccc; padding:5px 8px;
    }
    .credit-info { font-size:10px; color:#777; margin-left:16px; }
    .detail-row:hover td { background:#f9f9f9; }
    .ac-total-row td {
      border-top:1px solid #999; border-bottom:2px solid #999; background:#fafafa;
    }
    .l4-total-row td {
      border-top:1.5px solid #555; border-bottom:2px solid #555; background:#f3f3f3;
    }
    .grand-total-row td {
      border-top:2.5px double #333; border-bottom:2.5px double #333;
      background:#eef4fb; padding:6px 4px; font-size:12px;
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
      <tr><td class="meta-label">Title :</td><td><strong>Ageing as on ${text(code6)}</strong></td></tr>
      <tr><td class="meta-label">Date :</td><td>${formatDateStr(new Date())}</td></tr>
      <tr><td class="meta-label">User :</td><td>${text(loginid)}</td></tr>
      <tr><td class="meta-label">Report :</td><td>${text(parameter)}</td></tr>
    </table>
    <div style="text-align:right;">
      <div class="company-name">AL MADINA</div>
      <div class="company-sub">LOGISTICS</div>
    </div>
  </div>

  <!-- ── Title strip ── -->
  <div class="report-title-strip">
    Ageing as on ${text(code6)}
    &nbsp;|&nbsp; Division: ${text(code2) || "All"}
    &nbsp;|&nbsp; ${text(code7) === "due" ? "Due Date Wise" : "INV Date Wise"}
    &nbsp;|&nbsp; ${text(code8) === "summary" ? "Summary" : "Detail"}
  </div>

  <!-- ── Main table ── -->
  <table class="report-table">
    <thead>
      <tr>
        <th style="width:130px;">A/C Code / Inv No</th>
        <th class="num" style="width:75px;">Inv Date</th>
        <th class="num" style="width:90px;">Inv Amount</th>
        <th class="num" style="width:90px;">Un-Allocated</th>
        ${ageHeaderCells}
        <th class="num" style="width:90px;">Total</th>
        <th style="width:80px;">Salesperson</th>
      </tr>
    </thead>
    <tbody>
      ${tableBodyHtml || `
        <tr>
          <td colspan="13" style="text-align:center;padding:40px;color:#999;">
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
        console.error("Period Wise Report Error:", error);
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