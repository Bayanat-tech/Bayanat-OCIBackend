import { Repository } from "typeorm";
import { TypeORMService } from "../database/connection";
import { FilesAFEntity } from "../entities/account_files.entity";

export class FilesAFService {
  private static instance: FilesAFService;
  private repository: Repository<FilesAFEntity> | null = null;

  private constructor() {}

  static async getInstance(): Promise<FilesAFService> {
    if (!FilesAFService.instance) {
      FilesAFService.instance = new FilesAFService();
    }

    await FilesAFService.instance.ensureRepository();
    return FilesAFService.instance;
  }

  private async ensureRepository() {
    if (!this.repository) {
      try {
        await TypeORMService.initialize();
        this.repository = TypeORMService.getRepository(FilesAFEntity);
      } catch (error) {
        console.error("Failed to initialize repository:", error);
        throw error;
      }
    }
    return this.repository;
  }

  private mapConditionsToEntity(conditions: any): any {
    if (!conditions || typeof conditions !== "object") return {};
    const mapping: Record<string, string> = {
      request_number: "requestNumber",
      requestnumber: "requestNumber",
      request_no: "requestNumber",

      company_code: "companyCode",
      companycode: "companyCode",

      sr_no: "srNo",
      srno: "srNo",

      aws_file_locn: "awsFileLocn",
      awsfilelocn: "awsFileLocn",

      user_file_name: "userFileName",
      userfilename: "userFileName",

      modules: "modules",
    };

    const mapped: any = {};
    for (const key of Object.keys(conditions)) {
      const normalizedKey = key.toString().toLowerCase();
      const targetKey = mapping[normalizedKey] || key;
      mapped[targetKey] = (conditions as any)[key];
    }
    return mapped;
  }

  async findAll(conditions: any): Promise<FilesAFEntity[]> {
    const repo = await this.ensureRepository();

    try {
      // map incoming condition keys to entity property names
      const mappedConditions = this.mapConditionsToEntity(conditions);

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

  async findOne(conditions: any): Promise<FilesAFEntity | null> {
    const repo = await this.ensureRepository();
    const mapped = this.mapConditionsToEntity(conditions);
    return await repo.findOne({ where: mapped });
  }

  async update(conditions: any, updateData: any) {
    const repo = await this.ensureRepository();
    const mapped = this.mapConditionsToEntity(conditions);
    return await repo.update(mapped, updateData);
  }

  async delete(conditions: any) {
    const repo = await this.ensureRepository();
    const mapped = this.mapConditionsToEntity(conditions);
    return await repo.delete(mapped);
  }
}
