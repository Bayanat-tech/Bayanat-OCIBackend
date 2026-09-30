import { Response } from "express";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import constants from "../../helpers/constants";
import { secmoduleSchema } from "../../validation/Security/Security.validation";
import { SecModuleService } from "../../services/Security/secmodule.service";

export const createsecmodulemaster = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = secmoduleSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const {
      app_code,
      level1,
      level2,
      level3,
      position,
      url_path,
      component_name,
      icon,
    } = req.body;

    // Check for duplicate module
    const duplicateModule = await SecModuleService.findDuplicate({
      app_code,
      level1,
      level2,
      level3,
      url_path,
      component_name,
      icon,
    });

    if (duplicateModule) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.SECMODULE_SEC.SECMODULE_ALREADY_EXISTS,
      });
      return;
    }

    // Create module
    const createdModule = await SecModuleService.createModule({
      app_code,
      level1,
      level2,
      level3,
      position,
      url_path,
      component_name,
      icon,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
    });

    if (!createdModule) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating module" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.SECMODULE_SEC.SECMODULE_CREATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    console.error("Error in createsecmodulemaster:", error);
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};

export const updatesecmodulemaster = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = secmoduleSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const { serial_no } = req.body;

    // Check if module exists
    const existingModule = await SecModuleService.findBySerial(serial_no);

    if (!existingModule) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.SECMODULE_SEC.SECMODULE_DOES_NOT_EXISTS,
      });
      return;
    }

    // Update module
    const updateData = {
      ...req.body,
      updated_by: requestUser.loginid,
    };

    const isUpdated = await SecModuleService.updateModule(serial_no, updateData);

    if (!isUpdated) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating module" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.SECMODULE_SEC.SECMODULE_UPDATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    console.error("Error in updatesecmodulemaster:", error);
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};
