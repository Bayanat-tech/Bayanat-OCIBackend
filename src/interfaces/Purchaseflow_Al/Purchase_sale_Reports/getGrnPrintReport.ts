import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";

const money = (v: any) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const text = (v: any) => (v == null ? "" : String(v));

const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

export const getGrnPrintReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    // 1. Params from PurchaseGrnEditor print button
    const { company_code, doc_type, doc_no, loginid } = req.body;

    if (!company_code || !doc_type || !doc_no) {
      res.status(400).json({ success: false, message: "company_code, doc_type, doc_no required" });
      return;
    }

    // 2. Tenant/connection
    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) {
      tenantId = await TenantManager.getTenantForUser(loginid);
    }
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    // 3. Main GRN header + detail query
    const grnResult = await connection.execute(
      `SELECT vw_erp_grn.company_code, vw_erp_grn.doc_type, vw_erp_grn.doc_no, vw_erp_grn.doc_date,
              vw_erp_grn.div_code, vw_erp_grn.div_name, vw_erp_grn.dept_code, vw_erp_grn.remarks,
              vw_erp_grn.ref_no, vw_erp_grn.ref_date, vw_erp_grn.ac_code, vw_erp_grn.curr_code,
              vw_erp_grn.ex_rate, vw_erp_grn.disc_hdr_percent, vw_erp_grn.disc_hdr_price,
              vw_erp_grn.payment_terms, vw_erp_grn.credit_period, vw_erp_grn.due_date,
              vw_erp_grn.party_name, vw_erp_grn.party_address, vw_erp_grn.party_phone, vw_erp_grn.party_fax,
              vw_erp_grn.inv_generated, vw_erp_grn.delivery_to, vw_erp_grn.dlvr_contact,
              vw_erp_grn.dlvr_email, vw_erp_grn.dlvr_mobile, vw_erp_grn.dlvr_term,
              vw_erp_grn.ref_doc_type, vw_erp_grn.ref_doc_no, vw_erp_grn.job_no,
              vw_erp_grn.cancelled, vw_erp_grn.cancelled_dt, vw_erp_grn.approved,
              vw_erp_grn.approved_by, vw_erp_grn.approved_dt, vw_erp_grn.serial_no,
              vw_erp_grn.prod_code, vw_erp_grn.prod_name, vw_erp_grn.det_remarks,
              vw_erp_grn.p_uom, vw_erp_grn.qty_puom, vw_erp_grn.l_uom, vw_erp_grn.qty_luom,
              vw_erp_grn.uppp, vw_erp_grn.quantity, vw_erp_grn.amount, vw_erp_grn.required_dt,
              vw_erp_grn.sign_ind, vw_erp_grn.qty_processed, vw_erp_grn.det_cancel,
              vw_erp_grn.det_cancel_date, vw_erp_grn.unit_price, vw_erp_grn.disc_price,
              vw_erp_grn.disc_percent
       FROM vw_erp_grn
       WHERE company_code = :company_code
         AND doc_type = :doc_type
         AND TO_CHAR(doc_no) = TO_CHAR(:doc_no)`,
      {
        company_code,
        doc_type,
        doc_no,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const grnRows = ((grnResult.rows as any[]) || []).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    if (grnRows.length === 0) {
      res.status(404).json({ success: false, message: "GRN not found" });
      return;
    }

    const header = grnRows[0]; // header fields are same across all rows

    // 4. Terms query (rpt_ac_terms)
    const termsResult = await connection.execute(
      `SELECT srno, term, is_payterm
       FROM ms_ac_setup_terms
       WHERE doc_id = :doc_type
       ORDER BY srno`,
      { doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const termsRows = ((termsResult.rows as any[]) || []).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // 5. Footer query (rpt_ac_footer -> prepared/verified/approved/received)
    const footerResult = await connection.execute(
      `SELECT prepared, verified, approved, received
       FROM ms_ac_setup_doc
       WHERE doc_id = :doc_type`,
      { doc_type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const footerRows = ((footerResult.rows as any[]) || []).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );
    const footer = footerRows[0] || {};

    // 6. Build detail rows HTML
    let totalPQty = 0;
    let totalLQty = 0;
    let totalQty = 0;

    let detailHtml = "";
    grnRows.forEach((r) => {
      const pQty = Number(r.qty_puom) || 0;
      const lQty = Number(r.qty_luom) || 0;
      const qty = Number(r.quantity) || 0;
      totalPQty += pQty;
      totalLQty += lQty;
      totalQty += qty;

      detailHtml += `
        <tr>
          <td>${text(r.prod_code)} - ${text(r.prod_name)}</td>
          <td class="num">${text(r.p_uom)}</td>
          <td class="num">${money(pQty)}</td>
          <td class="num">${text(r.l_uom)}</td>
          <td class="num">${money(lQty)}</td>
          <td class="num">${money(qty)}</td>
        </tr>`;
    });

    // 7. Terms HTML (rpt_ac_terms) — plain list, no box/border
    let termsHtml = "";
    termsRows.forEach((t) => {
      termsHtml += `<div class="term-line">${text(t.term)}</div>`;
    });

    // 8. Meta info
    const grnNo = `${text(header.doc_type)}-${text(header.doc_no)}`;

    // Combine contact + mobile into one clean row instead of a blank-label row
    const contactMobile = [text(header.dlvr_contact), text(header.dlvr_mobile)]
      .filter((v) => v)
      .join(" / ");

    // 9. Final HTML — layout matches rpt_print_purchgrn DataWindow
    const reportHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GRN ${grnNo}</title>
        <style>
          :root { color-scheme: light; }
          html, body { height:100%; margin:0; font-family: Arial, Helvetica, sans-serif; background:#f2f4f7; color:#1f2937; }
          .page {
            width:100%;
            max-width:1000px;
            min-height: 277mm; /* A4 height minus @page margins, so footer has room to sit at the bottom */
            margin:20px auto;
            padding:24px 28px;
            background:white;
            box-sizing:border-box;
            display:flex;
            flex-direction:column;
          }
          .page-body { flex: 1 0 auto; }

          .header-top { display:flex; justify-content:space-between; align-items:stretch; gap:20px; border-bottom:1px solid #ccc; padding-bottom:16px; margin-bottom:20px; }

          .title { font-size:18px; font-weight:bold; margin-bottom:6px; }

          .party-box { border:1px solid #cfd8e3; border-radius:4px; padding:12px 14px; width:48%; line-height:1.7; font-size:13px; }
          .party-box .label-line { font-weight:bold; margin-bottom:4px; }

          .meta-table { border-collapse: collapse; width:50%; }
          .meta-table td { padding:4px 6px; font-size:13px; vertical-align: middle; line-height:1.5; }
          .meta-table .label { font-weight:bold; width:90px; white-space:nowrap; }
          .meta-table .colon { width:14px; }
          .meta-table .val { width:150px; }

          .brand-name { font-size:20px; font-weight:bold; color:#0d4d89; text-align:right; }

          .report-table { width:100%; border-collapse:collapse; margin-top:15px; }
          .report-table th, .report-table td { border:1px solid #cfd8e3; padding:6px; font-size:12px; }
          .report-table th { background:#f4f6f9; text-align:center; }
          .num { text-align:right; font-family:"Courier New", monospace; }
          .total-row td { background:#f8fafc; font-weight:bold; border-top:2px solid #334155; }

          .remarks-box { margin-top:14px; font-size:13px; }
          .remarks-box .label { font-weight:bold; margin-right:4px; }

          .terms-section { margin-top:10px; font-size:12px; color:#374151; }
          .term-line { margin-bottom:2px; }

          .footer-sign { display:flex; justify-content:space-between; margin-top:auto; padding-top:60px; text-align:center; font-size:12px; }
          .footer-sign div { border-top:1px solid #333; padding-top:6px; width:20%; }

          .no-print { text-align:right; margin-bottom:15px; }
          .button { padding:8px 16px; border:none; background:#2563eb; color:white; border-radius:20px; cursor:pointer; }
          @page { size: A4 portrait; margin: 10mm; }
          @media print {
            html, body { background:white; }
            .page {
              margin:0;
              max-width:100%;
              width:100%;
              min-height: 0;
              height: 100vh; /* exactly one printed page tall */
              box-shadow:none;
              overflow: hidden;
            }
          }
          @media print { .no-print { display:none; } }
        </style>
      </head>
      <body>
        <div class="no-print">
          <button class="button" onclick="window.print()">Print / Save PDF</button>
        </div>
        <div class="page">
          <div class="page-body">
          <div class="header-top">
            <div class="party-box">
              <div class="label-line">To,</div>
              <div>${text(header.party_name)}</div>
              <div>${text(header.party_address)}</div>
              <div>Tel: ${text(header.party_phone)} &nbsp;&nbsp; Fax: ${text(header.party_fax)}</div>
            </div>
            <table class="meta-table">
              <tr>
                <td class="label">GRN No.</td><td class="colon">:</td><td class="val">${grnNo}</td>
                <td class="label">Date</td><td class="colon">:</td><td class="val">${formatDateStr(header.doc_date)}</td>
              </tr>
              <tr>
                <td class="label">A/C Code</td><td class="colon">:</td><td class="val" colspan="4">${text(header.ac_code)}</td>
              </tr>
              <tr>
                <td class="label">Ref No.</td><td class="colon">:</td><td class="val">${text(header.ref_no)}</td>
                <td class="label">Date</td><td class="colon">:</td><td class="val">${formatDateStr(header.ref_date)}</td>
              </tr>
              <tr>
                <td class="label">Deliver To</td><td class="colon">:</td><td class="val" colspan="4">${text(header.delivery_to)}</td>
              </tr>
              <tr>
                <td class="label">Contact</td><td class="colon">:</td><td class="val" colspan="4">${text(contactMobile)}</td>
              </tr>
              <tr>
                <td class="label">Email</td><td class="colon">:</td><td class="val" colspan="4">${text(header.dlvr_email)}</td>
              </tr>
            </table>
          </div>

          <div class="title">${text(header.div_name)} - GRN</div>
          <div>Delivery Terms: ${text(header.dlvr_term)}</div>

          <table class="report-table">
            <thead>
              <tr>
                <th>Product/Description</th>
                <th>PUOM</th>
                <th>P. Qty</th>
                <th>LUOM</th>
                <th>L. Qty</th>
                <th>Quantity in LUOM</th>
              </tr>
            </thead>
            <tbody>
              ${detailHtml}
              <tr class="total-row">
                <td colspan="2" class="num">Total :</td>
                <td class="num">${money(totalPQty)}</td>
                <td></td>
                <td class="num">${money(totalLQty)}</td>
                <td class="num">${money(totalQty)}</td>
              </tr>
            </tbody>
          </table>

          <div class="remarks-box"><span class="label">Remarks:</span>${text(header.remarks)}</div>

          <div class="terms-section">${termsHtml}</div>
          </div>

          <div class="footer-sign">
            <div>${text(footer.prepared) || "Prepared By"}</div>
            <div>${text(footer.verified) || "Verified By"}</div>
            <div>${text(footer.approved) || "Approved By"}</div>
            <div>${text(footer.received) || "Received By"}</div>
          </div>
        </div>
      </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("GRN Report Generation Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate GRN report", details: error.message });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) { console.error("Connection close error:", e); }
    }
  }
};