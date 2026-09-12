import bcrypt from "bcrypt";
import oracledb from "oracledb";
import type { MhdlEmployeeAccount } from "./hr.service";
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

  static async findRootUserByIdentifier(identifier: string, includeInactive = false): Promise<any | null> {
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
       ${includeInactive ? "" : "AND ACTIVE_FLAG = 'Y'"}`,
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
  static async createMhdlEmployee(apiUser: MhdlEmployeeAccount, password: string): Promise<void> {
    if (password !== apiUser.PASSWORD) throw new Error("Invalid employee password");
    const hashedPassword = await this.hashPassword(password);
    // Both schemas must reside in the central database. One connection makes the
    // root account, mapping, tenant account and permissions visible atomically.
    await oracleDb.withTransaction(async (conn) => {
      const options = { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false };
      const registry = await conn.execute<any>(
        `SELECT SCHEMA_NAME, CONNECTION_TYPE FROM CUSTOMERS.TENANT_REGISTRY
         WHERE TENANT_ID = 'MHDL_TENANT' AND IS_ACTIVE = 'Y' FOR UPDATE WAIT 30`, {}, options);
      const tenant = registry.rows?.[0];
      if (!tenant || tenant.SCHEMA_NAME?.trim().toUpperCase() !== "MHDL" || tenant.CONNECTION_TYPE !== "SCHEMA") {
        throw new Error("MHDL_TENANT must be an active MHDL schema tenant");
      }
      // The registry row lock serializes first-time provisioning across servers.
      const existing = await conn.execute(
        `SELECT LOGINID FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid)`,
        { loginid: apiUser.USER_ID }, options);
      if (existing.rows?.length) return;

      const binds = {
        loginid: apiUser.USER_ID, employeeId: apiUser.EMPLOYEE_ID,
        username: apiUser.NAME, email: `${apiUser.USER_ID}@gmail.com`, hashedPassword,
      };
      for (const table of ["CUSTOMERS.SEC_LOGINTEST", "MHDL.SEC_LOGIN"]) {
        await conn.execute(
          `INSERT INTO ${table}
           (COMPANY_CODE, LOGINID, USERID, LOGINID1, USERNAME, EMAIL_ID, USERPASS, SEC_PASSWD, PASSWORD,
            ACTIVE_FLAG, CREATED_BY, CREATED_AT)
           VALUES ('BSG', :loginid, :loginid, :employeeId, :username, :email, :hashedPassword,
                   :hashedPassword, :hashedPassword, 'Y', 'system', SYSTIMESTAMP)`, binds, options);
      }
      await conn.execute(
        `INSERT INTO CUSTOMERS.USER_TENANT_MAPPING (LOGINID, TENANT_ID, IS_DEFAULT)
         VALUES (:loginid, 'MHDL_TENANT', 'Y')`, { loginid: apiUser.USER_ID }, options);
      await conn.execute(
        `INSERT INTO MHDL.SEC_ROLE_FUNCTION_ACCESS_USER
         (COMPANY_CODE, LOGINID, SERIAL_NO_OR_ROLE_ID, SNEW, SMODIFY, SDELETE, SSAVE,
          SSEARCH, SSAVEAS, SUPLOAD, SUNDO, SPRINT, SPRINTSETUP, SHELP,
          USER_DT, USERID, CREATE_USER, CREATE_DATE)
         VALUES ('BSG', :loginid, 77777, 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y',
                 'Y', 'Y', 'Y', SYSDATE, :loginid, 'system', SYSDATE)`,
        { loginid: apiUser.USER_ID }, options);
    });
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
