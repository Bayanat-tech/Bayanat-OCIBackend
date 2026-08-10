import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";


export const insUpdAccrualAcctSetup = async (
  req: Request,
  res: Response
): Promise<void> => {

  console.log("insUpdAccrualAcctSetup called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {

    const paycompAc = req.body?.paycomp_ac;

    console.log(
      "paycomp_ac received:",
      paycompAc
    );


    // --------------------------------------------------
    // Validate Request
    // --------------------------------------------------

    if (!paycompAc) {

      res.status(400).json({
        success: false,
        message: "Pay component accounting data is required"
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
    // Validate Primary Key
    // --------------------------------------------------

    if (!paycompAc.company_code) {

      res.status(400).json({
        success: false,
        message: "COMPANY_CODE is required"
      });

      return;
    }


    if (!paycompAc.div_code) {

      res.status(400).json({
        success: false,
        message: "DIV_CODE is required"
      });

      return;
    }


    if (!paycompAc.dept_code) {

      res.status(400).json({
        success: false,
        message: "DEPT_CODE is required"
      });

      return;
    }


    if (!paycompAc.section_code) {

      res.status(400).json({
        success: false,
        message: "SECTION_CODE is required"
      });

      return;
    }


    if (!paycompAc.pay_comp_id) {

      res.status(400).json({
        success: false,
        message: "PAY_COMP_ID is required"
      });

      return;
    }


    // --------------------------------------------------
    // Execute Oracle Procedure
    // --------------------------------------------------

    await connection.execute(
      `
      BEGIN
        WMSTST.PROC_INS_UPD_MS_HR_SEC_PAYCOMP_AC(
          :p_paycomp_ac
        );
      END;
      `,
      {

        p_paycomp_ac: {

          type: "WMSTST.MS_HR_SEC_PAYCOMP_AC_TAB",

          val: [
            {

              COMPANY_CODE:
                paycompAc.company_code,

              DIV_CODE:
                paycompAc.div_code,

              DEPT_CODE:
                paycompAc.dept_code,

              SECTION_CODE:
                paycompAc.section_code,

              PAY_COMP_ID:
                paycompAc.pay_comp_id,

              AC_CODE_DB:
                paycompAc.ac_code_db,

              USER_ID:
                paycompAc.user_id,

              USER_DT:
                paycompAc.user_dt
                  ? new Date(paycompAc.user_dt)
                  : null,

              REMARKS:
                paycompAc.remarks,

              AC_CODE_CR:
                paycompAc.ac_code_cr,

              EXP_TYPE_CODE:
                paycompAc.exp_type_code,

              EXP_SUBTYPE_CODE:
                paycompAc.exp_subtype_code,

              PAY_COMP_TYPE:
                paycompAc.pay_comp_type,

              PAY_COMP_EARN_DED:
                paycompAc.pay_comp_earn_ded,

              SEPN_FLAG:
                paycompAc.sepn_flag ?? "N"

            }
          ]

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

      message:
        "HR section pay component accounting saved successfully",

      data: {

        company_code:
          paycompAc.company_code,

        div_code:
          paycompAc.div_code,

        dept_code:
          paycompAc.dept_code,

        section_code:
          paycompAc.section_code,

        pay_comp_id:
          paycompAc.pay_comp_id,

        sepn_flag:
          paycompAc.sepn_flag ?? "N"

      }

    });


  } catch (err: any) {

    console.error(
      "MS_HR_SEC_PAYCOMP_AC Oracle Error:",
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

      message:
        "HR section pay component accounting save failed",

      details:
        err?.message || "Unknown error"

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