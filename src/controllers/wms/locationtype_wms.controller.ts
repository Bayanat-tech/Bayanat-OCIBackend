import { Response } from "express";
import * as fastCsv from "fast-csv";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { LocationtypeSchema } from "../../validation/wms/gm.validation";
import WmsCsvHeaders from "../../utils/exportCsv/WmsCsvHeaders";
import LocationType from "../../models/wms/locationtype_wms.model";
import { ILocationType } from "../../interfaces/wms/locationtype_wms.interface";

export const createLocationType = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = LocationtypeSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { loc_type, company_code } = req.body;

    const locationType = await LocationType.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { loc_cbm: loc_type }],
      },
    });

    if (locationType) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.LOCATIONTYPE_WMS.LOCATIONTYPE_ALREADY_EXISTS,
      });
      return;
    }
    const createLocationType = await LocationType.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,

      ...req.body,
    });
    if (!createLocationType) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.LOCATIONTYPE_WMS.LOCATIONTYPE_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateLocationType = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = LocationtypeSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { company_code, loc_cbm } = req.body;

    const locationtype = await LocationType.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { loc_cbm: loc_cbm }],
      },
    });

    if (!locationtype) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.LOCATIONTYPE_WMS.LOCATIONTYPE_ALREADY_EXISTS,
      });
      return;
    }
    const createLocationType = await LocationType.update(
      {
        company_code,
        updated_by: requestUser.loginid,

        ...req.body,
      },
      {
        where: {
          [Op.and]: [{ company_code: company_code }, { loc_cbm: loc_cbm }],
        },
      }
    );
    if (!createLocationType) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.LOCATIONTYPE_WMS.LOCATIONTYPE_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const createBulkLocationType = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = LocationtypeSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    req.body = req.body.map((country: ILocationType) => ({
      ...country,
      updated_by: requestUser.loginid,
      created_by: requestUser.loginid,
    }));

    LocationType.bulkCreate(req.body, { ignoreDuplicates: true });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "LocationType " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const exportBulkLocationType = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    let fetchedData: any[] = [],
      csvTransform: fastCsv.CsvFormatterStream<
        fastCsv.FormatterRow,
        fastCsv.FormatterRow
      >;

    fetchedData = await LocationType.findAll({
      where: { company_code: req.user.company_code },
    });
    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.MASTER.LOCTIONTYPE,
    });

    // Set headers for CSV response before streaming
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="locationtype.csv"`
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
