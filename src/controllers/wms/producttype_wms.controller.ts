import { Response } from "express";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { ProducttypeService } from "../../services/WMS/producttype.service";
import { producttypeSchema } from "../../validation/wms/gm.validation";

/**
 * Create Product Type
 */
export const createProducttype = async (
  req: RequestWithUser,
  res: Response
): Promise<Response> => {
  try {
    const user = req.user as IUser | undefined;

    if (!user) {
      return res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: constants.MESSAGES.UNAUTHORIZED,
      });
    }

    const { error } = producttypeSchema(
      req.body,
      user.company_code,
      false
    );

    if (error) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
    }

    const { prodtype_code, prodtype_desc } = req.body;

    const duplicate = await ProducttypeService.findDuplicate(
      prodtype_code,
      user.company_code
    );

    if (duplicate) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_ALREADY_EXISTS,
      });
    }

    await ProducttypeService.create({
      prodtype_code,
      prodtype_desc,
      company_code: user.company_code,
    });

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_CREATED_SUCCESSFULLY,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message,
    });
  }
};

/**
 * Update Product Type
 */
export const updateProducttype = async (
  req: RequestWithUser,
  res: Response
): Promise<Response> => {
  try {
    const user = req.user as IUser | undefined;

    if (!user) {
      return res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: constants.MESSAGES.UNAUTHORIZED,
      });
    }

    const { prodtype_code, prodtype_desc } = req.body;

    const exists = await ProducttypeService.findByCode(
      prodtype_code,
      user.company_code
    );

    if (!exists) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_DOES_NOT_EXISTS,
      });
    }

    await ProducttypeService.update(
      prodtype_code,
      user.company_code,
      { prodtype_desc }
    );

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_UPDATED_SUCCESSFULLY,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message,
    });
  }
};

/**
 * Get Product Types
 */
export const getProducttypes = async (
  req: RequestWithUser,
  res: Response
): Promise<Response> => {
  const user = req.user as IUser | undefined;

  if (!user) {
    return res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: constants.MESSAGES.UNAUTHORIZED,
    });
  }

  const data = await ProducttypeService.findAll(user.company_code);

  return res.status(constants.STATUS_CODES.OK).json({
    success: true,
    data,
  });
};

/**
 * Delete Product Types
 */
export const deleteProducttypes = async (
  req: RequestWithUser,
  res: Response
): Promise<Response> => {
  try {
    const prodtypeCodes: number[] = req.body;

    if (!Array.isArray(prodtypeCodes) || !prodtypeCodes.length) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.PRODUCTTYPE_WMS.SELECT_AT_LEAST_ONE_PRODUCTTYPE,
      });
    }

    const deletedCount = await ProducttypeService.delete(prodtypeCodes);

    if (!deletedCount) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.SOMETHING_WENT_WRONG,
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_DELETED_SUCCESSFULLY,
    });
  } catch (error: unknown) {

    const message =
      error instanceof Error ? error.message : "Internal server error";

    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message,
    });
  }
};
