import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Salesman from "../../models/wms/salesman_wms.model";
import { salesmanSchema } from "../../validation/wms/gm.validation";
export const createSalesman = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = salesmanSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { company_code, salesman_code } = req.body;
    //console.log("body", req.body);

    //console.log("rsesponse", req.body);

    const salesman = await Salesman.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { salesman_code: salesman_code },
        ],
      },
    });

    if (salesman) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.COUNTRY_WMS.COUNTRY_ALREADY_EXISTS,
      });
      return;
    }
    const createCountry = await Salesman.create({
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
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.COUNTRY_WMS.COUNTRY_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateSalesman = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = salesmanSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { company_code, salesman_code } = req.body;

    const country = await Salesman.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { salesman_code: salesman_code },
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
    const createCountry = await Salesman.update(
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
            { salesman_code: salesman_code },
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
