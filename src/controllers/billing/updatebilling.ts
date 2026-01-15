import oracledb from "oracledb";
import { Request, Response } from "express";

/* =======================
   Interfaces
======================= */

export interface TInvoice {
  company_code: string;
  invoice_no: string;
  invoice_date: string | Date;
  job_no: string;
  prin_code: string;
  cust_code: string;
  inv_amount: number;
  curr_code: string;
  inv_status: string;
  user_id: string;
}

export interface TInvoiceDetail {
  company_code: string;
  invoice_no: string;
  srno: number;
  act_code: string;
  bill_amount: number;
  cost_amount: number;
  quantity: number;
  bill_rate: number;
  cost_rate: number;
  inv_desc: string;
  user_id: string;
}

/* =======================
   API
======================= */

export async function updateBilling(
  req: Request,
  res: Response
) {
  const connection = await oracledb.getConnection();

  try {
    console.log("UPDATE BILLING API HIT");
    console.log("Incoming body:", req.body);

    const { invoiceHeader, invoiceDetails } = req.body;

    /* =======================
       Map Header Rows
    ======================= */

    const headerRows = invoiceHeader.map((h: TInvoice) => ({
      COMPANY_CODE: h.company_code,
      INVOICE_NO: h.invoice_no,
      INVOICE_DATE: h.invoice_date,
      JOB_NO: h.job_no,
      PRIN_CODE: h.prin_code,
      CUST_CODE: h.cust_code,
      INV_AMOUNT: h.inv_amount,
      CURR_CODE: h.curr_code,
      INV_STATUS: h.inv_status,
      USER_ID: h.user_id
    }));

    /* =======================
       Map Detail Rows
    ======================= */

    const detailRows = invoiceDetails.map((d: TInvoiceDetail) => ({
      COMPANY_CODE: d.company_code,
      INVOICE_NO: d.invoice_no,
      SRNO: d.srno,
      ACT_CODE: d.act_code,
      BILL: d.bill_amount,
      COST: d.cost_amount,
      QUANTITY: d.quantity,
      BILL_RATE: d.bill_rate,
      COST_RATE: d.cost_rate,
      INV_DESC: d.inv_desc,
      USER_ID: d.user_id
    }));

    console.log("Mapped Header Rows:", headerRows);
    console.log("Mapped Detail Rows:", detailRows);

    /* =======================
       Execute Procedure
    ======================= */

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
      }
    );

    res.json({ message: "Invoice updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Invoice update failed" });

  } finally {
    await connection.close();
  }
}
