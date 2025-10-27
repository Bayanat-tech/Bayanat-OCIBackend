/**
 * @fileoverview Controller for handling inbound job operations in WMS
 * @imports Required dependencies and models
 */
import { Response } from "express";
import { Op, QueryTypes } from "sequelize";
import constants from "../../../../helpers/constants";
import { getSearchFilterQuery } from "../../../../helpers/functions";
import {
  ISearch,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { IUser } from "../../../../interfaces/user.interface";
import { IGrnReport } from "../../../../interfaces/wms/transaction/inbound/inboundJobWms.interface";
import GrnReport from "../../../../models/wms/transaction/inbound/grnReport_wms.model";
import JobInboundWms from "../../../../models/wms/transaction/inbound/inboundJobWms.model";
// --------- Import Function From function.ts file ----------
import { formatData } from "../../../../helpers/functions";
import { groupByContainerNo } from "../../../../helpers/functions";
import { getTiPackdetSeriesData } from "../../../../helpers/functions";
import { sequelize } from "../../../../database/connection";
import { getTallyProductDataQ } from "../../../../utils/query";
import PackingDetailsInboundWmsView from "../../../../views/wms/transportation/inbound/packingDetails_wms.view";
import Product from "../../../../models/wms/product_wms.model";

/**
 * @function getInboundJob
 * @description Retrieves a single inbound job by job number
 * @param {RequestWithUser} req - Express request object with user data
 * @param {Response} res - Express response object
 * @returns {Promise<void>} JSON response with job data or error
 */
export const getInboundJob = async (req: RequestWithUser, res: Response) => {
  try {
    console.log(req.params);
    const { job_no } = req.params;

    // Query database for job data
    const jobdata = await JobInboundWms.findOne({
      where: { job_no },
    });

    if (!jobdata) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Job Data " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: jobdata,
    });
    return;
  } catch (error: unknown) {
    const knownError = error as { message: string };
    res
      .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: knownError.message });
  }
};

/**
 * @function getReports
 * @description Retrieves GRN reports with pagination, filtering and sorting
 * @param {RequestWithUser} req - Express request object with user data
 * @param {Response} res - Express response object
 * @returns {Promise<void>} JSON response with formatted report data or error
 */
export const getReports = async (req: RequestWithUser, res: Response) => {
  try {
    // Extract request parameters and setup pagination
    const requestUser: IUser = req.user;
    const { prin_code, job_no } = req.query;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = Number(page * limit - limit);
    console.log("inside GRN report1");
    const filter: ISearch = req.query.filter
      ? JSON.parse(req.query.filter)
      : {};

    // Build query conditions
    let insideQuery: any = [],
      outsideQuery = {
        [Op.and]: [
          { company_code: requestUser.company_code },
          { prin_code: prin_code },
          { job_no: job_no },
        ],
      };

    // Apply search filter
    outsideQuery = getSearchFilterQuery({
      insideQuery,
      filter: filter.search,
      outsideQuery,
    });
    console.log("inside GRN report2");

    // Get total count for pagination
    const totalCount = await GrnReport.count({ where: outsideQuery });

    // Fetch data with sorting and pagination
    const grnReportData: IGrnReport[] = (await GrnReport.findAll({
      where: outsideQuery,
      ...(!!filter?.sort &&
        Object.keys(filter?.sort).length > 0 && {
          order: [[filter?.sort.field_name, filter.sort.desc ? "DESC" : "ASC"]],
        }),
      offset: skip,
      limit: req.query.limit ? limit : totalCount,
    })) as unknown as IGrnReport[];

    // Process and format the report data
    const groupedData = groupByContainerNo(grnReportData);
    console.log("inside GRN report3");
    console.log("GRn report 3");
    const fetchedData = await Promise.all(
      groupedData.map((data) => formatData(data, getTiPackdetSeriesData))
    );
    console.log("inside GRN report4");

    // Send formatted response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      totalCount,
      data: fetchedData,
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};

export const getTallyProductData = async (
  req: RequestWithUser,
  res: Response
) => {
  const requestUser: IUser = req.user;
  const uniqueCode = req.query.prin_code;
  const uniqueCode2 = req.query.job_no;
  const uniqueCode3 = req.query.container_no;
  try {
    const fetchedData = await PackingDetailsInboundWmsView.findAll({
      where: {
        prin_code: uniqueCode,
        job_no: uniqueCode2,
        container_no: uniqueCode3,
      },
      include: [
        {
          model: Product,
          attributes: ["uom_count"],
          required: true, // INNER JOIN
          where: {
            prin_code: uniqueCode,
          },
        },
      ],
    });

    res.status(200).json({
      success: true,
      data: fetchedData,
    });
    return;
  } catch (error: any) {
    console.error("Export Error:", error); // Log the error for debugging
    res.status(400).json({ success: false, message: error.message });
  }
};
