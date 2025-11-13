import { Like } from "typeorm";
import { getRepository } from "../../database/connection";
import { PurchaseRequestHeaderHistory } from "../../entity/PurchaseFlow/PurchaseRequestHeaderHistory.entity";
// import { PurchaseRequestHeaderHistory } from "../../entity/PurchaseFlow/purchaseRequestHeaderHistory.entity";

export interface Master<T> {
  fetchedData: T[];
  totalCount: number;
}

export class PurchaseRequestHistoryService {
  /**
   * Fetch paginated and filtered history data for a company
   */
  static async getMyHistory(
    company_code: string,
    filter?: { search?: Record<string, any>; sort?: { field_name: string; desc?: boolean } },
    page = 1,
    limit = 50
  ): Promise<Master<PurchaseRequestHeaderHistory>> {
    const skip = (page - 1) * limit;

    const repository = getRepository(PurchaseRequestHeaderHistory);

    // Build where query
    let where: any = { company_code };

    // Apply search filters if any
    if (filter?.search) {
      Object.entries(filter.search).forEach(([key, value]) => {
        if (value) {
          where[key] = Like(`%${value}%`); // Partial match
        }
      });
    }

    // Build order query if sorting is provided
    let order: any = {};
    if (filter?.sort && filter.sort.field_name) {
      order[filter.sort.field_name] = filter.sort.desc ? "DESC" : "ASC";
    }

    // Fetch data with pagination and sorting
    const [fetchedData, totalCount] = await repository.findAndCount({
      where,
      skip,
      take: limit,
      order: Object.keys(order).length > 0 ? order : undefined,
    });

    return { fetchedData, totalCount };
  }
}
