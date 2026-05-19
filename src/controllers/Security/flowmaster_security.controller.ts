import { Response } from "express";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import constants from "../../helpers/constants";
import { flowmasterSchema } from "../../validation/Security/Security.validation";
import { FlowMasterService } from "./../../services/Security/flowmaster.service";

export const createflowmaster = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = flowmasterSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
      return;
    }

    const { flow_description, company_code } = req.body;
    const duplicateFlow = await FlowMasterService.findByDescriptionAndCompany(flow_description, company_code);

    if (duplicateFlow) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.FLOWMASTER_PF.FLOWMASTER_ALREADY_EXISTS,
      });
      return;
    }

    const createdFlow = await FlowMasterService.createFlow({
      flow_description,
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
    });

    if (!createdFlow) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: "Error while creating flow" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.FLOWMASTER_PF.FLOWMASTER_CREATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    console.error("Error in createflowmaster:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};

export const updateflowmaster = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = flowmasterSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
      return;
    }

    const { flow_code, company_code } = req.body;
    const existingFlow = await FlowMasterService.findByFlowCodeAndCompany(flow_code, company_code);

    if (!existingFlow) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.FLOWMASTER_PF.FLOWMASTER_DOES_NOT_EXISTS,
      });
      return;
    }

    const isUpdated = await FlowMasterService.updateFlow(flow_code, company_code, {
      ...req.body,
      updated_by: requestUser.loginid,
    });

    if (!isUpdated) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: "Error while updating flow" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.FLOWMASTER_PF.FLOWMASTER_UPDATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    console.error("Error in updateflowmaster:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};
