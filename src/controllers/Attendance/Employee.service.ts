import { Request, Response } from "express";
import { AppDataSource } from "../../database/connection"; 
import { Employee } from "../../models/Attendance/employee.entity";

export class EmployeeController {
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
    console.error("Failed to fetch employees", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

}






