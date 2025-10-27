import { NextFunction, Response } from "express";
import { Op, QueryTypes } from "sequelize";
import * as fastCsv from "fast-csv";
import { sequelize } from "../../../../database/connection";
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
import OrderDetail from "../../../../models/wms/transaction/outbound/toOrderDetail_wms.model";
import PickingDetailsOutboundWmsView from "../../../../views/wms/transportation/outbound/pickingDetailsWms.view";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { Request } from "express";



export const createToOrder = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    console.log("createToOrder API called");
    console.log(" Request body:", req.body);

    // Destructure with default null values for optional fields
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

    // Basic validation
    if (!prin_code || !company_code || !job_no) {
      throw new Error('Missing required fields: PRIN_CODE, COMPANY_CODE, and job_no are required');
    }

    // Check for duplicate order_no if it's provided
    if (order_no) {
      const checkDuplicateQuery = `
        SELECT COUNT(*) as count FROM TO_ORDER 
        WHERE order_no = ?
      `;
      
      const duplicateCheckResult: any = await sequelize.query(checkDuplicateQuery, {
        replacements: [order_no],
        type: QueryTypes.SELECT
      });

      if (duplicateCheckResult[0]?.count > 0) {
        throw new Error('An order with this order_no already exists');
      }
    }

    const query = `
      INSERT INTO TO_ORDER (
        PRIN_CODE, COMPANY_CODE, job_no, cust_code, order_no, 
        order_date, order_due_date, curr_code, EX_RATE, UOC,
        MOC1, MOC2, EXP_CONTAINER_NO, EXP_CONTAINER_SIZE, EXP_CONTAINER_TYPE,
        EXP_CONTAINER_SEALNO, CUST_REFERENCE, PACK_START, PACK_END, LOAD_START, LOAD_END
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const replacements = [
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
      load_end
    ];

    console.log("Executing query:", query);
    console.log("With replacements:", replacements);

    // Execute the insert query
    await sequelize.query(query, {
      replacements,
      type: QueryTypes.INSERT
    });

    // Get the last inserted ID (MySQL approach)
    const result: any = await sequelize.query(
      "SELECT LAST_INSERT_ID() as insertId",
      { type: QueryTypes.SELECT }
    );
    const insertId = result[0]?.insertId;
    
    console.log("Order created successfully with ID:", insertId);
    res.status(201).json({ 
      success: true, 
      message: 'Order created successfully',
      orderId: insertId 
    });

  } catch (error: unknown) {
    console.error("Error creating TO_ORDER:", error);

    // Determine appropriate status code
    let statusCode = 500;
    if (error instanceof Error) {
      if (error.message.includes('Missing required fields')) {
        statusCode = 400;
      } else if (error.message.includes('already exists')) {
        statusCode = 409; // 409 Conflict is appropriate for duplicate resource
      }
    }

    res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : 'An error occurred while creating the order',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getAllOrderEntries = async (req: RequestWithUser, res: Response) => {
  try {
    const { prin_code, job_no, cust_code, order_no } = req.query;

    if (!job_no) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: 'job_no parameter is required'
      });
    }

    const whereClause: any = {
      COMPANY_CODE: req.user.company_code,
      JOB_NO: job_no  
    };

    if (prin_code) whereClause.PRIN_CODE = prin_code;
    if (cust_code) whereClause.CUST_CODE = cust_code;
    if (order_no) whereClause.ORDER_NO = order_no;

    const orderEntries = await OrderEntry.findAll({
      where: whereClause,
      raw: true
    });

    if (!orderEntries || orderEntries.length === 0) {
      return res.status(constants.STATUS_CODES.NO_CONTENT).json({ 
        success: true,
        message: `No order entries found for job_no: ${job_no}`,
        data: [],
        count: 0
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({ 
      success: true, 
      data: orderEntries,
      count: orderEntries.length
    });

  } catch (error: unknown) {
    console.error("Error in getAllOrderEntries:", error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message 
    });
  }
};

export const getSingleOrderEntry = async (req: RequestWithUser, res: Response) => {
  try {
    const { cust_code } = req.query;

    if (!cust_code) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: 'cust_code parameter is required'
      });
    }

    const orderEntry = await OrderEntry.findOne({
      where: {
        cust_code: cust_code
      },
      raw: true
    });

    if (!orderEntry) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({ 
        success: true,
        message: `No order entry found for cust_code: ${cust_code}`,
        data: null
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({ 
      success: true, 
      data: orderEntry
    });

  } catch (error: unknown) {
    console.error("Error in getOrderEntryByCustomerCode:", error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message 
    });
  }
};

export const updateSingleOrderEntry = async (req: RequestWithUser, res: Response) => {
  const transaction = await sequelize.transaction();
  try {
    const { id, ...updateData } = req.body;

    if (!id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'ID parameter is required'
      });
    }

    const [affectedCount] = await OrderEntry.update(updateData, {
      where: { id },
      transaction
    });

    if (affectedCount === 0) {
      await transaction.rollback();
      return res.status(404).json({ 
        success: false,
        message: `No order entry found with id: ${id}`
      });
    }

    const updatedEntry = await OrderEntry.findOne({ 
      where: { id },
      transaction
    });

    await transaction.commit();
    return res.json({ 
      success: true, 
      data: updatedEntry
    });

  } catch (error) {
    await transaction.rollback();
    console.error("Error:", error);
    return res.status(500).json({ 
      success: false, 
      message: error 
    });
  }
};

export const deleteOrderEntry = async (req: RequestWithUser, res: Response) => {
  try {
    const { id } = req.params; 
    console.log('id', id)

    if (!id) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: 'id parameter is required'
      });
    }

    // First check if the order entry exists
    const existingEntry = await OrderEntry.findOne({
      where: { id: id }
    });

    if (!existingEntry) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({ 
        success: false,
        message: `No order entry found for id: ${id}`
      });
    }

    // Perform the deletion
    const deletedCount = await OrderEntry.destroy({
      where: { id: id }
    });

    if (deletedCount === 0) {
      return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ 
        success: false,
        message: 'Order entry could not be deleted'
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({ 
      success: true, 
      message: 'Order entry deleted successfully'
    });

  } catch (error: unknown) {
    console.error("Error in deleteOrderEntry:", error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message 
    });
  }
};

export const getPickingItemPreferenceDetails = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { distinct_field } = req.query;
    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: req.user.company_code }],
      };
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    console.dir(outsideQuery, { depth: null });
    const resultCount = await VwWmOubJobPickFilter.count({
      where: outsideQuery,
    });

    const result = await VwWmOubJobPickFilter.findAll({
      where: outsideQuery,
      attributes: [
        [
          sequelize.fn("DISTINCT", sequelize.col(distinct_field)),
          distinct_field,
        ],
      ],
    });
    if (!result) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: result });
      return;
    }
    res
      .status(constants.STATUS_CODES.OK)
      .json({ success: true, data: { tableData: result, count: resultCount } });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "error:" + knownError.message });
  }
};


export const pickOrder = async (req: RequestWithUser, res: Response) => {
  try {
    const { error } = pickOrderSchema(req.body);
    if (error) {
      return res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
    }

    const { job_no } = req.params;
    const { prin_code, preference, pick, min_qty, exp_period } = req.query;
    const { serial_no } = req.body;

    const updateSelectedSql = `
      UPDATE TO_ORDER_DET
      SET selected = 'Y'
      WHERE company_code = ? 
        AND prin_code = ? 
        AND job_no = ? 
        AND serial_no = ?
    `;

    const replacements = [
      req.user.company_code,
      prin_code,
      job_no,
      serial_no
    ];

    let toggledPackets = 0;

    await sequelize.transaction(async (t) => {
      // Set selected = 'Y'
      const [, metadata] = await sequelize.query(updateSelectedSql, {
        replacements,
        type: QueryTypes.UPDATE,
        transaction: t,
      });

      toggledPackets = metadata;

      if (toggledPackets > 0) {
        // Call stored procedure
        const result: any = await sequelize.query(
          `CALL SP_WM_OUB_PICKING_V3(:vs_company_code, :principal_code, :VS_job_no,'')`,
          {
            replacements: {
              vs_company_code: req.user.company_code,
              principal_code: prin_code,
              VS_job_no: job_no,
              VS_USER: req.user.loginid,
              VS_PREFERENCE: preference,
              VS_PICK: pick,
              VS_MIN_QTY: min_qty,
              VS_EXP_PERIOD: exp_period,
            },
            type: QueryTypes.RAW,
            transaction: t,
          }
        );

        // If result exists, set selected = 'N'
        if (!!result) {
          const unselectSql = `
            UPDATE TO_ORDER_DET
            SET selected = 'N'
            WHERE company_code = ? 
              AND prin_code = ? 
              AND job_no = ? 
              AND serial_no = ?
          `;

          await sequelize.query(unselectSql, {
            replacements,
            type: QueryTypes.UPDATE,
            transaction: t,
          });
        }
      }
    });

    res.status(200).json({
      success: true,
      message: toggledPackets > 0 ? "Order picked successfully." : "No packet updated.",
    });
  } catch (err) {
    console.error("pickOrder error:", err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to process pick order.",
    });
  }
};


   
export const exportPickingDetails = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    let csvTransform: fastCsv.CsvFormatterStream<
      fastCsv.FormatterRow,
      fastCsv.FormatterRow
    >;
    let fetchedData: any[] = [];

    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};

    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: req.user.company_code }],
      };

    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    fetchedData = await PickingDetailsOutboundWmsView.findAll({
      where: outsideQuery,
    });
    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.TANSACTION.OUTOUND.PICKING_DETAILS,
    });

    // Set headers for CSV response before streaming
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="picking_details.csv"`
    );

    // Write data to the CSV stream
    fetchedData.forEach((eachData) => {
      const plainData = eachData.get({ plain: true });
      csvTransform.write(plainData); // Write each row to the CSV stream
    });

    // End the CSV stream and pipe it to the response
    csvTransform.end(); // Complete the CSV data transformation
    csvTransform.pipe(res); // Pipe CSV data into the HTTP response
  } catch (error: any) {
    console.error("Export Error:", error); // Log the error for debugging
    res.status(400).json({ success: false, message: error.message });
  }
};
export const exportPickingStockDeatils = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    let csvTransform: fastCsv.CsvFormatterStream<
      fastCsv.FormatterRow,
      fastCsv.FormatterRow
    >;
    let fetchedData: any[] = [];

    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};

    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: req.user.company_code }],
      };

    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    fetchedData = await VwStkled.findAll({
      where: outsideQuery,
    });
    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.TANSACTION.OUTOUND.PICKING_STOCK_DETAILS,
    });

    // Set headers for CSV response before streaming
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="stock_detail.csv"`
    );

    // Write data to the CSV stream
    fetchedData.forEach((eachData) => {
      const plainData = eachData.get({ plain: true });
      csvTransform.write(plainData); // Write each row to the CSV stream
    });
    console.log("\n\n\n\n\nfetchedData", fetchedData);

    // End the CSV stream and pipe it to the response
    csvTransform.end(); // Complete the CSV data transformation
    csvTransform.pipe(res); // Pipe CSV data into the HTTP response
  } catch (error: any) {
    console.error("Export Error:", error); // Log the error for debugging
    res.status(400).json({ success: false, message: "Error:" + error.message });
  }
};

export const deleteToOrderDetHandler = async (
  req: Request<{ company_code: string; prin_code: string; job_no: string; serial_no: number }>,
  res: Response
): Promise<void> => {
  const { company_code, prin_code, job_no, serial_no } = req.query;
  console.log('deleteToOrderDetHandler called with params:', req.query);
  if (!company_code || !prin_code || !job_no || !serial_no) { 
    res.status(400).json({ success: false, message: "Missing required fields" });
    return;
  }

  try {
    await sequelize.transaction(async (transaction) => {
      const [result]: any = await sequelize.query(
        `DELETE FROM WMSDEV.TO_ORDER_DET WHERE company_code = ? AND prin_code = ? AND job_no = ? AND serial_no = ?`,
        {
          replacements: [company_code, prin_code, job_no, Number(serial_no)],
          transaction,
        }
      );

      const affectedRows = result?.affectedRows ?? result?.rowCount ?? 0;

      if (affectedRows === 0) {
        res.status(404).json({ success: false, message: "Record not found" });
      } else {
        res.status(200).json({ success: true, message: "Record deleted successfully" });
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};


 export const getddSiteCode = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const locationData = await sequelize.query(
    
      `SELECT DISTINCT SITE_CODE FROM VW_PRODUCT_SITE_AVL_QTY`
      ,
      {        replacements: {},
        type: QueryTypes.SELECT,
      }
    );

    if (!locationData || locationData.length === 0) {
      res.status(404).json({
        success: false,
        message: 'No availability data found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: locationData,
    });
  } catch (error: any) {
    console.error("Error fetching location data:", error);
  }
};

 export const getddLocationCode = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const locationData = await sequelize.query(
    
      `SELECT DISTINCT LOCATION_CODE FROM VW_PRODUCT_LOCATION_AVL_QTY`
      ,
      {        replacements: {},
        type: QueryTypes.SELECT,
      }
    );

    if (!locationData || locationData.length === 0) {
      res.status(404).json({
        success: false,
        message: 'No availability data found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: locationData,
    });
  } catch (error: any) {
    console.error("Error fetching location data:", error);
  }
};

export const getTotalAvailableQty = async (
  req: Request,
  res: Response,
): Promise<void> => {
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
 
    console.log("PROC_GET_TOTAL_QTY_AVL SQL Params:", params);
 
    // Step 1: Call the procedure, passing @v_total_qty as OUT param
    const callProcSQL = `
      CALL PROC_GET_TOTAL_QTY_AVL(
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
        @v_total_qty
      );
    `;
 
    await sequelize.query(callProcSQL, {
      replacements: params,
      type: QueryTypes.RAW,
    });
 
    // Step 2: Fetch the OUT parameter from the session
    const result: any = await sequelize.query("SELECT @v_total_qty AS TOT_AVL_QTY;", {
      type: QueryTypes.SELECT,
    });
 
    if (!result || result.length === 0) {
      res.status(404).json({
        success: false,
        message: "No availability data found",
      });
      return;
    }
 
    res.status(200).json({
      success: true,
      TOT_AVL_QTY: result[0].TOT_AVL_QTY,
    });
  } catch (error: any) {
    console.error("Error fetching total available qty:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

 export const getddLotNum = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const locationData = await sequelize.query(
    
      `SELECT * FROM VW_PRODUCT_LOT_AVL_QTY`
      ,
      {        replacements: {},
        type: QueryTypes.SELECT,
      }
    );

    if (!locationData || locationData.length === 0) {
      res.status(404).json({
        success: false,
        message: 'No availability data found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: locationData,
    });
  } catch (error: any) {
    console.error("Error fetching location data:", error);
  }
};
