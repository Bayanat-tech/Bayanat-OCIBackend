import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";



export const insUpdJobProduction = async (
  req: Request,
  res: Response
): Promise<void> => {


  console.log("insUpdJobProduction called-------------");
  console.log("req.body:", req.body);



  let connection: oracledb.Connection | undefined;



  try {


    const header = req.body?.header;

    const details = req.body?.details;

    const expenseDetails = req.body?.expenseDetails ?? [];

    const jmiConsumDetails = req.body?.jmiConsumDetails ?? [];



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
        header.COMPANY_CODE ?? null,


      DOC_TYPE:
        header.DOC_TYPE ?? null,


      DOC_NO:
        header.DOC_NO ?? null,



      DOC_DATE:
        header.DOC_DATE
          ? new Date(header.DOC_DATE)
          : null,



      DIV_CODE:
        header.DIV_CODE ?? null,


      DEPT_CODE:
        header.DEPT_CODE ?? null,



      REMARKS:
        header.REMARKS ?? null,



      REF_NO:
        header.REF_NO ?? null,



      REF_DATE:
        header.REF_DATE
          ? new Date(header.REF_DATE)
          : null,



      AC_CODE:
        header.AC_CODE ?? null,



      CURR_CODE:
        header.CURR_CODE ?? null,



      EX_RATE:
        header.EX_RATE ?? 1,



      OTHER_EXPENSE_COST:
        header.OTHER_EXPENSE_COST ?? 0,



      DISC_CODE:
        header.DISC_CODE ?? null,

      DISC_HDR_PERCENT:
        header.DISC_HDR_PERCENT ?? 0,

      DISC_HDR_PRICE:
        header.DISC_HDR_PRICE ?? 0,



      PAYMENT_TERMS:
        header.PAYMENT_TERMS ?? null,



      CREDIT_PERIOD:
        header.CREDIT_PERIOD ?? null,



      DUE_DATE:
        header.DUE_DATE
          ? new Date(header.DUE_DATE)
          : null,



      PARTY_NAME:
        header.PARTY_NAME ?? null,

      PARTY_ADDRESS:
        header.PARTY_ADDRESS ?? null,

      PARTY_PHONE:
        header.PARTY_PHONE ?? null,

      PARTY_FAX:
        header.PARTY_FAX ?? null,



      INV_GENERATED:
        header.INV_GENERATED ?? null,



      DELIVERY_TO:
        header.DELIVERY_TO ?? null,

      DLVR_CONTACT:
        header.DLVR_CONTACT ?? null,

      DLVR_EMAIL:
        header.DLVR_EMAIL ?? null,

      DLVR_MOBILE:
        header.DLVR_MOBILE ?? null,

      DLVR_TERM:
        header.DLVR_TERM ?? null,



      SALESMAN_CODE:
        header.SALESMAN_CODE ?? null,



      REF_DOC_TYPE:
        header.REF_DOC_TYPE ?? null,

      REF_DOC_NO:
        header.REF_DOC_NO ?? 0,



      JOB_NO:
        header.JOB_NO ?? null,



      CANCELLED:
        String(header.CANCELLED ?? "N"),


      CANCELLED_DT:
        header.CANCELLED_DT
          ? new Date(header.CANCELLED_DT)
          : null,



      APPROVED:
        header.APPROVED ?? null,

      APPROVED_BY:
        header.APPROVED_BY ?? null,



      APPROVED_DT:
        header.APPROVED_DT
          ? new Date(header.APPROVED_DT)
          : null,



      NO_APPR_REQD:
        header.NO_APPR_REQD ?? null,

      NO_APPR_COLLECT:
        header.NO_APPR_COLLECT ?? null,



      LAST_SERIAL_NO:
        header.LAST_SERIAL_NO ?? 0,

      LAST_DTL_SERIAL_NO:
        header.LAST_DTL_SERIAL_NO ?? 0,



      USER_ID:
        header.USER_ID ?? null,



      USER_DT:
        header.USER_DT
          ? new Date(header.USER_DT)
          : null,



      EDIT_USER:
        header.EDIT_USER ?? null,



      EDIT_DATE:
        header.EDIT_DATE
          ? new Date(header.EDIT_DATE)
          : null,



      CONFIRMED:
        String(header.CONFIRMED ?? "N"),



      CONFIRM_DATE:
        header.CONFIRM_DATE
          ? new Date(header.CONFIRM_DATE)
          : null,



      ZONE_CODE:
        header.ZONE_CODE ?? null,



      AUTO_INV:
        header.AUTO_INV ?? null,



      INV_REF_TYPE:
        header.INV_REF_TYPE ?? null,

      INV_REF_NO:
        header.INV_REF_NO ?? null,



      TX_COMPNT_HDISC_AMT_1:
        header.TX_COMPNT_HDISC_AMT_1 ?? 0,



      PURCHASE_ACTYPE:
        header.PURCHASE_ACTYPE ?? null,



      TX_CAT_CODE:
        header.TX_CAT_CODE ?? null,



      TX_COMPNTCAT_CODE_1:
        header.TX_COMPNTCAT_CODE_1 ?? null,

      TX_COMPNTCAT_CODE_2:
        header.TX_COMPNTCAT_CODE_2 ?? null,

      TX_COMPNTCAT_CODE_3:
        header.TX_COMPNTCAT_CODE_3 ?? null,

      TX_COMPNTCAT_CODE_4:
        header.TX_COMPNTCAT_CODE_4 ?? null,



      TX_COMPNT_PERC_1:
        header.TX_COMPNT_PERC_1 ?? 0,

      TX_COMPNT_PERC_2:
        header.TX_COMPNT_PERC_2 ?? 0,

      TX_COMPNT_PERC_3:
        header.TX_COMPNT_PERC_3 ?? 0,

      TX_COMPNT_PERC_4:
        header.TX_COMPNT_PERC_4 ?? 0,



      TX_COMPNT_AMT_1:
        header.TX_COMPNT_AMT_1 ?? 0,

      TX_COMPNT_AMT_2:
        header.TX_COMPNT_AMT_2 ?? 0,

      TX_COMPNT_AMT_3:
        header.TX_COMPNT_AMT_3 ?? 0,

      TX_COMPNT_AMT_4:
        header.TX_COMPNT_AMT_4 ?? 0,



      TX_COMPNT_LCURAMT_1:
        header.TX_COMPNT_LCURAMT_1 ?? 0,

      TX_COMPNT_LCURAMT_2:
        header.TX_COMPNT_LCURAMT_2 ?? 0,

      TX_COMPNT_LCURAMT_3:
        header.TX_COMPNT_LCURAMT_3 ?? 0,

      TX_COMPNT_LCURAMT_4:
        header.TX_COMPNT_LCURAMT_4 ?? 0,



      TX_COMPNT_1_EXPMT:
        header.TX_COMPNT_1_EXPMT ?? null,

      TX_COMPNT_2_EXPMT:
        header.TX_COMPNT_2_EXPMT ?? null,

      TX_COMPNT_3_EXPMT:
        header.TX_COMPNT_3_EXPMT ?? null,

      TX_COMPNT_4_EXPMT:
        header.TX_COMPNT_4_EXPMT ?? null,



      APPROVAL_LEVEL:
        header.APPROVAL_LEVEL ?? null,



      CREATED_BY:
        header.CREATED_BY ?? null,

      UPDATED_BY:
        header.UPDATED_BY ?? null,



      FLOW_LEVEL_RUNNING:
        header.FLOW_LEVEL_RUNNING ?? 0,



      LAST_ACTION:
        header.LAST_ACTION ?? "NEW",



      FLOW_LEVEL_INITIAL:
        header.FLOW_LEVEL_INITIAL ?? 0,

      FLOW_LEVEL_FINAL:
        header.FLOW_LEVEL_FINAL ?? 0,



      FINAL_APPROVED:
        String(header.FINAL_APPROVED ?? "N"),



      HISTORY_SERIAL:
        header.HISTORY_SERIAL ?? 0,



      NEXT_ACTION_BY:
        header.NEXT_ACTION_BY ?? null,



      SENTBACK_REASON:
        header.SENTBACK_REASON ?? null,



      REJECT_REASON:
        header.REJECT_REASON ?? null,



      FLOW_CODE:
        header.FLOW_CODE ?? "NA"

    };



    /******************************************************
     * Detail Mapping
     ******************************************************/

    const detailRows = details.map((d: any) => ({


      COMPANY_CODE:
        d.COMPANY_CODE ?? header.COMPANY_CODE ?? null,


      DOC_TYPE:
        d.DOC_TYPE ?? header.DOC_TYPE ?? null,


      DOC_NO:
        d.DOC_NO ?? null,



      DOC_DATE:
        d.DOC_DATE
          ? new Date(d.DOC_DATE)
          : null,



      DIV_CODE:
        d.DIV_CODE ?? null,


      DEPT_CODE:
        d.DEPT_CODE ?? null,



      SERIAL_NO:
        d.SERIAL_NO ?? 0,



      PROD_CODE:
        d.PROD_CODE ?? null,


      PROD_NAME:
        d.PROD_NAME ?? null,



      REMARKS:
        d.REMARKS ?? null,



      P_UOM:
        d.P_UOM ?? null,

      QTY_PUOM:
        d.QTY_PUOM ?? 0,



      L_UOM:
        d.L_UOM ?? null,

      QTY_LUOM:
        d.QTY_LUOM ?? 0,



      UPPP:
        d.UPPP ?? 0,



      QUANTITY:
        d.QUANTITY ?? 0,



      UNIT_PRICE:
        d.UNIT_PRICE ?? 0,



      DISC_CODE:
        d.DISC_CODE ?? null,

      DISC_PERCENT:
        d.DISC_PERCENT ?? 0,

      DISC_PRICE:
        d.DISC_PRICE ?? 0,



      OTHER_EXPENSE_COST:
        d.OTHER_EXPENSE_COST ?? 0,



      UNIT_PRICE_NET:
        d.UNIT_PRICE_NET ?? 0,



      DISC_HDR_PRICE:
        d.DISC_HDR_PRICE ?? 0,



      NET_PRICE:
        d.NET_PRICE ?? 0,



      AMOUNT:
        d.AMOUNT ?? 0,



      COST_RATE:
        d.COST_RATE ?? 0,



      CURR_CODE:
        d.CURR_CODE ?? header.CURR_CODE ?? null,



      EX_RATE:
        d.EX_RATE ?? header.EX_RATE ?? 1,



      LCUR_AMOUNT:
        d.LCUR_AMOUNT ?? 0,



      SIGN_IND:
        d.SIGN_IND ?? 1,



      REQUIRED_DT:
        d.REQUIRED_DT
          ? new Date(d.REQUIRED_DT)
          : null,



      SALESMAN_CODE:
        d.SALESMAN_CODE ?? null,



      QTY_PROCESSED:
        d.QTY_PROCESSED ?? 0,



      JOB_NO:
        d.JOB_NO ?? header.JOB_NO ?? null,



      REF_DOC_TYPE:
        d.REF_DOC_TYPE ?? null,

      REF_DOC_NO:
        d.REF_DOC_NO ?? 0,

      REF_DOC_SERIAL:
        d.REF_DOC_SERIAL ?? 0,



      CANCELLED:
        String(d.CANCELLED ?? "N"),



      CANCELLED_DT:
        d.CANCELLED_DT
          ? new Date(d.CANCELLED_DT)
          : null,



      EDIT_USER:
        d.EDIT_USER ?? null,



      EDIT_DATE:
        d.EDIT_DATE
          ? new Date(d.EDIT_DATE)
          : null,



      USER_ID:
        d.USER_ID ?? header.USER_ID ?? null,



      USER_DT:
        d.USER_DT
          ? new Date(d.USER_DT)
          : null,



      KEY_NUMBER:
        d.KEY_NUMBER ?? null,



      TX_IDENTITY_NUMBER:
        d.TX_IDENTITY_NUMBER ?? null,



      ZONE_CODE:
        d.ZONE_CODE ?? header.ZONE_CODE ?? null,



      LCUR_AMOUNT_DISCOUNTED:
        d.LCUR_AMOUNT_DISCOUNTED ?? 0,



      TX_CAT_CODE:
        d.TX_CAT_CODE ?? null,



      TX_COMPNTCAT_CODE_1:
        d.TX_COMPNTCAT_CODE_1 ?? null,

      TX_COMPNTCAT_CODE_2:
        d.TX_COMPNTCAT_CODE_2 ?? null,

      TX_COMPNTCAT_CODE_3:
        d.TX_COMPNTCAT_CODE_3 ?? null,

      TX_COMPNTCAT_CODE_4:
        d.TX_COMPNTCAT_CODE_4 ?? null,



      TX_COMPNT_PERC_1:
        d.TX_COMPNT_PERC_1 ?? 0,

      TX_COMPNT_PERC_2:
        d.TX_COMPNT_PERC_2 ?? 0,

      TX_COMPNT_PERC_3:
        d.TX_COMPNT_PERC_3 ?? 0,

      TX_COMPNT_PERC_4:
        d.TX_COMPNT_PERC_4 ?? 0,



      TX_COMPNT_AMT_1:
        d.TX_COMPNT_AMT_1 ?? 0,

      TX_COMPNT_AMT_2:
        d.TX_COMPNT_AMT_2 ?? 0,

      TX_COMPNT_AMT_3:
        d.TX_COMPNT_AMT_3 ?? 0,

      TX_COMPNT_AMT_4:
        d.TX_COMPNT_AMT_4 ?? 0,



      TX_COMPNT_LCURAMT_1:
        d.TX_COMPNT_LCURAMT_1 ?? 0,

      TX_COMPNT_LCURAMT_2:
        d.TX_COMPNT_LCURAMT_2 ?? 0,

      TX_COMPNT_LCURAMT_3:
        d.TX_COMPNT_LCURAMT_3 ?? 0,

      TX_COMPNT_LCURAMT_4:
        d.TX_COMPNT_LCURAMT_4 ?? 0,



      TX_COMPNT_1_EXPMT:
        d.TX_COMPNT_1_EXPMT ?? null,

      TX_COMPNT_2_EXPMT:
        d.TX_COMPNT_2_EXPMT ?? null,

      TX_COMPNT_3_EXPMT:
        d.TX_COMPNT_3_EXPMT ?? null,

      TX_COMPNT_4_EXPMT:
        d.TX_COMPNT_4_EXPMT ?? null,



      TX_COMPNT_HDISC_AMT_1:
        d.TX_COMPNT_HDISC_AMT_1 ?? 0,



      TX_COMPNT_HDISC_LCURAMT_1:
        d.TX_COMPNT_HDISC_LCURAMT_1 ?? 0

    }));



    /******************************************************
     * Expense Detail Mapping
     ******************************************************/

    const expenseRows = expenseDetails.map((e: any) => ({


      COMPANY_CODE:
        e.COMPANY_CODE ?? header.COMPANY_CODE ?? null,


      DOC_TYPE:
        e.DOC_TYPE ?? header.DOC_TYPE ?? null,


      DOC_NO:
        e.DOC_NO ?? null,



      DOC_DATE:
        e.DOC_DATE
          ? new Date(e.DOC_DATE)
          : null,



      DIV_CODE:
        e.DIV_CODE ?? null,

      DEPT_CODE:
        e.DEPT_CODE ?? null,



      SERIAL_NO:
        e.SERIAL_NO ?? 0,



      EXP_CODE:
        e.EXP_CODE ?? null,



      REMARKS:
        e.REMARKS ?? null,



      AMOUNT:
        e.AMOUNT ?? 0,



      CURR_CODE:
        e.CURR_CODE ?? header.CURR_CODE ?? null,

      EX_RATE:
        e.EX_RATE ?? header.EX_RATE ?? 1,



      LCUR_AMOUNT:
        e.LCUR_AMOUNT ?? 0,



      REF_DOC_TYPE:
        e.REF_DOC_TYPE ?? null,

      REF_DOC_NO:
        e.REF_DOC_NO ?? 0,

      REF_DOC_SERIAL:
        e.REF_DOC_SERIAL ?? 0,



      EDIT_USER:
        e.EDIT_USER ?? null,



      EDIT_DATE:
        e.EDIT_DATE
          ? new Date(e.EDIT_DATE)
          : null,



      USER_ID:
        e.USER_ID ?? header.USER_ID ?? null,



      USER_DT:
        e.USER_DT
          ? new Date(e.USER_DT)
          : null,



      ZONE_CODE:
        e.ZONE_CODE ?? header.ZONE_CODE ?? null,



      AC_CODE:
        e.AC_CODE ?? null,



      WRK_TYPE:
        e.WRK_TYPE ?? null,



      EMPLOYEE_ID:
        e.EMPLOYEE_ID ?? null,



      HOURLY_RATE:
        e.HOURLY_RATE ?? 0

    }));



    /******************************************************
     * JMI Consumption Mapping
     ******************************************************/

    const jmiConsumRows = jmiConsumDetails.map((j: any) => ({


      COMPANY_CODE:
        j.COMPANY_CODE ?? header.COMPANY_CODE ?? null,


      DOC_TYPE:
        j.DOC_TYPE ?? header.DOC_TYPE ?? null,


      DOC_NO:
        j.DOC_NO ?? null,



      MI_DOC_NO:
        j.MI_DOC_NO ?? null,



      PROD_CODE:
        j.PROD_CODE ?? null,



      QUANTITY:
        j.QUANTITY ?? 0,



      P_UOM:
        j.P_UOM ?? null,

      L_UOM:
        j.L_UOM ?? null,



      QTY_PUOM:
        j.QTY_PUOM ?? 0,

      QTY_LUOM:
        j.QTY_LUOM ?? 0,



      SERIAL_NO:
        j.SERIAL_NO ?? 0,



      QTY_CONSUMD:
        j.QTY_CONSUMD ?? 0,



      QTY_SCRAPPED:
        j.QTY_SCRAPPED ?? 0,



      COST_RATE:
        j.COST_RATE ?? 0,



      COST_AMOUNT:
        j.COST_AMOUNT ?? 0,



      SCRAP_AMOUNT:
        j.SCRAP_AMOUNT ?? 0,



      DIV_CODE:
        j.DIV_CODE ?? header.DIV_CODE ?? null

    }));

    /******************************************************
     * Execute Oracle Procedure
     ******************************************************/

    const result = await connection.execute(

      `
      BEGIN

          PROC_INS_UPD_JOB_PRODUCTION
          (
              :P_HEADER,
              :P_DETAILS,
              :P_PRN_EXP_DETAILS,
              :P_JMI_CONSUM_DETAILS
          );

      END;
      `,


      {


        P_HEADER:
        {

          type:
            "TTE_PGRN_HDR_OBJ",

          val:
            headerRow

        },



        P_DETAILS:
        {

          type:
            "TTE_PGRN_DET_TAB",

          val:
            detailRows

        },



        P_PRN_EXP_DETAILS:
        {

          type:
            "TTE_PGRN_EXP_DET_TAB_TYPE",

          val:
            expenseRows

        },



        P_JMI_CONSUM_DETAILS:
        {

          type:
            "TTE_JMI_CONSUM_TAB_TYPE",

          val:
            jmiConsumRows

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
        "Job Production saved successfully.",

      data:
        result.outBinds

    });




  }

  catch (err: any)

  {


    console.error(

      "PROC_INS_UPD_JOB_PRODUCTION Error :",

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
        "Job Production save failed.",


      details:
        err?.message ||
        "Unknown error",

      errorNum:
        err?.errorNum,

      offset:
        err?.offset


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