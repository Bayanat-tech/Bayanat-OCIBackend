import { Response } from "express"; // Importing the Response type from Express to type the response object in route handlers.
import { Request } from "express";
import { Op, QueryTypes } from "sequelize"; // Importing Sequelize operators and query types for database operations.
import * as fastCsv from "fast-csv"; // Importing the fast-csv library for handling CSV file operations.
import { sequelize } from "../../../../database/connection"; // Importing the configured Sequelize instance for database connection.
import constants from "../../../../helpers/constants"; // Importing constants, likely for status codes and other fixed values.
import { getSearchFilterQuery } from "../../../../helpers/functions"; // Importing a helper function to construct search filter queries.
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface"; // Importing TypeScript interfaces for search filters and request objects with user information.
import MsPickwave from "../../../../models/wms/transaction/outbound/msPickwave_wms.model"; // Importing the MsPickwave model for database operations related to pick waves.
import { pickOrderSchema } from "../../../../validation/wms/transaction/outbound.validation"; // Importing a validation schema for validating pick order requests.
import VwWmOubJobPickFilter from "../../../../views/wms/transportation/outbound/pickingPreferenceFilter.view"; // Importing a view model for picking preference filters.
import VwStkled from "../../../../views/wms/transportation/outbound/vmStkled.view"; // Importing a view model for stock ledger data.
import OrderDetail from "../../../../models/wms/transaction/outbound/toOrderDetail_wms.model"; // Importing the OrderDetail model for database operations related to order details.
import PickingDetailsOutboundWmsView from "../../../../views/wms/transportation/outbound/pickingDetailsWms.view"; // Importing a view model for picking details.
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders"; // Importing CSV headers configuration for exporting data to CSV files.


// Function to get product stock details
export const getProductStockDetails = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    // Parse filter from request query
    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [{ company_code: req.user.company_code }],
      };
    // Construct search filter query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });

    // Count the number of records matching the query
    const count = await VwStkled.count({
      where: outsideQuery,
    });

    // Retrieve all matching records with specified attributes
    const result = await VwStkled.findAll({
      attributes: [
        "p_uom",
        "l_uom",
        "prod_code",
        "prod_name",
        "prod_uppp",
        [sequelize.fn("SUM", sequelize.col("pqty_stock")), "puomqty"],
        [sequelize.fn("SUM", sequelize.col("lqty_stock")), "luomqty"],
        [sequelize.fn("SUM", sequelize.col("pqty_picked")), "puompicked"],
        [sequelize.fn("SUM", sequelize.col("lqty_picked")), "luompicked"],
        [sequelize.fn("SUM", sequelize.col("pqty_avl")), "puomavl"],
        [sequelize.fn("SUM", sequelize.col("lqty_avl")), "luomavl"],
        "uom_count",
        "site_code",
      ],
      where: outsideQuery,
      group: [
        "p_uom",
        "l_uom",
        "site_code",
        "prod_code",
        "prod_name",
        "prod_uppp",
        "uom_count",
      ],
    });

    // Check if result is empty and respond accordingly
    if (!result) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: result });
      return;
    }
    // Send successful response with data
    res
      .status(constants.STATUS_CODES.OK)
      .json({ success: true, data: { tableData: result, count } });
    return;
  } catch (error: unknown) {
    // Handle errors and send error response
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

// Function to get picking options
export const getPickingOption = async (req: RequestWithUser, res: Response) => {
  try {
    // Retrieve picking options based on company code
    const pickingOption = await MsPickwave.findAll({
      where: { [Op.and]: { company_code: req.user.company_code } },
    });
    // Check if picking options are found
    if (!pickingOption) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: pickingOption });
      return;
    }
    // Send successful response with picking options
    res
      .status(constants.STATUS_CODES.OK)
      .json({ success: true, data: pickingOption });
    return;
  } catch (error: unknown) {
    // Handle errors and send error response
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

// Function to get picking item preference details
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
    // Construct search filter query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    console.dir(outsideQuery, { depth: null });

    // Count the number of records matching the query
    const resultCount = await VwWmOubJobPickFilter.count({
      where: outsideQuery,
    });

    // Retrieve distinct field values
    const result = await VwWmOubJobPickFilter.findAll({
      where: outsideQuery,
      attributes: [
        [
          sequelize.fn("DISTINCT", sequelize.col(distinct_field)),
          distinct_field,
        ],
      ],
    });
    // Check if result is empty and respond accordingly
    if (!result) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: result });
      return;
    }
    // Send successful response with data
    res
      .status(constants.STATUS_CODES.OK)
      .json({ success: true, data: { tableData: result, count: resultCount } });
    return;
  } catch (error: unknown) {
    // Handle errors and send error response
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "error:" + knownError.message });
  }
};

