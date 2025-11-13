import { Repository, SelectQueryBuilder } from "typeorm";
import { PurchaseCloseRequest } from "../../entity/PurchaseFlow/PurchaseCloseRequest.entity";


interface Filter {
  search?: string;
  sort?: { field_name: string; desc: boolean };
}

interface PaginationOptions {
  skip?: number; // offset
  take?: number; // limit
}

export async function getClosedRequests(
  repository: Repository<PurchaseCloseRequest>,
  requestUser: { company_code: string; loginid: string },
  filter?: Filter,
  paginationOptions?: PaginationOptions
) {
  try {
    console.log("inside MyItem_ClosedRequest");

    let qb: SelectQueryBuilder<PurchaseCloseRequest> = repository.createQueryBuilder("pcr");

    qb = qb.where("pcr.company_code = :company_code", { company_code: requestUser.company_code })
           .andWhere("pcr.CREATED_BY = :created_by", { created_by: requestUser.loginid })
           .andWhere("pcr.FINAL_APPROVED = :final_approved", { final_approved: "YES" });

    
    if (filter?.search) {
      const search = `%${filter.search}%`;
      qb = qb.andWhere(
        `(pcr.DOCUMENT_NUMBER LIKE :search OR pcr.PROJECT_NAME LIKE :search OR pcr.DESCRIPTION LIKE :search)`,
        { search }
      );
    }

    console.log("inside MyItem_ClosedRequest2");

    const totalCount = await qb.getCount();
    console.log("After count query");

    
    if (filter?.sort && Object.keys(filter.sort).length > 0) {
      qb = qb.orderBy(`pcr.${filter.sort.field_name}`, filter.sort.desc ? "DESC" : "ASC");
    }

    
    if (paginationOptions?.skip !== undefined) qb = qb.skip(paginationOptions.skip);
    if (paginationOptions?.take !== undefined) qb = qb.take(paginationOptions.take);

    
    const fetchedData = await qb.getMany();

    console.log("inside MyItem_ClosedRequest4");

    return { fetchedData, totalCount };
  } catch (error) {
    console.error("❌ Error in getClosedRequests:", error);
    throw error;
  }
}
