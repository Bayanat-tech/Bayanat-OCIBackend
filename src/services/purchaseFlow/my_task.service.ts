// import { AppDataSource } from "../data-source"; // your TypeORM DataSource
// import { PurchaseRequestHeader } from "../entities/PurchaseRequestHeader";
import { ILike } from "typeorm"; // for case-insensitive LIKE
import { PurchaseRequestHeader } from "../../entity/PurchaseFlow/PurchaseRequestHeader.entity";
import { AppDataSource } from "../../database/connection";
import { getSearchFilterQuery } from "../../helpers/functions";


export class myTask {
static getMyTaskData(company_code: string, page: number, limit: number): { fetchedData: any[]; totalCount: number; } | PromiseLike<{ fetchedData: any[]; totalCount: number; }> {
  throw new Error("Method not implemented.");
}
getMyTaskData = async (
  requestUser: any,
  filter: any,
  paginationOptions: { skip?: number; take?: number } = {}
) => {
  try {
    console.log("🔹 Inside MyTask Service");

     const query = `
        BEGIN
          PRO_CREATEORINERTGTMYTASK(
            gs_company_code => :1,
            gs_user_id      => :2
          );
        END;
      `;
      const entityManager = AppDataSource.manager;
      const binds = [requestUser.company_code, requestUser.user_id];
      const result: any[] = await entityManager.query(query, binds);

     

    const purchaseRequestRepo = AppDataSource.getRepository(PurchaseRequestHeader);

   
    let where: any = {
      company_code: requestUser.company_code,
    };

    
    if (filter?.search) {
    
      const searchFilter = getSearchFilterQuery(filter.search, [
        "request_number",
        "description",
        "project_name",
        "created_by",
      ]);

   
      where = { ...where, ...searchFilter };
    }

    console.log("✅ Final where condition:", where);

   
    const totalCount = await purchaseRequestRepo.count({
      where,
    });

    console.log("📊 Total Count:", totalCount);

   
    let order: any = {};
    if (filter?.sort && filter.sort.field_name) {
      order[filter.sort.field_name] = filter.sort.desc ? "DESC" : "ASC";
    }

  
    const fetchedData = await purchaseRequestRepo.find({
      where,
      order,
      skip: paginationOptions.skip || 0,
      take: paginationOptions.take || 20,
    });

    return {
      success: true,
      tableData: fetchedData,
      totalCount,
    };
  } catch (error: any) {
    console.error("❌ Error in getMyTaskData:", error);
    return {
      success: false,
      message: "Internal server error",
      error: error.message,
    };
  }
}};
