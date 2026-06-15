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

interface DNSummaryRow {
    principal_confirm_date: string | null;
    job_no: string;
    customer: string;
    container_no: string;
    qty: number;
    volume: number;
    dn_no: string;
    dn_date: string | null;
    prin_code: string;
    group_code: string;
    group_name: string;
    prod_code: string;
    prod_name: string;
    txn_type: string;
}

// ─── Group-by helpers ─────────────────────────────────────────────────────────

interface GroupedCustomer {
    customer: string;
    job_no: string;
    rows: DNSummaryRow[];
    totalQty: number;
    totalVolume: number;
}

interface GroupedPrincipal {
    prin_code: string;
    customers: GroupedCustomer[];
    totalQty: number;
    totalVolume: number;
}

const groupRows = (rows: DNSummaryRow[]): GroupedPrincipal[] => {
    const principalMap = new Map<string, GroupedPrincipal>();

    for (const row of rows) {
        if (!principalMap.has(row.prin_code)) {
            principalMap.set(row.prin_code, { prin_code: row.prin_code, customers: [], totalQty: 0, totalVolume: 0 });
        }
        const principal = principalMap.get(row.prin_code)!;

        const custKey = `${row.customer}||${row.job_no}`;
        let customer = principal.customers.find((c) => `${c.customer}||${c.job_no}` === custKey);
        if (!customer) {
            customer = { customer: row.customer, job_no: row.job_no, rows: [], totalQty: 0, totalVolume: 0 };
            principal.customers.push(customer);
        }

        customer.rows.push(row);
        customer.totalQty += Number(row.qty) || 0;
        customer.totalVolume += Number(row.volume) || 0;
        principal.totalQty += Number(row.qty) || 0;
        principal.totalVolume += Number(row.volume) || 0;
    }

    return Array.from(principalMap.values());
};

// ─── Build HTML ───────────────────────────────────────────────────────────────

