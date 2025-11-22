import { Request, Response } from "express";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { ItemMasterService } from "../../services/Purchaseflow/itemmaster.service";
import { itemmasterSchema } from "../../validation/Purchaseflow/Purchaseflow.validation";

export class ItemMasterController {
  static async createItem(
    req: RequestWithUser, 
    res: Response
  ) {
    try {
      const requestUser: IUser = req.user;
      const { error } = itemmasterSchema (req.body);
      const { item_code, item_desp, company_code } = req.body;

      if (error) {
              res.status(constants.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                message: error.message,
              });
              return;
            }

             const result = await ItemMasterService.createItem(req.body);

      // // Duplicate check
      // const exists = await ItemMasterService.findDuplicate(
      //   item_code,
      //   item_desp,
      //   company_code
      // );

      // if (exists) {
      //   return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      //     success: false,
      //     message: constants.MESSAGES.ITEMMASTER_PF.ITEMMASTER_ALREADY_EXISTS
      //   });
      // }

      // // Create
      // await ItemMasterService.createItem({
      //   ...req.body,
      //   created_by: requestUser.loginid,
      //   updated_by: requestUser.loginid
      // });

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: constants.MESSAGES.ITEMMASTER_PF.ITEMMASTER_CREATED_SUCCESSFULLY
      });

    } catch (error: any) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
    }
  }

  // UPDATE ITEMMASTER
  static async updateItem(
    req: RequestWithUser, 
    res: Response
  ) {
    try {
      const { error } = itemmasterSchema(req.body);

      if (error) {
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({
         success: false,
         message: error.message,
        });
        return;
      }
      
      const { item_code, company_code } = req.body;
      
      const updated = await ItemMasterService.updateItem(
        item_code,
        company_code,
        {
          ...req.body,
        }
      );

      if (!updated) {
        res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Error while updating item"
        });
        return;
      }

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: constants.MESSAGES.ITEMMASTER_PF.ITEMMASTER_UPDATED_SUCCESSFULLY
      });

    } catch (error: any) {
       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
    }
  }

  // DELETE MULTIPLE ITEMS
  static async deleteItems(req: Request, res: Response) {
    try {
      const { itemCodes } = req.body;

      const deletedCount = await ItemMasterService.deleteItems(itemCodes);

      return res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: `Deleted ${deletedCount} items`
      });

    } catch (error: any) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
    }
  }
}
