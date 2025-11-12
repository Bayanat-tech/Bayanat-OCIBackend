import { Request, Response, NextFunction } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../database/connection"; // your oracledb pool
import { IUser } from "../../interfaces/user.interface";

export const getddProjectMaster = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let connection: oracledb.Connection | undefined;
  try {
    const { div_code } = req.query;
    const requestUser = req.user as IUser;

    if (!div_code) {
      res.status(400).json({
        success: false,
        message: "Parameter 'div_code' is required.",
      });
      return;
    }

    connection = await oracleDb.getConnection();

    const result = await connection.execute(
      `
      SELECT project_code, project_name
      FROM MS_PS_PROJECT_MASTER
      WHERE ( div_code = :div_code OR div_code = 'ALL' )
        AND project_code IN (
          SELECT project_code
          FROM MS_PROJECT_USER_ASSIGN
          WHERE user_id = :user_id
        )
      `,
      {
        div_code: { val: div_code, dir: oracledb.BIND_IN, type: oracledb.STRING },
        user_id: { val: requestUser.loginid, dir: oracledb.BIND_IN, type: oracledb.STRING },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error("Error fetching project master data:", error);
    next(error);
  } finally {
    if (connection) {
      try { await connection.close(); } catch (_) {}
    }
  }
};

export const getddProductMaster = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let connection: oracledb.Connection | undefined;
  try {
    const { div_code } = req.query;

    if (!div_code) {
      res.status(400).json({
        success: false,
        message: "Parameter 'div_code' is required.",
      });
      return;
    }

    connection = await oracleDb.getConnection();

    const result = await connection.execute(
      `
      SELECT prod_code, prod_name, upp, uppp, p_uom, l_uom, prin_code
      FROM MS_PRODUCT
      WHERE PRIN_CODE IN (
          SELECT A.prin_code
          FROM MS_PRINCIPAL A
          JOIN MS_DEPARTMENT B ON A.PRIN_DEPT_CODE = B.DEPT_CODE
          JOIN MS_HR_DIVISION C ON B.div_code = C.DIV_CODE
          WHERE C.DIV_CODE = :div_code
      )
      UNION ALL
      SELECT 'NEWITEM' AS prod_code,
             'ITEM NEW' AS prod_name,
             10000 AS upp,
             1 AS uppp,
             'PCS' AS p_uom,
             'BOX' AS l_uom,
             (
               SELECT A.prin_code
               FROM MS_PRINCIPAL A
               JOIN MS_DEPARTMENT B ON A.PRIN_DEPT_CODE = B.DEPT_CODE
               JOIN MS_HR_DIVISION C ON B.div_code = C.DIV_CODE
               WHERE C.DIV_CODE = :div_code
               AND ROWNUM = 1
             ) AS prin_code
      `,
      {
        div_code: { val: div_code, dir: oracledb.BIND_IN, type: oracledb.STRING },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error("Error fetching product data:", error);
    next(error);
  } finally {
    if (connection) {
      try { await connection.close(); } catch (_) {}
    }
  }
};
