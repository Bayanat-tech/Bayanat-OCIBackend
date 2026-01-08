import { AppDataSource } from "../../database/connection";
import { BillingActivity } from "../../entity/WMS/billing_activity.entity";

export class ActivityService {
  static async getBillingActivity(company_code: string, prin_code: string) {
    try {
      const repository = AppDataSource.getRepository(BillingActivity);
      let query = `
        SELECT 
          "BillingActivity"."PRIN_CODE"       AS "PRIN_CODE",
          "BillingActivity"."ACT_CODE"        AS "ACT_CODE",
          "BillingActivity"."WIP_CODE"        AS "WIP_CODE",
          "BillingActivity"."JOBTYPE"         AS "JOBTYPE",
          "BillingActivity"."COST"            AS "COST",
          "BillingActivity"."COMPANY_CODE"    AS "COMPANY_CODE",
          "BillingActivity"."BILL_AMOUNT"     AS "BILL_AMOUNT",
          "BillingActivity"."USER_DT"         AS "USER_DT",
          "BillingActivity"."INCOME_CODE"     AS "INCOME_CODE",
          "BillingActivity"."UOC"             AS "UOC",
          "BillingActivity"."MOC"             AS "MOC",
          "BillingActivity"."MOC1"            AS "MOC1",
          "BillingActivity"."MOC2"            AS "MOC2",
          "BillingActivity"."CUST_CODE"       AS "CUST_CODE",
          "BillingActivity"."FREEZE_FLAG"     AS "FREEZE_FLAG",
          "BillingActivity"."MANDATORY_FLAG"  AS "MANDATORY_FLAG",
          "BillingActivity"."UPDATED_BY"      AS "UPDATED_BY",
          "BillingActivity"."UPDATED_AT"      AS "UPDATED_AT",
          "MS_ACTIVITY"."ACTIVITY"            AS "ACTIVITY"
        FROM 
          "MS_ACTIVITY_BILLING" "BillingActivity"
        JOIN 
          "MS_ACTIVITY"
        ON 
          "BillingActivity"."ACT_CODE" = "MS_ACTIVITY"."ACTIVITY_CODE"
        WHERE 
          "BillingActivity"."COMPANY_CODE" = :company_code
          AND "BillingActivity"."PRIN_CODE" = :prin_code
      `;
      console.log("req param", {company_code,prin_code});
      console.log("Executing query:", query);

      // return await repository.query(query);
      return await (repository.query as any)(query, [ company_code, prin_code ]);
    } catch (error) {
      console.error("Error fetching billing activity:", error);
      throw error;
    }
  }
}