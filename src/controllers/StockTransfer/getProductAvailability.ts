// controllers/Product/productget.controller.ts
import { Request, Response } from "express";
import { oracleDb } from "../../database/connection";

export const getProductAvailability = async (req: Request, res: Response) => {
  const { company_code, prod_code } = req.query;

  console.log("Received query parameters:", { company_code, prod_code });

  if (!company_code) {
    return res.status(400).json({
      success: false,
      message: "Missing required query parameter: company_code",
    });
  }

  try {
    // Build query dynamically for optional prod_code
    let query = `
      SELECT * 
      FROM VW_PRODUCT_AVL_QTY
      WHERE COMPANY_CODE = :company_code
    `;
    
    const bindParams: any = {
      company_code: company_code
    };

    if (prod_code) {
      query += " AND PROD_CODE = :prod_code";
      bindParams.prod_code = prod_code;
    }

    query += " ORDER BY PROD_CODE";

    // Query from VW_PRODUCT_AVL_QTY using Oracle connection
    const result = await oracleDb.query(query, bindParams);
    
    const productAvailability = result.rows || [];

    if (!productAvailability.length) {
      return res.status(404).json({
        success: false,
        message: "No product data found for the given parameters",
      });
    }

    // ✅ Return the array directly in data so frontend grid can consume it
    res.status(200).json({
      success: true,
      data: productAvailability,
    });
  } catch (error) {
    console.error("Error fetching product data:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching product data",
      error: error instanceof Error ? error.message : error,
    });
  }
};