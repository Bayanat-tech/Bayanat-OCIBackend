import { Response } from "express";
import { Op } from "sequelize";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import Department from "../../models/wms/department_wms.model";
import { departmentSchema } from "../../validation/wms/gm.validation";

export const createdepartment = async (req: RequestWithUser, res: Response) => {
  try {
    //console.log("data aaya ki nhi in function bakend..", req.body);
    const requestUser: IUser = req.user;
    const { error } = departmentSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { dept_code, company_code } = req.body;
    const department = await Department.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { dept_code: dept_code }],
      },
    });

    if (department) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_ALREADY_EXISTS,
      });
      return;
    }
    const createdepartment = await Department.create({
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
      ...req.body,
    });
    if (!createdepartment) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_CREATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const updatedepartment = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = departmentSchema(req.body);
    if (error) {
      res
        .status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }
    const { dept_code, company_code } = req.body;

    const department = await Department.findOne({
      where: {
        [Op.and]: [{ company_code: company_code }, { dept_code: dept_code }],
      },
    });

    if (!department) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_DOES_NOT_EXISTS,
      });
      return;
    }
    const createdepartment = await department.update(
      {
        company_code,
        created_by: requestUser.loginid,
        updated_by: requestUser.loginid,
        ...req.body,
      },
      {
        where: {
          [Op.and]: [
            { company_code: company_code },
            { department_code: dept_code },
          ],
        },
      }
    );
    if (!createdepartment) {
      res
        .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating company" });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_UPDATED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
export const deletedepartments = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const departmentsCode = req.body;

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message:
          constants.MESSAGES.DEPARTMENT_WMS.SELECT_AT_LEAST_ONE_DEPARTMENT,
      });
      return;
    }
    const departmentsDeleteResponse = await Department.destroy({
      where: {
        dept_code: departmentsCode,
      },
    });
    if (departmentsDeleteResponse === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: departmentsDeleteResponse,
      });
      return;
    }
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message:
        constants.MESSAGES.DEPARTMENT_WMS.DEPARTMENT_DELETED_SUCCESSFULLY,
    });
    return;
  } catch (error: any) {
    res
      .status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
    return;
  }
};
