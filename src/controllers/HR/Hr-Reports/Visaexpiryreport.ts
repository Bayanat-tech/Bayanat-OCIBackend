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
    employee_id:      string;
    employee_name:    string;
    division:         string;
    department:       string;
    section:          string;
    grade:            string;
    designation:      string;
    sponsor:          string;
    visa_no:          string;
    visa_expiry_date: string;
    days_remaining:   number;
    status:           string;
}

// ─── Status badge style ───────────────────────────────────────────────────────

const statusStyle = (status: string): string => {
    const s = (status || "").toLowerCase();
    if (s.includes("expir") && s.includes("today"))
        return "background:#fef3c7;color:#92400e;border:1px solid #fde68a;";
    if (s.includes("expir"))
        return "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;";
    if (s.includes("critical") || s.includes("urgent"))
        return "background:#ffedd5;color:#9a3412;border:1px solid #fdba74;";
    return "background:#dcfce7;color:#166534;border:1px solid #86efac;";
};

// ─── Build SQL directly (no procedure needed) ────────────────────────────────

const buildVisaExpirySql = (p: {
    company_code: string;
    div_code:     string;
    dept_code:    string;
    section_code: string;
    grade_code:   string;
    desg_code:    string;
    emp_id:       string;
    sponsor_code: string;
    emp_type:     string;
    date_from:    string;
    date_to:      string;
}): string => {

    const esc   = (v: string) => v.replace(/'/g, "''");
    const has   = (v: string) => v && v.trim() !== "" && v.trim().toUpperCase() !== "ALL";

    let sql = `
        SELECT
            e.EMPLOYEE_ID,
            e.EMPLOYEE_NAME,
            e.DIVISION,
            e.DEPARTMENT,
            e.SECTION,
            e.GRADE,
            e.DESIGNATION,
            e.SPONSOR,
            e.VISA_NO,
            e.VISA_EXPIRY_DATE,
            TRUNC(e.VISA_EXPIRY_DATE) - TRUNC(SYSDATE) AS DAYS_REMAINING,
            CASE
                WHEN TRUNC(e.VISA_EXPIRY_DATE) < TRUNC(SYSDATE)        THEN 'Expired'
                WHEN TRUNC(e.VISA_EXPIRY_DATE) = TRUNC(SYSDATE)        THEN 'Expiring Today'
                WHEN TRUNC(e.VISA_EXPIRY_DATE) <= TRUNC(SYSDATE) + 30  THEN 'Critical'
                ELSE 'Active'
            END AS STATUS
        FROM HR_VISA_EXPIRY_VW e
        WHERE e.COMPANY_CODE = '${esc(p.company_code)}'`;

    if (has(p.div_code))     sql += ` AND e.DIV_CODE       = '${esc(p.div_code.trim())}'`;
    if (has(p.dept_code))    sql += ` AND e.DEPT_CODE      = '${esc(p.dept_code.trim())}'`;
    if (has(p.section_code)) sql += ` AND e.SECTION_CODE   = '${esc(p.section_code.trim())}'`;
    if (has(p.grade_code))   sql += ` AND e.GRADE_CODE     = '${esc(p.grade_code.trim())}'`;
    if (has(p.desg_code))    sql += ` AND e.DESG_CODE      = '${esc(p.desg_code.trim())}'`;
    if (has(p.emp_id))       sql += ` AND e.EMPLOYEE_ID    = '${esc(p.emp_id.trim())}'`;
    if (has(p.sponsor_code)) sql += ` AND e.SPONSOR_CODE   = '${esc(p.sponsor_code.trim())}'`;

    if (p.emp_type === "A")  sql += ` AND e.EMPLOYEE_STATUS = 'A'`;

    if (has(p.date_from))
        sql += ` AND TRUNC(e.VISA_EXPIRY_DATE) >= TO_DATE('${esc(p.date_from.trim())}','YYYY-MM-DD')`;
    if (has(p.date_to))
        sql += ` AND TRUNC(e.VISA_EXPIRY_DATE) <= TO_DATE('${esc(p.date_to.trim())}','YYYY-MM-DD')`;

    sql += ` ORDER BY e.VISA_EXPIRY_DATE ASC, e.EMPLOYEE_NAME ASC`;

    return sql;
};

// ─── Build HTML ───────────────────────────────────────────────────────────────

const buildVisaExpiryHTML = (
    rows: VisaRow[],
    params: {
        loginid:    string;
        division:   string;
        department: string;
        date_from:  string;
        date_to:    string;
        emp_type:   string;
    }
): string => {

    const tableBodyHtml = rows.map((r, i) => `
        <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">
            <td class="center">${i + 1}</td>
            <td><strong>${text(r.employee_id)}</strong></td>
            <td>${text(r.employee_name)}</td>
            <td>${text(r.division)}</td>
            <td>${text(r.department)}</td>
            <td>${text(r.section)}</td>
            <td>${text(r.grade)}</td>
            <td>${text(r.designation)}</td>
            <td>${text(r.sponsor)}</td>
            <td class="center">${text(r.visa_no)}</td>
            <td class="center">${formatDateStr(r.visa_expiry_date)}</td>
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
            <td colspan="13" style="text-align:center;padding:40px;color:#6b7280;">
                No records found for the selected criteria.
            </td>
        </tr>`;

    const totalRecords = rows.length;
    const totalExpired = rows.filter((r) => Number(r.days_remaining) < 0).length;
    const totalWarn    = rows.filter((r) => Number(r.days_remaining) >= 0 && Number(r.days_remaining) <= 30).length;
    const totalOk      = rows.filter((r) => Number(r.days_remaining) > 30).length;

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

    table.report-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 10.5px; }
    table.report-table th {
      background: #185FA5; color: #fff; padding: 8px 6px;
      text-align: left; font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em; border: none; white-space: nowrap;
    }
    table.report-table th.center,
    table.report-table td.center { text-align: center; }
    table.report-table td { padding: 6px 6px; vertical-align: middle; border-bottom: 0.5px solid #e5e7eb; }
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
      body        { background: white; margin: 0; font-size: 10px; }
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
          <tr><td class="lbl">Division :</td>   <td>${text(params.division)   || "All"}</td></tr>
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
          <th class="center" style="width:36px;">#</th>
          <th style="width:90px;">Emp. ID</th>
          <th style="min-width:130px;">Employee Name</th>
          <th style="width:80px;">Division</th>
          <th style="width:100px;">Department</th>
          <th style="width:80px;">Section</th>
          <th style="width:70px;">Grade</th>
          <th style="width:110px;">Designation</th>
          <th style="width:100px;">Sponsor</th>
          <th class="center" style="width:90px;">Visa No.</th>
          <th class="center" style="width:90px;">Expiry Date</th>
          <th class="center" style="width:70px;">Days Left</th>
          <th class="center" style="width:90px;">Status</th>
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

export const getVisaExpiryReport = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        const {
            loginid,
            code1,  // company_code
            code2,  // div_code
            code3,  // dept_code
            code4,  // section_code
            code5,  // grade_code
            code6,  // desg_code
            code7,  // emp_id
            code8,  // sponsor_code
            code9,  // emp_type: A | ALL
            date1,  // visa_expiry_from  (YYYY-MM-DD)
            date2,  // visa_expiry_to    (YYYY-MM-DD)
        } = req.body;

        // DB connection
        let tenantId = getCurrentTenantId();
        if (!tenantId && loginid) {
            tenantId = await TenantManager.getTenantForUser(loginid);
        }
        if (!tenantId) {
            res.status(400).json({ success: false, message: "Tenant not found" });
            return;
        }
        connection = await TenantManager.getConnection(tenantId);

        // Build & execute SQL directly
        const sql = buildVisaExpirySql({
            company_code: code1 || "",
            div_code:     code2 || "",
            dept_code:    code3 || "",
            section_code: code4 || "",
            grade_code:   code5 || "",
            desg_code:    code6 || "",
            emp_id:       code7 || "",
            sponsor_code: code8 || "",
            emp_type:     code9 || "A",
            date_from:    date1 || "",
            date_to:      date2 || "",
        });

        const dataResult = await connection.execute(sql, [], {
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

        const html = buildVisaExpiryHTML(rows, {
            loginid:    loginid || "ADMIN",
            division:   code2   || "All",
            department: code3   || "All",
            date_from:  date1   || "",
            date_to:    date2   || "",
            emp_type:   code9   || "A",
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