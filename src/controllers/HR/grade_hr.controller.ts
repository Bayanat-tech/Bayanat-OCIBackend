import { Response } from "express";
import * as fastCsv from "fast-csv";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IHrGrade } from "../../interfaces/Hr/hr_grade";
import { IUser } from "../../interfaces/user.interface";
import { getRepository } from "../../database/connection";
import HrCsvHeaders from "../../utils/exportCsv/HrCsvHeaders";
import { gradeSchema } from "../../validation/HR/hrgrade.validation";
import { In } from "typeorm";
import { HrGrade } from "../../models/Hr/hr_grade";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getNextGradeCode(companyCode: string): Promise<string> {
  const gradeRepository = getRepository(HrGrade);

  // Find the highest numeric grade_code for this company
  const result = await gradeRepository
    .createQueryBuilder("g")
    .select("MAX(TO_NUMBER(g.grade_code))", "maxCode")
    .where("g.company_code = :companyCode", { companyCode })
    .andWhere("REGEXP_LIKE(g.grade_code, '^[0-9]+$')")
    .getRawOne<{ maxCode: number | null }>();

  const next = (result?.maxCode ?? 0) + 1;
  return String(next).padStart(3, "0");
}

// ─── Create ───────────────────────────────────────────────────────────────────

export const createGrade = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = gradeSchema(req.body, requestUser.company_code, false);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const { company_code } = req.body;
    const gradeRepository = getRepository(HrGrade);

    // Generate grade_code server-side — never trust a blank value from the client
    const grade_code = await getNextGradeCode(company_code);

    // Defensive check: generated code must not already exist (race condition)
    const existing = await gradeRepository.findOne({
      where: { company_code, grade_code },
    });

    if (existing) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.GRADE_HR.GRADE_ALREADY_EXISTS,
      });
      return;
    }

    const newGrade = gradeRepository.create({
      ...req.body,
      grade_code,               // use generated code, not the blank from client
      company_code,
      created_by: requestUser.loginid,
      updated_by: requestUser.loginid,
    });

    const savedGrade = await gradeRepository.save(newGrade);

    if (!savedGrade) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while creating grade" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.GRADE_HR.GRADE_CREATED_SUCCESSFULLY,
      data: { grade_code },     // ← frontend GradeDialog reads this back
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateGrade = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = gradeSchema(req.body, requestUser.company_code, false);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const { grade_code, company_code } = req.body;
    const gradeRepository = getRepository(HrGrade);

    const grade = await gradeRepository.findOne({
      where: { company_code, grade_code },
    });

    if (!grade) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.GRADE_HR.GRADE_DOES_NOT_EXISTS,
      });
      return;
    }

    const updateResult = await gradeRepository.update(
      { company_code, grade_code },
      { ...req.body, updated_by: requestUser.loginid },
    );

    if (updateResult.affected === 0) {
      res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error while updating grade" });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.GRADE_HR.GRADE_UPDATED_SUCCESSFULLY,
      data: { grade_code },     // ← consistent response shape
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};

// ─── Bulk create ──────────────────────────────────────────────────────────────

export const createBulkGrades = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;

    const { error } = gradeSchema(req.body, requestUser.company_code, true);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST)
        .json({ success: false, message: error.message });
      return;
    }

    const gradeRepository = getRepository(HrGrade);

    const gradesWithUser = req.body.map((grade: IHrGrade) => ({
      ...grade,
      updated_by: requestUser.loginid,
      created_by: requestUser.loginid,
    }));

    await gradeRepository
      .createQueryBuilder()
      .insert()
      .into(HrGrade)
      .values(gradesWithUser)
      .orIgnore()
      .execute();

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Grade " + constants.MESSAGES.IMPORTED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const exportGrade = async (req: RequestWithUser, res: Response) => {
  try {
    const gradeRepository = getRepository(HrGrade);

    const fetchedData = await gradeRepository.find({
      where: { company_code: req.user.company_code },
    });

    const csvTransform = fastCsv.format({
      headers: HrCsvHeaders.MASTERS.GRADE,
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="grade.csv"`);

    fetchedData.forEach((row) => csvTransform.write(row));
    csvTransform.end();
    csvTransform.pipe(res);
  } catch (error: any) {
    console.error("Export Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteGrades = async (req: RequestWithUser, res: Response) => {
  try {
    const gradesCode = req.body;
    const gradeRepository = getRepository(HrGrade);

    if (!req.body.length) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.GRADE_HR.SELECT_AT_LEAST_ONE_GRADE,
      });
      return;
    }

   const deleteResult = await gradeRepository.delete({
  company_code: req.user.company_code,
  grade_code: In(gradesCode),
    });
    if (deleteResult.affected === 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "No grades found to delete",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.GRADE_HR.GRADE_DELETED_SUCCESSFULLY,
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST)
      .json({ success: false, message: error.message });
  }
};