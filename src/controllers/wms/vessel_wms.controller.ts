import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import vessel from "../../models/wms/vessel_wms.model";

import { vesselSchema } from "../../validation/wms/gm.validation";

export const createVessel = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = vesselSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { vessel_code, company_code } = req.body;

    const Vessel = await vessel.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { vessel_code: vessel_code },
        ],
      },
    });

    if (Vessel) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.VESSEL_WMS.VESSEL_ALREADY_EXISTS,
      });
      return;
    }
    const createVessel = await vessel.create({
      company_code,
      ...req.body,
    });
    if (!createVessel) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating Vessel" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.VESSEL_WMS.VESSEL_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateVessel = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = vesselSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { vessel_code, company_code } = req.body;

    const Vessel = await vessel.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { vessel_code: vessel_code },
        ],
      },
    });

    if (!Vessel) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.VESSEL_WMS.VESSEL_DOES_NOT_EXISTS,
      });
      return;
    }
    const createVessel = await vessel.update(
      {
        company_code,
        ...req.body,
      },
      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { vessel_code: vessel_code },
          ],
        },
      }
    );
    if (!createVessel) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating Vessel" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.VESSEL_WMS.VESSEL_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deleteVessel = async (req: RequestWithUser, res: Response) => {
  try {
    const vessel_code = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.VESSEL_WMS.SELECT_AT_LEAST_ONE_VESSEL,
      });
      return;
    }
    const vesselDeleteResponse = await vessel.destroy({
      where: {
        vessel_code: vessel_code,
      },
    });
    if (vesselDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: vesselDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.VESSEL_WMS.VESSEL_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
