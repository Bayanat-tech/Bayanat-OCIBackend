import oracledb from "oracledb";
import { Request, Response } from "express";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";


/* =======================
   Interfaces
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
   Common Value Reader
======================= */

const getValue = (obj: any, key: string) =>
  obj[key] ??
  obj[key.toLowerCase()] ??
  obj[key.toUpperCase()] ??
  null;



/* =======================
   API
======================= */

export async function updateBilling(
  req: Request,
  res: Response
) {

  let connection: any;


  try {

    console.log("UPDATE BILLING API HIT");
    console.log("Incoming Body:", JSON.stringify(req.body,null,2));


    /* =======================
       Tenant Connection
    ======================= */

    let tenantId = getCurrentTenantId();


    if (!tenantId) {

      const loginid =
        (req as any).user?.loginid ||
        (req as any).loginid;


      if (!loginid) {
        throw new Error(
          "Cannot determine user loginid"
        );
      }


      tenantId =
        await TenantManager.getTenantForUser(loginid);
    }


    if (!tenantId) {
      throw new Error(
        "Unable to determine tenant database"
      );
    }


    connection =
      await TenantManager.getConnection(tenantId);



    const {
      invoiceHeader,
      invoiceDetails,
      storageSelection,
      jobSelection

    } = req.body;



    /* =======================
       Invoice Header Mapping
    ======================= */


    const headerRows =
      (invoiceHeader || []).map((h:any)=>({

        COMPANY_CODE:
          getValue(h,"COMPANY_CODE"),

        INVOICE_NO:
          getValue(h,"INVOICE_NO"),


        INVOICE_DATE:
          getValue(h,"INVOICE_DATE")
          ? new Date(getValue(h,"INVOICE_DATE"))
          : null,


        FROM_DATE:
          getValue(h,"FROM_DATE")
          ? new Date(getValue(h,"FROM_DATE"))
          : null,


        TO_DATE:
          getValue(h,"TO_DATE")
          ? new Date(getValue(h,"TO_DATE"))
          : null,


        JOB_NO:
          getValue(h,"JOB_NO"),


        PRIN_CODE:
          getValue(h,"PRIN_CODE"),


        CUST_CODE:
          getValue(h,"CUST_CODE"),


        INV_AMOUNT:
          getValue(h,"INV_AMOUNT"),


        CURR_CODE:
          getValue(h,"CURR_CODE"),


        INV_STATUS:
          getValue(h,"INV_STATUS"),


        USER_ID:
          getValue(h,"USER_ID")

      }));





    /* =======================
       Invoice Detail Mapping
    ======================= */


    const detailRows =
      (invoiceDetails || []).map((d:any)=>({

        COMPANY_CODE:
          getValue(d,"COMPANY_CODE")
          ??
          headerRows[0]?.COMPANY_CODE,


        INVOICE_NO:
          getValue(d,"INVOICE_NO"),


        SRNO:
          getValue(d,"SRNO"),


        ACT_CODE:
          getValue(d,"ACT_CODE"),


        BILL:
          getValue(d,"BILL"),


        COST:
          getValue(d,"COST"),


        QUANTITY:
          getValue(d,"QUANTITY"),


        BILL_RATE:
          getValue(d,"BILL_RATE"),


        COST_RATE:
          getValue(d,"COST_RATE"),


        INV_DESC:
          getValue(d,"INV_DESC"),


        USER_ID:
          getValue(d,"USER_ID")

      }));







    /* =======================
       Storage Selection Mapping
       P_MNSTORAGE_DET_SELECT_BILLING_TAB
    ======================= */


    const storageRows =
      (storageSelection || [])
      .map((s:any)=>({

        SELECTED:
          getValue(s,"SELECTED"),


        STORAGE_NO:
          getValue(s,"STORAGE_NO"),


        PRIN_CODE:
          getValue(s,"PRIN_CODE"),


        SITE_IND:
          getValue(s,"SITE_IND"),


        RCPT_DATE:
          getValue(s,"RCPT_DATE")
          ? new Date(getValue(s,"RCPT_DATE"))
          : null,


        TXN_DATE:
          getValue(s,"TXN_DATE")
          ? new Date(getValue(s,"TXN_DATE"))
          : null,


        QTY:
          getValue(s,"QTY"),


        VOLUME:
          getValue(s,"VOLUME"),


        AMOUNT:
          getValue(s,"AMOUNT"),


        PROD_CODE:
          getValue(s,"PROD_CODE"),


        SEQ_NUMBER:
          getValue(s,"SEQ_NUMBER"),


        CONSOLIDATED_INVNO:
          getValue(s,"CONSOLIDATED_INVNO"),


        ACTIVITY:
          getValue(s,"ACTIVITY"),

          COMPANY_CODE:
          getValue(s,"COMPANY_CODE")
          
      }));







    /* =======================
       Job Selection Mapping
       P_INVOICE_JOB_SELECTION_TAB
    ======================= */


    const jobRows =
      (jobSelection || [])
      .map((j:any)=>({


        INVOICE_NO:
          getValue(j,"INVOICE_NO"),


        JOB_NO:
          getValue(j,"JOB_NO"),


        PRIN_CODE:
          getValue(j,"PRIN_CODE"),


        ACT_CODE:
          getValue(j,"ACT_CODE"),


        ACTIVITY:
          getValue(j,"ACTIVITY"),


        BILL:
          getValue(j,"BILL"),


        ACTUAL_COST:
          getValue(j,"ACTUAL_COST"),


        BILL_RATE:
          getValue(j,"BILL_RATE"),


        COST_RATE:
          getValue(j,"COST_RATE"),


        JOB_DATE:
          getValue(j,"JOB_DATE")
          ? new Date(getValue(j,"JOB_DATE"))
          : null,


        TXN_DATE:
          getValue(j,"TXN_DATE")
          ? new Date(getValue(j,"TXN_DATE"))
          : null,


        QUANTITY:
          getValue(j,"QUANTITY"),


        COMPANY_CODE:
          getValue(j,"COMPANY_CODE")
          ??
          headerRows[0]?.COMPANY_CODE,


        CONSOLIDATED_INVNO:
          getValue(j,"CONSOLIDATED_INVNO"),


        SELECTED:
          getValue(j,"SELECTED"),


        STORAGE_NO:
          getValue(j,"STORAGE_NO"),


        SITE_IND:
          getValue(j,"SITE_IND"),


        SEQ_NUMBER:
          getValue(j,"SEQ_NUMBER"),

          SRNO:
          getValue(j,"SRNO")

      }));






    console.log("Header Rows:",headerRows);
    console.log("Detail Rows:",detailRows);
    console.log("Storage Rows:",storageRows);
    console.log("Job Rows:",jobRows);






    /* =======================
       Execute Oracle Procedure
    ======================= */


const result = await connection.execute(

`
BEGIN

 PROC_UPDATE_INVOICE_DTLS
 (
    :p_invoice_hdr,
    :p_invoice_dtl,
    :p_storage_sel,
    :p_job_sel,
    :p_invoice_no
 );

END;
`,

{

 p_invoice_hdr:
 {
    type:"T_INVOICE_TAB",
    val:headerRows
 },


 p_invoice_dtl:
 {
    type:"T_INVOICE_DTL_TAB",
    val:detailRows
 },


 p_storage_sel:
 {
    type:"P_MNSTORAGE_DET_SELECT_BILLING_TAB",
    val:storageRows
 },


 p_job_sel:
 {
    type:"P_INVOICE_JOB_SELECTION_TAB",
    val:jobRows
 },

 p_invoice_no:
 {
    dir: oracledb.BIND_OUT,
    type: oracledb.STRING,
    maxSize: 50
 }
},

{
 autoCommit:false
}

);



    await connection.commit();

    const generatedInvoiceNo = result.outBinds.p_invoice_no;

    res.json(
    {
      message:
      "Invoice updated successfully",
      invoice_no:
      generatedInvoiceNo
    });



  }
  catch(err:any)
  {

    console.error(
      "UPDATE BILLING ERROR:",
      err
    );


    if(connection)
    {
      await connection.rollback();
    }


    res.status(500).json(
    {
      error:
      "Invoice update failed",
      message:
      err.message
    });

  }


  finally
  {

    if(connection)
    {
      await connection.close();
    }

  }

}