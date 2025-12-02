


import { Request, Response, NextFunction } from "express";
import { sequelize } from "../../database/connection";
import { QueryTypes } from "sequelize";
import constants from "../../helpers/constants";
import { IUser } from "../../interfaces/user.interface";
import { ISearch, RequestWithUser } from "../../interfaces/common.interface";

export const getddProjectMaster = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
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

    const projectData = await sequelize.query(
      `
      SELECT project_code, project_name 
      FROM MS_PS_PROJECT_MASTER 
      WHERE ( div_code = :div_code or div_code = 'ALL')
        AND project_code IN (
          SELECT project_code 
          FROM MS_PROJECT_USER_ASSIGN 
          WHERE user_id = :user_id
        )
      `,
      {
        replacements: {
          div_code,
          user_id: requestUser.loginid,
        },
        type: QueryTypes.SELECT,
      }
    );

    res.status(200).json({
      success: true,
      data: projectData,
    });
  } catch (error: any) {
    console.error("Error fetching project master data:", error);
    next(error);
  }
};

export const getddProductMaster  = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { div_code } = req.query;
 
    if (!div_code) {
      res.status(400).json({
        success: false,
        message: "Parameter 'div_code' is required.",
      });
      return;
    }
 
    const productData = await sequelize.query(
      `
      SELECT
    prod_code,
    prod_name,
    upp,
    uppp,
    p_uom,
    l_uom,
    prin_code
FROM MS_PRODUCT
WHERE PRIN_CODE IN (
    SELECT A.prin_code
    FROM MS_PRINCIPAL A
    JOIN MS_DEPARTMENT B ON A.PRIN_DEPT_CODE = B.DEPT_CODE
    JOIN MS_HR_DIVISION C ON B.div_code = C.DIV_CODE
    WHERE C.DIV_CODE = :div_code
)
 
UNION
 
SELECT
    'NEWITEM' AS prod_code,
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
        LIMIT 1
    ) AS prin_code limit 0,5000
      `,
      {
        replacements: { div_code },
        type: QueryTypes.SELECT,
      }
    );
 
    res.status(200).json({
      success: true,
      data: productData,
    });
  } catch (error: any) {
    console.error('Error fetching product data:', error);
    next(error);
  }
};