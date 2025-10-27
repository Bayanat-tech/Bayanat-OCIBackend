import { Request, Response } from "express";
import { Transaction, QueryTypes } from "sequelize";
import { sequelize } from "../../../../database/connection";
import constants from "../../../../helpers/constants";

import {IPackDetailEDI } from "../../../../interfaces/wms/transaction/inbound/inboundJobWms.interface";

// === Safe Utilities ===
function safeDate(val: any): Date | null {
  return val ? new Date(val) : null;
}

function safeString(val: any): string {
  return typeof val === "string" ? val : '';
}

function safeNumber(val: any): number {
  return typeof val === "number" ? val : 0;
}



export async function insertPackDetailEDI(data: IPackDetailEDI, transaction: Transaction): Promise<void> {
  if (!transaction) throw new Error("Transaction is required");

  const insertQuery = `
    INSERT INTO TI_PACKDET_EDI (
      USER_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, PACKDET_NO, CONTAINER_NO,
      VESSEL_NAME, VOYAGE_NO, PROD_CODE, P_UOM, QTY_PUOM,
      L_UOM, QTY_LUOM, UNIT_PRICE, CURR_CODE, LOT_NO,
      MFG_DATE, EXP_DATE, MANU_CODE, ORIGIN_COUNTRY,
      FROM_SITE, TO_SITE, LOCATION_FROM, LOCATION_TO,
      BATCH_NO, PO_NO, CREATED_AT, CREATED_BY, UPDATED_AT, UPDATED_BY
    ) VALUES (${Array(30).fill('?').join(', ')})
  `;

  const replacements = [
    data.user_id ?? '',
    data.company_code ?? '',
    data.prin_code ?? null,
    data.job_no ?? null,
    data.packdet_no ?? null,
    data.container_no ?? null,
    data.vessel_name ?? null,
    data.voyage_no ?? null,
    data.product_code ?? null,
    data.puom ?? null,
    safeNumber(data.qty_puom),
    data.luom ?? null,
    safeNumber(data.qty_luom),
    safeNumber(data.unit_price),
    data.curr_code ?? null,
    data.lot_no ?? null,
    safeDate(data.mfg_date),
    safeDate(data.exp_date),
    data.manu_code ?? null,
    data.origin_country ?? null,
    data.from_site ?? null,
    data.to_site ?? null,
    data.location_from ?? null,
    data.location_to ?? null,
    data.batch_no ?? null,
    data.po_no ?? null,
    data.created_at ?? new Date(),
    data.created_by ?? null,
    data.updated_at ?? new Date(),
    data.updated_by ?? null,
  ];

  // Runtime check for undefined
  replacements.forEach((val, index) => {
    if (val === undefined) {
      console.error(`🚫 Replacement at position ${index} is undefined. Field key: ${Object.keys(data)[index]}, value: ${val}`);
      throw new Error(`Replacement at position ${index} is undefined. Field key: ${Object.keys(data)[index]}`);
    }
  });

  console.log('✅ Inserting TI_PACKDET_EDI with values:', replacements);

  await sequelize.query(insertQuery, {
    replacements,
    type: QueryTypes.INSERT,
    transaction,
  });
}

export const upsertPackDetailEDIHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const records: IPackDetailEDI[] = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Request body must be a non-empty array of pack detail EDI records",
      });
      return;
    }

    const requiredFields: (keyof IPackDetailEDI)[] = [
      "job_no",
      "prin_code",
      "company_code",
      "user_id",
    ];

    for (const [index, record] of records.entries()) {
      const missingFields = requiredFields.filter((field) => !record[field]);
      if (missingFields.length > 0) {
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Record at index ${index} is missing required field(s): ${missingFields.join(", ")}`,
        });
        return;
      }
    }

    const user_id = records[0].user_id; // ✅ Extract for DELETE

    await sequelize.transaction(async (transaction) => {
      // 🔁 Run delete ONCE at the start of transaction
      await sequelize.query(
        `DELETE FROM TI_PACKDET_EDI WHERE USER_ID = :user_id`,
        {
          replacements: { user_id },
          transaction,
        }
      );

      // 🔁 Loop through records and insert
      for (const record of records) {
        await insertPackDetailEDI(record, transaction);
      }
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Pack detail EDI records inserted successfully",
    });
  } catch (error: any) {
    console.error("Insert TI_PACKDET_EDI Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to insert TI_PACKDET_EDI records",
    });
  }
};







export const copyEDIToPackdetHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const transaction = await sequelize.transaction();
  try {
    console.log("✅ copyEDIToPackdetHandler API called");

    // ✅ Read from body instead of query
    const { login_id, job_no, prin_code ,company_code} = req.body;

   /* if (!login_id || !job_no || !prin_code || company_code) {
      res.status(400).json({
        success: false,
        message: "❌ login_id, job_no, and prin_code are required"
      });
      return;
    }*/

    console.log("🔍 Parameters received:", { login_id, job_no, prin_code ,company_code});

    console.log("📞 Calling stored procedure PRO_COPY_INWARDEDI_TO_PACKDET...");
    await sequelize.query(
      `CALL PRO_COPY_INWARDEDI_TO_PACKDET(:P_loginid, :P_jobno, :P_princode, :P_company_code)`,
      {
        replacements: {
          P_loginid: login_id.toString(),
           P_jobno: job_no.toString(),
          P_princode: prin_code.toString(),
          P_company_code: company_code.toString()  // ✅ keep only one
        },
        transaction
      }
    );

    await transaction.commit();
    console.log("✅ Stored procedure executed and transaction committed.");

    res.status(200).json({
      success: true,
      message: "EDI records copied to TI_PACKDET_EDI successfully"
    });
  } catch (error: unknown) {
    await transaction.rollback();
    console.error("❌ Error in copyEDIToPackdetHandler:", error);

    res.status(500).json({
      success: false,
      message: "An error occurred while copying EDI records",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};


export const getEDIPackdetHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { user_id, company_code, prin_code, job_no } = req.query;

  if (!user_id || !company_code || !prin_code || !job_no) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: 'Missing required parameters: user_id, company_code, prin_code, job_no',
    });
    return;
  }

  try {
    const results = await sequelize.query(
      `
      SELECT *
      FROM TI_PACKDET_EDI
      WHERE user_id = :user_id
        AND company_code = :company_code
        AND prin_code = :prin_code
        AND job_no = :job_no
      `,
      {
        replacements: {
          user_id,
          company_code,
          prin_code,
          job_no,
        },
        type: QueryTypes.SELECT,
      }
    );

    if (!results || results.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'No matching EDI pack detail found',
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    console.error('SQL Error:', error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || 'Failed to fetch EDI pack detail using raw SQL',
    });
  }
};


