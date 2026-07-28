import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";



export const insUpdTteSdnBulk = async (
  req: Request,
  res: Response
): Promise<void> => {


  console.log("insUpdTteSdnBulk called-------------");
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

        success: false,

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



      OTHER_EXPENSE_COST:
        header.other_expense_cost ?? 0,



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



      CONFIRMED:
        String(header.confirmed ?? "N"),


      CONFIRM_DATE:
        header.confirm_date
          ? new Date(header.confirm_date)
          : null,



      ZONE_CODE:
        header.zone_code ?? null,



      AUTO_INV:
        String(header.auto_inv ?? "N"),



      INV_REF_TYPE:
        header.inv_ref_type ?? null,


      INV_REF_NO:
        header.inv_ref_no ?? 0,



      WARRANTY_PERIOD:
        header.warranty_period ?? 0,


      WARRANTY_UOM:
        header.warranty_uom ?? null,


      WARRANTY_DESC:
        header.warranty_desc ?? null,



      TX_CAT_CODE:
        header.tx_cat_code ?? "N/A",



      TX_COMPNTCAT_CODE_1:
        header.tx_compntcat_code_1 ?? "N/A",


      TX_COMPNTCAT_CODE_2:
        header.tx_compntcat_code_2 ?? "N/A",


      TX_COMPNTCAT_CODE_3:
        header.tx_compntcat_code_3 ?? "N/A",


      TX_COMPNTCAT_CODE_4:
        header.tx_compntcat_code_4 ?? "N/A",



      TX_COMPNT_HDISC_AMT_1:
        header.tx_compnt_hdisc_amt_1 ?? 0,



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



      SERIAL_NO:
        d.serial_no ?? 0,



      PROD_CODE:
        d.prod_code ?? null,


      PROD_NAME:
        d.prod_name ?? null,


      REMARKS:
        d.remarks ?? null,



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



      UNIT_PRICE:
        d.unit_price ?? 0,



      DISC_CODE:
        d.disc_code ?? null,


      DISC_PERCENT:
        d.disc_percent ?? 0,


      DISC_PRICE:
        d.disc_price ?? 0,



      OTHER_EXPENSE_COST:
        d.other_expense_cost ?? 0,



      UNIT_PRICE_NET:
        d.unit_price_net ?? 0,



      DISC_HDR_PRICE:
        d.disc_hdr_price ?? 0,



      NET_PRICE:
        d.net_price ?? 0,



      AMOUNT:
        d.amount ?? 0,



      COST_RATE:
        d.cost_rate ?? 0,



      CURR_CODE:
        d.curr_code ?? null,


      EX_RATE:
        d.ex_rate ?? 1,


      LCUR_AMOUNT:
        d.lcur_amount ?? 0,



      SIGN_IND:
        d.sign_ind ?? 1,



      SALESMAN_CODE:
        d.salesman_code ?? null,



      REQUIRED_DT:
        d.required_dt
          ? new Date(d.required_dt)
          : null,



      QTY_PROCESSED:
        d.qty_processed ?? 0,



      JOB_NO:
        d.job_no ?? null,



      REF_DOC_TYPE:
        d.ref_doc_type ?? null,


      REF_DOC_NO:
        d.ref_doc_no ?? 0,


      REF_DOC_SERIAL:
        d.ref_doc_serial ?? 0,



      CANCELLED:
        String(d.cancelled ?? "N"),



      CANCELLED_DT:
        d.cancelled_dt
          ? new Date(d.cancelled_dt)
          : null,



      EDIT_USER:
        d.edit_user ?? null,


      EDIT_DATE:
        d.edit_date
          ? new Date(d.edit_date)
          : null,



      USER_ID:
        d.user_id ?? null,


      USER_DT:
        d.user_dt
          ? new Date(d.user_dt)
          : null,



      KEY_NUMBER:
        d.key_number ?? null,



      TX_IDENTITY_NUMBER:
        d.tx_identity_number ?? null,



      ZONE_CODE:
        d.zone_code ?? null,



      LCUR_AMOUNT_DISCOUNTED:
        d.lcur_amount_discounted ?? 0,



      INV_REF_TYPE:
        d.inv_ref_type ?? null,


      INV_REF_NO:
        d.inv_ref_no ?? 0,



      TX_CAT_CODE:
        d.tx_cat_code ?? "N/A",



      TX_COMPNTCAT_CODE_1:
        d.tx_compntcat_code_1 ?? "N/A",


      TX_COMPNTCAT_CODE_2:
        d.tx_compntcat_code_2 ?? "N/A",


      TX_COMPNTCAT_CODE_3:
        d.tx_compntcat_code_3 ?? "N/A",


      TX_COMPNTCAT_CODE_4:
        d.tx_compntcat_code_4 ?? "N/A",



      TX_COMPNT_PERC_1:
        d.tx_compnt_perc_1 ?? 0,


      TX_COMPNT_PERC_2:
        d.tx_compnt_perc_2 ?? 0,


      TX_COMPNT_PERC_3:
        d.tx_compnt_perc_3 ?? 0,


      TX_COMPNT_PERC_4:
        d.tx_compnt_perc_4 ?? 0,



      TX_COMPNT_AMT_1:
        d.tx_compnt_amt_1 ?? 0,


      TX_COMPNT_AMT_2:
        d.tx_compnt_amt_2 ?? 0,


      TX_COMPNT_AMT_3:
        d.tx_compnt_amt_3 ?? 0,


      TX_COMPNT_AMT_4:
        d.tx_compnt_amt_4 ?? 0,



      TX_COMPNT_LCURAMT_1:
        d.tx_compnt_lcuramt_1 ?? 0,


      TX_COMPNT_LCURAMT_2:
        d.tx_compnt_lcuramt_2 ?? 0,


      TX_COMPNT_LCURAMT_3:
        d.tx_compnt_lcuramt_3 ?? 0,


      TX_COMPNT_LCURAMT_4:
        d.tx_compnt_lcuramt_4 ?? 0,



      TX_COMPNT_1_EXPMT:
        String(d.tx_compnt_1_expmt ?? "S"),


      TX_COMPNT_2_EXPMT:
        String(d.tx_compnt_2_expmt ?? "S"),


      TX_COMPNT_3_EXPMT:
        String(d.tx_compnt_3_expmt ?? "S"),


      TX_COMPNT_4_EXPMT:
        String(d.tx_compnt_4_expmt ?? "S"),



      WARRANTY_UOM:
        d.warranty_uom ?? null,


      WARRANTY_PERIOD:
        d.warranty_period ?? 0,


      WARRANTY_DESC:
        d.warranty_desc ?? null,



      TX_COMPNT_HDISC_AMT_1:
        d.tx_compnt_hdisc_amt_1 ?? 0,



      TX_COMPNT_HDISC_LCURAMT_1:
        d.tx_compnt_hdisc_lcuramt_1 ?? 0


    }));
    /******************************************************
     * Execute Oracle Procedure
     ******************************************************/

    await connection.execute(

      `
      BEGIN

          PROC_INS_UPD_TTE_SDN
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
            "TTE_SDN_HDR_TAB",

          val:
            [
              headerRow
            ]

        },



        p_details:
        {

          type:
            "TTE_SDN_DET_TAB",

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
        "SDN saved successfully."

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
        "SDN save failed.",


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