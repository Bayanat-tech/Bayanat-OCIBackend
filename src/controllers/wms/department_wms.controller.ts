import { Response } from "express";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { departmentSchema } from "../../validation/wms/gm.validation";
import { DepartmentService } from "../../services/WMS/department.service";
import { createLog, notifyUser } from "../../helpers/functions";

// ✅ Create a new Department
export const createDepartment = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    // Validate request
    const { error } = departmentSchema(req.body);
    if (error) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
    }

    const { dept_code, dept_name, company_code } = req.body;

    // Check if department already exists
    const existingDepartment = await DepartmentService.findDuplicate({
      dept_code,
      dept_name,
    });

    if (existingDepartment) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_ALREADY_EXISTS,
      });
    }

    // Create new department
    const newDepartment = await DepartmentService.createDepartment({
      ...req.body,
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
    });

    if (!newDepartment) {
      return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Error while creating department",
      });
    }

    // Audit log + notification
    await createLog({
      event: constants.EVENTS.DEPARTMENT_CREATED,
      request_user: requestUser,
      module: constants.MODULE.WMS,
      description: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_CREATED_SUCCESSFULLY,
    });

    await notifyUser({
      event: constants.EVENTS.DEPARTMENT_CREATED,
      request_user: requestUser,
    });

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_CREATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: "Error: " + error.message,
    });
  }
};

// ✅ Update existing Department
export const updateDepartment = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    // Validate request
    const { error } = departmentSchema(req.body);
    if (error) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
    }

    const { dept_code } = req.body;

    // Check if department exists
    const existingDepartment = await DepartmentService.findByCode(dept_code);

    if (!existingDepartment) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_DOES_NOT_EXISTS,
      });
    }

    // Update department record
    const isUpdated = await DepartmentService.updateDepartment(dept_code, {
      ...req.body,
      updated_by: requestUser.loginid,
    });

    if (!isUpdated) {
      return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Error while updating department",
      });
    }

    // Log + notify
    await createLog({
      event: constants.EVENTS.DEPARTMENT_EDITED,
      request_user: requestUser,
      module: constants.MODULE.WMS,
      description: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_UPDATED_SUCCESSFULLY,
    });

    await notifyUser({
      event: constants.EVENTS.DEPARTMENT_EDITED,
      request_user: requestUser,
    });

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_UPDATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: "Error: " + error.message,
    });
  }
};

// ✅ Delete one or multiple Departments
export const deleteDepartments = async (req: RequestWithUser, res: Response) => {
  try {
    const deptCodes: string[] = req.body;

    if (!deptCodes || !deptCodes.length) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.DEPARTMENT_WMS.SELECT_AT_LEAST_ONE_DEPARTMENT,
      });
    }

    let deletedCount = 0;

    for (const code of deptCodes) {
      const exists = await DepartmentService.findByCode(code);
      if (exists) {
        await DepartmentService.deleteDepartment(code);
        deletedCount++;
      }
    }

    if (deletedCount === 0) {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "No departments were deleted",
      });
    }

    return res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_DELETED_SUCCESSFULLY,
      deletedCount,
    });
  } catch (error: any) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: "Error: " + error.message,
    });
  }
};
