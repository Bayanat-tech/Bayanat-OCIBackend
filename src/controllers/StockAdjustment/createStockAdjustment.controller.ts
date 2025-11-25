import { Response } from "express";
import { TaAdjDetailService } from "../../services/WMS/taAdjDetail.service";
import { ICreateStockAdjustmentRequest } from "../../interfaces/wms/stockAdjustment.interface";
import { RequestWithUser } from "../../interfaces/common.interface";
import constants from "../../helpers/constants";

export const createStockAdjustment = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { JOB_NO, PROD_CODE, QTY_PUOM, QTY_LUOM, ADJ_TYPE }: ICreateStockAdjustmentRequest = req.body;

    // Validate required fields
    if (!JOB_NO) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "JOB_NO is required",
      });
      return;
    }

    // Get user info from request
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;
    const username = requestUser.loginid;

    // Check if adjustment already exists
    const existingAdjustment = await TaAdjDetailService.findByJobNo(
      JOB_NO,
      COMPANY_CODE
    );

    if (existingAdjustment) {
      res.status(constants.STATUS_CODES.CONFLICT).json({
        success: false,
        message: "Stock adjustment already exists for this JOB_NO",
      });
      return;
    }

    // Create stock adjustment
    const newAdjustment = await TaAdjDetailService.createAdjustment({
      JOB_NO,
      PROD_CODE,
      QTY_PUOM,
      QTY_LUOM,
      ADJ_TYPE,
      COMPANY_CODE,
      CREATED_BY: username,
      UPDATED_BY: username,
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Stock adjustment created successfully",
      data: newAdjustment,
    });
  } catch (error: any) {
    console.error("Error creating stock adjustment:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create stock adjustment",
      error: error.message,
    });
  }
};

export const updateStockAdjustment = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { JOB_NO } = req.params;
    const { PROD_CODE, QTY_PUOM, QTY_LUOM, ADJ_TYPE }: ICreateStockAdjustmentRequest = req.body;

    if (!JOB_NO) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "JOB_NO is required",
      });
      return;
    }

    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;
    const username = requestUser.loginid;

    // Check if adjustment exists
    const existingAdjustment = await TaAdjDetailService.findByJobNo(
      JOB_NO,
      COMPANY_CODE
    );

    if (!existingAdjustment) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Stock adjustment not found",
      });
      return;
    }

    // Update stock adjustment
    const updated = await TaAdjDetailService.updateAdjustment(
      JOB_NO,
      COMPANY_CODE,
      {
        PROD_CODE,
        QTY_PUOM,
        QTY_LUOM,
        ADJ_TYPE,
        UPDATED_BY: username,
      }
    );

    if (updated) {
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Stock adjustment updated successfully",
      });
    } else {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to update stock adjustment",
      });
    }
  } catch (error: any) {
    console.error("Error updating stock adjustment:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update stock adjustment",
      error: error.message,
    });
  }
};

export const getStockAdjustments = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;

    const adjustments = await TaAdjDetailService.findByCompany(COMPANY_CODE);

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: adjustments,
      totalCount: adjustments.length,
    });
  } catch (error: any) {
    console.error("Error fetching stock adjustments:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch stock adjustments",
      error: error.message,
    });
  }
};

export const getStockAdjustmentByJobNo = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { JOB_NO } = req.params;
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;

    if (!JOB_NO) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "JOB_NO is required",
      });
      return;
    }

    const adjustment = await TaAdjDetailService.findByJobNo(JOB_NO, COMPANY_CODE);

    if (!adjustment) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Stock adjustment not found",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: adjustment,
    });
  } catch (error: any) {
    console.error("Error fetching stock adjustment:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch stock adjustment",
      error: error.message,
    });
  }
};

export const deleteStockAdjustment = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { JOB_NO } = req.params;
    const requestUser = req.user;
    const COMPANY_CODE = requestUser.company_code;

    if (!JOB_NO) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "JOB_NO is required",
      });
      return;
    }

    const deleted = await TaAdjDetailService.deleteAdjustment(JOB_NO, COMPANY_CODE);

    if (deleted) {
      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Stock adjustment deleted successfully",
      });
    } else {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Stock adjustment not found",
      });
    }
  } catch (error: any) {
    console.error("Error deleting stock adjustment:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete stock adjustment",
      error: error.message,
    });
  }
};
