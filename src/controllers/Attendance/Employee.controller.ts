import { Request, Response } from "express";
import { EmployeesController } from "../../services/Attendance/employee.service";
import { Employee } from "../../models/Attendance/employee.entity";
import { AppDataSource } from "../../database/connection";
// import { v4 as uuidv4 } from "uuid";
// import { S3Service } from "../../services/s3Upload.service";
// import { FaceRecognitionService } from "../../services/Attendance/face_recognition.service";
// import Employee from "../../models/Attendance/employee.entity";
// import EmployeeFace from "../../models/Attendance/employee_face";
// import logger from "../../utils/logger";
// import { validateImage } from "../../middleware/security.middleware";
// import { EmployeeService } from "../../services/employee.service";
// import { EmployeesController } from "../../services/Attendance/employee.service";
// import { AppDataSource } from "../../database/connection";
// import { Employee } from "../../models/Attendance/employee.entity";
// import { Employee } from "../../models/Attendance/employee.entity";

export class EmployeeController {
  // static async registerEmployee(req: Request, res: Response): Promise<void> {
  //   try {
  //     const {
  //       employee_id,
  //       employee_code,
  //       full_name,
  //       email,
  //       department,
  //       position,
  //       hire_date,
  //       phone_number,
  //     } = req.body;
  //     const files = req.files as Express.Multer.File[];

  //     // Check if employee_id already exists
  //     const existingEmployee = await Employee.findOne({
  //       where: { employee_id, employee_code },
  //     });
  //     if (existingEmployee) {
  //       logger.warn(
  //         `Registration attempt with duplicate employee_id: ${employee_id}`
  //       );
  //       res.status(400).json({
  //         success: false,
  //         error: "Employee already registered with this ID",
  //         message: "Employee already registered with this ID"
  //       });
  //       return;
  //     }

  //     if (!files || files.length === 0) {
  //       logger.warn("Employee registration attempt without images");
  //       res.status(400).json({
  //         success: false,
  //         error: "At least one employee photo is required",
  //         message: "At least one employee photo is required"
  //       });
  //       return;
  //     }

  //     // Validate each image
  //     for (const file of files) {
  //       req.file = file;
  //       validateImage(req, res, () => { });
  //     }

  //     // Create employee record
  //     const employee = await Employee.create({
  //       id: uuidv4(),
  //       employee_id,
  //       employee_code,
  //       full_name,
  //       email,
  //       department,
  //       position,
  //       hire_date: new Date(hire_date),
  //       phone_number,
  //     });

  //     // Get FaceRecognitionService instance
  //     const faceService = await FaceRecognitionService.getInstance();

  //     // Process each image
  //     for (const file of files) {
  //       const s3Key = `employee_faces/${employee_id}/${uuidv4()}.jpg`;
  //       await S3Service.uploadFile(file.buffer, s3Key, file.mimetype);

  //       // Use instance method instead of static method
  //       const descriptor = await faceService.extractFaceDescriptor(file.buffer);

  //       await EmployeeFace.create({
  //         id: uuidv4(),
  //         employee_id,
  //         s3_key: s3Key,
  //         descriptor: descriptor,
  //         is_active: true,
  //       });
  //     }

  //     logger.info(`Employee ${employee_id} registered successfully`);
  //     res.status(201).json({ success: true, employeeId: employee_id });
  //   } catch (error: any) {
  //     logger.error("Employee registration failed", error);
  //     res.status(500).json({
  //       success: false,
  //       error: error.message,
  //       message: error.message
  //     });
  //   }
  // }
  // =============GetEmployeee=================

  static async getEmployee(req: Request, res: Response): Promise<void> {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const filter = req.query.filter
        ? JSON.parse(req.query.filter as string)
        : {};

      const sort = filter?.sort || { full_name: "ASC" };
      const search = filter?.search || "";

      console.log("inside getEmployees")

      const result = await EmployeesController.getEmployees(
        page,
        limit,
        sort,
        search
      );
      console.log("result....",result);
      
      res.status(200).json(result);

    } catch (error: any) {
      console.error("Failed to fetch employees", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ======================== UPDATE EMPLOYEE ===================================


  static async updateEmployee(id: string, data: any) {
    const repo = AppDataSource.getRepository(Employee);

    const employee = await repo.findOneBy({ id });
    if (!employee) return null;

    Object.assign(employee, {
      full_name: data.full_name ?? employee.full_name,
      email: data.email ?? employee.email,
      department: data.department ?? employee.department,
      position: data.position ?? employee.position,
      hire_date: data.hire_date ? new Date(data.hire_date) : employee.hire_date,
      phone_number: data.phone_number ?? employee.phone_number,
    });

    

    // static async modifyEmployee(req: Request, res: Response): Promise<void> {
    //   try {
    //     const { employee_id } = req.params;
    //     const {
    //       full_name,
    //       email,
    //       department,
    //       position,
    //       hire_date,
    //       phone_number,
    //     } = req.body;
    //     const files = req.files as Express.Multer.File[];

    //     // Find employee
    //     const employee = await Employee.findOne({ where: { employee_id } });
    //     if (!employee) {
    //       res.status(404).json({ error: "Employee not found" });
    //       return;
    //     }

    //     // Update employee basic information
    //     await employee.update({
    //       full_name,
    //       email,
    //       department,
    //       position,
    //       hire_date: hire_date ? new Date(hire_date) : undefined,
    //       phone_number,
    //     });

    //     // If new face images are provided, process them
    //     if (files && files.length > 0) {
    //       // Get FaceRecognitionService instance
    //       const faceService = await FaceRecognitionService.getInstance();

    //       // First, deactivate existing face records
    //       await EmployeeFace.update(
    //         { is_active: false },
    //         { where: { employee_id } }
    //       );

    //       // Process each new image
    //       for (const file of files) {
    //         // Validate image
    //         req.file = file;
    //         validateImage(req, res, () => {});

    //         const s3Key = `employee_faces/${employee_id}/${uuidv4()}.jpg`;
    //         await S3Service.uploadFile(file.buffer, s3Key, file.mimetype);

    //         const descriptor = await faceService.extractFaceDescriptor(
    //           file.buffer
    //         );

    //         await EmployeeFace.create({
    //           id: uuidv4(),
    //           employee_id,
    //           s3_key: s3Key,
    //           descriptor: descriptor,
    //           is_active: true,
    //         });
    //       }
    //     }

    //     logger.info(`Employee ${employee_id} updated successfully`);
    //     res.status(200).json({ success: true, employeeId: employee_id });
    //   } catch (error: any) {
    //     logger.error("Employee modification failed", error);
    //     res.status(500).json({ success: false, message: error.message });
    //   }
    // }
    //============================================================================


    // static async getEmployeeInfo(req: Request, res: Response): Promise<void> {
    //   try {
    //     const { employee_code, name } = req.query;

    //     if (!employee_code && !name) {
    //       res.status(400).json({
    //         error: "Either employee_code or name parameter is required",
    //       });
    //       return;
    //     }

    //     const employeeInfo = await EmployeeService.getEmployeeInfo({
    //       employee_code: employee_code as string,
    //       name: name as string,
    //     });

    //     res.status(200).json(employeeInfo);
    //   } catch (error: any) {
    //     logger.error("Failed to fetch employee info", error);
    //     res.status(500).json({
    //       error: "Failed to fetch employee information",
    //       details: error.message,
    //     });
    //   }
    // }
  }
}
