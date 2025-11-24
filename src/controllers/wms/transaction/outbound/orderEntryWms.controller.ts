import { NextFunction, Response } from "express";
import * as fastCsv from "fast-csv";

import oracledb, { BindParameters, ExecuteOptions, Connection } from "oracledb";
import { oracleDb } from "../../../../database/connection"; // make sure this exports oracledb.getConnection()
import constants from "../../../../helpers/constants";
import { getSearchFilterQuery } from "../../../../helpers/functions";
import { RequestHandler } from 'express';
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import MsPickwave from "../../../../models/wms/transaction/outbound/msPickwave_wms.model";
import OrderEntry from "../../../../models/wms/transaction/outbound/orderEntry_wms.model";
import { pickOrderSchema } from "../../../../validation/wms/transaction/outbound.validation";
import VwWmOubJobPickFilter from "../../../../views/wms/transportation/outbound/pickingPreferenceFilter.view";
import VwStkled from "../../../../views/wms/transportation/outbound/vmStkled.view";
// import OrderDetail from "../../../../models/wms/transaction/outbound/toOrderDetail_wms.model";
import PickingDetailsOutboundWmsView from "../../../../views/wms/transportation/outbound/pickingDetailsWms.view";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { Request } from "express";



export const createToOrder = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection: Connection | undefined;

  try {
    const {
      prin_code,
      company_code,
      job_no,
      cust_code = null,
      order_no = null,
      order_date = null,
      order_due_date = null,
      curr_code = null,
      ex_rate = null,
      uoc = null,
      moc1 = null,
      moc2 = null,
      exp_container_no = null,
      exp_container_size = null,
      exp_container_type = null,
      exp_container_sealno = null,
      cust_reference = null,
      pack_start = null,
      pack_end = null,
      load_start = null,
      load_end = null
    } = req.body;

    if (!prin_code || !company_code || !job_no) {
      res.status(400).json({ success: false, message: "Missing required fields: PRIN_CODE, COMPANY_CODE, and job_no are required" });
      return;
    }

    connection = await oracleDb.getConnection();

    // Duplicate check
    if (order_no) {
      const duplicateCheckQuery = `
        SELECT COUNT(*) AS COUNT
        FROM TO_ORDER
        WHERE ORDER_NO = :order_no
      `;
      const duplicateResult = await connection.execute<{ COUNT: number }>(
        duplicateCheckQuery,
        { order_no },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if ((duplicateResult.rows?.[0]?.COUNT ?? 0) > 0) {
        res.status(409).json({ success: false, message: "An order with this order_no already exists" });
        return;
      }
    }

    // Insert
    const insertQuery = `
      INSERT INTO TO_ORDER (
        PRIN_CODE, COMPANY_CODE, JOB_NO, CUST_CODE, ORDER_NO,
        ORDER_DATE, ORDER_DUE_DATE, CURR_CODE, EX_RATE, UOC,
        MOC1, MOC2, EXP_CONTAINER_NO, EXP_CONTAINER_SIZE, EXP_CONTAINER_TYPE,
        EXP_CONTAINER_SEALNO, CUST_REFERENCE, PACK_START, PACK_END, LOAD_START, LOAD_END
      ) VALUES (
        :prin_code, :company_code, :job_no, :cust_code, :order_no,
        :order_date, :order_due_date, :curr_code, :ex_rate, :uoc,
        :moc1, :moc2, :exp_container_no, :exp_container_size, :exp_container_type,
        :exp_container_sealno, :cust_reference, :pack_start, :pack_end, :load_start, :load_end
      )
      RETURNING ROWID INTO :inserted_id
    `;

    const binds = {
      prin_code,
      company_code,
      job_no,
      cust_code,
      order_no,
      order_date,
      order_due_date,
      curr_code,
      ex_rate,
      uoc,
      moc1,
      moc2,
      exp_container_no,
      exp_container_size,
      exp_container_type,
      exp_container_sealno,
      cust_reference,
      pack_start,
      pack_end,
      load_start,
      load_end,
      inserted_id: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const insertResult = await connection.execute<{ inserted_id: string }>(insertQuery, binds, { autoCommit: true });

    const insertedId = insertResult.outBinds?.inserted_id?.[0] ?? null;

    if (!insertedId) {
      res.status(500).json({ success: false, message: "Failed to retrieve inserted ID" });
      return;
    }

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      orderId: insertedId
    });

  } catch (error: any) {
    console.error("Error creating TO_ORDER:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};


export const getAllOrderEntries = async (req: RequestWithUser, res: Response) => {
  let connection: Connection | undefined;

  try {
    const { prin_code, job_no, cust_code, order_no } = req.query;

    if (!job_no) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "job_no parameter is required",
      });
    }

    connection = await oracleDb.getConnection();

    // ✅ Build dynamic SQL WHERE clause
    let baseQuery = `
      SELECT *
      FROM ORDER_ENTRY
      WHERE COMPANY_CODE = :company_code
        AND JOB_NO = :job_no
    `;

    const binds: Record<string, any> = {
      company_code: req.user.company_code,
      job_no,
    };

    if (prin_code) {
      baseQuery += " AND PRIN_CODE = :prin_code";
      binds.prin_code = prin_code;
    }
    if (cust_code) {
      baseQuery += " AND CUST_CODE = :cust_code";
      binds.cust_code = cust_code;
    }
    if (order_no) {
      baseQuery += " AND ORDER_NO = :order_no";
      binds.order_no = order_no;
    }

    const result = await connection.execute<any>(
      baseQuery,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const orderEntries = result.rows ?? [];

    if (orderEntries.length === 0) {
      return res.status(constants.STATUS_CODES.NO_CONTENT).json({
        success: true,
        message: `No order entries found for job_no: ${job_no}`,
        data: [],
        count: 0,
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: orderEntries,
      count: orderEntries.length,
    });

  } catch (error: any) {
    console.error("Error in getAllOrderEntries:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An unknown error occurred",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Error closing Oracle connection:", closeError);
      }
    }
  }
};

