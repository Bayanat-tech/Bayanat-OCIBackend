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
  SALES_DATE: toDate(data.sales_date),
  DOC_DATE: toDate(data.doc_date),

  // Numeric fields
  SALES_AMOUNT: toNumber(data.sales_amount),
  TOTALDRPC_AMOUNT: toNumber(data.totaldrpc_amount),
  PRICE: toNumber(data.price),
  QUANTITY: toNumber(data.quantity),
  DPRC_PERCENTAGE: toNumber(data.dprc_percentage),
  CURRDRPC_AMOUNT: toNumber(data.currdrpc_amount),
  PREVDRPC_AMOUNT: toNumber(data.prevdrpc_amount),
  WD_VALUE: toNumber(data.wd_value),
  SALVAGE_VALUE: toNumber(data.salvage_value),
  SALES_PROFITLOSS: toNumber(data.sales_profitloss),
  AMOUNT: toNumber(data.amount)
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