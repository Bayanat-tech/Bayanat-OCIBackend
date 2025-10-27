import { Response } from "express";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { IUser } from "../../../../interfaces/user.interface";
import { createInboundSchema } from "../../../../validation/wms/transaction/createinbound.validation";
//import Product from "../../../../models/wms/product_wms.model";
import { Op } from "sequelize";
import constants from "../../../../helpers/constants";
import { IJobInboundWms } from "../../../../interfaces/wms/transaction/inbound/inboundJobWms.interface";
import * as fastCsv from "fast-csv";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { getSearchFilterQuery } from "../../../../helpers/functions";
import createinboundjobWms from "../../../../views/wms/transportation/inbound/createinboundJobWms";

export const getInboundJob = async (req: RequestWithUser, res: Response) => {
  try {
    const { prin_code, job_no } = req.query;
    console.log("check prin value:", req.query);
    const createInboundjob = await createinboundjobWms.findOne({
      where: {
        prin_code,
        company_code: req.user.company_code,
      },
    });

    if (!createInboundjob) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "shipment Item " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        ...createInboundjob.dataValues,
      },
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
    const response = await createinboundjobWms.create({
      ...req.body,
      company_code: requestUser.company_code,
    });
    console.log("response", response);
    if (!response) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: response });
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

    const { prin_code, job_no } = req.query;

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
    const createInboundjobResponse = await createinboundjobWms.findOne({
      where: {
        [Op.and]: [
          { company_code: requestUser.company_code },
          { prin_code },
          { job_no },
        ],
      },
    });

    if (!createInboundjobResponse) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND,
      });
      return;
    }
    const response = await createinboundjobWms.update(
      {
        ...req.body,
        updated_by: requestUser.loginid,
      },
      {
        where: {
          [Op.and]: [
            { company_code: requestUser.company_code },
            { prin_code },
            { job_no },
          ],
        },
      }
    );
    if (!response) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: response });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Inbound Job " + constants.MESSAGES.UPDATED_SUCCESSFULLY,
      data: createInboundjobResponse,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
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

// has context menu
