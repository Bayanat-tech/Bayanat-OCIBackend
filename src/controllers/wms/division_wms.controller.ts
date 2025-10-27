import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
//import { RequestWithUser } from "../../interfaces/cmmon.interface";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Division from "../../models/wms/division_wms.model";
import { divisionSchema } from "../../validation/wms/gm.validation";

export const CreateDivision = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = divisionSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { div_code, company_code } = req.body;

    const harmonize = await Division.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { div_code: div_code }],
      },
    });

    if (!Division) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.DIVISION_WMS.DIVISION_ALREADY_EXISTS,
      });
      return;
    }
    const createHarmonize = await Division.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      user_id: requestUser.loginid,
      ...req.body,
    });
    if (!createHarmonize) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DIVISION_WMS.DIVISION_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateDivision = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = divisionSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { div_code, company_code } = req.body;

    const division = await Division.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { div_code: div_code }],
      },
    });

    if (!division) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.DIVISION_WMS.DIVISION_DOES_NOT_EXISTS,
      });
      return;
    }

    const CreateDivision = await Division.update(
      {
        company_code,
        created_by: requestUser.loginid,
        updated_by: requestUser.loginid,

        ...req.body,
      },
      {
        where: {
          [Op.and]: [{ company_code: company_code }, { div_code: div_code }],
        },
      }
    );
    if (!CreateDivision) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DIVISION_WMS.DIVISION_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deleteCountries = async (req: RequestWithUser, res: Response) => {
  try {
    const countriesCode = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.HARMONIZE_WMS.SELECT_AT_LEAST_ONE_HARMONIZE,
      });
      return;
    }
    const countriesDeleteResponse = await Division.destroy({
      where: {
        div_code: countriesCode,
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
      message: constants.MESSAGES.DIVISION_WMS.DIVISION_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
