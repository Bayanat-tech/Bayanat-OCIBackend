import { Request, Response } from "express";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdTcStockCountBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {

    const headers = req.body?.headers;
    const details = req.body?.details;
    console.log('headerssandeep ',headers)

    // ✅ Require exactly ONE header
    if (!Array.isArray(headers) || headers.length !== 1) {
      res.status(400).json({
        success: false,
        message: "Exactly one header record is required"
      });
      return;
    }

    if (!Array.isArray(details)) {
      res.status(400).json({
        success: false,
        message: "details array is required"
      });
      return;
    }

    const h = headers[0];

    // ✅ Prevent ORA-12899 error
    if (h.count_no && h.count_no.length > 10) {
      res.status(400).json({
        success: false,
        message: "COUNT_NO cannot exceed 10 characters"
      });
      return;
    }

    // -------------------------------------------------
    // Resolve Tenant
    // -------------------------------------------------

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

    // -------------------------------------------------
    // HEADER MAPPING (Single Record inside Array)
    // -------------------------------------------------
console.log('count123',h.count_no);
    const headerData = [{
      COMPANY_CODE: h.company_code,
      COUNT_NO: h.count_no,
      PRIN_CODE: h.prin_code,

      COUNT_DATE: h.count_date ? new Date(h.count_date) : null,
      CONFIRMED: h.confirmed,
      CONFIRMED_DATE: h.confirmed_date ? new Date(h.confirmed_date) : null,

      PROD_CODE_FROM: h.prod_code_from,
      PROD_CODE_TO: h.prod_code_to,
      PROD_CAT_FROM: h.prod_cat_from,
      PROD_CAT_TO: h.prod_cat_to,

      SITE_CODE_FROM: h.site_code_from,
      SITE_CODE_TO: h.site_code_to,

      FROM_LOCATION: h.from_location,
      TO_LOCATION: h.to_location,

      EXPIRY_DT_FROM: h.expiry_dt_from ? new Date(h.expiry_dt_from) : null,
      EXPIRY_DT_TO: h.expiry_dt_to ? new Date(h.expiry_dt_to) : null,

      MANU_DT_FROM: h.manu_dt_from ? new Date(h.manu_dt_from) : null,
      MANU_DT_TO: h.manu_dt_to ? new Date(h.manu_dt_to) : null,

      IMP_CONTR_NO: h.imp_contr_no,
      LOT_NO: h.lot_no,
      COUNTED_BY: h.counted_by,

      REMARKS: h.remarks,
      RESULTS: h.results,
      POSTED_IND: h.posted_ind,

      USER_ID: h.user_id,

      PROD_GROUP_FROM: h.prod_group_from,
      PROD_GROUP_TO: h.prod_group_to,

      PROD_BRAND_FROM: h.prod_brand_from,
      PROD_BRAND_TO: h.prod_brand_to,

      AISLE_FROM: h.aisle_from,
      AISLE_TO: h.aisle_to,

COL_FROM: h.col_from != null ? String(h.col_from) : null,

COL_TO: h.col_to != null ? String(h.col_to) : null,
HEIGHT_FROM: h.height_from != null ? String(h.height_from) : null,
HEIGHT_TO: h.height_to != null ? String(h.height_to) : null,
ADJ_NO: h.adj_no != null ? String(h.adj_no) : null,


      FREEZE_FLAG: h.freeze_flag,
  
      COUNT_TYPE: h.count_type,
      AMLS_REP: h.amls_rep,
AMLS_DES: h.amls_des,
CLIENT_REP: h.client_rep,
CLIENT_DES: h.client_des,
    }];
console.log('h.amls_rep',h.amls_rep);
    // -------------------------------------------------
    // DETAIL MAPPING
    // -------------------------------------------------

    const detailData = details.map((d: any) => ({

      // Optional extra safety for detail COUNT_NO
      COUNT_NO: d.count_no && d.count_no.length > 10
        ? d.count_no.substring(0, 10)
        : d.count_no,

      COMPANY_CODE: d.company_code,
      PRIN_CODE: d.prin_code,
      USER_ID: d.user_id,
      USER_DT: d.user_dt ? new Date(d.user_dt) : new Date()
    }));

    // -------------------------------------------------
    // Execute Procedure
    // -------------------------------------------------
console.log('count123',h.count_no);
console.log('count123',h.col_from);
    await connection.execute(
      `BEGIN
          PROC_INS_UPD_TC_STOCKCOUNT(:p_header, :p_details);
       END;`,
      {
        p_header: {
          type: "TC_STOCKCOUNT_TAB",
          val: headerData   // still array (collection type)
        },
        p_details: {
          type: "TC_COUNTDETAILS_PRIN_TAB",
          val: detailData
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Stock count saved successfully"
    });

  } catch (err: any) {

    console.error("Oracle Error:", err);

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      success: false,
      message: "Bulk save failed",
      details: err.message
    });

  } finally {

    if (connection) {
      await connection.close().catch(() => {});
    }

  }
};