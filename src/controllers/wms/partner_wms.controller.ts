import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import partner from "../../models/wms/partner_wms.model";
import { partnerSchema } from "../../validation/wms/gm.validation";

export const createPartner = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = partnerSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { broker_code, company_code } = req.body;

    const Partner = await partner.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { broker_code: broker_code },
        ],
      },
    });

    if (Partner) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PARTNER_WMS.PARTNER_ALREADY_EXISTS,
      });
      return;
    }
    const createPartner = await partner.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,

      ...req.body,
    });

    if (!createPartner) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating Partner" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.PARTNER_WMS.PARTNER_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updatePartner = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = partnerSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { broker_code, company_code } = req.body;

    const Partner = await partner.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { broker_code: broker_code },
        ],
      },
    });

    if (!Partner) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PARTNER_WMS.PARTNER_DOES_NOT_EXISTS,
      });
      return;
    }
    const createPartner = await partner.update(
      {
        company_code,
        ...req.body,
      },
      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { broker_code: broker_code },
          ],
        },
      }
    );
    if (!createPartner) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating Partner" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.PARTNER_WMS.PARTNER_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deletePartner = async (req: RequestWithUser, res: Response) => {
  try {
    const broker_code = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PARTNER_WMS.SELECT_AT_LEAST_ONE_PARTNER,
      });
      return;
    }
    const partnerDeleteResponse = await partner.destroy({
      where: {
        broker_code: broker_code,
      },
    });
    if (partnerDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: partnerDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.PARTNER_WMS.PARTNER_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
