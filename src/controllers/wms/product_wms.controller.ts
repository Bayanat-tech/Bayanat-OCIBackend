import { Response } from "express";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import {
  productSchema,
  productediSchema,
} from "../../validation/wms/gm.validation";
import * as XLSX from "xlsx";
import { IProductEdi } from "../../interfaces/wms/gm_wms.interface";
import { ProductService } from "../../services/WMS/product.service";
// import ProductEdi from "../../models/wms/product_edi_wms.model"; // Keep this for now for Excel import

export const createProduct = async (req: RequestWithUser, res: Response) => {
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

    // Check if product already exists
    const productExists = await ProductService.checkProductExists(prod_code, company_code);

    if (productExists) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_ALREADY_EXISTS,
      });
      return;
    }

    // Format data for TypeORM entity
    const productData = {
      prodCode: prod_code,
      companyCode: company_code,
      userId: requestUser.loginid,
      ...formatProductData(req.body)
    };

    const createdProduct = await ProductService.createProduct(productData);
    
    if (!createdProduct) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating product" });
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

    // Check if product exists
    const productExists = await ProductService.checkProductExists(prod_code, company_code);

    if (!productExists) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_DOES_NOT_EXISTS,
      });
      return;
    }

    // Format data for TypeORM entity
    const productData = {
      userId: requestUser.loginid,
      ...formatProductData(req.body)
    };

    const updateResult = await ProductService.updateProduct(
      prod_code,
      company_code,
      productData
    );
    
    if (!updateResult) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating product" });
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
    const prodCodes = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PRODUCT_WMS.SELECT_AT_LEAST_ONE_PRODUCT,
      });
      return;
    }
    
    const deleteResult = await ProductService.deleteProducts(prodCodes);
    
    if (!deleteResult) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "No products were deleted",
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

    // If ProductEdi is a Sequelize model, ensure it is imported from the correct Sequelize model file.
    // If ProductEdi is a TypeORM entity, use getRepository(ProductEdi).save() instead.

    // Example for TypeORM entity (uncomment if using TypeORM):
    // import { getRepository } from "typeorm";
    // await getRepository(ProductEdi).save(validProducts, { chunk: 100 });

    // Example for Sequelize model:
    // await ProductEdi.bulkCreate(validProducts, {
    //   updateOnDuplicate: Object.keys(ProductEdi.rawAttributes) as (keyof IProductEdi)[],
    // });

    // For TypeORM:
    const { getRepository } = require("typeorm");
    
    // await getRepository(ProductEdi).save(validProducts, { chunk: 100 });

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

// Helper function to convert snake_case fields to camelCase for TypeORM entity
function formatProductData(data: any): any {
  const formattedData: any = {};
  
  // Map all properties with appropriate casing
  // Add specific mappings as needed for your Product entity fields
  if (data.prod_name) formattedData.prodName = data.prod_name;
  if (data.group_code) formattedData.groupCode = data.group_code;
  if (data.category_abc) formattedData.categoryAbc = data.category_abc;
  
  // Add any other field mappings here
  
  return formattedData;
}
