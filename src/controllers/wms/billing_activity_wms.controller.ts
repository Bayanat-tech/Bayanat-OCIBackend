import { Response } from "express";
import { RequestWithUser } from "../../interfaces/common.interface";
import constants from "../../helpers/constants";
import { BillingActivityService } from "../../services/WMS/billing_activity.service";
 
// Create Billing Activity Controller
export const BillingActivity = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const requestUser = req.user;
    const body = req.body;
 
    if (!requestUser?.company_code || !body.prin_code) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code and prin_code are required",
      });
      return;
    }
 
    const repo= {
      ...body,
      company_code: requestUser.company_code,
      updated_by: requestUser.loginid,
    };
 
    const result = await BillingActivityService.createBillingActivity(repo);
 
    res.status(constants.STATUS_CODES.CREATED).json({
      success: true,
      message: "Billing activity created successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("createBillingActivity error:", error);
 
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Error occurred while creating billing activity",
    });
  }
};
 
export const updateBillingActivity = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const requestUser = req.user;
    const body = req.body;
 
    // Validation
    if (
      !requestUser?.company_code || !body.prin_code
    ) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code and prin_code are required",
      });
      return;
    }
 
    const payload = {
      ...body,
      company_code: requestUser.company_code,
      updated_by: requestUser.loginid,
    };
 
    const result = await BillingActivityService.updateBillingActivity(payload);
 
    if (result.notFound) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: result.message,
      });
      return;
    }
 
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: result.message,
      data: result.data,
    });
 
  } catch (error: any) {
    console.error("updateBillingActivity error:", error);
 
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Error occurred while updating billing activity",
    });
  }
};
 
  // Delete Billing Activity Controller
  export const deleteBillingActivity = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const requestUser = req.user;
    const body = req.body;
 
    if (
      !requestUser?.company_code ||
      !body.prin_code ||
      !body.act_code
    ) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code, prin_code and act_code are required",
      });
      return;
    }
 
    const payload = {
      ...body,
      company_code: requestUser.company_code,
      updated_by: requestUser.loginid,
    };
 
    const result =
      await BillingActivityService.deleteBillingActivity(payload);
 
    if (result.notFound) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: result.message,
      });
      return;
    }
 
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    console.error("deleteBillingActivity error:", error);
 
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message:
        error.message || "Error deleting billing activity",
    });
  }
};