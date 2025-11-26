import { Request, Response } from "express";
import * as oracledb from "oracledb";
import { IStnDetailRequest, IStnRequest } from "./stocktransfer.interface";
import { oracleDb } from "../../database/connection";

// Upsert TS_STN (Header) - Oracle Version
async function upsertTSSTN(
  data: IStnRequest,
  connection: oracledb.Connection
): Promise<number> {
  if (!connection) throw new Error('Oracle connection is required');

  const isUpdate = !!data.stn_no;

  if (!isUpdate) {
    // Oracle INSERT with RETURNING clause
    const insertQuery = `
      INSERT INTO TS_STN (
        PRIN_CODE, DESCRIPTION, STN_DATE,
        ALLOCATED, ALLOCATED_DATE, CONFIRMED, CONFIRMED_DATE,
        USER_ID, USER_DT, COMPANY_CODE, REPLENISH_NO, REPLENISH_DATE,
        REMARKS, OUT_JOB_NO, COUNT_NO, CANCEL
      ) VALUES (
        :prin_code, :description, :stn_date,
        :allocated, :allocated_date, :confirmed, :confirmed_date,
        :user_id, SYSDATE, :company_code, :replenish_no, :replenish_date,
        :remarks, :out_job_no, :count_no, :cancel
      )
      RETURNING STN_NO INTO :stn_no
    `;

    const bindVars = {
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
      stn_no: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
    };

    // Validate bind variables
    Object.entries(bindVars).forEach(([key, value]) => {
      if (value === undefined) {
        throw new Error(`Bind variable '${key}' contains undefined value`);
      }
    });

    const result = await connection.execute(insertQuery, bindVars, {
      autoCommit: false
    });

       const outBinds = result.outBinds as { stn_no?: number[] };

      if (!outBinds?.stn_no?.[0]) {
      throw new Error("Failed to fetch generated STN_NO");
    }

     return outBinds.stn_no[0];
  } else {
    // Oracle UPDATE
    const updateQuery = `
      UPDATE TS_STN SET
        DESCRIPTION = :description,
        STN_DATE = :stn_date,
        ALLOCATED = :allocated,
        ALLOCATED_DATE = :allocated_date,
        CONFIRMED = :confirmed,
        CONFIRMED_DATE = :confirmed_date,
        USER_ID = :user_id,
        USER_DT = SYSDATE,
        REPLENISH_NO = :replenish_no,
        REPLENISH_DATE = :replenish_date,
        REMARKS = :remarks,
        OUT_JOB_NO = :out_job_no,
        COUNT_NO = :count_no,
        CANCEL = :cancel
      WHERE STN_NO = :stn_no AND COMPANY_CODE = :company_code
    `;

    const updateBindVars = {
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
      company_code: data.company_code ?? ''
    };

    // Validate bind variables
    Object.entries(updateBindVars).forEach(([key, value]) => {
      if (value === undefined) {
        throw new Error(`Update bind variable '${key}' contains undefined value`);
      }
    });

    const result = await connection.execute(updateQuery, updateBindVars, {
      autoCommit: false
    });

    if (result.rowsAffected === 0) {
      throw new Error(`No record found with STN_NO: ${data.stn_no} and COMPANY_CODE: ${data.company_code}`);
    }

    return data.stn_no!;
  }
}

// Upsert TS_STNDETAIL (Details) - Oracle Version
async function upsertTSSTNDetails(
  items: IStnDetailRequest[],
  companyCode: string,
  stnNumber: number,
  connection: oracledb.Connection
): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return;

  // Delete old details
  await connection.execute(
    `DELETE FROM TS_STNDETAIL WHERE STN_NO = :stn_no AND COMPANY_CODE = :company_code`,
    { stn_no: stnNumber, company_code: companyCode },
    { autoCommit: false }
  );

  // Insert new details using batch processing for better performance
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
      :qty_puom, :qty_luom, :p_uom, :l_uom,
      :company_code
    )
  `;

  // Prepare batch bind variables
  const batchBinds = items.map(item => ({
    stn_no: stnNumber,
    prin_code: item.prin_code,
    seq_number: item.seq_number,
    prod_code: item.prod_code,
    job_no: item.job_no ?? null,
    container_no: item.container_no ?? null,
    doc_ref: item.doc_ref ?? null,
    from_site: item.from_site ?? null,
    to_site: item.to_site ?? null,
    from_loc_start: item.from_loc_start ?? null,
    from_loc_end: item.from_loc_end ?? null,
    to_loc_start: item.to_loc_start ?? null,
    to_loc_end: item.to_loc_end ?? null,
    qty_puom: item.qty_puom ?? null,
    qty_luom: item.qty_luom ?? null,
    p_uom: item.p_uom ?? null,
    l_uom: item.l_uom ?? null,
    company_code: companyCode
  }));

  // Execute batch insert
  await connection.executeMany(insertQuery, batchBinds, {
    autoCommit: false,
    batchErrors: true
  });
}

// Main Controller - Oracle Version
export const createOrUpdateTSSTNSequential = async (
  req: Request,
  res: Response
) => {
  const data: IStnRequest = req.body;

  try {
    // Use the withTransaction helper from your oracle connection
    const result = await oracleDb.withTransaction(async (connection) => {
      const stnNumber = await upsertTSSTN(data, connection);
      await upsertTSSTNDetails(data.items, data.company_code!, stnNumber, connection);
      return stnNumber;
    });

    res.status(200).json({
      success: true,
      message: "TS_STN and TS_STNDETAIL successfully upserted",
      stnNumber: result,
    });
  } catch (error) {
    console.error("TS_STN upsert error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upsert TS_STN data",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Alternative using explicit connection management
export const createOrUpdateTSSTNExplicit = async (
  req: Request,
  res: Response
) => {
  const data: IStnRequest = req.body;
  let connection: oracledb.Connection | undefined;

  try {
    connection = await oracleDb.getConnection();
    
    // Start transaction explicitly
    await connection.execute("BEGIN NULL; END;");

    const stnNumber = await upsertTSSTN(data, connection);
    await upsertTSSTNDetails(data.items, data.company_code!, stnNumber, connection);

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "TS_STN and TS_STNDETAIL successfully upserted",
      stnNumber,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }
    console.error("TS_STN upsert error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upsert TS_STN data",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Connection close error:", closeError);
      }
    }
  }
};