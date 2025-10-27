import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
//import Department from "../../models/wms/department_wms.model";
import Currency from "../../models/wms/currency_wms.model";
//import { departmentSchema } from "../../validation/wms/gm.validation";
import { currencySchema } from "../../validation/wms/gm.validation";

export const createcurrency = async (req: RequestWithUser, res: Response) => {
  try {
    //console.log("data aaya ki nhi in function bakend..yesr", req.body);
    const requestUser: IUser = req.user;
    //console.log("tt", requestUser);
    const { error } = currencySchema(req.body);

    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    //console.log("called0");

    const { curr_code, company_code } = req.body;
    const currency = await Currency.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { curr_code: curr_code }],
      },
    });

    if (currency) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.CURRENCY_WMS.CURRENCY_ALREADY_EXISTS,
      });
      return;
    }
    const createcurrency = await Currency.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      ...req.body,
    });
    if (!createcurrency) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.CURRENCY_WMS.CURRENCY_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updatecurrency = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = currencySchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { curr_code, company_code } = req.body;

    const currency = await Currency.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { curr_code: curr_code }],
      },
    });

    if (!currency) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.CURRENCY_WMS.CURRENCY_DOES_NOT_EXISTS,
      });
      return;
    }
    const createcurrency = await currency.update(
      {
        company_code,
        created_by: requestUser.loginid,
        updated_by: requestUser.loginid,
        ...req.body,
      },
      {
        where: {
          [Op.and]: [{ company_code: company_code }, { curr_code: curr_code }],
        },
      }
    );
    if (!createcurrency) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.CURRENCY_WMS.CURRENCY_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deletecurrencys = async (req: RequestWithUser, res: Response) => {
  try {
    const currencysCode = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.CURRENCY_WMS.SELECT_AT_LEAST_ONE_CURRENCY,
      });
      return;
    }
    const currencysDeleteResponse = await Currency.destroy({
      where: {
        curr_code: currencysCode,
      },
    });
    if (currencysDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: currencysDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.CURRENCY_WMS.CURRENCY_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
