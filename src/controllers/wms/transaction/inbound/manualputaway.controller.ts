import { sequelize } from "../../../../../src/database/connection";
import { QueryTypes, Transaction } from "sequelize";
import { TPutawaymanual } from "../../../../../src/interfaces/wms/transaction/inbound/manualputaway.interface";
import { Request, Response } from "express";
import constants from "../../../..//helpers/constants";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * Utility: Convert JS Date or dd-mm-yyyy string to MySQL yyyy-mm-dd
 */
function toMySQLDate(dateInput?: string | Date | null): string | null {
  if (!dateInput) return null;
  if (dateInput instanceof Date) {
    const year = dateInput.getFullYear();
    const month = String(dateInput.getMonth() + 1).padStart(2, "0");
    const day = String(dateInput.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const parts = dateInput.split("-");
  if (parts.length !== 3) return null;
  if (parts[0].length === 4) return dateInput; // already yyyy-mm-dd
  const [day, month, year] = parts;
  return `${year}-${month}-${day}`;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOnDeadlock<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && error.original?.code === "ER_LOCK_DEADLOCK") {
      console.warn("Deadlock detected. Retrying...");
      await sleep(RETRY_DELAY);
      return retryOnDeadlock(operation, retries - 1);
    }
    throw error;
  }
}

/**
 * Upsert logic for TT_BATCH
 */
export async function upsertPutawaymanual(
  data: TPutawaymanual
): Promise<string> {
  return retryOnDeadlock(async () => {
    let transaction: Transaction | undefined;
    const transactionState = { committed: false, rolledBack: false };

    try {
      transaction = await sequelize.transaction();

      const exists = await recordExists(
        data.COMPANY_CODE,
        data.PRIN_CODE,
        data.JOB_NO,
        data.TXN_TYPE,
        data.KEY_NUMBER ?? "",
        transaction
      );

      if (exists) {
        await updatePutawaymanual(data, transaction);
      } else {
        await insertPutawaymanual(data, transaction);
      }

      await transaction.commit();
      transactionState.committed = true;

      return data.JOB_NO;
    } catch (error) {
      if (
        transaction &&
        !transactionState.committed &&
        !transactionState.rolledBack
      ) {
        try {
          await transaction.rollback();
          transactionState.rolledBack = true;
        } catch (rollbackError) {
          console.error("Error during rollback:", rollbackError);
        }
      }
      throw error;
    }
  });
}

/**
 * Check if record exists
 */
