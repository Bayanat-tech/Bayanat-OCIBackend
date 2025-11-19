// controllers/StockTransfer/stocktransferget.controller.ts

import { Request, Response } from "express";
import { oracleDb } from "../../database/connection"; // Import your oracleDb instance
import { QueryTypes } from "sequelize";

export const getTSSTNWithDetails = async (req: Request, res: Response) => {
  const { stn_no, company_code, prin_code } = req.query;

  console.log("Received query parameters:", { stn_no, company_code, prin_code });

  if (!stn_no || !company_code || !prin_code) {
    return res.status(400).json({
      success: false,
      message: "Missing required query parameters: stn_no, company_code, or prin_code",
    });
  }

  try {
    // Fetch TS_STN Header using your Oracle connection
    const headerResult = await oracleDb.query(
      `SELECT * 
       FROM TS_STN 
       WHERE COMPANY_CODE = :company_code
         AND PRIN_CODE IN ('10001', '10004')
         AND STN_NO = :stn_no
       ORDER BY PRIN_CODE, STN_NO`,
      {
        company_code,
        stn_no
      }
    );

    // Fetch TS_STNDETAIL Items using your Oracle connection
    let detailsResult = { rows: [] };
    if (stn_no) {
      detailsResult = await oracleDb.query(
        `SELECT * 
         FROM TS_STNDETAIL 
         WHERE STN_NO = :stn_no
           AND COMPANY_CODE = :company_code
           AND PRIN_CODE IN ('10001', '10004')`,
        {
          stn_no,
          company_code
        }
      );
    }

    // Oracle results are in result.rows
    const header = headerResult.rows || [];
    const details = detailsResult.rows || [];

    if (!header.length) {
      return res.status(404).json({
        success: false,
        message: "No STN record found for the given parameters",
      });
    }

    // Return header + details
    res.status(200).json({
      success: true,
      data: {
        header,
        details
      },
    });
  } catch (error) {
    console.error("Error fetching TS_STN data:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching TS_STN data",
      error: error instanceof Error ? error.message : error,
    });
  }
};