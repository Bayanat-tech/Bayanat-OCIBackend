import { Request, Response, NextFunction } from "express";
import { sequelize } from "../../database/connection";
import { QueryTypes } from "sequelize";
import constants from "../../helpers/constants";
interface ExpenseAdj {
  REQUEST_DATE: string; // 'YYYY-MM-DD'
  OLD_AMT: number;
  NEW_ADJ_AMOUNT: number;
}


// Fix the return type issue by setting Promise<void>
// Fix the return type issue by setting Promise<void>
export const executeRawSql = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawSql: string = req.body?.raw_sql || req.query?.sql;
 
    if (!rawSql || typeof rawSql !== 'string') {
      res.status(400).json({ error: 'Missing or invalid raw SQL string' });
      return;
    }
 
    const results = await sequelize.query(rawSql, {
      type: QueryTypes.SELECT,
      raw: true,
    });
 
    res.json({ success: true, data: results, totalCount: results.length });
  } catch (error: any) {
    console.error('SQL Execution Error:', error);
    res.status(500).json({ error: 'Failed to execute SQL', details: error.message });
  }
};

export const getDashboardData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const transaction = await sequelize.transaction(); // Ensure single session
  try {
    const { level, user, from_date, to_date } = req.query;

    if (!level || !user || !from_date || !to_date) {
      res.status(400).json({
        success: false,
        message: "Parameters 'level', 'user', 'from_date', and 'to_date' are required.",
      });
      return;
    }

    const parsedLevel = parseInt(level as string, 10);
    if (isNaN(parsedLevel)) {
      res.status(400).json({
        success: false,
        message: "'level' must be a valid number.",
      });
      return;
    }

    const formattedFromDate = from_date.toString().slice(0, 10);
    const formattedToDate = to_date.toString().slice(0, 10);

    // Step-by-step procedure call and data fetch
    await sequelize.query(`CALL PROC_PR_DIV_COUNT(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const VW_DB_PR_DIV_COUNTdata = await sequelize.query(`SELECT * FROM GT_PR_DIV_COUNT`, {
      type: QueryTypes.SELECT,
      transaction,
    });

    await sequelize.query(`CALL PROC_PO_DIV_COUNT(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const VW_DB_PO_DIV_COUNTdata = await sequelize.query(`SELECT * FROM GT_PO_DIV_COUNT`, {
      type: QueryTypes.SELECT,
      transaction,
    });

    await sequelize.query(`CALL PROC_PO_COST_CENTRE(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const PO_COST_CENTREdata = await sequelize.query(`
      SELECT *
      FROM GT_PO_COST_CENTRE
       `, {
      type: QueryTypes.SELECT,
      transaction,
    });

    await sequelize.query(`CALL PROC_PR_SERVICE_TYPE_COUNT(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const VW_DB_PRSERVICE_TYPEdata = await sequelize.query(`SELECT * FROM GT_PR_SERVICE_TYPE_COUNT`, {
      type: QueryTypes.SELECT,
      transaction,
    });

    await sequelize.query(`CALL PROC_PO_SERVICE_TYPE_COUNT(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const VW_DB_POSERVICE_TYPEdata = await sequelize.query(`SELECT * FROM GT_PO_SERVICE_TYPE_COUNT`, {
      type: QueryTypes.SELECT,
      transaction,
    });
// 1. Drop the temporary table if it exists
await sequelize.query(`
  DROP TEMPORARY TABLE IF EXISTS GT_PR_STATUS;
`, {
  type: QueryTypes.RAW,
  transaction // optional
});

// 2. Create the temporary table
await sequelize.query(`
  CREATE TEMPORARY TABLE GT_PR_STATUS AS 
  SELECT  
      STATUS,
      COUNT(DISTINCT REQUEST_NUMBER) AS PR_STATUS
  FROM 
      VW_BO_PR_REGISTER
  WHERE 
      request_date_format BETWEEN (CURRENT_DATE - INTERVAL 365 DAY) AND CURRENT_DATE
      AND PROJECT_CODE IN (
          SELECT PROJECT_CODE 
          FROM MS_PROJECT_USER_ASSIGN 
          WHERE USER_ID = ?
      ) AND PROJECT_CODE NOT LIKE '%TST%'
  GROUP BY 
      STATUS;
`, {
  replacements: [user], // Replace with your actual variable
  type: QueryTypes.RAW,
  transaction
});
   
    const PR_STATUS_COUNTdata = await sequelize.query(`SELECT * FROM GT_PR_STATUS`, {
      type: QueryTypes.SELECT,
      transaction,
    });

  // 1. Drop the temporary table if it exists
await sequelize.query(`
  DROP TEMPORARY TABLE IF EXISTS GT_PO_STATUS;
`, {
  type: QueryTypes.RAW,
  transaction
});

// 2. Create the temporary table using JOIN and DOC_DATE filter
await sequelize.query(`
  CREATE TEMPORARY TABLE GT_PO_STATUS AS 
  SELECT  
      V.STATUS,
      COUNT(DISTINCT V.REF_DOC_NO) AS PO_STATUS
  FROM 
      VW_BO_PO_REGISTER_JASRA V
  JOIN 
      MS_PROJECT_USER_ASSIGN PUA 
      ON V.PROJECT_CODE = PUA.PROJECT_CODE
  WHERE 
      V.DOC_DATE BETWEEN ? AND ?
      AND PUA.USER_ID = ? AND V.PROJECT_CODE NOT LIKE '%TST%'
  GROUP BY 
      V.STATUS;
`, {
  replacements: [formattedFromDate, formattedToDate, user],
  type: QueryTypes.RAW,
  transaction
});

// 3. Fetch the data from GT_PO_STATUS
const PO_STATUS_COUNTdata = await sequelize.query(`SELECT * FROM GT_PO_STATUS`, {
  type: QueryTypes.SELECT,
  transaction,
});



    await sequelize.query(`CALL PROC_PR_SERVICE_RM_FLAG(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const PR_SERVICE_RMdata = await sequelize.query(`SELECT * FROM GT_PR_SERVICE_RM_FLAG`, {
      type: QueryTypes.SELECT,
      transaction,
    });

    await sequelize.query(`CALL PROC_PO_SERVICE_RM_FLAG(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const PO_SERVICE_RMdata = await sequelize.query(`SELECT * FROM GT_PO_SERVICE_RM_FLAG`, {
      type: QueryTypes.SELECT,
      transaction,
    });

    await sequelize.query(`CALL PROC_CREATE_DASHBOARD_SUMMARY(?, ?, ?, ?)`, {
      replacements: [parsedLevel, user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const [Dashboardbasicdata] = await sequelize.query(`SELECT * FROM GT_DASH_BOARD`, {
      type: QueryTypes.SELECT,
      transaction,
    });

    const VW_MONTHWISE_POdata = await sequelize.query(`
      SELECT PO_YEAR, PO_MONTH, SUM(PO_AMOUNT) AS PO_AMOUNT
      FROM VW_MONTHWISE_PO
      GROUP BY PO_YEAR, PO_MONTH
    `, {
      type: QueryTypes.SELECT,
      transaction,
    });

    await transaction.commit(); // All good

    res.status(200).json({
      success: true,
      data: {
        Dashboardbasicdata,
        VW_DB_PO_DIV_COUNTdata,
        PO_COST_CENTREdata,
        VW_DB_POSERVICE_TYPEdata,
        VW_MONTHWISE_POdata,
        VW_DB_PR_DIV_COUNTdata,
        VW_DB_PRSERVICE_TYPEdata,
        PR_STATUS_COUNTdata,
        PO_STATUS_COUNTdata,
        PR_SERVICE_RMdata,
        PO_SERVICE_RMdata,
      },
    });
  } catch (error: any) {
    await transaction.rollback();
    console.error("Error fetching dashboard data:", error);
    next(error);
  }
};

/**
 * Calls MySQL procedure PROC_CREATE_GT_EXPENSE_ADJ
 * and returns GT_EXPENSE_ADJ data as JSON.
 */
export const handleGenerateExpenseAdj = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { company_code, request_number } = req.body;

    // Validate inputs
    if (!company_code || !request_number) {
      res.status(400).json({ error: "company_code and request_number are required." });
      return;
    }

    console.log("Calling PROC_CREATE_GT_EXPENSE_ADJ with:", {
      company_code,
      request_number,
    });

    // ✅ Execute the stored procedure
    const [results] = await sequelize.query(
      `CALL PROC_CREATE_GT_EXPENSE_ADJ(:company_code, :request_number);`,
      {
        replacements: { company_code, request_number },
        type: QueryTypes.RAW,
      }
    );

    // ✅ Return the results to frontend
    res.status(200).json({
      success: true,
      message: "GT_EXPENSE_ADJ generated successfully.",
      data: results,
    });
  } catch (error: any) {
    console.error("Error in handleGenerateExpenseAdj:", error);

    res.status(500).json({
      success: false,
      message: "Error while generating GT_EXPENSE_ADJ.",
      error: error.message,
    });
  }
};





export const handleSaveExpSamt = async (req: Request, res: Response): Promise<void> => {
  const { company_code, request_number, expense_data } = req.body;

  if (!company_code || !request_number || !Array.isArray(expense_data) || expense_data.length === 0) {
    res.status(400).json({ success: false, message: "company_code, request_number, and expense_data are required." });
    return;
  }

  const transaction = await sequelize.transaction();

  try {
    // 1️⃣ Delete existing rows
    await sequelize.query(
      `DELETE FROM GT_EXPENSE_ADJ `,
      {
        replacements: { company_code, request_number },
        transaction,
        type: QueryTypes.DELETE,
      }
    );

    // 2️⃣ Insert multiple rows from frontend
   for (const row of expense_data) {
  // ✅ Convert "June 2025" → "2025-06-01"
  const parsedDate = new Date(`${row.REQUEST_DATE} 1`); // Add day 1
  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const firstDay = `${year}-${month}-01`; // ✅ always first day

  await sequelize.query(
    `INSERT INTO GT_EXPENSE_ADJ 
      (REQUEST_DATE, NEW_ADJ_AMOUNT)
     VALUES
      (:request_date, :new_adj_amount)`,
    {
      replacements: {
        request_date: firstDay,
        new_adj_amount: row.NEW_ADJ_AMOUNT,
      },
      transaction,
      type: QueryTypes.INSERT,
    }
  );
}



    // 3️⃣ Call procedure to process PURCHASE_REQUEST_DETAILS_AMC
    await sequelize.query(
      `CALL PROC_ADJAMT_PURCHASE_REQUEST_DETAILS_AMC(:company_code, :request_number)`,
      {
        replacements: { company_code, request_number },
        transaction,
        type: QueryTypes.RAW,
      }
    );

    // 4️⃣ Commit transaction
    await transaction.commit();

    res.status(200).json({
      success: true,
      message: "GT_EXPENSE_ADJ processed and PROC_ADJAMT_PURCHASE_REQUEST_DETAILS_AMC executed successfully.",
    });
  } catch (error: any) {
    console.error("Error in handleSaveExpSamt:", error);
    await transaction.rollback();
    res.status(500).json({
      success: false,
      message: "Error while processing GT_EXPENSE_ADJ",
      error: error.message,
    });
  }
};


