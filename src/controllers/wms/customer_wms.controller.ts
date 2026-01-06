import { Response } from "express";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { customerSchema } from "../../validation/Purchaseflow/Purchaseflow.validation";
import constants from "../../helpers/constants";
import { CustomerService } from "../../services/WMS/customer.service";

export class CustomerMasterController {
  
  // --- CREATE ---
  static async createCustomerMaster(
    req: RequestWithUser, 
    res: Response
  ) {
    try {
      const user: IUser = req.user;
      const { error } = customerSchema(req.body);

      if (error) {
        res
          .status(constants.STATUS_CODES.BAD_REQUEST)
          .json({ 
            success: false, 
            message: error.message });
        return;
      }

      const result = await CustomerService.createCustomer({
        ...req.body,
        created_by: user.loginid,
        updated_by: user.loginid,
      });

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: constants.MESSAGES.CUSTOMER_WMS.CUSTOMER_CREATED_SUCCESSFULLY,
         data: result

      });
    } catch (err: any) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: err.message });
    }
  }

  // --- UPDATE ---
  static async updateCustomerMaster(
    req: RequestWithUser, 
    res: Response
) {
    try {
      const user: IUser = req.user;

      const { error } = customerSchema(req.body);
      if (error) {
        res
          .status(constants.STATUS_CODES.BAD_REQUEST)
          .json({ success: false, message: error.message });
        return;
      }

      const { company_code, cust_code } = req.body;

      const updated = await CustomerService.updateCustomer(
        company_code,
        cust_code,
        {
          ...req.body,
          updated_by: user.loginid,
        }
      );

      if (!updated) {
              res.status(constants.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                message: constants.MESSAGES.CUSTOMER_WMS.CUSTOMER_DOES_NOT_EXIST,
              });
              return;
            }

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: constants.MESSAGES.CUSTOMER_WMS.CUSTOMER_UPDATED_SUCCESSFULLY,
      });
    } catch (err: any) {
      console.error("Error in updatecustomermaster:", err);
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: err.message });
      return;
    }
  }
}
