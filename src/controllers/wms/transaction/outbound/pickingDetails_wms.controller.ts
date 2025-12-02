import { Response } from "express";
import { Request } from "express";
import * as fastCsv from "fast-csv";
import { oracleDb } from "../../../../database/connection";
import constants from "../../../../helpers/constants";
import { getSearchFilterQuery } from "../../../../helpers/functions";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { pickOrderSchema } from "../../../../validation/wms/transaction/outbound.validation";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";

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
    
    // You'll need to adapt getSearchFilterQuery for raw SQL
    // This is a simplified version
    let whereClause = `WHERE company_code = :company_code`;
    const bindParams: any = { company_code: req.user.company_code };

    // TODO: Implement proper filtering logic from getSearchFilterQuery
    if (filter.search) {
      // Add your filtering logic here
      // For example: whereClause += " AND prod_code LIKE :prod_code"
    }

    // Count query
    const countQuery = `SELECT COUNT(*) as count FROM VW_STKLED ${whereClause}`;
    const countResult = await oracleDb.query(countQuery, bindParams);
    const count = countResult.rows?.[0]?.COUNT || 0;

    // Main query with aggregation
    const mainQuery = `
      SELECT 
        p_uom,
        l_uom,
        prod_code,
        prod_name,
        prod_uppp,
        SUM(pqty_stock) as puomqty,
        SUM(lqty_stock) as luomqty,
        SUM(pqty_picked) as puompicked,
        SUM(lqty_picked) as luompicked,
        SUM(pqty_avl) as puomavl,
        SUM(lqty_avl) as luomavl,
        uom_count,
        site_code
      FROM VW_STKLED
      ${whereClause}
      GROUP BY 
        p_uom,
        l_uom,
        site_code,
        prod_code,
        prod_name,
        prod_uppp,
        uom_count
      ORDER BY prod_code
    `;

    const result = await oracleDb.query(mainQuery, bindParams);

    // Check if result is empty and respond accordingly
    if (!result.rows) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "No data found" });
      return;
    }

    // Send successful response with data
    res
      .status(constants.STATUS_CODES.OK)
      .json({ success: true, data: { tableData: result.rows, count } });
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
    const result = await oracleDb.query(
      `SELECT * FROM MS_PICKWAVE WHERE company_code = :company_code`,
      { company_code: req.user.company_code }
    );
    
    const pickingOption = result.rows || [];

    // Check if picking options are found
    if (!pickingOption.length) {
      res
        .status(constants.STATUS_CODES.NOT_FOUND)
        .json({ success: false, message: "No picking options found" });
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
    
    // Simplified filtering - you'll need to adapt your actual filtering logic
    let whereClause = `WHERE company_code = :company_code`;
    const bindParams: any = { company_code: req.user.company_code };

    if (filter.search) {
      // Add your filtering logic here
    }

    // Count query
    const countQuery = `SELECT COUNT(*) as count FROM VW_WM_OUB_JOB_PICK_FILTER ${whereClause}`;
    const countResult = await oracleDb.query(countQuery, bindParams);
    const resultCount = countResult.rows?.[0]?.COUNT || 0;

    // Distinct field query
    const distinctQuery = `
      SELECT DISTINCT ${distinct_field}
      FROM VW_WM_OUB_JOB_PICK_FILTER
      ${whereClause}
      ORDER BY ${distinct_field}
    `;

    const result = await oracleDb.query(distinctQuery, bindParams);

    // Check if result is empty and respond accordingly
    if (!result.rows) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "No data found" });
      return;
    }

    // Send successful response with data
    res
      .status(constants.STATUS_CODES.OK)
      .json({ 
        success: true, 
        data: { 
          tableData: result.rows.map((row:any) => ({ [distinct_field as string]: row[distinct_field as string] })), 
          count: resultCount 
        } 
      });
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
  let connection: any;
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

    const company_code = (req.user as any).company_code;
    const updateSql = `
      UPDATE TO_BATCH SET selected = 'Y'
      WHERE company_code = :company_code
        AND prin_code = :prin_code
        AND job_no = :job_no
        AND key_number IN (:serial_no)
    `;

    let toggledPackets = 0;

    await oracleDb.withTransaction(async (conn: any) => {
      connection = conn;
      
      console.log('Executing update with sql:', updateSql);
      
      // Oracle doesn't support array binding directly for IN clause
      // We need to handle it differently
      if (serial_no.length > 0) {
        // Build dynamic IN clause
        const placeholders = serial_no.map((_, i) => `:serial_no_${i}`).join(',');
        const updateSqlDynamic = `
          UPDATE TO_BATCH SET selected = 'Y'
          WHERE company_code = :company_code
            AND prin_code = :prin_code
            AND job_no = :job_no
            AND key_number IN (${placeholders})
        `;
        
        const bindParams: any = {
          company_code,
          prin_code,
          job_no
        };
        
        serial_no.forEach((sn, i) => {
          bindParams[`serial_no_${i}`] = sn;
        });

        const updateResult = await oracleDb.query(updateSqlDynamic, bindParams, connection);
        toggledPackets = updateResult.rowsAffected || 0;
      }

      if (toggledPackets > 0) {
        // Call Oracle stored procedure
        await oracleDb.query(
          `BEGIN SP_WM_PICK_CONFIRM1(:vs_company_code, :vs_principal_code, :vs_job_no, :vdt_confirm); END;`,
          {
            vs_company_code: company_code,
            vs_principal_code: prin_code,
            vs_job_no: job_no,
            vdt_confirm: confirm_date || new Date(),
          },
          connection
        );

        // Unselect after procedure call
        if (serial_no.length > 0) {
          const placeholders = serial_no.map((_, i) => `:serial_no_${i}`).join(',');
          const unselectSql = `
            UPDATE TO_BATCH SET selected = 'Y'
            WHERE company_code = :company_code
              AND prin_code = :prin_code
              AND job_no = :job_no
              AND key_number IN (${placeholders})
          `;
          
          const bindParams: any = {
            company_code,
            prin_code,
            job_no
          };
          
          serial_no.forEach((sn, i) => {
            bindParams[`serial_no_${i}`] = sn;
          });

          await oracleDb.query(unselectSql, bindParams, connection);
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

// Function to pick an order
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
    let toggledPackets = 0;

    await oracleDb.withTransaction(async (connection: any) => {
      // Handle array binding for IN clause
      if (serial_no.length > 0) {
        const placeholders = serial_no.map((_, i) => `:serial_no_${i}`).join(',');
        const updateSql = `
          UPDATE TO_ORDER_DET
          SET selected = 'Y', PICKED = 'N'
          WHERE company_code = :company_code
            AND prin_code = :prin_code
            AND job_no = :job_no
            AND serial_no IN (${placeholders})
        `;
        
        const bindParams: any = {
          company_code,
          prin_code,
          job_no
        };
        
        serial_no.forEach((sn, i) => {
          bindParams[`serial_no_${i}`] = sn;
        });

        const updateResult = await oracleDb.query(updateSql, bindParams, connection);
        toggledPackets = updateResult.rowsAffected || 0;
      }

      if (toggledPackets > 0) {
        try {
          // Call Oracle stored procedure
          await oracleDb.query(
            `BEGIN SP_WM_OUB_PICKING_V3(:vs_company_code, :vs_principal_code, :vs_job_no, :vs_sort); END;`,
            {
              vs_company_code: company_code,
              vs_principal_code: prin_code,
              vs_job_no: job_no,
              vs_sort: ""
            },
            connection
          );
        } catch (procError) {
          // Procedure failed: revert update
          console.error("SP_WM_OUB_PICKING_V3 failed, reverting TO_ORDER_DET changes:", procError);

          if (serial_no.length > 0) {
            const placeholders = serial_no.map((_, i) => `:serial_no_${i}`).join(',');
            const unselectSql = `
              UPDATE TO_ORDER_DET
              SET selected = 'N'
              WHERE company_code = :company_code
                AND prin_code = :prin_code
                AND job_no = :job_no
                AND serial_no IN (${placeholders})
            `;
            
            const bindParams: any = {
              company_code,
              prin_code,
              job_no
            };
            
            serial_no.forEach((sn, i) => {
              bindParams[`serial_no_${i}`] = sn;
            });

            await oracleDb.query(unselectSql, bindParams, connection);
          }

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

    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};

    // Simplified filtering
    let whereClause = `WHERE company_code = :company_code`;
    const bindParams: any = { company_code: req.user.company_code };

    if (filter.search) {
      // Add your filtering logic here
    }

    // Fetch data for CSV export
    const result = await oracleDb.query(
      `SELECT * FROM PICKING_DETAILS_OUTBOUND_WMS_VIEW ${whereClause}`,
      bindParams
    );
    
    const fetchedData = result.rows || [];

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
    fetchedData.forEach((plainData:any) => {
      csvTransform.write(plainData);
    });

    // End the CSV stream and pipe it to the response
    csvTransform.end();
    csvTransform.pipe(res);
  } catch (error: any) {
    console.error("Export Error:", error);
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

    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};

    // Simplified filtering
    let whereClause = `WHERE company_code = :company_code`;
    const bindParams: any = { company_code: req.user.company_code };

    if (filter.search) {
      // Add your filtering logic here
    }

    // Fetch data for CSV export
    const result = await oracleDb.query(
      `SELECT * FROM VW_STKLED ${whereClause}`,
      bindParams
    );
    
    const fetchedData = result.rows || [];

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
    fetchedData.forEach((plainData:any) => {
      csvTransform.write(plainData);
    });

    console.log("\n\n\n\n\nfetchedData", fetchedData);

    // End the CSV stream and pipe it to the response
    csvTransform.end();
    csvTransform.pipe(res);
  } catch (error: any) {
    console.error("Export Error:", error);
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
    let toggledPackets = 0;

    await oracleDb.withTransaction(async (connection: any) => {
      // Handle array binding for IN clause
      if (serial_no.length > 0) {
        const placeholders = serial_no.map((_, i) => `:serial_no_${i}`).join(',');
        const updateSql = `
          UPDATE TO_BATCH SET selected = 'Y'
          WHERE company_code = :company_code
            AND prin_code = :prin_code
            AND job_no = :job_no
            AND key_number IN (${placeholders})
        `;
        
        const bindParams: any = {
          company_code,
          prin_code,
          job_no
        };
        
        serial_no.forEach((sn, i) => {
          bindParams[`serial_no_${i}`] = sn;
        });

        const updateResult = await oracleDb.query(updateSql, bindParams, connection);
        toggledPackets = updateResult.rowsAffected || 0;
      }

      if (toggledPackets > 0) {
        // Call Oracle stored procedure
        await oracleDb.query(
          `BEGIN sp_pick_cancel_confirmed(:vs_company_code, :vs_prin_code, :vs_job_no, :vs_freeze); END;`,
          {
            vs_company_code: company_code,
            vs_prin_code: prin_code,
            vs_job_no: job_no,
            vs_freeze: freeze || 'N',
          },
          connection
        );

        // Optional: Update again after procedure call
        if (toggledPackets > 0 && serial_no.length > 0) {
          const placeholders = serial_no.map((_, i) => `:serial_no_${i}`).join(',');
          const unselectSql = `
            UPDATE TO_BATCH SET selected = 'Y'
            WHERE company_code = :company_code
              AND prin_code = :prin_code
              AND job_no = :job_no
              AND key_number IN (${placeholders})
          `;
          
          const bindParams: any = {
            company_code,
            prin_code,
            job_no
          };
          
          serial_no.forEach((sn, i) => {
            bindParams[`serial_no_${i}`] = sn;
          });

          await oracleDb.query(unselectSql, bindParams, connection);
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