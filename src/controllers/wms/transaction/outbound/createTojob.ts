// backend/routes/inboundJob.ts
import { Router, Request, Response } from "express";
import oracledb from "oracledb";
import constants from "../../../../helpers/constants";
import { createInboundSchema } from "../../../../../src/validation/wms/transaction/createinbound.validation";

const router = Router();

/**
 * Create or update TI_JOB in Oracle DB
 */

export const createOrUpdateJob = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    // Take prin_code, job_no from query, everything else from body
    const { prin_code, job_no } = req.query as { prin_code: string; job_no: string };
    const requestUser = req.body.user || { loginid: "SYSTEM", company_code: req.body.company_code || "" };
/*
    if (!prin_code || !job_no || !requestUser.company_code) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Missing prin_code, job_no, or company_code",
      });
      return;
    }*/
console.log('1');
    // Validate payload
    const { error } = createInboundSchema(req.body, false, requestUser.company_code);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
      return;
    }
console.log('2');
    // Prepare data for insert/update
    const data = {
      ...req.body,
      company_code: requestUser.company_code,
      prin_code,
      job_no,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
    };
console.log('3');
    connection = await oracledb.getConnection();

    // Check if job exists
    const result = await connection.execute<{ COUNT: number }>(
      `SELECT COUNT(*) AS COUNT 
       FROM TI_JOB 
       WHERE company_code = :company_code AND job_no = :job_no`,
      { company_code: data.company_code, job_no: data.job_no },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
console.log('4');
    const countRow = result.rows?.[0] as { COUNT: number } | undefined;
    const exists = (countRow?.COUNT ?? 0) > 0;

    if (exists) {
      // UPDATE existing job
      const updateFields = Object.keys(data)
        .filter((key) => key !== "company_code" && key !== "job_no")
        .map((key) => `${key} = :${key}`)
        .join(", ");
console.log('5');
      const updateQuery = `
        UPDATE TI_JOB
        SET ${updateFields}, updated_at = SYSDATE
        WHERE company_code = :company_code AND job_no = :job_no
      `;
      await connection.execute(updateQuery, data, { autoCommit: true });

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Job updated successfully",
      });
    } else {
      // INSERT new job
 const columns = Object.keys(data)
  .filter((key, index, self) => data[key] !== undefined && self.indexOf(key) === index);

const insertColumns = columns.join(", ");
const insertValues = columns.map((key) => `:${key}`).join(", ");
console.log('6');
      const insertQuery = `
        INSERT INTO TI_JOB (${insertColumns}, created_at, updated_at)
        VALUES (${insertValues}, SYSDATE, SYSDATE)
      `;
      await connection.execute(insertQuery, data, { autoCommit: true });

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Job created successfully",
      });
    }
  } catch (error: any) {
    console.error("Error in createOrUpdateJob:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection:", err);
      }
    }
  }
};