import { TenantManager } from "./TenantManager";
import { getCurrentTenantContext, getCurrentLoginid, getCurrentTenantId } from "../middleware/tenantContext.middleware";

export class QueryExecutor {

  static async executeQuery(
    query: string,
    params: any = {},
    loginid?: string,
    tenantId?: string
  ): Promise<any[]> {
    // Try to get from context first
    const contextLoginid = loginid || getCurrentLoginid();
    const contextTenantId = tenantId || getCurrentTenantId();

    if (!contextLoginid || !contextTenantId) {
      console.warn(`[QueryExecutor.executeQuery] No loginid/tenantId provided and no context available`);
      return [];
    }

    console.log(`[QueryExecutor.executeQuery] Executing query for loginid=${contextLoginid}, tenant=${contextTenantId}`);
    return await TenantManager.executeInTenant(contextTenantId, query, params);
  }
  
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

  // Get user with tenant info (for login)
  static async getUserWithTenant(email: string): Promise<{
    user: any;
    tenantId: string;
    tenantConfig: any;
  } | null> {
    // Use central connection to get user from SEC_LOGIN
    const { oracleDb } = require("./connection");
    
    console.log(`[QueryExecutor.getUserWithTenant] STEP 1: Getting user for email: ${email}...`);
    const userResult = await oracleDb.query(
      `SELECT * FROM SEC_LOGINTEST
       WHERE (EMAIL_ID = :email OR LOGINID = :email) 
         AND ACTIVE_FLAG = 'Y'`,
      { email }
    );

    if (!userResult.rows || userResult.rows.length === 0) {
      console.log(`[QueryExecutor.getUserWithTenant] ❌ User not found: ${email}`);
      return null;
    }

    const user = userResult.rows[0];
    console.log(`[QueryExecutor.getUserWithTenant] ✅ User found: ${user.LOGINID}`);

    console.log(`[QueryExecutor.getUserWithTenant] STEP 2: Getting tenant for user...`);
    const tenantId = await TenantManager.getTenantForUser(user.LOGINID);
    
    console.log(`[QueryExecutor.getUserWithTenant] STEP 3: Getting tenant config...`);
    const tenantConfig = await TenantManager.getTenantConfig(tenantId);
    
    console.log(`[QueryExecutor.getUserWithTenant] ✅ SUCCESS: User=${user.LOGINID}, Tenant=${tenantId}`);
    
    return { user, tenantId, tenantConfig };
  }
}

