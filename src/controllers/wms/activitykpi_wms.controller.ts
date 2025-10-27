import { Response } from "express";
import * as fastCsv from "fast-csv";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { IActivityKPI } from "../../interfaces/wms/activity_wms.interface"; 
import ActivityKPI from "../../models/wms/activitykpi_wms_models";
import { activityKpiSchema } from "../../validation/wms/gm.validation";
import WmsCsvHeaders from "../../utils/exportCsv/WmsCsvHeaders";

export const createActivityKPI = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = activityKpiSchema(req.body, requestUser.company_code, false);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { prin_code, company_code } = req.body;

    const activityKpi = await ActivityKPI.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { prin_code: prin_code },
        ],
      },
    });

    if (activityKpi) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ACTIVITY_KPI_WMS.KPI_ALREADY_EXISTS,
      });
      return;
    }
    const createActivityKPI = await ActivityKPI.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      ...req.body,
    });
    if (!createActivityKPI) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating KPI" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.ACTIVITY_KPI_WMS.KPI_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const updateActivityKPI = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = activityKpiSchema(req.body, requestUser.company_code, false);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { prin_code, company_code } = req.body;

    const activityKpi = await ActivityKPI.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { prin_code: prin_code },
        ],
      },
    });

    if (!activityKpi) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ACTIVITY_KPI_WMS.KPI_DOES_NOT_EXISTS,
      });
      return;
    }
    const updateActivityKPI = await ActivityKPI.update(
      {
        company_code,
        updated_by: requestUser.loginid,
        ...req.body,
      },
      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { prin_code: prin_code },
          ],
        },
      }
    );
    if (!updateActivityKPI) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating KPI" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.ACTIVITY_KPI_WMS.KPI_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const createBulkActivityKPI = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = activityKpiSchema(req.body, requestUser.company_code, true);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    req.body = req.body.map((kpi: IActivityKPI) => ({
      ...kpi,
      updated_by: requestUser.loginid,
      created_by: requestUser.loginid,
    }));

    ActivityKPI.bulkCreate(req.body, { ignoreDuplicates: true });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "KPI " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const exportActivityKPI = async (req: RequestWithUser, res: Response) => {
  try {
    let fetchedData: any[] = [],
      csvTransform: fastCsv.CsvFormatterStream<
        fastCsv.FormatterRow,
        fastCsv.FormatterRow
      >;

    fetchedData = await ActivityKPI.findAll({
      where: { company_code: req.user.company_code },
    });
    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.MASTER.ACTIVITY_KPI,
    });

    // Set headers for CSV response before streaming
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="activity_kpi.csv"`);

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

export const deleteActivityKPI = async (req: RequestWithUser, res: Response) => {
  try {
    const princCodes = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ACTIVITY_KPI_WMS.SELECT_AT_LEAST_ONE_KPI,
      });
      return;
    }
    const kpiDeleteResponse = await ActivityKPI.destroy({
      where: {
        prin_code: princCodes,
      },
    });
    if (kpiDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: kpiDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.ACTIVITY_KPI_WMS.KPI_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