export const getSingleOrderEntry = async (req: RequestWithUser, res: Response) => {
  let connection: Connection | undefined;

  try {
    const { cust_code } = req.query;

    if (!cust_code) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "cust_code parameter is required",
      });
    }

    connection = await oracleDb.getConnection();

    const query = `
      SELECT *
      FROM ORDER_ENTRY
      WHERE CUST_CODE = :cust_code
    `;

    const result = await connection.execute<any>(
      query,
      { cust_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const orderEntry = result.rows && result.rows.length > 0 ? result.rows[0] : null;

    if (!orderEntry) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: true,
        message: `No order entry found for cust_code: ${cust_code}`,
        data: null,
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: orderEntry,
    });

  } catch (error: any) {
    console.error("Error in getSingleOrderEntry:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An unknown error occurred",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Error closing Oracle connection:", closeError);
      }
    }
  }
};


export const updateSingleOrderEntry = async (req: RequestWithUser, res: Response) => {
  let connection: Connection | undefined;

  try {
    const { id, ...updateData } = req.body;

    if (!id) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "ID parameter is required",
      });
    }

    connection = await oracleDb.getConnection();

    // Start manual transaction
    await connection.execute("BEGIN NULL; END;");

    // 1️⃣ Check if record exists
    const checkQuery = `SELECT COUNT(*) AS COUNT FROM ORDER_ENTRY WHERE ID = :id`;
    const checkResult = await connection.execute<{ COUNT: number }>(
      checkQuery,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const count = checkResult.rows?.[0]?.COUNT ?? 0;
    if (count === 0) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: `No order entry found with id: ${id}`,
      });
    }

    // 2️⃣ Build dynamic SET clause for update
    const fields = Object.keys(updateData);
    if (fields.length === 0) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "No fields provided for update",
      });
    }

    const setClause = fields.map((key) => `${key.toUpperCase()} = :${key}`).join(", ");
    const updateQuery = `
      UPDATE ORDER_ENTRY
      SET ${setClause}
      WHERE ID = :id
    `;

    await connection.execute(updateQuery, { id, ...updateData });

    // 3️⃣ Fetch updated record
    const selectQuery = `
      SELECT * FROM ORDER_ENTRY WHERE ID = :id
    `;
    const selectResult = await connection.execute<any>(
      selectQuery,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const updatedEntry = selectResult.rows?.[0] ?? null;

    // Commit transaction
    await connection.commit();

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: updatedEntry,
    });

  } catch (error: any) {
    if (connection) await connection.rollback();
    console.error("Error in updateSingleOrderEntry:", error);

    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An error occurred while updating order entry",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};

/**
 * DELETE an order entry by ID
 */
export const deleteOrderEntry = async (req: RequestWithUser, res: Response) => {
  let connection: Connection | undefined;

  try {
    const { id } = req.params;

    if (!id) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "id parameter is required",
      });
    }

    connection = await oracleDb.getConnection();

    // 1️⃣ Check if exists
    const checkQuery = `
      SELECT COUNT(*) AS COUNT FROM ORDER_ENTRY WHERE ID = :id
    `;
    const checkResult = await connection.execute<{ COUNT: number }>(
      checkQuery,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const count = checkResult.rows?.[0]?.COUNT ?? 0;
    if (count === 0) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: `No order entry found for id: ${id}`,
      });
    }

    // 2️⃣ Delete record
    const deleteQuery = `
      DELETE FROM ORDER_ENTRY WHERE ID = :id
    `;
    const result = await connection.execute(deleteQuery, { id }, { autoCommit: true });

    if (result.rowsAffected && result.rowsAffected > 0) {
      return res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Order entry deleted successfully",
      });
    } else {
      return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Order entry could not be deleted",
      });
    }

  } catch (error: any) {
    console.error("Error in deleteOrderEntry:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An error occurred while deleting order entry",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};

/**
 * Get Picking Item Preference Details
 */
export const getPickingItemPreferenceDetails = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection: Connection | undefined;

  try {
    const { distinct_field } = req.query;
    const filter: ISearch = req.query.filter ? JSON.parse(req.query.filter as string) : {};

    if (!distinct_field) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "distinct_field parameter is required",
      });
    }

    connection = await oracleDb.getConnection();

    // Base SQL (You should replace with the correct view name used in Oracle)
    let baseQuery = `
      SELECT DISTINCT ${distinct_field}
      FROM VW_WM_OUB_JOB_PICK_FILTER
      WHERE COMPANY_CODE = :company_code
    `;

    const binds: Record<string, any> = {
      company_code: req.user.company_code,
    };

    // Add dynamic filters (similar to getSearchFilterQuery)
    if (filter?.search) {
      for (const [key, value] of Object.entries(filter.search)) {
        baseQuery += ` AND ${key.toUpperCase()} = :${key}`;
        binds[key] = value;
      }
    }

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS COUNT
      FROM VW_WM_OUB_JOB_PICK_FILTER
      WHERE COMPANY_CODE = :company_code
    `;

    const countResult = await connection.execute<{ COUNT: number }>(
      countQuery,
      { company_code: req.user.company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const count = countResult.rows?.[0]?.COUNT ?? 0;

    // Execute distinct query
    const result = await connection.execute<any>(
      baseQuery,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const data = result.rows ?? [];

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: { tableData: data, count },
    });

  } catch (error: any) {
    console.error("Error in getPickingItemPreferenceDetails:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error: " + (error.message || "Unknown error"),
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

/**
 * Pick Order (calls stored procedure)
 */
export const pickOrder = async (req: RequestWithUser, res: Response) => {
  let connection: Connection | undefined;

  try {
    // Validate request
    const { error } = pickOrderSchema(req.body);
    if (error) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
    }

    const { job_no } = req.params;
    const { prin_code, preference, pick, min_qty, exp_period } = req.query;
    const { serial_no } = req.body;

    if (!prin_code || !job_no || !serial_no) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "prin_code, job_no, and serial_no are required parameters.",
      });
    }

    connection = await oracleDb.getConnection();

    await connection.execute("BEGIN NULL; END;"); // start implicit transaction
    let toggledPackets = 0;

    // 1️⃣ Update selected = 'Y'
    const updateSelectedSql = `
      UPDATE TO_ORDER_DET
      SET SELECTED = 'Y'
      WHERE COMPANY_CODE = :company_code
        AND PRIN_CODE = :prin_code
        AND JOB_NO = :job_no
        AND SERIAL_NO = :serial_no
    `;

    const updateResult = await connection.execute(updateSelectedSql, {
      company_code: req.user.company_code,
      prin_code,
      job_no,
      serial_no,
    });

    toggledPackets = updateResult.rowsAffected ?? 0;

    // 2️⃣ Call stored procedure if updated
    if (toggledPackets > 0) {
      const procedureCall = `
        BEGIN
          SP_WM_OUB_PICKING_V3(
            :vs_company_code,
            :principal_code,
            :vs_job_no,
            :vs_user,
            :vs_preference,
            :vs_pick,
            :vs_min_qty,
            :vs_exp_period
          );
        END;
      `;

      await connection.execute(procedureCall, {
        vs_company_code: req.user.company_code,
        principal_code: prin_code,
        vs_job_no: job_no,
        vs_user: req.user.loginid,
        vs_preference: preference ?? null,
        vs_pick: pick ?? null,
        vs_min_qty: min_qty ?? null,
        vs_exp_period: exp_period ?? null,
      });

      // 3️⃣ Optionally unselect if procedure result needs revert
      // (Here assuming you always revert if procedure succeeds)
      const unselectSql = `
        UPDATE TO_ORDER_DET
        SET SELECTED = 'N'
        WHERE COMPANY_CODE = :company_code
          AND PRIN_CODE = :prin_code
          AND JOB_NO = :job_no
          AND SERIAL_NO = :serial_no
      `;

      await connection.execute(unselectSql, {
        company_code: req.user.company_code,
        prin_code,
        job_no,
        serial_no,
      });
    }

    await connection.commit();

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: toggledPackets > 0 ? "Order picked successfully." : "No packet updated.",
    });

  } catch (err: any) {
    if (connection) await connection.rollback();
    console.error("pickOrder error:", err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to process pick order: " + (err.message || "Unknown error"),
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


   
/**
 * Export Picking Details (CSV)
 */
export const exportPickingDetails = async (req: RequestWithUser, res: Response) => {
  let connection: Connection | undefined;

  try {
    const filter: ISearch = req.query.filter ? JSON.parse(req.query.filter as string) : {};
    connection = await oracleDb.getConnection();

    // Build dynamic WHERE clause
    let whereClause = `WHERE COMPANY_CODE = :company_code`;
    const binds: any = { company_code: req.user.company_code };

    if (filter?.search) {
      for (const [key, value] of Object.entries(filter.search)) {
        whereClause += ` AND ${key.toUpperCase()} = :${key}`;
        binds[key] = value;
      }
    }

    const sql = `SELECT * FROM VW_PICKING_DETAILS_OUTBOUND_WMS ${whereClause}`;

    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const data = result.rows || [];

    // CSV streaming setup
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="picking_details.csv"`);

    const csvStream = fastCsv.format({
      headers: WmsCsvHeaders.TANSACTION.OUTOUND.PICKING_DETAILS,
    });

    csvStream.pipe(res);
    data.forEach((row) => csvStream.write(row));
    csvStream.end();

  } catch (error: any) {
    console.error("Export Picking Error:", error);
    res.status(400).json({ success: false, message: error.message });
  } finally {
    if (connection) await connection.close();
  }
};

