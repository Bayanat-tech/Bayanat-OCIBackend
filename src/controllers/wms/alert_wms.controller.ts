import { Response } from "express";
import * as fastCsv from "fast-csv";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { IAlert } from "../../interfaces/wms/gm_wms.interface";
import Alert from "../../models/wms/alert_wms_model";
import { alertSchema } from "../../validation/wms/gm.validation"; 
import WmsCsvHeaders from "../../utils/exportCsv/WmsCsvHeaders";

export const createAlert = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = alertSchema(req.body, requestUser.company_code, false);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const { op_code, company_code } = req.body;

    const alert = await Alert.findOne({
      where: {
        [Op.and]: [{ company_code }, { op_code }],
      },
    });

    if (alert) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ALERT.ALERT_ALREADY_EXISTS,
      });
      return;
    }

    const createAlert = await Alert.create({
      company_code:requestUser.company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      updated_at:new Date(),
      created_at:new Date(),
      ...req.body,
    });

    if (!createAlert) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating alert" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.ALERT.ALERT_CREATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};

export const updateAlert = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = alertSchema(req.body, requestUser.company_code, false);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const { op_code, company_code } = req.body;

    const alert = await Alert.findOne({
      where: {
        [Op.and]: [{ company_code }, { op_code }],
      },
    });

    if (!alert) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ALERT.ALERT_DOES_NOT_EXIST,
      });
      return;
    }

    const updateAlert = await Alert.update(
      {
        company_code,
        updated_by: requestUser.loginid,
        ...req.body,
      },
      {
        where: {
          [Op.and]: [{ company_code }, { op_code }],
        },
      }
    );

    if (!updateAlert) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating alert" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.ALERT.ALERT_UPDATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};

export const createBulkAlerts = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = alertSchema(req.body, requestUser.company_code, true);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    req.body = req.body.map((alert: IAlert) => ({
      ...alert,
      updated_by: requestUser.loginid,
      created_by: requestUser.loginid,
    }));

    Alert.bulkCreate(req.body, { ignoreDuplicates: true });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Alert " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};

export const exportAlert = async (req: RequestWithUser, res: Response) => {
  try {
    const fetchedData = await Alert.findAll({
      where: { company_code: req.user.company_code },
    });

    const csvTransform = fastCsv.format({
      headers: WmsCsvHeaders.MASTER.ALERT, // Update based on headers
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="alert.csv"`);

    fetchedData.forEach((eachData) => {
      csvTransform.write(eachData.get({ plain: true }));
    });

    csvTransform.end();
    csvTransform.pipe(res);
  } catch (error: any) {
    console.error("Export Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteAlerts = async (req: RequestWithUser, res: Response) => {
  try {
    const alertCodes = req.body;

    if (!alertCodes.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ALERT.SELECT_AT_LEAST_ONE_ALERT,
      });
      return;
    }

    const deleteResponse = await Alert.destroy({
      where: {
        op_code: alertCodes,
      },
    });

    if (deleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ALERT.ALERT_DELETED_FAILED,
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.ALERT.ALERT_DELETED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};
