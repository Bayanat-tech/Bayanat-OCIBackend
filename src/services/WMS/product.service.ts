import { AppDataSource } from "../../database/connection";
import { Product } from "../../entity/WMS/product.entity";
import { In, IsNull } from "typeorm";
import { ProductEDI } from "../../entity/WMS/product_edi.entity";
import { IUser } from "../../interfaces/user.interface";

export class ProductService {
  private static getProductRepository() {
    return AppDataSource.getRepository(Product);
  }

  static async findByNameAndCompany(
    prod_name: string,
    company_code: string
  ): Promise<Product | null> {
    const repository = this.getProductRepository();
    return await repository.findOne({
      where: { prod_name, company_code },
    });
  }

  static async checkProductDuplicate(
    company_code: string,
    prin_code: string,
    group_code: string | null,
    brand_code: string | null
  ): Promise<Product | null> {
    const repository = this.getProductRepository();
    const whereConditions: any = { company_code, prin_code };

    if (group_code) whereConditions.group_code = group_code;
    if (brand_code) whereConditions.brand_code = brand_code;

    return await repository.findOne({ where: whereConditions });
  }

  static async findByCodeAndCompany(
    prod_code: string,
    company_code: string
  ): Promise<Product | null> {
    const repository = this.getProductRepository();
    return await repository.findOne({
      where: { prod_code, company_code },
    });
  }

  static async createProduct(productData: Partial<Product>): Promise<Product> {
    const repository = this.getProductRepository();
    const product = repository.create({
      ...productData,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return await repository.save(product);
  }

  static async bulkCreateProducts(productsData: Partial<Product>[]): Promise<Product[]> {
    const repository = this.getProductRepository();

    try {
      console.log(`📦 Bulk creating ${productsData.length} products...`);
      const products = repository.create(productsData);
      const chunkSize = 100;
      const savedProducts: Product[] = [];

      for (let i = 0; i < products.length; i += chunkSize) {
        const chunk = products.slice(i, i + chunkSize);
        console.log(`💾 Saving chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(products.length / chunkSize)}`);
        const saved = await repository.save(chunk, { chunk: chunkSize });
        savedProducts.push(...saved);
      }

      console.log(`✅ Successfully saved ${savedProducts.length} products`);
      return savedProducts;
    } catch (error: any) {
      console.error("❌ Error in bulkCreateProducts:", error.message);
      throw error;
    }
  }

  static async insertToEDI(products: Partial<ProductEDI>[], user: IUser): Promise<any> {
    const repo = AppDataSource.getRepository(ProductEDI);
    const mapped = products.map(p => ({
      ...p,
      company_code: user.company_code,
      user_id: user.loginid,
      created_by: user.loginid,
      created_at: new Date(),
      error_message: null,
    }));
    await repo.save(mapped);
  }

  static async postValidProducts(
    company_code: string,
    loginid: string
  ): Promise<{ count: number }> {
    const ediRepo = AppDataSource.getRepository(ProductEDI);
    const masterRepo = this.getProductRepository();

    const validRows = await ediRepo.find({
      where: { company_code, created_by: loginid, error_message: IsNull() },
    });

    if (!validRows.length) return { count: 0 };

    const mapped = validRows.map(row => {
      const { id, error_message, ...cleanRow } = row as any;
      return {
        ...cleanRow,
        created_by: loginid,
        updated_by: loginid,
        created_at: new Date(),
        updated_at: new Date(),
      };
    });

    await masterRepo.save(mapped, { chunk: 100 });
    await ediRepo.delete({ company_code, created_by: loginid });

    return { count: validRows.length };
  }

  static async clearEDI(company_code: string, loginid: string): Promise<any> {
    const ediRepo = AppDataSource.getRepository(ProductEDI);
    await ediRepo.delete({ company_code, created_by: loginid });
  }

  static async updateProduct(
      prod_code: string,
      company_code: string,
      prin_code: string,
      group_code: string,
      brand_code: string,
      updateData: Partial<Product>
    ): Promise<boolean> {
      try {
        const repository = this.getProductRepository();
          const {
          prod_code: _prodCode,
          company_code: _companyCode,
          prin_code: _prinCode,
          group_code: _groupCode,
          brand_code: _brandCode,
          ...safeUpdateData
        } = updateData;
        const result = await repository.update(
          { prod_code, company_code, prin_code, group_code, brand_code },
          { ...safeUpdateData, updated_at: new Date() }
        );
        return (result.affected ?? 0) > 0;
      } catch (err) {
        console.error('ProductService.updateProduct failed:', err);
        throw err;
      }
    }

    static async deleteProduct(
      prod_code: string,
      prin_code: string,
      company_code: string,
      group_code: string,
      brand_code: string
    ): Promise<boolean> {
      const repository = this.getProductRepository();

      const result = await repository.delete({
        prod_code,
        prin_code,
        company_code,
        group_code,
        brand_code,
      });

      return (result.affected ?? 0) > 0;
    }

  static async getProductsByCodes(
    prod_codes: string[],
    company_code: string
  ): Promise<Product[]> {
    const repository = this.getProductRepository();
    try {
      const products = await repository.find({
        where: { prod_code: In(prod_codes), company_code },
        select: ['prod_code', 'prin_code', 'company_code'],
      });
      console.log(`Found ${products.length} products for codes: ${JSON.stringify(prod_codes)}`);
      return products;
    } catch (error) {
      console.error('Error in ProductService.getProductsByCodes:', error);
      throw error;
    }
  }

  static async checkProductExists(
    prod_code: string,
    company_code: string,
    prin_code: string,
    group_code: string,
    brand_code: string
  ): Promise<boolean> {
    const repository = this.getProductRepository();
    const count = await repository.count({
      where: { prod_code, company_code, prin_code, group_code, brand_code },
    });
    return count > 0;
  }

  static async getProducts(
    filters: any,
    page: number,
    limit: number
  ): Promise<{ data: Product[]; total: number }> {
    const repository = this.getProductRepository();
    console.log("🔍 ProductService.getProducts called with filters:", filters);
    console.log("📊 Pagination params - page:", page, "limit:", limit);

    try {
      const total = await repository
        .createQueryBuilder("product")
        .where("product.company_code = :company_code", { company_code: filters.company_code })
        .getCount();

      console.log("📊 Total products in database:", total);

      const skip = (page - 1) * limit;
      console.log("📊 Pagination - skip:", skip, "limit:", limit);

      const data = await repository
        .createQueryBuilder("product")
        .orderBy("product.prod_code", "ASC")
        .skip(skip)
        .take(limit)
        .getMany();

      console.log("📦 Products fetched:", data.length);
      console.log("🔍 Sample product codes:", data.map(p => p.prod_code));

      return { data, total };
    } catch (error: any) {
      console.error("❌ Error in ProductService.getProducts:", error.message);
      console.error("Stack trace:", error.stack);
      throw error;
    }
  }

  static async getByCategoryOrGroup(
    group_code: string | null,
    category_abc: string | null,
    company_code: string
  ): Promise<Product[]> {
    const repository = this.getProductRepository();
    const whereConditions: any = { company_code };

    if (group_code) whereConditions.groupCode = group_code;
    if (category_abc) whereConditions.categoryAbc = category_abc;

    return await repository.find({ where: whereConditions });
  }
}