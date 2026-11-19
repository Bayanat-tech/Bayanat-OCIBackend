import oracledb from "oracledb";
import bcrypt from "bcrypt";
import { oracleDb } from "../../database/connection";
import { TenantManager } from "../../database/TenantManager";

// Only these security resources can be reached through the platform console.
export const SECURITY_TABLES: Record<string, string> = {
  SEC_LOGIN: "Users",
  SEC_MODULE_DATA: "Module screens",
  SEC_ROLE_MASTER: "Roles",
  SEC_ROLE_FUNCTION_ACCESS_USER: "User screen / role access",
  SEC_ROLE_APP_ACCESS: "Role screen access",
  SEC_OPERATION_MASTER: "Operations",
  SEC_DIV_USER: "Division access",
  SEC_PRIN_USER: "Principal access",
  MS_COMPANY: "Companies",
  MS_COMPANY_USER_ASSIGN: "Company access",
  MS_PROJECT_USER_ASSIGN: "Project access",
  MS_PS_PROJECT_MASTER: "Projects",
  MS_PS_USER_ROLE_MAPPING: "User role mappings",
  MS_PS_ROLE: "Project roles",
  MG_REPORT: "Reports",
  TBL_SQL_STRING_INFO: "Queries",
  MS_PS_FLOW_MASTER: "Flows",
  MS_HR_DIVISION: "Divisions",
  SEC_MODULE_USER: "User modules",
  SEC_USERGRP_RIGHTS: "Group rights",
};
export const ROOT_TABLES: Record<string, string> = {
  SEC_LOGINTEST: "Central users",
  TENANT_REGISTRY: "Tenant registry",
  USER_TENANT_MAPPING: "User tenant mappings",
};
const SECRETS = /^(USERPASS|SEC_PASSWD|PASSWORD|DB_PASSWORD)$/;
const SYSTEM_FIELDS =
  /^(CREATED_AT|UPDATED_AT|CREATE_DATE|USER_DT|CREATED_BY|UPDATED_BY|CREATE_USER)$/;
