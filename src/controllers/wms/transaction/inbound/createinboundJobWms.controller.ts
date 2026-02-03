import { Response } from "express";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { IUser } from "../../../../interfaces/user.interface";
import { createInboundSchema } from "../../../../validation/wms/transaction/createinbound.validation";
import constants from "../../../../helpers/constants";
import { IJobInboundWms } from "../../../../interfaces/wms/transaction/inbound/inboundJobWms.interface";
import * as fastCsv from "fast-csv";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { getSearchFilterQuery } from "../../../../helpers/functions";
import { PackingDetailsService } from "../../../../services/WMS/transaction/inbound/packingDetails.service"; // ADD THIS
import { ProductService } from "../../../../services/WMS/product.service"; // ADD THIS
import { PackingDetailsInboundWms } from "../../../../entities/wms/transportation/inbound/PackingDetailsInboundWms.entity"; // ADD THIS
import { InboundJobWmsService } from "../../../../services/WMS/transaction/inbound/inboundJobWms.service";
import oracledb from "oracledb";
import { oracleDb } from "../../../../database/connection";

export const getInboundJob = async (req: RequestWithUser, res: Response) => {
  try {
    const { job_no } = req.params;
    const { prin_code } = req.query;
    console.log("check prin value:", req.query);
    console.log("job_no from params:", job_no);
    
    const createInboundjob = await InboundJobWmsService.findOne({
      company_code: req.user.company_code,
      prin_code: prin_code as string,
      job_no: job_no as string,
    });

    if (!createInboundjob) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "shipment Item " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }
      // Get packing details for this job
      let packingDetails: PackingDetailsInboundWms[] = [];
      try {
        // Using the PackingDetailsService.findAll() method with where conditions
        packingDetails = await PackingDetailsService.findAll({
          where: {
            company_code: req.user.company_code,
            prin_code: prin_code as string,
            job_no: job_no as string,
          },
          order: {
            packdet_no: "ASC"
          }
        });
      } catch (error: any) {
        console.warn("Could not fetch packing details:", error.message);
        packingDetails = [];
      }

      // Define type for packing details with product info
      interface PackingDetailWithProduct {
        packdet_no: number;
        prod_code: string;
        prod_name: string;
        qty_puom: number;
        p_uom: string;
        qty_luom: number;
        l_uom: string;
        quantity: number;
        batch_no: string | null;
        lot_no: string | null;
        mfg_date: Date | null;
        exp_date: Date | null;
        po_no: string | null;
        origin_country: string | null;
        manu_code: string | null;
        gross_weight: number | null;
        volume: number | null;
        shelf_life_days: number | null;
        shelf_life_date: Date | null;
        container_no: string | null;
        bl_no: string | null;
        doc_ref: string | null;
        uom_count: number;
        uppp: number;
        upp: number;
      }

      // Get product information for each packing detail
      const packingDetailsWithProducts: PackingDetailWithProduct[] = [];
      if (packingDetails && packingDetails.length > 0) {
        for (const detail of packingDetails) {
          try {
            let productInfo = null;
            if (detail.prod_code) {
              productInfo = await ProductService.findByCodeAndCompany(
                detail.prod_code,
                req.user.company_code
              );
            }
            
            // Create the packing detail object with all necessary fields
            const packingDetailObj: PackingDetailWithProduct = {
              packdet_no: detail.packdet_no,
              prod_code: detail.prod_code || '',
              prod_name: productInfo?.prod_name || '',
              qty_puom: detail.qty_puom || 0,
              p_uom: detail.p_uom || '',
              qty_luom: detail.qty_luom || 0,
              l_uom: detail.l_uom || '',
              quantity: detail.quantity || 0,
              batch_no: detail.batch_no || null,
              lot_no: detail.lot_no || null,
              mfg_date: detail.mfg_date || null,
              exp_date: detail.exp_date || null,
              po_no: detail.po_no || null,
              origin_country: detail.origin_country || null,
              manu_code: detail.manu_code || null,
              gross_weight: detail.gross_weight || null,
              volume: detail.volume || null,
              shelf_life_days: detail.shelf_life_days || null,
              shelf_life_date: detail.shelf_life_date || null,
              container_no: detail.container_no || null,
              bl_no: detail.bl_no || null,
              doc_ref: detail.doc_ref || null,
              uom_count: productInfo?.uom_count || 0,
              uppp: productInfo?.uppp || 0,
              upp: productInfo?.upp || 0
            };
            
            packingDetailsWithProducts.push(packingDetailObj);
          } catch (error: any) {
            console.warn(`Error fetching product info for ${detail.prod_code}:`, error.message);
            // Add basic info even if product fetch fails
            packingDetailsWithProducts.push({
              packdet_no: detail.packdet_no,
              prod_code: detail.prod_code || '',
              prod_name: '',
              qty_puom: detail.qty_puom || 0,
              p_uom: detail.p_uom || '',
              qty_luom: detail.qty_luom || 0,
              l_uom: detail.l_uom || '',
              quantity: detail.quantity || 0,
              batch_no: detail.batch_no || null,
              lot_no: detail.lot_no || null,
              mfg_date: detail.mfg_date || null,
              exp_date: detail.exp_date || null,
              po_no: detail.po_no || null,
              origin_country: detail.origin_country || null,
              manu_code: detail.manu_code || null,
              gross_weight: detail.gross_weight || null,
              volume: detail.volume || null,
              shelf_life_days: detail.shelf_life_days || null,
              shelf_life_date: detail.shelf_life_date || null,
              container_no: detail.container_no || null,
              bl_no: detail.bl_no || null,
              doc_ref: detail.doc_ref || null,
              uom_count: 0,
              uppp: 0,
              upp: 0
            });
          }
        }
      }

      // Create the combined response
      const responseData = {
        ...createInboundjob,
        packing_details: packingDetailsWithProducts
      };

      console.log(`Job ${job_no} with ${packingDetailsWithProducts.length} packing items`);
      
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        data: responseData,
      });
      return;
    } catch (error: unknown) {
      const knownError = error as { message: string };
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: knownError.message });
    }
  };
