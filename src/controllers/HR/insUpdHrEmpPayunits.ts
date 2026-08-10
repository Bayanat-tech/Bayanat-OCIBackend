import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";


export const insUpdHrEmpPayunits = async (
  req: Request,
  res: Response
): Promise<void> => {

  console.log("insUpdHrEmpComponents called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {

    const component = req.body?.component;

    console.log("component received:", component);


    // --------------------------------------------------
    // Validate Request
    // --------------------------------------------------

    if (!component) {

      res.status(400).json({
        success: false,
        message: "Employee component data is required"
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
    // Execute Oracle Procedure
    // --------------------------------------------------

    await connection.execute(
      `
      BEGIN
        WMSTST.PROC_INS_UPD_HR_EMP_COMPONENTS(
          :p_component
        );
      END;
      `,
      {

        p_component: {

          type: "WMSTST.HR_EMP_COMPONENTS_TAB",

          val: [
            {

              EMPLOYEE_ID: component.employee_id,

              PAY_COMP_ID: component.pay_comp_id,

              PAY_COMP_AMT: component.pay_comp_amt,

              PAY_COMP_PERC: component.pay_comp_perc,

              PAY_COMP_AMT_OLD: component.pay_comp_amt_old,

              ENTERED_ON: component.entered_on
                ? new Date(component.entered_on)
                : null,

              ENTERED_BY: component.entered_by,

              VERIFIED_ON: component.verified_on
                ? new Date(component.verified_on)
                : null,

              VERIFIED_BY: component.verified_by,

              APPROVED_ON: component.approved_on
                ? new Date(component.approved_on)
                : null,

              APPROVED_BY: component.approved_by,

              REVISED_ON: component.revised_on
                ? new Date(component.revised_on)
                : null,

              REVISED_BY: component.revised_by,

              FREEZED_ON: component.freezed_on
                ? new Date(component.freezed_on)
                : null,

              FREEZED_REASON: component.freezed_reason,

              FREEZED_TILL: component.freezed_till
                ? new Date(component.freezed_till)
                : null,

              REMARKS: component.remarks,

              STATUS_FLAG: component.status_flag,

              USER_ID: component.user_id,

              USER_DT: component.user_dt
                ? new Date(component.user_dt)
                : null,

              COMPANY_CODE: component.company_code,

              PAY_COMP_EARN_DED: component.pay_comp_earn_ded,

              PAY_ROLL_STATUS: component.pay_roll_status,

              COMP_STATUS: component.comp_status,

              ARREARS_AMT: component.arrears_amt,

              ARREARS_TYPE: component.arrears_type,

              ARREARS_POSTED: component.arrears_posted,

              REF_DOC_TYPE: component.ref_doc_type,

              REF_DOC_NO: component.ref_doc_no,

              PAY_COMP_AMT_VAC: component.pay_comp_amt_vac,

              VAC_UPDATED: component.vac_updated,

              SOURCE_FROM: component.source_from,

              SOURCE_UPDATED: component.source_updated
                ? new Date(component.source_updated)
                : null,

              CURR_CODE: component.curr_code ?? "OMR",

              DOC_NO: component.doc_no

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

      message: "Employee pay component saved successfully",

      data: {

        company_code: component.company_code,

        employee_id: component.employee_id,

        pay_comp_id: component.pay_comp_id,

        curr_code: component.curr_code ?? "OMR"

      }

    });


  } catch (err: any) {

    console.error(
      "HR_EMP_COMPONENTS Oracle Error:",
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

      message: "Employee component save failed",

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