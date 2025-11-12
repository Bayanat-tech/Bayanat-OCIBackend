import { QueryTypes } from "sequelize";
import oracledb from "oracledb";
import { oracleDb } from "../../database/connection"


export const getBudgetData = async (
  request_number: string,
  cost_code?: string
) => {
  let connection: oracledb.Connection | undefined;

  try {
    connection = await oracleDb.getConnection();

    // -----------------------------
    // Case 1: cost_code is provided
    // -----------------------------
    if (cost_code) {
      // If cost_code is "DUMMY", return dummy budget data
      if (cost_code === "DUMMY") {
        const dummyQuery = `
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
          WHERE request_number = :request_number
        `;
        const result = await connection.execute(dummyQuery, { request_number }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        if (!result.rows || result.rows.length === 0) return null;
        return result.rows;
      }

      // Call procedure to create GT_COST_MONTHWISE_BUDGET
      await connection.execute(
        `BEGIN CREATE_GT_COST_MONTHWISE_BUDGET(:request_number, :cost_code); END;`,
        { request_number, cost_code }
      );

      // Fetch the cost-wise budget
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
      const costBudgetResult = await connection.execute(costBudgetQuery, { request_number, cost_code }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!costBudgetResult.rows || costBudgetResult.rows.length === 0) return null;

      return { costBudgetData: costBudgetResult.rows };
    }

    // ------------------------------------------
    // Case 2: No cost_code, return 3+ datasets
    // ------------------------------------------
    const headerQuery = `
      SELECT request_number, company_code, request_date, description, remarks, last_action,
             project_code, updated_by, created_by, total_project_cost, proj_budget_alloc,
             tot_proj_po, tot_proj_pr, tot_proj_cost_po, total_proj_cost_pr
      FROM VW_BUDGET_HEADER_ENTRY
      WHERE request_number = :request_number
    `;
    const headerData = await connection.execute(headerQuery, { request_number }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    const itemsQuery = `
      SELECT company_code, request_number, cost_code, requested_amt, req_appr_amt,
             pr_amount, po_amount, cost_name, prev_appr_amt
      FROM VW_BUDGET_REQUEST_ENTRY
      WHERE request_number = :request_number
    `;
    const itemsData = await connection.execute(itemsQuery, { request_number }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    // Dummy project budget data
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
        5000.00 AS prev_appr_amt
      FROM DUAL
    `;
    const projectBudgetData = await connection.execute(projectBudgetQuery, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    // Call procedure to update budget
    await connection.execute(
      `BEGIN PRO_UPDATEANDINSERTBUDGET_NEW(:request_number); END;`,
      { request_number }
    );

    // Fetch month-wise cost info
    const TMonthCostWiseInfoQuery = `
      SELECT DISTINCT *
      FROM GT_MONTH_COST_WISE_INFO
      WHERE COST_CODE IS NOT NULL
      ORDER BY COST_CODE, BUDGET_YEAR, MONTH_BUDGET
    `;
    const TMonthCostWiseInfodata = await connection.execute(TMonthCostWiseInfoQuery, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    // Call procedure to generate month-project-wise info
    await connection.execute(
      `BEGIN PRO_GT_MONTH_PROJECT_WISE_INFO(:request_number); END;`,
      { request_number }
    );

    const TMonthProjectWiseInfoQuery = `
      SELECT DISTINCT *
      FROM GT_MONTH_PROJECT_WISE_INFO
      WHERE PROJECT_CODE IS NOT NULL
      ORDER BY PROJECT_CODE, BUDGET_YEAR, MONTH_BUDGET
    `;
    const TMonthProjectWiseInfodata = await connection.execute(TMonthProjectWiseInfoQuery, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    return {
      headerData: headerData.rows,
      itemsData: itemsData.rows,
      projectBudgetData: projectBudgetData.rows,
      TMonthCostWiseInfodata: TMonthCostWiseInfodata.rows,
      TMonthProjectWiseInfodata: TMonthProjectWiseInfodata.rows,
    };
  } catch (error) {
    console.error("Error fetching budget data:", error);
    throw new Error("Failed to fetch budget data.");
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection:", err);
      }
    }
  }
};