/**
 * Export Picking Stock Details (CSV)
 */
export const exportPickingStockDeatils = async (req: RequestWithUser, res: Response) => {
  let connection: Connection | undefined;

  try {
    const filter: ISearch = req.query.filter ? JSON.parse(req.query.filter as string) : {};
    connection = await oracleDb.getConnection();

    // Build dynamic WHERE clause
    let whereClause = `WHERE COMPANY_CODE = :company_code`;
    const binds: any = { company_code: req.user.company_code };

    if (filter?.search) {
      for (const [key, value] of Object.entries(filter.search)) {
        whereClause += ` AND ${key.toUpperCase()} = :${key}`;
        binds[key] = value;
      }
    }

    const sql = `SELECT * FROM VW_STKLED ${whereClause}`;
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const data = result.rows || [];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="stock_detail.csv"`);

    const csvStream = fastCsv.format({
      headers: WmsCsvHeaders.TANSACTION.OUTOUND.PICKING_STOCK_DETAILS,
    });

    csvStream.pipe(res);
    data.forEach((row) => csvStream.write(row));
    csvStream.end();

  } catch (error: any) {
    console.error("Export Stock Error:", error);
    res.status(400).json({ success: false, message: "Error: " + error.message });
  } finally {
    if (connection) await connection.close();
  }
};

/**
 * Delete a TO_ORDER_DET record
 */

export const deleteToOrderDetHandler = async (
  req: Request<{ company_code: string; prin_code: string; job_no: string; serial_no: number }>,
  res: Response
): Promise<void> => {
  let connection: Connection | undefined;

  try {
    const company_code = String(req.query.company_code);
    const prin_code = String(req.query.prin_code);
    const job_no = String(req.query.job_no);
    const serial_no = Number(req.query.serial_no);

    if (!company_code || !prin_code || !job_no || isNaN(serial_no)) {
      res.status(400).json({ success: false, message: "Missing or invalid required fields" });
      return;
    }

    connection = await oracleDb.getConnection();

    const sql = `
      DELETE FROM TO_ORDER_DET
      WHERE COMPANY_CODE = :company_code
        AND PRIN_CODE = :prin_code
        AND JOB_NO = :job_no
        AND SERIAL_NO = :serial_no
    `;

    const binds = { company_code, prin_code, job_no, serial_no };

    // ✅ Use oracledb.Result<any> instead of undefined Result
    const result: oracledb.Result<any> = await connection.execute(sql, binds, { autoCommit: true });

    if ((result.rowsAffected ?? 0) === 0) {
      res.status(404).json({ success: false, message: "Record not found" });
    } else {
      res.status(200).json({ success: true, message: "Record deleted successfully" });
    }
  } catch (error: any) {
    console.error("Delete Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
}
/**
 * Get distinct SITE_CODE dropdown
 */
export const getddSiteCode = async (req: Request, res: Response): Promise<void> => {
  let connection: Connection | undefined;
  try {
    connection = await oracleDb.getConnection();
    const result = await connection.execute(
      `SELECT DISTINCT SITE_CODE FROM VW_PRODUCT_SITE_AVL_QTY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = result.rows || [];
    if (rows.length === 0) {
      res.status(404).json({ success: false, message: "No availability data found" });
      return;
    }

    res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    console.error("Error fetching site codes:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) await connection.close();
  }
};

/**
 * Get distinct LOCATION_CODE dropdown
 */
export const getddLocationCode = async (req: Request, res: Response): Promise<void> => {
  let connection: Connection | undefined;
  try {
    connection = await oracleDb.getConnection();
    const result = await connection.execute(
      `SELECT DISTINCT LOCATION_CODE FROM VW_PRODUCT_LOCATION_AVL_QTY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = result.rows || [];
    if (rows.length === 0) {
      res.status(404).json({ success: false, message: "No availability data found" });
      return;
    }

    res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    console.error("Error fetching location codes:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) await connection.close();
  }
};

/**
 * Call PROC_GET_TOTAL_QTY_AVL procedure
 */
export const getTotalAvailableQty = async (req: Request, res: Response): Promise<void> => {
  let connection: Connection | undefined;
  try {
    const params = {
      company_code: req.body.company_code,
      prin_code: req.body.prin_code,
      prod_code: req.body.prod_code,
      site_code: req.body.site_code,
      location_from: req.body.location_from,
      location_to: req.body.location_to,
      batch: req.body.batch,
      lot_no: req.body.lot_no,
      mfg_date_from: req.body.production_from,
      mfg_date_to: req.body.production_to,
      exp_date_from: req.body.exp_date_from,
      exp_date_to: req.body.exp_date_to,
    };

    connection = await oracleDb.getConnection();

    const binds = {
      ...params,
      v_total_qty: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    };

    await connection.execute(
      `
      BEGIN
        PROC_GET_TOTAL_QTY_AVL(
          :company_code,
          :prin_code,
          :prod_code,
          :site_code,
          :location_from,
          :location_to,
          :batch,
          :lot_no,
          :mfg_date_from,
          :mfg_date_to,
          :exp_date_from,
          :exp_date_to,
          :v_total_qty
        );
      END;
      `,
      binds
    );

    res.status(200).json({
      success: true,
      TOT_AVL_QTY: binds.v_total_qty,
    });
  } catch (error: any) {
    console.error("Error fetching total available qty:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) await connection.close();
  }
};
 export const getddLotNum = async (req: Request, res: Response): Promise<void> => {
  let connection: Connection | undefined;

  try {
    connection = await oracleDb.getConnection();

    const sql = `SELECT * FROM VW_PRODUCT_LOT_AVL_QTY`;
    const result = await connection.execute(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    const rows = result.rows || [];

    if (rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "No availability data found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    console.error("Error fetching lot number data:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};