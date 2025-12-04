import { Request, Response } from "express";
import { AppDataSource } from "../../database/connection";
import { Employee } from "../../models/Attendance/employee.entity";
import constants from "../../helpers/constants";

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

  //      .createQueryBuilder()
  // .update(Employee) // ✅ ENTITY CLASS
  // .set(updateData)
  // .where("id = :id", { id })
  // .execute();
    // Get the updated row from the result
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
