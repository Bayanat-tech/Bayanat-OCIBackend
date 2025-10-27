import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Brand from "../../models/wms/brand_wms.model";
import { brandSchema } from "../../validation/wms/gm.validation";

export const createBrand = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    //console.log("est", requestUser);

    const { error } = brandSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { brand_code, company_code } = req.body;

    const brand = await Brand.findOne({
      where: {
        [Op.and]: [{ company_code }, { brand_code }],
      },
    });

    if (brand) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BRAND_WMS.BRAND_ALREADY_EXISTS,
      });
      return;
    }
    const createBrand = await Brand.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,

      ...req.body,
    });
    if (!createBrand) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.BRAND_WMS.BRAND_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateBrand = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = brandSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { brand_code, company_code } = req.body;

    const brand = await Brand.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { brand_code: brand_code }],
      },
    });

    if (!brand) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.BRAND_WMS.BRAND_DOES_NOT_EXISTS,
      });
      return;
    }
    const createBrand = await Brand.update(
      {
        company_code,
        created_by: requestUser.loginid,
        updated_by: requestUser.loginid,

        ...req.body,
      },
      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { brand_code: brand_code },
          ],
        },
      }
    );
    if (!createBrand) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.BRAND_WMS.BRAND_UPDATED_SUCCESSFULLY,
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
        message: constants.MESSAGES.BRAND_WMS.SELECT_AT_LEAST_ONE_BRAND,
      });
      return;
    }
    const countriesDeleteResponse = await Brand.destroy({
      where: {
        brand_code: countriesCode,
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
      message: constants.MESSAGES.BRAND_WMS.BRAND_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
