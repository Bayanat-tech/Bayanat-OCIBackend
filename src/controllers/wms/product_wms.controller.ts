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
import {  getRepository } from "../../database/connection";
import { ProductEDI } from "../../entity/WMS/product_edi.entity";

export const createProduct = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { ...bodyWithProdCode } = req.body;

    const { error } = productSchema(bodyWithProdCode);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const productData = formatProductData(bodyWithProdCode, requestUser.loginid);
    // Check if product with same name exists
 
    const createdProduct = await ProductService.createProduct({
       ...productData,
       created_by: requestUser.loginid,
       updated_by: requestUser.loginid,
    });
    
    if (!createdProduct) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating product" });
      return;
    }
    
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_CREATED_SUCCESSFULLY,
      data: { prod_code: createdProduct.prod_code }
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
    
    const { prod_code, company_code, prin_code, group_code, brand_code, ...remainData } = req.body;

    // Check if product exists
    const productExists = await ProductService.checkProductExists(prod_code, company_code, prin_code, group_code, brand_code);

    if (!productExists) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_DOES_NOT_EXISTS,
      });
      return;
    }

    const productData = formatProductData(remainData, requestUser.loginid);
    console.log("remainData", remainData);
    
    console.log("productData", productData);
    const updateResult = await ProductService.updateProduct(
      prod_code, company_code, prin_code, group_code, brand_code,{
      ...productData,
      updated_by: requestUser.loginid,
      }
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

export const deleteProduct = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const {
      prod_code,
      prin_code,
      company_code,
      group_code,
      brand_code,
    } = req.body;

    if (
      !prod_code ||
      !prin_code ||
      !company_code ||
      !group_code ||
      !brand_code
    ) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Missing required fields.",
      });
      return 
    }

    const deleted = await ProductService.deleteProduct(
      prod_code,
      prin_code,
      company_code,
      group_code,
      brand_code
    );

    if (!deleted) {
       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Product not found or already deleted.",
      });
      return
    }
   
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.PRODUCT_WMS.PRODUCT_DELETED_SUCCESSFULLY,
    });
    return
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
    return
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
function formatProductData(data: any, userId?: string): any {
  return {
    company_code: data.company_code,
    prin_code: data.prin_code,
    prod_code: data.prod_code,
    prod_name: data.prod_name,
    brand_code: data.brand_code || null,
    group_code: data.group_code || null,
    packdesc: data.packdesc || null,
    barcode: data.barcode || null,
    p_uom: data.p_uom,
    suom: data.suom || null,
    length: data.length || 0,
    breadth: data.breadth || 0,
    height: data.height || 0,
    volume: data.volume || 0,
    gross_wt: data.gross_wt || 0,
    net_wt: data.net_wt || 0,
    foc: data.foc || null,
    cpu: data.cpu || 0,
    harm_code: data.harm_code || null,
    imco_code: data.imco_code || null,
    kitting: data.kitting || null,
    manu_code: data.manu_code || null,
    base_price: data.base_price || 0,
    flat_storage: data.flat_storage || 0,
    site_type: data.site_type || null,
    site_ind: data.site_ind || null,
    pack_key: data.pack_key || null,
    prod_ti: data.prod_ti || 0,
    prod_hi: data.prod_hi || 0,
    chargetime: data.chargetime || null,
    prod_status: data.prod_status,
    shelf_life: data.shelf_life || 0,
    category_abc: data.category_abc || null,
    reord_level: data.reord_level || 0,
    reord_qty: data.reord_qty || 0,
    alt_prod_code: data.alt_prod_code || null,
    pref_site: data.pref_site || null,
    pref_loc_from: data.pref_loc_from || null,
    pref_loc_to: data.pref_loc_to || null,
    pref_aisle_from: data.pref_aisle_from || null,
    pref_aisle_to: data.pref_aisle_to || null,
    pref_col_from: data.pref_col_from || 0,
    pref_col_to: data.pref_col_to || 0,
    pref_ht_from: data.pref_ht_from || 0,
    pref_ht_to: data.pref_ht_to || 0,
    uppp: data.uppp || 0,
    chk_manucode: data.chk_manucode || null,
    chk_lotno: data.chk_lotno || null,
    chk_mfgexpdt: data.chk_mfgexpdt || null,
    puom_volume: data.puom_volume || 0,
    puom_netwt: data.puom_netwt || 0,
    puom_grosswt: data.puom_grosswt || 0,
    l_uom: data.l_uom,
    luppp: data.luppp || 0,
    uom_count: data.uom_count || 0,
    prod_type: data.prod_type || 0,
    twoplus_uom: data.twoplus_uom || null,
    upp: data.upp || 0,
    wave_code: data.wave_code || 0,
    product_stage: data.product_stage || null,
    co_pack: data.co_pack || null,
    model_number: data.model_number || null,
    variant_code: data.variant_code || null,
    cnt_origin: data.cnt_origin || null,
    serialize: data.serialize || null,
    packing: data.packing || null,
    old_upp: data.old_upp || 0,
    avg_consumption: data.avg_consumption || 0,
    prod_image_path_web: data.prod_image_path_web || null,
    minperiod_exppick: data.minperiod_exppick || 0,
    rcpt_exp_limit: data.rcpt_exp_limit || 0,
    qty_as_wt: data.qty_as_wt || null,
    hazmat_ind: data.hazmat_ind || null,
    hazmat_class: data.hazmat_class || null,
    food_ind: data.food_ind || null,
    pharma_ind: data.pharma_ind || null,
    special_instructions: data.special_instructions || null,
    strength: data.strength || null,
    pack_size: data.pack_size || 0,
    group_code_bk: data.group_code_bk || null,
    batch_type: data.batch_type || 0,
    sap_prod_code: data.sap_prod_code || null,
    sap_prod_desc: data.sap_prod_desc || null,
    temp_code: data.temp_code || null,
    edit_user: data.edit_user ?? null,
    current_season: data.current_season || null,
    product_category: data.product_category || null,
    generic_article: data.generic_article || null,
    prod_gender: data.prod_gender || null,
    prod_color: data.prod_color || null,
    prod_size: data.prod_size || null,
    prnt_p_code: data.prnt_p_code || null,
  };
}