// Function to confirm an order 
export const confirmorder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { job_no } = req.params;
    const { prin_code, confirm_date } = req.query;
    let { serial_no } = req.body;
    if (!prin_code) {
      res.status(400).json({
        success: false,
        message: "Missing prin_code",
      });
      return;
    }

    if (!Array.isArray(serial_no)) {
      res.status(400).json({
        success: false,
        message: "serial_no must be an array of numbers",
      });
      return;
    }
    // serial_no = (serial_no as string[]).map((item: string) => Number(item) + 1);
    // const invalidEntries = serial_no.filter((item: number) => isNaN(item));
    // if (invalidEntries.length > 0) {
    //   res.status(400).json({
    //     success: false,
    //     message: "All serial_no entries must be valid numbers job confirm",
    //   });
    //   return;
    // }
    const company_code = (req.user as any).company_code;
    const updateSql = `
      UPDATE TO_BATCH SET selected = 'Y'
      WHERE company_code = :company_code
        AND prin_code = :prin_code
        AND job_no = :job_no
        AND key_number IN (:serial_no)
    `;


// Ensure serial_no is an array and increment by 1
if (!Array.isArray(serial_no)) {
  res.status(400).json({
    success: false,
    message: 'serial_no must be an array of numbers',
  });
  return;
}


    let toggledPackets = 0;

    await sequelize.transaction(async (t) => {
      console.log('Executing update with sql:', updateSql);
      const [, metadata] = await sequelize.query(updateSql, {
        replacements: { company_code, prin_code, job_no, serial_no },
        type: QueryTypes.UPDATE,
        transaction: t,
      });

      toggledPackets = metadata;

      if (toggledPackets > 0) {
        const result = await sequelize.query(
          `CALL SP_WM_PICK_CONFIRM1(:vs_company_code, :vs_principal_code, :vs_job_no, :vdt_confirm)`,
          {
            replacements: {
              vs_company_code: company_code,
              vs_principal_code: prin_code,
              vs_job_no: job_no,
              vdt_confirm: confirm_date || new Date(),
            },
            type: QueryTypes.RAW,
            transaction: t,
          }
        );

        if (!!result) {
          const unselectSql = `
           UPDATE TO_BATCH SET selected = 'Y'
               WHERE company_code = :company_code
              AND prin_code = :prin_code
              AND job_no = :job_no
              AND KEY_NUMBER IN (:serial_no)
          `;

          await sequelize.query(unselectSql, {
            replacements: { company_code, prin_code, job_no, serial_no },
            type: QueryTypes.UPDATE,
            transaction: t,
          });
        }
      }
    });

    res.status(200).json({
      success: true,
      message:
        toggledPackets > 0
          ? "Order Confirm successfully."
          : "No TO_BATCH updated.",
    });
  } catch (err: any) {
    console.error("Confirm Order error:", err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to process pick order.",
    });
  }
};




// Function to pick an order.   This procedure executed


export const pickOrder = async (req: Request, res: Response): Promise<void> => {

  try {

    const { job_no } = req.params;

    const { prin_code } = req.query;

    let { serial_no } = req.body;
 
    if (!prin_code) {

      res.status(400).json({

        success: false,

        message: "Missing prin_code",

      });

      return;

    }
 
    if (!Array.isArray(serial_no)) {

      res.status(400).json({

        success: false,

        message: "serial_no must be an array of numbers",

      });

      return;

    }
 
    const invalidEntries = serial_no.filter((item: number) => isNaN(item));

    if (invalidEntries.length > 0) {

      res.status(400).json({

        success: false,

        message: "All serial_no entries must be valid numbers p",

      });

      return;

    }
 
    const company_code = (req.user as any).company_code;
 
    const updateSql = `

      UPDATE TO_ORDER_DET

      SET selected = 'Y', PICKED = 'N'

      WHERE company_code = :company_code

        AND prin_code = :prin_code

        AND job_no = :job_no

        AND serial_no IN (:serial_no)

    `;
 
    let toggledPackets = 0;
 
    await sequelize.transaction(async (t) => {

      const [, metadata] = await sequelize.query(updateSql, {

        replacements: { company_code, prin_code, job_no, serial_no },

        type: QueryTypes.UPDATE,

        transaction: t,

      });
 
      toggledPackets = metadata;
 
      if (toggledPackets > 0) {

        try {

          // Try to call the procedure

          await sequelize.query(

            `CALL SP_WM_OUB_PICKING_V3(:vs_company_code, :vs_principal_code, :vs_job_no, :vs_sort)`,

            {

              replacements: {

                vs_company_code: company_code,

                vs_principal_code: prin_code,

                vs_job_no: job_no,

                vs_sort: ""

              },

              type: QueryTypes.RAW,

              transaction: t,

            }

          );

        } catch (procError) {

          // Procedure failed: revert update

          console.error("SP_WM_OUB_PICKING_V3 failed, reverting TO_ORDER_DET changes:", procError);
 
          const unselectSql = `

            UPDATE TO_ORDER_DET

            SET selected = 'N'

            WHERE company_code = :company_code

              AND prin_code = :prin_code

              AND job_no = :job_no

              AND serial_no IN (:serial_no)

          `;
 
          await sequelize.query(unselectSql, {

            replacements: { company_code, prin_code, job_no, serial_no },

            type: QueryTypes.UPDATE,

            transaction: t,

          });
 
          // Rethrow so outer catch handles response

          throw procError;

        }

      }

    });
 
    res.status(200).json({

      success: true,

      message:

        toggledPackets > 0

          ? "Order picked successfully."

          : "No packet updated.",

    });

  } catch (err: any) {

    console.error("pickOrder error:", err);

    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({

      success: false,

      message: "Failed to process pick order.",

    });

  }

};
 
 





