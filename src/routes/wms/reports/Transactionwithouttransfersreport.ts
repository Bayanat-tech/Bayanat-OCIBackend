import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const text = (v: any) => (v == null ? "" : String(v).trim());

const num = (v: any) => Number(v) || 0;

const formatDate = (v: any): string => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const formatDateTime = (d: Date): string => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = String(hh % 12 || 12).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${h12}:${min}:${sec} ${ampm}`;
};

const qtyFmt = (v: any): string => {
  const n = num(v);
  if (n === 0) return "0";
  return n.toLocaleString("en-US");
};

// ─── Controller ───────────────────────────────────────────────────────────────

export const getTransactionWithoutTransfersReport = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;
  try {
    /*
     * Frontend sends:
     *   loginid      → loginid
     *   code1        → company_code
     *   code2        → prin_code
     *   code3        → prod_from
     *   code4        → prod_to
     *   code5        → site_from
     *   code6        → site_to
     *   code7        → location_from
     *   code8        → location_to
     *   code9        → cust_from
     *   code10       → cust_to
     *   code11       → lot_from
     *   code12       → lot_to
     *   code13       → batch_from
     *   code14       → batch_to
     *   code15       → model_number  ("All" or specific)
     *   code16       → pallet_from   ("All" or specific)
     *   code17       → pallet_to
     *   code18       → txn_type_from
     *   code19       → txn_type_to
     *   code20       → doc_ref_from / doc_ref_to  (or job_from/job_to)
     *   date1        → exp_date_from  (DD-MON-YYYY)
     *   date2        → exp_date_to
     *   date3        → txn_date_from
     *   date4        → txn_date_to
     *
     * SQL columns returned (grouped):
     *   company_code, prin_code, prod_code, prod_name,
     *   txn_date, sort_date, doc_ref, txn_type,
     *   p_uom, l_uom,
     *   pqty_op_balance, lqty_op_balance,
     *   pqty_cl_balance, lqty_cl_balance,
     *   container_no, order_no, job_no,
     *   uppp, qunatity (note: DB alias is QUNATITY),
     *   qty_opening,
     *   lot_no, exp_date, inb_jobno,
     *   batch_no, mfg_date
     */

    const {
      loginid,
      code1, code2, code3, code4, code5, code6,
      code7, code8, code9, code10, code11, code12,
      code13, code14, code15, code16, code17,
      code18, code19, code20,
      number1, number2, number3, number4,
      date1, date2, date3, date4,
    } = req.body;

    const parameter = "WMS_Stock_TRANSACTION_WITHOUT_TRANSFER_REPORT";

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
      code15: code15 || null,
      code16: code16 || null,
      code17: code17 || null,
      code18: code18 || null,
      code19: code19 || null,
      code20: code20 || null,
      number1: number1 || null,
      number2: number2 || null,
      number3: number3 || null,
      number4: number4 || null,
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




    console.log(rawSql);


    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

    console.log("Dynamic SQL:", rawSql);

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
      uppp: any;
      p_uom: string;
      l_uom: string;
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
          uppp: r.uppp,
          p_uom: text(r.p_uom) || "PCS",
          l_uom: text(r.l_uom) || "PCS",
          pqty_op_balance: num(r.qty_opening),
          lqty_op_balance: num(r.lqty_op_balance),
          rows: [],
        });
      }
      prodMap.get(key)!.rows.push(r);
    });


    prodMap.forEach((prod) => {
      let runningPQty = prod.pqty_op_balance;
      let runningLQty = prod.lqty_op_balance;

      prod.rows.forEach((r) => {
        runningPQty += num(r.qunatity);  // running sum
        r._running_p = runningPQty;      // each row la attach karo
        r._running_l = runningLQty;      // L_UOM same logic
      });
    });

    // ── Header info ───────────────────────────────────────────────────
    const principalCode = rows.length > 0 ? text(rows[0].prin_code) : text(code2);
    const principalName = rows.length > 0 ? text(rows[0].prin_name || "") : "";
    const reportDateTime = formatDateTime(new Date());

    // Period string from date3 / date4 (txn_date range)
    const periodFrom = text(date3);
    const periodTo = text(date4);
    const periodStr = periodFrom && periodTo
      ? `${periodFrom} - ${periodTo}`
      : "";

    // ── Count total pages (one per product) ───────────────────────────
    // We accumulate all product blocks then split into pages (A4 landscape ~28 rows)
    const ROWS_PER_PAGE = 28;

    type PageBlock = {
      prinCode: string;
      prinName: string;
      rows: string[]; // HTML tr strings
    };

    // Build flat list of TR rows across all products
    const allTrRows: string[] = [];

    prodMap.forEach((prod) => {

      // ── Product header (2 rows) ───────────────────────────────
      allTrRows.push(`
            <tr class="prod-header-row-1">
              <td class="pc1"><strong>${prod.prod_code}</strong></td>
              <td></td>
              <td class="type-cell"></td>
              <td class="job-cell"></td>
              <td class="container-cell"></td>
              <td class="docref-cell"></td>
              <td class="qty-num"></td>
              <td class="uom-cell"></td>
              <td class="qty-num">0</td>
              <td class="uom-cell">${prod.l_uom}</td>
              <td class="qty-num">0</td>
              <td class="uom-cell">${prod.p_uom}</td>
              <td class="qty-num">0</td>
              <td class="uom-cell">${prod.l_uom}</td>
            </tr>
            <tr class="prod-header-row-2">
              <td colspan="2" class="prod-name-cell">${prod.prod_name}</td>
              <td colspan="3" class="uppp-cell">
                <strong>UPPP :</strong>&nbsp;&nbsp;${text(prod.uppp)}&nbsp;&nbsp;&nbsp;&nbsp;
                <strong>Opening balance :</strong>&nbsp;&nbsp;${qtyFmt(prod.pqty_op_balance)}&nbsp;&nbsp;&nbsp;${qtyFmt(prod.lqty_op_balance)}
              </td>
              <td colspan="9"></td>
            </tr>`);

      // ── Transaction rows ──────────────────────────────────────
      prod.rows.forEach((r) => {
        const qty = num(r.qunatity); 
        const pCl = num(r._running_p);
        const lCl = num(r._running_l);

        // Container / Order / Batch line
        const containerLine = [
          text(r.container_no) !== " " ? text(r.container_no) : "",
          text(r.order_no) !== " " ? text(r.order_no) : "",
          text(r.job_no),
        ].filter(Boolean).join(" / ");

        // Doc Ref / Inb Job No line
        const docRefLine = text(r.doc_ref);
        const inbJobLine = text(r.inb_jobno);

        allTrRows.push(`
                <tr class="txn-row">
                  <td class="lot-cell">${text(r.lot_no) !== " " ? text(r.lot_no) : ""}</td>
                  <td class="txndate-cell">${formatDate(r.txn_date)}</td>
                  <td class="type-cell">${text(r.txn_type)}</td>
                  <td class="job-cell">${text(r.job_no)}</td>
                  <td class="container-cell">
                    ${text(r.container_no) !== " " ? text(r.container_no) : ""}
                    ${text(r.order_no) !== " " ? `<br/><span class="sub-text">${text(r.order_no)}</span>` : ""}
                  </td>
                  <td class="docref-cell">
                    ${docRefLine}<br/>
                    <span class="sub-text">${inbJobLine}</span>
                  </td>
                  <td class="qty-num">${qtyFmt(qty)}</td>
                  <td class="uom-cell">${prod.p_uom}</td>
                  <td class="qty-num">0</td>
                  <td class="uom-cell">${prod.l_uom}</td>
                  <td class="qty-num">${qtyFmt(pCl)}</td>
                  <td class="uom-cell">${prod.p_uom}</td>
                  <td class="qty-num">0</td>
                  <td class="uom-cell">${prod.l_uom}</td>
                </tr>
                <tr class="txn-row-sub">
                  <td class="mfgdate-cell">${formatDate(r.mfg_date)}</td>
                  <td class="expdate-cell">${formatDate(r.exp_date)}</td>
                  <td colspan="12"></td>
                </tr>`);
      });

      // ── Closing balance row ───────────────────────────────────
      const lastRow = prod.rows[prod.rows.length - 1];
      const finalPCl = lastRow ? num(lastRow._running_p) : prod.pqty_op_balance;
      const finalLCl = lastRow ? num(lastRow._running_l) : prod.lqty_op_balance;

      allTrRows.push(`
            <tr class="closing-row">
              <td colspan="6" class="closing-label">
                <strong>Closing Balance :</strong>
              </td>
              <td class="qty-num"><strong>${qtyFmt(finalPCl)}</strong></td>
              <td class="uom-cell"><strong>${prod.p_uom}</strong></td>
              <td class="qty-num"><strong>${qtyFmt(finalLCl)}</strong></td>
              <td class="uom-cell"><strong>${prod.l_uom}</strong></td>
              <td colspan="4"></td>
            </tr>
            <tr class="spacer-row"><td colspan="14"></td></tr>`);
    });

    // ── Split into pages ──────────────────────────────────────────────
    const totalItems = allTrRows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / ROWS_PER_PAGE));

    const pageChunks: string[][] = [];
    for (let i = 0; i < totalItems; i += ROWS_PER_PAGE) {
      pageChunks.push(allTrRows.slice(i, i + ROWS_PER_PAGE));
    }
    if (pageChunks.length === 0) pageChunks.push([]);

    // ── Column header HTML (reused on every page) ─────────────────────
    const colHeaderHtml = `
        <thead>
          <tr class="col-header-top">
            <th rowspan="2" class="th-product">Product<br/><span class="th-sub">Lot No.</span><br/><span class="th-sub">Mfg Date</span></th>
            <th rowspan="2" class="th-txndate"><span class="th-sub">Txn Date</span><br/><span class="th-sub">Exp Date</span></th>
            <th rowspan="2" class="th-type">Type</th>
            <th rowspan="2" class="th-job">Job no.</th>
            <th rowspan="2" class="th-container">Container No.<br/>/Order No/ Batch<br/>No</th>
            <th rowspan="2" class="th-docref">Doc. Ref. /<br/>Inb Job No</th>
            <th colspan="4" style="text-align:center;border-bottom:1px solid #aaa;">Quantity</th>
            <th colspan="4" style="text-align:center;border-bottom:1px solid #aaa;">Closing balance</th>
          </tr>
          <tr class="col-header-sub">
            <th class="qty-num">Primary</th>
            <th class="uom-col">UOM</th>
            <th class="qty-num">Least</th>
            <th class="uom-col">UOM</th>
            <th class="qty-num">Primary</th>
            <th class="uom-col">UOM</th>
            <th class="qty-num">Least</th>
            <th class="uom-col">UOM</th>
          </tr>
        </thead>`;

    // ── Build page HTML ───────────────────────────────────────────────
    const buildPageHtml = (pageNum: number, rowsHtml: string): string => `
        <div class="page">

          <!-- ── Logo & header ── -->
          <div class="report-header">
            <div class="logo-area">
              <div class="logo-box">
                <svg width="52" height="52" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="52" rx="3" fill="#1B5E20"/>
                  <rect x="6"  y="6"  width="18" height="6" rx="1" fill="#66BB6A"/>
                  <rect x="6"  y="14" width="24" height="6" rx="1" fill="#66BB6A"/>
                  <rect x="6"  y="22" width="20" height="6" rx="1" fill="#66BB6A"/>
                  <rect x="6"  y="30" width="14" height="6" rx="1" fill="#66BB6A"/>
                  <rect x="6"  y="38" width="10" height="8" rx="1" fill="#66BB6A"/>
                  <polygon points="32,16 46,28 32,40" fill="#A5D6A7"/>
                </svg>
              </div>
              <div class="logo-text">
                <div class="logo-company">T&#9671;P M&#9671;ST</div>
                <div class="logo-sub">FREIGHT SOLUTIONS</div>
                <div class="logo-tag">T O P M O S T &nbsp; F R E I G H T</div>
              </div>
            </div>
            <div class="header-right"></div>
          </div>

          <div class="header-line"></div>

          <!-- ── Report title ── -->
          <div class="report-title">
            Transaction Report WithOut Transfers &nbsp; for the Period ${periodStr}
          </div>

          <!-- ── Meta + page number ── -->
          <div class="meta-row">
            <table class="meta-table">
              <tr>
                <td class="meta-label">Date :</td>
                <td class="meta-val">${reportDateTime}</td>
              </tr>
              <tr>
                <td class="meta-label">User :</td>
                <td class="meta-val">${text(loginid) || "TOPMOST"}</td>
              </tr>
              <tr>
                <td class="meta-label">Report :</td>
                <td class="meta-val">rpt_txn_prod_without_transfers</td>
              </tr>
            </table>
            <div class="page-num">Page ${pageNum} of ${totalPages}</div>
          </div>

          <!-- ── Principal ── -->
          <div class="principal-line">
            <span class="principal-label">Principal:</span>
            &nbsp;&nbsp;
            <span class="principal-val">${principalCode}&nbsp;&nbsp;${principalName}</span>
          </div>

          <!-- ── Table ── -->
          <table class="report-table">
            ${colHeaderHtml}
            <tbody>
              ${rowsHtml || `<tr><td colspan="14" class="no-data">No records found.</td></tr>`}
            </tbody>
          </table>

          <div class="powered-by">powered by &nbsp; A W A R E</div>
        </div>`;

    // ── Assemble all pages ────────────────────────────────────────────
    let allPages = "";
    pageChunks.forEach((chunk, idx) => {
      if (idx > 0) allPages += `<div class="page-break"></div>`;
      allPages += buildPageHtml(idx + 1, chunk.join("\n"));
    });

    // ── Add "End of Report" on last page ──────────────────────────────
    // Append inside the last page — inject before powered-by
    allPages = allPages.replace(
      /(<div class="powered-by">powered by[\s\S]*?<\/div>\s*<\/div>)\s*$/,
      `<div class="end-of-report">End of Report</div>$1`
    );

    // ─── Final HTML ───────────────────────────────────────────────────
    const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Transaction Report WithOut Transfers</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      color: #111;
      background: #ddd;
    }

    /* ── Page ── */
    .page {
      background: white;
      width: 297mm;
      min-height: 210mm;
      margin: 14px auto;
      padding: 10px 16px 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
      position: relative;
    }

    /* ── Logo / header ── */
    .report-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 2px;
    }
    .logo-area {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .logo-text { line-height: 1.3; }
    .logo-company {
      font-size: 15px;
      font-weight: 900;
      color: #1B5E20;
      letter-spacing: 1px;
    }
    .logo-sub {
      font-size: 7.5px;
      letter-spacing: 2.5px;
      color: #555;
      text-transform: uppercase;
    }
    .logo-tag {
      font-size: 7px;
      letter-spacing: 2px;
      color: #888;
      margin-top: 2px;
    }
    .header-line {
      border-bottom: 1.5px solid #333;
      margin-bottom: 4px;
    }

    /* ── Report title ── */
    .report-title {
      font-size: 15px;
      font-weight: 700;
      color: #111;
      margin-bottom: 4px;
    }

    /* ── Meta row ── */
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2px;
    }
    .meta-table td { padding: 1px 5px 1px 0; font-size: 9px; }
    .meta-label {
      color: #555;
      text-decoration: underline;
      min-width: 52px;
    }
    .meta-val { color: #111; }
    .page-num {
      font-size: 9.5px;
      font-weight: 600;
      white-space: nowrap;
      padding-top: 2px;
    }

    /* ── Principal ── */
    .principal-line {
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 5px;
    }
    .principal-label { color: #111; }
    .principal-val   { color: #111; }

    /* ── Report table ── */
    table.report-table {
      width: 100%;
      border-collapse: collapse;
    }

    table.report-table thead tr.col-header-top th {
      border-top: 1.5px solid #333;
      border-bottom: 0.5px solid #aaa;
      padding: 3px 3px;
      font-size: 8.5px;
      text-align: left;
      background: #fff;
      white-space: nowrap;
      vertical-align: bottom;
    }
    table.report-table thead tr.col-header-sub th {
      border-bottom: 1.5px solid #333;
      padding: 2px 3px;
      font-size: 8.5px;
      background: #fff;
      white-space: nowrap;
    }
    .th-sub { font-weight: 400; font-size: 8px; }

    table.report-table td {
      padding: 2px 3px;
      font-size: 9px;
      vertical-align: top;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Column widths ── */
    .th-product   { width: 90px; }
    .th-txndate   { width: 65px; }
    .th-type      { width: 32px; }
    .th-job       { width: 78px; }
    .th-container { width: 100px; }
    .th-docref    { width: 95px; }
    .uom-col, .uom-cell { width: 32px; font-size: 8.5px; color: #444; }
    .qty-num, .qty-col  { text-align: right !important; width: 55px;
                          font-family: 'Courier New', monospace; }

    /* ── Cell helpers ── */
    .pc1         { font-size: 10px; }
    .lot-cell    { font-size: 8.5px; color: #666; }
    .mfgdate-cell, .expdate-cell { font-size: 8.5px; color: #666; }
    .txndate-cell { font-size: 9px; }
    .type-cell   { font-weight: 700; font-size: 9px; }
    .job-cell    { font-size: 8.5px; }
    .container-cell { font-size: 8.5px; }
    .docref-cell { font-size: 8.5px; }
    .sub-text    { font-size: 8px; color: #666; }

    /* ── Row types ── */
    .prod-header-row-1 td {
      background: #f7f7f7;
      border-top: 1.5px solid #333;
      padding: 3px 3px 1px;
      font-size: 10.5px;
    }
    .prod-header-row-2 td {
      background: #f7f7f7;
      border-bottom: 1px solid #ccc;
      padding: 0px 3px 3px;
    }
    .prod-name-cell { font-size: 9px; font-weight: 600; color: #222; }
    .uppp-cell      { font-size: 9px; color: #333; }

    .txn-row td {
      border-top: 0.3px solid #eee;
      padding-top: 3px;
      padding-bottom: 0;
    }
    .txn-row-sub td {
      border-bottom: 0.5px solid #eee;
      padding-top: 0;
      padding-bottom: 3px;
      font-size: 8.5px;
      color: #666;
    }
    .txn-row:hover td,
    .txn-row-sub:hover td { background: #f5faff; }

    .closing-row td {
      border-top: 1.5px solid #555;
      border-bottom: 2px solid #555;
      background: #f3f3f3;
      padding: 3px 3px;
    }
    .closing-label {
      text-align: right;
      padding-right: 10px;
      font-size: 9.5px;
    }

    .spacer-row td { height: 6px; border: none; }

    /* ── End of report ── */
    .end-of-report {
      text-align: center;
      font-size: 10.5px;
      font-weight: 700;
      padding: 8px 0 4px;
      color: #333;
    }

    /* ── Powered by ── */
    .powered-by {
      text-align: right;
      font-size: 8.5px;
      color: #aaa;
      margin-top: 6px;
      letter-spacing: 2px;
    }

    /* ── No data ── */
    .no-data {
      text-align: center;
      padding: 30px;
      color: #999;
    }

    /* ── Page break ── */
    .page-break { page-break-after: always; }

    /* ── Print button ── */
    .no-print { margin: 8px 0; text-align: right; }

    @media print {
      body { background: white; }
      .page {
        margin: 0;
        box-shadow: none;
        width: 100%;
        padding: 8mm 10mm;
        min-height: unset;
      }
      .no-print { display: none; }
      .page-break { page-break-after: always; }
    }
  </style>
</head>
<body>

<div class="no-print" style="padding:8px 16px;">
  <button onclick="window.print()"
    style="padding:6px 20px;cursor:pointer;background:#1B5E20;color:#fff;
           border:none;border-radius:4px;font-size:12px;font-weight:600;">
    🖨 Print / Save PDF
  </button>
</div>

${allPages}

</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Transaction Without Transfers Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to generate report",
      details: error.message,
    });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) {
        console.error("Connection close error:", e);
      }
    }
  }
};