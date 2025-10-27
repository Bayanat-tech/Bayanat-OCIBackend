import { Response } from "express";
import { sequelize } from "../../database/connection";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
//import Department from "../../models/wms/department_wms.model";
import Supplier from "../../models/wms/supplier_wms.model";
//import { departmentSchema } from "../../validation/wms/gm.validation";
import { supplierSchema } from "../../validation/wms/gm.validation";

export const createsupplier = async (req: RequestWithUser, res: Response) => {
  try {
    //console.log("data aaya ki nhi in function bakend..yesr", req.body);
    const requestUser: IUser = req.user;
    //console.log("tt", requestUser);
    const { error } = supplierSchema(req.body);

    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    //console.log("called0");

    const { supp_code, company_code } = req.body;
    const supplier = await Supplier.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { supp_code: supp_code }],
      },
    });

    if (supplier) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.SUPPLIER_WMS.SUPPLIER_ALREADY_EXISTS,
      });
      return;
    }
    const createsupplier = await Supplier.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      ...req.body,
    });
    if (!createsupplier) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.SUPPLIER_WMS.SUPPLIER_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updatesupplier = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = supplierSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    
const {
  company_code,
   supp_code,
  supp_name,
  supp_city,
  supp_addr1,
  supp_email1,
  supp_contact1,
  curr_code,
  country_code,
  supp_addr2,
   supp_telno1,
  supp_faxno1,
  supp_contact2,
  supp_telno2,
  supp_faxno2,
  supp_email2,
  supp_ref1,
  supp_ref2,
  supp_acref,
  supp_credit,
  supp_stat,
  updated_by,
  cr_number
} = req.body;

    const supplier = await Supplier.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { supp_code: supp_code }],
      },
    });

    if (!supplier) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.SUPPLIER_WMS.SUPPLIER_DOES_NOT_EXISTS,
      });
      return;
    }
    const createsupplier = await supplier.update(
      {
        company_code,
        updated_by: requestUser.loginid,
        supp_code,
       supp_name,
       supp_city,
       supp_addr1,
       supp_email1,
       supp_contact1,
       curr_code,
       country_code,
       supp_addr2,
        supp_telno1,
       supp_faxno1,
       supp_contact2,
       supp_telno2,
       supp_faxno2,
       supp_email2,
       supp_ref1,
       supp_ref2,
       supp_acref,
       supp_credit,
       supp_stat,
      
      },
      {
        where: {
          [Op.and]: [{ company_code: company_code }, { supp_code: supp_code }],
        },
      }
    );
    if (!createsupplier) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    console.log('before update supplier');
    await sequelize.query(
      `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,"Supplier updated successfully.")`,
      {
        replacements: {
          screen: 'UPDATESUPPLIER',
          type: 'success',
          document_number: '', // empty string as in your original call
          userId: updated_by, // pass this properly as a named replacement
        },
      }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.SUPPLIER_WMS.SUPPLIER_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    const { updated_by } = req.body;
    await sequelize.query(
     


      `CALL PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId,'')`,
      {
        replacements: {
          screen: 'TRNFAIL',
          type: 'error',
          document_number: '' , // empty string as in your original call
          userId: updated_by, // pass this properly as a named replacement
        },
      }
    );

    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deletesuppliers = async (req: RequestWithUser, res: Response) => {
  try {
    const suppliersCode = req.body;

    //console.log(suppliersCode);

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.SUPPLIER_WMS.SELECT_AT_LEAST_ONE_SUPPLIER,
      });
      return;
    }
    const suppliersDeleteResponse = await Supplier.destroy({
      where: {
        supp_code: suppliersCode,
      },
    });
    if (suppliersDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: suppliersDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.SUPPLIER_WMS.SUPPLIER_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
