import { Request, Response, NextFunction } from "express";
import { sequelize } from "../../../../database/connection";

import { QueryTypes } from "sequelize";
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

    const productData = await sequelize.query(
      // `
      // SELECT
      //   prod_code,
      //   prod_name,
      //   upp,
      //   uppp,
      //   p_uom,
      //   l_uom,
      //   prin_code
      // FROM MS_PRODUCT
      // WHERE company_code = :company_code AND prin_code = :prin_code
      // LIMIT 0, 5000
      // `
      `SELECT * FROM VW_PRODUCT_AVL_QTY
      `
      ,
      {
        replacements: { company_code, prin_code },
        type: QueryTypes.SELECT,
      }
    );

    res.status(200).json({
      success: true,
      data: productData,
    });
  } catch (error: any) {
    console.error("Error fetching product data:", error);
    next(error);
  }
};
