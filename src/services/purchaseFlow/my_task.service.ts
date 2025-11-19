import { ILike } from "typeorm";
import { PurchaseRequestHeader } from "../../entity/PurchaseFlow/PurchaseRequestHeader.entity";
import { AppDataSource } from "../../database/connection";
import { getSearchFilterQuery } from "../../helpers/functions";

export class MyTaskService {

  /**
   * OLD method signature (static) — Now properly implemented.
   */
  static async getMyTaskData(
    requestUser: any,
    filter: any,
    page: number = 1,
    limit: number = 20
  ): Promise<{ success: boolean; tableData: any[]; totalCount: number; message?: string }> {

    try {
      console.log("🔹 Inside MyTask Service");

      // ---------------------------------------------
      // CALL STORED PROCEDURE PRO_CREATEORINERTGTMYTASK
      // ---------------------------------------------
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

      console.log("📨 Running MyTask Stored Procedure...");
      await entityManager.query(query, binds);

      // ---------------------------------------------
      // FETCH PURCHASE REQUEST HEADER DATA
      // ---------------------------------------------
      const purchaseRequestRepo = AppDataSource.getRepository(PurchaseRequestHeader);

      let where: any = {
        company_code: requestUser.company_code,
      };

      // 🔍 SEARCH FILTER
      if (filter?.search) {
        const searchFilter = getSearchFilterQuery(filter.search, [
          "request_number",
          "description",
          "project_name",
          "created_by",
        ]);
        where = { ...where, ...searchFilter };
      }

      console.log("✅ Final WHERE:", where);

      // COUNT
      const totalCount = await purchaseRequestRepo.count({
        where,
      });

      console.log("📊 Total Count:", totalCount);

      // SORTING
      let order: any = {};
      if (filter?.sort && filter.sort.field_name) {
        order[filter.sort.field_name] = filter.sort.desc ? "DESC" : "ASC";
      }

      // PAGINATION CALC
      const skip = (page - 1) * limit;

      // FINAL DATA
      const fetchedData = await purchaseRequestRepo.find({
        where,
        order,
        skip,
        take: limit,
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
        tableData: [],
        totalCount: 0,
        message: error.message,
      };
    }
  }
}
