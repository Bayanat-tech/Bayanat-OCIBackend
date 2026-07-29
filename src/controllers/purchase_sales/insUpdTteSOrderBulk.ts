import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";



export const insUpdTteSOrderBulk = async (
  req: Request,
  res: Response
): Promise<void> => {


  console.log("insUpdTteSOrderBulk called-------------");
  console.log("req.body:", req.body);



  let connection: oracledb.Connection | undefined;



  try {



    const header = req.body?.header;
    const details = req.body?.details;



    if (!header || !Array.isArray(details)) {


      res.status(400).json({

        success:false,

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
     * HEADER MAPPING : TTE_SORDER_HDR_TAB
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




      REMARKS:
        header.remarks ?? null,




      REF_NO:
        header.ref_no ?? null,



      REF_DATE:
        header.ref_date
        ? new Date(header.ref_date)
        : null,




      AC_CODE:
        header.ac_code ?? null,



      CURR_CODE:
        header.curr_code ?? null,



      EX_RATE:
        header.ex_rate ?? 1,




      DISC_CODE:
        header.disc_code ?? null,



      DISC_HDR_PERCENT:
        header.disc_hdr_percent ?? 0,



      DISC_HDR_PRICE:
        header.disc_hdr_price ?? 0,




      PAYMENT_TERMS:
        header.payment_terms ?? null,



      CREDIT_PERIOD:
        header.credit_period ?? 0,



      DUE_DATE:
        header.due_date
        ? new Date(header.due_date)
        : null,




      PARTY_NAME:
        header.party_name ?? null,



      PARTY_ADDRESS:
        header.party_address ?? null,



      PARTY_PHONE:
        header.party_phone ?? null,



      PARTY_FAX:
        header.party_fax ?? null,




      INV_GENERATED:
        String(header.inv_generated ?? "N"),




      DELIVERY_TO:
        header.delivery_to ?? null,



      DLVR_CONTACT:
        header.dlvr_contact ?? null,



      DLVR_EMAIL:
        header.dlvr_email ?? null,



      DLVR_MOBILE:
        header.dlvr_mobile ?? null,



      DLVR_TERM:
        header.dlvr_term ?? null,




      REF_DOC_TYPE:
        header.ref_doc_type ?? null,



      REF_DOC_NO:
        header.ref_doc_no ?? 0,




      SALESMAN_CODE:
        header.salesman_code ?? null,




      JOB_NO:
        header.job_no ?? null,




      CANCELLED:
        String(header.cancelled ?? "N"),



      CANCELLED_DT:
        header.cancelled_dt
        ? new Date(header.cancelled_dt)
        : null,




      APPROVED:
        String(header.approved ?? "N"),



      APPROVED_BY:
        header.approved_by ?? null,



      APPROVED_DT:
        header.approved_dt
        ? new Date(header.approved_dt)
        : null,




      NO_APPR_REQD:
        header.no_appr_reqd ?? 0,



      NO_APPR_COLLECT:
        header.no_appr_collect ?? 0,




      LAST_SERIAL_NO:
        header.last_serial_no ?? 0,



      LAST_DTL_SERIAL_NO:
        header.last_dtl_serial_no ?? 0,




      USER_ID:
        header.user_id ?? null,



      USER_DT:
        header.user_dt
        ? new Date(header.user_dt)
        : null,




      EDIT_USER:
        header.edit_user ?? null,



      EDIT_DATE:
        header.edit_date
        ? new Date(header.edit_date)
        : null,




      OTHER_EXPENSE_COST:
        header.other_expense_cost ?? 0,




      ZONE_CODE:
        header.zone_code ?? null,




      TX_COMPNT_HDISC_AMT_1:
        header.tx_compnt_hdisc_amt_1 ?? 0,




      TX_COMPNTCAT_CODE_1:
        header.tx_compntcat_code_1 ?? "N/A",



      TX_COMPNTCAT_CODE_2:
        header.tx_compntcat_code_2 ?? "N/A",



      TX_COMPNTCAT_CODE_3:
        header.tx_compntcat_code_3 ?? "N/A",



      TX_COMPNTCAT_CODE_4:
        header.tx_compntcat_code_4 ?? "N/A",




      TX_CAT_CODE:
        header.tx_cat_code ?? "N/A",




      WARRANTY_UOM:
        header.warranty_uom ?? null,



      WARRANTY_PERIOD:
        header.warranty_period ?? 0,



      WARRANTY_DESC:
        header.warranty_desc ?? null,




      DLVR_DATE:
        header.dlvr_date
        ? new Date(header.dlvr_date)
        : null,




      /******************************************************
       * WORKFLOW FIELDS
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
     * DETAIL MAPPING : TTE_SORDER_DET_TAB
     ******************************************************/


    const detailRows = details.map((detail:any) => ({



      COMPANY_CODE:
        detail.company_code ?? header.company_code ?? null,



      DOC_TYPE:
        detail.doc_type ?? header.doc_type ?? null,



      DOC_NO:
        header.doc_no != null
        ? Number(header.doc_no)
        : 0,



      DOC_DATE:
        detail.doc_date
        ? new Date(detail.doc_date)
        : null,




      DIV_CODE:
        detail.div_code ?? null,



      DEPT_CODE:
        detail.dept_code ?? null,




      SERIAL_NO:
        detail.serial_no ?? 0,




      PROD_CODE:
        detail.prod_code ?? null,



      PROD_NAME:
        detail.prod_name ?? "N",




      REMARKS:
        detail.remarks ?? null,




      P_UOM:
        detail.p_uom ?? null,



      QTY_PUOM:
        detail.qty_puom ?? 0,




      L_UOM:
        detail.l_uom ?? null,



      QTY_LUOM:
        detail.qty_luom ?? 0,




      UPPP:
        detail.uppp ?? 1,



      QUANTITY:
        detail.quantity ?? 0,




      UNIT_PRICE:
        detail.unit_price ?? 0,



      DISC_CODE:
        detail.disc_code ?? null,



      DISC_PERCENT:
        detail.disc_percent ?? 0,



      DISC_PRICE:
        detail.disc_price ?? 0,




      UNIT_PRICE_NET:
        detail.unit_price_net ?? 0,



      DISC_HDR_PRICE:
        detail.disc_hdr_price ?? 0,



      NET_PRICE:
        detail.net_price ?? 0,



      AMOUNT:
        detail.amount ?? 0,




      COST_RATE:
        detail.cost_rate ?? 0,




      CURR_CODE:
        detail.curr_code ?? header.curr_code ?? null,



      EX_RATE:
        detail.ex_rate ?? 1,



      LCUR_AMOUNT:
        detail.lcur_amount ?? 0,




      SIGN_IND:
        detail.sign_ind ?? 1,




      REQUIRED_DT:
        detail.required_dt
        ? new Date(detail.required_dt)
        : null,




      SALESMAN_CODE:
        detail.salesman_code ?? null,




      QTY_PROCESSED:
        detail.qty_processed ?? 0,




      JOB_NO:
        detail.job_no ?? null,




      REF_DOC_TYPE:
        detail.ref_doc_type ?? null,



      REF_DOC_NO:
        detail.ref_doc_no ?? 0,



      REF_DOC_SERIAL:
        detail.ref_doc_serial ?? 0,




      CANCELLED:
        String(detail.cancelled ?? "N"),



      CANCELLED_DT:
        detail.cancelled_dt
        ? new Date(detail.cancelled_dt)
        : null,




      EDIT_USER:
        detail.edit_user ?? null,



      EDIT_DATE:
        detail.edit_date
        ? new Date(detail.edit_date)
        : null,




      USER_ID:
        detail.user_id ?? null,



      USER_DT:
        detail.user_dt
        ? new Date(detail.user_dt)
        : null,




      OTHER_EXPENSE_COST:
        detail.other_expense_cost ?? 0,




      ZONE_CODE:
        detail.zone_code ?? null,




      SIZE_CODE:
        detail.size_code ?? null,




      TX_COMPNT_HDISC_AMT_1:
        detail.tx_compnt_hdisc_amt_1 ?? 0,




      WARRANTY_UOM:
        detail.warranty_uom ?? null,



      WARRANTY_PERIOD:
        detail.warranty_period ?? 0,



      WARRANTY_DESC:
        detail.warranty_desc ?? null,




      TX_COMPNT_1_EXPMT:
        detail.tx_compnt_1_expm ?? "S",



      TX_COMPNT_2_EXPMT:
        detail.tx_compnt_2_expm ?? "S",



      TX_COMPNT_3_EXPMT:
        detail.tx_compnt_3_expm ?? "S",



      TX_COMPNT_4_EXPMT:
        detail.tx_compnt_4_expm ?? "S",




      TX_COMPNTCAT_CODE_1:
        detail.tx_compntcat_code_1 ?? "N/A",



      TX_COMPNTCAT_CODE_2:
        detail.tx_compntcat_code_2 ?? "N/A",



      TX_COMPNTCAT_CODE_3:
        detail.tx_compntcat_code_3 ?? "N/A",



      TX_COMPNTCAT_CODE_4:
        detail.tx_compntcat_code_4 ?? "N/A",




      TX_COMPNT_PERC_1:
        detail.tx_compnt_perc_1 ?? 0,



      TX_COMPNT_PERC_2:
        detail.tx_compnt_perc_2 ?? 0,



      TX_COMPNT_PERC_3:
        detail.tx_compnt_perc_3 ?? 0,



      TX_COMPNT_PERC_4:
        detail.tx_compnt_perc_4 ?? 0,




      TX_COMPNT_AMT_1:
        detail.tx_compnt_amt_1 ?? 0,



      TX_COMPNT_AMT_2:
        detail.tx_compnt_amt_2 ?? 0,



      TX_COMPNT_AMT_3:
        detail.tx_compnt_amt_3 ?? 0,



      TX_COMPNT_AMT_4:
        detail.tx_compnt_amt_4 ?? 0,




      TX_COMPNT_LCURAMT_1:
        detail.tx_compnt_lcuramt_1 ?? 0,



      TX_COMPNT_LCURAMT_2:
        detail.tx_compnt_lcuramt_2 ?? 0,



      TX_COMPNT_LCURAMT_3:
        detail.tx_compnt_lcuramt_3 ?? 0,



      TX_COMPNT_LCURAMT_4:
        detail.tx_compnt_lcuramt_4 ?? 0,




      TX_CAT_CODE_COST:
        detail.tx_cat_code_cost ?? null,




      TX_CAT_CODE:
        detail.tx_cat_code ?? null



    }));
    /******************************************************
     * Execute Oracle Procedure
     ******************************************************/


    await connection.execute(


      `
      BEGIN

          PROC_INS_UPD_TTE_SORDER
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
            "TTE_SORDER_HDR_TAB",


          val:
          [

            headerRow

          ]

        },



        p_details:
        {

          type:
            "TTE_SORDER_DET_TAB",


          val:
            detailRows

        }


      },


      {

        autoCommit:false

      }


    );




    /******************************************************
     * Commit Transaction
     ******************************************************/


    await connection.commit();





    res.json({

      success:true,


      message:
        "Sales Order saved successfully."

    });





  }

  catch(err:any)

  {


    console.error(

      "Oracle Error :",

      err

    );



    if(connection)

    {

      await connection.rollback();

    }




    res.status(500).json({

      success:false,


      message:
        "Sales Order save failed.",


      details:
        err?.message ||
        "Unknown error"


    });


  }





  finally

  {


    if(connection)

    {

      await connection.close();

    }


  }



};