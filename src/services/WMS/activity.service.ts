import { getRepository } from "../../database/connection";
import { ensureCorrectSchema } from "../../database/TypeORMTenantInterceptor";
import { Activity } from "../../entity/WMS/activity.entity";
 
export class ActivityService {
  static async getActivities(
    filters: any,
    take = 1000,
    skip = 0,
  ) {
    try {
      // Ensure correct tenant schema before executing TypeORM queries
      await ensureCorrectSchema();

      const repository = getRepository(Activity);
 
      const where: any = {
      company_code: filters.company_code,
    };
      const [data, total] = await repository.findAndCount({
        select: {
          activityCode: true,
          activity: true,
          activityGroupCode: true,
        },
        where: filters,
        take,
        skip,
        order: {
          activityCode: "ASC",
        },
      });
 
      return { data, total };
    } catch (error) {
      console.error("Error fetching activities:", error);
      throw error;
    }
  }
 
 
//   create Activity
   static async createActivity(data: any) {
    try {
      // Ensure correct tenant schema before executing TypeORM queries
      await ensureCorrectSchema();

      const repository = getRepository(Activity);
 
      // Check if activity already exists
      const existing = await repository.findOne({
        where: {
          activityCode: data.activityCode,
          companyCode: data.companyCode,
        },
      });
 
      if (existing) {
        return {
          alreadyExists: true,
          message: "Activity already exists",
          data: existing,
        };
      }
 
      // Create new activity
      const entity = repository.create(data);
      const saved = await repository.save(entity);
 
      return {
        alreadyExists: false,
        message: "Activity created successfully",
        data: saved,
      };
    } catch (error) {
      console.error("Error creating activity:", error);
      throw error;
    }
  }
}
 