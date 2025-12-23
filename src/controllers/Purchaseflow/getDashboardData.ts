import { Request, Response, NextFunction } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../../src/database/connection";

/**
 * Oracle execute helper
 */
const exec = (
  connection: oracledb.Connection,
  sql: string,
  binds: oracledb.BindParameters = {},
  options: oracledb.ExecuteOptions = {}
) => {
  return connection.execute(sql, binds, {
    autoCommit: false,
    outFormat: oracledb.OUT_FORMAT_OBJECT,
    ...options,
  });
};

export const getDashboardData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let connection: oracledb.Connection | null = null;

  try {
    /* ================= SAFE QUERY PARAM PARSING ================= */
    const levelParam = req.query.level;
    const userParam = req.query.user;
    const fromDateParam = req.query.from_date;
    const toDateParam = req.query.to_date;

    const level =
      typeof levelParam === "string" ? levelParam : undefined;
    const user =
      typeof userParam === "string" ? userParam : undefined;
    const from_date =
      typeof fromDateParam === "string" ? fromDateParam : undefined;
    const to_date =
      typeof toDateParam === "string" ? toDateParam : undefined;

    if (!level || !user || !from_date || !to_date) {
      res.status(400).json({
        success: false,
        message:
          "Parameters 'level', 'user', 'from_date', and 'to_date' are required.",
      });
      return;
    }

    const parsedLevel = Number(level);
    if (Number.isNaN(parsedLevel)) {
      res.status(400).json({
        success: false,
        message: "'level' must be a valid number.",
      });
      return;
    }

    const formattedFromDate = from_date.slice(0, 10);
    const formattedToDate = to_date.slice(0, 10);

    /* ================= ORACLE CONNECTION ================= */
    connection = await oracleDb.getConnection();
    if (!connection) throw new Error("Failed to get Oracle connection");

    /* ================= PR DIV COUNT ================= */
    await exec(
      connection,
      `BEGIN PROC_PR_DIV_COUNT(:user, :fromDate, :toDate); END;`,
      { user, fromDate: formattedFromDate, toDate: formattedToDate }
    );

    const PR_DIV_COUNT = await exec(
      connection,
      `SELECT * FROM GT_PR_DIV_COUNT`
    );

    /* ================= PO DIV COUNT ================= */
    await exec(
      connection,
      `BEGIN PROC_PO_DIV_COUNT(:user, :fromDate, :toDate); END;`,
      { user, fromDate: formattedFromDate, toDate: formattedToDate }
    );

    const PO_DIV_COUNT = await exec(
      connection,
      `SELECT * FROM GT_PO_DIV_COUNT`
    );

    /* ================= PO COST CENTRE ================= */
    await exec(
      connection,
      `BEGIN PROC_PO_COST_CENTRE(:user, :fromDate, :toDate); END;`,
      { user, fromDate: formattedFromDate, toDate: formattedToDate }
    );

    const PO_COST_CENTRE = await exec(
      connection,
      `SELECT * FROM GT_PO_COST_CENTRE`
    );

    /* ================= PR SERVICE TYPE ================= */
    await exec(
      connection,
      `BEGIN PROC_PR_SERVICE_TYPE_COUNT(:user, :fromDate, :toDate); END;`,
      { user, fromDate: formattedFromDate, toDate: formattedToDate }
    );

    const PR_SERVICE_TYPE = await exec(
      connection,
      `SELECT * FROM GT_PR_SERVICE_TYPE_COUNT`
    );

    /* ================= PO SERVICE TYPE ================= */
    await exec(
      connection,
      `BEGIN PROC_PO_SERVICE_TYPE_COUNT(:user, :fromDate, :toDate); END;`,
      { user, fromDate: formattedFromDate, toDate: formattedToDate }
    );

    const PO_SERVICE_TYPE = await exec(
      connection,
      `SELECT * FROM GT_PO_SERVICE_TYPE_COUNT`
    );

    /* ================= PR STATUS ================= */
    await exec(connection, `TRUNCATE TABLE GT_PR_STATUS`);

    await exec(
      connection,
      `
      INSERT INTO GT_PR_STATUS (STATUS, PR_STATUS)
      SELECT
        STATUS,
        COUNT(DISTINCT REQUEST_NUMBER)
      FROM VW_BO_PR_REGISTER
      WHERE request_date_format BETWEEN (SYSDATE - 365) AND SYSDATE
        AND PROJECT_CODE IN (
          SELECT PROJECT_CODE
          FROM MS_PROJECT_USER_ASSIGN
          WHERE USER_ID = :user
        )
        AND PROJECT_CODE NOT LIKE '%TST%'
      GROUP BY STATUS
      `,
      { user }
    );

    const PR_STATUS = await exec(
      connection,
      `SELECT * FROM GT_PR_STATUS`
    );

    /* ================= PO STATUS ================= */
    await exec(connection, `TRUNCATE TABLE GT_PO_STATUS`);

    await exec(
      connection,
      `
      INSERT INTO GT_PO_STATUS (STATUS, PO_STATUS)
      SELECT
        V.STATUS,
        COUNT(DISTINCT V.REF_DOC_NO)
      FROM VW_BO_PO_REGISTER_JASRA V
      JOIN MS_PROJECT_USER_ASSIGN PUA
        ON V.PROJECT_CODE = PUA.PROJECT_CODE
      WHERE V.DOC_DATE BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD')
                            AND TO_DATE(:toDate, 'YYYY-MM-DD')
        AND PUA.USER_ID = :user
        AND V.PROJECT_CODE NOT LIKE '%TST%'
      GROUP BY V.STATUS
      `,
      { fromDate: formattedFromDate, toDate: formattedToDate, user }
    );

    const PO_STATUS = await exec(
      connection,
      `SELECT * FROM GT_PO_STATUS`
    );

    /* ================= SERVICE RM FLAG ================= */
    await exec(
      connection,
      `BEGIN PROC_PR_SERVICE_RM_FLAG(:user, :fromDate, :toDate); END;`,
      { user, fromDate: formattedFromDate, toDate: formattedToDate }
    );

    const PR_SERVICE_RM = await exec(
      connection,
      `SELECT * FROM GT_PR_SERVICE_RM_FLAG`
    );

    await exec(
      connection,
      `BEGIN PROC_PO_SERVICE_RM_FLAG(:user, :fromDate, :toDate); END;`,
      { user, fromDate: formattedFromDate, toDate: formattedToDate }
    );

    const PO_SERVICE_RM = await exec(
      connection,
      `SELECT * FROM GT_PO_SERVICE_RM_FLAG`
    );

    /* ================= DASHBOARD SUMMARY ================= */
    await exec(
      connection,
      `BEGIN PROC_CREATE_DASHBOARD_SUMMARY(:lvl, :user, :fromDate, :toDate); END;`,
      {
        lvl: parsedLevel,
        user,
        fromDate: formattedFromDate,
        toDate: formattedToDate,
      }
    );

    const DASHBOARD = await exec(
      connection,
      `SELECT * FROM GT_DASH_BOARD`
    );

    /* ================= MONTHWISE PO ================= */
    const MONTHWISE_PO = await exec(
      connection,
      `
      SELECT PO_YEAR, PO_MONTH, SUM(PO_AMOUNT) AS PO_AMOUNT
      FROM VW_MONTHWISE_PO
      GROUP BY PO_YEAR, PO_MONTH
      `
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      data: {
        Dashboardbasicdata: DASHBOARD.rows,
        VW_DB_PO_DIV_COUNTdata: PO_DIV_COUNT.rows,
        PO_COST_CENTREdata: PO_COST_CENTRE.rows,
        VW_DB_POSERVICE_TYPEdata: PO_SERVICE_TYPE.rows,
        VW_MONTHWISE_POdata: MONTHWISE_PO.rows,
        VW_DB_PR_DIV_COUNTdata: PR_DIV_COUNT.rows,
        VW_DB_PRSERVICE_TYPEdata: PR_SERVICE_TYPE.rows,
        PR_STATUS_COUNTdata: PR_STATUS.rows,
        PO_STATUS_COUNTdata: PO_STATUS.rows,
        PR_SERVICE_RMdata: PR_SERVICE_RM.rows,
        PO_SERVICE_RMdata: PO_SERVICE_RM.rows,
      },
    });

  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (e) {
        console.error("❌ Rollback failed:", e);
      }
    }

    console.error("❌ Error fetching dashboard data:", error);
    next(error);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error("❌ Connection close failed:", e);
      }
    }
  }
};