const buildDNSummaryHTML = (
    rows: DNSummaryRow[],
    params: {
        loginid: string;
        prin_code: string;
        group_code: string;
        prod_codes: string;
    }
): string => {
    const grandTotalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const grandTotalVolume = rows.reduce((s, r) => s + (Number(r.volume) || 0), 0);
    const grouped = groupRows(rows);

    const tableBodyHtml = grouped.map((principal) =>
        principal.customers.map((cust, ci) =>
            cust.rows.map((r, ri) => `
                <tr class="${ri % 2 === 0 ? "row-even" : "row-odd"}">
                    ${ri === 0 && ci === 0 ? `<td rowspan="${cust.rows.length}" class="prin-cell">${text(principal.prin_code)}</td>` : ""}
                    ${ri === 0 ? `<td rowspan="${cust.rows.length}" style="vertical-align:top;padding-top:6px;">${text(r.principal_confirm_date ? formatDateStr(r.principal_confirm_date) : "")}</td>` : ""}
                    ${ri === 0 ? `<td rowspan="${cust.rows.length}" style="vertical-align:top;padding-top:6px;">${text(r.job_no)}</td>` : ""}
                    ${ri === 0 ? `<td rowspan="${cust.rows.length}" style="vertical-align:top;padding-top:6px;font-weight:500;">${text(cust.customer)}</td>` : ""}
                    <td>${text(r.dn_no)}</td>
                    <td class="center">${r.dn_date ? formatDateStr(r.dn_date) : ""}</td>
                    <td>${text(r.container_no)}</td>
                    <td class="right">${text(r.qty)}</td>
                    <td class="right">${text(r.volume)}</td>
                </tr>`
            ).join("")
            + `<tr class="subtotal-row">
                <td colspan="5" style="text-align:right;font-size:10px;color:#6b7280;padding-right:8px;">
                    Total For ${text(cust.customer)} :
                </td>
                <td class="right subtotal">${cust.totalQty}</td>
                <td class="right subtotal">${cust.totalVolume}</td>
               </tr>`
        ).join("")
        + `<tr class="principal-total-row">
            <td colspan="8" style="text-align:right;font-size:10px;color:#374151;padding-right:8px;">
                Total For ${text(principal.prin_code)} :
            </td>
            <td class="right" style="font-weight:700;color:#185FA5;">${principal.totalQty}</td>
            <td class="right" style="font-weight:700;color:#185FA5;">${principal.totalVolume}</td>
           </tr>`
    ).join("") || `
        <tr>
            <td colspan="9" style="text-align:center;padding:40px;color:#6b7280;">
                No records found for the selected criteria.
            </td>
        </tr>`;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>DN Summary Report</title>
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
    .lbl          { font-weight: 600; width: 110px; color: #555; }
    .brand-name   { font-size: 20px; font-weight: 700; color: #185FA5; letter-spacing: 0.02em; }
    .brand-sub    { font-size: 9px; letter-spacing: 3px; color: #888; margin-top: 2px; }
    .report-title { font-size: 14px; font-weight: 700; color: #185FA5; margin-bottom: 6px; }

    table.report-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 10px; }
    table.report-table th {
      background: #185FA5; color: #fff; padding: 7px 5px;
      text-align: left; font-size: 9px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em; border: none; white-space: nowrap;
    }
    table.report-table th.center,
    table.report-table td.center { text-align: center; }
    table.report-table th.right,
    table.report-table td.right  { text-align: right; }
    table.report-table td { padding: 5px 5px; vertical-align: middle; border-bottom: 0.5px solid #e5e7eb; }
    .row-even td { background: #fff; }
    .row-odd  td { background: #f8fafc; }
    tr:hover  td { background: #eef4fd !important; }
    .prin-cell { font-weight: 700; color: #185FA5; vertical-align: top; padding-top: 6px; }
    .subtotal-row td { background: #f0f7ff !important; }
    .subtotal { font-weight: 600; color: #374151; }
    .principal-total-row td { background: #e0edfa !important; border-top: 1px solid #185FA5; }

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
        <div class="report-title">Delivery Note Report (Summary)</div>
        <table class="meta-info">
          <tr><td class="lbl">Print Date :</td>  <td><strong>${formatDateStr(new Date())}</strong></td></tr>
          <tr><td class="lbl">Principal :</td>   <td>${text(params.prin_code) || "All"}</td></tr>
          <tr><td class="lbl">Group :</td>        <td>${text(params.group_code) || "All"}</td></tr>
          <tr><td class="lbl">Products :</td>     <td>${text(params.prod_codes) || "All"}</td></tr>
          <tr><td class="lbl">User :</td>         <td>${text(params.loginid)}</td></tr>
        </table>
      </div>
      <div style="text-align:right;">
        <div class="brand-name">AL MADINA</div>
        <div class="brand-sub">LOGISTICS</div>
      </div>
    </div>

    <table class="report-table">
      <thead>
        <tr>
          <th style="width:55px;">Principal</th>
          <th style="width:70px;">Confirm Date</th>
          <th style="width:80px;">Job No</th>
          <th style="min-width:110px;">Customer</th>
          <th style="width:70px;">DN No</th>
          <th class="center" style="width:75px;">DN Date</th>
          <th style="width:110px;">Container No</th>
          <th class="right" style="width:55px;">Qty</th>
          <th class="right" style="width:60px;">Volume</th>
        </tr>
      </thead>
      <tbody>
        ${tableBodyHtml}
      </tbody>
    </table>

    <div class="footer">
      <div>
        <strong>Grand Total:</strong>
        &nbsp; Qty: <strong>${grandTotalQty}</strong>
        &nbsp;&nbsp; Volume: <strong>${grandTotalVolume}</strong>
      </div>
      <div>End of Report &nbsp;|&nbsp; Printed: ${formatDateStr(new Date())}</div>
    </div>

  </div>
</body>
</html>`;
};

// ─── Express Controller ───────────────────────────────────────────────────────

export const getDNSummaryReport = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        const {
            parameter,   // "WMS_Stock_DN_Summary_Report"
            loginid,
            code1,       // company_code
            code2,       // prin_code  (single, optional)
            code3,       // group_code (single, optional)
            code4,       // prod_codes (comma-separated list, optional)
        } = req.body;

        // ── Tenant resolution ─────────────────────────────────────────────────
        let tenantId = getCurrentTenantId();
        if (!tenantId && loginid) {
            tenantId = await TenantManager.getTenantForUser(loginid);
        }
        if (!tenantId) {
            res.status(400).json({ success: false, message: "Tenant not found" });
            return;
        }
        connection = await TenantManager.getConnection(tenantId);

        // ── Build the product IN-list for SQL ─────────────────────────────────
        //
        //  code4 arrives as "PROD1,PROD2,PROD3" (or empty = all products).
        //  We build a safe SQL fragment.  Because we own the source (our own
        //  validated lookup values) we just quote-wrap each item; alternatively
        //  bind them via a nested table if your OracleDB version supports it.
        //
        const prodCodes: string[] = code4
            ? String(code4).split(",").map((p: string) => p.trim()).filter(Boolean)
            : [];

        const prodInClause =
            prodCodes.length > 0
                ? `AND PROD_CODE IN (${prodCodes.map((p) => `'${p.replace(/'/g, "''")}'`).join(",")})`
                : "";

        const prinWhereClause = code2 ? `AND PRIN_CODE = '${String(code2).replace(/'/g, "''")}' ` : "";
        const groupWhereClause = code3 ? `AND GROUP_CODE = '${String(code3).replace(/'/g, "''")}' ` : "";

        // ── Core query against VW_BOWM_STK_TRANS ─────────────────────────────
        //
        //  Mirrors the requirement:
        //    SELECT * FROM VW_BOWM_STK_TRANS
        //    WHERE TXN_TYPE NOT IN ('IMP')
        //      AND PRIN_CODE IN (@prin_code)   -- replaced by dynamic clause
        //
        const sql = `
            SELECT
                 PRIN_CODE,
                CONFIRM_DATE   AS PRINCIPAL_CONFIRM_DATE,
                JOB_NO,
                CUST_CODE      AS CUSTOMER,
                CONTAINER_NO,
                QUANTITY       AS QTY,
                VOLUME,
                DN_NO,
                JOB_DATE       AS DN_DATE,
                GROUP_CODE,
                GROUP_NAME,
                PROD_CODE,
                PROD_NAME,
                TXN_TYPE
            FROM VW_BOWM_STK_TRANS
            WHERE TXN_TYPE NOT IN ('IMP')
              ${prinWhereClause}
              ${groupWhereClause}
              ${prodInClause}
            ORDER BY PRIN_CODE, CUSTOMER, JOB_NO, DN_NO
        `;

        console.log("[DNSummaryReport] Executing SQL:", sql);

        const dataResult = await connection.execute(sql, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        const rows: DNSummaryRow[] = ((dataResult.rows as any[]) || []).map((row) =>
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

        const html = buildDNSummaryHTML(rows, {
            loginid: loginid || "ADMIN",
            prin_code: code2 || "",
            group_code: code3 || "",
            prod_codes: prodCodes.join(", "),
        });

        res.setHeader("Content-Type", "text/html");
        res.status(200).send(html);

    } catch (error: any) {
        console.error("DN Summary Report Error:", error);
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