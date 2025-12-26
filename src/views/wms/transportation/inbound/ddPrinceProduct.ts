import { Request, Response, NextFunction } from "express";
import { oracleDb } from "../../../../database/connection";

export const getddPrinceProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { company_code, prin_code } = req.query;

    // Temporary hardcoded values
    const company_code_copy = "BSG";
    const prin_code_copy = "10006";

    if (!company_code || !prin_code) {
      res.status(400).json({
        success: false,
        message: "Parameters 'company_code' and 'prin_code' are required.",
      });
      return;
    }

    console.log(
      "Fetching product data:",
      company_code_copy,
      prin_code_copy
    );

    const sql = `
      SELECT *
      FROM VW_PRODUCT_AVL_QTY
      WHERE COMPANY_CODE = :1
        AND PRIN_CODE = :2
        AND ROWNUM <= 5000
    `;

    const productData = await oracleDb.query(sql, [
      company_code_copy,
      prin_code_copy
    ]);

    const data = productData || [];

    res.status(200).json({
      success: true,
      data
    });
  } catch (error: any) {
    console.error("Error fetching product data:", error);
    next(error);
  }
};
