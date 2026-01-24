import bcrypt from "bcrypt";
import { getRepository } from "../database/connection";
import { User } from "../entity/User";
import { QueryExecutor } from "../database/QueryExecutor";
import { oracleDb } from "../database/connection";

export class AuthService {
  private static getUserRepository() {
    return getRepository(User);
  }

  // Find user by email or loginid (from central SEC_LOGIN)
  static async findUserByEmailOrLoginId(email: string): Promise<any> {
    try {
      const result = await oracleDb.query(
        `SELECT * FROM SEC_LOGIN 
         WHERE (EMAIL_ID = :email OR LOGINID = :email) 
           AND ACTIVE_FLAG = 'Y'`,
        { email }
      );
      
      return result.rows?.[0] || null;
    } catch (error) {
      console.error("Error finding user:", error);
      return null;
    }
  }

  // Get user with tenant info
  static async getUserWithTenant(email: string): Promise<{
    user: any;
    tenantId: string;
  } | null> {
    const result = await QueryExecutor.getUserWithTenant(email);
    if (!result) return null;
    
    return {
      user: result.user,
      tenantId: result.tenantId
    };
  }

  // Execute query in user's tenant
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
        `UPDATE SEC_LOGIN 
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
      // Insert into central SEC_LOGIN table
      await oracleDb.query(
        `INSERT INTO SEC_LOGIN 
         (LOGINID, USERNAME, EMAIL_ID, USERPASS, SEC_PASSWD, COMPANY_CODE, ACTIVE_FLAG, CREATED_BY, CREATED_DATE)
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
