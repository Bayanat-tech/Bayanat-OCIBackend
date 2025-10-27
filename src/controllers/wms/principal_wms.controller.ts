// Import required dependencies
import { Response } from "express";
import * as fastCsv from "fast-csv";
import { Op } from "sequelize";
import { sequelize } from "../../database/connection";
import constants from "../../helpers/constants";
import { IFiles, RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Files from "../../models/files.model";
import PrincipalContactDetl from "../../models/wms/principal_contact_details_wms.model";
import Principal from "../../models/wms/principal_wms.model";
import PrincipalWmsView from "../../views/wms/principal_wms.view";
import { principalSchema } from "../../validation/wms/gm.validation";
import { IPrincipalWms } from "../../interfaces/wms/principal_wms.interface";
import WmsCsvHeaders from "../../utils/exportCsv/WmsCsvHeaders";

/**
 * Creates a new principal record with contact details and files
 * @param req Request object containing principal data
 * @param res Response object
 */
export const createPrincipal = async (req: RequestWithUser, res: Response) => {
  try {
    // Validate request data
    const requestUser = req.user;
    const { error } = principalSchema(
      req.body,
      requestUser.company_code,
      false
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    // Destructure request body
    const {
        prin_cont1,
        prin_cont2,
        prin_cont3,
        prin_cont_email1,
        prin_cont_email2,
        prin_cont_email3,
        prin_cont_telno1,
        prin_cont_telno2,
        prin_cont_telno3,
        prin_cont_faxno1,
        prin_cont_faxno2,
        prin_cont_faxno3,
        prin_cont_ref1,
        files,
        ...prinicipalPayload
      } = req.body,
      created_by = requestUser.loginid,
      updated_by = requestUser.loginid;

    // Create principal record
    const principalData = await Principal.create({
      created_by,
      updated_by,
      prin_code: "",
      ...prinicipalPayload,
    });
    if (!principalData) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Principal data creation failed" });
      return;
    }

    // Get session code for the user
    const getSessionCode: { code: string }[][] = (await sequelize.query(
      `SELECT code from GT_SESSION_INFO WHERE USERID='${req.user.loginid}'`
    )) as { code: string }[][];

    // Create contact details
    const contactDetails = await PrincipalContactDetl.create({
      company_code: req.body.company_code,
      prin_code: getSessionCode[0][0].code,
      prin_cont1,
      prin_cont2,
      prin_cont3,
      prin_cont_email1,
      prin_cont_email2,
      prin_cont_email3,
      prin_cont_telno1,
      prin_cont_telno2,
      prin_cont_telno3,
      prin_cont_faxno1,
      prin_cont_faxno2,
      prin_cont_faxno3,
      prin_cont_ref1,
      created_by,
      updated_by,
    });

    if (!contactDetails) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: `Principal data creation failed`,
      });
      return;
    }

    // Process and create files if any
    files.forEach((item: any) => {
      item.request_number = "PRI" + getSessionCode[0][0].code;
    });
    if (!!files && files.length) {
      await Files.bulkCreate(
        (files as IFiles[]).map((eachFile) => {
          return {
            ...eachFile,
            request_number: "PRI" + getSessionCode[0][0].code,
          };
        })
      );
    }

    // Return success response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${getSessionCode[0][0].code} Principal ${constants.MESSAGES.CREATED_SUCCESSFULLY}`,
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
 * Updates an existing principal record
 * @param req Request object containing updated principal data
 * @param res Response object
 */
