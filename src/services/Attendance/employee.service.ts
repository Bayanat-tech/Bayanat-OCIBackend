import { Request, Response } from "express";
import { AppDataSource } from "../../database/connection";
import { Employee } from "../../entity/Attendance/employee.entity";
import constants from "../../helpers/constants";
import axios from "axios";
import https from "https";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const API_BASE_URL = process.env.NET_API_BASE_URL?.trim();
const API_KEY = process.env.NET_API_KEY?.trim();

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  httpsAgent,
  headers: {
    XApiKey: API_KEY,
    "Content-Type": "application/json",
    accept: "*/*",
  },
  timeout: 30000,
  validateStatus: (status) => status < 500,
});

export interface EmployeeInfo {
  EMPLOYEE_CODE: string;
  RPT_NAME: string;
  EMP_STATUS: string;
  [key: string]: any;
}

export const EmployeeService = {
  getEmployeeInfo: async (params: {
    employee_code?: string;
    name?: string;
  }): Promise<EmployeeInfo[]> => {
    try {
      if (!params.employee_code && !params.name) {
        throw new Error("Either employee_code or name is required");
      }

      const response = await axiosInstance.get(
        "/api/EmployeeLeave/employeeinfo",
        {
          params,
        }
      );

      if (response.status >= 400) {
        throw new Error(
          `API Error: ${response.status} ${JSON.stringify(response.data)}`
        );
      }

      return response.data;
    } catch (error: any) {
      console.error("Error in getEmployeeInfo:", {
        message: error.message,
        response: error.response?.data,
        config: error.config,
      });
      throw error;
    }
  },
};


export class EmployeesController {
  // Fetch all employees
  static async getEmployees(page: number, limit: number, sort: any, search: string): Promise<any> {
    try {
      console.log("Employee", Employee);

      // Raw SQL query (already working)
      let sql = `SELECT * FROM ${constants.TABLE.employees}`;

      // Add search filter
      if (search) {
        sql += ` WHERE full_name LIKE '%${search}%' OR employee_id LIKE '%${search}%'`;
      }

      sql += ` ORDER BY ${sort.field || 'full_name'} ${sort.direction || 'ASC'}`;

      const employees = await AppDataSource.query(sql);

      // Pagination logic here if needed
      return {
        data: employees,
        page,
        limit,
        total: employees.length
      };
    } catch (error: any) {
      throw error; // Let controller handle response
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

    // Build update object with only provided fields
    const updateData: Record<string, any> = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (email !== undefined) updateData.email = email;
    if (department !== undefined) updateData.department = department;
    if (position !== undefined) updateData.position = position;
    if (hire_date !== undefined) updateData.hire_date = hire_date;
    if (phone_number !== undefined) updateData.phone_number = phone_number;

    // Check if employee exists
    const checkSql = `SELECT id FROM ${constants.TABLE.employees} WHERE id = :id`;
    const existingEmployee = await AppDataSource.query(checkSql, [id]);
    
    if (existingEmployee.length === 0) {
      res.status(404).json({ success: false, message: "Employee not found" });
      return;
    }

    // Perform update using QueryBuilder with string table name
    const result = await AppDataSource
      .createQueryBuilder()
      .update(Employee) // Use table name as string
      .set(updateData)
      .where("id = :id", { id })
      .returning("*") // Returns updated data
      .execute();

  
    const updatedEmployee = result.raw[0];

    res.status(200).json({ 
      success: true, 
      data: updatedEmployee 
    });
  } catch (error: any) {
    console.error("Failed to update employee", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

}
