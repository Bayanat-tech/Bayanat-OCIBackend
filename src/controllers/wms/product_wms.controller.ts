import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Product from "../../models/wms/product_wms.model";
import ProductEdi from "../../models/wms/product_edi_wms.model";
import {
  productSchema,
  productediSchema,
} from "../../validation/wms/gm.validation";
import * as XLSX from "xlsx";
import { IProductEdi } from "../../interfaces/wms/gm_wms.interface";

export const createProduct = async (req: RequestWithUser, res: Response) => {
  try {
    console.log("before update", req);
    const requestUser: IUser = req.user;

    const { error } = productSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { prod_code, company_code } = req.body;

    const product = await Product.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { prod_code: prod_code }],
      },
    });

    if (product) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_ALREADY_EXISTS,
      });
      return;
    }
    const createProduct = await Product.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,

      ...req.body,
    });
    if (!createProduct) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
//update product
export const updateProduct = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = productSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { prod_code, company_code } = req.body;

    const product = await Product.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { prod_code: prod_code }],
      },
    });

    if (!product) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_DOES_NOT_EXISTS,
      });
      return;
    }
    const createProduct = await Product.update(
      {
        company_code,
        created_by: requestUser.loginid,
        updated_by: requestUser.loginid,

        ...req.body,
      },
      {
        where: {
          [Op.and]: [{ company_code: company_code }, { prod_code: prod_code }],
        },
      }
    );
    if (!createProduct) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deleteproducts = async (req: RequestWithUser, res: Response) => {
  try {
    const prodCode = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PRODUCT_WMS.SELECT_AT_LEAST_ONE_PRODUCT,
      });
      return;
    }
    const productsDeleteResponse = await Product.destroy({
      where: {
        prod_code: prodCode,
      },
    });
    if (productsDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: productsDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};

export const importExcelProducts = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "No file uploaded" });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      res.status(400).json({ success: false, message: "Excel file is empty" });
      return;
    }

    const errors: string[] = [];
    const validProducts: IProductEdi[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const { value, error } = productediSchema.validate(row, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        error.details.forEach((e) => {
          errors.push(`Row ${i + 2}: ${e.message}`);
        });
      } else {
        validProducts.push(value as IProductEdi);
      }
    }

    if (errors.length) {
      res.status(422).json({
        success: false,
        message: "Validation failed",
        errors,
      });
      return;
    }

    await ProductEdi.bulkCreate(validProducts, {
      updateOnDuplicate: Object.keys(
        ProductEdi.rawAttributes
      ) as (keyof IProductEdi)[],
    });

    res.json({
      success: true,
      message: `Successfully imported ${validProducts.length} products`,
    });
    return;
  } catch (err) {
    console.error("Error in importExcelProducts:", err);
    const errorMessage = err instanceof Error ? err.message : "Server error";
    res.status(500).json({ success: false, message: errorMessage });
    return;
  }
};
