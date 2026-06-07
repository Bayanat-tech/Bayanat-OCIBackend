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

export const upsertMsProduct = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const data = req.body;

    if (!data?.company_code || !data?.prin_code) {
      res.status(400).json({
        success: false,
        message: "company_code and prin_code are required"
      });
      return;
    }

    // 🔹 Tenant resolve
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
    const ProductObjClass = await connection.getDbObjectClass(
      "MS_PRODUCT_OBJ"
    );

    const obj: any = new ProductObjClass({
      COMPANY_CODE: data.company_code,
      PRIN_CODE: data.prin_code,
      PROD_CODE: data.prod_code, // optional (trigger will generate)

      PROD_NAME: data.prod_name,
      GROUP_CODE: data.group_code,
      BRAND_CODE: data.brand_code,
      PACKDESC: data.packdesc,
      BARCODE: data.barcode,

      P_UOM: data.p_uom,
      SUOM: data.suom,

      LENGTH: toNumber(data.length),
      BREADTH: toNumber(data.breadth),
      HEIGHT: toNumber(data.height),
      VOLUME: toNumber(data.volume),
      GROSS_WT: toNumber(data.gross_wt),
      NET_WT: toNumber(data.net_wt),

      FOC: data.foc,
      CPU: toNumber(data.cpu),
      HARM_CODE: data.harm_code,
      IMCO_CODE: data.imco_code,
      KITTING: data.kitting,
      MANU_CODE: data.manu_code,

      BASE_PRICE: toNumber(data.base_price),
      FLAT_STORAGE: toNumber(data.flat_storage),

      SITE_TYPE: data.site_type,
      SITE_IND: data.site_ind,

      PACK_KEY: data.pack_key,

      PROD_TI: toNumber(data.prod_ti),
      PROD_HI: toNumber(data.prod_hi),

      CHARGETIME: data.chargetime,
      PROD_STATUS: data.prod_status,

      SHELF_LIFE: toNumber(data.shelf_life),

      CATEGORY_ABC: data.category_abc,
      REORD_LEVEL: toNumber(data.reord_level),
      REORD_QTY: toNumber(data.reord_qty),

      ALT_PROD_CODE: data.alt_prod_code,

      PREF_SITE: data.pref_site,
      PREF_LOC_FROM: data.pref_loc_from,
      PREF_LOC_TO: data.pref_loc_to,
      PREF_AISLE_FROM: data.pref_aisle_from,
      PREF_AISLE_TO: data.pref_aisle_to,

      PREF_COL_FROM: toNumber(data.pref_col_from),
      PREF_COL_TO: toNumber(data.pref_col_to),
      PREF_HT_FROM: toNumber(data.pref_ht_from),
      PREF_HT_TO: toNumber(data.pref_ht_to),

      USER_DT: toDate(data.user_dt),
      USER_ID: data.user_id,

      UPPP: toNumber(data.uppp),
      LUPPP: toNumber(data.luppp),
      UOM_COUNT: toNumber(data.uom_count),

      CHK_MANUCODE: data.chk_manucode,
      CHK_LOTNO: data.chk_lotno,
      CHK_MFGEXPDT: data.chk_mfgexpdt,

      PUOM_VOLUME: toNumber(data.puom_volume),
      PUOM_NETWT: toNumber(data.puom_netwt),
      PUOM_GROSSWT: toNumber(data.puom_grosswt),

      L_UOM: data.l_uom,

      PROD_TYPE: toNumber(data.prod_type),

      TWOPLUS_UOM: data.twoplus_uom,
      UPP: toNumber(data.upp),

      WAVE_CODE: toNumber(data.wave_code),

      PRODUCT_STAGE: data.product_stage,
      CO_PACK: data.co_pack,

      MODEL_NUMBER: data.model_number,
      VARIANT_CODE: data.variant_code,
      CNT_ORIGIN: data.cnt_origin,

      SERIALIZE: data.serialize,
      PACKING: data.packing,

      OLD_UPP: toNumber(data.OLD_UPP),
      AVG_CONSUMPTION: toNumber(data.avg_consumption),

      PROD_IMAGE_PATH_WEB: data.prod_image_path_web,

      MINPERIOD_EXPPICK: toNumber(data.minperiod_exppick),
      RCPT_EXP_LIMIT: toNumber(data.rcpt_exp_limit),

      QTY_AS_WT: data.qty_as_wt,

      HAZMAT_IND: data.hazmat_ind,
      HAZMAT_CLASS: data.hazmat_class,

      FOOD_IND: data.food_ind,
      PHARMA_IND: data.pharma_ind,

      SPECIAL_INSTRUCTIONS: data.special_instructions,
      STRENGTH: data.strength,

      PACK_SIZE: toNumber(data.pack_size),

      GROUP_CODE_BK: data.group_code_bk,
      BATCH_TYPE: toNumber(data.batch_type),

      SAP_PROD_CODE: data.sap_prod_code,
      SAP_PROD_DESC: data.sap_prod_desc,

      TEMP_CODE: data.temp_code,

      EDIT_USER: data.edit_user,
      PRNT_P_CODE: data.prnt_p_code,

      PROD_SIZE: data.prod_size,
      PROD_COLOR: data.prod_color,
      PROD_GENDER: data.prod_gender,

      GENERIC_ARTICLE: data.generic_article,
      PRODUCT_CATEGORY: data.product_category,
      CURRENT_SEASON: data.current_season,

      CATEGORY_CODE: data.category_code,
      CATEGORY_BRAND_CODE: data.category_brand_code,

      UPDATED_AT: toDate(data.updated_at),
      UPDATED_BY: data.updated_by,

      CREATED_BY: data.created_by,
      CREATED_AT: toDate(data.created_at)
    });

    // 🔹 Call Procedure
    await connection.execute(
      `BEGIN
         PROC_UPSERT_MS_PRODUCT(:p_data);
       END;`,
      {
        p_data: obj
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Product saved successfully"
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