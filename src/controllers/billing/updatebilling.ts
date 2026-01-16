import oracledb from "oracledb";
import { Request, Response } from "express";

/* =======================
   Interfaces (unchanged)
======================= */

export interface TInvoice {
  from_date?: string | Date;
  to_date?: string | Date;
  company_code: string;
  invoice_no?: string;
  invoice_date?: string | Date;
  job_no?: string;
  prin_code?: string;
  cust_code?: string;
  inv_amount?: number;
  curr_code?: string;
  inv_status?: string;
  user_id?: string;
}

export interface TInvoiceDetail {
  company_code: string;
  invoice_no?: string;
  srno: number;
  act_code?: string;
  bill_amount?: number;
  cost_amount?: number;
  quantity?: number;
  bill_rate?: number;
  cost_rate?: number;
  inv_desc?: string;
  user_id?: string;
}

/* =======================
   API (NO typing changes)
======================= */
const getValue = (obj: any, key: string) =>
  obj[key] ?? obj[key.toLowerCase()] ?? obj[key.toUpperCase()] ?? null;


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
       (FIXED: read UPPER-CASE keys)
    ======================= */

const headerRows = invoiceHeader.map((h: any) => ({
  COMPANY_CODE: getValue(h, 'COMPANY_CODE'),
  INVOICE_NO: getValue(h, 'INVOICE_NO'),

  INVOICE_DATE: getValue(h, 'INVOICE_DATE')
    ? new Date(getValue(h, 'INVOICE_DATE'))
    : null,

  FROM_DATE: getValue(h, 'FROM_DATE')
    ? new Date(getValue(h, 'FROM_DATE'))
    : null,

  TO_DATE: getValue(h, 'TO_DATE')
    ? new Date(getValue(h, 'TO_DATE'))
    : null,

  JOB_NO: getValue(h, 'JOB_NO'),
  PRIN_CODE: getValue(h, 'PRIN_CODE'),
  CUST_CODE: getValue(h, 'CUST_CODE'),
  INV_AMOUNT: getValue(h, 'INV_AMOUNT'),
  CURR_CODE: getValue(h, 'CURR_CODE'),
  INV_STATUS: getValue(h, 'INV_STATUS'),
  USER_ID: getValue(h, 'USER_ID')
}));


    /* =======================
       Map Detail Rows
       (FIXED: read actual payload keys)
    ======================= */

 const detailRows = invoiceDetails.map((d: any) => ({
  COMPANY_CODE: d.COMPANY_CODE ?? invoiceHeader[0].COMPANY_CODE, // fallback to header
  INVOICE_NO: d.INVOICE_NO ?? null,
  SRNO: d.srno,
  ACT_CODE: d.act_code ?? null,
  BILL: d.bill ?? null,
  COST: d.cost ?? null,
  QUANTITY: d.quantity ?? null,
  BILL_RATE: d.bill_rate ?? null,
  COST_RATE: d.cost_rate ?? null,
  INV_DESC: d.inv_desc ?? null,
  USER_ID: d.USER_ID ?? null
}));

    console.log("Mapped Header Rows:", headerRows);
    console.log("Mapped Detail Rows:", detailRows);

    /* =======================
       Execute Procedure
       (UNCHANGED)
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
