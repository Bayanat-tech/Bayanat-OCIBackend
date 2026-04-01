import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";


export const insUpdTcCountDetailsBulk = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const records = req.body?.records;

    console.log('records ', records);

    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({
        success: false,
        message: "records array is required"
      });
      return;
    }

    // Resolve tenant
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

    // Map records and convert date fields
    const formattedRecords = records.map((r: any) => ({
      COUNT_NO: r.count_no,
      SITE_CODE: r.site_code,
      LOCATION_CODE: r.location_code,
      PRIN_CODE: r.prin_code,
      PROD_CODE: r.prod_code,
      DOC_REF: r.doc_ref,
      LOT_NO: r.lot_no,
      BOOK_PUOMQTY: r.book_puomqty,
      ACT_PUOMQTY: r.act_puomqty,
      KEY_NUMBER: r.key_number,
      POSTED_IND: r.posted_ind,
      BOOK_LUOMQTY: r.book_luomqty,
      ACT_LUOMQTY: r.act_luomqty,
      SERIAL_NO: r.serial_no,
      MFG_DATE: r.mfg_date ? new Date(r.mfg_date) : null,
      EXP_DATE: r.exp_date ? new Date(r.exp_date) : null,
      JOB_NO: r.job_no,
      CONTAINER_NO: r.container_no,
      MANU_CODE: r.manu_code,
      USER_ID: r.user_id,
      USER_DT: r.user_dt ? new Date(r.user_dt) : null,
      BOOK_VALUE: r.book_value,
      ACTUAL_VALUE: r.actual_value,
      P_UOM: r.p_uom,
      L_UOM: r.l_uom,
      ACT_QUANTITY: r.act_quantity,
      BOOKSTK_QUANTITY: r.bookstk_quantity,
      MUOM_FLAG: r.muom_flag,
      ACT_PRODCODE: r.act_prodcode,
      ACTUAL_KEYNUMBER: r.actual_keynumber,
      COMPANY_CODE: r.company_code,
      ACT_PUOM: r.act_puom,
      ACT_LUOM: r.act_luom,
      CONFIRMED: r.confirmed,
      CONFIRMED_DATE: r.confirmed_date ? new Date(r.confirmed_date) : null,
      ADJ_GENERATED: r.adj_generated,
      UPPP: r.uppp,
      CNT_PROCESSED: r.cnt_processed,
      SELECTED_EASY: r.selected_easy,
      STN_NO: r.stn_no,
      QTY_PICKED: r.qty_picked,
      BATCH_NO: r.batch_no,
      PALLET_ID: r.pallet_id
    }));

    await connection.execute(
      `
      BEGIN
        PROC_INS_UPD_TC_COUNTDETAILS(:p_records);
      END;
      `,
      {
        p_records: {
          type: "TC_COUNTDETAILS_TAB",
          val: formattedRecords
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${records.length} records processed successfully`
    });

  } catch (err: any) {
    console.error("Oracle error:", err);
    res.status(500).json({
      success: false,
      message: "Bulk procedure execution failed",
      details: err.message
    });

  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};