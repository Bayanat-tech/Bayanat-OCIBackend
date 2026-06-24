import bcrypt from "bcrypt";
import { getRepository } from "../database/connection";
import { User } from "../entity/User";
import { QueryExecutor } from "../database/QueryExecutor";
import { oracleDb } from "../database/connection";

export class AuthService {
  private static getUserRepository() {
    return getRepository(User);
  }

  static async findUserByEmailOrLoginId(
    email: string
  ): Promise<{
    user: any;
    tenantId: string;
  } | null> {
    try {
      console.log(`[AuthService.findUserByEmailOrLoginId] STEP 1: Finding user...`);
      const result = await QueryExecutor.getUserWithTenant(email);
      
      if (!result) {
        console.log(`[AuthService.findUserByEmailOrLoginId] ❌ User not found`);
        return null;
      }

      console.log(`[AuthService.findUserByEmailOrLoginId] ✅ User found: ${result.user.LOGINID}, Tenant: ${result.tenantId}`);
      
      return {
        user: result.user,
        tenantId: result.tenantId
      };
    } catch (error) {
      console.error(`[AuthService.findUserByEmailOrLoginId] Error:`, error);
      return null;
    }
  }

  // Get user with tenant info
  static async getUserWithTenant(email: string): Promise<{
    user: any;
    tenantId: string;
  } | null> {
    return this.findUserByEmailOrLoginId(email);
  }

  // Execute query in user's tenant (uses centralized QueryExecutor)
  static async executeInUserTenant(
    loginid: string,
    query: string,
    parameters: any = {}
  ): Promise<any[]> {
    return await QueryExecutor.executeForUser(loginid, query, parameters);
  }

  // Compare passwords
  static async comparePassword(
    password: string,
    hashedPassword: string
  ): Promise<boolean> {
    return await bcrypt.compare(password, hashedPassword);
  }

  // Hash password
  static async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, 10);
  }

  // Update user password (in central SEC_LOGIN)
  static async updateUserPassword(
    email: string,
    hashedPassword: string
  ): Promise<boolean> {
    try {
      await oracleDb.query(
        `UPDATE SEC_LOGINTEST
         SET USERPASS = :hashedPassword,
             SEC_PASSWD = :hashedPassword,
             UPDATED_BY = 'system'
         WHERE EMAIL_ID = :email`,
        { hashedPassword, email }
      );
      return true;
    } catch (error) {
      console.error("Error updating password:", error);
      throw error;
    }
  }

  // Create external user
  static async createUserFromExternal(
    apiUser: any,
    password: string,
    hashedPassword: string
  ): Promise<any> {
    try {
      console.log(`[AuthService.createUserFromExternal] Creating user: ${apiUser.USER_ID}...`);
      
      // Insert into central SEC_LOGIN table
      await oracleDb.query(
        `INSERT INTO SEC_LOGINTEST 
         (LOGINID, USERNAME, EMAIL_ID, USERPASS, SEC_PASSWD, COMPANY_CODE, ACTIVE_FLAG, CREATED_AT, CREATED_DATE)
         VALUES (:loginid, :username, :email, :hashedPassword, :hashedPassword, :companyCode, 'Y', 'system', SYSDATE)`,
        {
          loginid: apiUser.USER_ID,
          username: apiUser.NAME,
          email: apiUser.EMAIL || `${apiUser.USER_ID}@external.com`,
          hashedPassword: hashedPassword,
          companyCode: apiUser.COMPANY_CODE || 'BSG'
        }
      );

      console.log("✅ External user created in SEC_LOGIN:", apiUser.USER_ID);

      return {
        LOGINID: apiUser.USER_ID,
        USERNAME: apiUser.NAME,
        EMAIL_ID: apiUser.EMAIL || `${apiUser.USER_ID}@external.com`,
        COMPANY_CODE: apiUser.COMPANY_CODE || 'BSG',
        ACTIVE_FLAG: 'Y'
      };
    } catch (error) {
      console.error("Error creating external user:", error);
      throw error;
    }
  }
}
