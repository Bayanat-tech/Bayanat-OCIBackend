import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const upsertAssetSaleRegister = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {

    const data = req.body;

    if (!data?.company_code || !data?.doc_no) {
      res.status(400).json({
        success: false,
        message: "company_code and doc_no are required"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}

    if (!tenantId && data?.loginid) {
      tenantId = await TenantManager.getTenantForUser(data.loginid);
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    await connection.execute(
      `
      BEGIN
        PROC_UPSERT_ASSET_SALE_REGISTER(:p_data);
      END;
      `,
      {
        p_data: {
          type: "TR_AC_ASSET_SALE_OBJ",
          val: {
            COMPANY_CODE: data.company_code,
            ASSET_ID: data.asset_id,
            ASSET_NAME: data.asset_name,
            ASSET_AC_CODE: data.asset_ac_code,
            DPRC_AC_CODE: data.dprc_ac_code,
            ACCUDPRC_AC_CODE: data.accudprc_ac_code,
            DPRC_PERCENTAGE: data.dprc_percentage,
            DPRC_COMMENCE_DATE: data.dprc_commence_date,
            DOC_TYPE: data.doc_type,
            DOC_NO: data.doc_no,
            ASSET_PROPERTIES: data.asset_properties,
            ACUUDRPC_OPENING: data.acuudrpc_opening,
            PREVDRPC_AMOUNT: data.prevdrpc_amount,
            CURRDRPC_AMOUNT: data.currdrpc_amount,
            TOTALDRPC_AMOUNT: data.totaldrpc_amount,
            SALES_DATE: data.sales_date,
            SALES_AMOUNT: data.sales_amount,
            SALES_PROFITLOSS: data.sales_profitloss,
            QUANTITY: data.quantity,
            PRICE: data.price,
            AMOUNT: data.amount,
            WD_VALUE: data.wd_value,
            SALVAGE_VALUE: data.salvage_value,
            CUSTOMER_NAME: data.customer_name,
            CUSTOMER_AC_CODE: data.customer_ac_code,
            STATUS: data.status,
            AC_EXP_CODE: data.ac_exp_code,
            EXP_SUBTYPE_CODE: data.exp_subtype_code,
            SOLD: data.sold,
            DOC_DATE: data.doc_date,
            FA_DISPOSAL_AC: data.fa_disposal_ac,
            PL_FA_DISPOSAL_AC: data.pl_fa_disposal_ac,
            DIV_CODE: data.div_code
          }
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Record saved successfully"
    });

  } catch (err: any) {

    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Upsert failed",
      details: err.message
    });

  } finally {

    if (connection) {
      await connection.close().catch(() => {});
    }

  }

};