import { Response } from "express";
import * as fastCsv from "fast-csv";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { IHrLabourDesignation } from "../../interfaces/Hr/hr_labour_designation";
import { getRepository } from "../../database/connection";
import { formaldesignationSchema } from "../../validation/HR/hrformaldesignation.validation";
import HrCsvHeaders from "../../utils/exportCsv/HrCsvHeaders";
import { In } from "typeorm";
import { HrLabourDesignation } from "../../models/Hr/hr_labour_designation";

export const createFormaldesignation = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = formaldesignationSchema(req.body, requestUser.company_code, false);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
      return;
    }

    const { labour_desg_code, company_code } = req.body;
    const repo = getRepository(HrLabourDesignation);

    const existing = await repo.findOne({ where: { company_code, labour_desg_code } });
    if (existing) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.FORMALDESIGNATION_HR.FORMALDESIGNATION_ALREADY_EXISTS,
      });
      return;
    }

    const newRecord = repo.create({
      ...req.body,
      user_id: requestUser.loginid,
    });

    const saved = await repo.save(newRecord);
    if (!saved) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: "Error while creating formal designation" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.FORMALDESIGNATION_HR.FORMALDESIGNATION_CREATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};

export const updateFormaldesignation = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = formaldesignationSchema(req.body, requestUser.company_code, false);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
      return;
    }

    const { labour_desg_code, company_code } = req.body;
    const repo = getRepository(HrLabourDesignation);

    const existing = await repo.findOne({ where: { company_code, labour_desg_code } });
    if (!existing) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.FORMALDESIGNATION_HR.FORMALDESIGNATION_DOES_NOT_EXISTS,
      });
      return;
    }

    const updateResult = await repo.update(
      { company_code, labour_desg_code },
      { ...req.body, user_id: requestUser.loginid }
    );

    if (updateResult.affected === 0) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: "Error while updating formal designation" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.FORMALDESIGNATION_HR.FORMALDESIGNATION_UPDATED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};

export const createBulkFormaldesignations = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    const { error } = formaldesignationSchema(req.body, requestUser.company_code, true);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
      return;
    }

    const repo = getRepository(HrLabourDesignation);

    const records = req.body.map((item: IHrLabourDesignation) => ({
      ...item,
      user_id: requestUser.loginid,
    }));

    await repo.createQueryBuilder().insert().into(HrLabourDesignation).values(records).orIgnore().execute();

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Formaldesignation " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};

export const exportFormaldesignation = async (req: RequestWithUser, res: Response) => {
  try {
    const repo = getRepository(HrLabourDesignation);
    const fetchedData = await repo.find({ where: { company_code: req.user.company_code } });

    const csvTransform = fastCsv.format({ headers: HrCsvHeaders.MASTERS.FORMALDESIGNATION });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="Formaldesignation.csv"`);

    fetchedData.forEach((row) => csvTransform.write(row));
    csvTransform.end();
    csvTransform.pipe(res);
  } catch (error: any) {
    console.error("Export Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteFormaldesignation = async (req: RequestWithUser, res: Response) => {
  try {
    const formaldesignationsCode = req.body;
    const repo = getRepository(HrLabourDesignation);

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.FORMALDESIGNATION_HR.SELECT_AT_LEAST_ONE_FORMALDESIGNATION,
      });
      return;
    }

    const deleteResult = await repo.delete({ labour_desg_code: In(formaldesignationsCode) });

    if (deleteResult.affected === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "No formal designations found to delete" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.FORMALDESIGNATION_HR.FORMALDESIGNATION_DELETED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};