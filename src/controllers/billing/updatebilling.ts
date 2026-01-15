import { RequestHandler } from "express";
import oracledb from "oracledb";

export const updatebilling: RequestHandler = async (req, res) => {
  let connection: oracledb.Connection | undefined;

  try {
    const invoiceHeader = req.body.invoiceHeader; // ✅ already JS object
    const invoiceDetails = req.body.invoiceDetails; // ✅ already JS object

    if (!Array.isArray(invoiceHeader) || !Array.isArray(invoiceDetails)) {
      res.status(400).json({ error: "Invoice header or details missing" });
      return;
    }

    connection = await oracledb.getConnection();

    const headerRows = invoiceHeader.map((h: any) => ({
      COMPANY_CODE: h.COMPANY_CODE,
      INVOICE_NO: h.INVOICE_NO,
      INVOICE_DATE: h.INVOICE_DATE,
      JOB_NO: h.JOB_NO,
      PRIN_CODE: h.PRIN_CODE,
      CUST_CODE: h.CUST_CODE,
      INV_AMOUNT: h.INV_AMOUNT,
      CURR_CODE: h.CURR_CODE,
      INV_STATUS: h.INV_STATUS,
      USER_ID: h.USER_ID
    }));

    const detailRows = invoiceDetails.map((d: any) => ({
      COMPANY_CODE: d.COMPANY_CODE,
      INVOICE_NO: d.invoice_no,
      SRNO: d.srno,
      ACT_CODE: d.act_code,
      BILL: d.bill_amount,
      COST: d.cost_amount,
      QUANTITY: d.quantity,
      BILL_RATE: d.bill_rate,
      COST_RATE: d.cost_rate,
      INV_DESC: d.inv_desc,
      USER_ID: d.USER_ID
    }));

    await connection.execute(
      `BEGIN PROC_UPDATE_INVOICE_DTLS(:p_invoice_hdr, :p_invoice_dtl); END;`,
      {
        p_invoice_hdr: { type: "T_INVOICE_TAB", val: headerRows },
        p_invoice_dtl: { type: "T_INVOICE_DTL_TAB", val: detailRows }
      },
      { autoCommit: true }
    );

    res.status(200).json({ message: "Invoice updated successfully" });
    return;
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Invoice update failed" });
    return;
  } finally {
    if (connection) await connection.close();
  }
};
