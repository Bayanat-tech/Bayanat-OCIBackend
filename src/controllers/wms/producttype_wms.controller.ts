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
) => {
  try {
    const user: IUser = req.user;

    const { error } = producttypeSchema(
      req.body,
      user.company_code,
      false
    );
    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const { prodtype_code } = req.body;

    const duplicate = await ProducttypeService.findDuplicate(
      prodtype_code,
      user.company_code
    );

    if (duplicate) {
      return res.status(400).json({
        success: false,
        message:
          constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_ALREADY_EXISTS,
      });
    }

    await ProducttypeService.create({
      ...req.body,
      company_code: user.company_code,
      created_by: user.loginid,
      updated_by: user.loginid,
    });

    return res.status(200).json({
      success: true,
      message:
        constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_CREATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Update Product Type
 */
export const updateProducttype = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const user: IUser = req.user;
    const { prodtype_code } = req.body;

    const exists = await ProducttypeService.findByCode(
      prodtype_code,
      user.company_code
    );

    if (!exists) {
      return res.status(400).json({
        success: false,
        message:
          constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_DOES_NOT_EXISTS,
      });
    }

    await ProducttypeService.update(
      prodtype_code,
      user.company_code,
      {
        ...req.body,
        updated_by: user.loginid,
      }
    );

    return res.status(200).json({
      success: true,
      message:
        constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_UPDATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Get Product Types
 */
export const getProducttypes = async (
  req: RequestWithUser,
  res: Response
) => {
  const data = await ProducttypeService.findAll(req.user.company_code);
  return res.status(200).json({ success: true, data });
};

/**
 * Delete Product Types
 */
export const deleteProducttypes = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const prodtypeCodes: number[] = req.body;

    if (!prodtypeCodes?.length) {
      return res.status(400).json({
        success: false,
        message:
          constants.MESSAGES.PRODUCTTYPE_WMS.SELECT_AT_LEAST_ONE_PRODUCTTYPE,
      });
    }

    const deletedCount = await ProducttypeService.delete(prodtypeCodes);

    if (!deletedCount) {
      return res.status(400).json({ success: false, message: "Delete failed" });
    }

    return res.status(200).json({
      success: true,
      message:
        constants.MESSAGES.PRODUCTTYPE_WMS.PRODUCTTYPE_DELETED_SUCCESSFULLY,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
