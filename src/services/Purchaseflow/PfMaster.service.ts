import { getRepository } from "../../database/connection";
import { CostMaster } from "../../entity/PurchaseFlow/costmaster.entity";
import { CustomerMaster } from "../../entity/PurchaseFlow/customermaster.entity";
import { DdCurrency } from "../../entity/PurchaseFlow/ddcurrency_pf_models.entity";
import { ItemmasterPf } from "../../entity/PurchaseFlow/itemmaster.entity";
import { MaterialCategoryMaster } from "../../entity/PurchaseFlow/materialcategary.entity";
import { SupplierMaster } from "../../entity/PurchaseFlow/suppliermaster_pf.entity";
import { Divisionmaster } from "../../entity/PurchaseFlow/divisionmaster.entity";

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

    try {
      const totalCount = await getRepository(CostMaster).count({
        where: { company_code },
      });

      const fetchedData = await getRepository(CostMaster).find({
        where: { company_code }
      });

      return { fetchedData, totalCount };
    } catch (error: any) {
      console.error("Error fetching CostMaster data:", error.message);
      throw new Error("Failed to fetch CostMaster data. Please check the database configuration.");
    }
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
  ): Promise<Master<DdCurrency>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(DdCurrency).findAndCount({
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

}