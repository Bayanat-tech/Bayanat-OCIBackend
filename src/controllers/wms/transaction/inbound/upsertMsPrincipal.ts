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

export const upsertMsPrincipal = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const data = req.body;

    if (!data?.company_code) {
      res.status(400).json({
        success: false,
        message: "company_code"
      });
      return;
    }

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

    const PrincipalObjClass = await connection.getDbObjectClass(
      "TR_MS_PRINCIPAL_OBJ"
    );

    const obj: any = new PrincipalObjClass({

      COMPANY_CODE: data.company_code,
      PRIN_CODE: data.prin_code,
      PRIN_NAME: data.prin_name,
      PRIN_ADDR1: data.prin_addr1,
      PRIN_ADDR2: data.prin_addr2,
      PRIN_ADDR3: data.prin_addr3,
      PRIN_ADDR4: data.prin_addr4,
      PRIN_CITY: data.prin_city,
      TAX_COUNTRY_CODE: data.tax_country_code,
      TAX_COUNTRY_SN: data.tax_country_sn,
      SALESMAN_CODE: data.salesman_code,
      SECTOR_CODE: data.sector_code,
      PRIN_EMAIL1: data.prin_email1,
      PRIN_EMAIL2: data.prin_email2,
      PRIN_EMAIL3: data.prin_email3,
      PRIN_TELNO1: data.prin_telno1,
      PRIN_TELNO2: data.prin_telno2,
      PRIN_TELNO3: data.prin_telno3,
      PRIN_FAXNO1: data.prin_faxno1,
      PRIN_FAXNO2: data.prin_faxno2,
      PRIN_FAXNO3: data.prin_faxno3,
      PRIN_REF1: data.prin_ref1,
      PRIN_STATUS: data.prin_status,
      ACC_EMAIL: data.acc_email,
      PRIN_DEPT_CODE: data.prin_dept_code,
      PRIN_ACREF: data.prin_acref,
      TRN_NO: data.trn_no,

      TRN_EXP_DATE: toDate(data.trn_exp_date),
      PRIN_INVDATE: toDate(data.prin_invdate),

      CURR_CODE: data.curr_code,

      PRIN_BACKDT: toNumber(data.prin_backdt),
      CREDIT_LIMIT: toNumber(data.credit_limit),
      CREDITDAYS: toNumber(data.creditdays),
      CREDITDAYS_FREIGHT: toNumber(data.creditdays_freight),

      PRIN_INFZE: data.prin_infze,
      PRIN_LIC_NO: data.prin_lic_no,
      PRIN_LIC_TYPE: data.prin_lic_type,
      COMM_REG_NO: data.comm_reg_no,

      COMM_REG_EXP_DATE: toDate(data.comm_reg_exp_date),

      PRIN_IMP_CODE: data.prin_imp_code,
      PARENT_PRIN_CODE: data.parent_prin_code,

      PRIN_CONT_EMAIL1: data.prin_cont_email1,
      PRIN_CONT_EMAIL2: data.prin_cont_email2,
      PRIN_CONT_EMAIL3: data.prin_cont_email3,

      PRIN_CONT_TELNO1: data.prin_cont_telno1,
      PRIN_CONT_TELNO2: data.prin_cont_telno2,
      PRIN_CONT_TELNO3: data.prin_cont_telno3,

      PRIN_CONT_FAXNO1: data.prin_cont_faxno1,
      PRIN_CONT_FAXNO2: data.prin_cont_faxno2,
      PRIN_CONT_FAXNO3: data.prin_cont_faxno3,

      PRIN_CONT_REF1: data.prin_cont_ref1,

      PICK_WAVE: data.pick_wave,
      PICK_WAVE_QTY_SORT: data.pick_wave_qty_sort,
      PICK_WAVE_IGN_MIN_EXP: data.pick_wave_ign_min_exp,

      PREF_SITE: data.pref_site,
      PREF_LOC_FROM: data.pref_loc_from,
      PREF_LOC_TO: data.pref_loc_to,
      PREF_AISLE_FROM: data.pref_aisle_from,
      PREF_AISLE_TO: data.pref_aisle_to,

      PREF_COL_FROM: toNumber(data.pref_col_from),
      PREF_COL_TO: toNumber(data.pref_col_to),
      PREF_HT_FROM: toNumber(data.pref_ht_from),
      PREF_HT_TO: toNumber(data.pref_ht_to),

      PRIN_SITEIND: data.prin_siteind,

      SERVICE_DATE: toDate(data.service_date),

      STORAGE_TYPE: data.storage_type,
      DEFAULT_FOC: data.default_foc,
      UNDER_VALUE: data.under_value,
      AUTO_INSERT_BILLACTIVITY: data.auto_insert_billactivity,
      PRIN_CHARGE: data.prin_charge,
      PRIN_PRICECHK: data.prin_pricechk,
      PRIN_LANDEDPR: data.prin_landedpr,
      AUTO_JOB: data.auto_job,
      VALIDATE_LOTNO: data.validate_lotno,
      STORAGE_PRODUCTWISE: data.storage_productwise,

      VALIDATE_EXPDATE: toDate(data.validate_expdate),

      MINPERIOD_EXPPICK: toNumber(data.minperiod_exppick),
      RCPT_EXP_LIMIT: toNumber(data.rcpt_exp_limit),

      PERPECTUAL_CONFIRM_ALLOW: data.perpectual_confirm_allow,
      AUTOMATE_ACTIVITY: data.automate_activity,

      UPDATED_AT: toDate(data.updated_at),
      UPDATED_BY: data.updated_by,
      CREATED_BY: data.created_by,
      CREATED_AT: toDate(data.created_at),

      COUNTRY_CODE: data.country_code,
      TERRITORY_CODE: data.territory_code,
      DIR_SHPMNT: data.dir_shpmnt,

      PRIN_CONTACT1: data.prin_contact1,
      PRIN_CONTACT2: data.prin_contact2,
      PRIN_CONTACT3: data.prin_contact3,

      PRIN_GRNNO: toNumber(data.prin_grnno),

      PRIN_LICENSE: data.prin_license,
      DIV_CODE: data.div_code,
      BACKORDER_PICK: data.backorder_pick,
      BOX_NO: data.box_no,
      AUTO_GENERATE_PRODUCT_CODE: data.auto_generate_product_code,
      STORAGE_SLAB_BILL: data.storage_slab_bill,
      FREE_STORAGE: data.free_storage,
      DISPL_SITEIND_FALTAREA: data.displ_siteind_faltarea,
      QTY_AS_WT: data.qty_as_wt,
      INB_JOBWISE_BILL: data.inb_jobwise_bill

    });

    await connection.execute(
      `BEGIN
         PROC_UPSERT_MS_PRINCIPAL(:p_data);
       END;`,
      {
        p_data: obj
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "MS_PRINCIPAL saved successfully"
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