import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";

export const insUpdTtePrequestBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  console.log("PROC_INS_UPD_TTE_PREQUEST called...");
  console.log(req.body);

  console.time("Total API");

  let connection: oracledb.Connection | undefined;

  try {

    const header = req.body?.header;
    const details = req.body?.details || [];
    const terms = req.body?.terms || [];

    if (!header || !Array.isArray(details) || !Array.isArray(terms)) {
      res.status(400).json({
        success: false,
        message: "Header, Details and Terms are required."
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found."
      });
      return;
    }
console.time("Get Connection");
    connection = await TenantManager.getConnection(tenantId);
    console.timeEnd("Get Connection");

    /******************************************************
     * Header Row - ARRAY in EXACT ORDER
     * ⚠️ IMPORTANT: Order must match NT_TTE_PREQUEST_HDR
     ******************************************************/
console.time("Mapping");
    const headerObj = {
  REQUEST_NUMBER: header.REQUEST_NUMBER || null,
  REQUEST_DATE: header.REQUEST_DATE ? new Date(header.REQUEST_DATE) : null,
  SUPPLIER: header.SUPPLIER || null,
  DESCRIPTION: header.DESCRIPTION || null,
  REMARKS: header.REMARKS || null,
  AMOUNT: Number(header.AMOUNT || 0),
  DEPARTMENT_CODE: header.DEPARTMENT_CODE || null,
  FLOW_CODE: header.FLOW_CODE || null,
  FLOW_DESCRIPTION: header.FLOW_DESCRIPTION || null,
  FLOW_LEVEL_INITIAL: Number(header.FLOW_LEVEL_INITIAL || 0),
  FLOW_LEVEL_RUNNING: Number(header.FLOW_LEVEL_RUNNING || 0),
  FLOW_LEVEL_FINAL: Number(header.FLOW_LEVEL_FINAL || 0),
  COMPANY_CODE: header.COMPANY_CODE || null,
  CURRENCY_RATE: Number(header.CURRENCY_RATE || 1),
  USER_DT: header.USER_DT ? new Date(header.USER_DT) : null,
  USER_ID: header.USER_ID || null,
  FA_UPLOADED: String(header.FA_UPLOADED || "N"),
  FINAL_APPROVED: String(header.FINAL_APPROVED || "N"),
  TX_CAT_CODE: header.TX_CAT_CODE || null,
  TX_COMPNTCAT_CODE_1: header.TX_COMPNTCAT_CODE_1 || null,
  TX_COMPNTCAT_CODE_2: header.TX_COMPNTCAT_CODE_2 || null,
  TX_COMPNTCAT_CODE_3: header.TX_COMPNTCAT_CODE_3 || null,
  TX_COMPNTCAT_CODE_4: header.TX_COMPNTCAT_CODE_4 || null,
  TX_COMPNT_1_EXPMT: String(header.TX_COMPNT_1_EXPMT || "N"),
  REMARKS_HISTRY: header.REMARKS_HISTRY || null,
  CURR_CODE: header.CURR_CODE || null,
  CREATE_USER: header.CREATE_USER || null,
  CREATE_DATE: header.CREATE_DATE ? new Date(header.CREATE_DATE) : null,
  LAST_UPDATED: header.LAST_UPDATED || null,
  LAST_ACTION: header.LAST_ACTION || "NEW",
  HISTORY_SERIAL: Number(header.HISTORY_SERIAL || 0),
  ATTACH_FILE_NAME: header.ATTACH_FILE_NAME || null,
  ATTACH_FILE_NAME1: header.ATTACH_FILE_NAME1 || null,
  ATTACH_FILE_NAME2: header.ATTACH_FILE_NAME2 || null,
  REJECT_HISTRY: header.REJECT_HISTRY || null,
  SENDBACK_HISTRY: header.SENDBACK_HISTRY || null,
  REQ_DOC_NO: Number(header.REQ_DOC_NO || 0),
  REQ_DIV_CODE: header.REQ_DIV_CODE || null,
  COST_CODE: header.COST_CODE || null,
  PO_AMOUNT: Number(header.PO_AMOUNT || 0),
  DOC_DATE: header.DOC_DATE ? new Date(header.DOC_DATE) : null,
  CANCEL_FLAG: String(header.CANCEL_FLAG || "N"),
  CANCEL_DATE: header.CANCEL_DATE ? new Date(header.CANCEL_DATE) : null,
  CANCEL_USER: header.CANCEL_USER || null,
  MOBILE_APP_UPDATE: String(header.MOBILE_APP_UPDATE || "N"),
  FA_USER: header.FA_USER || null,
  HOD_USER: header.HOD_USER || null,
  MAIL_CC: header.MAIL_CC || null,
  WARRANTY: header.WARRANTY || null,
  PO_CREATOR: header.PO_CREATOR || null,
  REQUEST_HOD_USER: header.REQUEST_HOD_USER || null,
  CANCEL_REMARK: header.CANCEL_REMARK || null,
  PDO_TYPE: String(header.PDO_TYPE || "N"),
  TYPE_OF_CONTRACT: header.TYPE_OF_CONTRACT || null,
  AC_CODE: header.AC_CODE || null,
  AC_NAME: header.AC_NAME || null,
  COUNTRY_CODE: header.COUNTRY_CODE || null,
  TERRITORY_CODE: header.TERRITORY_CODE || null,
  ADDRESS_1: header.ADDRESS_1 || null,
  ADDRESS_2: header.ADDRESS_2 || null,
  ADDRESS_3: header.ADDRESS_3 || null,
  PHONE: header.PHONE || null,
  FAX: header.FAX || null,
  E_MAIL: header.E_MAIL || null,
  CONTACT_PERSON: header.CONTACT_PERSON || null,
  MOBILE_NO: header.MOBILE_NO || null,
  AC_TYPE: header.AC_TYPE || null,
  AC_ACTIVE: header.AC_ACTIVE || null,
  CREDIT_PERIOD: Number(header.CREDIT_PERIOD || 0),
  CREDIT_AMOUNT: Number(header.CREDIT_AMOUNT || 0),
  BANK_AC_CODE: header.BANK_AC_CODE || null,
  BANK_NAME: header.BANK_NAME || null,
  BANK_SWIFT: header.BANK_SWIFT || null,
  IBAN_NO: header.IBAN_NO || null,
  BANK_AC_NAME: header.BANK_AC_NAME || null,
  TAX_REGISTRD: String(header.TAX_REGISTRD || "N"),
  TAX_COUNTRY_CODE: header.TAX_COUNTRY_CODE || null,
  TRN_NO: header.TRN_NO || null,
  CR_NO: header.CR_NO || null,
  RCM_APPLY: String(header.RCM_APPLY || "N"),
  SECTOR_CODE: header.SECTOR_CODE || null,
  CITY_NAME: header.CITY_NAME || null,
  EXP_TYPE_CODE: header.EXP_TYPE_CODE || null,
  PL_BL_CODE: header.PL_BL_CODE || null,
  DEPT_CODE: header.DEPT_CODE || null,
  AC_STATUS: header.AC_STATUS || null,
  AC_INFZE: header.AC_INFZE || null,
  BI_MAIN_GROUP: header.BI_MAIN_GROUP || null,
  BI_SUB_GROUP: header.BI_SUB_GROUP || null,
  BI_EXP_TYPE: header.BI_EXP_TYPE || null,
  BI_PL_BS_IND: header.BI_PL_BS_IND || null,
  BI_DEPT: header.BI_DEPT || null,
  CREATED_BY: header.CREATED_BY || null,
  UPDATED_BY: header.UPDATED_BY || null,
  NEXT_ACTION_BY: header.NEXT_ACTION_BY || null,
  SENTBACK_REASON: header.SENTBACK_REASON || null,
  REJECT_REASON: header.REJECT_REASON || null,
  DOC_NO: header.DOC_NO ? String(header.DOC_NO) : null
};

    /******************************************************
     * Detail Mapping - DOC_NO as STRING
     ******************************************************/
    const detailRows = details.map((d: any) => ({
      REQUEST_NUMBER: d.REQUEST_NUMBER ?? header.REQUEST_NUMBER ?? null,
      ITEM_CODE: d.ITEM_CODE ?? null,
      ITEM_RATE: Number(d.ITEM_RATE ?? 0),
      ITEM_QTY: Number(d.ITEM_QTY ?? 0),
      REQUEST_QUANTITY: Number(d.REQUEST_QUANTITY ?? 0),
      CURRENCY_RATE: Number(d.CURRENCY_RATE ?? 1),
      AMOUNT: Number(d.AMOUNT ?? 0),
      COMPANY_CODE: d.COMPANY_CODE ?? header.COMPANY_CODE ?? null,
      USER_DT: d.USER_DT ? new Date(d.USER_DT) : null,
      USER_ID: d.USER_ID ?? header.USER_ID ?? null,
      TX_CAT_CODE: d.TX_CAT_CODE ?? null,
      TX_COMPNTCAT_CODE_1: d.TX_COMPNTCAT_CODE_1 ?? null,
      TX_COMPNT_PERC_1: Number(d.TX_COMPNT_PERC_1 ?? 0),
      TX_COMPNT_AMT_1: Number(d.TX_COMPNT_AMT_1 ?? 0),
      TX_COMPNT_LCURAMT_1: Number(d.TX_COMPNT_LCURAMT_1 ?? 0),
      TX_COMPNT_1_EXPMT: String(d.TX_COMPNT_1_EXPMT ?? "N"),
      CURR_CODE: d.CURR_CODE ?? null,
      LCURR_AMT: Number(d.LCURR_AMT ?? 0),
      ALLOCATED_APPROVED_QUANTITY: Number(d.ALLOCATED_APPROVED_QUANTITY ?? 0),
      SELECTED_ITEM: String(d.SELECTED_ITEM ?? "N"),
      LAST_ACTION: d.LAST_ACTION ?? "NEW",
      HISTORY_SERIAL: Number(d.HISTORY_SERIAL ?? 0),
      ITEM_SRNO: Number(d.ITEM_SRNO ?? 0),
      SUPPLIER_PART_CODE: d.SUPPLIER_PART_CODE ?? null,
      RATE_METHODE: d.RATE_METHODE ?? null,
      CASH_IND: String(d.CASH_IND ?? "N"),
      MAIL_ATTATCH: String(d.MAIL_ATTATCH ?? "N"),
      ITEM_CANEL: String(d.ITEM_CANEL ?? "N"),
      SUPPLIER: d.SUPPLIER ?? header.SUPPLIER ?? null,
      REF_DOC_NO: Number(d.REF_DOC_NO ?? 0),
      DISCOUNT_AMOUNT: Number(d.DISCOUNT_AMOUNT ?? 0),
      FINAL_RATE: Number(d.FINAL_RATE ?? 0),
      COST_CODE: d.COST_CODE ?? null,
      CAPEX: String(d.CAPEX ?? "N"),
      BUYER: d.BUYER ?? null,
      REASON_FOR_PO_MODIFY: d.REASON_FOR_PO_MODIFY ?? null,
      DOC_TYPE: d.DOC_TYPE ?? null,
      DOC_NO: d.DOC_NO ? String(d.DOC_NO) : null,
      DOC_DATE: d.DOC_DATE ? new Date(d.DOC_DATE) : null,
      DIV_CODE: d.DIV_CODE ?? null,
      SERIAL_NO: Number(d.SERIAL_NO ?? 0),
      PROD_CODE: d.PROD_CODE ?? null,
      PROD_NAME: d.PROD_NAME ?? null,
      P_UOM: d.P_UOM ?? null,
      QTY_PUOM: Number(d.QTY_PUOM ?? 0),
      L_UOM: d.L_UOM ?? null,
      QTY_LUOM: Number(d.QTY_LUOM ?? 0),
      UPPP: Number(d.UPPP ?? 0),
      QUANTITY: Number(d.QUANTITY ?? 0),
      REQUIRED_DT: d.REQUIRED_DT ? new Date(d.REQUIRED_DT) : null,
      SIGN_IND: Number(d.SIGN_IND ?? -1),
      QTY_PROCESSED: Number(d.QTY_PROCESSED ?? 0),
      CANCELLED: String(d.CANCELLED ?? "N"),
      CANCELLED_DT: d.CANCELLED_DT ? new Date(d.CANCELLED_DT) : null,
      JOB_NO: d.JOB_NO ?? null,
      REF_DOC_TYPE: d.REF_DOC_TYPE ?? null,
      EDIT_USER: d.EDIT_USER ?? null,
      EDIT_DATE: d.EDIT_DATE ? new Date(d.EDIT_DATE) : null,
      ZONE_CODE: d.ZONE_CODE ?? null,
      STOCK_QTY_WHENPRQ: Number(d.STOCK_QTY_WHENPRQ ?? 0)
    }));

    /******************************************************
     * Supplier Terms Mapping - DOC_NO as STRING
     ******************************************************/
    const termRows = terms.map((t: any) => ({
      SUPPLIER: t.SUPPLIER ?? header.SUPPLIER ?? null,
      REMARKS: t.REMARKS ?? null,
      DLVR_TERM: t.DLVR_TERM ?? null,
      PAYMENT_TERMS: t.PAYMENT_TERMS ?? null,
      COMPANY_CODE: t.COMPANY_CODE ?? header.COMPANY_CODE ?? null,
      USER_DT: t.USER_DT ? new Date(t.USER_DT) : null,
      USER_ID: t.USER_ID ?? header.USER_ID ?? null,
      WARRANTY: t.WARRANTY ?? null,
      DOC_NO: t.DOC_NO ? String(t.DOC_NO) : null,
      DOC_TYPE: t.DOC_TYPE ?? null
    }));
console.timeEnd("Mapping");
    /******************************************************
     * Execute Oracle Procedure
     ******************************************************/
console.time("Oracle Execute");
    await connection.execute(
      `
      BEGIN
          PROC_INS_UPD_TTE_PREQUEST(
              :p_header,
              :p_details,
              :p_terms
          );
      END;
      `,
      {
        p_header: {
          type: "TBL_NT_TTE_PREQUEST_HDR",
          val: [headerObj]   // ✅ Array with one ARRAY
        },
        p_details: {
          type: "TBL_NT_TTE_PREQUEST_DET",
          val: detailRows
        },
        p_terms: {
          type: "TBL_NT_PR_SUPPL_TERM_COND",
          val: termRows
        }
      },
      {
        autoCommit: false
      }
    );
console.timeEnd("Oracle Execute");
    /******************************************************
     * Commit
     ******************************************************/
    console.time("Commit");
    await connection.commit();
    console.timeEnd("Commit");
console.time("JSON Response");
    res.json({
      success: true,
      message: "Purchase Request saved successfully."
    });
console.timeEnd("JSON Response");
  } catch (error: any) {
    console.error("PROC_INS_UPD_TTE_PREQUEST Error:", error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      message: error.message || "Error while saving Purchase Request."
    });
  } finally {
    console.timeEnd("Total API");

    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Connection close error:", closeError);
      }
    }
  }
};