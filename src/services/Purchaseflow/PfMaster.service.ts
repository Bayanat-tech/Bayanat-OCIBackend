import { getRepository } from "../../database/connection";
import { Divisionmaster } from "../../entity/Purchaseflow/Pf_divisionmaster.entity";

export class PurchaseFlowMasterService {
  static async getDivisionMaster(
    company_code: string,
    page: number = 1,
    limit: number = 4000
  ) {
    const skip = (page - 1) * limit;

    // Fetch data and total count 
    const [fetchedData, totalCount] = await getRepository(Divisionmaster).findAndCount({
      where: { company_code },
      skip,
      take: limit,
    });

    return { 
        fetchedData, 
        totalCount 
    };
  }
}
