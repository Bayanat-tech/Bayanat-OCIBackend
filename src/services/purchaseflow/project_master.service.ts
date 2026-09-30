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

  static async findDuplicate(project_code: string, company_code: string): Promise<ProjectMaster | null> {
    const repository = getRepository(ProjectMaster);
    return await repository.findOne({
      where: {
        project_code,
        company_code,
      },
    });
  }

  static async createProject(payload: Partial<ProjectMaster>): Promise<ProjectMaster> {
    const repository = getRepository(ProjectMaster);
    const entity = repository.create({
      ...payload,
      project_date_from: normalizeDate(payload.project_date_from),
      project_date_to: normalizeDate(payload.project_date_to),
    });
    return await repository.save(entity);
  }

  static async updateProject(
    project_code: string,
    company_code: string,
    payload: Partial<ProjectMaster>
  ): Promise<boolean> {
    const repository = getRepository(ProjectMaster);
    const result = await repository.update(
      { project_code, company_code },
      {
        ...payload,
        project_date_from: normalizeDate(payload.project_date_from),
        project_date_to: normalizeDate(payload.project_date_to),
        updated_at: new Date(),
      }
    );
    return Boolean(result.affected && result.affected > 0);
  }

  static async deleteProjects(projectCodes: string[]): Promise<number> {
    const repository = getRepository(ProjectMaster);
    const result = await repository
      .createQueryBuilder()
      .delete()
      .from(ProjectMaster)
      .where("project_code IN (:...projectCodes)", { projectCodes })
      .execute();
    return result.affected || 0;
  }
}

function normalizeDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
