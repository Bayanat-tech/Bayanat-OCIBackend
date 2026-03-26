/**
 * Service for calculating invoice outstanding balances
 * Supports partial payment tracking using indicator_origin field
 */

import oracledb from "oracledb";
import { IUser } from "../../interfaces/user.interface";

export interface IInvoiceBalance {
  inv_no: string;
  original_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  payment_percentage: number;
}

export const getInvoiceOutstandingBalance = async (
  connection: oracledb.Connection,
  company_code: string,
  inv_no: string,
  div_code: string
): Promise<IInvoiceBalance | null> => {
  try {
    const result = await connection.execute(
      `
      SELECT 
        :inv_no AS inv_no,
        ABS(MAX(CASE WHEN indicator_origin = 'Y' THEN NVL(amount_origin, lcur_amount) ELSE 0 END)) AS original_amount,
        NVL(SUM(CASE WHEN NVL(indicator_origin, 'N') IN ('N', NULL) THEN ABS(lcur_amount) ELSE 0 END), 0) AS paid_amount,
        ABS(MAX(CASE WHEN indicator_origin = 'Y' THEN NVL(amount_origin, lcur_amount) ELSE 0 END)) - 
        NVL(SUM(CASE WHEN NVL(indicator_origin, 'N') IN ('N', NULL) THEN ABS(lcur_amount) ELSE 0 END), 0) AS outstanding_amount
      FROM TR_AC_INVDETAIL
      WHERE company_code = :company_code
        AND inv_no = :inv_no
        AND div_code = :div_code
      `,
      {
        inv_no: inv_no,
        company_code,
        div_code,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as any;
    const original = Number(row.ORIGINAL_AMOUNT) || 0;
    const paid = Number(row.PAID_AMOUNT) || 0;
    const outstanding = Math.max(0, Number(row.OUTSTANDING_AMOUNT) || 0);
    const percentage = original > 0 ? (paid / original) * 100 : 0;

    return {
      inv_no,
      original_amount: original,
      paid_amount: paid,
      outstanding_amount: outstanding,
      payment_percentage: Math.round(percentage * 100) / 100,
    };
  } catch (error) {
    console.error(`Error getting outstanding balance for invoice ${inv_no}:`, error);
    throw error;
  }
};

/**
 * Get outstanding balances for multiple invoices
 */
export const getMultipleInvoiceBalances = async (
  connection: oracledb.Connection,
  company_code: string,
  inv_nos: string[],
  div_code: string
): Promise<IInvoiceBalance[]> => {
  if (!inv_nos || inv_nos.length === 0) {
    return [];
  }

  try {
    const placeholders = inv_nos.map((_, i) => `:inv${i}`).join(',');
    const binds: any = {
      company_code,
      div_code,
    };

    inv_nos.forEach((inv, i) => {
      binds[`inv${i}`] = inv;
    });

    const result = await connection.execute(
      `
      SELECT 
        inv_no,
        ABS(MAX(CASE WHEN indicator_origin = 'Y' THEN NVL(amount_origin, lcur_amount) ELSE 0 END)) AS original_amount,
        NVL(SUM(CASE WHEN NVL(indicator_origin, 'N') IN ('N', NULL) THEN ABS(lcur_amount) ELSE 0 END), 0) AS paid_amount,
        ABS(MAX(CASE WHEN indicator_origin = 'Y' THEN NVL(amount_origin, lcur_amount) ELSE 0 END)) - 
        NVL(SUM(CASE WHEN NVL(indicator_origin, 'N') IN ('N', NULL) THEN ABS(lcur_amount) ELSE 0 END), 0) AS outstanding_amount
      FROM TR_AC_INVDETAIL
      WHERE company_code = :company_code
        AND inv_no IN (${placeholders})
        AND div_code = :div_code
      GROUP BY inv_no
      `,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const balances: IInvoiceBalance[] = [];

    if (result.rows) {
      result.rows.forEach((row: any) => {
        const original = Number(row.ORIGINAL_AMOUNT) || 0;
        const paid = Number(row.PAID_AMOUNT) || 0;
        const outstanding = Math.max(0, Number(row.OUTSTANDING_AMOUNT) || 0);
        const percentage = original > 0 ? (paid / original) * 100 : 0;

        balances.push({
          inv_no: row.INV_NO,
          original_amount: original,
          paid_amount: paid,
          outstanding_amount: outstanding,
          payment_percentage: Math.round(percentage * 100) / 100,
        });
      });
    }

    return balances;
  } catch (error) {
    console.error('Error getting multiple invoice balances:', error);
    throw error;
  }
};

/**
 * Validate if a payment amount is allowed for an invoice
 * Returns validation errors if payment exceeds outstanding
 */
export const validatePartialPaymentAmount = (
  invoiceNo: string,
  paymentAmount: number,
  balance: IInvoiceBalance
): string[] => {
  const errors: string[] = [];

  if (!balance) {
    errors.push(`Invoice ${invoiceNo}: No invoice record found`);
    return errors;
  }

  if (balance.original_amount === 0) {
    errors.push(`Invoice ${invoiceNo}: No outstanding balance (zero original amount)`);
    return errors;
  }

  const outstanding = balance.outstanding_amount || 0;
  
  if (outstanding <= 0) {
    errors.push(`Invoice ${invoiceNo}: Already fully paid`);
    return errors;
  }

  // Allow small epsilon for rounding (0.01)
  if (paymentAmount - outstanding > 0.01) {
    errors.push(
      `Invoice ${invoiceNo}: Payment amount ${paymentAmount.toFixed(2)} exceeds outstanding balance ${outstanding.toFixed(2)}`
    );
    return errors;
  }

  return errors;
};
