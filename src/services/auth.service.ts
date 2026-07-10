import bcrypt from "bcrypt";
import { getRepository } from "../database/connection";
import { User } from "../entity/User";
import { QueryExecutor } from "../database/QueryExecutor";
import { oracleDb } from "../database/connection";
import { TenantManager } from "../database/TenantManager";

const ROOT_SCHEMA = "CUSTOMERS";

const SEC_LOGINTEST_TABLE = `${ROOT_SCHEMA}.SEC_LOGINTEST`;

export const EMAIL_NOT_FOUND_MESSAGE = "Email not found in the system. Please update your email in the system.";
export const OUTDATED_EMAIL_MESSAGE = "Your email address appears to be outdated. Please contact the IT team to update your email before changing the password.";

export class AuthService {
  private static getUserRepository() {
    return getRepository(User);
  }

  static async findRootUserByIdentifier(identifier: string): Promise<any | null> {
    const normalizedIdentifier = String(identifier || "").trim();
    if (!normalizedIdentifier) return null;

    console.log(`[AuthService.findRootUserByIdentifier] Finding user in ${SEC_LOGINTEST_TABLE} for ${normalizedIdentifier}`);
    const result = await oracleDb.query(
      `SELECT * FROM ${SEC_LOGINTEST_TABLE}
       WHERE (
         LOWER(TRIM(NVL(EMAIL_ID, ''))) = LOWER(:identifier)
         OR LOWER(TRIM(NVL(LOGINID, ''))) = LOWER(:identifier)
         OR LOWER(TRIM(NVL(CONTACT_EMAIL, ''))) = LOWER(:identifier)
         OR LOWER(TRIM(NVL(USERNAME, ''))) = LOWER(:identifier)
       )
       AND ACTIVE_FLAG = 'Y'`,
      { identifier: normalizedIdentifier }
    );

    if (!result.rows || result.rows.length === 0) {
      console.log(`[AuthService.findRootUserByIdentifier] User not found: ${normalizedIdentifier}`);
      return null;
    }

    return result.rows[0];
  }

  static async findUserByEmailOrLoginId(
    identifier: string
  ): Promise<{
    user: any;
    tenantId: string;
  } | null> {
    try {
      const user = await this.findRootUserByIdentifier(identifier);
      if (!user) return null;

      console.log(`[AuthService.findUserByEmailOrLoginId] User found: ${user.LOGINID}`);

      const tenantId = await TenantManager.getTenantForUser(user.LOGINID);
      if (!tenantId) {
        throw new Error(`No default tenant mapping found for user ${user.LOGINID}`);
      }

      return {
        user,
        tenantId
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

  // Update user password in the root schema table (CUSTOMERS.SEC_LOGINTEST by default)
  static async updateUserPassword(
    identifier: string,
    hashedPassword: string
  ): Promise<boolean> {
    try {
      const normalizedIdentifier = String(identifier || "").trim();
      await oracleDb.query(
        `UPDATE ${SEC_LOGINTEST_TABLE}
         SET USERPASS = :hashedPassword,
             UPDATED_BY = 'system'
         WHERE (
           LOWER(TRIM(NVL(EMAIL_ID, ''))) = LOWER(:identifier)
           OR LOWER(TRIM(NVL(LOGINID, ''))) = LOWER(:identifier)
           OR LOWER(TRIM(NVL(CONTACT_EMAIL, ''))) = LOWER(:identifier)
         )`,
        { hashedPassword, identifier: normalizedIdentifier }
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

      // Insert into central SEC_LOGINTEST table
      await oracleDb.query(
        `INSERT INTO ${SEC_LOGINTEST_TABLE}
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

      console.log("External user created in SEC_LOGINTEST:", apiUser.USER_ID);

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
