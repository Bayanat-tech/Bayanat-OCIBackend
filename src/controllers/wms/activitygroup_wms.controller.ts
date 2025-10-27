import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import activitygroup from "../../models/wms/activitygroup_wms.model";
import { activitygroupSchema } from "../../validation/wms/gm.validation";

export const createActivityGroup = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = activitygroupSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { activity_group_code, company_code } = req.body;

    const Activitygroup = await activitygroup.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { activity_group_code: activity_group_code },
        ],
      },
    });

    if (Activitygroup) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.ACTIVITY_GROUP_WMS.ACTIVITY_GROUP_ALREADY_EXISTS,
      });
      return;
    }
    const createActivityGroup = await activitygroup.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,

      ...req.body,
    });
    if (!createActivityGroup) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating Activity" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.ACTIVITY_GROUP_WMS
          .ACTIVITY_GROUP_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updateActivityGroup = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = activitygroupSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { activity_group_code, company_code } = req.body;

    const Activitygroup = await activitygroup.findOne({
      where: {
        [Op.and]: [
          { company_code: company_code },
          { activity_group_code: activity_group_code },
        ],
      },
    });

    if (!Activitygroup) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.ACTIVITY_GROUP_WMS.ACTIVITY_GROUP_DOES_NOT_EXISTS,
      });
      return;
    }
    const createActivityGroup = await activitygroup.update(
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
            { activity_group_code: activity_group_code },
          ],
        },
      }
    );
    if (!createActivityGroup) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating Activity" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.ACTIVITY_GROUP_WMS
          .ACTIVITY_GROUP_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deleteActivityGroup = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const activitygroupCode = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.ACTIVITY_GROUP_WMS
            .SELECT_AT_LEAST_ONE_ACTIVITY_GROUP,
      });
      return;
    }
    const activitygroupDeleteResponse = await activitygroup.destroy({
      where: {
        activity_group_code: activitygroupCode,
      },
    });
    if (activitygroupDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: activitygroupDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.ACTIVITY_GROUP_WMS
          .ACTIVITY_GROUP_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