export const createInboundjob = async (req: RequestWithUser, res: Response) => {
  try {
    console.log("inside inbound create", req.body);
    const requestUser: IUser = req.user;
    const { error } = createInboundSchema(
      req.body,
      false,
      requestUser.company_code
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    
    const response = await InboundJobWmsService.create({
      ...req.body,
      company_code: requestUser.company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
    });
    
    console.log("response", response);
    if (!response) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Failed to create inbound job" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: ` ${req.body.job_no} ${req.body.job_type === 'EXP' ? 'Outbound Job' : 'Inbound Job'} ${constants.MESSAGES.CREATED_SUCCESSFULLY}`,
    });

    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const GetsingleInboundjob = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    console.log("inside inbound edit");
    const requestUser: IUser = req.user;
    console.log(requestUser);

    const { job_no } = req.params;
    const { prin_code } = req.query;

    const { error } = createInboundSchema(
      req.body,
      false,
      requestUser.company_code
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    
    const createInboundjobResponse = await InboundJobWmsService.findOne({
      company_code: requestUser.company_code,
      prin_code: prin_code as string,
      job_no: job_no as string,
    });

    if (!createInboundjobResponse) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND,
      });
      return;
    }
    
    const updatedRecord = await InboundJobWmsService.update(
      {
        company_code: requestUser.company_code,
        prin_code: prin_code as string,
        job_no: job_no as string,
      },
      {
        ...req.body,
        updated_by: requestUser.loginid,
      }
    );
    
    if (!updatedRecord) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Failed to update inbound job" });
      return;
    }
    
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Inbound Job " + constants.MESSAGES.UPDATED_SUCCESSFULLY,
      data: updatedRecord,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const cancelInboundJob = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { job_no, prin_code } = req.body; // Get both from body

    // Validate required fields
    if (!prin_code) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "prin_code is required",
      });
      return;
    }

    if (!job_no) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "job_no is required",
      });
      return;
    }

    // Check if inbound job exists
    const existingJob = await InboundJobWmsService.findOne({
      company_code: requestUser.company_code,
      prin_code: prin_code,
      job_no: job_no,
    });

    if (!existingJob) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Inbound Job " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    // Check if already cancelled
    if (existingJob.canceled === 'Y') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Inbound Job is already cancelled",
      });
      return;
    }

    // Cancel the job
    const cancelledJob = await InboundJobWmsService.cancel(
      {
        company_code: requestUser.company_code,
        prin_code: prin_code,
        job_no: job_no,
      },
      requestUser.loginid
    );

    if (!cancelledJob) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to cancel inbound job",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `Inbound Job ${job_no} ${constants.MESSAGES.UPDATED_SUCCESSFULLY}`,
      data: cancelledJob,
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
    return;
  }
};

// export const deleteShipmentItem = async (
//   req: RequestWithUser,
//   res: Response
// ): Promise<any> => {
//   try {
//     const { shipment_details } = req.body;
//     const requestUser = req.user;
//     if (shipment_details.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Please provide at least one shipment item to delete",
//       });
//     }

//     await Promise.all(
//       shipment_details.map(
//         async (shipmentDetail: {
//           prin_code: string;
//           job_no: string;
//           //packdet_no: number;
//         }) => {
//           const { prin_code, job_no } = shipmentDetail;