// Function to export picking details to CSV
export const exportPickingDetails = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
     console.log('inside exportPickingDetails');
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

    // Construct search filter query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    // Fetch data for CSV export
    fetchedData = await PickingDetailsOutboundWmsView.findAll({
      where: outsideQuery,
    });
    // Initialize CSV formatter with headers
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
    // Log the error for debugging
    console.error("Export Error:", error);
    // Send error response
    res.status(400).json({ success: false, message: error.message });
  }
};

// Function to export picking stock details to CSV
export const exportPickingStockDeatils = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
       console.log('inside exportPickingStockDeatils');
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

    // Construct search filter query
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    // Fetch data for CSV export
    fetchedData = await VwStkled.findAll({
      where: outsideQuery,
    });
    // Initialize CSV formatter with headers
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
    // Log the error for debugging
    console.error("Export Error:", error);
    // Send error response
    res.status(400).json({ success: false, message: "Error:" + error.message });
  }
};


export const oubcancelPick = async (req: Request, res: Response): Promise<void> => {
  try {
    const { job_no } = req.params;
    const { prin_code, freeze } = req.query;
    let { serial_no } = req.body;

    if (!prin_code) {
      res.status(400).json({
        success: false,
        message: "Missing prin_code",
      });
      return;
    }

    if (!Array.isArray(serial_no)) {
      res.status(400).json({
        success: false,
        message: "serial_no must be an array of numbers",
      });
      return;
    }

    const company_code = (req.user as any).company_code;

    const updateSql = `
      UPDATE TO_BATCH SET selected = 'Y'
      WHERE company_code = :company_code
        AND prin_code = :prin_code
        AND job_no = :job_no
        AND key_number IN (:serial_no)
    `;

    let toggledPackets = 0;

    await sequelize.transaction(async (t) => {
      // Step 1: Mark packets as selected
      const [, metadata] = await sequelize.query(updateSql, {
        replacements: { company_code, prin_code, job_no, serial_no },
        type: QueryTypes.UPDATE,
        transaction: t,
      });

      toggledPackets = metadata;

      if (toggledPackets > 0) {
        // Step 2: Call cancel procedure (replacing the old one)
        const result = await sequelize.query(
          `CALL sp_pick_cancel_confirmed(:vs_company_code, :vs_prin_code, :vs_job_no, :vs_freeze)`,
          {
            replacements: {
              vs_company_code: company_code,
              vs_prin_code: prin_code,
              vs_job_no: job_no,
              vs_freeze: freeze || 'N',
            },
            type: QueryTypes.RAW,
            transaction: t,
          }
        );

        // Step 3: Rollback selection if procedure returned something (optional logic)
        if (!!result) {
          const unselectSql = `
            UPDATE TO_BATCH SET selected = 'Y'
            WHERE company_code = :company_code
              AND prin_code = :prin_code
              AND job_no = :job_no
              AND key_number IN (:serial_no)
          `;

          await sequelize.query(unselectSql, {
            replacements: { company_code, prin_code, job_no, serial_no },
            type: QueryTypes.UPDATE,
            transaction: t,
          });
        }
      }
    });

    res.status(200).json({
      success: true,
      message:
        toggledPackets > 0
          ? "Pick Cancel successfully."
          : "No TO_BATCH updated.",
    });
  } catch (err: any) {
    console.error("Pick Cancel error:", err);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to process pick cancel.",
    });
  }
};
