import { Response } from "express";
import { RequestWithUser } from "../../interfaces/common.interface";
import constants from "../../helpers/constants";
import { projectmasterSchema } from "../../validation/Purchaseflow/Purchaseflow.validation";
import { ProjectMasterService } from "../../services/Purchaseflow/projectmaster.service";

export class ProjectMasterController {
  //  CREATE
  static async createProject(
    req: RequestWithUser, 
    res: Response) {
    try {
      const { error } = projectmasterSchema(req.body);

      if (error) {
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: error.message,
        });
        return;
      }

      const result = await ProjectMasterService.createProject(req.body);

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: constants.MESSAGES.PROJECTMASTER_PF.PROJECTMASTER_CREATED_SUCCESSFULLY,
        data: result,
      });

    } catch (error: any) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message,
      });
    }
  }

  // UPDATE
  static async updateProject(
    req: RequestWithUser, 
    res: Response) {
    try {
      const { error } = projectmasterSchema(req.body);

      if (error) {
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: error.message,
        });
        return;
      }

      const { project_code, company_code } = req.body;

      const updated = await ProjectMasterService.updateProject(
        project_code,
        company_code,
        req.body
      );

      if (!updated) {
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: constants.MESSAGES.PROJECTMASTER_PF.PROJECTMASTER_DOES_NOT_EXISTS,
        });
        return;
      }

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: constants.MESSAGES.PROJECTMASTER_PF.PROJECTMASTER_UPDATED_SUCCESSFULLY,
      });

    } catch (error: any) {
      console.error("Error in updateProject:", error);
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
    }
  }
}
