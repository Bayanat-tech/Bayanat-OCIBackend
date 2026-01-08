import { getRepository } from "../../database/connection";
import { ProducttypeMaster } from "../../entity/WMS/producttype.entity";

export class ProducttypeService {
  private static getRepository() {
    return getRepository(ProducttypeMaster);
  }

  // Check duplicate by code (company wise)
  static async findDuplicate(
    prodtype_code: number,
    company_code: string
  ): Promise<ProducttypeMaster | null> {
    return await this.getRepository().findOne({
      where: { prodtype_code, company_code },
    });
  }

  static async findAll(company_code: string): Promise<ProducttypeMaster[]> {
    return await this.getRepository().find({
      where: { company_code },
      order: { prodtype_code: "ASC" },
    });
  }

  static async findByCode(
    prodtype_code: number,
    company_code: string
  ): Promise<ProducttypeMaster | null> {
    return await this.getRepository().findOne({
      where: { prodtype_code, company_code },
    });
  }

  static async create(
    data: Partial<ProducttypeMaster>
  ): Promise<ProducttypeMaster> {
    const repo = this.getRepository();

    const entity = repo.create({
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return await repo.save(entity);
  }

  static async update(
    prodtype_code: number,
    company_code: string,
    data: Partial<ProducttypeMaster>
  ): Promise<boolean> {
    const result = await this.getRepository().update(
      { prodtype_code, company_code },
      {
        ...data,
        updated_at: new Date(),
      }
    );

    return !!result.affected && result.affected > 0;
  }

  static async delete(
    prodtype_codes: number[]
  ): Promise<number> {
    const result = await this.getRepository().delete(prodtype_codes);
    return result.affected ?? 0;
  }
}
