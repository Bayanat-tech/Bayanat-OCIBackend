import { getRepository } from "../../database/connection";
import { ProducttypeMaster } from "../../entity/WMS/producttype.entity";

export class ProducttypeService {
  private static repo() {
    return getRepository(ProducttypeMaster);
  }

  // Check duplicate
  static async findDuplicate(
    prodtype_code: number,
    company_code: string
  ): Promise<ProducttypeMaster | null> {
    return this.repo().findOne({
      where: { prodtype_code, company_code },
    });
  }

  // Get all
  static async findAll(
    company_code: string
  ): Promise<ProducttypeMaster[]> {
    return this.repo().find({
      where: { company_code },
      order: { prodtype_code: "ASC" },
    });
  }

  // Find by code
  static async findByCode(
    prodtype_code: number,
    company_code: string
  ): Promise<ProducttypeMaster | null> {
    return this.repo().findOne({
      where: { prodtype_code, company_code },
    });
  }

  // Create
  static async create(
    data: Pick<ProducttypeMaster, "prodtype_code" | "prodtype_desc" | "company_code">
  ): Promise<ProducttypeMaster> {
    const entity = this.repo().create(data);
    return this.repo().save(entity);
  }

  // Update
  static async update(
    prodtype_code: number,
    company_code: string,
    data: Pick<ProducttypeMaster, "prodtype_desc">
  ): Promise<boolean> {
    const result = await this.repo().update(
      { prodtype_code, company_code },
      data
    );

    return !!result.affected && result.affected > 0;
  }

  // Delete
  static async delete(
    prodtype_codes: number[]
  ): Promise<number> {
    const result = await this.repo().delete(prodtype_codes);
    return result.affected ?? 0;
  }
}
