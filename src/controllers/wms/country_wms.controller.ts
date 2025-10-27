// Import required dependencies and interfaces
import { Response } from "express";
import * as fastCsv from "fast-csv";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { ICountry } from "../../interfaces/wms/gm_wms.interface";
import Country from "../../models/country_wms.model";
import WmsCsvHeaders from "../../utils/exportCsv/WmsCsvHeaders";
import { countrySchema } from "../../validation/wms/gm.validation";
import { createLog, notifyUser } from "../../helpers/functions";

// Controller to create a new country
export const createCountry = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    // Validate request body against schema
    const { error } = countrySchema(req.body, requestUser.company_code, false);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const { country_code, company_code } = req.body;

    // Check if country already exists
    const country = await Country.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { country_code: country_code },
        ],
      },
    });

    if (country) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.COUNTRY_WMS.COUNTRY_ALREADY_EXISTS,
      });
      return;
    }

    // Create new country record
    const createCountry = await Country.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      ...req.body,
    });

    if (!createCountry) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }

    // Create audit log and notify user
    await createLog({
      event: constants.EVENTS.COUNTRY_CREATED,
      request_user: requestUser,
      module: constants.MODULE.WMS,
      description: constants.MESSAGES.COUNTRY_WMS.COUNTRY_CREATED_SUCCESSFULLY,
    });
    await notifyUser({
      event: constants.EVENTS.COUNTRY_CREATED,
      request_user: requestUser,
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.COUNTRY_WMS.COUNTRY_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: "Error:" + error.message });
    return;
  }
};

// Controller to update an existing country
export const updateCountry = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    // Validate request body
    const { error } = countrySchema(req.body, requestUser.company_code, false);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { country_code, company_code } = req.body;

    // Check if country exists
    const country = await Country.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { country_code: country_code },
        ],
      },
    });

    if (!country) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.COUNTRY_WMS.COUNTRY_DOES_NOT_EXISTS,
      });
      return;
    }

    // Update country record
    const createCountry = await Country.update(
      {
        company_code,
        updated_by: requestUser.loginid,
        ...req.body,
      },
      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { country_code: country_code },
          ],
        },
      }
    );
    if (!createCountry) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.COUNTRY_WMS.COUNTRY_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

// Controller to create multiple countries in bulk
export const createBulkCountries = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    // Add user info to each country record
    req.body = req.body.map((country: ICountry[]) => ({
      ...country.reduce((acc: any, value: any, index: number) => {
        acc[constants.CSVFIELDNAME.COUNTRY[index]] = value;
        return acc;
      }, {}),
      updated_by: requestUser.loginid,
      created_by: requestUser.loginid,
      company_code: requestUser.company_code,
    }));

    // Bulk create countries
    Country.bulkCreate(req.body, { ignoreDuplicates: true });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Country " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

// Controller to export countries to CSV
export const exportCountry = async (req: RequestWithUser, res: Response) => {
  try {
    let fetchedData: any[] = [],
      csvTransform: fastCsv.CsvFormatterStream<
        fastCsv.FormatterRow,
        fastCsv.FormatterRow
      >;

    // Fetch all countries for company
    fetchedData = await Country.findAll({
      where: { company_code: req.user.company_code },
    });
    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.MASTER.COUNTRY,
    });

    // Set headers for CSV response before streaming
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="country.csv"`);

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

// Controller to delete multiple countries
export const deleteCountries = async (req: RequestWithUser, res: Response) => {
  try {
    const countriesCode = req.body;
    const requestUser = req.user;

    // Validate request
    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.COUNTRY_WMS.SELECT_AT_LEAST_ONE_COUNTRY,
      });
      return;
    }

    // Update last modifier before deletion
    await Country.update(
      {
        updated_by: requestUser.loginid,
      },
      {
        where: {
          country_code: countriesCode,
        },
      }
    );

    // Delete countries
    const countriesDeleteResponse = await Country.destroy({
      where: {
        country_code: countriesCode,
      },
    });
    if (countriesDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: countriesDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.COUNTRY_WMS.COUNTRY_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
