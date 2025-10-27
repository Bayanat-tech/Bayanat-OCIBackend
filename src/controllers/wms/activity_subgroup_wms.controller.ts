import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Activitysubgroup from "../../models/wms/activity_subgroup.model";
import { activitysubgroupSchema } from "../../validation/wms/gm.validation";

export const createActivitysubgroup = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = activitysubgroupSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { activity_subgroup_code, company_code } = req.body;

    const activitysubgroup = await Activitysubgroup.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { activity_subgroup_code: activity_subgroup_code },
        ],
      },
    });

    if (activitysubgroup) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.ACTIVITY_SUBGROUP_WMS
            .ACTIVITY_SUBGROUP_ALREADY_EXISTS,
      });
      return;
    }
    const createCountry = await Activitysubgroup.create({
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
      message:
        constants.MESSAGES.ACTIVITY_SUBGROUP_WMS
          .ACTIVITY_SUBGROUP_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateActivitysubgroup = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = activitysubgroupSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { activity_subgroup_code, company_code } = req.body;

    const country = await Activitysubgroup.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { activity_subgroup_code: activity_subgroup_code },
        ],
      },
    });

    if (!country) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.ACTIVITY_SUBGROUP_WMS
            .ACTIVITY_SUBGROUP_DOES_NOT_EXISTS,
      });
      return;
    }
    const createactivitysubgroup = await Activitysubgroup.update(
      {
        company_code,
        updated_by: requestUser.loginid,

        ...req.body,
      },
      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { activity_subgroup_code: activity_subgroup_code },
          ],
        },
      }
    );
    if (!createActivitysubgroup) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.ACTIVITY_SUBGROUP_WMS
          .ACTIVITY_SUBGROUP_UPDATED_SUCCESSFULLY,
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
        message:
          constants.MESSAGES.ACTIVITY_SUBGROUP_WMS
            .ACTIVITY_SUBGROUP_AT_LEAST_ONE_ACTIVITY_GROUP,
      });
      return;
    }
    const countriesDeleteResponse = await Activitysubgroup.destroy({
      where: {
        activity_subgroup_code: countriesCode,
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
      message:
        constants.MESSAGES.ACTIVITY_SUBGROUP_WMS
          .ACTIVITY_SUBGROUP_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