async function recordExists(
  companyCode: string,
  prinCode: string,
  jobNo: string,
  txnType: string,
  keyNumber: string,
  transaction: Transaction
): Promise<boolean> {
  const result: any = await sequelize.query(
    `SELECT 1 
       FROM TT_BATCH 
      WHERE COMPANY_CODE = ? 
        AND PRIN_CODE = ? 
        AND JOB_NO = ? 
        AND TXN_TYPE = ?
        AND KEY_NUMBER = ?
      LIMIT 1`,
    {
      replacements: [companyCode, prinCode, jobNo, txnType, keyNumber],
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  return result.length > 0;
}

/**
 * Update TT_BATCH
 */
async function updatePutawaymanual(
  data: TPutawaymanual,
  transaction: Transaction
) {
  const sql = `
  UPDATE TT_BATCH SET
    TXN_DATE = ?, KEY_NUMBER = ?, PROD_CODE = ?, SITE_CODE = ?, LOCATION_CODE = ?, QUANTITY = ?,
    QTY_PUOM = ?, QTY_LUOM = ?, P_UOM = ?, L_UOM = ?, QTY_CONFIRMED = ?, PQTY_CONFIRMED = ?,
    LQTY_CONFIRMED = ?, PUOM_CONFIRMED = ?, LUOM_CONFIRMED = ?, UPPP = ?, PACK_KEY = ?, UPP = ?,
    CONFIRM_DATE = ?, CUST_CODE = ?, ORDER_NO = ?, ORDER_SRNO = ?, VESSEL_NAME = ?, CONTAINER_NO = ?,
    SEAL_NO = ?, PO_NO = ?, BL_NO = ?, DOC_REF = ?, LOT_NO = ?, PALLET_ID = ?, PALLET_SERIAL_NO = ?,
    MANU_CODE = ?, MFG_DATE = ?, EXP_DATE = ?, CURR_CODE = ?, EX_RATE = ?, UNIT_PRICE = ?,
    SELECTED = ?, ALLOCATED = ?, CONFIRMED = ?, USER_ID = ?, USER_DT = ?, APPLIED_KEYNO = ?,
    RECEIPT_TYPE = ?, RECEIPT_DATE = ?, CONTAINER_SIZE = ?, MOC1 = ?, MOC2 = ?,
    ORIGIN_COUNTRY = ?, SHELF_LIFE_DAYS = ?, SHELF_LIFE_DATE = ?, TASK_ORDER = ?, PROD_ATTRIB_CODE = ?,
    PROD_GRADE1 = ?, PROD_GRADE2 = ?, TX_IDENTITY_NUMBER = ?, ASSIGNED_PDA_USER = ?, PDA_VERIFIED = ?,
    SUPP_CODE = ?, PUTAWAY_DT = ?, MASTER_CTN = ?, LOOSE_CTN = ?, HS_CODE = ?, NET_WT = ?, NET_VOLUME = ?,
    LC_PO_VALUE = ?, GROSS_WT = ?, DA_NO = ?, BATCH_NO = ?, EDIT_USER = ?, CARTON_NO = ?,
    updated_at = NOW(), updated_by = ?
  WHERE COMPANY_CODE = ? AND PRIN_CODE = ? AND JOB_NO = ? AND TXN_TYPE = ? AND KEY_NUMBER = ?;
`;

const params = [
  toMySQLDate(data.TXN_DATE),
  data.KEY_NUMBER ?? null,
  data.PROD_CODE,
  data.SITE_CODE,
  data.LOCATION_CODE ?? null,
  data.QUANTITY,
  data.QTY_PUOM,
  data.QTY_LUOM,
  data.P_UOM,
  data.L_UOM ?? null,
  data.QTY_CONFIRMED ?? null,
  data.PQTY_CONFIRMED ?? null,
  data.LQTY_CONFIRMED ?? null,
  data.PUOM_CONFIRMED ?? null,
  data.LUOM_CONFIRMED ?? null,
  data.UPPP ?? null,
  data.PACK_KEY ?? null,
  data.UPP ?? null,
  toMySQLDate(data.CONFIRM_DATE),
  data.CUST_CODE ?? null,
  data.ORDER_NO ?? null,
  data.ORDER_SRNO ?? null,
  data.VESSEL_NAME ?? null,
  data.CONTAINER_NO ?? null,
  data.SEAL_NO ?? null,
  data.PO_NO ?? null,
  data.BL_NO ?? null,
  data.DOC_REF ?? null,
  data.LOT_NO ?? null,
  data.PALLET_ID ?? null,
  data.PALLET_SERIAL_NO ?? null,
  data.MANU_CODE ?? null,
  toMySQLDate(data.MFG_DATE),
  toMySQLDate(data.EXP_DATE),
  data.CURR_CODE ?? null,
  data.EX_RATE ?? null,
  data.UNIT_PRICE ?? null,
  'N',
  'Y',
  'N',
  data.USER_ID ?? null,
  toMySQLDate(data.USER_DT),
  data.APPLIED_KEYNO ?? null,
  data.RECEIPT_TYPE ?? null,
  toMySQLDate(data.RECEIPT_DATE),
  data.CONTAINER_SIZE ?? null,
  data.MOC1 ?? null,
  data.MOC2 ?? null,
  data.ORIGIN_COUNTRY ?? null,
  data.SHELF_LIFE_DAYS ?? null,
  toMySQLDate(data.SHELF_LIFE_DATE),
  data.TASK_ORDER ?? null,
  data.PROD_ATTRIB_CODE ?? null,
  data.PROD_GRADE1 ?? null,
  data.PROD_GRADE2 ?? null,
  data.TX_IDENTITY_NUMBER ?? null,
  data.ASSIGNED_PDA_USER ?? null,
  data.PDA_VERIFIED ?? null,
  data.SUPP_CODE ?? null,
  toMySQLDate(data.PUTAWAY_DT),
  data.MASTER_CTN ?? null,
  data.LOOSE_CTN ?? null,
  data.HS_CODE ?? null,
  data.NET_WT ?? null,
  data.NET_VOLUME ?? null,
  data.LC_PO_VALUE ?? null,
  data.GROSS_WT ?? null,
  data.DA_NO ?? null,
  data.BATCH_NO ?? null,
  data.EDIT_USER ?? null,
  data.CARTON_NO ?? null,
  data.updated_by ?? null,
  // WHERE
  data.COMPANY_CODE,
  data.PRIN_CODE,
  data.JOB_NO,
  data.TXN_TYPE,
  data.KEY_NUMBER ?? null
];


  await sequelize.query(sql, { replacements: params, transaction });
}

/**
 * Insert TT_BATCH
 */
async function insertPutawaymanual(
  data: TPutawaymanual,
  transaction: Transaction
) {
const sql = `
INSERT INTO TT_BATCH (
  COMPANY_CODE, PRIN_CODE, JOB_NO, TXN_TYPE, TXN_DATE, KEY_NUMBER, PROD_CODE, SITE_CODE, LOCATION_CODE,
  QUANTITY, QTY_PUOM, QTY_LUOM, P_UOM, L_UOM, QTY_CONFIRMED, PQTY_CONFIRMED, LQTY_CONFIRMED, PUOM_CONFIRMED, LUOM_CONFIRMED,
  UPPP, PACK_KEY, UPP, CONFIRM_DATE, CUST_CODE, ORDER_NO, ORDER_SRNO, VESSEL_NAME, CONTAINER_NO, SEAL_NO,
  PO_NO, BL_NO, DOC_REF, LOT_NO, PALLET_ID, PALLET_SERIAL_NO, MANU_CODE, MFG_DATE, EXP_DATE, CURR_CODE,
  EX_RATE, UNIT_PRICE, SELECTED, ALLOCATED, CONFIRMED, IDENTITY_NUMBER, USER_ID, USER_DT, APPLIED_KEYNO,
  RECEIPT_TYPE, RECEIPT_DATE, CONTAINER_SIZE, MOC1, MOC2, ORIGIN_COUNTRY, SHELF_LIFE_DAYS, SHELF_LIFE_DATE,
  TASK_ORDER, PROD_ATTRIB_CODE, PROD_GRADE1, PROD_GRADE2, TX_IDENTITY_NUMBER, ASSIGNED_PDA_USER, PDA_VERIFIED,
  SUPP_CODE, PUTAWAY_DT, MASTER_CTN, LOOSE_CTN, HS_CODE, NET_WT, NET_VOLUME, LC_PO_VALUE, GROSS_WT, DA_NO,
  BATCH_NO, EDIT_USER, CARTON_NO, created_by, updated_by, created_at, updated_at
) VALUES (
  ${Array(80).fill("?").join(", ")}
);
`;

const params = [
  data.COMPANY_CODE,
  data.PRIN_CODE,
  data.JOB_NO,
  'IMP',
  toMySQLDate(data.TXN_DATE),
  data.KEY_NUMBER ?? null,
  data.PROD_CODE,
  data.SITE_CODE,
  data.LOCATION_CODE ?? null,
  data.QUANTITY,
  data.QTY_PUOM,
  data.QTY_LUOM,
  data.P_UOM,
  data.L_UOM ?? null,
  data.QTY_CONFIRMED ?? null,
  data.PQTY_CONFIRMED ?? null,
  data.LQTY_CONFIRMED ?? null,
  data.PUOM_CONFIRMED ?? null,
  data.LUOM_CONFIRMED ?? null,
  data.UPPP ?? null,
  data.PACK_KEY ?? null,
  data.UPP ?? null,
  toMySQLDate(data.CONFIRM_DATE),
  data.CUST_CODE ?? null,
  data.ORDER_NO ?? null,
  data.ORDER_SRNO ?? null,
  data.VESSEL_NAME ?? null,
  data.CONTAINER_NO ?? null,
  data.SEAL_NO ?? null,
  data.PO_NO ?? null,
  data.BL_NO ?? null,
  data.DOC_REF ?? null,
  data.LOT_NO ?? null,
  data.PALLET_ID ?? null,
  data.PALLET_SERIAL_NO ?? null,
  data.MANU_CODE ?? null,
  toMySQLDate(data.MFG_DATE),
  toMySQLDate(data.EXP_DATE),
  data.CURR_CODE ?? null,
  data.EX_RATE ?? null,
  data.UNIT_PRICE ?? null,
  'N',
  'Y',
  'N',
  data.IDENTITY_NUMBER,
  data.USER_ID ?? null,
  toMySQLDate(data.USER_DT),
  data.APPLIED_KEYNO ?? null,
  data.RECEIPT_TYPE ?? null,
  toMySQLDate(data.RECEIPT_DATE),
  data.CONTAINER_SIZE ?? null,
  data.MOC1 ?? null,
  data.MOC2 ?? null,
  data.ORIGIN_COUNTRY ?? null,
  data.SHELF_LIFE_DAYS ?? null,
  toMySQLDate(data.SHELF_LIFE_DATE),
  data.TASK_ORDER ?? null,
  data.PROD_ATTRIB_CODE ?? null,
  data.PROD_GRADE1 ?? null,
  data.PROD_GRADE2 ?? null,
  data.TX_IDENTITY_NUMBER ?? null,
  data.ASSIGNED_PDA_USER ?? null,
  data.PDA_VERIFIED ?? null,
  data.SUPP_CODE ?? null,
  toMySQLDate(data.PUTAWAY_DT),
  data.MASTER_CTN ?? null,
  data.LOOSE_CTN ?? null,
  data.HS_CODE ?? null,
  data.NET_WT ?? null,
  data.NET_VOLUME ?? null,
  data.LC_PO_VALUE ?? null,
  data.GROSS_WT ?? null,
  data.DA_NO ?? null,
  data.BATCH_NO ?? null,
  data.EDIT_USER ?? null,
  data.CARTON_NO ?? null,
  data.created_by ?? null,
  data.updated_by ?? null,
  toMySQLDate(data.created_at) ?? new Date(),
  toMySQLDate(data.updated_at) ?? new Date()
];


  if (params.length !== 80) {
    throw new Error(
      `Params length mismatch: expected 80, got ${params.length}`
    );
  }

  await sequelize.query(sql, { replacements: params, transaction });
}

/**
 * === Express API Handler ===
 */
export const upsertPutawaymanualHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const data: TPutawaymanual = req.body;

    const requiredFields: (keyof TPutawaymanual)[] = [
      "COMPANY_CODE",
      "PRIN_CODE",
      "JOB_NO",
      "TXN_TYPE",
      "PROD_CODE",
      "SITE_CODE",
      "P_UOM",
      "updated_by",
    ];

    const missingFields = requiredFields.filter((field) => !data[field]);
    if (missingFields.length > 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
      return;
    }

    const jobNo = await upsertPutawaymanual(data);
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "TT_BATCH record upserted successfully.",
      job_no: jobNo,
    });
  } catch (error: any) {
    console.error("Upsert TT_BATCH Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to upsert TT_BATCH.",
    });
  }
};