export const updatePrincipal = async (req: RequestWithUser, res: Response) => {
  try {
    // Get request data and validate
    const requestUser = req.user;
    const { prin_code } = req.params;
    console.log("req.body", req.body);
    const { error } = principalSchema(
      req.body,
      requestUser.company_code,
      false
    );
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    // Destructure request body
    const {
        prin_cont1,
        prin_cont2,
        prin_cont3,
        prin_cont_email1,
        prin_cont_email2,
        prin_cont_email3,
        prin_cont_telno1,
        prin_cont_telno2,
        prin_cont_telno3,
        prin_cont_faxno1,
        prin_cont_faxno2,
        prin_cont_faxno3,
        prin_cont_ref1,
        files,
        ...prinicipalPayload
      } = req.body,
      updated_by = requestUser.loginid;

    // Check if principal exists
    const existingPrincipalData = await Principal.findOne({
      where: {
        [Op.and]: [{ prin_code: prin_code }],
      },
    });

    if (!existingPrincipalData) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Principal " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    // Process files
    files.forEach((item: any) => {
      item.request_number = "PRI" + prin_code;
    });

    // Update principal data
    const principalData = await Principal.update(
      {
        updated_by,
        prin_code,
        ...prinicipalPayload,
      },
      {
        where: { prin_code },
      }
    );
    if (!principalData) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Principal data updation failed" });
      return;
    }

    // Update contact details
    const contactDetails = await PrincipalContactDetl.update(
      {
        company_code: req.body.company_code,
        prin_code: req.body.prin_code,
        prin_cont1,
        prin_cont2,
        prin_cont3,
        prin_cont_email1,
        prin_cont_email2,
        prin_cont_email3,
        prin_cont_telno1,
        prin_cont_telno2,
        prin_cont_telno3,
        prin_cont_faxno1,
        prin_cont_faxno2,
        prin_cont_faxno3,
        prin_cont_ref1,
        updated_by,
      },
      { where: { prin_code, company_code: req.body.company_code } }
    );
    if (!contactDetails) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Principal data updation failed" });
      return;
    }

    // Create new files if any
    if (!!files && files.length) {
      await Files.bulkCreate(files);
    }

    // Return success response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `Principal ${constants.MESSAGES.UPDATED_SUCCESSFULLY}`,
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
 * Retrieves principal data by code
 * @param req Request object containing principal code
 * @param res Response object
 */
export const getPrincipal = async (req: RequestWithUser, res: Response) => {
  try {
    const { prin_code } = req.params;
    const { company_code } = req.user;

    // Get principal and contact details
    const principalData = await Principal.findOne({
      where: { prin_code, company_code },
    });
    const contactdetails = await PrincipalContactDetl.findOne({
      where: { prin_code },
    });

    if (!principalData || !contactdetails) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Principal " + constants.MESSAGES.DOES_NOT_EXISTS,
      });
      return;
    }

    // Return combined data
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: { ...principalData.dataValues, ...contactdetails.dataValues },
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
 * Creates multiple principal records in bulk
 * @param req Request object containing array of principal data
 * @param res Response object
 */
export const createBulkPrincipal = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    // Validate request data
    const { error } = principalSchema(req.body, requestUser.company_code, true);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    // Add user info to each principal record
    req.body = req.body.map((principal: IPrincipalWms) => ({
      ...principal,
      updated_by: requestUser.loginid,
      created_by: requestUser.loginid,
    }));

    // Bulk create principals
    Principal.bulkCreate(req.body, { ignoreDuplicates: true });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Principal " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

/**
 * Exports principal data to CSV file
 * @param req Request object containing user info
 * @param res Response object
 */
export const exportPrincipal = async (req: RequestWithUser, res: Response) => {
  try {
    let fetchedData: any[] = [],
      csvTransform: fastCsv.CsvFormatterStream<
        fastCsv.FormatterRow,
        fastCsv.FormatterRow
      >;

    // Fetch principal data for current user
    fetchedData = await PrincipalWmsView.findAll({
      where: {
        [Op.and]: [
          { company_code: req.user.company_code },
          { user_id: req.user.loginid },
        ],
      },
    });

    // Configure CSV formatter
    csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.MASTER.PRINCIPAL,
    });

    // Set headers for CSV response before streaming
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="principal.csv"`
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
