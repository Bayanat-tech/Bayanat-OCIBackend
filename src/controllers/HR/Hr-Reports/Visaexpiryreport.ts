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
    employee_code:   string;
    rpt_name:        string;
    div_name:        string;
    dept_name:       string;
    section_name:    string;
    desg_name:       string;
    sponsor_name:    string;
    visa_valid_from: string;
    visa_valid_to:   string;
    days_remaining:  number;
}

// ─── Shared: fetch rows from DB ───────────────────────────────────────────────

async function fetchVisaRows(body: any): Promise<{ rows: VisaRow[]; connection: any }> {
    const {
        parameter, loginid,
        code1, code2, code3, code4, code5,
        code6, code7, code8, code9,
        date1, date2,
    } = body;

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) throw new Error("Tenant not found");

    const connection = await TenantManager.getConnection(tenantId);

    const binds: any = {
        parameter: parameter || "Hr_Report_VISA_EXPIRY_REPORT",
        loginid:   loginid   || "ADMIN",
        code1: code1 || null, code2: code2 || null, code3: code3 || null,
        code4: code4 || null, code5: code5 || null, code6: code6 || null,
        code7: code7 || null, code8: code8 || null, code9: code9 || null,
        out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    for (let i = 10; i <= 20; i++) binds[`code${i}`] = body[`code${i}`] || null;
    for (let i = 1;  i <= 4;  i++) binds[`number${i}`] = body[`number${i}`] || null;

    binds["date1"] = date1 ? new Date(date1) : null;
    binds["date2"] = date2 ? new Date(date2) : null;
    binds["date3"] = body["date3"] || null;
    binds["date4"] = body["date4"] || null;

    const result = await connection.execute(
        `DECLARE v_sql VARCHAR2(32767);
         BEGIN
           PROC_BUILD_DYNAMIC_SQL_COMMON20(
             :parameter, :loginid,
             :code1,:code2,:code3,:code4,:code5,:code6,:code7,:code8,:code9,:code10,
             :code11,:code12,:code13,:code14,:code15,:code16,:code17,:code18,:code19,:code20,
             :number1,:number2,:number3,:number4,
             :date1,:date2,:date3,:date4,
             v_sql
           );
           :out_sql := v_sql;
         END;`,
        binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    console.log("[VisaExpiryReport] Generated SQL:", rawSql);
    if (!rawSql) throw new Error("PROC_BUILD_DYNAMIC_SQL_COMMON20 returned no SQL.");

    const dataResult = await connection.execute(rawSql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows: VisaRow[] = (dataResult.rows as any[]).map((row) =>
        Object.keys(row).reduce((acc: any, key) => {
            acc[key.toLowerCase()] = row[key];
            return acc;
        }, {})
    );

    return { rows, connection };
}

// ─── Build HTML ───────────────────────────────────────────────────────────────

function buildVisaExpiryHTML(
    rows: VisaRow[],
    params: {
        parameter:  string;
        loginid:    string;
        division:   string;
        department: string;
        date_from:  string;
        date_to:    string;
        emp_type:   string;
    }
): string {

    const reportTitle = "Visa Expiry Listing Report";
    const generatedBy = text(params.loginid) || "Unknown User";
    const reportDate  = formatDateStr(new Date());

    let totalExpired  = 0;
    let totalExpiring = 0;
    let totalValid    = 0;

    const tableRows = rows.map((r, i) => {
        const daysNum = Number(r.days_remaining);
        let rowCls = "";
        let daysCls = "";
        if (daysNum < 0)        { totalExpired++;  rowCls = "row-exp";  daysCls = "days-exp";  }
        else if (daysNum <= 30) { totalExpiring++; rowCls = "row-warn"; daysCls = "days-warn"; }
        else                    { totalValid++; }

        return `
        <tr class="${rowCls}">
          <td class="tc">${i + 1}</td>
          <td class="bold">${text(r.employee_code)}</td>
          <td>${text(r.rpt_name)}</td>
          <td>${text(r.dept_name)}</td>
          <td class="tc">${text(r.div_name)}</td>
          <td>${text(r.section_name)}</td>
          <td>${text(r.desg_name)}</td>
          <td>${text(r.sponsor_name)}</td>
          <td class="tc mono">${formatDateStr(r.visa_valid_from)}</td>
          <td class="tc mono ${daysCls}">${formatDateStr(r.visa_valid_to)}</td>
          <td class="tc mono ${daysCls}">${daysNum}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="11" class="empty">No records found.</td></tr>`;

    // ── Excel export data (built server-side, embedded in page) ───────────────
    const excelRows = rows.map((r, i) => {
        const daysNum = Number(r.days_remaining);
        const bgColor = daysNum < 0 ? "#FFF5F5" : daysNum <= 30 ? "#FFFDF0" : "#FFFFFF";
        const dayColor = daysNum < 0 ? "color:#C00000;font-weight:bold" : daysNum <= 30 ? "color:#B45309;font-weight:bold" : "";
        return `<tr style="background:${bgColor}">
          <td style="text-align:center">${i + 1}</td>
          <td style="font-weight:bold">${text(r.employee_code)}</td>
          <td>${text(r.rpt_name)}</td>
          <td>${text(r.dept_name)}</td>
          <td style="text-align:center">${text(r.div_name)}</td>
          <td>${text(r.section_name)}</td>
          <td>${text(r.desg_name)}</td>
          <td>${text(r.sponsor_name)}</td>
          <td style="text-align:center">${formatDateStr(r.visa_valid_from)}</td>
          <td style="text-align:center;${dayColor}">${formatDateStr(r.visa_valid_to)}</td>
          <td style="text-align:center;${dayColor}">${daysNum}</td>
        </tr>`;
    }).join("");

    const excelHtml = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Visa Expiry Report</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  body  { font-family: Calibri, Arial, sans-serif; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; }
  th    { background: #1e3a8a; color: #ffffff; font-weight: bold; padding: 7px 8px;
          border: 1px solid #1e3a8a; font-size: 9pt; text-align: center; }
  td    { padding: 6px 8px; border: 1px solid #d1d5db; font-size: 10pt; vertical-align: middle; }
  .meta-lbl { font-weight: bold; color: #475569; width: 110px; }
  .meta-val { color: #1e293b; }
</style>
</head>
<body>
<table style="border:none;width:auto;margin-bottom:6px">
  <tr><td style="border:none;font-size:16pt;font-weight:800;color:#1e3a8a;padding:0 0 2px 0" colspan="2">AL MADINA LOGISTICS</td></tr>
  <tr><td style="border:none;font-size:13pt;font-weight:700;color:#1e293b;padding:0 0 10px 0" colspan="2">Visa Expiry Listing Report</td></tr>
  <tr><td class="meta-lbl" style="border:none">Period :</td>       <td class="meta-val" style="border:none"><b>${formatDateStr(params.date_from)} – ${formatDateStr(params.date_to)}</b></td></tr>
  <tr><td class="meta-lbl" style="border:none">Division :</td>     <td class="meta-val" style="border:none">${text(params.division) || "All"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Department :</td>   <td class="meta-val" style="border:none">${text(params.department) || "All"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Emp. Type :</td>    <td class="meta-val" style="border:none">${params.emp_type === "A" ? "Active Employees" : "All Employees"}</td></tr>
  <tr><td class="meta-lbl" style="border:none">Printed on :</td>   <td class="meta-val" style="border:none">${reportDate}</td></tr>
  <tr><td class="meta-lbl" style="border:none">User :</td>         <td class="meta-val" style="border:none">${generatedBy}</td></tr>
</table>
<br>
<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th style="width:90px">Emp. Code</th>
      <th style="min-width:140px">Employee Name</th>
      <th style="width:100px">Department</th>
      <th style="width:70px">Division</th>
      <th style="width:80px">Section</th>
      <th style="width:120px">Designation</th>
      <th style="width:110px">Sponsor</th>
      <th style="width:80px">Visa From</th>
      <th style="width:80px">Visa To</th>
      <th style="width:65px">Days Rem.</th>
    </tr>
  </thead>
  <tbody>
    ${excelRows || `<tr><td colspan="11" style="text-align:center;padding:20px;color:#94a3b8">No records found.</td></tr>`}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="11" style="padding:8px;font-weight:bold;background:#f1f5f9;border-top:2px solid #1e3a8a;color:#1e293b">
        Total Records: ${rows.length} &nbsp;|&nbsp;
        <span style="color:#C00000">Expired: ${totalExpired}</span> &nbsp;|&nbsp;
        <span style="color:#B45309">Expiring Soon: ${totalExpiring}</span> &nbsp;|&nbsp;
        <span style="color:#15803d">Valid: ${totalValid}</span>
      </td>
    </tr>
  </tfoot>
</table>
</body></html>`.replace(/`/g, "\\`");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${reportTitle}</title>
  <style>
    /* ── Base ─────────────────────────────────────────────────────────── */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11px;
      background: #f0f2f5;
      color: #1e293b;
    }

    /* ── Toolbar ──────────────────────────────────────────────────────── */
    .toolbar {
      background: #1e293b;
      padding: 8px 20px;
      display: flex; gap: 8px; justify-content: flex-end;
    }
    .btn {
      padding: 7px 18px; border: none; border-radius: 5px;
      font-size: 11px; font-weight: 600; cursor: pointer;
    }
    .btn-print { background: #3b82f6; color: #fff; }
    .btn-excel { background: #16a34a; color: #fff; }
    .btn:hover { opacity: 0.88; }

    /* ── Page ─────────────────────────────────────────────────────────── */
    .page {
      width: 100%;
      max-width: 1180px;
      margin: 20px auto;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.10);
      padding: 24px 28px 20px;
    }

    /* ── Report Header ────────────────────────────────────────────────── */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid #1e3a8a;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .report-title {
      font-size: 15px; font-weight: 800;
      color: #1e3a8a; margin-bottom: 10px;
    }
    .meta-table { border-collapse: collapse; }
    .meta-table td { padding: 2px 10px 2px 0; vertical-align: top; font-size: 11px; }
    .meta-lbl { font-weight: 700; color: #64748b; white-space: nowrap; min-width: 95px; }
    .meta-val { color: #1e293b; }
    .brand-block { text-align: right; white-space: nowrap; }
    .brand-name  { font-size: 20px; font-weight: 800; color: #1e3a8a; letter-spacing: 0.08em; }
    .brand-sub   { font-size: 9px;  letter-spacing: 0.25em; color: #64748b; margin-top: 2px; }

    /* ── Table ────────────────────────────────────────────────────────── */
    .tbl-wrap { width: 100%; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }

    thead tr { background: #1e3a8a; }
    thead th {
      color: #fff; font-weight: 700; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.04em;
      padding: 8px 6px; text-align: left;
      border-right: 1px solid #2d52c4;
      white-space: nowrap; overflow: hidden;
    }
    thead th.tc { text-align: center; }
    thead th:last-child { border-right: none; }

    tbody td {
      padding: 7px 6px; font-size: 10.5px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
      overflow: hidden; text-overflow: ellipsis;
    }
    tbody tr:hover td { background: #eff6ff !important; }

    /* ── Row colours ──────────────────────────────────────────────────── */
    tr.row-exp  td { background: #fff5f5; }
    tr.row-warn td { background: #fffdf0; }

    /* ── Cell helpers ─────────────────────────────────────────────────── */
    td.tc     { text-align: center; }
    td.mono   { font-family: 'Courier New', monospace; font-size: 10px; }
    td.bold   { font-weight: 700; }
    td.days-exp  { color: #dc2626; font-weight: 700; }
    td.days-warn { color: #d97706; font-weight: 700; }
    td.empty  { text-align: center; padding: 36px; color: #94a3b8; }

    /* ── Footer ───────────────────────────────────────────────────────── */
    .report-footer {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 10px; color: #94a3b8;
    }
    .report-footer strong { color: #64748b; }
    .dot-exp  { color: #dc2626; font-weight: 700; }
    .dot-warn { color: #d97706; font-weight: 700; }
    .dot-ok   { color: #16a34a; font-weight: 700; }

    /* ── Print ────────────────────────────────────────────────────────── */
    @media print {
      body      { background: #fff; font-size: 9px; }
      .toolbar  { display: none; }
      .page     { margin: 0; border-radius: 0; box-shadow: none;
                  padding: 14px 16px; max-width: 100%; }
      thead     { display: table-header-group; }
      tbody tr  { page-break-inside: avoid; }
      tr.row-exp  td { background: #fff5f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tr.row-warn td { background: #fffdf0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      thead tr       { background: #1e3a8a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- Toolbar -->
  <div class="toolbar">
    <button class="btn btn-print" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="btn btn-excel" onclick="exportExcel()">📥 Export to Excel</button>
  </div>

  <script>
    function exportExcel() {
      const html = \`${excelHtml}\`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'VisaExpiryReport_${new Date().toISOString().slice(0, 10)}.xls';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  </script>

  <div class="page">

    <!-- Header -->
    <div class="report-header">
      <div>
        <div class="report-title">${reportTitle}</div>
        <table class="meta-table">
          <tr><td class="meta-lbl">Period :</td>     <td class="meta-val"><strong>${formatDateStr(params.date_from)} &ndash; ${formatDateStr(params.date_to)}</strong></td></tr>
          <tr><td class="meta-lbl">Division :</td>   <td class="meta-val">${text(params.division) || "All"}</td></tr>
          <tr><td class="meta-lbl">Department :</td> <td class="meta-val">${text(params.department) || "All"}</td></tr>
          <tr><td class="meta-lbl">Emp. Type :</td>  <td class="meta-val">${params.emp_type === "A" ? "Active Employees" : "All Employees"}</td></tr>
          <tr><td class="meta-lbl">Printed on :</td> <td class="meta-val">${reportDate}</td></tr>
          <tr><td class="meta-lbl">User :</td>        <td class="meta-val">${generatedBy}</td></tr>
        </table>
      </div>
      <div class="brand-block">
        <div class="brand-name">AL MADINA</div>
        <div class="brand-sub">L O G I S T I C S</div>
      </div>
    </div>

    <!-- Table -->
    <div class="tbl-wrap">
      <table>
        <colgroup>
          <col style="width:32px"/>
          <col style="width:82px"/>
          <col style="width:145px"/>
          <col style="width:95px"/>
          <col style="width:60px"/>
          <col style="width:75px"/>
          <col style="width:115px"/>
          <col style="width:100px"/>
          <col style="width:76px"/>
          <col style="width:76px"/>
          <col style="width:60px"/>
        </colgroup>
        <thead>
          <tr>
            <th class="tc">#</th>
            <th>Emp. Code</th>
            <th>Employee Name</th>
            <th>Department</th>
            <th class="tc">Division</th>
            <th>Section</th>
            <th>Designation</th>
            <th>Sponsor</th>
            <th class="tc">Visa From</th>
            <th class="tc">Visa To</th>
            <th class="tc">Days</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div class="report-footer">
      <div>
        <strong>Total Records: ${rows.length}</strong>
        &nbsp;&nbsp;
        <span class="dot-exp">&#9679; Expired: ${totalExpired}</span>
        &nbsp;&nbsp;
        <span class="dot-warn">&#9679; Expiring Soon: ${totalExpiring}</span>
        &nbsp;&nbsp;
        <span class="dot-ok">&#9679; Valid: ${totalValid}</span>
      </div>
      <div>End of Report &bull; Generated by <strong>${generatedBy}</strong> &bull; ${reportDate}</div>
    </div>

  </div>
</body>
</html>`;
}

// ─── HTML Controller ──────────────────────────────────────────────────────────

export const getVisaExpiryReport = async (req: Request, res: Response): Promise<void> => {
    let connection: any;
    try {
        const { rows, connection: conn } = await fetchVisaRows(req.body);
        connection = conn;

        if (!rows.length) {
            res.status(200).json({ success: false, message: "No data found for the selected criteria." });
            return;
        }

        const { parameter, loginid, code2, code3, date1, date2, code9 } = req.body;

        const html = buildVisaExpiryHTML(rows, {
            parameter:  parameter || "Hr_Report_VISA_EXPIRY_REPORT",
            loginid:    loginid   || "ADMIN",
            division:   code2     || "",
            department: code3     || "",
            date_from:  date1     || "",
            date_to:    date2     || "",
            emp_type:   code9     || "A",
        });

        res.setHeader("Content-Type", "text/html");
        res.status(200).send(html);

    } catch (error: any) {
        console.error("Visa Expiry Report Error:", error);
        res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { console.error(e); }
    }
};