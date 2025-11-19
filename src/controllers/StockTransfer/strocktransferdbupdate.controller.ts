import { Request, Response } from "express";
import { oracleDb } from "../../database/connection";
import {
  IStnRequest,
  IStnDetailRequest,
} from "./stocktransfer.interface";

// Upsert TS_STN (Header)
async function upsertTSSTN(
  data: IStnRequest,
  connection: any
): Promise<number> {
  if (!connection) throw new Error('Connection is required');

  const isUpdate = !!data.stn_no;

  if (!isUpdate) {
    const insertQuery = `
      INSERT INTO TS_STN (
        PRIN_CODE, DESCRIPTION, STN_DATE,
        ALLOCATED, ALLOCATED_DATE, CONFIRMED, CONFIRMED_DATE,
        USER_ID, USER_DT, COMPANY_CODE, REPLENISH_NO, REPLENISH_DATE,
        REMARKS, OUT_JOB_NO, COUNT_NO, CANCEL
      ) VALUES (:prin_code, :description, :stn_date, :allocated, :allocated_date, 
                :confirmed, :confirmed_date, :user_id, CURRENT_TIMESTAMP, 
                :company_code, :replenish_no, :replenish_date, :remarks, 
                :out_job_no, :count_no, :cancel)
    `;

    const bindParams = {
      prin_code: data.prin_code ?? '',
      description: data.description ?? '',
      stn_date: data.stn_date ?? null,
      allocated: data.allocated ?? 'N',
      allocated_date: data.allocated_date ?? null,
      confirmed: data.confirmed ?? 'N',
      confirmed_date: data.confirmed_date ?? null,
      user_id: data.updated_by ?? 'system',
      company_code: data.company_code ?? '',
      replenish_no: data.replenish_no ?? null,
      replenish_date: data.replenish_date ?? null,
      remarks: data.remarks ?? '',
      out_job_no: data.out_job_no ?? '',
      count_no: data.count_no ?? '',
      cancel: data.cancel ?? 'N',
    };

    await oracleDb.query(insertQuery, bindParams, connection);

    // For Oracle, we need to get the sequence value or use RETURNING clause
    // Assuming STN_NO is from a sequence, let's fetch the latest inserted record
    const result = await oracleDb.query(
      `
        SELECT STN_NO FROM TS_STN
        WHERE COMPANY_CODE = :company_code AND PRIN_CODE = :prin_code
        ORDER BY USER_DT DESC FETCH FIRST 1 ROWS ONLY
      `,
      {
        company_code: data.company_code ?? '',
        prin_code: data.prin_code ?? ''
      },
      connection
    );

    if (!result.rows?.length) {
      throw new Error("Failed to fetch generated STN_NO");
    }

    return result.rows[0].STN_NO;
  } else {
    const updateQuery = `
      UPDATE TS_STN SET
        DESCRIPTION = :description, 
        STN_DATE = :stn_date,
        ALLOCATED = :allocated, 
        ALLOCATED_DATE = :allocated_date,
        CONFIRMED = :confirmed, 
        CONFIRMED_DATE = :confirmed_date,
        USER_ID = :user_id, 
        USER_DT = CURRENT_TIMESTAMP,
        REPLENISH_NO = :replenish_no, 
        REPLENISH_DATE = :replenish_date,
        REMARKS = :remarks, 
        OUT_JOB_NO = :out_job_no, 
        COUNT_NO = :count_no, 
        CANCEL = :cancel
      WHERE STN_NO = :stn_no AND COMPANY_CODE = :company_code
    `;

    const bindParams = {
      description: data.description ?? '',
      stn_date: data.stn_date ?? null,
      allocated: data.allocated ?? 'N',
      allocated_date: data.allocated_date ?? null,
      confirmed: data.confirmed ?? 'N',
      confirmed_date: data.confirmed_date ?? null,
      user_id: data.updated_by ?? 'system',
      replenish_no: data.replenish_no ?? null,
      replenish_date: data.replenish_date ?? null,
      remarks: data.remarks ?? '',
      out_job_no: data.out_job_no ?? '',
      count_no: data.count_no ?? '',
      cancel: data.cancel ?? 'N',
      stn_no: data.stn_no ?? 0,
      company_code: data.company_code ?? '',
    };

    await oracleDb.query(updateQuery, bindParams, connection);

    return data.stn_no!;
  }
}

// Upsert TS_STNDETAIL (Details)
async function upsertTSSTNDetails(
  items: IStnDetailRequest[],
  companyCode: string,
  stnNumber: number,
  connection: any
) {
  if (!Array.isArray(items) || items.length === 0) return;

  // Delete old details
  await oracleDb.query(
    `DELETE FROM TS_STNDETAIL WHERE STN_NO = :stn_no AND COMPANY_CODE = :company_code`,
    {
      stn_no: stnNumber,
      company_code: companyCode
    },
    connection
  );

  // Insert new details
  for (const item of items) {
    const insertQuery = `
      INSERT INTO TS_STNDETAIL (
        STN_NO, PRIN_CODE, SEQ_NUMBER, PROD_CODE, JOB_NO,
        CONTAINER_NO, DOC_REF, FROM_SITE, TO_SITE,
        FROM_LOC_START, FROM_LOC_END, TO_LOC_START, TO_LOC_END,
        QTY_PUOM, QTY_LUOM, P_UOM, L_UOM,
        COMPANY_CODE
      ) VALUES (
        :stn_no, :prin_code, :seq_number, :prod_code, :job_no,
        :container_no, :doc_ref, :from_site, :to_site,
        :from_loc_start, :from_loc_end, :to_loc_start, :to_loc_end,
        :qty_puom, :qty_luom, :p_uom, :l_uom, :company_code
      )
    `;

    const bindParams = {
      stn_no: stnNumber,
      prin_code: item.prin_code,
      seq_number: item.seq_number,
      prod_code: item.prod_code,
      job_no: item.job_no,
      container_no: item.container_no,
      doc_ref: item.doc_ref,
      from_site: item.from_site,
      to_site: item.to_site,
      from_loc_start: item.from_loc_start,
      from_loc_end: item.from_loc_end,
      to_loc_start: item.to_loc_start,
      to_loc_end: item.to_loc_end,
      qty_puom: item.qty_puom,
      qty_luom: item.qty_luom,
      p_uom: item.p_uom,
      l_uom: item.l_uom,
      company_code: companyCode,
    };

    await oracleDb.query(insertQuery, bindParams, connection);
  }
}

// Controller
export const createOrUpdateTSSTNSequential = async (
  req: Request,
  res: Response
) => {
  const data: IStnRequest = req.body;
  let connection: any = undefined;

  try {
    // Use transaction helper from your oracleDb
    const result = await oracleDb.withTransaction(async (conn: any) => {
      connection = conn;
      
      const stnNumber = await upsertTSSTN(data, connection);

      await upsertTSSTNDetails(
        data.items || [],
        data.company_code || '',
        stnNumber,
        connection
      );

      return { stnNumber };
    });

    res.status(200).json({
      success: true,
      message: "TS_STN and TS_STNDETAIL successfully upserted",
      stnNumber: result.stnNumber,
    });
  } catch (error) {
    console.error("TS_STN upsert error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upsert TS_STN data",
      error: error instanceof Error ? error.message : error,
    });
  }
};