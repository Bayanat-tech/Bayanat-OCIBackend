import { TenantManager } from "./TenantManager";

export class QueryExecutor {
  
  // Execute query for specific tenant
  static async executeForTenant(
    tenantId: string,
    query: string,
    params: any = {}
  ): Promise<any[]> {
    return await TenantManager.executeInTenant(tenantId, query, params);
  }

  // Execute query for user
  static async executeForUser(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<any[]> {
    return await TenantManager.executeForUser(loginid, query, params);
  }

  // Get user with tenant info
  static async getUserWithTenant(email: string): Promise<{
    user: any;
    tenantId: string;
    tenantConfig: any;
  } | null> {
    // Use central connection to get user from SEC_LOGIN
    const { oracleDb } = require("./connection");
    
    const userResult = await oracleDb.query(
      `SELECT * FROM SEC_LOGIN 
       WHERE (EMAIL_ID = :email OR LOGINID = :email) 
         AND ACTIVE_FLAG = 'Y'`,
      { email }
    );

    if (!userResult.rows || userResult.rows.length === 0) {
      return null;
    }

    const user = userResult.rows[0];
    const tenantId = await TenantManager.getTenantForUser(user.LOGINID);
    const tenantConfig = await TenantManager.getTenantConfig(tenantId);
    
    return { user, tenantId, tenantConfig };
  }
}
