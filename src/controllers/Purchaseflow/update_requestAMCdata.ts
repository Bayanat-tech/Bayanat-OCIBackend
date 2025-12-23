import { Request, Response } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../database/connection";

export interface TAMCdata {
  DESCRIPTION: string;
  REQUEST_NUMBER: string;
  AMC_FROM: Date;
  AMC_TO: Date;
  TYPE_OF_CONTRACT: string;
  COMPANY_CODE: string;
}

export async function upsertAMCDetails(
  req: Request,
  res: Response
): Promise<void> {
  let connection: oracledb.Connection | undefined;

  try {
    const data: TAMCdata = req.body;

    // ✅ Input validation
    if (!data.REQUEST_NUMBER || !data.COMPANY_CODE) {
      res.status(400).json({
        success: false,
        message: "REQUEST_NUMBER and COMPANY_CODE are required",
      });
      return;
    }

    connection = await oracleDb.getConnection();

    // 1️⃣ Check if record exists
    const existsResult = await connection.execute(
      `
      SELECT 1
      FROM PURCHASE_REQUEST_HEADER
      WHERE REQUEST_NUMBER = :requestNumber
        AND COMPANY_CODE = :companyCode
      `,
      {
        requestNumber: data.REQUEST_NUMBER,
        companyCode: data.COMPANY_CODE,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!existsResult.rows || existsResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: `Record not found for REQUEST_NUMBER: ${data.REQUEST_NUMBER}`,
      });
      return;
    }

    // 2️⃣ Update record
    const updateSql = `
      UPDATE PURCHASE_REQUEST_HEADER
      SET AMC_FROM = :amcFrom,
          AMC_TO = :amcTo,
          TYPE_OF_CONTRACT = :typeOfContract,
          DESCRIPTION = :description,
          HISTORY_SERIAL = 0
      WHERE REQUEST_NUMBER = :requestNumber
        AND COMPANY_CODE = :companyCode
    `;

    // const result = await connection.execute(
    //   updateSql,
    //   {
    //     amcFrom: data.AMC_FROM,
    //     amcTo: data.AMC_TO,
    //     typeOfContract: data.TYPE_OF_CONTRACT,
    //     description: data.DESCRIPTION,
    //     requestNumber: data.REQUEST_NUMBER,
    //     companyCode: data.COMPANY_CODE,
    //   },
    //   { autoCommit: true }
    // );

    const result = await connection.execute(
  updateSql,
  {
    amcFrom: {
      val: new Date(`${data.AMC_FROM}T00:00:00`),
      type: oracledb.DATE
    },
    amcTo: {
      val: new Date(`${data.AMC_TO}T00:00:00`),
      type: oracledb.DATE
    },
    typeOfContract: data.TYPE_OF_CONTRACT,
    description: data.DESCRIPTION,
    requestNumber: data.REQUEST_NUMBER,
    companyCode: data.COMPANY_CODE,
  },
  { autoCommit: true }
);

    if (!result.rowsAffected || result.rowsAffected === 0) {
      res.status(500).json({
        success: false,
        message: "Update failed, no rows affected",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "AMC details updated successfully",
      requestNumber: data.REQUEST_NUMBER,
    });
    return;

  } catch (error: any) {
    console.error("Error in upsertAMCDetails:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update AMC details",
      error: error.message || "Internal Server Error",
    });
    return;

  } finally {
    if (connection) {
      try {
        await connection.close();
        console.log("Oracle connection closed");
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
}
