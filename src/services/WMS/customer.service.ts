import { Like, Repository } from "typeorm";
import { CustomerMaster } from "../../entity/WMS/Customer.entity";
import { getRepository } from "../../database/connection";
import { ensureCorrectSchema } from "../../database/TypeORMTenantInterceptor";

// export class CustomerService {

 export class CustomerService {
  private static getRepository(): Repository<CustomerMaster> {
    return getRepository(CustomerMaster);
  }

 //Get Customers Master
  static async getCustomers(
    filters: any,
    page: number,
    limit: number
  ) {
    // Ensure correct tenant schema before executing TypeORM queries
    await ensureCorrectSchema();

    const repository: Repository<CustomerMaster> =
      getRepository(CustomerMaster);

    const where: any = {
      company_code: filters.company_code,
    };

    const [data, total] = await repository.findAndCount({
      where,
      order: {
        cust_name: "ASC",
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }
    
 // CREATE CUSTOMER 

  static async createCustomer(data: any) {
    // Ensure correct tenant schema before executing TypeORM queries
    await ensureCorrectSchema();

    const repo = this.getRepository();

    const exists = await repo.findOne({
      where: {
        company_code: data.company_code,
        cust_name: data.cust_name,
        prin_code: data.prin_code
      }
    });

    if (exists) {
      return {
        success: false,
        message: 'Customer Name Already Exists'
      };
    }

    const customer = repo.create({
      ...data,
    });

    const saved = await repo.save(customer);

    return {
      success: true,
      message: 'Customer details added successfully',
      data: saved
    };
  }

  // UPDATE CUSTOMER 
  static async updateCustomer(
    company_code: string,
    cust_code: string,
    prin_code: string,
    updateData: any
  ) {
    // Ensure correct tenant schema before executing TypeORM queries
    await ensureCorrectSchema();

    const repo = this.getRepository();

    const existing = await repo.findOne({
      where: { company_code, cust_code,prin_code }
    });

    if (!existing) {
      return {
        success: false,
        message: 'Customer Code Does Not Exist'
      };
    }

    await repo.update(
      { company_code, cust_code,prin_code },
      {
        ...updateData,
      }
    );

    return {
      success: true,
      message: 'Customer updated successfully'
    };
  }
}


