import { Request, Response } from "express";
import { Transaction, QueryTypes } from "sequelize";
import { sequelize } from "../../../../database/connection";
import constants from "../../../../helpers/constants";

import { IEDIOrderDetail } from "../../../../interfaces/wms/transaction/outbound/orderEntryWms.interface";

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

// === Insert Logic for TO_ORDER_EDI ===
export async function insertEDIOrderDetail(data: IEDIOrderDetail, transaction: Transaction): Promise<void> {
  if (!transaction) throw new Error("Transaction is required");

  // Delete existing entries for this user
 /* await sequelize.query(
    `DELETE FROM TO_ORDER_EDI WHERE user_id = ?`,
    {
      replacements: [data.user_id],
      transaction
    }
  );*/

  const insertQuery = `
  INSERT INTO TO_ORDER_EDI (
    user_id, company_code, prin_code, job_no, product_code, site_code, puom, qty1, luom, qty2, lotno,
    location_from, location_to, salesman_code, expiry_date_from, expiry_date_to,
    batch_no, mfg_date_from, mfg_date_to, customer_store_name, order_no,
    cust_code, serial_no, serial_number
  ) VALUES (${Array(24).fill('?').join(', ')})
`;

  const replacements = [
  data.user_id,
  data.company_code || 'JASRA',
  data.prin_code,
  data.job_no,
  data.product_code,
  data.site_code ?? null,
  data.puom ?? null,
  safeNumber(data.qty1),
  data.luom ?? null,
  safeNumber(data.qty2),
  data.lotno ?? null,
  data.location_from ?? null,
  data.location_to ?? null,
  data.salesman_code ?? null,
  safeDate(data.expiry_date_from),
  safeDate(data.expiry_date_to),
  data.batch_no ?? null,
  safeDate(data.mfg_date_from),
  safeDate(data.mfg_date_to),
  data.customer_store_name ?? null,
  data.order_no,
  data.cust_code,
  data.serial_no,
  data.serial_number ?? '-'
];


// Helper function to format dates for MySQL
function formatDateForMySQL(date: string | number | Date) {
    if (!date) return null;
    
    const d = new Date(date);
    // Format as 'YYYY-MM-DD HH:MM:SS' (MySQL compatible)
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Example safeDate function (if you need similar for other date fields)
function safeDate(date: string | number | Date | undefined) {
    if (!date) return null;
    return formatDateForMySQL(date);
}

  await sequelize.query(insertQuery, {
    replacements,
    transaction,
  });
}

// === API Handler ===

export const upsertEDIOrderDetailHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const records: IEDIOrderDetail[] = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Request body must be a non-empty array of EDI order details",
      });
      return;
    }

    // Validate required fields for all records
    const requiredFields: (keyof IEDIOrderDetail)[] = [
      "job_no",
      "prin_code",
      "company_code",
      "product_code",
      "order_no",
      "cust_code",
      "user_id"
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

    await sequelize.transaction(async (transaction) => {
      const userId = records[0].user_id;

      // Delete existing entries for this user once
      await sequelize.query(
        `DELETE FROM TO_ORDER_EDI WHERE user_id = ?`,
        {
          replacements: [userId],
          transaction,
        }
      );

      // Insert all records
      for (const record of records) {
        await insertEDIOrderDetail(record, transaction);
      }
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "EDI Order details inserted successfully",
    });
  } catch (error: any) {
    console.error("Insert EDI Order Detail Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to insert EDI order details",
    });
  }
};


export const getEDIOrderDetailHandler = async (
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
      FROM VW_TO_ORDER_EDI
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
        message: 'No matching EDI order detail found',
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
      message: error.message || 'Failed to fetch EDI order detail using raw SQL',
    });
  }
};

export const copyEDIToOrderDetailHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const transaction = await sequelize.transaction();

  try {
    console.log("✅ copyEDIToOrderDetailHandler API called");

    const { login_id, job_no, prin_code, company_code } = req.body;

    // Validate input
    if (!login_id || !job_no || !prin_code || !company_code) {
      res.status(400).json({
        success: false,
        message: "❌ login_id, job_no, prin_code, and company_code are required"
      });
      return;
    }

    console.log("🔍 Parameters received:", { login_id, job_no, prin_code, company_code });

    // Call the stored procedure
    console.log("📞 Calling stored procedure PRO_COPY_OUTWARDEDI_TO_ORDRD_DET...");
    await sequelize.query(
      `CALL PRO_COPY_OUTWARDEDI_TO_ORDRD_DET(:P_loginid, :P_jobno, :P_princode, :P_company_code)`,
      {
        replacements: {
          P_loginid: login_id.toString(),
          P_jobno: job_no.toString(),
          P_princode: prin_code.toString(),
          P_company_code: company_code.toString(),
        },
        transaction
      }
    );

    await transaction.commit();
    console.log("✅ Stored procedure executed and transaction committed.");

    res.status(200).json({
      success: true,
      message: "EDI records copied to TO_ORDER_DET successfully"
    });
  } catch (error: unknown) {
    await transaction.rollback();
    console.error("❌ Error in copyEDIToOrderDetailHandler:", error);

    res.status(500).json({
      success: false,
      message: "An error occurred while copying EDI records",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};


