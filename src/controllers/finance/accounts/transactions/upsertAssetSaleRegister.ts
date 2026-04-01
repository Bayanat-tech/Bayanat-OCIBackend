import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
};

// 🔹 Safe Date Converter
const toDate = (val: any): Date | null => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const upsertAssetSaleRegister = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const data = req.body;

    if (!data?.company_code ) {
      res.status(400).json({
        success: false,
        message: "company_code are required"
      });
      return;
    }

    // 🔹 Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {}

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

    // 🔹 Get Oracle Object Class (NO schema prefix)
    const AssetSaleObjClass = await connection.getDbObjectClass(
      "TR_AC_ASSET_SALE_OBJ"
    );

    // 🔹 Create object with correct date conversion
  const obj: any = new AssetSaleObjClass({
  COMPANY_CODE: data.company_code,
  ASSET_ID: data.asset_id,
  ASSET_NAME: data.asset_name,
  ASSET_AC_CODE: data.asset_ac_code,
  DPRC_AC_CODE: data.dprc_ac_code,
  ACCUDPRC_AC_CODE: data.accudprc_ac_code,

  DPRC_PERCENTAGE: toNumber(data.dprc_percentage),
  DPRC_COMMENCE_DATE: toDate(data.dprc_commence_date),

  DOC_TYPE: data.doc_type,
DOC_NO: toNumber(data.doc_no),

  ASSET_PROPERTIES: data.asset_properties,

  ACUUDRPC_OPENING: toNumber(data.acuudrpc_opening),
  PREVDRPC_AMOUNT: toNumber(data.prevdrpc_amount),
  CURRDRPC_AMOUNT: toNumber(data.currdrpc_amount),
  TOTALDRPC_AMOUNT: toNumber(data.total_depreciation_amount),

  SALES_DATE: toDate(data.sales_date),
  SALES_AMOUNT: toNumber(data.sales_amount),
  SALES_PROFITLOSS: toNumber(data.sales_profitloss),

  QUANTITY: toNumber(data.quantity),
  PRICE: toNumber(data.price),
  AMOUNT:toNumber(data.asset_amount),

  WD_VALUE: toNumber(data.wd_value),
  SALVAGE_VALUE: toNumber(data.salvage_value),

  CUSTOMER_NAME: data.customer_name,
  CUSTOMER_AC_CODE: data.customer_ac_code,

  STATUS: data.status,
  AC_EXP_CODE: data.exp_code,
  EXP_SUBTYPE_CODE: data.exp_subtype_code,

  SOLD: data.sold,

  DOC_DATE: toDate(data.doc_date),

  FA_DISPOSAL_AC: data.fa_disposal_ac,
  PL_FA_DISPOSAL_AC: data.pl_fa_disposal_ac,

  DIV_CODE: data.div_code
});

    // 🔹 Call procedure (NO schema prefix)
    await connection.execute(
      `BEGIN
         PROC_UPSERT_ASSET_SALE_REGISTER(:p_data);
       END;`,
      {
        p_data: obj
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