import { Repository, ILike } from "typeorm";
import { PRRejected } from "../../models/Purchaseflow/purchaserequest_pf.model";


export interface Master<T> {
  fetchedData: T[];
  totalCount: number;
}

export class PRRejectedService {
  constructor(private prRejectedRepo: Repository<PRRejected>) {}

  /**
   * Get rejected requests with optional search, sorting, and pagination
   */
  async getRequestRejectedData(
    company_code: string,
    filter?: any,
    page = 1,
    limit = 20
  ): Promise<Master<PRRejected>> {
    const skip = (page - 1) * limit;

    // Base query: filter by company_code
    let where: any = { company_code };

    // Apply search filters dynamically
    if (filter?.search) {
      // Example: assume filter.search is an object with key/value pairs to filter
      for (const [key, value] of Object.entries(filter.search)) {
        // Use ILike for case-insensitive partial match (Postgres style)
        // For Oracle, replace ILike with simple LIKE
        where[key] = `%${value}%`;
      }
    }

    // Total count
    const totalCount = await this.prRejectedRepo.count({ where });

    // Sorting
    let order: any = {};
    if (filter?.sort && filter.sort.field_name) {
      order[filter.sort.field_name] = filter.sort.desc ? "DESC" : "ASC";
    }

    // Fetch data
    const fetchedData = await this.prRejectedRepo.find({
      where,
      order,
      skip,
      take: limit,
    });

    return { fetchedData, totalCount };
  }
}
