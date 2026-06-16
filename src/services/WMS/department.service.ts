import { FindManyOptions } from "typeorm";
import { getRepository } from "../../database/connection";
import { DepartmentMaster } from "../../entity/WMS/department.entity";

export class DepartmentService {
  private static getDepartmentRepository() {
    return getRepository(DepartmentMaster);
  }

  // Check for duplicate department by the actual unique key (company_code + dept_code)
  static async findDuplicate(params: {
    company_code: string;
    dept_code: string;
  }): Promise<DepartmentMaster | null> {
    const repository = this.getDepartmentRepository();
    return await repository.findOne({
      where: {
        company_code: params.company_code,
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
      // Handle case where MS_DEPARTMENT table doesn't exist in tenant schema
      if (error.code === 'ORA-00942' || error.driverError?.code === 'ORA-00942') {
        console.warn('[DepartmentService.findAll] ⚠️  MS_DEPARTMENT table not available in this tenant schema');
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
    dept_code: string;
    dept_name?: string;
    inv_flag?: string;
    user_dt?: Date;
    user_id?: string;
    jobno_seq?: number;
    invno_seq?: number;
    operation_type?: string;
    div_code?: string;
    ac_div_code?: string;
    inv_prefix?: string;
    wms_inv_prefix?: string;
    trspt_inv_prefix?: string;
    jobno_seq_inb?: string;
    jobno_seq_oub?: string;
  }): Promise<DepartmentMaster> {
    const repository = this.getDepartmentRepository();

    // Required fields (PK)
    const departmentData: Partial<DepartmentMaster> = {
      company_code: deptData.company_code,
      dept_code: deptData.dept_code,
    };

    // Add optional fields only if they have values (not empty strings)
    if (deptData.dept_name && deptData.dept_name.trim() !== '') {
      departmentData.dept_name = deptData.dept_name;
    }

    if (deptData.inv_flag && deptData.inv_flag.trim() !== '') {
      departmentData.inv_flag = deptData.inv_flag;
    }

    if (deptData.user_dt) {
      departmentData.user_dt = deptData.user_dt;
    }

    if (deptData.user_id && deptData.user_id.trim() !== '') {
      departmentData.user_id = deptData.user_id;
    }

    if (deptData.jobno_seq !== undefined) {
      departmentData.jobno_seq = deptData.jobno_seq;
    }

    if (deptData.invno_seq !== undefined) {
      departmentData.invno_seq = deptData.invno_seq;
    }

    if (deptData.operation_type && deptData.operation_type.trim() !== '') {
      departmentData.operation_type = deptData.operation_type;
    }

    if (deptData.div_code && deptData.div_code.trim() !== '') {
      departmentData.div_code = deptData.div_code;
    }

    if (deptData.ac_div_code && deptData.ac_div_code.trim() !== '') {
      departmentData.ac_div_code = deptData.ac_div_code;
    }

    if (deptData.inv_prefix && deptData.inv_prefix.trim() !== '') {
      departmentData.inv_prefix = deptData.inv_prefix;
    }

    if (deptData.wms_inv_prefix && deptData.wms_inv_prefix.trim() !== '') {
      departmentData.wms_inv_prefix = deptData.wms_inv_prefix;
    }

    if (deptData.trspt_inv_prefix && deptData.trspt_inv_prefix.trim() !== '') {
      departmentData.trspt_inv_prefix = deptData.trspt_inv_prefix;
    }

    if (deptData.jobno_seq_inb && deptData.jobno_seq_inb.trim() !== '') {
      departmentData.jobno_seq_inb = deptData.jobno_seq_inb;
    }

    if (deptData.jobno_seq_oub && deptData.jobno_seq_oub.trim() !== '') {
      departmentData.jobno_seq_oub = deptData.jobno_seq_oub;
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
  static async checkDepartmentExists(
    dept_code: string,
    company_code: string
  ): Promise<boolean> {
    const repository = this.getDepartmentRepository();
    const count = await repository.count({
      where: { dept_code, company_code },
    });
    return count > 0;
  }

  static async findAndCount(options: FindManyOptions<DepartmentMaster>): Promise<[DepartmentMaster[], number]> {
  try {
    const repository = this.getDepartmentRepository();
    return await repository.findAndCount(options);
  } catch (error: any) {
    if (error.code === 'ORA-00942' || error.driverError?.code === 'ORA-00942') {
      console.warn('[DepartmentService.findAndCount] ⚠️  MS_DEPARTMENT table not available in this tenant schema');
      return [[], 0];
    }
    throw error;
  }
}
}