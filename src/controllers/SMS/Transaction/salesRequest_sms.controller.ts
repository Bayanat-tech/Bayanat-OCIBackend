import { Response } from "express";
import constants from "../../../helpers/constants";
import { RequestWithUser } from "../../../interfaces/common.interface";
import { insertSmsRecord, smsGmConfigs, updateSmsRecord } from "../../../services/smsTenant.service";

export const batchCreateSalesRequest = async (req: RequestWithUser, res: Response) => {
  try {
    const records = Array.isArray(req.body) ? req.body : [req.body];
    await Promise.all(records.map((record) => insertSmsRecord(smsGmConfigs.sales_request, record, req.user.loginid)));
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Records created successfully",
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message || "Unknown error",
    });
  }
};

export const batchUpdateSalesRequest = async (req: RequestWithUser, res: Response) => {
  try {
    const records = Array.isArray(req.body) ? req.body : [req.body];
    await Promise.all(records.map((record) => updateSmsRecord(smsGmConfigs.sales_request, record, req.user.loginid)));
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Records updated successfully",
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
  }
};
