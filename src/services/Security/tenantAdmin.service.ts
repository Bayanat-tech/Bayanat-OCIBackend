import bcrypt from "bcrypt";
import { oracleDb } from "../../database/connection";

type PageParams = {
  page?: number;
  limit?: number;
  searchFilter?: { field?: string; value?: string };
};

type MasterResult = {
  tableData: any[];
  count: number;
};

const ROOT_SCHEMA = "CUSTOMERS";

const tenantUserColumns = [
  "COMPANY_CODE",
  "LOGINID",
  "EMAIL_ID",
  "USERNAME",
  "STATUS",
  "CONTACT_NAME",
  "CONTACT_NO",
  "CONTACT_EMAIL",
  "ID",
  "ACTIVE_FLAG",
  "USER_ID",
  "USER_CODE",
  "REAL_NAME",
  "APPLICATION",
  "USERID",
  "GROUP_ID",
  "USER_DESCRIPTION",
  "DIV_CODE",
  "LAST_ACTION",
  "LOGINID1",
];

const tenantRegistryColumns = [
  "TENANT_ID",
  "TENANT_NAME",
  "CONNECTION_TYPE",
  "SCHEMA_NAME",
  "DB_HOST",
  "DB_PORT",
  "DB_SERVICE",
  "DB_USER",
  "CONNECTION_STRING",
  "COMPANY_CODE",
  "IS_ACTIVE",
  "MAX_CONNECTIONS",
  "CREATED_DATE",
  "UPDATED_DATE",
];

const tenantMappingColumns = [
  "USER_MAP_ID",
  "LOGINID",
  "TENANT_ID",
  "IS_DEFAULT",
  "CREATED_DATE",
];

export class TenantAdminService {
  static async getTenantUsers(params: PageParams = {}): Promise<MasterResult> {
    return await listRootTable({
      table: "SEC_LOGINTEST",
      columns: tenantUserColumns,
      orderBy: "LOGINID",
      searchColumns: ["LOGINID", "USERNAME", "EMAIL_ID", "COMPANY_CODE", "REAL_NAME"],
      params,
    });
  }

  static async getTenantRegistry(params: PageParams = {}): Promise<MasterResult> {
    return await listRootTable({
      table: "TENANT_REGISTRY",
      columns: tenantRegistryColumns,
      orderBy: "TENANT_ID",
      searchColumns: ["TENANT_ID", "TENANT_NAME", "SCHEMA_NAME", "COMPANY_CODE", "DB_USER"],
      params,
    });
  }

  static async getTenantMappings(params: PageParams = {}): Promise<MasterResult> {
    return await listRootTable({
      table: "USER_TENANT_MAPPING",
      columns: tenantMappingColumns,
      orderBy: "USER_MAP_ID",
      searchColumns: ["LOGINID", "TENANT_ID", "IS_DEFAULT"],
      params,
    });
  }

