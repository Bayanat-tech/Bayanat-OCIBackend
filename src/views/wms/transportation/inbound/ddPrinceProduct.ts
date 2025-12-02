import { Request, Response, NextFunction } from "express";
import { oracleDb } from "../../../../database/connection";
import constants from "../../../../helpers/constants";
import { IUser } from "../../../../interfaces/user.interface"
import { ISearch, RequestWithUser } from "../../../../interfaces/common.interface";

export const getddPrinceProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { company_code, prin_code } = req.query;

    if (!company_code || !prin_code) {
      res.status(400).json({
        success: false,
        message: "Parameters 'company_code' and 'prin_code' are required.",
      });
      return;
    }

    // Option 1: Using MS_PRODUCT table with limit (Oracle syntax)
    // const productData = await oracleDb.query(
    //   `
    //   SELECT
    //     prod_code,
    //     prod_name,
    //     upp,
    //     uppp,
    //     p_uom,
    //     l_uom,
    //     prin_code
    //   FROM MS_PRODUCT
    //   WHERE company_code = :company_code 
    //     AND prin_code = :prin_code
    //     AND ROWNUM <= 5000
    //   `
    //   ,
    //   {
    //     company_code,
    //     prin_code
    //   }
    // );

    // Option 2: Using your view (without filters)
    const productData = await oracleDb.query(
      `SELECT * FROM VW_PRODUCT_AVL_QTY
       WHERE COMPANY_CODE = :company_code 
         AND PRIN_CODE = :prin_code
         AND ROWNUM <= 5000`,
      {
        company_code,
        prin_code
      }
    );

    // Access the rows from Oracle result
    const data = productData.rows || [];

    res.status(200).json({
      success: true,
      data: data,
    });
  } catch (error: any) {
    console.error("Error fetching product data:", error);
    next(error);
  }
};