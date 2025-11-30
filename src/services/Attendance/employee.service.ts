import { Request, Response } from "express";
import { AppDataSource } from "../../database/connection"; 
import { Employee } from "../../models/Attendance/employee.entity";

export class EmployeesController {
  // Fetch all employees
  static async getEmployees(page: number, limit: number, req: Request, res: Response): Promise<void> {
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

  // Update an employee by id
  static async updateEmployee(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const {
        full_name,
        email,
        department,
        position,
        hire_date,
        phone_number,
      } = req.body;

      const employeeRepository = AppDataSource.getRepository(Employee);

      // Find employee
      const employee = await employeeRepository.findOneBy({ id });
      if (!employee) {
        res.status(404).json({ success: false, message: "Employee not found" });
        return;
      }

      // Update fields
      if (full_name !== undefined) employee.full_name = full_name;
      if (email !== undefined) employee.email = email;
      if (department !== undefined) employee.department = department;
      if (position !== undefined) employee.position = position;
      if (hire_date !== undefined)
        employee.hire_date =
          typeof hire_date === "string" ? new Date(hire_date) : hire_date;
      if (phone_number !== undefined) employee.phone_number = phone_number;

      // Save changes
      const updatedEmployee = await employeeRepository.save(employee);

      res.status(200).json({ success: true, data: updatedEmployee });
    } catch (error: any) {
      console.error("Failed to update employee", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}
