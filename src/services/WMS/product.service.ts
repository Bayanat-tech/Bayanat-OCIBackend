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

        static async deleteProducts(
        prod_codes: string[],
        prin_code: string,
        company_code: string
      ): Promise<boolean> {
        const repository = this.getProductRepository();

        console.log(`Deleting products: ${JSON.stringify(prod_codes)} for prin_code: ${prin_code}, company_code: ${company_code}`);

        // Delete using composite key: PROD_CODE + PRIN_CODE + COMPANY_CODE
        const result = await repository.delete({
          prod_code: In(prod_codes),
          prin_code: prin_code,
          company_code: company_code
        });

        console.log(`Deleted ${result.affected || 0} products`);
        return result.affected ? result.affected > 0 : false;
      }

      static async getProductsByCodes(
      prod_codes: string[], 
      company_code: string
    ): Promise<Product[]> {
      const repository = this.getProductRepository();
      
      try {
        const products = await repository.find({
          where: {
            prod_code: In(prod_codes),
            company_code: company_code
          },
          select: ['prod_code', 'prin_code', 'company_code'] 
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
      console.log("📊 Pagination params - page:", page, "limit:", limit);

      try {
        // First, get the total count
        const totalQueryBuilder = repository.createQueryBuilder("product")
          .where("product.company_code = :company_code", { 
            company_code: filters.company_code 
          });

        const total = await totalQueryBuilder.getCount();
        console.log("📊 Total products in database:", total);

        // Now build the main query for data
        const queryBuilder = repository.createQueryBuilder("product");

        // Calculate skip for pagination
        const skip = (page - 1) * limit;
        console.log("📊 Pagination - skip:", skip, "limit:", limit);

        // Get the data with pagination
        const data = await queryBuilder
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
      
      if (group_code) {
        whereConditions.groupCode = group_code;
      }
      
      if (category_abc) {
        whereConditions.categoryAbc = category_abc;
      }
      
      return await repository.find({ where: whereConditions });
    }
  }
