import { Request, Response, NextFunction } from "express";
import { sequelize } from "../../database/connection";
import { QueryTypes } from "sequelize";
import constants from "../../helpers/constants";

// Fix the return type issue by setting Promise<void>
// Fix the return type issue by setting Promise<void>
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

    await sequelize.query(`CALL PROC_PR_STATUS(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
    const PR_STATUS_COUNTdata = await sequelize.query(`SELECT * FROM GT_PR_STATUS`, {
      type: QueryTypes.SELECT,
      transaction,
    });

    await sequelize.query(`CALL PROC_PO_STATUS(?, ?, ?)`, {
      replacements: [user, formattedFromDate, formattedToDate],
      type: QueryTypes.RAW,
      transaction,
    });
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
