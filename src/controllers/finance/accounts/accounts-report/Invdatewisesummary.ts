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

export const InvdatewiseSummary = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        /*
         * Frontend (PeriodWisePage → reportValues) sends:
         *   loginid             → loginid
         *   company_code        → code1
         *   div_code            → code2
         *   ac_codes            → code3   (comma-sep or "All")
         *   l4_codes            → code4   (comma-sep or "All")
         *   as_on_date_oracle   → code6   e.g. "07-JUN-2026"
         *   date_type           → code7   "inv" | "due"
         *   option              → code8   "summary"
         *
         * Procedure parameter:
         *   "Account_Report_VW_PERIODWISE_INV_SUMMARY"
         *
         * SQL returns:
         *   l4_code, l4_description, ac_code, ac_name,
         *   credit_amount, credit_period, dept_code,
         *   salesman_code, salesman_name,
         *   age_30, age_60, age_90, age_120, age_160, age_200, age_above,
         *   un_allocated_amt,
         *   div_code, company_code
         */
        const {
            loginid,
            code1, code2, code3, code4, code5, code6,
            code7, code8, code9, code10, code11, code12, code13, code14,
            code15, code16,
        } = req.body;

        const parameter = "Account_Report_VW_PERIODWISE_INV_SUMMARY";

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

        // 3. Binds
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

        // 4. Execute procedure → dynamic SQL
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

        // 5. Execute dynamic SQL
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


         const formatBalance = (value: number) => {
      return value < 0
        ? `(${money(Math.abs(value))})`
        : money(value);
    };

        // ─── Age bucket labels (matching PDF header) ──────────────────────
        const ageLabels = [
            "Below 30",
            "30 - 60",
            "60 - 90",
            "90 - 120",
            "120 - 160",
            "160 - 200",
            "Above 200",
        ];

        // ─── Group rows by l4_code ────────────────────────────────────────
        // Summary: 1 row per ac_code (SQL already groups by ac_code)
        type SummaryRow = (typeof rows)[0];
        type L4Group = {
            l4_code: string;
            l4_description: string;
            rows: SummaryRow[];
        };

        const l4Map = new Map<string, L4Group>();

        rows.forEach((r) => {
            const l4Key  = text(r.l4_code);
            const l4Desc = text(r.l4_description);

            if (!l4Map.has(l4Key)) {
                l4Map.set(l4Key, { l4_code: l4Key, l4_description: l4Desc, rows: [] });
            }
            l4Map.get(l4Key)!.rows.push(r);
        });

        // ─── Build HTML body ──────────────────────────────────────────────
        let tableBodyHtml = "";

        // Grand totals
        let grandUnalloc = 0;
        let grand30 = 0, grand60 = 0, grand90 = 0;
        let grand120 = 0, grand160 = 0, grand200 = 0, grandAbove = 0;
        let grandTotal = 0;

        l4Map.forEach((l4) => {
            // ── L4 section header ─────────────────────────────────────────
            tableBodyHtml += `
            <tr class="l4-header">
              <td colspan="12">
                <strong>${l4.l4_code}&nbsp;&nbsp;${l4.l4_description}</strong>
              </td>
            </tr>`;

            let l4Unalloc = 0;
            let l430 = 0, l460 = 0, l490 = 0;
            let l4120 = 0, l4160 = 0, l4200 = 0, l4Above = 0;
            let l4Total = 0;

            l4.rows.forEach((r) => {
                // Direct SQL column names
                const unalloc  = num(r.un_allocated_amt);
                const a30      = num(r.age_30);
                const a60      = num(r.age_60);
                const a90      = num(r.age_90);
                const a120     = num(r.age_120);
                const a160     = num(r.age_160);
                const a200     = num(r.age_200);
                const aAbove   = num(r.age_above);
                const rowTotal = a30 + a60 + a90 + a120 + a160 + a200 + aAbove;

                l4Unalloc += unalloc;
                l430 += a30; l460 += a60; l490 += a90;
                l4120 += a120; l4160 += a160; l4200 += a200; l4Above += aAbove;
                l4Total += rowTotal;

                tableBodyHtml += `
                <tr class="detail-row">
                  <td class="ac-cell">
                    <span class="ac-code">${text(r.ac_code)}</span>
                    <span class="ac-name">${text(r.ac_name)}</span>
                  </td>
                  <td>${text(r.salesman_name)}</td>
                  <td>${text(r.dept_code)}</td>
                  <td class="num">${formatBalance(r.credit_amount)}</td>
                  <td class="num">${text(r.credit_period)}</td>
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

            // ── L4 total ──────────────────────────────────────────────────
            tableBodyHtml += `
            <tr class="l4-total-row">
              <td colspan="5"><strong>Total for ${l4.l4_description}</strong></td>
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
            <tr><td colspan="14" style="height:8px;border:none;"></td></tr>`;

            grandUnalloc += l4Unalloc;
            grand30 += l430; grand60 += l460; grand90 += l490;
            grand120 += l4120; grand160 += l4160; grand200 += l4200; grandAbove += l4Above;
            grandTotal += l4Total;
        });

        // ── Grand total ───────────────────────────────────────────────────
        tableBodyHtml += `
        <tr class="grand-total-row">
          <td colspan="5"><strong>Grand Total :</strong></td>
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

        // ─── Age header cells ─────────────────────────────────────────────
        const ageHeaderCells = ageLabels
            .map((lbl) => `<th class="num" style="min-width:80px;">${lbl}</th>`)
            .join("");

        // ─── Final HTML ───────────────────────────────────────────────────
        const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Period Wise Summary Report</title>
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
      padding:6px 5px; text-align:left; background:#fff;
      font-size:10px; text-transform:uppercase; white-space:nowrap;
    }
    table.report-table td {
      padding:5px 5px; vertical-align:middle;
      border-bottom:0.5px solid #f0f0f0;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      font-size:11px;
    }
    .num { text-align:right !important; font-family:'Courier New',monospace; }

    /* ── A/c code + name in one cell ── */
    .ac-cell { white-space:nowrap; }
    .ac-code { font-weight:600; margin-right:6px; }
    .ac-name { color:#333; }

    /* ── Row types ── */
    .l4-header td {
      background:#efefef; border-top:1.5px solid #333;
      border-bottom:1px solid #bbb; padding:6px 8px; font-size:12px;
    }
    .detail-row:hover td { background:#f9f9f9; }
    .l4-total-row td {
      border-top:1.5px solid #555; border-bottom:2px solid #555;
      background:#f3f3f3; padding:5px 5px;
    }
    .grand-total-row td {
      border-top:2.5px double #333; border-bottom:2.5px double #333;
      background:#eef4fb; padding:6px 5px; font-size:12px;
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
    &nbsp;|&nbsp; Summary
  </div>

  <!-- ── Main table ── -->
  <table class="report-table">
    <thead>
      <tr>
        <th style="width:200px;">A/C Code</th>
        <th style="width:90px;">Salesperson</th>
        <th style="width:55px;">Dept.</th>
        <th class="num" style="width:80px;">Credit Limit</th>
        <th class="num" style="width:55px;">Credit Period</th>
        <th class="num" style="width:90px;">Un-Allocated</th>
        ${ageHeaderCells}
        <th class="num" style="width:90px;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${tableBodyHtml || `
        <tr>
          <td colspan="14" style="text-align:center;padding:40px;color:#999;">
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
        console.error("Inv Date Wise Summary Report Error:", error);
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