  static async upsertTenantUser(payload: any, updatedBy: string) {
    const loginid = text(payload.loginid ?? payload.LOGINID).trim();
    if (!loginid) throw new Error("Login ID is required");

    const existing = await fetchOne(
      `SELECT LOGINID FROM ${ROOT_SCHEMA}.SEC_LOGINTEST WHERE LOGINID = :loginid`,
      { loginid }
    );

    const plainPassword = text(payload.userpass ?? payload.USERPASS ?? payload.password ?? payload.PASSWORD);
    const passwordBinds: Record<string, any> = {};
    let passwordInsertSql = "";
    let passwordInsertValues = "";
    let passwordUpdateSql = "";
    if (plainPassword) {
      const hashedPassword = await bcrypt.hash(plainPassword, 12);
      passwordBinds.userpass = hashedPassword;
      passwordBinds.secPasswd = hashedPassword;
      passwordBinds.password = hashedPassword;
      passwordInsertSql = ", USERPASS, SEC_PASSWD, PASSWORD";
      passwordInsertValues = ", :userpass, :secPasswd, :password";
      passwordUpdateSql = ", USERPASS = :userpass, SEC_PASSWD = :secPasswd, PASSWORD = :password";
    }

    const binds = {
      companyCode: text(coalesceValue(payload.company_code, payload.COMPANY_CODE, "BSG")),
      loginid,
      emailId: text(payload.email_id ?? payload.EMAIL_ID),
      username: text(coalesceValue(payload.username, payload.USERNAME, loginid)),
      status: text(coalesceValue(payload.status, payload.STATUS, "Y")).slice(0, 1),
      contactName: text(payload.contact_name ?? payload.CONTACT_NAME),
      contactNo: text(payload.contact_no ?? payload.CONTACT_NO),
      contactEmail: text(payload.contact_email ?? payload.CONTACT_EMAIL),
      activeFlag: text(coalesceValue(payload.active_flag, payload.ACTIVE_FLAG, "Y")).slice(0, 1),
      userId: text(coalesceValue(payload.user_id, payload.USER_ID, loginid)),
      userCode: text(coalesceValue(payload.user_code, payload.USER_CODE, loginid)),
      realName: text(coalesceValue(payload.real_name, payload.REAL_NAME, payload.username, payload.USERNAME)),
      application: text(payload.application ?? payload.APPLICATION),
      userid: text(payload.userid ?? payload.USERID),
      groupId: nullableNumber(payload.group_id ?? payload.GROUP_ID),
      userDescription: text(payload.user_description ?? payload.USER_DESCRIPTION),
      divCode: text(payload.div_code ?? payload.DIV_CODE),
      lastAction: text(payload.last_action ?? payload.LAST_ACTION),
      loginid1: text(coalesceValue(payload.loginid1, payload.LOGINID1, loginid)),
      updatedBy,
      ...passwordBinds,
    };

    if (existing) {
      await oracleDb.query(
        `UPDATE ${ROOT_SCHEMA}.SEC_LOGINTEST
            SET COMPANY_CODE = :companyCode,
                EMAIL_ID = :emailId,
                USERNAME = :username,
                STATUS = :status,
                CONTACT_NAME = :contactName,
                CONTACT_NO = :contactNo,
                CONTACT_EMAIL = :contactEmail,
                ACTIVE_FLAG = :activeFlag,
                USER_ID = :userId,
                USER_CODE = :userCode,
                REAL_NAME = :realName,
                APPLICATION = :application,
                USERID = :userid,
                GROUP_ID = :groupId,
                USER_DESCRIPTION = :userDescription,
                DIV_CODE = :divCode,
                LAST_ACTION = :lastAction,
                LOGINID1 = :loginid1,
                UPDATED_BY = :updatedBy,
                UPDATED_AT = SYSTIMESTAMP
                ${passwordUpdateSql}
          WHERE LOGINID = :loginid`,
        binds
      );
      return { mode: "updated" };
    }

    await oracleDb.query(
      `INSERT INTO ${ROOT_SCHEMA}.SEC_LOGINTEST (
          COMPANY_CODE, LOGINID, EMAIL_ID, USERNAME, STATUS, CONTACT_NAME,
          CONTACT_NO, CONTACT_EMAIL, ACTIVE_FLAG, USER_ID, USER_CODE, REAL_NAME,
          APPLICATION, USERID, GROUP_ID, USER_DESCRIPTION, DIV_CODE, LAST_ACTION,
          LOGINID1, UPDATED_BY, CREATED_BY, UPDATED_AT, CREATED_AT, ID${passwordInsertSql}
       ) VALUES (
          :companyCode, :loginid, :emailId, :username, :status, :contactName,
          :contactNo, :contactEmail, :activeFlag, :userId, :userCode, :realName,
          :application, :userid, :groupId, :userDescription, :divCode, :lastAction,
          :loginid1, :updatedBy, :updatedBy, SYSTIMESTAMP, SYSTIMESTAMP,
          (SELECT NVL(MAX(ID), 0) + 1 FROM ${ROOT_SCHEMA}.SEC_LOGINTEST)${passwordInsertValues}
       )`,
      binds
    );
    return { mode: "created" };
  }

