import { Response } from "express";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { QueryExecutor } from "../../../database/QueryExecutor";

// ─── Types ────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

interface ReqParams {
  loginid:    string;
  employeeId: string;
  month:      string;
  year:       string;
}

interface IPaySlipHeader {
  employee_id: string;
  rpt_name: string;
  desg_name: string;
  div_name: string;
  dept_name: string;
  dept_code: string;
  section_name: string;
  payment_mode: string;
  salary_acct_no: string;
  bank_name?: string;
  pay_month: string;
  pay_year: string;
  curr_name: string;
  company_code?: string;
  div_code?: string;
  ref_jv_doc_no?: string;
  gross_earnings?: number;
  gross_deductions?: number;
  net_salary?: number;
}

interface IPayComponent {
  pay_comp_id?: string;
  pay_comp_desc: string;
  pay_comp_amt: number;
  sort_order?: number;
}

interface IAttendanceRow {
  attend_type: string;
  no_of_days: number;
  attend_desc: string;
}

interface IVisaExpiryRow {
  labourcard_valid_to?: string;
  visa_valid_to?: string;
  ppt_valid_to?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {})
  );
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function escapeHtml(value: unknown): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatCurrency(amount: number | undefined): string {
  return (amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

const MONTH_ABBRS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function getMonthAbbr(monthNum: string): string {
  return MONTH_ABBRS[parseInt(monthNum, 10) - 1] || monthNum || "";
}

// ─── Param extraction ───────────────────────────────────────────────────────

function extractParams(req: RequestWithUser): ReqParams {
  const q = req.query || {};
  return {
    loginid:    text(q.loginid),
    employeeId: text(q.employeeId),
    month:      text(q.month),
    year:       text(q.year),
  };
}

// ─── Payroll-period helpers ────────────────────────────────────────────────

function getLivePayrollPeriod(): { payrollMonth: number; payrollYear: number } {
  const now = new Date();
  const thisMonth0 = now.getMonth();
  if (thisMonth0 === 0) {
    return { payrollMonth: 12, payrollYear: now.getFullYear() - 1 };
  }
  return { payrollMonth: thisMonth0, payrollYear: now.getFullYear() };
}

function isAllowedYear(year: string): boolean {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  return year === currentYear.toString() || year === previousYear.toString();
}

// ─── Permission check ───────────────────────────────────────────────────────

// async function hasPayslipPermission(loginid: string, employeeId: string): Promise<boolean> {
//     console.log('log6',loginid === employeeId)
//   if (!loginid || !employeeId) return false;
//   if (loginid === employeeId) return true;

//   const sql = `
//     SELECT DISTINCT *
//     FROM (
//         SELECT EMPLOYEE_ID
//         FROM VW_HR_EMPLOYEE
//         WHERE EMP_STATUS <> 'S'
//         START WITH
//             EMPLOYEE_ID = :loginid
//             OR SUPERVISOR_EMPID = :loginid
//             OR DEPT_HEAD_EMPID = :loginid
//             OR MANGR_EMPID = :loginid
//         CONNECT BY NOCYCLE PRIOR EMPLOYEE_ID = SUPERVISOR_EMPID
//             OR PRIOR EMPLOYEE_ID = DEPT_HEAD_EMPID
//             OR PRIOR EMPLOYEE_ID = MANGR_EMPID
//     )
//   `;
//   const result = await QueryExecutor.executeRawQuery(sql, { loginid });
//   const rows = normalize((result.rows as any[]) || []);
//   return rows.some((r) => r.employee_id === employeeId);
// }

// ─── Data loader ────────────────────────────────────────────────────────────

interface PayslipData {
  header: IPaySlipHeader;
  earnings: IPayComponent[];
  deductions: IPayComponent[];
  attendance: IAttendanceRow[];
  visaExpiry?: IVisaExpiryRow;
  logoUrl: string | null;
}

const HISTORY_SOURCE_FLAG = "P";

async function loadPayslipData(employeeId: string, month: string, year: string): Promise<PayslipData | null> {
  const headerSql =  `SELECT DISTINCT * FROM VW_BOHC_PAYSLIP_HDR WHERE EMPLOYEE_ID = :employeeId AND PAY_MONTH = :month AND PAY_YEAR = :year`;
  const bindheaderParams = {employeeId: employeeId ,month: month ,year: year}
  const headerResult = await QueryExecutor.executeRawQuery(headerSql,bindheaderParams);
  const headerRows = normalize((headerResult.rows as any[]) || []);
  const header: IPaySlipHeader | undefined = headerRows[0] as IPaySlipHeader | undefined;
  if (!header) return null;

  const { payrollMonth: liveMonth, payrollYear: liveYear } = getLivePayrollPeriod();
  const isCurrentMonthView = parseInt(month, 10) === liveMonth && parseInt(year, 10) === liveYear;

  const earningsSql = isCurrentMonthView
    ? `SELECT DISTINCT PAY_COMP_ID, PAY_COMP_DESC, PAY_COMP_AMT, SORT_ORDER
       FROM VW_CURRENTMONTH_EARNING
       WHERE EMPLOYEE_ID = :employeeId AND PAY_MONTH = :month AND PAY_YEAR = :year
       ORDER BY SORT_ORDER`
    : `SELECT PAY_COMP_ID, PAY_COMP_AMT, ARREARS, COMPANY_CODE, PAY_COMP_DESC, SORT_ORDER,
              MUTLI_CURR_SALDISBURSE, QUOTE_CURR, ADDN_CURR, DTL_CURR, BASE_CURR
       FROM VW_HISTORY_EARNING
       WHERE PAY_MONTH = :month AND PAY_YEAR = :year AND DEPT_CODE = :deptCode
       AND SOURCE_FLAG = :sourceFlag AND EMPLOYEE_ID = :employeeId
       ORDER BY SORT_ORDER`;

  const deductionsSql = isCurrentMonthView
    ? `SELECT DISTINCT PAY_COMP_ID, PAY_COMP_DESC, PAY_COMP_AMT, SORT_ORDER
       FROM VW_CURRENTMONTH_DEDUCTION
       WHERE EMPLOYEE_ID = :employeeId AND PAY_MONTH = :month AND PAY_YEAR = :year
       ORDER BY SORT_ORDER`
    : `SELECT PAY_COMP_ID, PAY_COMP_AMT, ARREARS, COMPANY_CODE, PAY_COMP_DESC, SORT_ORDER,
              MUTLI_CURR_SALDISBURSE, QUOTE_CURR, ADDN_CURR, DTL_CURR, BASE_CURR
       FROM VW_HISTORY_DEDUCTION
       WHERE PAY_MONTH = :month AND PAY_YEAR = :year AND DEPT_CODE = :deptCode
       AND SOURCE_FLAG = :sourceFlag AND EMPLOYEE_ID = :employeeId
       ORDER BY SORT_ORDER`;

  const attendanceSql = isCurrentMonthView
    ? `SELECT ATTEND_TYPE, NO_OF_DAYS, ATTEND_DESC
       FROM VW_CURRENTMONTH_ATTENDANCE
       WHERE EMPLOYEE_ID = :employeeId AND COMPANY_CODE = :companyCode AND PAY_MONTH = :month AND PAY_YEAR = :year`
    : `SELECT ATTEND_TYPE, NO_OF_DAYS, ATTEND_DESC
       FROM VW_HISTORY_ATTENDANCE
       WHERE EMPLOYEE_ID = :employeeId AND COMPANY_CODE = :companyCode AND PAY_MONTH = :month AND PAY_YEAR = :year`;

  const visaExpirySql = isCurrentMonthView
    ? `SELECT LABOURCARD_VALID_TO, VISA_VALID_TO, PPT_VALID_TO FROM VW_CURRENTMONTH_VISAEXPIRY WHERE EMPLOYEE_ID = :employeeId`
    : `SELECT LABOURCARD_VALID_TO, VISA_VALID_TO, PPT_VALID_TO FROM VW_HISTORY_VISAEXPIRY WHERE EMPLOYEE_ID = :employeeId`;

const earnDedBinds = isCurrentMonthView
  ? { employeeId, month, year }
  : {
      employeeId,
      month,
      year,
      deptCode: header.dept_code,
      sourceFlag: HISTORY_SOURCE_FLAG,
    }

  const [earningsResult, deductionsResult, attendanceResult, visaExpiryResult] = await Promise.all([
    QueryExecutor.executeRawQuery(earningsSql, earnDedBinds),
    QueryExecutor.executeRawQuery(deductionsSql, earnDedBinds),
    QueryExecutor.executeRawQuery(attendanceSql, { employeeId, companyCode: header.company_code, month, year }),
    QueryExecutor.executeRawQuery(visaExpirySql, { employeeId }),
  ]);

  // Logo: try the employee's division, then fall back to division '10'
  let logoUrl: string | null = null;
  if (header.div_code) {
    const primary = await QueryExecutor.executeRawQuery(
      `SELECT LOGO_URL FROM company_logo WHERE DIV_CODE = :divCode`,
      { divCode: header.div_code }
    );
    const primaryRows = normalize((primary.rows as any[]) || []);
    if (primaryRows[0]?.logo_url) {
      logoUrl = primaryRows[0].logo_url;
    } else {
      const fallback = await QueryExecutor.executeRawQuery(
        `SELECT LOGO_URL FROM company_logo WHERE DIV_CODE = '10'`,
        {}
      );
      const fallbackRows = normalize((fallback.rows as any[]) || []);
      if (fallbackRows[0]?.logo_url) logoUrl = fallbackRows[0].logo_url;
    }
  }

  return {
    header,
    earnings: normalize((earningsResult.rows as any[]) || []) as IPayComponent[],
    deductions: normalize((deductionsResult.rows as any[]) || []) as IPayComponent[],
    attendance: normalize((attendanceResult.rows as any[]) || []) as IAttendanceRow[],
    visaExpiry: (normalize((visaExpiryResult.rows as any[]) || []) as IVisaExpiryRow[])[0],
    logoUrl,
  };
}

// ─── HTML render ────────────────────────────────────────────────────────────

function renderLabelValue(label: string, value: unknown, labelWidth = 115): string {
  return `
    <div style="display:flex;font-size:0.75rem;line-height:1.4;">
      <span style="font-weight:700;color:#000;flex-shrink:0;width:${labelWidth}px;">${escapeHtml(label)}</span>
      <span style="color:#000;">: ${escapeHtml(value ?? "")}</span>
    </div>`;
}

function renderPayslipContent(data: PayslipData): string {
  const { header, earnings, deductions, attendance, visaExpiry, logoUrl } = data;

  const grossEarnings = header.gross_earnings ?? earnings.reduce((sum, item) => sum + (item.pay_comp_amt || 0), 0);
  const grossDeductions = header.gross_deductions ?? deductions.reduce((sum, item) => sum + (item.pay_comp_amt || 0), 0);
  const netSalary = header.net_salary ?? grossEarnings - grossDeductions;
  const payRowCount = Math.max(earnings.length, deductions.length, 1);

  const payRows = Array.from({ length: payRowCount })
    .map((_, i) => `
      <tr>
        <td style="padding:0.125rem 0 0.125rem 0.5rem;font-size:0.75rem;color:#000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(earnings[i]?.pay_comp_desc || "")}</td>
        <td style="border-right:1px solid #000;padding:0.125rem 0.5rem 0.125rem 0;text-align:right;font-size:0.75rem;color:#000;">${earnings[i] ? formatCurrency(earnings[i].pay_comp_amt) : ""}</td>
        <td style="padding:0.125rem 0 0.125rem 0.5rem;font-size:0.75rem;color:#000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(deductions[i]?.pay_comp_desc || "")}</td>
        <td style="padding:0.125rem 0.5rem 0.125rem 0;text-align:right;font-size:0.75rem;color:#000;">${deductions[i] ? formatCurrency(deductions[i].pay_comp_amt) : ""}</td>
      </tr>`)
    .join("");

  const attendanceRows = attendance.length > 0
    ? attendance.map((row) => `
        <tr>
          <td style="padding:0.125rem 0;font-size:0.72rem;color:#000;">${escapeHtml(row.attend_desc)}</td>
          <td style="padding:0.125rem 0;text-align:right;font-size:0.72rem;font-weight:600;color:#000;">${escapeHtml(row.no_of_days)}</td>
        </tr>`).join("")
    : `<tr><td style="padding:0.125rem 0;font-size:0.7rem;color:#9ca3af;">No attendance data available</td></tr>`;

  return `
    <div id="payslip-content" style="max-width:48rem;margin:0 auto;background:#fff;padding:1.5rem 1.75rem;font-family:'Segoe UI',Arial,sans-serif;">
      ${logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="Company Logo" style="height:auto;max-height:80px;max-width:100%;object-fit:contain;" />`
        : `<div style="height:80px;"></div>`}

      <div style="margin-bottom:0.5rem;margin-top:0.125rem;border-top:2px solid #000;"></div>

      <p style="margin:0 0 1rem 0;border-bottom:1px solid #d1d5db;padding-bottom:0.5rem;font-size:0.95rem;font-weight:700;letter-spacing:3px;color:#000;">
        P a y s l i p &nbsp;( Division : ${escapeHtml(header.div_code ?? "")} )
      </p>

      <div class="payslip-info-grid" style="margin-bottom:1rem;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:0;">
        <div style="grid-column:span 6 / span 6;">
          ${renderLabelValue("Employee Code", header.employee_id)}
          ${renderLabelValue("Name", header.rpt_name)}
          ${renderLabelValue("Designation", header.desg_name)}
          ${renderLabelValue("Division", header.div_name)}
          ${renderLabelValue("Department", header.dept_name)}
          ${renderLabelValue("Section", header.section_name)}
        </div>
        <div style="grid-column:span 6 / span 6;">
          ${renderLabelValue("Period", `${getMonthAbbr(header.pay_month)} / ${header.pay_year ?? ""}`)}
          ${renderLabelValue("Currency", header.curr_name)}
          ${renderLabelValue("Bank Name", header.bank_name)}
          ${renderLabelValue("Account No.", header.salary_acct_no)}
          ${renderLabelValue("Mode of Payment", 
            header.payment_mode === 'B' ? 'Bank Transfer' : 
            header.payment_mode === 'C' ? 'Cash' : 
            header.payment_mode
          )}
          ${renderLabelValue("Ref JV Doc No", header.ref_jv_doc_no)}
        </div>
      </div>

      <div class="print-avoid-break" style="border:1px solid #000;">
        <table style="width:100%;table-layout:fixed;border-collapse:collapse;background:#fff;">
          <colgroup>
            <col style="width:34%" /><col style="width:16%" /><col style="width:34%" /><col style="width:16%" />
          </colgroup>
          <tbody>
            <tr>
              <td colspan="2" style="border-bottom:1px solid #000;border-right:1px solid #000;padding:0.25rem 0;text-align:center;font-size:0.85rem;font-weight:700;color:#000;">Earnings</td>
              <td colspan="2" style="border-bottom:1px solid #000;padding:0.25rem 0;text-align:center;font-size:0.85rem;font-weight:700;color:#000;">Deductions</td>
            </tr>
            <tr>
              <td colspan="2" style="border-bottom:1px solid #000;border-right:1px solid #000;padding:0.125rem 0;font-size:0.7rem;font-weight:700;color:#555;">&nbsp;${escapeHtml(header.curr_name)}</td>
              <td colspan="2" style="border-bottom:1px solid #000;padding:0.125rem 0;"></td>
            </tr>
            ${payRows}
            <tr><td colspan="4" style="height:60px;padding:0;"></td></tr>
            <tr>
              <td style="border-right:1px solid #000;border-top:1px solid #000;padding:0.25rem 0 0.25rem 0.5rem;font-size:0.75rem;font-weight:700;color:#000;">Gross Earnings</td>
              <td style="border-right:1px solid #000;border-top:1px solid #000;padding:0.25rem 0.5rem 0.25rem 0;text-align:right;font-size:0.75rem;font-weight:700;color:#000;">${formatCurrency(grossEarnings)}</td>
              <td style="border-top:1px solid #000;padding:0.25rem 0 0.25rem 0.5rem;font-size:0.75rem;font-weight:700;color:#000;">Gross Deductions</td>
              <td style="border-top:1px solid #000;padding:0.25rem 0.5rem 0.25rem 0;text-align:right;font-size:0.75rem;font-weight:700;color:#000;">${formatCurrency(grossDeductions)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="print-avoid-break" style="display:flex;align-items:center;justify-content:space-between;border:1px solid #000;border-top:none;padding:0.375rem 0.75rem;">
        <p style="font-size:0.7rem;color:#555;margin:0;">Normal OT (Hrs): &nbsp;&nbsp;&nbsp; Holiday OT (Hrs):</p>
        <p style="font-size:0.85rem;font-weight:700;color:#000;margin:0;">Total Paid Salary : ${escapeHtml(header.curr_name)} ${formatCurrency(netSalary)}</p>
      </div>

      <div class="print-avoid-break" style="border:1px solid #d1d5db;border-top:none;">
        <p style="border-bottom:1px solid #d1d5db;padding:0.25rem 0.75rem;font-size:0.78rem;font-weight:700;color:#000;margin:0;">Attendance Details</p>
        <div style="display:flex;flex-wrap:wrap;gap:1.5rem;padding:0.375rem 0.75rem;">
          <div style="min-width:140px;flex:1 1 0%;">
            <table style="width:100%;background:#fff;border-collapse:collapse;">
              <tbody>${attendanceRows}</tbody>
            </table>
          </div>
          <div style="width:200px;flex-shrink:0;border:1px solid #d1d5db;padding:0.25rem 0.625rem;">
            <p style="margin:0 0 0.125rem 0;font-size:0.72rem;font-weight:700;color:#000;">Expiry Details</p>
            ${renderLabelValue("Civil Card", formatDate(visaExpiry?.labourcard_valid_to))}
            ${renderLabelValue("Visa", formatDate(visaExpiry?.visa_valid_to), 85)}
            ${renderLabelValue("Passport", formatDate(visaExpiry?.ppt_valid_to), 85)}
          </div>
        </div>
      </div>
    </div>`;
}

function renderMessagePage(title: string, message: string, isError: boolean): string {
  const accent = isError ? "#dc2626" : "#b45309";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#fff;padding:2.5rem 1rem;">
  <div style="max-width:42rem;margin:0 auto;border:1px solid #fecaca;border-radius:8px;overflow:hidden;">
    <div style="background:#fef2f2;border-bottom:1px solid #fee2e2;padding:1rem 1.5rem;">
      <h2 style="margin:0;font-size:1.125rem;font-weight:600;color:${accent};">${escapeHtml(title)}</h2>
    </div>
    <div style="padding:1.25rem 1.5rem;">
      <p style="color:#374151;margin:0;">${escapeHtml(message)}</p>
    </div>
  </div>
</body></html>`;
}

function buildPayslipDocument(contentHtml: string, embed = false): string {
    const pdfLibs = embed ? "" : `
        <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>`;

    const actionBar = embed ? "" : `
        <div class="no-print" style="margin-bottom:1rem;display:flex;justify-content:flex-end;gap:0.5rem;">
        <button onclick="window.print()" style="border:1px solid #d1d5db;background:#fff;padding:0.5rem 0.75rem;border-radius:6px;cursor:pointer;">Print</button>
        <button onclick="exportPayslipToPDF()" style="border:1px solid #d1d5db;background:#fff;padding:0.5rem 0.75rem;border-radius:6px;cursor:pointer;">Download PDF</button>
        </div>`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Payslip</title>
<style>
  @media print {
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background-color: #fff; }
    body * { visibility: hidden; }
    #payslip-content, #payslip-content * { visibility: visible; }
    .no-print, .no-print * { display: none !important; }
    #payslip-content {
      position: fixed; top: 0; left: 0; width: 100%; margin: 0; border: none; box-shadow: none;
    }
    .payslip-info-grid { display: grid !important; grid-template-columns: 7fr 5fr !important; }
    .print-avoid-break { page-break-inside: avoid; }
  }
</style>
${pdfLibs}
</head>
<body style="margin:0;background:${embed ? "#fff" : "#f3f4f6"};">
  <div style="max-width:48rem;margin:0 auto;padding:${embed ? "0" : "1.5rem 1rem"};">
    ${actionBar}
    ${contentHtml}
  </div>

  <script>
    async function exportPayslipToPDF() {
      const element = document.getElementById('payslip-content');
      if (!element) { alert('Cannot generate PDF: Payslip content not found'); return; }
      try {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('.no-print').forEach((el) => el.remove());
        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        clone.style.top = '0';
        clone.style.width = '800px';
        clone.style.backgroundColor = 'white';
        clone.style.height = 'auto';
        clone.style.overflow = 'visible';
        clone.style.visibility = 'visible';
        document.body.appendChild(clone);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const canvas = await html2canvas(clone, {
          scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
          width: clone.scrollWidth, height: clone.scrollHeight,
        });
        document.body.removeChild(clone);

        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const usableWidth = pageWidth - margin * 2;
        const usableHeight = pageHeight - margin * 2;
        const imgHeight = (canvas.height * usableWidth) / canvas.width;

        let heightLeft = imgHeight;
        let position = margin;
        pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
        heightLeft -= usableHeight;
        while (heightLeft > 0) {
          position = margin - (imgHeight - heightLeft);
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
          heightLeft -= usableHeight;
        }
        pdf.save('Payslip.pdf');
      } catch (err) {
        console.error('Error generating PDF:', err);
        alert('Error generating PDF. Please try again.');
      }
    }
  </script>
</body>
</html>`;
}

   function formatDate(v: unknown): string {
     if (!v) return "";
     const d = new Date(v as any);
     if (isNaN(d.getTime()) || d.getFullYear() <= 1900) return "";
     return `${String(d.getDate()).padStart(2, "0")}-${MONTH_ABBRS[d.getMonth()]}-${d.getFullYear()}`;
   }
// ─── Route handler ──────────────────────────────────────────────────────────
// GET /hr/reports/payslip?employeeId=..&month=..&year=..

export const getPayslipReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const params = extractParams(req);

    if (!params.employeeId || !params.month || !params.year) {
      res.status(400).json({ success: false, message: "employeeId, month and year are required." });
      return;
    }

    if (!isAllowedYear(params.year)) {
      const currentYear = new Date().getFullYear();
      res.status(400).send(renderMessagePage(
        "Invalid Year",
        `You can only access payslips for the current year (${currentYear}). Selected year: ${params.year}`,
        true
      ));
      return;
    }

    // const permitted = await hasPayslipPermission(params.loginid, params.employeeId);
    // if (!permitted) {
    //   res.status(403).send(renderMessagePage(
    //     "Access Denied",
    //     "You don't have permission to view this employee's payslip.",
    //     true
    //   ));
    //   return;
    // }

    const data = await loadPayslipData(params.employeeId, params.month, params.year);
      if (!data) {
        const embed = ["1", "true"].includes(text(req.query.embed));
        if (embed) {
          // the React page reads this and shows it in the toast and preview
          res.status(404).json({ success: false, message: "No data found for the selected employee and pay period." });
        } else {
          res.status(200).send(renderMessagePage(
            "No Data Found",
            "No payslip data was found for the selected employee, month, and year.",
            false
          ));
        }
        return;
      }
    const embed = ["1", "true"].includes(text(req.query.embed));
    const html = buildPayslipDocument(renderPayslipContent(data),embed);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Payslip report error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate payslip report" });
  }
};