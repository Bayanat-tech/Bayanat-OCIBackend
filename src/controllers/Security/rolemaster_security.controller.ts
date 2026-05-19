import { Response } from "express";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import constants from "../../helpers/constants";
import { rolemasterSchema } from "../../validation/Security/Security.validation";
import { RoleMasterService } from "../../services/Security/rolemaster.service";

export const createrolemaster = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = rolemasterSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
      return;
    }

    const { role_desc, remarks, company_code } = req.body;
    const duplicateRole = await RoleMasterService.findByRoleDescAndCompany(role_desc, company_code);

    if (duplicateRole) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ROLEMASTER_WMS.ROLEMASTER_ALREADY_EXISTS,
      });
      return;
    }

    const createdRole = await RoleMasterService.createRole({
      role_desc,
      remarks,
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
    });

    if (!createdRole) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: "Error while creating role" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.ROLEMASTER_WMS.ROLEMASTER_CREATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    console.error("Error in createrolemaster:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};

export const updaterolemaster = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = rolemasterSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
      return;
    }

    const { role_id, company_code } = req.body;
    const existingRole = await RoleMasterService.findByRoleIdAndCompany(Number(role_id), company_code);

    if (!existingRole) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.ROLEMASTER_WMS.ROLEMASTER_DOES_NOT_EXISTS,
      });
      return;
    }

    const isUpdated = await RoleMasterService.updateRole(Number(role_id), company_code, {
      ...req.body,
      updated_by: requestUser.loginid,
    });

    if (!isUpdated) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: "Error while updating role" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.ROLEMASTER_WMS.ROLEMASTER_UPDATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    console.error("Error in updaterolemaster:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};
