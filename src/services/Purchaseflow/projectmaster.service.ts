import { getRepository } from "../../database/connection";
import { ProjectMaster } from "../../entity/PurchaseFlow/projectmaster.entity";


export class ProjectMasterService {
  private static getRepository() {
    return getRepository(ProjectMaster);
  }

  // Duplicate Check
  static async findDuplicate(
    project_code: string,
    company_code: string
  ): Promise<ProjectMaster | null> {
    const repo = this.getRepository();

    return await repo.findOne({
      where: { project_code, company_code }
    });
  }

  // Create
  // static async createProject(data: any): Promise<ProjectMaster> {
  //   const repo = this.getRepository();

  //   const project = repo.create({
  //     ...data,
  //     created_at: new Date(),
  //     updated_at: new Date()
  //   });

  //   return await repo.save(project);
  // }

  // Update
  static async updateProject(
    project_code: string,
    company_code: string,
    updateData: any
  ): Promise<boolean> {
    const repo = this.getRepository();

    const result = await repo.update(
      { project_code, company_code },
      {
        ...updateData,
        updated_at: new Date()
      }
    );

    return result.affected ? result.affected > 0 : false;
  }

  // Delete
  static async deleteProjects(projectCodes: string[]): Promise<number> {
    const repo = this.getRepository();

    const result = await repo.delete(projectCodes);

    return result.affected ? result.affected : 0;
  }
}
