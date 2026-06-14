import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const text = (v: any): string => (v == null ? "" : String(v));

const formatDateStr = (v: any): string => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface VisaRow {
    employee_code: string;
    rpt_name: string;
    join_date: string;
    div_name: string;
    dept_name: string;
    section_name: string;
    desg_name: string;
    grade_name: string;
    sponsor_name: string;
    labourcard_no: string;
    labourcard_valid_from: string;
    labourcard_valid_to: string;
    visa_valid_from: string;
    visa_valid_to: string;
    days_remaining: number;
    status: string;
}

// ─── Status badge style ───────────────────────────────────────────────────────

const statusStyle = (status: string): string => {
    const s = (status || "").toLowerCase();
    if (s.includes("expir") && s.includes("today"))
        return "background:#fef3c7;color:#92400e;border:1px solid #fde68a;";
    if (s.includes("expir"))
        return "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;";
    if (s.includes("critical"))
        return "background:#ffedd5;color:#9a3412;border:1px solid #fdba74;";
    return "background:#dcfce7;color:#166534;border:1px solid #86efac;";
};

// ─── Build HTML ───────────────────────────────────────────────────────────────

const buildVisaExpiryHTML = (
    rows: VisaRow[],
    params: {
        loginid: string;
        division: string;
        department: string;
        date_from: string;
        date_to: string;
        emp_type: string;
    }
): string => {

    const totalRecords = rows.length;
    const totalExpired = rows.filter((r) => Number(r.days_remaining) < 0).length;
    const totalWarn = rows.filter((r) => Number(r.days_remaining) >= 0 && Number(r.days_remaining) <= 30).length;
    const totalOk = rows.filter((r) => Number(r.days_remaining) > 30).length;

    const tableBodyHtml = rows.map((r, i) => `
        <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">
            <td class="center">${i + 1}</td>
            <td><strong>${text(r.employee_code)}</strong></td>
            <td>${text(r.rpt_name)}</td>
            <td class="center">${formatDateStr(r.join_date)}</td>
            <td>${text(r.div_name)}</td>
            <td>${text(r.dept_name)}</td>
            <td>${text(r.section_name)}</td>
            <td>${text(r.grade_name)}</td>
            <td>${text(r.desg_name)}</td>
            <td>${text(r.sponsor_name)}</td>
            <td class="center">${text(r.labourcard_no)}</td>
            <td class="center">${formatDateStr(r.labourcard_valid_from)}</td>
            <td class="center">${formatDateStr(r.labourcard_valid_to)}</td>
            <td class="center">${formatDateStr(r.visa_valid_from)}</td>
            <td class="center ${Number(r.days_remaining) < 0 ? "neg" : Number(r.days_remaining) <= 30 ? "warn" : ""}">
                ${formatDateStr(r.visa_valid_to)}
            </td>
            <td class="center ${Number(r.days_remaining) < 0 ? "neg" : Number(r.days_remaining) <= 30 ? "warn" : ""}">
                ${text(r.days_remaining)}
            </td>
            <td class="center">
                <span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;${statusStyle(r.status)}">
                    ${text(r.status)}
                </span>
            </td>
        </tr>`
    ).join("") || `
        <tr>
            <td colspan="17" style="text-align:center;padding:40px;color:#6b7280;">
                No records found for the selected criteria.
            </td>
        </tr>`;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Visa Expiry Listing Report</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11px; color: #333; margin: 30px; background-color: #f5f5f5;
    }
    .page {
      background: white; padding: 36px 40px;
      box-shadow: 0 0 10px rgba(0,0,0,0.1); min-height: 297mm;
    }
    .header-top {
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 2px solid #185FA5; padding-bottom: 14px; margin-bottom: 18px;
    }
    .meta-info td { padding: 2px 10px 2px 0; vertical-align: top; }
    .lbl          { font-weight: 600; width: 100px; color: #555; }
    .brand-name   { font-size: 20px; font-weight: 700; color: #185FA5; letter-spacing: 0.02em; }
    .brand-sub    { font-size: 9px; letter-spacing: 3px; color: #888; margin-top: 2px; }
    .report-title { font-size: 14px; font-weight: 700; color: #185FA5; margin-bottom: 6px; }

    .stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .stat-box  { flex: 1; padding: 10px 14px; border-radius: 8px; border: 0.5px solid #e5e7eb; background: #fff; }
    .stat-box .stat-num { font-size: 20px; font-weight: 700; }
    .stat-box .stat-lbl { font-size: 10px; color: #6b7280; margin-top: 2px; }
    .stat-total   { border-color: #bcd4f0; background: #f0f6ff; }
    .stat-total   .stat-num { color: #185FA5; }
    .stat-expired { border-color: #fca5a5; background: #fef2f2; }
    .stat-expired .stat-num { color: #dc2626; }
    .stat-warn    { border-color: #fdba74; background: #fff7ed; }
    .stat-warn    .stat-num { color: #d97706; }
    .stat-ok      { border-color: #86efac; background: #f0fdf4; }
    .stat-ok      .stat-num { color: #16a34a; }

    table.report-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 10px; }
    table.report-table th {
      background: #185FA5; color: #fff; padding: 7px 5px;
      text-align: left; font-size: 9px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em; border: none; white-space: nowrap;
    }
    table.report-table th.center,
    table.report-table td.center { text-align: center; }
    table.report-table td { padding: 5px 5px; vertical-align: middle; border-bottom: 0.5px solid #e5e7eb; }
    .row-even td { background: #fff; }
    .row-odd  td { background: #f8fafc; }
    tr:hover  td { background: #eef4fd !important; }
    td.neg  { color: #dc2626; font-weight: 600; }
    td.warn { color: #d97706; font-weight: 600; }

    .footer {
      margin-top: 32px; display: flex; justify-content: space-between;
      border-top: 1px solid #d1d5db; padding-top: 10px; font-size: 10px; color: #9ca3af;
    }
    .footer strong { color: #6b7280; }
    .no-print { margin-bottom: 16px; text-align: right; }

    @media print {
      body        { background: white; margin: 0; font-size: 9px; }
      .page       { box-shadow: none; padding: 16px; }
      .no-print   { display: none; }
      tr:hover td { background: inherit !important; }
      .stats-row  { break-inside: avoid; }
      thead       { display: table-header-group; }
    }
  </style>
</head>
<body>

  <div class="no-print">
    <button onclick="window.print()"
      style="padding:7px 20px;cursor:pointer;background:#185FA5;color:#fff;border:none;border-radius:6px;font-size:12px;">
      🖨 Print / Save as PDF
    </button>
  </div>

  <div class="page">

    <div class="header-top">
      <div>
        <div class="report-title">Visa Expiry Listing Report</div>
        <table class="meta-info">
          <tr><td class="lbl">Period :</td>     <td><strong>${formatDateStr(params.date_from)} &nbsp;&ndash;&nbsp; ${formatDateStr(params.date_to)}</strong></td></tr>
          <tr><td class="lbl">Division :</td>   <td>${text(params.division) || "All"}</td></tr>
          <tr><td class="lbl">Department :</td> <td>${text(params.department) || "All"}</td></tr>
          <tr><td class="lbl">Emp. Type :</td>  <td>${params.emp_type === "A" ? "Active Employees" : "All Employees"}</td></tr>
          <tr><td class="lbl">Printed on :</td> <td>${formatDateStr(new Date())}</td></tr>
          <tr><td class="lbl">User :</td>        <td>${text(params.loginid)}</td></tr>
        </table>
      </div>
      <div style="text-align:right;">
        <div class="brand-name">AL MADINA</div>
        <div class="brand-sub">LOGISTICS</div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-box stat-total">
        <div class="stat-num">${totalRecords}</div>
        <div class="stat-lbl">Total Records</div>
      </div>
      <div class="stat-box stat-expired">
        <div class="stat-num">${totalExpired}</div>
        <div class="stat-lbl">Already Expired</div>
      </div>
      <div class="stat-box stat-warn">
        <div class="stat-num">${totalWarn}</div>
        <div class="stat-lbl">Expiring &le; 30 Days</div>
      </div>
      <div class="stat-box stat-ok">
        <div class="stat-num">${totalOk}</div>
        <div class="stat-lbl">Expiring &gt; 30 Days</div>
      </div>
    </div>

    <table class="report-table">
      <thead>
        <tr>
          <th class="center" style="width:30px;">#</th>
          <th style="width:75px;">Emp. Code</th>
          <th style="min-width:120px;">Employee Name</th>
          <th class="center" style="width:75px;">Join Date</th>
          <th style="width:70px;">Division</th>
          <th style="width:90px;">Department</th>
          <th style="width:75px;">Section</th>
          <th style="width:65px;">Grade</th>
          <th style="width:100px;">Designation</th>
          <th style="width:90px;">Sponsor</th>
          <th class="center" style="width:85px;">Labour Card No.</th>
          <th class="center" style="width:75px;">LC From</th>
          <th class="center" style="width:75px;">LC To</th>
          <th class="center" style="width:75px;">Visa From</th>
          <th class="center" style="width:75px;">Visa To</th>
          <th class="center" style="width:60px;">Days Left</th>
          <th class="center" style="width:80px;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${tableBodyHtml}
      </tbody>
    </table>

    <div class="footer">
      <div><strong>Total records:</strong> ${totalRecords}</div>
      <div>End of Report &nbsp;|&nbsp; Printed: ${formatDateStr(new Date())}</div>
    </div>

  </div>
</body>
</html>`;
};

// ─── Express Controller ───────────────────────────────────────────────────────
// Uses PROC_BUILD_DYNAMIC_SQL_COMMON20 — identical pattern to P&L report

export const getVisaExpiryReport = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        const {
            parameter,  // "Hr_Report_VISA_EXPIRY_REPORT"
            loginid,
            code1,      // company_code
            code2,      // div_code
            code3,      // dept_code
            code4,      // section_code
            code5,      // grade_code
            code6,      // desg_code
            code7,      // emp_code
            code8,      // sponsor_id
            code9,      // emp_status ("A" | "All")
            date1,      // visa_expiry_from (YYYY-MM-DD)
            date2,      // visa_expiry_to   (YYYY-MM-DD)
        } = req.body;

        // ── DB connection (identical to P&L) ─────────────────────────────────
        let tenantId = getCurrentTenantId();
        if (!tenantId && loginid) {
            tenantId = await TenantManager.getTenantForUser(loginid);
        }
        if (!tenantId) {
            res.status(400).json({ success: false, message: "Tenant not found" });
            return;
        }
        connection = await TenantManager.getConnection(tenantId);

        // ── Build binds (identical pattern to P&L) ───────────────────────────
        const binds: any = {
            parameter: parameter || "Hr_Report_VISA_EXPIRY_REPORT",
            loginid: loginid || "ADMIN",
            code1: code1 || null,
            code2: code2 || null,
            code3: code3 || null,
            code4: code4 || null,
            code5: code5 || null,
            code6: code6 || null,
            code7: code7 || null,
            code8: code8 || null,
            code9: code9 || null,
            out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
        };

        // Fill remaining slots to avoid Oracle binding errors (same as P&L)
        for (let i = 10; i <= 20; i++) {
            binds[`code${i}`] = req.body[`code${i}`] || null;
        }
        for (let i = 1; i <= 4; i++) {
            binds[`number${i}`] = req.body[`number${i}`] || null;
        }
        binds["date1"] = date1 ? new Date(date1) : null;
        binds["date2"] = date2 ? new Date(date2) : null;
        binds["date3"] = req.body["date3"] || null;
        binds["date4"] = req.body["date4"] || null;

        // ── Call PROC_BUILD_DYNAMIC_SQL_COMMON20 (identical to P&L) ──────────
        const result = await connection.execute(
            `DECLARE
               v_sql VARCHAR2(32767);
             BEGIN
               PROC_BUILD_DYNAMIC_SQL_COMMON20(
                 :parameter, :loginid,
                 :code1,  :code2,  :code3,  :code4,  :code5,  :code6,  :code7,  :code8,  :code9,  :code10,
                 :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
                 :number1, :number2, :number3, :number4,
                 :date1,   :date2,   :date3,   :date4,
                 v_sql
               );
               :out_sql := v_sql;
             END;`,
            binds
        );

        const rawSql = (result.outBinds as any).out_sql;
        console.log("[VisaExpiryReport] Generated SQL:", rawSql);

        if (!rawSql) {
            throw new Error(
                "PROC_BUILD_DYNAMIC_SQL_COMMON20 returned no SQL. " +
                "Ensure the WHEN 'Hr_Report_VISA_EXPIRY_REPORT' branch exists in the procedure."
            );
        }

        // ── Execute the generated SQL (identical to P&L) ─────────────────────
        const dataResult = await connection.execute(rawSql, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        const rows: VisaRow[] = (dataResult.rows as any[]).map((row) =>
            Object.keys(row).reduce((acc: any, key) => {
                acc[key.toLowerCase()] = row[key];
                return acc;
            }, {})
        );

        if (!rows.length) {
            res.status(200).json({
                success: false,
                message: "No data found for the selected criteria.",
            });
            return;
        }

        // ── Build & send HTML ─────────────────────────────────────────────────
        const html = buildVisaExpiryHTML(rows, {
            loginid: loginid || "ADMIN",
            division: code2 || "",
            department: code3 || "",
            date_from: date1 || "",
            date_to: date2 || "",
            emp_type: code9 || "A",
        });

        res.setHeader("Content-Type", "text/html");
        res.status(200).send(html);

    } catch (error: any) {
        console.error("Visa Expiry Report Error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to generate report",
            details: error.message,
        });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
};