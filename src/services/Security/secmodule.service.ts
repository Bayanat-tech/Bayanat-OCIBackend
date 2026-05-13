import { getRepository } from "../../database/connection";
import { SecModule } from "../../entity/Security/secmodule.entity";

export class SecModuleService {
  private static getSecModuleRepository() {
    return getRepository(SecModule);
  }

  static async findDuplicate(params: {
    company_code: string;
    app_code: string;
    level1: string;
    level2: string;
    level3: string;
    url_path: string;
    icon: string;
    component_name?: string;
  }): Promise<SecModule | null> {
    const repository = this.getSecModuleRepository();
    return await repository.findOne({
      where: {
        company_code: params.company_code,
        app_code: params.app_code,
        level1: params.level1,
        level2: params.level2,
        level3: params.level3,
        url_path: params.url_path,
        icon: params.icon,
        component_name: params.component_name,
      },
    });
  }

  static async findBySerialAndCompany(
    serial_no: number,
    company_code: string
  ): Promise<SecModule | null> {
    const repository = this.getSecModuleRepository();
    return await repository.findOne({
      where: { serial_no, company_code },
    });
  }

  static async createModule(moduleData: {
    company_code: string;
    app_code: string;
    level1: string;
    level2: string;
    level3: string;
    position: number;
    url_path: string;
    icon: string;
    component_name?: string;
    created_by: string;
    updated_by: string;
  }): Promise<SecModule> {
    const repository = this.getSecModuleRepository();

    // Get the next serial number
    // Note: repository.createQueryBuilder is proxied to ensure tenant schema
    // and therefore returns a Promise — await it first to get the actual
    // QueryBuilder before chaining `select`.
    const qb = await repository.createQueryBuilder("secModule");
    const maxSerial = await qb.select("MAX(secModule.serial_no)", "max").getRawOne();

    const nextSerial = (maxSerial?.max || 0) + 1;

    const module = repository.create({
      ...moduleData,
      serial_no: nextSerial,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return await repository.save(module);
  }

  static async updateModule(
    serial_no: number,
    company_code: string,
    updateData: any
  ): Promise<boolean> {
    const repository = this.getSecModuleRepository();

    const result = await repository.update(
      { serial_no, company_code },
      {
        ...updateData,
        updated_at: new Date(),
      }
    );

    return result.affected ? result.affected > 0 : false;
  }
}
