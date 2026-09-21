import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";



export const insUpdTteAdjustmentBulk = async (
  req: Request,
  res: Response
): Promise<void> => {


  console.log("insUpdTteAdjustmentBulk called-------------");
  console.log("req.body:", req.body);



  let connection: oracledb.Connection | undefined;



  try {


    const header = req.body?.header;

    const details = req.body?.details;



    if (!header || !Array.isArray(details)) {


      res.status(400).json({

        success: false,

        message:
          "Header and details required"

      });


      return;

    }



    const tenantId = getCurrentTenantId();



    if (!tenantId) {


      res.status(400).json({

        success:false,

        message:
          "Tenant not found"

      });


      return;

    }



    connection =
      await TenantManager.getConnection(tenantId);




    /******************************************************
     * Header Mapping
     ******************************************************/


    const headerRow = {


      COMPANY_CODE:
        header.company_code ?? null,


      DOC_TYPE:
        header.doc_type ?? null,


      DOC_NO:
        header.doc_no != null
          ? Number(header.doc_no)
          : 0,



      DOC_DATE:
        header.doc_date
          ? new Date(header.doc_date)
          : null,



      DIV_CODE:
        header.div_code ?? null,


      DEPT_CODE:
        header.dept_code ?? null,


      ZONE_CODE:
        header.zone_code ?? null,



      REMARKS:
        header.remarks ?? null,



      CANCELLED:
        String(header.cancelled ?? "N"),


      CANCELLED_DT:
        header.cancelled_dt
          ? new Date(header.cancelled_dt)
          : null,



      CONFIRMED:
        String(header.confirmed ?? "N"),


      CONFIRMED_BY:
        header.confirmed_by ?? null,


      CONFIRMED_DT:
        header.confirmed_dt
          ? new Date(header.confirmed_dt)
          : null,



      ISSUED_BY:
        header.issued_by
          ? new Date(header.issued_by)
          : null,


      RECEIVED_BY:
        header.received_by
          ? new Date(header.received_by)
          : null,



      USER_ID:
        header.user_id ?? null,


      USER_DT:
        header.user_dt
          ? new Date(header.user_dt)
          : null,



      JOB_NO:
        header.job_no ?? null,



      REF_DOC_NO:
        header.ref_doc_no ?? 0,



      AC_CODE:
        header.ac_code ?? null,



      REF_DATE:
        header.ref_date
          ? new Date(header.ref_date)
          : null,



      CURR_CODE:
        header.curr_code ?? null,



      EX_RATE:
        header.ex_rate ?? 1,



      REF_DOC_TYPE:
        header.ref_doc_type ?? null,



      REF_NO:
        header.ref_no ?? null,



      LAST_SERIAL_NO:
        header.last_serial_no ?? 0,


      LAST_DTL_SERIAL_NO:
        header.last_dtl_serial_no ?? 0,



      /******************************************************
       * Workflow Fields
       ******************************************************/


      CREATED_BY:
        header.created_by ?? null,


      UPDATED_BY:
        header.updated_by ?? null,



      FLOW_LEVEL_RUNNING:
        header.flow_level_running ?? 0,



      LAST_ACTION:
        header.last_action ?? "NEW",



      FLOW_LEVEL_INITIAL:
        header.flow_level_initial ?? 0,



      FLOW_LEVEL_FINAL:
        header.flow_level_final ?? 0,



      FINAL_APPROVED:
        String(header.final_approved ?? "N"),



      HISTORY_SERIAL:
        header.history_serial ?? 0,



      NEXT_ACTION_BY:
        header.next_action_by ?? null,



      SENTBACK_REASON:
        header.sentback_reason ?? null,



      REJECT_REASON:
        header.reject_reason ?? null,



      FLOW_CODE:
        header.flow_code ?? "NA"

    };
    /******************************************************
     * Detail Mapping
     ******************************************************/

    const detailRows = details.map((d: any) => ({


      COMPANY_CODE:
        d.company_code ?? header.company_code ?? null,


      DOC_TYPE:
        d.doc_type ?? header.doc_type ?? null,


      DOC_NO:
        d.doc_no != null
          ? Number(d.doc_no)
          : 0,



      DOC_DATE:
        d.doc_date
          ? new Date(d.doc_date)
          : null,



      DIV_CODE:
        d.div_code ?? null,


      DEPT_CODE:
        d.dept_code ?? null,


      ZONE_CODE:
        d.zone_code ?? null,



      SERIAL_NO:
        d.serial_no ?? 0,



      PROD_CODE:
        d.prod_code ?? null,


      PROD_NAME:
        d.prod_name ?? null,



      P_UOM:
        d.p_uom ?? null,


      QTY_PUOM:
        d.qty_puom ?? 0,



      L_UOM:
        d.l_uom ?? null,


      QTY_LUOM:
        d.qty_luom ?? 0,



      UPPP:
        d.uppp ?? 0,



      QUANTITY:
        d.quantity ?? 0,



      REMARKS:
        d.remarks ?? null,



      USER_ID:
        d.user_id ?? header.user_id ?? null,



      USER_DT:
        d.user_dt
          ? new Date(d.user_dt)
          : null,



      EDIT_USER:
        d.edit_user ?? null,



      EDIT_DATE:
        d.edit_date
          ? new Date(d.edit_date)
          : null,



      JOB_NO:
        d.job_no ?? null,



      AMOUNT:
        d.amount ?? 0,



      SIGN_IND:
        d.sign_ind ?? 1,



      REF_DOC_TYPE:
        d.ref_doc_type ?? null,



      REF_DOC_NO:
        d.ref_doc_no ?? 0,



      TX_IDENTITY_NUMBER:
        d.tx_identity_number ?? null,



      UNIT_PRICE:
        d.unit_price ?? 0,



      SALE_PRICE:
        d.sale_price ?? 0



    }));

    /******************************************************
     * Execute Oracle Procedure
     ******************************************************/

    await connection.execute(

      `
      BEGIN

          PROC_INS_UPD_TTE_ADJUSTMENT
          (
              :p_header,
              :p_details
          );

      END;
      `,


      {


        p_header:
        {

          type:
            "TTE_ADJUSTMENT_HDR_TAB",

          val:
            [
              headerRow
            ]

        },



        p_details:
        {

          type:
            "TTE_ADJUSTMENT_DET_TAB",

          val:
            detailRows

        }


      },


      {

        autoCommit:
          false

      }


    );




    /******************************************************
     * Commit Transaction
     ******************************************************/

    await connection.commit();




    res.json({

      success:
        true,


      message:
        "Adjustment saved successfully."

    });




  }

  catch (err: any)

  {


    console.error(

      "Oracle Error :",

      err

    );



    if (connection)

    {

      await connection.rollback();

    }



    res.status(500).json({

      success:
        false,


      message:
        "Adjustment save failed.",


      details:
        err?.message ||
        "Unknown error"


    });


  }




  finally

  {


    if (connection)

    {

      await connection.close();

    }


  }



};