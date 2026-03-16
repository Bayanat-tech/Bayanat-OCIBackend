import { getRepository } from "../../database/connection";
import { ensureCorrectSchema } from "../../database/TypeORMTenantInterceptor";
import { BillingActivity } from "../../entity/WMS/billing_activity.entity";
import { executeRaw } from "./tenant-service.helper";
 
export class BillingActivityService {
  static async getBillingActivity(company_code: string, prin_code: string) {
    try {
      await ensureCorrectSchema();

      const repository = getRepository(BillingActivity);
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
 
  return await executeRaw(query, [company_code, prin_code]);
 
    } catch (error) {
      console.error("Error fetching billing activity:", error);
      throw error;
    }
  }
 
  //Create Billing Activity
 
  static async createBillingActivity(data: any) {
    try {
      // Ensure correct tenant schema before executing TypeORM queries
      await ensureCorrectSchema();

      const repository = getRepository(BillingActivity);
 
      // Check if record already exists
      const existingRecord = await repository.findOne({
        where: {
          company_code: data.company_code,
          prin_code: data.prin_code,
        },
      });
 
      if (existingRecord) {
        return {
          alreadyExists: true,
          message: "Billing activity already exists",
          data: existingRecord,
        };
      }
 
      // Create new record
      const billingactivity = repository.create({
        company_code: data.company_code,
        prin_code: data.prin_code,
        act_code: data.act_code,
        wip_code: data.wip_code,
        jobtype: data.jobtype,
        cost: data.cost,
        bill_amount: data.bill_amount,
        income_code: data.income_code,
        uoc: data.uoc,
        moc: data.moc,
        moc1: data.moc1,
        moc2: data.moc2,
        cust_code: data.cust_code,
        freeze_flag: data.freeze_flag,
        mandatory_flag: data.mandatory_flag,
        updated_by: data.updated_by,
        user_dt: data.user_dt,
        user_id: data.user_id,
      });
 
      const savedRecord = await repository.save(billingactivity);
 
      return {
        alreadyExists: false,
        message: "Billing activity created successfully",
        data: savedRecord,
      };
 
    } catch (error) {
      console.error("Error creating billing activity:", error);
      throw error;
    }
  }
 
  // UPDATE BILLING ACTIVITY
 
  static async updateBillingActivity(data: any) {
    try {
      // Ensure correct tenant schema before executing TypeORM queries
      await ensureCorrectSchema();

      const repository = getRepository(BillingActivity);
 
      //  Check if record exists
      const existingRecord = await repository.findOne({
        where: {
          company_code: data.company_code,
          prin_code: data.prin_code,
        },
      });
 
      if (!existingRecord) {
        return {
          notFound: true,
          message: "Billing activity not found",
        };
      }
 
      // updates
      repository.merge(existingRecord, {
        wip_code: data.wip_code,
        jobtype: data.jobtype,
        cost: data.cost,
        bill_amount: data.bill_amount,
        user_dt: data.user_dt,
        income_code: data.income_code,
        uoc: data.uoc,
        moc: data.moc,
        moc1: data.moc1,
        moc2: data.moc2,
        cust_code: data.cust_code,
        freeze_flag: data.freeze_flag,
        mandatory_flag: data.mandatory_flag,
        updated_by: data.updated_by,
        updated_at: new Date(),
      });
 
      const updatedRecord = await repository.save(existingRecord);
 
      return {
        notFound: false,
        message: "Billing activity updated successfully",
        data: updatedRecord,
      };
 
    } catch (error) {
      console.error("Error updating billing activity:", error);
      throw error;
    }
  }
 
  //delete
 
  static async deleteBillingActivity(payload: any) {
    // Ensure correct tenant schema before executing TypeORM queries
    await ensureCorrectSchema();

    const repository = getRepository(BillingActivity);
 
    const {
      prin_code,
      act_code,
      uoc,
      moc1,
      moc2,
      jobtype,
      company_code,
      updated_by,
    } = payload;
 
    // check if record exists
    const existing = await repository.findOne({
      where: {
        prin_code,
        act_code,
        uoc,
        moc1,
        moc2,
        jobtype,
        company_code,
      },
    });
 
    if (!existing) {
      return {
        notFound: true,
        message: "Billing activity not found",
      };
    }
 
    // update audit field
    await repository.update(
      {
        prin_code,
        act_code,
        uoc,
        moc1,
        moc2,
        jobtype,
        company_code,
      },
      {
        updated_by,
      }
    );
 
    // delete record
    await repository.delete({
      prin_code,
      act_code,
      uoc,
      moc1,
      moc2,
      jobtype,
      company_code,
    });
 
    return {
      success: true,
      message: "Billing activity deleted successfully",
    };
  }
}