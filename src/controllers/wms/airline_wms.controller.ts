import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import AirLine from "../../models/wms/airline_wms.model";
import { airlineSchema } from "../../validation/wms/gm.validation";

export const createAirLine = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = airlineSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { airline_code, company_code } = req.body;

    const airline = await AirLine.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { airline_code: airline_code },
        ],
      },
    });

    if (airline) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.AIRLINE_WMS.AIRLINE_ALREADY_EXISTS,
      });
      return;
    }
    const createAirLine = await AirLine.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,

      ...req.body,
    });
    if (!createAirLine) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating AirLine" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.AIRLINE_WMS.AIRLINE_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateAirLine = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = airlineSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { airline_code, company_code } = req.body;

    const airline = await AirLine.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { airline_code: airline_code },
        ],
      },
    });

    if (!airline) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.AIRLINE_WMS.AIRLINE_DOES_NOT_EXISTS,
      });
      return;
    }
    const createAirLine = await AirLine.update(
      {
        company_code,
        updated_by: requestUser.loginid,

        ...req.body,
      },
      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { airline_code: airline_code },
          ],
        },
      }
    );
    if (!createAirLine) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating AirLine" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.AIRLINE_WMS.AIRLINE_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deleteAirLines = async (req: RequestWithUser, res: Response) => {
  try {
    const airlineCode = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.AIRLINE_WMS.SELECT_AT_LEAST_ONE_AIRLINE,
      });
      return;
    }
    const airlinesDeleteResponse = await AirLine.destroy({
      where: {
        airline_code: airlineCode,
      },
    });
    if (airlinesDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: airlinesDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.AIRLINE_WMS.AIRLINE_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
