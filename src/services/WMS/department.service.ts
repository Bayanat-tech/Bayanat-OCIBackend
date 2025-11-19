import { getRepository } from "../../database/connection";
import { DepartmentMaster } from "../../entity/WMS/department.entity";

export class DepartmentService {
  private static getDepartmentRepository() {
    return getRepository(DepartmentMaster);
  }

  // Check for duplicate department by code and name
  static async findDuplicate(params: {
    dept_code: string;
    dept_name?: string;
  }): Promise<DepartmentMaster | null> {
    const repository = this.getDepartmentRepository();
    return await repository.findOne({
      where: {
        dept_code: params.dept_code,
        dept_name: params.dept_name,
      },
    });
  }

  // Get all departments
  static async findAll(): Promise<DepartmentMaster[]> {
    const repository = this.getDepartmentRepository();
    return await repository.find();
  }

  // Find department by code
  static async findByCode(dept_code: string): Promise<DepartmentMaster | null> {
    const repository = this.getDepartmentRepository();
    return await repository.findOne({
      where: { dept_code },
    });
  }

  // Create new department
  static async createDepartment(deptData: {
    dept_code: string;
    dept_name?: string;
    inv_flag?: string;
    jobno_seq?: number;
    invno_seq?: number;
    company_code: string;
    operation_type?: string;
    div_code?: string;
    ac_div_code?: string;
    dept_email?: string;
    dn_email?: string;
    grn_email?: string;
    inv_gen?: string;
    inb_oub_related?: string;
    inv_prefix?: string;
    created_by?: string;
    updated_by?: string;
    wms_inv_prefix?: string;
    trspt_inv_prefix?: string;
  }): Promise<DepartmentMaster> {
    const repository = this.getDepartmentRepository();

    const department = repository.create({
      ...deptData,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return await repository.save(department);
  }

  // Update existing department
  static async updateDepartment(
    dept_code: string,
    updateData: Partial<DepartmentMaster>
  ): Promise<boolean> {
    const repository = this.getDepartmentRepository();

    const result = await repository.update(
      { dept_code },
      {
        ...updateData,
        updated_at: new Date(),
      }
    );

    return result.affected ? result.affected > 0 : false;
  }

  // Delete department
  static async deleteDepartment(dept_code: string): Promise<boolean> {
    const repository = this.getDepartmentRepository();
    const result = await repository.delete({ dept_code });
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