  static async upsertTenantRegistry(payload: any) {
    const tenantId = text(payload.tenant_id ?? payload.TENANT_ID).trim();
    if (!tenantId) throw new Error("Tenant ID is required");

    const binds = {
      tenantId,
      tenantName: text(payload.tenant_name ?? payload.TENANT_NAME),
      connectionType: text(coalesceValue(payload.connection_type, payload.CONNECTION_TYPE, "SCHEMA")),
      schemaName: text(payload.schema_name ?? payload.SCHEMA_NAME),
      dbHost: text(payload.db_host ?? payload.DB_HOST),
      dbPort: nullableNumber(payload.db_port ?? payload.DB_PORT) ?? 1521,
      dbService: text(payload.db_service ?? payload.DB_SERVICE),
      dbUser: text(payload.db_user ?? payload.DB_USER),
      dbPassword: nullableText(payload.db_password ?? payload.DB_PASSWORD),
      connectionString: text(payload.connection_string ?? payload.CONNECTION_STRING),
      companyCode: text(coalesceValue(payload.company_code, payload.COMPANY_CODE, "BSG")),
      isActive: text(coalesceValue(payload.is_active, payload.IS_ACTIVE, "Y")).slice(0, 1),
      maxConnections: nullableNumber(payload.max_connections ?? payload.MAX_CONNECTIONS) ?? 10,
    };

    const existing = await fetchOne(
      `SELECT TENANT_ID FROM ${ROOT_SCHEMA}.TENANT_REGISTRY WHERE TENANT_ID = :tenantId`,
      { tenantId }
    );

    if (existing) {
      await oracleDb.query(
        `UPDATE ${ROOT_SCHEMA}.TENANT_REGISTRY
            SET TENANT_NAME = :tenantName,
                CONNECTION_TYPE = :connectionType,
                SCHEMA_NAME = :schemaName,
                DB_HOST = :dbHost,
                DB_PORT = :dbPort,
                DB_SERVICE = :dbService,
                DB_USER = :dbUser,
                DB_PASSWORD = CASE WHEN :dbPassword IS NULL THEN DB_PASSWORD ELSE :dbPassword END,
                CONNECTION_STRING = :connectionString,
                COMPANY_CODE = :companyCode,
                IS_ACTIVE = :isActive,
                MAX_CONNECTIONS = :maxConnections,
                UPDATED_DATE = SYSDATE
          WHERE TENANT_ID = :tenantId`,
        binds
      );
      return { mode: "updated" };
    }

    await oracleDb.query(
      `INSERT INTO ${ROOT_SCHEMA}.TENANT_REGISTRY (
          TENANT_ID, TENANT_NAME, CONNECTION_TYPE, SCHEMA_NAME, DB_HOST, DB_PORT,
          DB_SERVICE, DB_USER, DB_PASSWORD, CONNECTION_STRING, COMPANY_CODE,
          IS_ACTIVE, MAX_CONNECTIONS, CREATED_DATE, UPDATED_DATE
       ) VALUES (
          :tenantId, :tenantName, :connectionType, :schemaName, :dbHost, :dbPort,
          :dbService, :dbUser, :dbPassword, :connectionString, :companyCode,
          :isActive, :maxConnections, SYSDATE, SYSDATE
       )`,
      binds
    );
    return { mode: "created" };
  }

