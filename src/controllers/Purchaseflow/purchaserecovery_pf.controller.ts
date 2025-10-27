import { Request, Response } from 'express';
import { QueryTypes, Transaction } from 'sequelize';
import constants1 from "../../helpers/constants";
import { sequelize } from "../../database/connection";

// Interface for PurchaseRequestHeader type
interface PurchaseRequestHeader {
  recovery_party_code: string;
  recovery_date: Date;
  recovery_remark: string;
  recovery_confirm: string;
  updated_by: string;
  recovery_amount: number;
  type_of_pr: string;
  company_code?: string;
  request_number?: string;
}

// Main Express route handler
export const UpdPurchaseRecoveryData = async (
  req: Request,
  res: Response
): Promise<void> => {
  const values: PurchaseRequestHeader[] = req.body;

  console.log("Inside handleUpdatePurchaseRecoveryData", values);

  if (!Array.isArray(values) || values.length === 0) {
    res.status(400).json({ success: false, message: "Invalid input data. Array expected." });
    return;
  }

  const firstRecord = values[0];
  if (!firstRecord) {
    res.status(400).json({ error: "No data found" });
    return;
  }

  const { company_code, type_of_pr } = firstRecord;

  if (!company_code || !type_of_pr) {
    res.status(400).json({ success: false, message: "Missing required fields (company_code, type_of_pr)." });
    return;
  }

  const transaction: Transaction = await sequelize.transaction();

  try {
    const updatedRecords = await Promise.all(
      values.map((record: PurchaseRequestHeader) =>
        updatePurchaseRecoveryData(record, transaction)
      )
    );

    await transaction.commit();

    res.status(constants1.STATUS_CODES.OK).json({
      success: true,
      message: constants1.MESSAGES.UPDATED_SUCCESSFULLY,
      updatedRecords,
    });
  } catch (error) {
    console.error("Update error:", error);
    await transaction.rollback();

    res.status(constants1.STATUS_CODES.NOT_FOUND).json({
      success: false,
      message: "Update unsuccessful.",
    });
  }
};

// Function to update a single PurchaseRecoveryData record
const updatePurchaseRecoveryData = async (
  record: PurchaseRequestHeader,
  transaction: Transaction
): Promise<{ company_code?: string; request_number?: string; updatedFields: string[] }> => {
  const {
    company_code,
    request_number,
    recovery_date,
    recovery_party_code,
    recovery_remark,
    recovery_confirm,
    updated_by,
  } = record;

  if (
    !company_code ||
    !request_number ||
    !recovery_date ||
    !recovery_party_code ||
    !recovery_remark ||
    !recovery_confirm ||
    !updated_by
  ) {
    throw new Error(`Missing fields in record: ${JSON.stringify(record)}`);
  }

  const existingRecord = await getExistingRecord(company_code, request_number, transaction);

  let isChanged = false;
  const updatedFields: string[] = [];

  const fieldsToCheck: (keyof PurchaseRequestHeader)[] = [
    'recovery_date',
    'recovery_party_code',
    'recovery_remark',
    'recovery_confirm',
    'updated_by'
  ];

  fieldsToCheck.forEach((field) => {
    if (existingRecord[field] !== record[field]) {
      isChanged = true;
      updatedFields.push(field);
    }
  });

  if (isChanged) {
    const sql = `
      UPDATE PURCHASE_REQUEST_HEADER
      SET recovery_date = ?, recovery_party_code = ?, recovery_remark = ?, 
          recovery_confirm = ?, updated_by = ?, updated_at = NOW()
      WHERE company_code = ? AND request_number = ?`;

    console.log("Replacements:", [
      recovery_date,
      recovery_party_code,
      recovery_remark,
      recovery_confirm,
      updated_by,
      company_code,
      request_number,
    ]);

    await sequelize.query(sql, {
      replacements: [
        recovery_date,
        recovery_party_code,
        recovery_remark,
        recovery_confirm,
        updated_by,
        company_code,
        request_number,
      ],
      transaction,
      type: QueryTypes.UPDATE,
    });
  }

  return { company_code, request_number, updatedFields };
};

// Function to fetch existing record
const getExistingRecord = (
  company_code: string,
  request_number: string,
  transaction: Transaction
): Promise<PurchaseRequestHeader> => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT recovery_party_code, recovery_date, recovery_remark, recovery_confirm, 
             updated_by
      FROM PURCHASE_REQUEST_HEADER
      WHERE company_code = ? AND request_number = ?`;

    sequelize.query(sql, {
      replacements: [company_code, request_number],
      transaction,
      type: QueryTypes.SELECT,
    })
      .then((results) => {
        const resultArray = results as PurchaseRequestHeader[];

        if (resultArray.length === 0) {
          reject(
            new Error(
              `Record with company_code: ${company_code} and request_number: ${request_number} not found.`
            )
          );
        } else {
          resolve(resultArray[0]);
        }
      })
      .catch(reject);
  });
};
