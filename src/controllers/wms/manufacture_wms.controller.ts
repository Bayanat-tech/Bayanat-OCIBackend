import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Manufacture from "../../models/wms/manufacture_wms.model";
import { manufactureSchema } from "../../validation/wms/gm.validation";

export const createManufacture = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = manufactureSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { manu_code, company_code } = req.body;

    const manufacture = await Manufacture.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { manu_code: manu_code }],
      },
    });

    if (manufacture) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.MANUFACTURER_WMS.MANUFACTURER_ALREADY_EXISTS,
      });
      return;
    }
    const createManufacture = await Manufacture.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,

      ...req.body,
    });
    if (!createManufacture) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.MANUFACTURER_WMS.MANUFACTURER_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateManufacture = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = manufactureSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { manu_code, company_code } = req.body;

    const manufacture = await Manufacture.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { manu_code: manu_code }],
      },
    });

    if (!manufacture) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.MANUFACTURER_WMS.MANUFACTURER_DOES_NOT_EXISTS,
      });
      return;
    }
    const createManufacture = await Manufacture.update(
      {
        company_code,
        created_by: requestUser.loginid,
        updated_by: requestUser.loginid,

        ...req.body,
      },
      {
        where: {
          [Op.and]: [{ company_code: company_code }, { manu_code: manu_code }],
        },
      }
    );
    if (!createManufacture) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.MANUFACTURER_WMS.MANUFACTURER_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deleteManufactures = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const manuCode = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.MANUFACTURER_WMS.SELECT_AT_LEAST_ONE_MANUFACTURER,
      });
      return;
    }
    const manufacturesDeleteResponse = await Manufacture.destroy({
      where: {
        manu_code: manuCode,
      },
    });
    if (manufacturesDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: manufacturesDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.MANUFACTURER_WMS.MANUFACTURER_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
