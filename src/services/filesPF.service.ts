import { Repository } from "typeorm";
import { TypeORMService } from "../database/connection";
import { FilesPFEntity } from "../entities/files_PF.entity";

export class FilesPFService {
  private static instance: FilesPFService;
  private repository: Repository<FilesPFEntity> | null = null;

  private constructor() {}

  static async getInstance(): Promise<FilesPFService> {
    if (!FilesPFService.instance) {
      FilesPFService.instance = new FilesPFService();
    }

    await FilesPFService.instance.ensureRepository();
    return FilesPFService.instance;
  }

  private async ensureRepository() {
    if (!this.repository) {
      try {
        await TypeORMService.initialize();
        this.repository = TypeORMService.getRepository(FilesPFEntity);
      } catch (error) {
        console.error("Failed to initialize repository:", error);
        throw error;
      }
    }
    return this.repository;
  }

  async findAll(conditions: any): Promise<FilesPFEntity[]> {
    const repo = await this.ensureRepository();

    try {
      const mappedConditions = {
        companyCode: conditions.company_code,
        requestNumber: conditions.request_number,
        modules: conditions.modules,
      };

      console.log("Finding files with conditions:", mappedConditions);

      const results = await repo.find({
        where: mappedConditions,
        order: { srNo: "DESC" },
      });

      if (results.length === 0) {
        console.log("No records found for the given conditions");
        return [];
      }

      return results;
    } catch (error) {
      console.error("Error in findAll:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch files: ${message}`);
    }
  }

  async findOne(conditions: any): Promise<FilesPFEntity | null> {
    const repo = await this.ensureRepository();
    return await repo.findOne({ where: conditions });
  }

  async update(conditions: any, updateData: any) {
    const repo = await this.ensureRepository();
    return await repo.update(conditions, updateData);
  }

  async delete(conditions: any) {
    const repo = await this.ensureRepository();
    return await repo.delete(conditions);
  }
}
