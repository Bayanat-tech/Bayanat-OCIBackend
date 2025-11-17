import { getRepository } from "../../database/connection";
import { PoNotGenerated } from "../../entity/PurchaseFlow/Ponotgenerated.entity";


export interface Master<T> {
  fetchedData: T[];
  totalCount: number;
}

export interface FilterOptions {
  search?: Record<string, any>;
  sort?: { field_name: string; desc?: boolean };
}

export class PoNotGeneratedService {
  static async getPoNotGenerated(
    company_code: string,
    page = 1,
    limit = 4000,
    filter?: FilterOptions
  ): Promise<Master<PoNotGenerated>> {
    const skip = (page - 1) * limit;

    let whereQuery: any = { company_code };

    
    if (filter?.search) {
      whereQuery = { ...whereQuery, ...filter.search };
    }

    const repository = getRepository(PoNotGenerated);

    const totalCount = await repository.count({ where: whereQuery });

    let order: any = undefined;
    if (filter?.sort && filter.sort.field_name) {
      order = { [filter.sort.field_name]: filter.sort.desc ? "DESC" : "ASC" };
    }

  
    const fetchedData = await repository.find({
      where: whereQuery,
      skip,
      take: limit,
      order,
    });

    return { fetchedData, totalCount };
  }
}
