import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";


// ─── Helpers ──────────────────────────────────────────────────────────────────

const text = (v: any) => (v == null ? "" : String(v));

const num = (v: any) => Number(v) || 0;

const formatDateStr = (v: any) => {
  if (!v) return "00-00-0000";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
};

const formatDateOracle = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
};

const qtyFmt = (v: any) => {
  const n = num(v);
  return n === 0 ? "0" : n.toLocaleString("en-US");
};

// ─── Controller ───────────────────────────────────────────────────────────────

export const getTransactionProductReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    /*
     * Frontend sends:
     *   loginid       → loginid
     *   code1         → company_code
     *   code2         → prin_code
     *   code3         → prod_from
     *   code4         → prod_to
     *   code5         → site_from
     *   code6         → site_to
     *   code7         → location_from
     *   code8         → location_to
     *   code9         → cust_from
     *   code10        → cust_to
     *   code11        → lot_from
     *   code12        → lot_to
     *   code13        → batch_from
     *   code14        → batch_to
     *   code15        → model_number (All or specific)
     *   code16        → pallet_from
     *   code17        → pallet_to
     *   date1         → exp_date_from  (DD-MON-YYYY)
     *   date2         → exp_date_to    (DD-MON-YYYY)
     *   date3         → txn_date_from  (DD-MON-YYYY)
     *   date4         → txn_date_to    (DD-MON-YYYY)
     */

    const {
      loginid,

      code1,
      code2,
      code3,
      code4,
      code5,
      code6,
      code7,
      code8,
      code9,
      code10,
      code11,
      code12,
      code13,
      code14,
      code15,
      code16,
      code17,
      code18,
      code19,
      code20,

      number1,
      number2,
      number3,
      number4,

      date1,
      date2,
      date3,
      date4,

      groupedOn
    } = req.body;

    const parameter = "WMS_Stock_TRANSACTION_PRODUCT_REPORT";

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

      code1: code1 || null,
      code2: code2 || null,
      code3: code3 || null,
      code4: code4 || null,
      code5: code5 || null,
      code6: code6 || null,
      code7: code7 || null,
      code8: code8 || null,
      code9: code9 || null,
      code10: code10 || null,
      code11: code11 || null,
      code12: code12 || null,
      code13: code13 || null,
      code14: code14 || null,

      // 🔥 IMPORTANT: always bind even if not used
      code15: null, // MODEL_NUMBER not used
      code16: null, // PALLET_ID from
      code17: null, // PALLET_ID to

      code18: null,
      code19: null,
      code20: null,

      number1: null,
      number2: null,
      number3: null,
      number4: null,

      date1: date1 || null,
      date2: date2 || null,
      date3: date3 || null,
      date4: date4 || null,

      out_sql: {
        dir: oracledb.BIND_OUT,
        type: oracledb.STRING,
        maxSize: 32767,
      },
    };
    console.log("code2:", code2);

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

    console.log("Dynamic SQL generated:👍", rawSql);

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

    // ── Group rows by prod_code ───────────────────────────────────────
  
    type TxnRow = (typeof rows)[0] & {
      _running_p?: number;
      _running_l?: number;
    };
    type ProdGroup = {
      prod_code: string;
      prod_name: string;
      p_uom: string;
      l_uom: string;
      uppp: any;
      pqty_op_balance: number;
      lqty_op_balance: number;
      rows: TxnRow[];
    };

    const prodMap = new Map<string, ProdGroup>();

    rows.forEach((r) => {
      const key = text(r.prod_code);
      if (!prodMap.has(key)) {
        prodMap.set(key, {
          prod_code: key,
          prod_name: text(r.prod_name),
          p_uom: text(r.p_uom),
          l_uom: text(r.l_uom),
          uppp: r.uppp,
          pqty_op_balance: num(r.pqty_op_balance),
          lqty_op_balance: num(r.lqty_op_balance),
          rows: [],
        });
      }
      prodMap.get(key)!.rows.push(r);
    });

    // Closing balance
    prodMap.forEach((prod) => {
      let runningPQty = prod.pqty_op_balance;
      let runningLQty = prod.lqty_op_balance;
      prod.rows.forEach((r) => {
        runningPQty += num(r.quantity);
        runningLQty += 0;
        r._running_p = runningPQty;
        r._running_l = runningLQty;
      });
    });


    // ✅ Opening balance
    prodMap.forEach((prod) => {
      const earliestRow = prod.rows.reduce((earliest, r) => {
        if (!earliest) return r;
        return text(r.sort_date) < text(earliest.sort_date) ? r : earliest;
      }, prod.rows[0]);

      prod.pqty_op_balance = num(earliestRow?.pqty_op_balance);
      prod.lqty_op_balance = num(earliestRow?.lqty_op_balance);
    });

    // ── Principal name (from first row) ───────────────────────────────
    const principalCode = rows.length > 0 ? text(rows[0].prin_code) : text(code2);

    // ── Build HTML body ───────────────────────────────────────────────
    let tableBodyHtml = "";

    prodMap.forEach((prod) => {
      // ── Product header row ────────────────────────────────────────
      tableBodyHtml += `
            <tr class="prod-header-row">
              <td colspan="2">
                <strong>${prod.prod_code}</strong>
                &nbsp;&nbsp;&nbsp;
                <span style="font-size:11px;font-weight:400;color:#555;">${prod.prod_name}</span>
              </td>
              <td colspan="2" style="text-align:left;font-size:11px;">
                <strong>UPPP :</strong> ${text(prod.uppp)}
                &nbsp;&nbsp;
                <strong>Opening balance :</strong> 
                ${qtyFmt(prod.pqty_op_balance)} ${prod.p_uom}
                &nbsp;&nbsp;
                ${qtyFmt(prod.lqty_op_balance)} ${prod.l_uom}
              </td>
              <td colspan="9"></td>
            </tr>`;

      prod.rows.forEach((r) => {
        const qty = num(r.quantity);
        const pCl = num(r._running_p);
        const lCl = num(r._running_l);

        // Row 1: main transaction line
        tableBodyHtml += `
                <tr class="detail-row-1">
                  <td class="date-cell">${formatDateStr(r.txn_date)}</td>
                  <td class="ref-cell">${text(r.doc_ref)}</td>
                  <td class="site-cell">${text(r.site_code)}</td>
                  <td class="loc-cell">${text(r.location_code)}</td>
                  <td class="type-cell">${text(r.txn_type)}</td>
                  <td class="num">${qtyFmt(qty)}</td>
                  <td class="uom-cell">${prod.p_uom}</td>
                  <td class="num">0</td>
                  <td class="uom-cell">${prod.l_uom}</td>
                  <td class="num">${qtyFmt(pCl)}</td>
                  <td class="uom-cell">${prod.p_uom}</td>
                  <td class="num">0</td>
                  <td class="uom-cell">${prod.l_uom}</td>
                </tr>
                <tr class="detail-row-2">
                  <td class="date-cell">${formatDateStr(r.mfg_date)}</td>
                  <td class="date-cell">${formatDateStr(r.exp_date)}</td>
                  <td colspan="2" style="font-size:10px;color:#555;">
                    ${text(r.container_no)}
                    ${text(r.order_no) ? `&nbsp;/&nbsp;${text(r.order_no)}` : ""}
                    ${text(r.job_no) ? `&nbsp;/&nbsp;${text(r.job_no)}` : ""}
                  </td>
                  <td colspan="9" style="font-size:10px;color:#555;">
                    user: ${text(r.cust_code)}
                    &nbsp;&nbsp;
                    user dt: ${formatDateStr(r.txn_date)}
                    &nbsp;&nbsp;
                    Unit Price:
                    ${text(r.lot_no) ? `&nbsp;&nbsp; Lot: ${text(r.lot_no)}` : ""}
                    ${text(r.batch_no) ? `&nbsp;&nbsp; Batch: ${text(r.batch_no)}` : ""}
                  </td>
                </tr>`;
      });

      // ── Closing balance row ───────────────────────────────────────
      const lastRow = prod.rows[prod.rows.length - 1];
      const finalPCl = lastRow ? num(lastRow._running_p) : prod.pqty_op_balance;
      const finalLCl = lastRow ? num(lastRow._running_l) : prod.lqty_op_balance;

      tableBodyHtml += `
            <tr class="closing-row">
              <td colspan="5" style="text-align:right;padding-right:12px;">
                <strong>Closing Balance :</strong>
              </td>
              <td class="num"><strong>${qtyFmt(finalPCl)}</strong></td>
              <td><strong>${prod.p_uom}</strong></td>
              <td class="num"><strong>${qtyFmt(finalLCl)}</strong></td>
              <td><strong>${prod.l_uom}</strong></td>
              <td colspan="4"></td>
            </tr>
            <tr><td colspan="13" style="height:8px;border:none;"></td></tr>`;
    });

    // ── Report date/time ──────────────────────────────────────────────
    const now = new Date();
    const reportDateTime = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} ${now.getHours() >= 12 ? "PM" : "AM"}`;

    // ─── Final HTML ───────────────────────────────────────────────────
    const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Transaction Report grouped on Product</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
      font-size:11px; color:#222; margin:24px; background:#f5f5f5;
    }
    .page {
      background:white; padding:28px 32px;
      box-shadow:0 0 10px rgba(0,0,0,.1); min-height:297mm;
    }

    /* ── Header ── */
    .report-header {
      display:flex; justify-content:space-between; align-items:flex-start;
      border-bottom:2px solid #333; padding-bottom:10px; margin-bottom:4px;
    }
    .company-logo img { max-height:60px; }
    .company-name-text { font-size:18px; font-weight:700; color:#185FA5; }
    .company-sub { font-size:10px; letter-spacing:2px; color:#555; }
    .meta-table td { padding:2px 8px 2px 0; vertical-align:top; font-size:11px; }
    .meta-label { font-weight:600; color:#555; min-width:60px; }

    /* ── Report title ── */
    .report-title {
      font-size:20px; font-weight:700; color:#111;
      margin:10px 0 6px;
    }

    /* ── Principal banner ── */
    .principal-banner {
      font-size:13px; font-weight:700; margin-bottom:10px;
      padding: 4px 0;
    }

    /* ── Table ── */
    table.report-table { width:100%; border-collapse:collapse; }
    table.report-table thead tr th {
      border-top:1.5px solid #333; border-bottom:1.5px solid #333;
      padding:5px 5px; text-align:left; background:#fff;
      font-size:10px; white-space:nowrap;
    }
    table.report-table td {
      padding:3px 5px; vertical-align:middle;
      border-bottom:0.3px solid #f0f0f0;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      font-size:11px;
    }
    .num { text-align:right !important; font-family:'Courier New',monospace; }

    /* ── Column sizing ── */
    .date-cell     { width:80px; }
    .ref-cell      { width:120px; }
    .site-cell     { width:50px; }
    .loc-cell      { width:80px; }
    .type-cell     { width:40px; font-weight:600; }
    .uom-cell      { width:36px; font-size:10px; color:#555; }

    /* ── Row types ── */
    .prod-header-row td {
      background:#f5f5f5;
      border-top:1.5px solid #333;
      border-bottom:1px solid #ccc;
      padding:5px 8px; font-size:12px;
    }
    .detail-row-1 td { background:#fff; }
    .detail-row-2 td {
      background:#fafafa;
      border-bottom:0.5px solid #eee;
      padding-bottom:5px;
      color:#555;
    }
    .detail-row-1:hover td, .detail-row-2:hover td { background:#f0f7ff; }
    .closing-row td {
      border-top:1.5px solid #555;
      border-bottom:2px solid #555;
      background:#f3f3f3;
      padding:4px 5px;
    }

    /* ── Footer ── */
    .footer { margin-top:32px; text-align:center; font-weight:600; border-top:1px solid #333; padding-top:8px; font-size:11px; color:#555; }
    .powered-by { text-align:right; font-size:10px; color:#aaa; margin-top:4px; }

    @media print {
      body { background:white; margin:0; }
      .page { box-shadow:none; padding:16px; }
      .no-print { display:none; }
    }
  </style>
</head>
<body>

<div class="no-print" style="margin-bottom:12px;text-align:right;">
  <button onclick="window.print()"
    style="padding:7px 20px;cursor:pointer;background:#185FA5;color:#fff;border:none;border-radius:5px;font-size:12px;">
    Print / Save PDF
  </button>
</div>

<div class="page">

  <!-- ── Page header ── -->
  <div class="report-header">
    <table class="meta-table">
      <tr><td class="meta-label">Date :</td><td>${reportDateTime}</td></tr>
      <tr><td class="meta-label">User :</td><td>${text(loginid)}</td></tr>
      <tr><td class="meta-label">Report :</td><td>rpt_txn_prod</td></tr>
    </table>
    <div style="text-align:right;">
      <div class="company-name-text">YOUR COMPANY</div>
      <div class="company-sub">FREIGHT SOLUTIONS</div>
    </div>
  </div>

  <!-- ── Report title ── -->
  <div class="report-title">Transaction Report grouped on Product</div>

  <!-- ── Principal banner ── -->
  <div class="principal-banner">Principal: &nbsp;&nbsp; ${principalCode}</div>

  <!-- ── Main table ── -->
  <table class="report-table">
    <thead>
      <tr>
        <th rowspan="2" style="width:80px;">Product<br/><span style="font-weight:400;font-size:10px;">MFG Date</span></th>
        <th rowspan="2" style="width:80px;"><span style="font-weight:400;font-size:10px;">TXN Date</span><br/><span style="font-weight:400;font-size:10px;">EXP Date</span></th>
        <th rowspan="2" style="width:120px;">Container No.<br/>/Order No./Job No</th>
        <th rowspan="2" style="width:80px;">Doc. Ref.</th>
        <th rowspan="2" style="width:50px;">Site</th>
        <th rowspan="2" style="width:80px;">Location</th>
        <th rowspan="2" style="width:40px;">Type</th>
        <th colspan="4" style="text-align:center;">Quantity</th>
        <th colspan="4" style="text-align:center;">Closing balance</th>
      </tr>
      <tr>
        <th class="num" style="width:70px;">Primary</th>
        <th style="width:36px;">UOM</th>
        <th class="num" style="width:60px;">Least</th>
        <th style="width:36px;">UOM</th>
        <th class="num" style="width:70px;">Primary</th>
        <th style="width:36px;">UOM</th>
        <th class="num" style="width:60px;">Least</th>
        <th style="width:36px;">UOM</th>
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
    console.error("Transaction Product Report Error:", error);
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