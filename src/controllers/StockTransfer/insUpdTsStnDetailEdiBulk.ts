import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

// ✅ Safe date converter
const toDateOrNull = (val: any) => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const insUpdTsStnDetailEdiBulk = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const rows = req.body?.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({
        success: false,
        message: "rows array is required"
      });
      return;
    }

    // ✅ Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}

    if (!tenantId && req.body?.loginid) {
      tenantId = await TenantManager.getTenantForUser(req.body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // ✅ Get DB object type
    const objType = await connection.getDbObjectClass(
      "WMSTST.TS_STNDETAIL_EDI_TAB"
    );

    const mappedRows = rows.map((row: any) => ({
      COMPANY_CODE: row.company_code?.toString() || "",
      STN_NO: Number(row.stn_no) || 0,

      PRIN_CODE: row.prin_code?.toString() || "",
      PROD_CODE: row.prod_code?.toString() || "",
      PROD_NAME: row.prod_name?.toString() || "",
      SITE_CODE: row.site_code?.toString() || "",

      JOB_NO: row.job_no?.toString() || "",
      PALLET_ID: row.pallet_id?.toString() || "",

      LOT_NO_FROM: row.lot_no_from?.toString() || "",
      LOT_NO_TO: row.lot_no_to?.toString() || "",

      BATCH_NO_FROM: row.batch_no_from?.toString() || "",
      BATCH_NO_TO: row.batch_no_to?.toString() || "",

      P_UOM: row.p_uom?.toString() || "",
      L_UOM: row.l_uom?.toString() || "",

      FROM_SITE: row.from_site?.toString() || "",
      TO_SITE: row.to_site?.toString() || "",

      FROM_LOC_START: row.from_loc_start?.toString() || "",
      FROM_LOC_END: row.from_loc_end?.toString() || "",

      TO_LOC_START: row.to_loc_start?.toString() || "",
      TO_LOC_END: row.to_loc_end?.toString() || "",

      // ✅ FIXED DATE HANDLING
      MFG_DATE_FROM: toDateOrNull(row.mfg_date_from),
      MFG_DATE_TO: toDateOrNull(row.mfg_date_to),

      EXP_DATE_FROM: toDateOrNull(row.exp_date_from),
      EXP_DATE_TO: toDateOrNull(row.exp_date_to),

      KEY_NUMBER: row.key_number?.toString() || "",

      QUANTITY: Number(row.quantity) || 0,
      QTY_PUOM: Number(row.qty_puom) || 0,
      QTY_LUOM: Number(row.qty_luom) || 0,

      USER_ID: row.user_id?.toString() || ""
    }));

    // ✅ Execute procedure
    await connection.execute(
      `BEGIN PROC_INS_UPD_TS_STNDETAIL_EDI(:p_rows); END;`,
      {
        p_rows: new objType(mappedRows)
      },
      {
        autoCommit: false
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${rows.length} STN records processed successfully`
    });

  } catch (err: any) {
    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Bulk STN procedure execution failed",
      details: err.message
    });

  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};