  static async upsertTenantMapping(payload: any) {
    const loginid = text(payload.loginid ?? payload.LOGINID).trim();
    const tenantId = text(payload.tenant_id ?? payload.TENANT_ID).trim();
    if (!loginid || !tenantId) throw new Error("Login ID and Tenant ID are required");

    const binds = {
      userMapId: nullableNumber(payload.user_map_id ?? payload.USER_MAP_ID),
      loginid,
      tenantId,
      isDefault: text(coalesceValue(payload.is_default, payload.IS_DEFAULT, "Y")).slice(0, 1),
    };

    const existing = binds.userMapId
      ? await fetchOne(
          `SELECT USER_MAP_ID FROM ${ROOT_SCHEMA}.USER_TENANT_MAPPING WHERE USER_MAP_ID = :userMapId`,
          { userMapId: binds.userMapId }
        )
      : await fetchOne(
          `SELECT USER_MAP_ID FROM ${ROOT_SCHEMA}.USER_TENANT_MAPPING WHERE LOGINID = :loginid AND TENANT_ID = :tenantId`,
          { loginid, tenantId }
        );

    if (existing) {
      await oracleDb.query(
        `UPDATE ${ROOT_SCHEMA}.USER_TENANT_MAPPING
            SET LOGINID = :loginid,
                TENANT_ID = :tenantId,
                IS_DEFAULT = :isDefault
          WHERE USER_MAP_ID = :userMapId`,
        { ...binds, userMapId: existing.USER_MAP_ID || binds.userMapId }
      );
      return { mode: "updated" };
    }

    await oracleDb.query(
      `INSERT INTO ${ROOT_SCHEMA}.USER_TENANT_MAPPING (LOGINID, TENANT_ID, IS_DEFAULT, CREATED_DATE)
       VALUES (:loginid, :tenantId, :isDefault, SYSDATE)`,
      {
        loginid: binds.loginid,
        tenantId: binds.tenantId,
        isDefault: binds.isDefault,
      }
    );
    return { mode: "created" };
  }

  static async deleteTenantUsers(ids: Array<string | number>) {
    return await deleteByIds("SEC_LOGINTEST", "LOGINID", ids);
  }

  static async deleteTenantRegistry(ids: Array<string | number>) {
    return await deleteByIds("TENANT_REGISTRY", "TENANT_ID", ids);
  }

  static async deleteTenantMappings(ids: Array<string | number>) {
    return await deleteByIds("USER_TENANT_MAPPING", "USER_MAP_ID", ids);
  }
}

async function listRootTable({
  table,
  columns,
  orderBy,
  searchColumns,
  params,
}: {
  table: string;
  columns: string[];
  orderBy: string;
  searchColumns: string[];
  params: PageParams;
}): Promise<MasterResult> {
  const page = Math.max(Number(params.page) || 1, 1);
  const limit = Math.max(Number(params.limit) || 100, 1);
  const offset = (page - 1) * limit;
  const countBinds: Record<string, any> = {};
  const where = buildSearchWhere(searchColumns, params.searchFilter, countBinds);
  const pageBinds: Record<string, any> = { ...countBinds, offsetRows: offset, limitRows: limit };
  const selectColumns = columns.map((column) => `${column} AS "${column}"`).join(", ");
  const baseSql = `FROM ${ROOT_SCHEMA}.${table} ${where}`;
  const countResult = await oracleDb.query(`SELECT COUNT(*) AS TOTAL ${baseSql}`, countBinds);
  const count = Number(countResult.rows?.[0]?.TOTAL || 0);
  const result = await oracleDb.query(
    `SELECT ${selectColumns}
       ${baseSql}
      ORDER BY ${orderBy}
      OFFSET :offsetRows ROWS FETCH NEXT :limitRows ROWS ONLY`,
    pageBinds
  );
  return { tableData: result.rows || [], count };
}

function buildSearchWhere(columns: string[], searchFilter: any, binds: Record<string, any>) {
  const value = text(searchFilter?.value ?? searchFilter?.values).trim();
  if (!value) return "";
  binds.searchValue = `%${value.toUpperCase()}%`;
  const field = text(searchFilter?.field).toUpperCase();
  const selectedColumns = field && columns.includes(field) ? [field] : columns;
  return `WHERE (${selectedColumns.map((column) => `UPPER(TO_CHAR(${column})) LIKE :searchValue`).join(" OR ")})`;
}

async function fetchOne(sql: string, binds: Record<string, any>) {
  const result = await oracleDb.query(sql, binds);
  return result.rows?.[0] || null;
}

async function deleteByIds(table: string, keyColumn: string, ids: Array<string | number>) {
  let deleted = 0;
  for (const id of ids) {
    const result = await oracleDb.query(
      `DELETE FROM ${ROOT_SCHEMA}.${table} WHERE ${keyColumn} = :id`,
      { id }
    );
    deleted += Number(result.rowsAffected || 0);
  }
  return deleted > 0;
}

function text(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function coalesceValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function nullableText(value: unknown) {
  const normalized = text(value).trim();
  return normalized || null;
}

function nullableNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
