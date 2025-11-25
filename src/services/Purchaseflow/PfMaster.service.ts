import { AppDataSource, getRepository } from "../../database/connection";
import { Divisionmaster } from "../../entity/PurchaseFlow/divisionmaster.entity";
import { CostMaster } from "../../entity/PurchaseFlow/costmaster.entity";
import { CustomerMaster } from "../../entity/PurchaseFlow/customermaster.entity";
import { DdCurrency } from "../../entity/PurchaseFlow/ddcurrency.entity";
import { EmployeeMaster } from "../../entity/PurchaseFlow/ddemployeemaster.entity";
import { DropdownProjectmaster } from "../../entity/PurchaseFlow/dropdownprojectmaster.entity";
import { ItemmasterPf } from "../../entity/PurchaseFlow/itemmaster.entity";
import { MaterialCategoryMaster } from "../../entity/PurchaseFlow/materialcategary.entity";
import { ProductMaster } from "../../entity/PurchaseFlow/prodmaster.entity";
import { VProjectMaster } from "../../entity/PurchaseFlow/projectmaster_pf_view.entity";
import { SupplierMaster } from "../../entity/PurchaseFlow/suppliermaster_pf.entity";
import { UomMaster } from "../../entity/PurchaseFlow/uommaster_pf.entity";
import { In } from "typeorm";
import { DdMaterialCategory } from "../../entity/PurchaseFlow/ddMaterialCateotry.entity";

export interface Master<T> {
  fetchedData: T[];
  totalCount: number;
}

export class PurchaseFlowMasterService {
  static async getDivisionMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<Divisionmaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(Divisionmaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }
// Get Cost Master
  static async getCostMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<CostMaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(CostMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }

  static async getMaterialCategoryMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<MaterialCategoryMaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(MaterialCategoryMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }

  static async getSupplierMaster(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<SupplierMaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(SupplierMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

  static async getCustomerMaster(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<CustomerMaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(CustomerMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

  static async getItemmaster(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<ItemmasterPf>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(ItemmasterPf).findAndCount({
      where: { company_code },
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
 
  static async getddcurrency(
    company_code: string, 
    page = 1, 
    limit = 4000
   ): Promise<Master<DdCurrency>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(DdCurrency).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

  static async ddMaterialCateotry(
    company_code: string, 
    page = 1, 
    limit = 4000
  ): Promise<Master<DdMaterialCategory>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(DdMaterialCategory).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

  static async getDdDivision(
        company_code: string,
        page = 1,
        limit = 4000
    ):Promise<Master<Divisionmaster>> {
        const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(Divisionmaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });           

    return { fetchedData, totalCount };
  }

  static async getDdCostMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<CostMaster>> {
    const skip = (page - 1) * limit;

    const [fetchedData, totalCount] = await getRepository(CostMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }

  static async getDdEmployeeMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<EmployeeMaster>> {
   
    const skip = (page - 1) * limit;

   
    const [fetchedData, totalCount] = await getRepository(EmployeeMaster).findAndCount({
      where: { company_code }, 
      skip,                    
      take: limit,             
    });


    return { fetchedData, totalCount };
  }

  static async getDdProductmaster(
    company_code: string,
    code?: string, 
    page = 1,
    limit = 4000
  ): Promise<Master<ProductMaster>> {
    const skip = (page - 1) * limit;
    const repository = getRepository(ProductMaster);

    let query = repository.createQueryBuilder("prod")
      .where("prod.company_code = :company_code", { company_code });

    if (code) {
      query = query.andWhere(
        `prod.prin_code IN (
          SELECT prin_code 
          FROM MS_PRINCIPAL 
          WHERE PRIN_DEPT_CODE = :code
        )`,
        { code }
      );
    }
    const [fetchedData, totalCount] = await query.skip(skip).take(limit).getManyAndCount();

    return { fetchedData, totalCount };
  }

  static async getDdSupplierMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<SupplierMaster>> {
    const skip = (page - 1) * limit;

    const [fetchedData, totalCount] = await getRepository(SupplierMaster).findAndCount({
      where: { company_code }, 
      skip,                    
      take: limit,             
    });

    return { fetchedData, totalCount };
  }

  static async getDdUomMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<UomMaster>> {
    const skip = (page - 1) * limit;

    const [fetchedData, totalCount] = await getRepository(UomMaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }

  static async getDropdownProjectMaster(
    company_code: string,
    page = 1,
    limit = 4000
  ): Promise<Master<DropdownProjectmaster>> {
    const skip = (page - 1) * limit;

    const [fetchedData, totalCount] = await getRepository(DropdownProjectmaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
      select: [
       
        "project_code",
        "project_name",
      ],
    });

    return { fetchedData, totalCount };
  }



//-------------------------delete Master ---------------------

static async deleteMasterRecords(
  master: string,
  company_code: string,
  ids: (string | number)[]
): Promise<boolean> {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    let result: any;

    switch (master) {
      case "cost_master":
        result = await queryRunner.manager.delete(CostMaster, {
          company_code,
          cost_code: In(ids as string[]),
        });
        break;

      case "project_master":
        result = await queryRunner.manager.delete(VProjectMaster, {
          company_code,
          project_code: In(ids as string[]),
        });
        break;

      case "supplier_master":
        result = await queryRunner.manager.delete(SupplierMaster, {
          company_code,
          supp_code: In(ids as string[]),
        });
        break;

      case "customer_master":
        result = await queryRunner.manager.delete(CustomerMaster, {
          company_code,
          cust_code: In(ids as string[]),
        });
        break;

      default:
        throw new Error(`Unknown master type: ${master}`);
    }

    await queryRunner.commitTransaction();

    return result?.affected && result.affected > 0;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
}
