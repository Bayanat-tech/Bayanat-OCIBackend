import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const insUpdTrAcAssetTransferBulk = async (
  req: Request,
  res: Response
): Promise<void> => {
  console.log("insUpdTrAcAssetTransferBulk called");
  console.log("req.body:", req.body);

  let connection: oracledb.Connection | undefined;

  try { 
    const header = req.body?.header;
    const details = req.body?.details;

    if (!header || !Array.isArray(details)) {
     
      res.status(400).json({
        success: false,
        message: "Header and details are required",
      });
      return;
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found",
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
 console.log("DOC_NO:", header.doc_no);
    await connection.execute(
      
      `
      BEGIN
        PROC_INS_UPD_ASSET_TRANSFER(:p_header, :p_details);
      END;
      `,
      {
        p_header: {
          type: "TR_AC_ASSET_TRANSFER_HDR_TAB",
          val: [
            {
              COMPANY_CODE: header.company_code,
              DOC_TYPE: header.doc_type,
            DOC_NO: header.doc_no != null && header.doc_no !== 0 
  ? String(header.doc_no) 
  : null,
              DOC_DATE: header.doc_date ? new Date(header.doc_date) : null,
              SITE_FROM: header.site_from,
              SITE_TO: header.site_to,
              REMARKS: header.remarks,
              USER_ID: header.user_id,
              USER_DT: header.user_dt ? new Date(header.user_dt) : null,
              LAST_SERIAL_NO: header.last_serial_no,
              CONFIRMED: header.confirmed,
              DIV_CODE: header.div_code,
            },
          ],
         
        },
        
        p_details: {
          type: "TR_AC_ASSET_TRANSFER_DET_TAB",
          val: details.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
         DOC_NO: d.doc_no && d.doc_no !== 0 
  ? String(d.doc_no) 
  : null,
            SERIAL_NO: d.serial_no,
            ASSET_ID: d.asset_id,
            SITE_FROM: d.site_from,
            SITE_TO: d.site_to,
            EMP_ID_FROM: d.emp_id_from,
            EMP_ID_TO: d.emp_id_to,
            REMARKS: d.remarks,
            USER_ID: d.user_id,
            USER_DT: d.user_dt ? new Date(d.user_dt) : null,
            DIV_CODE: d.div_code,
          })),
        },
        
      },
      { autoCommit: false }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Asset transfer saved successfully",
    });
  } catch (err: any) {
    console.error("Oracle Error:", err);
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }
    res.status(500).json({
      success: false,
      message: "Transaction failed",
      details: err?.message || "Unknown error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {}
    }
  }
};