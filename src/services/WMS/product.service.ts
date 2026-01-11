  import { getRepository } from "../../database/connection";
  import { Product } from "../../entity/WMS/product.entity";
  import { In } from "typeorm";

  export class ProductService {
    private static getProductRepository() {
      return getRepository(Product);
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

      const product = repository.create(productData);
      return await repository.save(product);
    }

    static async updateProduct(
      prod_code: string,
      company_code: string,
      updateData: Partial<Product>
    ): Promise<boolean> {
      const repository = this.getProductRepository();

      const result = await repository.update(
        { prod_code, company_code },
        updateData
      );

      return result.affected ? result.affected > 0 : false;
    }

    static async deleteProducts(prod_codes: string[]): Promise<boolean> {
      const repository = this.getProductRepository();

      const result = await repository.delete({
        prod_code: In(prod_codes),
      });

      return result.affected ? result.affected > 0 : false;
    }

    static async checkProductExists(
      prod_code: string,
      company_code: string
    ): Promise<boolean> {
      const repository = this.getProductRepository();
      const count = await repository.count({
        where: { prod_code, company_code },
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

      try {
        const queryBuilder = repository.createQueryBuilder("product");

        // Always filter by company code - FIXED
        if (filters.company_code) {
          console.log("✅ Filtering by company_code:", filters.company_code);
          queryBuilder.where("product.company_code = :company_code", { 
            company_code: filters.company_code 
          });
        }
        // Add product name filter if present - FIXED
        if (filters.prod_name) {
          console.log("✅ Filtering by prod_name:", filters.prod_name);
          queryBuilder.andWhere("product.prod_name LIKE :prod_name", { 
            prod_name: `%${filters.prod_name}%` 
          });
        }

        // Add product code filter if present - FIXED
        if (filters.prod_code) {
          console.log("✅ Filtering by prod_code:", filters.prod_code);
          queryBuilder.andWhere("product.prod_code LIKE :prod_code", { 
            prod_code: `%${filters.prod_code}%` 
          });
        }

        // Get total count
        const total = await queryBuilder.getCount();
        console.log("📊 Total products found:", total);

        // Apply pagination and get results - FIXED field name
        const data = await queryBuilder
          .skip((page - 1) * limit)
          .take(limit)
          .orderBy("product.prod_code", "ASC") // ✅ Fixed: prod_code not prodCode
          .getMany();

        console.log("📦 Products fetched:", data.length);
        
        if (data.length > 0) {
          console.log("🔎 First product sample keys:", Object.keys(data[0]));
        }

        return { data, total };
      } catch (error: any) {
        console.error("❌ Error in ProductService.getProducts:", error.message);
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
      
      if (group_code) {
        whereConditions.groupCode = group_code;
      }
      
      if (category_abc) {
        whereConditions.categoryAbc = category_abc;
      }
      
      return await repository.find({ where: whereConditions });
    }
  }
