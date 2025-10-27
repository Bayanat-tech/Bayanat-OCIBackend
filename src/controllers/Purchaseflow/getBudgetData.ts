import { QueryTypes } from "sequelize";
import { sequelize } from "../../database/connection";

export const getBudgetData = async (
  request_number: string,
  cost_code?: string
) => {
  try {
    console.log("before checking costcode");
    // If `cost_code` is provided, return the specific data for cost_code
    if (cost_code) {
      if (cost_code === "DUMMY") {
        const query1 = `
          SELECT company_code,
                 cost_code,
                 project_code,
                 month_budget,
                 budget_year,
                 requested_amt,
                 approved_amt,
                 0 AS po_amount,
                 0 AS pr_amount,
                 0 AS prev_appr_amt
          FROM MS_PROJ_COST_MONTHWISE_BUDGET 
          WHERE request_number = :request_number`;

        try {
          const projectBudgetData1 = await sequelize.query(query1, {
            replacements: { request_number },
            type: QueryTypes.SELECT,
          });

          console.log(projectBudgetData1.length);

          if (!projectBudgetData1.length) {
            return null;
          }
          //console.log("projectBudgetData1", projectBudgetData1);
          return projectBudgetData1; // Return the data if found
          console.log("message after return");
        } catch (error) {
          console.error("Database Query Error:", error);
          throw error;
          return;
        }
      }

      console.log("inside costcode", cost_code);
      const executeProcedureQuery = `
      CALL CREATE_GT_COST_MONTHWISE_BUDGET(:request_number, :cost_code);
    `;
      await sequelize.query(executeProcedureQuery, {
        replacements: { request_number, cost_code: cost_code || null },
        type: QueryTypes.RAW,
      });
      const costBudgetQuery = `
        SELECT 
          company_code,
          project_code,
          month_budget,
          budget_year,
          requested_amt,
          approved_amt,
          po_amount,
          pr_amount,
          prev_appr_amt
        FROM GT_COST_MONTHWISE_BUDGET
        WHERE request_number = :request_number AND cost_code = :cost_code
      `;
      const costBudgetData = await sequelize.query(costBudgetQuery, {
        replacements: { request_number, cost_code },
        type: QueryTypes.SELECT,
      });
      console.log(costBudgetData.length);
      if (!costBudgetData.length) {
        return null;
      }
      console.log(costBudgetData);
      return { costBudgetData };
    }

    // When no `cost_code` is provided, return 3 datasets
    const headerQuery = `
             select request_number, company_code, request_date, description, remarks, last_action, project_code, updated_by, created_by, total_project_cost, proj_budget_alloc, tot_proj_po, tot_proj_pr, tot_proj_cost_po, total_proj_cost_pr
from VW_BUDGET_HEADER_ENTRY
      WHERE request_number = :request_number
    `;
    const headerData = await sequelize.query(headerQuery, {
      replacements: { request_number },
      type: QueryTypes.SELECT,
    });

    const itemsQuery = `
      SELECT 
        company_code,
        request_number,
        cost_code,
        requested_amt,
        req_appr_amt,
        pr_amount,
        po_amount,
        cost_name,
        prev_appr_amt
      FROM VW_BUDGET_REQUEST_ENTRY
      WHERE request_number = :request_number
      
    `;
    const itemsData = await sequelize.query(itemsQuery, {
      replacements: { request_number },
      type: QueryTypes.SELECT,
    });

    /*const projectBudgetQuery = `
      SELECT 
        company_code,
        project_code,
        month_budget,
        budget_year,
        requested_amt,
        approved_amt,
        po_amount,
        pr_amount,
        prev_appr_amt
      FROM VW_BUDGET_REQUEST_ENTRY_PROJECTWISE
      WHERE request_number = :request_number
    `;*/
    const projectBudgetQuery = `
      SELECT 
  'COMP001' AS company_code,
  'PROJ001' AS project_code,
  10000.00 AS month_budget,
  2025 AS budget_year,
  8000.00 AS requested_amt,
  7500.00 AS approved_amt,
  7200.00 AS po_amount,
  7600.00 AS pr_amount,
  5000.00 AS prev_appr_amt;
    `;
    const projectBudgetData = await sequelize.query(projectBudgetQuery, {
      replacements: { request_number },
      type: QueryTypes.SELECT,
    });
    const result2 = await sequelize.query(
      "CALL PRO_UPDATEANDINSERTBUDGET_NEW(:request_number)",
      {
        replacements: { request_number },
        type: QueryTypes.RAW, // Use RAW type for executing stored procedures
      }
    );
    /*  const updateQuery = `
      UPDATE TEMP_COST_PROJECT_MONTHWISE t
      JOIN MS_PROJ_COST_MONTHWISE_BUDGET m
      ON t.MONTH_BUDGET = m.MONTH_BUDGET
      AND t.BUDGET_YEAR = m.BUDGET_YEAR
      AND t.COST_CODE = m.COST_CODE
      AND t.PROJECT_CODE = m.PROJECT_CODE
      SET t.REQUESTED_AMT = m.REQUESTED_AMT,
          t.REQ_APPROVED_AMT = m.APPROVED_AMT
      WHERE m.REQUEST_NUMBER = :request_number;
    `;

    console.log("Executing update for request number:", request_number);

    await sequelize.query(updateQuery, {
      type: QueryTypes.UPDATE,
      replacements: { request_number }, // Updated to match the variable name
    });*/

    const GT_MONTH_COST_WISE_INFO = `
    SELECT 
    DISTINCT  *
    FROM GT_MONTH_COST_WISE_INFO WHERE COST_CODE IS NOT NULL  ORDER BY COST_CODE,BUDGET_YEAR,MONTH_BUDGET 
  `;

    /* const VW_MONTH_COST_WISE_INFOData = await sequelize.query(
      VW_MONTH_COST_WISE_INFO,
      {
        replacements: { request_number },
        type: QueryTypes.SELECT,
      }
    );*/

    const TMonthCostWiseInfodata = await sequelize.query(
      GT_MONTH_COST_WISE_INFO,
      {
        type: QueryTypes.SELECT,
      }
    );


    const result1 = await sequelize.query(
      "CALL PRO_GT_MONTH_PROJECT_WISE_INFO(:request_number)",
      {
        replacements: { request_number },
        type: QueryTypes.RAW, // Use RAW type for executing stored procedures
      }
    );



    const GT_MONTH_PROJECT_WISE_INFO = `
    SELECT DISTINCT
     *
    FROM GT_MONTH_PROJECT_WISE_INFO  WHERE PROJECT_CODE IS NOT NULL  ORDER BY PROJECT_CODE,BUDGET_YEAR,MONTH_BUDGET 
  `;

    /* const VW_MONTH_COST_WISE_INFOData = await sequelize.query(
      VW_MONTH_COST_WISE_INFO,
      {
        replacements: { request_number },
        type: QueryTypes.SELECT,
      }
    );*/

    const TMonthProjectWiseInfodata = await sequelize.query(
      GT_MONTH_PROJECT_WISE_INFO,
      {
        type: QueryTypes.SELECT,
      }
    );
   // console.log("TMonthCostWiseInfodata:", TMonthProjectWiseInfodata);
    console.log('request_number',request_number)
    // Return the combined datasets
    return {
      headerData,
      itemsData,
      projectBudgetData,
      TMonthCostWiseInfodata,
      TMonthProjectWiseInfodata,
    };
  } catch (error) {
    console.error("Error fetching budget data:", error);
    throw new Error("Failed to fetch budget data.");
  }
};
