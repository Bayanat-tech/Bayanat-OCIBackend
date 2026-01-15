import oracledb from "oracledb";
import { Request, Response } from "express";

export async function updatebilling(req: Request, res: Response) {
  let connection;

  try {
    connection = await oracledb.getConnection();

    /* Header (single record → array) */
    const headerRows = [
      {
        COMPANY_CODE: req.body.invoice.COMPANY_CODE,
        INVOICE_NO: req.body.invoice.INVOICE_NO,
        INVOICE_DATE: req.body.invoice.INVOICE_DATE,
        JOB_NO: req.body.invoice.JOB_NO,
        PRIN_CODE: req.body.invoice.PRIN_CODE,
        CUST_CODE: req.body.invoice.CUST_CODE,
        INV_AMOUNT: req.body.invoice.INV_AMOUNT,
        CURR_CODE: req.body.invoice.CURR_CODE,
        INV_STATUS: req.body.invoice.INV_STATUS,
        USER_ID: req.body.invoice.USER_ID
      }
    ];

    /* Detail (multiple records) */
    const detailRows = req.body.invoiceDetails.map((d: any) => ({
      COMPANY_CODE: d.COMPANY_CODE,
      INVOICE_NO: d.INVOICE_NO,
      SRNO: d.SRNO,
      ACT_CODE: d.ACT_CODE,
      BILL: d.BILL,
      COST: d.COST,
      QUANTITY: d.QUANTITY,
      BILL_RATE: d.BILL_RATE,
      COST_RATE: d.COST_RATE,
      INV_DESC: d.INV_DESC,
      USER_ID: d.USER_ID
    }));

    await connection.execute(
      `
      BEGIN
        PROC_UPDATE_INVOICE_DTLS(
          :p_invoice_hdr,
          :p_invoice_dtl
        );
      END;
      `,
      {
        p_invoice_hdr: {
          type: "T_INVOICE_TAB",
          val: headerRows
        },
        p_invoice_dtl: {
          type: "T_INVOICE_DTL_TAB",
          val: detailRows
        }
      },
      { autoCommit: true }
    );

    res.json({ message: "Invoice updated successfully" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Invoice update failed" });

  } finally {
    if (connection) {
      await connection.close();
    }
  }
}
