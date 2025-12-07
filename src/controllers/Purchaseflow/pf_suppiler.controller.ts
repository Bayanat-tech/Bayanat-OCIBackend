import { Response } from "express";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { supplierSchema } from "../../validation/Purchaseflow/Purchaseflow.validation";
import constants from "../../helpers/constants";
import { SupplierMasterService } from "../../services/purchaseflow/suppilermaster.service";

export class SupplierMasterController {
  
  // --- CREATE ---
  static async create(req: RequestWithUser, res: Response) {
    try {
      const user: IUser = req.user;
      const { error } = supplierSchema(req.body);

      if (error) {
        return res
          .status(constants.STATUS_CODES.BAD_REQUEST)
          .json({ success: false, message: error.message });
      }

      const result = await SupplierMasterService.createSupplier({
        ...req.body,
        created_by: user.loginid,
        updated_by: user.loginid,
      });

      return res.status(result.status).json(result);
    } catch (err: any) {
      return res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: err.message });
    }
  }

  // --- UPDATE ---
  static async update(
    req: RequestWithUser, 
    res: Response
) {
    try {
      const user: IUser = req.user;

      const { error } = supplierSchema(req.body);
      if (error) {
        return res
          .status(constants.STATUS_CODES.BAD_REQUEST)
          .json({ success: false, message: error.message });
      }

      const { company_code, supp_code } = req.body;

      const result = await SupplierMasterService.updateSupplier(
        company_code,
        supp_code,
        {
          ...req.body,
          updated_by: user.loginid,
        }
      );

      return res.status(result.status).json(result);
    } catch (err: any) {
      return res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: err.message });
    }
  }
}
