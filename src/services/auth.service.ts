import bcrypt from "bcrypt";
import oracledb from "oracledb";
import type { MhdlEmployeeAccount } from "./hr.service";
import type { ExternalAccount } from "./vendor.service";
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
    return this.createTenantAccount(apiUser, password, 'MHDL_TENANT', 'MHDL');
  }

  static async createWmsAccount(apiUser: ExternalAccount, password: string): Promise<void> {
    return this.createTenantAccount(apiUser, password, 'WMSDEV_TENANT', 'WMSDEV');
  }

  private static async createTenantAccount(
    apiUser: MhdlEmployeeAccount | ExternalAccount, password: string,
    tenantId: 'MHDL_TENANT' | 'WMSDEV_TENANT', schema: 'MHDL' | 'WMSDEV',
  ): Promise<void> {
    if (password !== apiUser.PASSWORD) throw new Error("Invalid employee password");
    const application = apiUser.TYPE.trim().toUpperCase();
    if (application !== 'EMPLOYEE' && application !== 'VENDOR') throw new Error('Unsupported account type');
    const hashedPassword = await this.hashPassword(password);
    const loginid = String(apiUser.USER_ID).trim();
    const allowedRoleIds: number[] = application === 'EMPLOYEE' ? [77777] : [88888];

    await oracleDb.withTransaction(async (conn) => {
      const options = { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false };
      const registry = await conn.execute<any>(
        `SELECT SCHEMA_NAME, CONNECTION_TYPE FROM CUSTOMERS.TENANT_REGISTRY
         WHERE TENANT_ID = :tenantId AND IS_ACTIVE = 'Y' FOR UPDATE WAIT 30`, { tenantId }, options);
      const tenant = registry.rows?.[0];
      if (!tenant || tenant.SCHEMA_NAME?.trim().toUpperCase() !== schema || tenant.CONNECTION_TYPE !== "SCHEMA") {
        throw new Error(`${tenantId} must be an active ${schema} schema tenant`);
      }

      const binds = {
        loginid,
        tenantId,
        employeeId: application === 'VENDOR' ? loginid : apiUser.EMPLOYEE_ID,
        username: apiUser.NAME,
        email: schema !== 'MHDL' && 'EMAIL' in apiUser && typeof apiUser.EMAIL === 'string' && apiUser.EMAIL.includes('@')
          ? apiUser.EMAIL.trim() : `${loginid}@gmail.com`,
        hashedPassword,
        application,
      };

      const rootExists = await conn.execute(
        `SELECT 1 FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid)`,
        { loginid }, options);

      if (rootExists.rows?.length) {
        await conn.execute(
          `UPDATE CUSTOMERS.SEC_LOGINTEST
           SET EMAIL_ID = NVL(EMAIL_ID, :email),
               USERNAME = NVL(USERNAME, :username),
               USERPASS = :hashedPassword,
               SEC_PASSWD = :hashedPassword,
               PASSWORD = :hashedPassword,
               ACTIVE_FLAG = 'Y',
               USER_ID = NVL(USER_ID, :loginid),
               USER_CODE = NVL(USER_CODE, :loginid),
               APPLICATION = NVL(APPLICATION, :application),
               USERID = NVL(USERID, :loginid),
               LAST_ACTION = 'LOGIN',
               UPDATED_BY = 'system',
               UPDATED_AT = SYSTIMESTAMP
           WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid)`,
          { email: binds.email, username: binds.username, hashedPassword, application: binds.application, loginid }, options);
      } else {
        await conn.execute(
          `INSERT INTO CUSTOMERS.SEC_LOGINTEST
           (COMPANY_CODE, LOGINID, EMAIL_ID, USERNAME, STATUS, USERPASS, SEC_PASSWD, PASSWORD,
            ACTIVE_FLAG, CREATED_BY, CREATED_AT, APPLICATION, USER_CODE, USER_ID, USERID,
            LOGINID1, LAST_ACTION, UPDATED_BY)
           VALUES ('BSG', :loginid, :email, :username, 'A', :hashedPassword, :hashedPassword,
                   :hashedPassword, 'Y', 'system', SYSTIMESTAMP, :application, :loginid,
                   :loginid, :loginid, :employeeId, 'LOGIN', 'system')`,
          { loginid, email: binds.email, username: binds.username, hashedPassword, application: binds.application, employeeId: binds.employeeId }, options);
      }

      const tenantLoginExists = await conn.execute(
        `SELECT 1 FROM ${schema}.SEC_LOGIN WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid)`,
        { loginid }, options);

      if (tenantLoginExists.rows?.length) {
        await conn.execute(
          `UPDATE ${schema}.SEC_LOGIN
           SET EMAIL_ID = NVL(EMAIL_ID, :email),
               USERNAME = NVL(USERNAME, :username),
               USERPASS = :hashedPassword,
               SEC_PASSWD = :hashedPassword,
               PASSWORD = :hashedPassword,
               ACTIVE_FLAG = 'Y',
               USER_ID = NVL(USER_ID, :loginid),
               USER_CODE = NVL(USER_CODE, :loginid),
               APPLICATION = NVL(APPLICATION, :application),
               USERID = NVL(USERID, :loginid),
               LOGINID1 = NVL(LOGINID1, :employeeId),
               UPDATED_BY = 'system',
               UPDATED_AT = SYSTIMESTAMP
           WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid)`,
          { email: binds.email, username: binds.username, hashedPassword, application: binds.application, employeeId: binds.employeeId, loginid }, options);
      } else {
        await conn.execute(
          `INSERT INTO ${schema}.SEC_LOGIN
           (COMPANY_CODE, LOGINID, USERID, LOGINID1, USERNAME, EMAIL_ID, USERPASS, SEC_PASSWD,
            PASSWORD, ACTIVE_FLAG, CREATED_BY, CREATED_AT, APPLICATION, USER_CODE, USER_ID, LANG_PREF)
           VALUES ('BSG', :loginid, :loginid, :employeeId, :username, :email, :hashedPassword,
                   :hashedPassword, :hashedPassword, 'Y', 'system', SYSTIMESTAMP, :application,
                   :loginid, :loginid, 'en')`,
          { loginid, employeeId: binds.employeeId, username: binds.username, email: binds.email, hashedPassword, application: binds.application }, options);
      }

      const mappingExists = await conn.execute(
        `SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING
         WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid) AND LOWER(TRIM(TENANT_ID)) = LOWER(:tenantId)`,
        { loginid, tenantId }, options);

      if (mappingExists.rows?.length) {
        await conn.execute(
          `UPDATE CUSTOMERS.USER_TENANT_MAPPING
           SET IS_DEFAULT = 'Y', CREATED_DATE = NVL(CREATED_DATE, SYSDATE)
           WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid) AND LOWER(TRIM(TENANT_ID)) = LOWER(:tenantId)`,
          { loginid, tenantId }, options);
      } else {
        await conn.execute(
          `INSERT INTO CUSTOMERS.USER_TENANT_MAPPING (LOGINID, TENANT_ID, IS_DEFAULT, CREATED_DATE)
           VALUES (:loginid, :tenantId, 'Y', SYSDATE)`,
          { loginid, tenantId }, options);
      }

      if (application === 'EMPLOYEE' && schema === 'WMSDEV') {
        const extraRoleExists = await conn.execute(
          `SELECT 1 FROM ${schema}.SEC_ROLE_MASTER WHERE ROLE_ID = 99999 AND ROWNUM = 1`,
          {}, options);

        if (extraRoleExists.rows?.length) {
          allowedRoleIds.push(99999);
        }
      }

      for (const roleId of allowedRoleIds) {
        const roleExists = await conn.execute(
          `SELECT 1 FROM ${schema}.SEC_ROLE_FUNCTION_ACCESS_USER
           WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid) AND SERIAL_NO_OR_ROLE_ID = :roleId`,
          { loginid, roleId }, options);

        if (roleExists.rows?.length) {
          await conn.execute(
            `UPDATE ${schema}.SEC_ROLE_FUNCTION_ACCESS_USER
             SET SNEW = 'Y', SMODIFY = 'Y', SDELETE = 'Y', SSAVE = 'Y', SSEARCH = 'Y',
                 SSAVEAS = 'Y', SUPLOAD = 'Y', SUNDO = 'Y', SPRINT = 'Y', SPRINTSETUP = 'Y',
                 SHELP = 'Y', USER_DT = SYSDATE, USERID = :loginid
             WHERE LOWER(TRIM(LOGINID)) = LOWER(:loginid) AND SERIAL_NO_OR_ROLE_ID = :roleId`,
            { loginid, roleId }, options);
        } else {
          await conn.execute(
            `INSERT INTO ${schema}.SEC_ROLE_FUNCTION_ACCESS_USER
             (COMPANY_CODE, LOGINID, SERIAL_NO_OR_ROLE_ID, SNEW, SMODIFY, SDELETE, SSAVE,
              SSEARCH, SSAVEAS, SUPLOAD, SUNDO, SPRINT, SPRINTSETUP, SHELP,
              USER_DT, USERID, CREATE_USER, CREATE_DATE)
             VALUES ('BSG', :loginid, :roleId, 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y',
                     'Y', 'Y', 'Y', SYSDATE, :loginid, 'system', SYSDATE)`,
            { loginid, roleId }, options);
        }
      }
    });
  }

}