const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
type Column = {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  NULLABLE: string;
  DATA_LENGTH: number;
  IDENTITY_COLUMN: string;
};
export class PlatformError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export class PlatformAdminService {
  static async provisionUser(
    actor: string,
    tenantId: string,
    company: string,
    input: any,
  ) {
    if (tenantId === "root")
      throw new PlatformError("Select a tenant and company");
    const loginid = String(input.loginid || "").trim();
    const username = String(input.username || "").trim();
    const email = String(input.email || "").trim();
    if (
      !/^[A-Za-z0-9_.-]{1,15}$/.test(loginid) ||
      !username ||
      username.length > 50 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      throw new PlatformError(
        "Provide a login (up to 15 characters), name and valid email",
      );
    if (typeof input.password !== "string" || input.password.length < 12)
      throw new PlatformError("Password must contain at least 12 characters");
    if (await this.isAdmin(loginid))
      throw new PlatformError(
        "This login is reserved for a platform administrator",
        403,
      );
    const hash = await bcrypt.hash(input.password, 12);
    return this.scope(tenantId, async (c, owner) => {
      const valid = await c.execute(
        `SELECT 1 FROM ${owner}.MS_COMPANY WHERE COMPANY_CODE=:company`,
        { company },
        options,
      );
      if (!valid.rows?.length)
        throw new PlatformError("Select a company in this tenant");
      try {
        // The existing schema tenants share the central database. Keep central login,
        // tenant login and tenant mapping on this one connection/transaction.
        await c.execute(
          "LOCK TABLE CUSTOMERS.SEC_LOGINTEST IN EXCLUSIVE MODE WAIT 5",
        );
        const existing = await c.execute(
          "SELECT 1 FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(LOGINID)=LOWER(:loginid) OR LOWER(EMAIL_ID)=LOWER(:email)",
          { loginid, email },
          options,
        );
        if (existing.rows?.length)
          throw new PlatformError(
            "A central account already uses this login or email. Use central user mappings to link an existing account.",
          );
        await c.execute(
          `INSERT INTO CUSTOMERS.SEC_LOGINTEST (COMPANY_CODE,LOGINID,USERNAME,EMAIL_ID,STATUS,ACTIVE_FLAG,ID,USERPASS,SEC_PASSWD,PASSWORD,USER_ID,USER_CODE,USERID,CREATED_BY,CREATED_AT)
          VALUES (:company,:loginid,:username,:email,'A','Y',(SELECT NVL(MAX(ID),0)+1 FROM CUSTOMERS.SEC_LOGINTEST),:hash,:hash,:hash,:loginid,:loginid,:loginid,:actor,SYSTIMESTAMP)`,
          { company, loginid, username, email, hash, actor },
        );
        const cols = await this.columns(c, owner, "SEC_LOGIN");
        const values: Record<string, any> = {
          COMPANY_CODE: company,
          LOGINID: loginid,
          USERNAME: username,
          EMAIL_ID: email,
          STATUS: "A",
          ACTIVE_FLAG: "Y",
          USERPASS: hash,
          SEC_PASSWD: hash,
          PASSWORD: hash,
          USER_ID: loginid,
          USER_CODE: loginid,
          USERID: loginid,
        };
        if (
          cols.some(
            (x) => x.COLUMN_NAME === "ID" && x.IDENTITY_COLUMN !== "YES",
          )
        ) {
          await c.execute(
            `LOCK TABLE ${owner}.SEC_LOGIN IN EXCLUSIVE MODE WAIT 5`,
          );
          const id = await c.execute<any>(
            `SELECT NVL(MAX(ID),0)+1 AS ID FROM ${owner}.SEC_LOGIN`,
            {},
            options,
          );
          values.ID = id.rows![0].ID;
        }
        const fields = Object.keys(values).filter((key) =>
          cols.some((x) => x.COLUMN_NAME === key),
        );
        await c.execute(
          `INSERT INTO ${owner}.SEC_LOGIN (${fields.join(",")}) VALUES (${fields.map((_, i) => `:v${i}`).join(",")})`,
          Object.fromEntries(fields.map((key, i) => [`v${i}`, values[key]])),
        );
        await c.execute(
          "LOCK TABLE CUSTOMERS.USER_TENANT_MAPPING IN EXCLUSIVE MODE WAIT 5",
        );
        await c.execute(
          `INSERT INTO CUSTOMERS.USER_TENANT_MAPPING (USER_MAP_ID,LOGINID,TENANT_ID,IS_DEFAULT,CREATED_DATE)
          VALUES ((SELECT NVL(MAX(USER_MAP_ID),0)+1 FROM CUSTOMERS.USER_TENANT_MAPPING),:loginid,:tenantId,'Y',SYSDATE)`,
          { loginid, tenantId },
        );
        await this.audit(
          actor,
          tenantId,
          company,
          "ATTEMPT",
          "PROVISION_USER",
          { loginid },
        );
        await this.audit(
          actor,
          tenantId,
          company,
          "INSERT",
          "PROVISION_USER",
          {
            loginid,
          },
          c,
        );
        await c.commit();
        return { loginid };
      } catch (e) {
        await c.rollback();
        throw e;
      }
    });
  }

  static async userAccess(tenantId: string, company: string, loginid: string) {
    const users = await this.tenantQuery(
      tenantId,
      "SELECT LOGINID,USERNAME FROM #SCHEMA#.SEC_LOGIN WHERE COMPANY_CODE=:company ORDER BY LOGINID",
      { company },
    );
    const screens = await this.tenantQuery(
      tenantId,
      "SELECT SERIAL_NO,APP_CODE,LEVEL1,LEVEL2,LEVEL3 FROM #SCHEMA#.SEC_MODULE_DATA WHERE NVL(IS_ACTIVE,'Y')='Y' ORDER BY APP_CODE,SERIAL_NO",
    );
    const access = loginid
      ? await this.tenantQuery(
          tenantId,
          "SELECT * FROM #SCHEMA#.SEC_ROLE_FUNCTION_ACCESS_USER WHERE COMPANY_CODE=:company AND LOGINID=:loginid",
          { company, loginid },
        )
      : [];
    const disabled = await oracleDb.query(
      "SELECT SERIAL_NO FROM CUSTOMERS.SEC_COMPANY_SCREEN_ACCESS WHERE TENANT_ID=:tenantId AND COMPANY_CODE=:company AND IS_ENABLED='N'",
      { tenantId, company },
    );
    const denied = new Set(
      (disabled.rows || []).map((r: any) => Number(r.SERIAL_NO)),
    );
    return {
      users,
      screens: screens.filter((s) => !denied.has(Number(s.SERIAL_NO))),
      access,
    };
  }

  static async grant(
    actor: string,
    tenantId: string,
    company: string,
    input: any,
  ) {
    if (
      !input.loginid ||
      !Array.isArray(input.serials) ||
      !input.serials.length ||
      input.serials.length > 1000 ||
      input.serials.some((n: any) => !Number.isSafeInteger(n)) ||
      typeof input.enabled !== "boolean"
    )
      throw new PlatformError("Select a user and valid screens");
    const data = await this.userAccess(tenantId, company, input.loginid);
    if (!data.users.some((u) => u.LOGINID === input.loginid))
      throw new PlatformError("User does not belong to this company");
    if (
      input.enabled &&
      input.serials.some(
        (n: number) => !data.screens.some((s) => Number(s.SERIAL_NO) === n),
      )
    )
      throw new PlatformError(
        "A selected screen is unavailable to this company",
      );
    return this.scope(tenantId, async (c, owner) => {
      try {
        for (const serial of new Set<number>(input.serials)) {
          const binds = { company, loginid: input.loginid, serial, actor };
          if (!input.enabled)
            await c.execute(
              `DELETE FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER WHERE COMPANY_CODE=:company AND LOGINID=:loginid AND SERIAL_NO_OR_ROLE_ID=:serial`,
              { company, loginid: input.loginid, serial },
            );
          else
            await c.execute(
              `MERGE INTO ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER t USING (SELECT :company COMPANY_CODE,:loginid LOGINID,:serial SERIAL_NO_OR_ROLE_ID FROM DUAL) s
            ON (t.COMPANY_CODE=s.COMPANY_CODE AND t.LOGINID=s.LOGINID AND t.SERIAL_NO_OR_ROLE_ID=s.SERIAL_NO_OR_ROLE_ID)
            WHEN MATCHED THEN UPDATE SET SNEW='Y',SMODIFY='Y',SDELETE='Y',SSAVE='Y',SSEARCH='Y',SSAVEAS='Y',SUPLOAD='Y',SUNDO='Y',SPRINT='Y',SPRINTSETUP='Y',SHELP='Y',USERID=:actor
            WHEN NOT MATCHED THEN INSERT (COMPANY_CODE,LOGINID,SERIAL_NO_OR_ROLE_ID,SNEW,SMODIFY,SDELETE,SSAVE,SSEARCH,SSAVEAS,SUPLOAD,SUNDO,SPRINT,SPRINTSETUP,SHELP,USERID)
            VALUES (:company,:loginid,:serial,'Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y',:actor)`,
              binds,
            );
        }
        await this.audit(actor, tenantId, company, "ATTEMPT", "USER_ACCESS", {
          loginid: input.loginid,
          serials: input.serials,
          enabled: input.enabled,
        });
        await this.audit(
          actor,
          tenantId,
          company,
          "UPDATE",
          "USER_ACCESS",
          {
            loginid: input.loginid,
            serials: input.serials,
            enabled: input.enabled,
          },
          c,
        );
        await c.commit();
        return { changed: input.serials.length };
      } catch (e) {
        await c.rollback();
        throw e;
      }
    });
  }
  static async isAdmin(loginid: string): Promise<boolean> {
    const r = await oracleDb.query(
      `SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN a
      JOIN CUSTOMERS.SEC_LOGINTEST u ON u.LOGINID = a.LOGINID
      WHERE a.LOGINID = :loginid AND a.IS_ACTIVE = 'Y' AND u.ACTIVE_FLAG = 'Y'`,
      { loginid },
    );
    return Boolean(r.rows?.length);
  }

  static async root<T>(
    fn: (conn: oracledb.Connection) => Promise<T>,
  ): Promise<T> {
    const conn = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
    });
    try {
      return await fn(conn);
    } finally {
      await conn.close();
    }
  }

  static async tenants() {
    return this.root(
      async (c) =>
        (
          await c.execute(
            `SELECT TENANT_ID,TENANT_NAME,SCHEMA_NAME,COMPANY_CODE,IS_ACTIVE
      FROM CUSTOMERS.TENANT_REGISTRY ORDER BY TENANT_NAME`,
            {},
            options,
          )
        ).rows || [],
    );
  }

  static async scope<T>(
    tenantId: string,
    fn: (
      conn: oracledb.Connection,
      owner: string,
      tables: Record<string, string>,
    ) => Promise<T>,
  ) {
    if (tenantId === "root")
      return this.root((c) => fn(c, "CUSTOMERS", ROOT_TABLES));
    const config = await TenantManager.getTenantConfig(tenantId);
    if (config.IS_ACTIVE !== "Y")
      throw new PlatformError("Tenant is inactive", 403);
    // Schema tenants share the central database. Qualified object names avoid both
    // pooled CURRENT_SCHEMA leakage and a dependency on each tenant login password.
    if (config.CONNECTION_TYPE?.trim().toUpperCase() === "SCHEMA") {
      const owner = String(config.SCHEMA_NAME || "")
        .trim()
        .toUpperCase();
      if (!/^[A-Z][A-Z0-9_$#]*$/.test(owner))
        throw new PlatformError("Invalid tenant schema configuration");
      return this.root((c) => fn(c, owner, SECURITY_TABLES));
    }
    const conn = await TenantManager.getConnection(tenantId);
    try {
      const r = await conn.execute<any>(
        "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS OWNER FROM DUAL",
        {},
        options,
      );
      const owner = String(r.rows?.[0]?.OWNER || "");
      if (!/^[A-Za-z][A-Za-z0-9_$#]*$/.test(owner))
        throw new PlatformError("Invalid tenant schema");
      return await fn(conn, owner, SECURITY_TABLES);
    } finally {
      await conn.close();
    }
  }

  static async tenantQuery(tenantId: string, sql: string, binds: any = {}) {
    if (tenantId === "root") throw new PlatformError("Select a tenant");
    return this.scope(
      tenantId,
      async (c, owner) =>
        (await c.execute<any>(sql.replace(/#SCHEMA#/g, owner), binds, options))
          .rows || [],
    );
  }

  static async columns(
    c: oracledb.Connection,
    owner: string,
    table: string,
  ): Promise<Column[]> {
    const r = await c.execute<Column>(
      `SELECT COLUMN_NAME,DATA_TYPE,NULLABLE,DATA_LENGTH,IDENTITY_COLUMN
      FROM ALL_TAB_COLUMNS WHERE OWNER=:owner AND TABLE_NAME=:tab ORDER BY COLUMN_ID`,
      { owner, tab: table },
      options,
    );
    return (r.rows || []).filter((x) =>
      /^(VARCHAR2|CHAR|NVARCHAR2|NCHAR|NUMBER|FLOAT|DATE|TIMESTAMP)/.test(
        x.DATA_TYPE,
      ),
    );
  }

  static async catalog(tenantId: string) {
    return this.scope(tenantId, async (c, owner, allowed) => {
      const found = await c.execute<any>(
        "SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER=:owner",
        { owner },
        options,
      );
      const available = new Set((found.rows || []).map((r) => r.TABLE_NAME));
      const companies =
        tenantId === "root"
          ? []
          : (
              await c.execute(
                `SELECT COMPANY_CODE,MIN(COMPANY_NAME) AS COMPANY_NAME FROM ${owner}.MS_COMPANY GROUP BY COMPANY_CODE ORDER BY COMPANY_CODE`,
                {},
                options,
              )
            ).rows || [];
      return {
        owner,
        companies,
        tables: Object.entries(allowed)
          .filter(([name]) => available.has(name))
          .map(([name, label]) => ({ name, label })),
      };
    });
  }

  static validateTable(table: string, allowed: Record<string, string>) {
    if (!Object.prototype.hasOwnProperty.call(allowed, table))
      throw new PlatformError("Security resource is not allowed", 403);
  }

  static async records(
    tenantId: string,
    table: string,
    company: string,
    page = 1,
    search = "",
  ) {
    return this.scope(tenantId, async (c, owner, allowed) => {
      this.validateTable(table, allowed);
      const cols = await this.columns(c, owner, table);
      if (!cols.length)
        throw new PlatformError("Resource is unavailable in this tenant", 404);
      const visible = cols.filter((x) => !SECRETS.test(x.COLUMN_NAME));
      const binds: any = {};
      const clauses: string[] = [];
      if (company && cols.some((x) => x.COLUMN_NAME === "COMPANY_CODE")) {
        clauses.push("COMPANY_CODE = :company");
        binds.company = company;
      }
      if (search.trim()) {
        binds.search = `%${search.trim().toUpperCase()}%`;
        clauses.push(
          `(${
            visible
              .filter((x) => /CHAR/.test(x.DATA_TYPE))
              .map((x) => `UPPER(${x.COLUMN_NAME}) LIKE :search`)
              .join(" OR ") || "1=0"
          })`,
        );
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const count = await c.execute<any>(
        `SELECT COUNT(*) AS TOTAL FROM ${owner}.${table} ${where}`,
        binds,
        options,
      );
      const r = await c.execute(
        `SELECT ROWIDTOCHAR(ROWID) AS "_rowid",${visible.map((x) => x.COLUMN_NAME).join(",")}
        FROM ${owner}.${table} ${where} ORDER BY ROWID OFFSET :offsetRows ROWS FETCH NEXT 50 ROWS ONLY`,
        { ...binds, offsetRows: (Math.max(1, page) - 1) * 50 },
        options,
      );
      return {
        columns: cols.map((x) => ({
          name: x.COLUMN_NAME,
          type: x.DATA_TYPE,
          required: x.NULLABLE === "N",
          secret: SECRETS.test(x.COLUMN_NAME),
          readonly:
            SYSTEM_FIELDS.test(x.COLUMN_NAME) || x.IDENTITY_COLUMN === "YES",
        })),
        rows: r.rows || [],
        count: count.rows?.[0]?.TOTAL || 0,
      };
    });
  }

  static async audit(
    actor: string,
    tenantId: string,
    company: string,
    action: string,
    resource: string,
    details: any,
    transaction?: oracledb.Connection,
  ) {
    const write = async (c: oracledb.Connection) => {
      await c.execute(
        `INSERT INTO CUSTOMERS.SEC_PLATFORM_AUDIT (ACTOR,TENANT_ID,COMPANY_CODE,ACTION,RESOURCE_NAME,DETAILS)
        VALUES (:p_actor,:p_tenant,:p_company,:p_action,:p_resource,:p_details)`,
        {
          p_actor: actor,
          p_tenant: tenantId,
          p_company: company || null,
          p_action: action,
          p_resource: resource,
          p_details: JSON.stringify(details).slice(0, 3900),
        },
        { autoCommit: !transaction },
      );
    };
    if (transaction) await write(transaction);
    else await this.root(write);
  }

  static async mutate(
    actor: string,
    tenantId: string,
    table: string,
    company: string,
    payload: any,
    remove = false,
  ) {
    return this.scope(tenantId, async (c, owner, allowed) => {
      this.validateTable(table, allowed);
      const cols = await this.columns(c, owner, table);
      if (!cols.length) throw new PlatformError("Resource unavailable", 404);
      const rowid = payload.rowid;
      if (remove && !rowid)
        throw new PlatformError("Select a record to delete");
      const hasCompany = cols.some((x) => x.COLUMN_NAME === "COMPANY_CODE");
      if (
        tenantId !== "root" &&
        hasCompany &&
        !company &&
        !(table === "MS_COMPANY" && !rowid)
      )
        throw new PlatformError("Select a company first");
      if (
        company &&
        tenantId !== "root" &&
        !(table === "MS_COMPANY" && !rowid)
      ) {
        const valid = await c.execute(
          `SELECT 1 FROM ${owner}.MS_COMPANY WHERE COMPANY_CODE=:company`,
          { company },
          options,
        );
        if (!valid.rows?.length)
          throw new PlatformError("Company does not belong to this tenant");
      }
      const binds: any = {};
      let where = "ROWID=CHARTOROWID(:rid)";
      if (rowid) {
        if (typeof rowid !== "string" || !/^[A-Za-z0-9+/]{18}$/.test(rowid))
          throw new PlatformError("Invalid record identifier");
        binds.rid = rowid;
        if (company && hasCompany) {
          where += " AND COMPANY_CODE=:scopeCompany";
          binds.scopeCompany = company;
        }
        const old = await c.execute<any>(
          `SELECT ${table === "SEC_LOGINTEST" ? "LOGINID" : "1 AS FOUND"} FROM ${owner}.${table} WHERE ${where}`,
          binds,
          options,
        );
        if (!old.rows?.length)
          throw new PlatformError("Record no longer exists in this scope", 404);
        if (table === "SEC_LOGINTEST") {
          const admin = await c.execute(
            "SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN WHERE LOGINID=:id",
            { id: old.rows[0].LOGINID },
            options,
          );
          if (admin.rows?.length)
            throw new PlatformError(
              "Platform administrator accounts are managed through the bootstrap tool",
              403,
            );
        }
      }
      const values: Record<string, any> = { ...(payload.values || {}) };
      if (
        Object.keys(values).some(
          (key) =>
            !cols.some((x) => x.COLUMN_NAME === key) || SYSTEM_FIELDS.test(key),
        )
      )
        throw new PlatformError("Unknown or protected field");
      if (
        tenantId !== "root" &&
        hasCompany &&
        !(table === "MS_COMPANY" && !rowid)
      )
        values.COMPANY_CODE = company;
      // IDs on older schemas have no sequence/default. Hold the table lock until commit.
      if (!rowid && !remove) {
        for (const col of cols.filter(
          (x) =>
            ["ID", "USER_MAP_ID"].includes(x.COLUMN_NAME) &&
            x.NULLABLE === "N" &&
            x.IDENTITY_COLUMN !== "YES",
        )) {
          if (!values[col.COLUMN_NAME]) {
            await c.execute(
              `LOCK TABLE ${owner}.${table} IN EXCLUSIVE MODE WAIT 5`,
            );
            const id = await c.execute<any>(
              `SELECT NVL(MAX(${col.COLUMN_NAME}),0)+1 AS ID FROM ${owner}.${table}`,
              {},
              options,
            );
            values[col.COLUMN_NAME] = id.rows![0].ID;
          }
        }
      }
      if (
        table === "SEC_LOGINTEST" &&
        !rowid &&
        (await this.isAdmin(String(values.LOGINID || "")))
      )
        throw new PlatformError("Administrator account already exists", 403);
      if (table === "SEC_LOGINTEST" && rowid && "LOGINID" in values) {
        const admin = await c.execute(
          "SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN WHERE LOGINID=:id",
          { id: values.LOGINID },
          options,
        );
        if (admin.rows?.length)
          throw new PlatformError("Protected administrator login", 403);
      }
      // Secret fields are write-only; blank on edit preserves the current hash/credential.
      for (const col of cols.filter((x) => SECRETS.test(x.COLUMN_NAME))) {
        if (!values[col.COLUMN_NAME]) delete values[col.COLUMN_NAME];
      }
      const password = values.USERPASS || values.SEC_PASSWD || values.PASSWORD;
      if (password) {
        if (String(password).length < 12)
          throw new PlatformError(
            "Password must contain at least 12 characters",
          );
        const hash = await bcrypt.hash(String(password), 12);
        for (const col of cols.filter((x) =>
          /^(USERPASS|SEC_PASSWD|PASSWORD)$/.test(x.COLUMN_NAME),
        ))
          values[col.COLUMN_NAME] = hash;
      }
      if (!remove) {
        if (
          !rowid &&
          cols.some((x) => x.COLUMN_NAME === "USERID") &&
          !values.USERID
        )
          values.USERID = actor;
        for (const col of cols) {
          if (col.IDENTITY_COLUMN === "YES") {
            delete values[col.COLUMN_NAME];
            continue;
          }
          if (SYSTEM_FIELDS.test(col.COLUMN_NAME)) continue;
          if (!(col.COLUMN_NAME in values)) continue;
          let val = values[col.COLUMN_NAME];
          if (val === "") val = null;
          if (val !== null && /NUMBER|FLOAT/.test(col.DATA_TYPE)) {
            val = Number(val);
            if (!Number.isFinite(val))
              throw new PlatformError(`Invalid number: ${col.COLUMN_NAME}`);
          } else if (val !== null && /DATE|TIMESTAMP/.test(col.DATA_TYPE)) {
            val = new Date(val);
            if (Number.isNaN(val.getTime()))
              throw new PlatformError(`Invalid date: ${col.COLUMN_NAME}`);
          } else if (val !== null) {
            if (typeof val !== "string")
              throw new PlatformError(`Invalid text: ${col.COLUMN_NAME}`);
            if (Buffer.byteLength(val, "utf8") > col.DATA_LENGTH)
              throw new PlatformError(`${col.COLUMN_NAME} is too long`);
          }
          values[col.COLUMN_NAME] = val;
        }
      }
      const fields = Object.keys(values);
      if (!remove && !fields.length)
        throw new PlatformError("No fields to save");
      fields.forEach((key, i) => {
        binds[`v${i}`] = values[key];
      });
      const system = cols.filter(
        (x) =>
          SYSTEM_FIELDS.test(x.COLUMN_NAME) &&
          (!rowid || /^(UPDATED|USER_DT)/.test(x.COLUMN_NAME)),
      );
      const expr = (name: string) =>
        /BY$|USER$/.test(name) ? ":auditActor" : "SYSTIMESTAMP";
      if (!remove && system.some((x) => expr(x.COLUMN_NAME) === ":auditActor"))
        binds.auditActor = actor;
      try {
        // Audit the intent before committing the tenant change, and the result afterwards.
        await this.audit(actor, tenantId, company, "ATTEMPT", table, {
          operation: remove ? "DELETE" : rowid ? "UPDATE" : "INSERT",
          rowid,
          fields,
        });
        let result: any;
        if (remove)
          result = await c.execute(
            `DELETE FROM ${owner}.${table} WHERE ${where}`,
            {
              rid: binds.rid,
              ...(binds.scopeCompany
                ? { scopeCompany: binds.scopeCompany }
                : {}),
            },
          );
        else if (rowid)
          result = await c.execute(
            `UPDATE ${owner}.${table} SET ${[
              ...fields.map((key, i) => `${key}=:v${i}`),
              ...system.map((x) => `${x.COLUMN_NAME}=${expr(x.COLUMN_NAME)}`),
            ].join(",")} WHERE ${where}`,
            binds,
          );
        else
          result = await c.execute(
            `INSERT INTO ${owner}.${table} (${[...fields, ...system.map((x) => x.COLUMN_NAME)].join(",")})
          VALUES (${[...fields.map((_, i) => `:v${i}`), ...system.map((x) => expr(x.COLUMN_NAME))].join(",")})`,
            binds,
          );
        if (result.rowsAffected !== 1)
          throw new PlatformError("Expected exactly one changed record");
        await this.audit(
          actor,
          tenantId,
          company,
          remove ? "DELETE" : rowid ? "UPDATE" : "INSERT",
          table,
          { rowid, fields },
          c,
        );
        await c.commit();
        return { changed: 1 };
      } catch (e) {
        await c.rollback();
        throw e;
      }
    });
  }
}
