import { ActivityUOC } from "../../entity/WMS/moc2.entity";
import { 
  getCurrentTenantId, 
  normalizeOracleResult, 
  executeQuery, 
  executeSingleQuery,
  executeMutation,
  executeCount
} from "./tenant-service.helper";

export class ActivityUOCService {
  static async findByDescriptionAndCompany(
    description: string,
    company_code: string
  ): Promise<ActivityUOC | null> {
    const sql = `SELECT * FROM MS_ACTIVITY_UOC WHERE description = :description AND company_code = :company_code`;
    return await executeSingleQuery<ActivityUOC>(sql, { description, company_code });
  }

  static async findByCompositeKey(
    company_code: string,
    charge_code: string,
    charge_type: string,
    activity_group_code: string
  ): Promise<ActivityUOC | null> {
    const sql = `SELECT * FROM MS_ACTIVITY_UOC WHERE company_code = :company_code AND charge_code = :charge_code AND charge_type = :charge_type AND activity_group_code = :activity_group_code`;
    return await executeSingleQuery<ActivityUOC>(sql, { company_code, charge_code, charge_type, activity_group_code });
  }

  static async createActivityUOC(activityData: {
    company_code: string;
    charge_code: string;
    charge_type: string;
    activity_group_code: string;
    description?: string;
    created_by?: string;
    updated_by?: string;
  }): Promise<ActivityUOC> {
    const cols = Object.keys(activityData);
    cols.push('created_at', 'updated_at');
    
    const values = cols.map((_, i) => `:val${i}`).join(", ");
    const sql = `INSERT INTO MS_ACTIVITY_UOC (${cols.join(", ")}) VALUES (${values})`;
    
    const bindObj: Record<string, any> = {};
    let idx = 0;
    for (const col of Object.keys(activityData)) {
      bindObj[`val${idx++}`] = (activityData as any)[col];
    }
    bindObj[`val${idx++}`] = new Date();
    bindObj[`val${idx++}`] = new Date();
    
    await executeMutation(sql, bindObj);
    
    // Fetch the created record
    return await this.findByCompositeKey(
      activityData.company_code,
      activityData.charge_code,
      activityData.charge_type,
      activityData.activity_group_code
    ) as ActivityUOC;
  }

  static async updateActivityUOC(
    company_code: string,
    charge_code: string,
    charge_type: string,
    activity_group_code: string,
    updateData: Partial<ActivityUOC>
  ): Promise<{
    success: boolean;
    old_description: string | null;
    old_activity_group_code: string | null;
    updated_description: string | null;
    updated_activity_group_code: string | null;
  }> {
    // Fetch existing record
    const existing = await this.findByCompositeKey(company_code, charge_code, charge_type, activity_group_code);

    const result = {
      success: false,
      old_description: null,
      old_activity_group_code: null,
      updated_description: null,
      updated_activity_group_code: null,
    };

    if (!existing) {
      if ((updateData as any).description !== undefined) result.updated_description = (updateData as any).description;
      if ((updateData as any).activity_group_code !== undefined) result.updated_activity_group_code = (updateData as any).activity_group_code;
      return result;
    }

    result.old_description = (existing as any).description ?? null;
    result.old_activity_group_code = (existing as any).activity_group_code ?? null;

    if ((updateData as any).description !== undefined) {
      result.updated_description = (updateData as any).description ?? null;
    }
    if ((updateData as any).activity_group_code !== undefined) {
      result.updated_activity_group_code = (updateData as any).activity_group_code ?? null;
    }

    // Apply update
    const cols = Object.keys(updateData);
    const setClause = cols.map((col, i) => `${col} = :val${i}`).join(", ");
    const sql = `UPDATE MS_ACTIVITY_UOC SET ${setClause}, updated_at = :updated_at WHERE company_code = :company_code AND charge_code = :charge_code AND charge_type = :charge_type AND activity_group_code = :activity_group_code`;
    
    const bindObj: Record<string, any> = { company_code, charge_code, charge_type, activity_group_code, updated_at: new Date() };
    cols.forEach((col, i) => {
      bindObj[`val${i}`] = (updateData as any)[col];
    });

    try {
      await executeMutation(sql, bindObj);
      result.success = true;
    } catch (error) {
      console.error("Error updating ActivityUOC:", error);
      result.success = false;
    }
    
    return result;
  }

  static async deleteActivityUOCs(
    conditions: Array<{
      company_code: string;
      charge_code: string;
      charge_type: string;
    }>
  ): Promise<boolean> {
    if (conditions.length === 0) {
      return false;
    }

    let totalDeleted = 0;
    
    for (const condition of conditions) {
      const sql = `DELETE FROM MS_ACTIVITY_UOC WHERE company_code = :company_code AND charge_code = :charge_code AND charge_type = :charge_type`;
      try {
        await executeMutation(sql, condition);
        totalDeleted++;
      } catch (error) {
        console.error("Error deleting ActivityUOC:", error);
      }
    }

    return totalDeleted > 0;
  }

  static async checkActivityUOCExists(
    company_code: string,
    charge_code: string,
    charge_type: string,
    activity_group_code: string
  ): Promise<boolean> {
    const sql = `SELECT COUNT(*) as cnt FROM MS_ACTIVITY_UOC WHERE company_code = :company_code AND charge_code = :charge_code AND charge_type = :charge_type AND activity_group_code = :activity_group_code`;
    const count = await executeCount(sql, { company_code, charge_code, charge_type, activity_group_code });
    return count > 0;
  }

  static async getActivityUOCs(
    filters: any,
    page: number,
    limit: number
  ): Promise<{ data: ActivityUOC[]; total: number }> {
    const bindParams: Record<string, any> = {};
    let sql = `SELECT * FROM MS_ACTIVITY_UOC WHERE 1=1`;

    // Build filter conditions
    if (filters.company_code) {
      sql += ` AND company_code = :company_code`;
      bindParams.company_code = filters.company_code;
    }
    if (filters.charge_code) {
      sql += ` AND charge_code = :charge_code`;
      bindParams.charge_code = filters.charge_code;
    }
    if (filters.charge_type) {
      sql += ` AND charge_type = :charge_type`;
      bindParams.charge_type = filters.charge_type;
    }
    if (filters.activity_group_code) {
      sql += ` AND activity_group_code = :activity_group_code`;
      bindParams.activity_group_code = filters.activity_group_code;
    }

    // Get total count
    const countSql = sql.replace(/SELECT \*/, `SELECT COUNT(*) as cnt`);
    const total = await executeCount(countSql, bindParams);

    // Apply sorting and pagination
    sql += ` ORDER BY company_code ASC, charge_code ASC, charge_type ASC, activity_group_code ASC`;
    sql += ` OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
    bindParams.offset = (page - 1) * limit;
    bindParams.limit = limit;

    const data = await executeQuery<ActivityUOC>(sql, bindParams);
    return { data, total };
  }
}
 