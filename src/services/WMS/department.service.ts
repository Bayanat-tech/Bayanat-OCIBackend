import { getRepository } from "../../database/connection";
import { DepartmentMaster } from "../../entity/WMS/department.entity";

export class DepartmentService {
  private static getDepartmentRepository() {
    return getRepository(DepartmentMaster);
  }

  // Check for duplicate department by code and name
  static async findDuplicate(params: {
    company_code: string;
    div_code: string;
    dept_code: string;
  }): Promise<DepartmentMaster | null> {
    const repository = this.getDepartmentRepository();
    return await repository.findOne({
      where: {
        company_code: params.company_code,
        div_code: params.div_code,
        dept_code: params.dept_code,
      },
    });
  }

  // Get all departments
  static async findAll(): Promise<DepartmentMaster[]> {
    try {
      const repository = this.getDepartmentRepository();
      return await repository.find();
    } catch (error: any) {
      // Handle case where MS_HR_DEPARTMENT table doesn't exist in tenant schema
      if (error.code === 'ORA-00942' || error.driverError?.code === 'ORA-00942') {
        console.warn('[DepartmentService.findAll] ⚠️  MS_HR_DEPARTMENT table not available in this tenant schema');
        return []; // Return empty array gracefully
      }
      // Re-throw other errors
      throw error;
    }
  }

  // Find department by code
  static async findByCode(
    dept_code: string,
    company_code: string
  ): Promise<DepartmentMaster | null> {
    const repository = this.getDepartmentRepository();
    return await repository.findOne({
      where: { dept_code, company_code },
    });
  }

  // Create new department
    static async createDepartment(deptData: {
      company_code: string;
      div_code: string;
      dept_code: string;  
      dept_name: string;
      dept_short_name?: string;
      dept_addr1?: string;
      dept_addr2?: string;
      dept_addr3?: string;
      phone?: string;
      fax?: string;
      email?: string;
      dept_head_id?: string;
      remarks?: string;
      status: string;
      user_id?: string;
      user_dt?: Date;
      enterprice_code: string;
    }): Promise<DepartmentMaster> {
      const repository = this.getDepartmentRepository();
      
      // Create the department object with proper TypeScript types
      const departmentData: Partial<DepartmentMaster> = {
        company_code: deptData.company_code,
        div_code: deptData.div_code,
        dept_code: deptData.dept_code,
        dept_name: deptData.dept_name,
        status: deptData.status,
        enterprice_code: deptData.enterprice_code,
        user_id: deptData.user_id,
        user_dt: deptData.user_dt,
      };
      
      // Add optional fields only if they have values (not empty strings)
      if (deptData.dept_short_name && deptData.dept_short_name.trim() !== '') {
        departmentData.dept_short_name = deptData.dept_short_name;
      }
      
      if (deptData.dept_addr1 && deptData.dept_addr1.trim() !== '') {
        departmentData.dept_addr1 = deptData.dept_addr1;
      }
      
      if (deptData.dept_addr2 && deptData.dept_addr2.trim() !== '') {
        departmentData.dept_addr2 = deptData.dept_addr2;
      }
      
      if (deptData.dept_addr3 && deptData.dept_addr3.trim() !== '') {
        departmentData.dept_addr3 = deptData.dept_addr3;
      }
      
      if (deptData.phone && deptData.phone.trim() !== '') {
        departmentData.phone = deptData.phone;
      }
      
      if (deptData.fax && deptData.fax.trim() !== '') {
        departmentData.fax = deptData.fax;
      }
      
      if (deptData.email && deptData.email.trim() !== '') {
        departmentData.email = deptData.email;
      }
      
      if (deptData.dept_head_id && deptData.dept_head_id.trim() !== '') {
        departmentData.dept_head_id = deptData.dept_head_id;
      }
      
      if (deptData.remarks && deptData.remarks.trim() !== '') {
        departmentData.remarks = deptData.remarks;
      }
      
      const department = repository.create(departmentData as DepartmentMaster);
      return await repository.save(department);
    }

  // Update existing department
  static async updateDepartment(
    dept_code: string,
    company_code: string,
    updateData: Partial<DepartmentMaster>
  ): Promise<boolean> {
    const repository = this.getDepartmentRepository();
    const result = await repository.update(
      { dept_code, company_code },
      updateData
    );
    return result.affected ? result.affected > 0 : false;
  }

  // Delete department
  static async deleteDepartment(
    dept_code: string,
    company_code?: string
  ): Promise<boolean> {
    const repository = this.getDepartmentRepository();
    const whereClause = company_code
      ? { dept_code, company_code }
      : { dept_code };
    const result = await repository.delete(whereClause);
    return result.affected ? result.affected > 0 : false;
  }

  // Check if department exists
  static async checkDepartmentExists(dept_code: string): Promise<boolean> {
    const repository = this.getDepartmentRepository();
    const count = await repository.count({
      where: { dept_code },
    });
    return count > 0;
  }
}