//           return await ShipmentDetailsInboundWms.destroy({
//             where: {
//               prin_code,
//               job_no,
//               //packdet_no,
//               company_code: requestUser.company_code,
//             },
//           });
//         }
//       )
//     );

//     return res.status(200).json({
//       success: true,
//       message: "Deleted successfully",
//     });
//   } catch (error: any) {
//     res
//       .status(constants.STATUS_CODES.BAD_REQUEST)
//       .json({ success: false, message: error.message });
//     return;
//   }
// };
// export const createBulkShipmentDetails = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     const requestUser: IUser = req.user;

//     const { error } = shipmentDetailsSchema(
//       req.body,
//       true,
//       requestUser.company_code
//     );
//     if (error) {
//       res
//         .status(constants.STATUS_CODES.BAD_REQUEST)
//         .json({ success: false, message: error.message });
//       return;
//     }
//     req.body = req.body.map((shipmentDetail: IShipmentDetails) => ({
//       ...shipmentDetail,
//       updated_by: requestUser.loginid,
//       created_by: requestUser.loginid,
//     }));

//     ShipmentDetailsInboundWms.bulkCreate(req.body, { ignoreDuplicates: true });

//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: "Shipment Details " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
//     });
//     return;
//   } catch (error: any) {
//     res
//       .status(constants.STATUS_CODES.BAD_REQUEST)
//       .json({ success: false, message: error.message });
//     return;
//   }
// };
// export const exportShipmentDetails = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     let csvTransform: fastCsv.CsvFormatterStream<
//       fastCsv.FormatterRow,
//       fastCsv.FormatterRow
//     >;
//     let fetchedData: any[] = [];

//     const filter: ISearch = req.query.filter
//       ? JSON.parse(req.query.filter)
//       : {};

//     let insideQuery: any = [],
//       outsideQuery = {
//         [Op.and]: [{ company_code: req.user.company_code }],
//       };

//     outsideQuery = getSearchFilterQuery({
//       insideQuery,
//       filter: filter.search,
//       outsideQuery,
//     });
//     fetchedData = await ShipmentDetailsInboundWms.findAll({
//       where: outsideQuery,
//     });
//     csvTransform = fastCsv.format({
//       headers: WmsCsvHeaders.TANSACTION.INBOUND.SHIPMENT_DETAIL,
//     });

//     // Set headers for CSV response before streaming
//     res.setHeader("Content-Type", "text/csv");
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename="shipment_details.csv"`
//     );

//     // Write data to the CSV stream
//     fetchedData.forEach((eachData) => {
//       const plainData = eachData.get({ plain: true });
//       csvTransform.write(plainData); // Write each row to the CSV stream
//     });

//     // End the CSV stream and pipe it to the response
//     csvTransform.end(); // Complete the CSV data transformation
//     csvTransform.pipe(res); // Pipe CSV data into the HTTP response
//   } catch (error: any) {
//     console.error("Export Error:", error); // Log the error for debugging
//     res.status(400).json({ success: false, message: error.message });
//   }
// };

/**
//  * @function cancelConfirmedInboundJob
//  * @description Calls Oracle stored procedure sp_cancel_confirmedjob_inb to cancel a confirmed inbound job
 */
export const cancelConfirmedInboundJob = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection: oracledb.Connection | null = null;

  try {
    console.log("Starting cancelConfirmedInboundJob process...");
    const { prin_code, job_no, remarks } = req.body;
    const company_code = req.user.company_code;

    // Validate required fields
    if (!prin_code) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "prin_code is required",
      });
      return;
    }

    if (!job_no) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "job_no is required",
      });
      return;
    }

    console.log("Parameters:", {
      company_code,
      prin_code,
      job_no,
      remarks: remarks || "",
    });

    connection = await oracleDb.getConnection();

    // Call the Oracle stored procedure
    const callProc = `
      BEGIN
        sp_cancel_confirmedjob_inb(:as_company_code, :as_prin_code, :as_jobno, :as_remarks);
      END;
    `;

    console.log("Calling stored procedure sp_cancel_confirmedjob_inb...");
    await connection.execute(
      callProc,
      {
        as_company_code: company_code,
        as_prin_code: prin_code,
        as_jobno: job_no,
        as_remarks: remarks || "",
      },
      { autoCommit: true }
    );

    console.log("Stored procedure executed successfully.");

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `Confirmed Inbound Job ${job_no} cancelled successfully`,
    });
  } catch (error: any) {
    console.error("Oracle sp_cancel_confirmedjob_inb Error:", error);

    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message || "Error cancelling confirmed inbound job.",
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

// has context menu
