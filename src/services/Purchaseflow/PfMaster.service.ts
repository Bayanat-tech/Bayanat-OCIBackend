import { AppDataSource, getRepository } from "../../database/connection";
import { Divisionmaster } from "../../entity/Purchaseflow/Pf_divisionmaster.entity";
import { CostMaster } from "../../entity/Purchaseflow/costmaster.entity";
import { CustomerMaster } from "../../entity/Purchaseflow/customermaster.entity";
import { DdCurrency } from "../../entity/Purchaseflow/ddcurrency_pf_models.entity";

import Itemmaster_pf from "../../models/Purchaseflow/itemmaster_pf_model";
import MaterialCategoryMaster from "../../models/Purchaseflow/materialcategory_pf.model";
import Suppliermaster from "../../models/Purchaseflow/suppliermaster_pf.model";

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
//
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
  ): Promise<Master<Suppliermaster>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(Suppliermaster).findAndCount({
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
  ): Promise<Master<Itemmaster_pf>> {
    const skip = (page - 1) * limit;
    const [fetchedData, totalCount] = await getRepository(Itemmaster_pf).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });
    return { fetchedData, totalCount };
  }

}


