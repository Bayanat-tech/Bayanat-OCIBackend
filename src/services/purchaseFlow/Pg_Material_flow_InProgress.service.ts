import { Repository, DataSource, Brackets } from "typeorm";


import { MaterialRequestHeader } from "../../entity/PurchaseFlow/MaterialRequestHeader.entity";
import { PurchaseRequestHeader_htry } from "../../entity/PurchaseFlow/PurchaseRequestHeader_htry.entity";

interface PaginationOptions {
  page?: number;
  limit?: number;
}

export class MaterialRequestService {
  private materialRepo: Repository<MaterialRequestHeader>;
  private historyRepo: Repository<PurchaseRequestHeader_htry>;

  constructor(private dataSource: DataSource) {
    this.materialRepo = this.dataSource.getRepository(MaterialRequestHeader);
    this.historyRepo = this.dataSource.getRepository(PurchaseRequestHeader_htry);
  }

  async getInProgressRequests(
    company_code: string,
    loginid: string,
    paginationOptions?: PaginationOptions
  ) {
    const page = paginationOptions?.page ?? 1;
    const limit = paginationOptions?.limit ?? 10;
    const offset = (page - 1) * limit;

    // TypeORM QueryBuilder
    const qb = this.materialRepo.createQueryBuilder("mrh")
      .where("mrh.company_code = :company_code", { company_code })
      .andWhere("mrh.final_approved IS NULL")
      .andWhere(
        new Brackets(qb => {
          qb.where("mrh.created_by = :loginid", { loginid })
            .orWhere((qb2: { subQuery: () => { (): any; new(): any; select: { (arg0: string): { (): any; new(): any; from: { (arg0: typeof PurchaseRequestHeader_htry, arg1: string): { (): any; new(): any; where: { (arg0: string, arg1: { loginid: string; }): { (): any; new(): any; getQuery: { (): any; new(): any; }; }; new(): any; }; }; new(): any; }; }; new(): any; }; }; }) => {
              const subQuery = qb2.subQuery()
                .select("DISTINCT h.request_number")
                .from(PurchaseRequestHeader_htry, "h")
                .where("h.updated_by = :loginid", { loginid })
                .getQuery();
              return "mrh.request_number IN " + subQuery;
            });
        })
      )
      .orderBy("mrh.request_number", "ASC")
      .skip(offset)
      .take(limit);

    // Fetch total count
    const totalCount = await qb.getCount();

    // Fetch data
    const tableData = await qb.getMany();

    return {
      success: true,
      data: {
        tableData,
        count: totalCount,
      },
    };
  }
}
