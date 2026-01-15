import { RequestHandler } from "express";
import oracledb from "oracledb";

// Define types for invoices
export interface TInvoice {
  COMPANY_CODE: string;
  INVOICE_NO: string;
  INVOICE_DATE: string; // or Date if you convert
  JOB_NO: string;
  PRIN_CODE: string;
  CUST_CODE: string;
  INV_AMOUNT: number;
  CURR_CODE: string;
  INV_STATUS: string;
  USER_ID: string;
}

export interface TInvoiceDetail {
  COMPANY_CODE: string;
  invoice_no: string;
  srno: number;
  act_code: string;
  bill_amount: number;
  cost_amount: number;
  quantity: number;
  bill_rate: number;
  cost_rate: number;
  inv_desc: string;
  USER_ID: string;
}

// Typed request body
interface UpdateBillingReqBody {
  invoiceHeader: TInvoice[];
  invoiceDetails: TInvoiceDetail[];
}

export const updatebilling: RequestHandler<any, any, UpdateBillingReqBody> = async (req, res) => {
  let connection: oracledb.Connection | undefined;

  try {
    const { invoiceHeader, invoiceDetails } = req.body;

    // Validate input
    if (!Array.isArray(invoiceHeader) || !Array.isArray(invoiceDetails)) {
      res.status(400).json({ error: "Invoice header or details missing" });
      return;
    }

    // Get Oracle connection
    connection = await oracledb.getConnection();

    // Map header rows
    const headerRows = invoiceHeader.map((h) => ({
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

    // Map detail rows
    const detailRows = invoiceDetails.map((d) => ({
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

    // Execute stored procedure
    await connection.execute(
      `BEGIN PROC_UPDATE_INVOICE_DTLS(:p_invoice_hdr, :p_invoice_dtl); END;`,
      {
        p_invoice_hdr: { type: "T_INVOICE_TAB", val: headerRows },
        p_invoice_dtl: { type: "T_INVOICE_DTL_TAB", val: detailRows }
      },
      { autoCommit: true }
    );

    res.status(200).json({ message: "Invoice updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Invoice update failed" });
  } finally {
    if (connection) await connection.close();
  }
};
