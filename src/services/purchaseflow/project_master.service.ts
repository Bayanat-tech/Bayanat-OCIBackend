import { getRepository } from "../../database/connection";
import { ProjectMaster } from "../../entity/PurchaseFlow/projectmaster.entity";
import { VProjectMaster } from "../../entity/PurchaseFlow/projectmaster_pf_view.entity";

export interface Master<T> {
  fetchedData: T[];
  totalCount: number;
}

export class ProjectMasterService {
  static async getRepository(company_code: string, page = 1, limit = 4000): Promise<Master<VProjectMaster>> {
    const skip = (page - 1) * limit;
    const repository = getRepository(VProjectMaster);
    const [fetchedData, totalCount] = await repository.findAndCount({
      where: { company_code } as any,
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }

  static async findDuplicate(project_code: string, company_code: string): Promise<ProjectMaster | null> {
    const repository = getRepository(ProjectMaster);
    return await repository.findOne({
      where: {
        project_code,
        company_code,
      } as any,
    });
  }

  static async createProject(projectData: Partial<ProjectMaster>): Promise<ProjectMaster> {
    const repository = getRepository(ProjectMaster);
    const project = repository.create({
      ...projectData,
      created_at: projectData.created_at || new Date(),
      updated_at: projectData.updated_at || new Date(),
    } as ProjectMaster);

    return await repository.save(project);
  }

  static async updateProject(
    project_code: string,
    company_code: string,
    projectData: Partial<ProjectMaster>
  ): Promise<boolean> {
    const repository = getRepository(ProjectMaster);
    const result = await repository.update(
      {
        project_code,
        company_code,
      } as any,
      {
        ...projectData,
        updated_at: new Date(),
      } as any
    );

    return Boolean(result.affected && result.affected > 0);
  }

  static async deleteProjects(projectCodes: string[]): Promise<number> {
    const repository = getRepository(ProjectMaster);
    const result = await repository
      .createQueryBuilder()
      .delete()
      .from(ProjectMaster)
      .where("PROJECT_CODE IN (:...projectCodes)", { projectCodes })
      .execute();

    return result.affected || 0;
  }

  static async getProjectMaster(
    loginid: string,
    page = 1,
    limit = 4000
  ): Promise<Master<VProjectMaster>> {
    const skip = (page - 1) * limit;
    const repository = getRepository(VProjectMaster);

    let fetchedData: VProjectMaster[] = [];
    let totalCount = 0;

   
    if (loginid !== "PRAKASH") {
      [fetchedData, totalCount] = await repository
        .createQueryBuilder("proj")
        .where(
          `proj.project_code IN (
            SELECT project_code 
            FROM MS_PROJECT_USER_ASSIGN 
            WHERE user_id = :loginid
          )`,
          { loginid }
        )
        .skip(skip)
        .take(limit)
        .getManyAndCount();
    } else {
      [fetchedData, totalCount] = await repository
        .createQueryBuilder("proj")
        .skip(skip)
        .take(limit)
        .getManyAndCount();
    }

    return { fetchedData, totalCount };
  }
}
