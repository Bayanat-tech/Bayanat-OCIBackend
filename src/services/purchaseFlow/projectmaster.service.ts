import { getRepository } from "../../database/connection";
import { ProjectMaster } from "../../entity/Purchaseflow/projectmaster.entity";

export class ProjectMasterService {
  private static getRepository() {
    return getRepository(ProjectMaster);
  }

  static async findDuplicate(
    project_code: string,
    company_code: string
  ): Promise<ProjectMaster | null> {
    const repo = this.getRepository();

    return await repo.findOne({
      where: { project_code, company_code },
    });
  }

  // Create
  static async createProject(data: any) {
    const repo = this.getRepository();

    const exists = await repo.findOne({
      where: {
        company_code: data.company_code,
        project_code: data.project_code,
      },
    });

    if (exists) {
      return {
        success: false,
        message: "Project Master Already Exists",
      };
    }

    const project = repo.create({
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const saved = await repo.save(project);

    return {
      success: true,
      message: "Project created successfully",
      data: saved,
    };
  }

  // Update
  static async updateProject(
    project_code: string,
    company_code: string,
    updateData: any
  ) {
    const repo = this.getRepository();

    const existing = await repo.findOne({
      where: {
        company_code,
        project_code,
      },
    });

    if (!existing) {
      throw new Error("Project Master Already Exists")
    }

    await repo.update(
      { project_code, company_code },
      {
        ...updateData,
        updated_at: new Date(),
      }
    );

    return {
      success: true,
      message: "Project Master Updated Successfully",
    };
  }
}

