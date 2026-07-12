import { Response } from "express";
import { ISearch } from "../../../../interfaces/common.interface";
import { RequestWithTenant } from "../../../../middleware/tenant.middleware";
import { shipmentDetailsSchema } from "../../../../validation/wms/transaction/inbound.validation";
import constants from "../../../../helpers/constants";
import { IShipmentDetails } from "../../../../interfaces/wms/transaction/inbound/shipmentDetails_wms.interface";
import * as fastCsv from "fast-csv";
import WmsCsvHeaders from "../../../../utils/exportCsv/WmsCsvHeaders";
import { ShipmentDetailsService } from "../../../../services/WMS/transaction/inbound/shipmentDetails.service";

const shipmentService = new ShipmentDetailsService();

export const getAllShipmentDetails = async (
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

    const { code, code2, page = 1, limit = 100 } = req.query;

    // Parse filter from query
    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter as string)
      : {};

    // Prepare filters
    const filters: any = {
      company_code: companyCode,
    };

    // Map code to job_no and code2 to prin_code
    if (code && code !== "undefined" && code !== "null") {
      filters.job_no = code;
    }
    if (code2 && code2 !== "undefined" && code2 !== "null") {
      filters.prin_code = code2;
    }

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 100;

    // Get sort from filter
    const sort = filter?.sort;

    const { data, total } = await shipmentService.findAllWithPagination(
      filters,
      pageNum,
      limitNum,
      sort
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data,
      total,
      page: pageNum,
      limit: limitNum,
    });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

export const getShipmentDetail = async (
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

    const { prin_code, job_no } = req.query;

    const shipmentDetails = await shipmentService.findOne(
      prin_code as string,
      job_no as string,
      companyCode
    );

    if (!shipmentDetails) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "shipment Item " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: shipmentDetails,
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
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

    const { error } = shipmentDetailsSchema(req.body, false, companyCode);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const response = await shipmentService.create({
      ...req.body,
      company_code: companyCode,
      user_id: req.user?.loginid,
    });

    if (!response) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Failed to create shipment" });
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
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

    const { container_no, prin_code, job_no } = req.query;

    const { error } = shipmentDetailsSchema(req.body, false, companyCode);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const shipmentResponse = await shipmentService.findOne(
      prin_code as string,
      job_no as string,
      companyCode
    );

    if (!shipmentResponse) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND,
      });
      return;
    }

    const updated = await shipmentService.update(
      prin_code as string,
      job_no as string,
      container_no as string,
      companyCode,
      {
        ...req.body,
        user_id: req.user?.loginid,
      }
    );

    if (!updated) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Update failed" });
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
  req: RequestWithTenant,
  res: Response
): Promise<any> => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
    }

    const { shipment_details } = req.body;

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

          return await shipmentService.delete(
            prin_code,
            job_no,
            container_no,
            companyCode
          );
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
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

    const { error } = shipmentDetailsSchema(req.body, true, companyCode);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const shipmentData = req.body.map((shipmentDetail: IShipmentDetails) => ({
      ...shipmentDetail,
      company_code: companyCode,
      user_id: req.user?.loginid,
    }));

    await shipmentService.bulkCreate(shipmentData);

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
  req: RequestWithTenant,
  res: Response
) => {
  try {
    const companyCode = req.user?.company_code;
    if (!companyCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code not found on authenticated user",
      });
      return;
    }

    let csvTransform: fastCsv.CsvFormatterStream<
      fastCsv.FormatterRow,
      fastCsv.FormatterRow
    >;
    let fetchedData: any[] = [];

    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter as string)
      : {};

    const searchFilter = filter.search || null;
    fetchedData = await shipmentService.findAll(companyCode, searchFilter);

    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.TANSACTION.INBOUND.SHIPMENT_DETAIL,
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="shipment_details.csv"`
    );

    fetchedData.forEach((eachData) => {
      csvTransform.write(eachData);
    });

    csvTransform.end();
    csvTransform.pipe(res);
  } catch (error: any) {
    console.error("Export Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};