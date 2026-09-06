import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";


export const insUpdHrEmployeeDependants = async (
  req: Request,
  res: Response
): Promise<void> => {

  console.log("insUpdHrEmployeeDependants called-------------");
  console.log("req.body:------------------", req.body);

  let connection: oracledb.Connection | undefined;

  try {

    const details = req.body?.details;

    if (!Array.isArray(details) || details.length === 0) {
      res.status(400).json({
        success: false,
        message: "Details required"
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    /*
     * Prepare detail rows
     */
    const detailRows = details.map((d: any, index: number) => {

      if (!d.company_code) {
        throw new Error(
          `COMPANY_CODE required at row ${index + 1}`
        );
      }

      if (!d.employee_id) {
        throw new Error(
          `EMPLOYEE_ID required at row ${index + 1}`
        );
      }

      if (
        d.dep_serial_number === null ||
        d.dep_serial_number === undefined ||
        d.dep_serial_number === ""
      ) {
        throw new Error(
          `DEP_SERIAL_NUMBER required at row ${index + 1}`
        );
      }

      return {
        DEP_SERIAL_NUMBER: Number(d.dep_serial_number),

        EMPLOYEE_ID: String(d.employee_id),

        DEP_RELATION: d.dep_relation ?? null,

        DEP_NAME: d.dep_name ?? null,

        DEP_DOB: d.dep_dob
          ? new Date(d.dep_dob)
          : null,

        DEP_SPONSORED_BY:
          d.dep_sponsored_by ?? null,

        TICKET_ELIGIBILITY:
          d.ticket_eligibility ?? null,

        TICKET_TYPE:
          d.ticket_type ?? null,

        MARSTAT:
          d.marstat ?? null,

        MEDICAL_ELIGIBLE:
          d.medical_eligible ?? null,

        DEP_BLOOD_GROUP:
          d.dep_blood_group ?? null,

        STATUS_FLAG:
          d.status_flag ?? null,

        USER_ID:
          d.user_id ?? null,

        USER_DT: d.user_dt
          ? new Date(d.user_dt)
          : null,

        REMARKS:
          d.remarks ?? null,

        COMPANY_CODE:
          String(d.company_code),

        PPT_CARD:
          d.ppt_card ?? null,

        RES_CARD:
          d.res_card ?? null,

        PPT_EXP_DT: d.ppt_exp_dt
          ? new Date(d.ppt_exp_dt)
          : null,

        RES_EXP_DT: d.res_exp_dt
          ? new Date(d.res_exp_dt)
          : null,

        PPT_VALID_FROM: d.ppt_valid_from
          ? new Date(d.ppt_valid_from)
          : null,

        PPT_VALID_TO: d.ppt_valid_to
          ? new Date(d.ppt_valid_to)
          : null,

        RES_VALID_FROM: d.res_valid_from
          ? new Date(d.res_valid_from)
          : null,

        RES_VALID_TO: d.res_valid_to
          ? new Date(d.res_valid_to)
          : null,

        INS_CARD_NO:
          d.ins_card_no ?? null,

        INS_CARD_TYPE:
          d.ins_card_type ?? null,

        INS_CARD_ISSUE_DT:
          d.ins_card_issue_dt
            ? new Date(d.ins_card_issue_dt)
            : null,

        ISN_CARD_EXP_DT:
          d.isn_card_exp_dt
            ? new Date(d.isn_card_exp_dt)
            : null
      };
    });

    /*
     * Call Oracle Procedure
     */
    await connection.execute(
      `
      BEGIN
          WMSTST.PROC_INS_UPD_HR_EMPLOYEE_DEP(
              :p_details
          );
      END;
      `,
      {
        p_details: {
          type: "WMSTST.HR_EMPLOYEE_DEP_TAB",
          dir: oracledb.BIND_IN,
          val: detailRows
        }
      },
      {
        autoCommit: false
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Employee dependants saved successfully",
      count: detailRows.length
    });

  } catch (err: any) {

    console.error("Oracle Error:", err);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      message: "Employee dependants save failed",
      details: err?.message || "Unknown error"
    });

  } finally {

    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Connection close error:", closeError);
      }
    }
  }
};