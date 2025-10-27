import { Response } from "express";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { IUser } from "../../../../interfaces/user.interface";
//import { packingDetailsSchema } from "../../../../validation/wms/transaction/inbound.validation";
import { shipmentDetailsSchema } from "../../../../validation/wms/transaction/inbound.validation";
import constants from "../../../../helpers/constants";
//import Product from "../../../../models/wms/product_wms.model";
import { Op } from "sequelize";
//import Country from "../../../../models/wms/warehouse_wms.model";
//import PackingDetailsInboundWms from "../../../../models/wms/transaction/inbound/packingDetails_wms.model";
import ShipmentDetailsInboundWms from "../../../../models/wms/transaction/inbound/shipmantDetails_wms.model";
//import { IPackingDetails } from "../../../../interfaces/wms/transaction/inbound/packingDetails_wms.interface";
import { IShipmentDetails } from "../../../../interfaces/wms/transaction/inbound/shipmentDetails_wms.interface";
import * as fastCsv from "fast-csv";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { getSearchFilterQuery } from "../../../../helpers/functions";

export const getShipmentDetail = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { prin_code, job_no } = req.query;

    const shipmentDetails = await ShipmentDetailsInboundWms.findOne({
      where: {
        prin_code,
        job_no,
        company_code: req.user.company_code,
      },
    });

    if (!shipmentDetails) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "shipment Item " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }
    // const productInfo = await Product.findOne({
    //   where: {
    //     prod_code: shipmentDetails.dataValues.prod_code,
    //     company_code: req.user.company_code,
    //   },
    // });
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        ...shipmentDetails.dataValues,
        // prod_name: productInfo?.dataValues.prod_name,
        // uom_count: productInfo?.dataValues.uom_count,
        // uppp: productInfo?.dataValues.uppp,
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
export const createShipmentItem = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = shipmentDetailsSchema(
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
    // if (!!req.body.prod_code) {
    //   const productResponse = await Product.findOne({
    //     where: {
    //       [Op.and]: [
    //         { company_code: requestUser.company_code },
    //         { prod_code: req.body.prod_code },
    //       ],
    //     },
    //   });
    //   if (!productResponse) {
    //     res.status(constants.STATUS_CODES.NOT_FOUND).json({
    //       success: false,
    //       message: "Product " + constants.MESSAGES.NOT_FOUND,
    //     });
    //     return;
    //   }
    // }
    // if (!!req.body.country_code) {
    //   const countryResponse = await Country.findOne({
    //     where: {
    //       [Op.and]: [
    //         { company_code: requestUser.company_code },
    //         { country_code: req.body.country_code },
    //       ],
    //     },
    //   });
    //   if (!countryResponse) {
    //     res.status(constants.STATUS_CODES.NOT_FOUND).json({
    //       success: false,
    //       message: "Country " + constants.MESSAGES.NOT_FOUND,
    //     });
    //     return;
    //   }
    // }
    const response = await ShipmentDetailsInboundWms.create({
      ...req.body,
      //packdet_no: "",
      company_code: requestUser.company_code,
      //created_by: requestUser.loginid,
      //updated_by: requestUser.loginid,
    });
    if (!response) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: response });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Shipment Details " + constants.MESSAGES.CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const updateShipmentItem = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    console.log(requestUser);

    const { container_no, prin_code, job_no } = req.query;

    const { error } = shipmentDetailsSchema(
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
    //const { country_code, company_code } = req.body;

    const shipmentResponse = await ShipmentDetailsInboundWms.findOne({
      where: {
        [Op.and]: [
          { company_code: requestUser.company_code },
          { container_no },
          { prin_code },
          { job_no },
        ],
      },
    });

    if (!shipmentResponse) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND,
      });
      return;
    }
    const response = await ShipmentDetailsInboundWms.update(
      {
        //company_code,
        ...req.body,
        updated_by: requestUser.loginid,
      },
      {
        where: {
          [Op.and]: [
            { company_code: requestUser.company_code },
            { container_no },
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
      message: constants.MESSAGES.UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const deleteShipmentItem = async (
  req: RequestWithUser,
  res: Response
): Promise<any> => {
  try {
    const { shipment_details } = req.body;
    const requestUser = req.user;
    if (shipment_details.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one shipment item to delete",
      });
    }

    await Promise.all(
      shipment_details.map(
        async (shipmentDetail: {
          prin_code: string;
          job_no: string;
          container_no: string;
        }) => {
          const { prin_code, job_no, container_no } = shipmentDetail;

          return await ShipmentDetailsInboundWms.destroy({
            where: {
              prin_code,
              job_no,
              container_no,
              company_code: requestUser.company_code,
            },
          });
        }
      )
    );

    return res.status(200).json({
      success: true,
      message: "Deleted successfully",
    });
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const createBulkShipmentDetails = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = shipmentDetailsSchema(
      req.body,
      true,
      requestUser.company_code
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    req.body = req.body.map((shipmentDetail: IShipmentDetails) => ({
      ...shipmentDetail,
      updated_by: requestUser.loginid,
      created_by: requestUser.loginid,
    }));

    ShipmentDetailsInboundWms.bulkCreate(req.body, { ignoreDuplicates: true });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Shipment Details " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const exportShipmentDetails = async (
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
    fetchedData = await ShipmentDetailsInboundWms.findAll({
      where: outsideQuery,
    });
    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.TANSACTION.INBOUND.SHIPMENT_DETAIL,
    });

    // Set headers for CSV response before streaming
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="shipment_details.csv"`
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
