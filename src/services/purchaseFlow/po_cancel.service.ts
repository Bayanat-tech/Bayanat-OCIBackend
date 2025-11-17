import { getRepository } from "../../database/connection";
import { POCancel } from "../../entity/PurchaseFlow/poCancel.entity";


export interface Master<T> {
  fetchedData: T[];
  totalCount: number;
}

export interface FilterOptions {
  search?: Record<string, any>;
  sort?: {
    field_name: string;
    desc: boolean;
  };
}

export class POCancelService {
  static async getPOCancelData(
    company_code: string,
    filter?: FilterOptions,
    page = 1,
    limit = 4000
  ): Promise<Master<POCancel>> {
    const repo = getRepository(POCancel);
    const skip = (page - 1) * limit;

    const query = repo
      .createQueryBuilder("po_cancel")
      .where("po_cancel.COMPANY_CODE = :company_code", { company_code });

    
    if (filter?.search) {
      for (const [key, value] of Object.entries(filter.search)) {
        if (value && value.trim() !== "") {
          query.andWhere(`po_cancel.${key} LIKE :${key}`, {
            [key]: `%${value}%`,
          });
        }
      }
    }

    if (filter?.sort && filter.sort.field_name) {
      query.orderBy(
        `po_cancel.${filter.sort.field_name}`,
        filter.sort.desc ? "DESC" : "ASC"
      );
    }

  
    query.skip(skip).take(limit);

 
    const [fetchedData, totalCount] = await query.getManyAndCount();

    return { fetchedData, totalCount };
  }
}
