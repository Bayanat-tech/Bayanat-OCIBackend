import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { FaceRecognitionService } from "../../services/Attendance/face_recognition.service";
import logger from "../../utils/logger";
import { validateImage } from "../../middleware/security.middleware";
import { EmployeeService } from "../../services/Attendance/employee.service";
import { AppDataSource } from "../../database/connection";
import { Employee } from "../../entity/Attendance/employee.entity";
import { EmployeeFace } from "../../entity/Attendance/employee_face.entity";
import { uploadFile } from "../../services/ociUpload.service";

export class EmployeeController {
  static async registerEmployee(req: Request, res: Response): Promise<void> {
  try {
    const {
      employee_id,
      employee_code,
      full_name,
      email,
      department,
      position,
      hire_date,
      phone_number,
    } = req.body;
    const files = req.files as Express.Multer.File[];

    const EmployeeRecord = AppDataSource.getRepository(Employee);
    const Face = AppDataSource.getRepository(EmployeeFace);

    const existingEmployee = await EmployeeRecord.findOne({
      where: { employee_id },
    });
    if (existingEmployee) {
      logger.warn(
        `Registration attempt with duplicate employee_id: ${employee_id}`
      );
      res.status(400).json({ 
        success: false,
        error: "Employee already registered with this ID",
        message: "Employee already registered with this ID" 
      });
      return;
    }

    if (!files || files.length === 0) {
      logger.warn("Employee registration attempt without images");
      res.status(400).json({ 
        success: false,
        error: "At least one employee photo is required",
        message: "At least one employee photo is required"
      });
      return;
    }

    // Validate each image
    for (const file of files) {
      req.file = file;
      validateImage(req, res, () => {});
    }
    const employee = EmployeeRecord.create({
      id: uuidv4(),
      employee_id,
      employee_code,
      full_name,
      email,
      department,
      position,
      hire_date: new Date(hire_date),
      phone_number,
    });
    await EmployeeRecord.save(employee);

    const faceService = await FaceRecognitionService.getInstance();

    // Process each image
    for (const file of files) {
      const s3Key = `employee_faces/${employee_id}/${uuidv4()}.jpg`;
      await uploadFile(file.buffer, s3Key, file.mimetype);
      const descriptor = await faceService.extractFaceDescriptor(file.buffer);

      const face = Face.create({ 
        id: uuidv4(),
        employee_id,
        s3_key: s3Key,
        descriptor: JSON.stringify(descriptor),
        is_active: "1",
      });
      await Face.save(face);
    }

    logger.info(`Employee ${employee_id} registered successfully`);
    res.status(201).json({ success: true, employeeId: employee_id });
  } catch (error: any) {
    logger.error("Employee registration failed", error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: error.message 
    });
  }
}

  // static async getEmployees(req: Request, res: Response): Promise<void> {
  //   try {
  //     const employees = await Employee.findAll({
  //       order: [["full_name", "ASC"]],
  //     });
  //     res.status(200).json(employees);
  //   } catch (error: any) {
  //     logger.error("Failed to fetch employees", error);
  //     res.status(500).json({ success: false, message: error.message });
  //   }
  // }

  static async getEmployees(req: Request, res: Response): Promise<void> {
    try {
      const employeeRepository = AppDataSource.getRepository(Employee);

      const employees = await employeeRepository.find({
        order: {
          full_name: "ASC", 
        },
      });

      res.status(200).json(employees);
    } catch (error: any) {
      logger.error("Failed to fetch employees", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  static async modifyEmployee(req: Request, res: Response ): Promise<void> {
    try {
      const { employee_id } = req.params;
      const {
        full_name,
        email,
        department,
        position,
        hire_date,
        phone_number,
      } = req.body;
      const files = req.files as Express.Multer.File[];

      const EmployeesFace = AppDataSource.getRepository(EmployeeFace);
      const repo = AppDataSource.getRepository(Employee);

      // Find employee
      const employee = await repo.findOne({
        where: { employee_id },
      });

      if (!employee) {
        res.status(404).json({ error: "Employee not found" });
        return;
      }

      Object.assign(employee, {
      full_name: req.body.full_name ?? employee.full_name,
      email: req.body.email ?? employee.email,
      department: req.body.department ?? employee.department,
      position: req.body.position ?? employee.position,
      hire_date: req.body.hire_date ? new Date(req.body.hire_date) : employee.hire_date,
      phone_number: req.body.phone_number ?? employee.phone_number,
    });

    await repo.save(employee);

      // If new face images are provided, process them
      if (files && files.length > 0) {
        // Get FaceRecognitionService instance
        const faceService = await FaceRecognitionService.getInstance();

        // First, deactivate existing face records
        await EmployeesFace.update(
          { employee_id },
          { is_active: "0" }
        );

        // Process each new image
        for (const file of files) {
          // Validate image
          req.file = file;
          validateImage(req, res, () => {});

          const s3Key = `employee_faces/${employee_id}/${uuidv4()}.jpg`;
          await uploadFile(file.buffer, s3Key, file.mimetype);

          const descriptor = await faceService.extractFaceDescriptor(
            file.buffer
          );

          const face = EmployeesFace.create({
            id: uuidv4(),
            employee_id,
            s3_key: s3Key,
            descriptor: JSON.stringify(descriptor),
            is_active: "1",
          });
          await EmployeesFace.save(face);
        }
      }

      logger.info(`Employee ${employee_id} updated successfully`);
      res.status(200).json({ success: true, employeeId: employee_id });
    } catch (error: any) {
      logger.error("Employee modification failed", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  static async getEmployeeInfo(req: Request, res: Response): Promise<void> {
    try {
      const { employee_code, name } = req.query;

      if (!employee_code && !name) {
        res.status(400).json({
          error: "Either employee_code or name parameter is required",
        });
        return;
      }

      const employeeInfo = await EmployeeService.getEmployeeInfo({
        employee_code: employee_code as string,
        name: name as string,
      });

      res.status(200).json(employeeInfo);
    } catch (error: any) {
      logger.error("Failed to fetch employee info", error);
      res.status(500).json({
        error: "Failed to fetch employee information",
        details: error.message,
      });
    }
  }
}