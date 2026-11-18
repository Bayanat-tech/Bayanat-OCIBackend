import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const toNumber = (val: any): number | null => {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
};

const toDate = (val: any): Date | null => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const upsertMsAcAsset = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const data = req.body;

    if (!data?.company_code) {
      res.status(400).json({
        success: false,
        message: "company_code is required"
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

    // 🔹 Oracle Object
    const AssetObjClass = await connection.getDbObjectClass(
      "TR_MS_AC_ASSET_OBJ"
    );

    const obj: any = new AssetObjClass({
      COMPANY_CODE: data.company_code,
      ASSET_ID: data.asset_id,

      ASSET_NAME: data.asset_name,
      ASSET_GROUP_CODE: data.asset_group_code,
      ASSET_BRAND_CODE: data.asset_brand_code,

      ASSET_AC_CODE: data.asset_ac_code,
      DPRC_AC_CODE: data.dprc_ac_code,
      ACCUDPRC_AC_CODE: data.accudprc_ac_code,

      DPRC_PERCENTAGE: toNumber(data.dprc_percentage),
      DPRC_COMMENCE_DATE: toDate(data.dprc_commence_date),

      DOC_TYPE: data.doc_type,
      DOC_NO: toNumber(data.doc_no),

      ASSET_PROPERTIES: data.asset_properties,

      PURCHASE_DATE: toDate(data.purchase_date),

      QUANTITY: toNumber(data.quantity),
      PRICE: toNumber(data.price),
      AMOUNT: toNumber(data.amount),
      WD_VALUE: toNumber(data.wd_value) ?? toNumber(data.amount),
      DPRC_REQUIRED: data.dprc_required || "Y",
      SALVAGE_VALUE: toNumber(data.salvage_value) || 0,
      ACUUDRPC_OPENING: toNumber(data.accudprc_amount) || 0,

      SUPPLIER_NAME: data.supplier_name,
      SUPPLIER_AC_CODE: data.supplier_ac_code,

      STATUS: data.status || "A",
      DIV_CODE: data.div_code
    });

    await connection.execute(
      `BEGIN
         PROC_UPSERT_MS_AC_ASSET(:p_data);
       END;`,
      {
        p_data: obj
      }
    );

    // Ensure WD_VALUE and DPRC_REQUIRED are never left NULL or 0 for active assets with an amount
    const wdVal = toNumber(data.wd_value) ?? toNumber(data.amount) ?? 0;
    if (wdVal > 0) {
      await connection.execute(
        `UPDATE MS_AC_ASSET
         SET WD_VALUE = NVL(:wdVal, AMOUNT),
             DPRC_REQUIRED = NVL(:dprcReq, 'Y')
         WHERE COMPANY_CODE = :comp
           AND (ASSET_ID = :assetId OR (ASSET_NAME = :assetName AND ASSET_ID IS NOT NULL))
           AND (WD_VALUE IS NULL OR WD_VALUE = 0)`,
        {
          wdVal,
          dprcReq: data.dprc_required || "Y",
          comp: data.company_code,
          assetId: data.asset_id || "NOT_SET",
          assetName: data.asset_name || "",
        }
      );
    }

    await connection.commit();

    res.json({
      success: true,
      message: "Asset saved successfully"
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