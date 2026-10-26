import { Response } from "express";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { TransporterService } from "../../services/WMS/transporter.service";

export const getTransporters = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const filters = {
      ...req.query,
      company_code: requestUser.company_code || req.query.company_code
    };

    const result = await TransporterService.getTransporters(filters, page, limit);
    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.data,
      total: result.total
    });
  } catch (error: any) {
    console.error("getTransporters error:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to fetch transporters"
    });
  }
};

export const createTransporter = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const company_code = req.body.company_code || requestUser?.company_code;

    if (!company_code) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "company_code is required"
      });
    }

    if (!req.body.transporter_name) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "transporter_name is required"
      });
    }

    const { transporter_code, transporter_name } = req.body;

    // Check duplicate
    const duplicate = await TransporterService.findDuplicate({
      transporter_code,
      transporter_name,
      company_code
    });

    if (duplicate) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Transporter already exists"
      });
    }

    const newTransporter = await TransporterService.createTransporter({
      ...req.body,
      company_code,
      created_by: requestUser?.loginid || "USER_PM"
    });

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Transporter created successfully",
      data: newTransporter
    });
  } catch (error: any) {
    console.error("createTransporter error:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Error while creating transporter"
    });
  }
};

export const updateTransporter = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const company_code = req.body.company_code || requestUser?.company_code;
    const transporter_code = req.body.transporter_code;

    if (!transporter_code || !company_code) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "transporter_code and company_code are required"
      });
    }

    const updated = await TransporterService.updateTransporter(transporter_code, {
      ...req.body,
      company_code,
      updated_by: requestUser?.loginid || "USER_PM"
    });

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Transporter updated successfully",
      data: updated
    });
  } catch (error: any) {
    console.error("updateTransporter error:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Error while updating transporter"
    });
  }
};

export const deleteTransporters = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const company_code = req.body.company_code || requestUser?.company_code;
    const codes = Array.isArray(req.body) ? req.body : req.body.codes || [req.body.transporter_code];

    await TransporterService.deleteTransporters(codes, company_code);
    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Transporters deleted successfully"
    });
  } catch (error: any) {
    console.error("deleteTransporters error:", error);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Error while deleting transporters"
    });
  }
};

