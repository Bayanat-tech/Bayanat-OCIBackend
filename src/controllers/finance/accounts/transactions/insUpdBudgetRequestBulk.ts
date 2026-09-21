import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const insUpdBudgetRequestBulk = async (
  req: Request,
  res: Response
): Promise<void> => {
  console.log("insUpdBudgetRequestBulk called ----------------");
  console.log("Request Body :", req.body);

  let connection: oracledb.Connection | undefined;

  try {
    const header = req.body?.header;
    const details = req.body?.details;

    if (!header || !Array.isArray(details) || details.length === 0) {
      res.status(400).json({
        success: false,
        message: "Header and Details are required."
      });
      return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found."
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    //------------------------------------------------------------------
    // Header Mapping
    //------------------------------------------------------------------

    const headerRow = {
      REQUEST_NUMBER:
        header.request_number != null
          ? String(header.request_number)
          : "0",

      REQUEST_DATE: header.request_date
        ? new Date(header.request_date)
        : null,

      DESCRIPTION: header.description ?? null,

      REMARKS: header.remarks ?? null,

      DIV_CODE: header.div_code ?? null,

      AMOUNT:
        header.amount != null
          ? Number(header.amount)
          : 0,

      DEPARTMENT_CODE: header.department_code ?? null,

      FLOW_CODE: header.flow_code ?? null,

      FLOW_LEVEL_INITIAL:
        header.flow_level_initial != null
          ? Number(header.flow_level_initial)
          : 0,

      FLOW_LEVEL_RUNNING:
        header.flow_level_running != null
          ? Number(header.flow_level_running)
          : 0,

      FLOW_LEVEL_FINAL:
        header.flow_level_final != null
          ? Number(header.flow_level_final)
          : 0,

      COMPANY_CODE: header.company_code ?? null,

      CURRENCY_RATE:
        header.currency_rate != null
          ? Number(header.currency_rate)
          : 1,

      USER_DT: header.user_dt
        ? new Date(header.user_dt)
        : null,

      USER_ID: header.user_id ?? null,

      FA_UPLOADED: header.fa_uploaded ?? "N",

      FINAL_APPROVED: header.final_approved ?? "No",

      REMARKS_HISTRY: header.remarks_histry ?? null,

      CURR_CODE: header.curr_code ?? null,

      CREATE_USER: header.create_user ?? null,

      CREATE_DATE: header.create_date
        ? new Date(header.create_date)
        : null,

      LAST_UPDATED: header.last_updated ?? null,

      LAST_ACTION: header.last_action ?? null,

      HISTORY_SERIAL:
        header.history_serial != null
          ? Number(header.history_serial)
          : 0,

      ATTACH_FILE_NAME: header.attach_file_name ?? null,

      ATTACH_FILE_NAME1: header.attach_file_name1 ?? null,

      ATTACH_FILE_NAME2: header.attach_file_name2 ?? null,

      REJECT_HISTRY: header.reject_histry ?? null,

      SENDBACK_HISTRY: header.sendback_histry ?? null,

      NEXT_ACTION_BY: header.next_action_by ?? null,

      BUDGET_YEAR: header.budget_year ?? null,
    };

    //------------------------------------------------------------------
    // Detail Mapping
    //------------------------------------------------------------------

    const detailRows = details.map((row: any) => ({
      DIV_CODE: row.div_code ?? null,

      COST_CODE: row.cost_code ?? null,

      COMPANY_CODE: row.company_code ?? header.company_code,

      USER_DT: row.user_dt
        ? new Date(row.user_dt)
        : null,

      USER_ID: row.user_id ?? header.user_id,

      MONTH_DATE: row.month_date
        ? new Date(row.month_date)
        : null,

      MONTH_BUDGET:
        row.month_budget != null
          ? Number(row.month_budget)
          : 0,

      BUDGET_YEAR:
        row.budget_year != null
          ? String(row.budget_year)
          : null,

      REQUEST_NUMBER:
        row.request_number != null
          ? String(row.request_number)
          : null,

      REQUESTED_AMT:
        row.requested_amt != null
          ? Number(row.requested_amt)
          : 0,

      APPROVED_AMT:
        row.approved_amt != null
          ? Number(row.approved_amt)
          : 0,

      FINAL_APPROVED:
        row.final_approved ?? "No",

      REQUESTED_DATE: row.requested_date
        ? new Date(row.requested_date)
        : null
    }));

    //------------------------------------------------------------------
    // Call Oracle Procedure
    //------------------------------------------------------------------

    await connection.execute(
      `BEGIN
          PROC_INS_UPD_BUDGET_REQUEST(
              :p_header,
              :p_details
          );
       END;`,
      {
        p_header: {
          type: "BUDGET_REQUEST_HEADER_TAB",
          val: [headerRow]
        },

        p_details: {
          type: "ACCOUNT_MONTHWISE_BUDGET_TAB",
          val: detailRows
        }
      },
      {
        autoCommit: false
      }
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Budget Request saved successfully."
    });
  } catch (err: any) {
    console.error("Oracle Error :", err);

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      success: false,
      message: "Budget Request save failed.",
      details: err?.message || "Unknown Error"
    });
  } finally {
    if (connection) {
      await connection.close();
    }
  }
};