export const importProductsJSON = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const products = req.body;
    
    if (!Array.isArray(products) || products.length === 0) {
      res.status(400).json({ 
        success: false, 
        message: "No products provided or invalid format" 
      });
      return;
    }

    const requestUser: IUser = req.user;
    const companyCode = requestUser.company_code;

    const errors: string[] = [];
    const validProducts: any[] = [];

    // Required fields validation
    const REQUIRED_FIELDS = ['prin_code', 'prod_code', 'prod_name', 'group_code', 'brand_code', 'p_uom'];

    products.forEach((product, index) => {
      const rowErrors: string[] = [];

      // Check required fields
      REQUIRED_FIELDS.forEach(field => {
        if (!product[field] && product[field] !== 0) {
          rowErrors.push(`${field} is required`);
        }
      });

      if (rowErrors.length > 0) {
        errors.push(`Product ${index + 1}: ${rowErrors.join(', ')}`);
      } else {
        // Add company_code and user info
        const productData = {
          ...product,
          company_code: companyCode,
          created_by: requestUser.loginid,
          updated_by: requestUser.loginid,
        };
        validProducts.push(productData);
      }
    });

    if (errors.length > 0) {
      res.status(422).json({
        success: false,
        message: "Validation failed",
        errors,
        validCount: validProducts.length,
        errorCount: errors.length,
      });
      return;
    }

    // Import products
    try {
      const result = await ProductService.bulkCreateProducts(validProducts);
      
      res.json({
        success: true,
        message: `Successfully imported ${validProducts.length} products`,
        data: {
          imported: validProducts.length,
          failed: 0
        }
      });
      return;
    } catch (dbError: any) {
      console.error("Database error:", dbError);
      res.status(500).json({ 
        success: false, 
        message: `Failed to import products: ${dbError.message}` 
      });
      return;
    }

  } catch (err) {
    console.error("Error in importProductsJSON:", err);
    const errorMessage = err instanceof Error ? err.message : "Server error";
    res.status(500).json({ success: false, message: errorMessage });
    return;
  }
};

  export const uploadProductEDI = async (
    req: RequestWithUser,
    res: Response
  ): Promise<void> => {
    try {
      const products = req.body;
      const user = req.user;

      if (!Array.isArray(products) || products.length === 0) {
        res.status(400).json({
          success: false,
          message: "No products provided"
        });
        return;
      }

      await ProductService.insertToEDI(products, user);

      res.json({
        success: true,
        message: "Uploaded successfully to EDI staging"
      });
      return;

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message
      });
      return;
    }
  };

export const getProductEDI = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {

  try {
    const user = req.user;

    const repo = getRepository(ProductEDI);

    const rows = await repo.find({
      where: {
        company_code: user.company_code,
        created_by: user.loginid
      },
      order: { created_at: "DESC" }
    });

    res.json({
      success: true,
      data: rows
    });
    return;

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
    return;
  }
};

export const postValidProducts = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {

  try {
    const user = req.user;

    const result = await ProductService.postValidProducts(
      user.company_code,
      user.loginid
    );

    res.json({
      success: true,
      message: `${result.count} records moved to master`,
      data: result
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const clearProductEDI = async (req: RequestWithUser, res: Response) => {
  try {
    const user = req.user;

    await ProductService.clearEDI(user.company_code, user.loginid);

    res.json({
      success: true,
      message: "EDI staging data cleared successfully"
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};  


