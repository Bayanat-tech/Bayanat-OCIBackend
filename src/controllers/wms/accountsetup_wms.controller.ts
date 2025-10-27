import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Accountsetup from "../../models/wms/accountsetup_wms.model";

import { accountsetupSchema } from "../../validation/wms/gm.validation";

export const createAccountsetup = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = accountsetupSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { ac_code, company_code } = req.body;

    const accountsetup = await Accountsetup.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { ac_code: ac_code }],
      },
    });

    if (accountsetup) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.AC_SETUP_WMS.AC_SETUP_ALREADY_EXISTS,
      });
      return;
    }
    const createAccountsetup = await Accountsetup.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,

      ...req.body,
    });
    if (!createAccountsetup) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.AC_SETUP_WMS.AC_SETUP_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateAccountsetup = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = accountsetupSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { ac_code, company_code } = req.body;

    const accountsetup = await Accountsetup.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { ac_code: ac_code }],
      },
    });

    if (!accountsetup) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.AC_SETUP_WMS.AC_SETUP_DOES_NOT_EXISTS,
      });
      return;
    }
    const createAccountsetup = await Accountsetup.update(
      {
        company_code,
        updated_by: requestUser.loginid,

        ...req.body,
      },
      {
        where: {
          [Op.and]: [{ company_code: company_code }, { ac_code: ac_code }],
        },
      }
    );
    if (!createAccountsetup) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.AC_SETUP_WMS.AC_SETUP_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deleteAccountsetupes = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const accountsetupesCode = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.AC_SETUP_WMS.SELECT_AT_LEAST_ONE_AC_SETUP,
      });
      return;
    }
    const accountsetupesDeleteResponse = await Accountsetup.destroy({
      where: {
        ac_code: accountsetupesCode,
      },
    });
    if (accountsetupesDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: accountsetupesDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.AC_SETUP_WMS.AC_SETUP_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
