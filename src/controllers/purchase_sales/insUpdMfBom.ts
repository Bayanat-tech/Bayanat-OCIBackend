import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";


export const insUpdMfBom = async (
  req: Request,
  res: Response
): Promise<void> => {

  console.log("insUpdMfBom called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {

    const bom = req.body?.bom;

    console.log("BOM received:", bom);


    // --------------------------------------------------
    // Validate Request
    // --------------------------------------------------

    if (!Array.isArray(bom) || bom.length === 0) {

      res.status(400).json({
        success: false,
        message: "BOM records are required"
      });

      return;
    }


    // --------------------------------------------------
    // Resolve Tenant
    // --------------------------------------------------

    const tenantId = getCurrentTenantId();

    if (!tenantId) {

      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });

      return;
    }


    // --------------------------------------------------
    // Get Oracle Connection
    // --------------------------------------------------

    connection = await TenantManager.getConnection(tenantId);


    // --------------------------------------------------
    // Validate Parent BOM Information
    // --------------------------------------------------

    const companyCode = bom[0]?.company_code;
    const prinCode = bom[0]?.prin_code;
    const prodCode = bom[0]?.prod_code;


    if (!companyCode) {

      res.status(400).json({
        success: false,
        message: "COMPANY_CODE is required"
      });

      return;
    }


    if (!prinCode) {

      res.status(400).json({
        success: false,
        message: "PRIN_CODE is required"
      });

      return;
    }


    if (!prodCode) {

      res.status(400).json({
        success: false,
        message: "PROD_CODE is required"
      });

      return;
    }


    // --------------------------------------------------
    // Make sure all rows belong to same BOM
    // --------------------------------------------------

    const invalidRow = bom.find(
      (row: any) =>
        row.company_code !== companyCode ||
        row.prin_code !== prinCode ||
        row.prod_code !== prodCode
    );


    if (invalidRow) {

      res.status(400).json({
        success: false,
        message:
          "All BOM rows must have the same COMPANY_CODE, PRIN_CODE and PROD_CODE"
      });

      return;
    }


    // --------------------------------------------------
    // Execute Oracle Procedure
    // --------------------------------------------------

    await connection.execute(
      `
      BEGIN
        WMSTST.PROC_INS_UPD_MF_BOM(
          :p_bom
        );
      END;
      `,
      {

        p_bom: {

          type: "WMSTST.MF_BOM_TAB",

          val: bom.map((b: any) => ({

            COMPANY_CODE: b.company_code,

            PRIN_CODE: b.prin_code,

            PROD_CODE: b.prod_code,

            CHILD_PROD_CODE: b.child_prod_code,

            P_UOM: b.p_uom,

            P_QTY: b.p_qty,

            L_UOM: b.l_uom,

            L_QTY: b.l_qty,

            USER_ID: b.user_id,

            USER_DT: b.user_dt
              ? new Date(b.user_dt)
              : null,

            QUANTITY: b.quantity,

            UPPP: b.uppp,

            BOM_TYPE: b.bom_type,

            UNIT_PRICE: b.unit_price,

            PRNT_P_CODE: b.prnt_p_code

          }))

        }

      },

      {
        autoCommit: false
      }
    );


    // --------------------------------------------------
    // Commit
    // --------------------------------------------------

    await connection.commit();


    // --------------------------------------------------
    // Success Response
    // --------------------------------------------------

    res.json({

      success: true,

      message: "BOM saved successfully",

      data: {
        company_code: companyCode,
        prin_code: prinCode,
        prod_code: prodCode,
        records: bom.length
      }

    });


  } catch (err: any) {

    console.error(
      "MF_BOM Oracle Error:",
      err
    );


    // --------------------------------------------------
    // Rollback
    // --------------------------------------------------

    if (connection) {

      try {

        await connection.rollback();

      } catch (rollbackError) {

        console.error(
          "Rollback Error:",
          rollbackError
        );

      }

    }


    res.status(500).json({

      success: false,

      message: "BOM save failed",

      details: err?.message || "Unknown error"

    });


  } finally {

    // --------------------------------------------------
    // Close Connection
    // --------------------------------------------------

    if (connection) {

      try {

        await connection.close();

      } catch (closeError) {

        console.error(
          "Connection Close Error:",
          closeError
        );

      }

    }

  }
};