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
const SECRETS = /(?:USERPASS|PASSWD|PASSWORD|(?:^|_)PWD(?:_|$)|SECRET|TOKEN)/;
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
export type PlatformAccess = {
  loginid: string;
  scope: "ALL" | "SCOPED";
  tenants: string[];
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
    await this.assertTenant(actor, tenantId);
    return this.provisionUserRecords(actor, tenantId, company, input, true);
  }

  static async provisionCompanyUser(actor: string, tenantId: string, company: string, input: any) {
    const { CompanySecurityService } = await import("./companySecurity.service");
    await CompanySecurityService.capability({ loginid: actor, tenantId, company_code: company }, ["sec_login"], "SNEW");
    return this.provisionUserRecords(actor, tenantId, company, input);
  }

  static async provisionRegistrationUser(c: oracledb.Connection, owner: string, tenant: string, company: string, input: any) {
    return this.provisionUserRecords('PUBLIC_REGISTRATION',tenant,company,input,true,{c,owner});
  }

  private static async provisionUserRecords(actor: string, tenantId: string, company: string, input: any, companyAdmin=false, transaction?: {c:oracledb.Connection;owner:string}) {
    if (tenantId === "root")
      throw new PlatformError("Select a tenant and company");
    const loginid = String(input.loginid || "").trim();
    const username = String(input.username || "").trim();
    const email = String(input.email || "").trim();
    const active = input.active === undefined ? "Y" : String(input.active).toUpperCase();
    if (!["Y", "N"].includes(active)) throw new PlatformError("Choose an active status");
    if (
      !/^[A-Za-z0-9_.-]{1,15}$/.test(loginid) ||
      !username ||
      username.length > 50 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      throw new PlatformError(
        "Provide a login (up to 15 characters), name and valid email",
      );
    if (typeof input.password !== "string" || (input.password.length < 8 || input.password.length > 20))
      throw new PlatformError("Password must contain 8 to 20 characters");
    if (await this.isAdmin(loginid))
      throw new PlatformError(
        "This login is reserved for a platform administrator",
        403,
      );
    const hash = await bcrypt.hash(input.password, 12);
    const provision = async (c: oracledb.Connection, owner: string) => {
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
          "SELECT 1 FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(TRIM(LOGINID))=LOWER(TRIM(:loginid)) OR LOWER(TRIM(EMAIL_ID))=LOWER(TRIM(:email))",
          { loginid, email },
          options,
        );
        if (existing.rows?.length)
          throw new PlatformError(
            "A central account already uses this login or email. Use central user mappings to link an existing account.",
          );
        const tenantExists = await c.execute(
          `SELECT 1 FROM ${owner}.SEC_LOGIN WHERE LOWER(TRIM(LOGINID))=LOWER(:loginid)`,
          { loginid },
          options,
        );
        if (tenantExists.rows?.length)
          throw new PlatformError(
            "This user already exists in the tenant. Edit and save that user to repair its central sign-in account instead of creating a duplicate.",
          );
        await c.execute(
          `INSERT INTO CUSTOMERS.SEC_LOGINTEST (COMPANY_CODE,LOGINID,USERNAME,EMAIL_ID,STATUS,ACTIVE_FLAG,ID,USERPASS,SEC_PASSWD,PASSWORD,USER_ID,USER_CODE,USERID,CREATED_BY,CREATED_AT)
          VALUES (:company,:loginid,:username,:email,'A',:active,(SELECT NVL(MAX(ID),0)+1 FROM CUSTOMERS.SEC_LOGINTEST),:hash,:hash,:hash,:loginid,:loginid,:loginid,:actor,SYSTIMESTAMP)`,
          { company, loginid, username, email, hash, actor, active },
        );
        const cols = await this.columns(c, owner, "SEC_LOGIN");
        const values: Record<string, any> = {
          COMPANY_CODE: company,
          LOGINID: loginid,
          USERNAME: username,
          EMAIL_ID: email,
          STATUS: "A",
          ACTIVE_FLAG: active,
          CONTACT_NO: input.contact || null,
          USERPASS: hash,
          SEC_PASSWD: hash,
          PASSWORD: hash,
          USER_ID: loginid,
          USER_CODE: loginid,
          USERID: loginid,
          CREATED_BY: actor,
          UPDATED_BY: actor,
          CREATED_AT: new Date(),
          UPDATED_AT: new Date(),
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
        const { seedDefaultMasterAccess } = await import("./defaultMasterAccess.service");
        const defaultMasters = transaction ? 0 : await seedDefaultMasterAccess(c, owner, tenantId, company, loginid);
        if (companyAdmin && !transaction) {
          const { seedCompanyAdminAccess } = await import('./defaultMasterAccess.service');
          await seedCompanyAdminAccess(c,owner,tenantId,company,loginid);
        }
        await this.audit(
          actor,
          tenantId,
          company,
          "ATTEMPT",
          "PROVISION_USER",
          { loginid }, c,
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
        if (!transaction) await c.commit();
        return { loginid, defaultMasters, warning: "MODULE_ASSIGNMENT_REQUIRED", message: "User created with view-only general masters across modules. Assign operational module and transaction permissions before use." };
      } catch (e) {
        await c.rollback();
        throw e;
      }
    };
    return transaction ? provision(transaction.c,transaction.owner) : this.scope(tenantId,provision);
  }

  static async userAccess(tenantId: string, company: string, loginid: string) {
    const users = await this.tenantQuery(
      tenantId,
      "SELECT LOGINID,USERNAME,ACTIVE_FLAG FROM #SCHEMA#.SEC_LOGIN WHERE COMPANY_CODE=:company ORDER BY LOGINID",
      { company },
    );
    const screens = await this.screenCatalog(tenantId, company);
    const access = loginid
      ? await this.tenantQuery(
          tenantId,
          "SELECT * FROM #SCHEMA#.SEC_ROLE_FUNCTION_ACCESS_USER WHERE COMPANY_CODE=:company AND LOGINID=:loginid",
          { company, loginid },
        )
      : [];
    const inherited = loginid ? await this.tenantQuery(tenantId,
      `SELECT DISTINCT a.SERIAL_NO FROM #SCHEMA#.SEC_ROLE_APP_ACCESS a
       JOIN #SCHEMA#.SEC_ROLE_FUNCTION_ACCESS_USER b ON a.ROLE_ID=b.SERIAL_NO_OR_ROLE_ID
       WHERE UPPER(TRIM(b.LOGINID))=UPPER(TRIM(:loginid))
       AND (b.COMPANY_CODE=:company OR b.COMPANY_CODE IS NULL)
       AND (a.COMPANY_CODE=:company OR a.COMPANY_CODE IS NULL)`, { company, loginid }) : [];
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
      inherited,
    };
  }

  static async syncCentralLogin(
    c: oracledb.Connection,
    owner: string,
    tenantId: string,
    company: string,
    actor: string,
    rowid: string,
    values: Record<string, any>,
    access: PlatformAccess,
  ) {
    const record = await c.execute<any>(
      `SELECT * FROM ${owner}.SEC_LOGIN WHERE ROWID=CHARTOROWID(:rid) AND COMPANY_CODE=:company`,
      { rid: rowid, company },
      options,
    );
    const user = record.rows?.[0];
    if (!user?.LOGINID)
      throw new PlatformError(
        "User login is required before the sign-in account can be synchronized",
      );
    const loginid = String(user.LOGINID).trim();
    const protectedAccount = await c.execute(
      "SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN WHERE LOWER(TRIM(LOGINID))=LOWER(:loginid)",
      { loginid },
      options,
    );
    if (protectedAccount.rows?.length)
      throw new PlatformError(
        "Platform administrator credentials cannot be changed through tenant users",
        403,
      );
    if (access.scope === "SCOPED") {
      const tenants = access.tenants.filter((t) => t !== "root");
      const outside = await c.execute(
        `SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING WHERE LOWER(TRIM(LOGINID))=LOWER(:loginid)
        AND TENANT_ID NOT IN (${tenants.map((_, i) => `:allowed${i}`).join(",") || "NULL"})`,
        {
          loginid,
          ...Object.fromEntries(tenants.map((t, i) => [`allowed${i}`, t])),
        },
        options,
      );
      if (outside.rows?.length)
        throw new PlatformError(
          "This central login is shared outside your QA tenants. A production administrator must update it.",
          403,
        );
    }
    await c.execute(
      "LOCK TABLE CUSTOMERS.SEC_LOGINTEST IN EXCLUSIVE MODE WAIT 5",
    );
    const roots = await c.execute<any>(
      "SELECT LOGINID FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(TRIM(LOGINID))=LOWER(:loginid)",
      { loginid },
      options,
    );
    if ((roots.rows?.length || 0) > 1)
      throw new PlatformError(
        "More than one central account matches this login. Contact the production administrator.",
      );
    const centralLogin = roots.rows?.[0]?.LOGINID || loginid;
    if (values.EMAIL_ID) {
      const duplicate = await c.execute(
        "SELECT 1 FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(TRIM(EMAIL_ID))=LOWER(TRIM(:email)) AND LOWER(TRIM(LOGINID))<>LOWER(:loginid)",
        { email: values.EMAIL_ID, loginid: centralLogin },
        options,
      );
      if (duplicate.rows?.length)
        throw new PlatformError(
          "Another central account already uses this email address",
        );
    }
    if (!roots.rows?.length) {
      const hash = [user.USERPASS, user.SEC_PASSWD, user.PASSWORD].find(
        (v) => typeof v === "string" && /^\$2[aby]\$\d{2}\$/.test(v),
      );
      if (!hash)
        throw new PlatformError(
          "Set a new password to create the missing central sign-in account",
        );
      await c.execute(
        `INSERT INTO CUSTOMERS.SEC_LOGINTEST
        (COMPANY_CODE,LOGINID,USERNAME,EMAIL_ID,STATUS,ACTIVE_FLAG,ID,USERPASS,SEC_PASSWD,PASSWORD,USER_ID,USER_CODE,USERID,CREATED_BY,CREATED_AT)
        VALUES (:company,:loginid,:username,:email,'A',:active,(SELECT NVL(MAX(ID),0)+1 FROM CUSTOMERS.SEC_LOGINTEST),:hash,:hash,:hash,:loginid,:loginid,:loginid,:actor,SYSTIMESTAMP)`,
        {
          company,
          loginid: centralLogin,
          username: user.USERNAME || loginid,
          email: user.EMAIL_ID || null,
          active: user.ACTIVE_FLAG || "Y",
          hash,
          actor,
        },
      );
    } else {
      const fields = ["USERNAME", "EMAIL_ID", "ACTIVE_FLAG"].filter((key) =>
        Object.prototype.hasOwnProperty.call(values, key),
      );
      if (values.USERPASS || values.SEC_PASSWD || values.PASSWORD)
        fields.push("USERPASS", "SEC_PASSWD", "PASSWORD");
      if (fields.length)
        await c.execute(
          `UPDATE CUSTOMERS.SEC_LOGINTEST SET ${fields.map((key, i) => `${key}=:value${i}`).join(",")},UPDATED_BY=:actor,UPDATED_AT=SYSTIMESTAMP WHERE LOGINID=:loginid`,
          {
            loginid: centralLogin,
            actor,
            ...Object.fromEntries(
              fields.map((key, i) => [`value${i}`, user[key] ?? null]),
            ),
          },
        );
    }
    const mapped = await c.execute(
      "SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING WHERE LOWER(TRIM(LOGINID))=LOWER(:loginid) AND TENANT_ID=:tenantId",
      { loginid: centralLogin, tenantId },
      options,
    );
    if (!mapped.rows?.length) {
      await c.execute(
        "LOCK TABLE CUSTOMERS.USER_TENANT_MAPPING IN EXCLUSIVE MODE WAIT 5",
      );
      const defaultMapping = await c.execute(
        "SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING WHERE LOWER(TRIM(LOGINID))=LOWER(:loginid) AND IS_DEFAULT='Y'",
        { loginid: centralLogin },
        options,
      );
      await c.execute(
        `INSERT INTO CUSTOMERS.USER_TENANT_MAPPING (USER_MAP_ID,LOGINID,TENANT_ID,IS_DEFAULT,CREATED_DATE)
        VALUES ((SELECT NVL(MAX(USER_MAP_ID),0)+1 FROM CUSTOMERS.USER_TENANT_MAPPING),:loginid,:tenantId,:isDefault,SYSDATE)`,
        {
          loginid: centralLogin,
          tenantId,
          isDefault: defaultMapping.rows?.length ? "N" : "Y",
        },
      );
    }
  }

  static async grant(
    actor: string,
    tenantId: string,
    company: string,
    input: any,
  ) {
    await this.assertTenant(actor, tenantId);
    if (
      !input.loginid ||
      !Array.isArray(input.serials) ||
      !input.serials.length ||
      input.serials.length > 5000 ||
      input.serials.some((n: any) => !Number.isSafeInteger(n) || n <= 0) ||
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
        const serials = [...new Set<number>(input.serials)];
        if (!input.enabled) {
          // Detach only this user's affected role memberships. Preserve their
          // other role permissions as direct grants before removing membership.
          await c.execute(`LOCK TABLE ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER IN SHARE ROW EXCLUSIVE MODE`);
          await c.execute(`LOCK TABLE ${owner}.SEC_ROLE_APP_ACCESS IN SHARE MODE`);
          const memberships = await c.execute<any>(
            `SELECT * FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER WHERE UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid)) AND (COMPANY_CODE=:company OR COMPANY_CODE IS NULL)`,
            { loginid: input.loginid, company }, options);
          const roleRows = await c.execute<any>(
            `SELECT * FROM ${owner}.SEC_ROLE_APP_ACCESS WHERE COMPANY_CODE=:company OR COMPANY_CODE IS NULL`, { company }, options);
          const selected = new Set(serials);
          const impacted = new Set((roleRows.rows || []).filter((r: any) => selected.has(Number(r.SERIAL_NO))).map((r: any) => Number(r.ROLE_ID)));
          const detach = (memberships.rows || []).filter((r: any) => impacted.has(Number(r.SERIAL_NO_OR_ROLE_ID)));
          if ((memberships.rows || []).some((r: any) => !r.COMPANY_CODE && (selected.has(Number(r.SERIAL_NO_OR_ROLE_ID)) || impacted.has(Number(r.SERIAL_NO_OR_ROLE_ID)))))
            throw new PlatformError("This user has shared company access. Assign company-specific permissions before removing these screens.");
          const detachedIds = new Set(detach.map((r: any) => Number(r.SERIAL_NO_OR_ROLE_ID)));
          const flags = ["SNEW","SMODIFY","SDELETE","SSAVE","SSEARCH","SSAVEAS","SUPLOAD","SUNDO","SPRINT","SPRINTSETUP","SHELP"];
          const preserve = new Map<number, any>();
          for (const r of roleRows.rows || []) {
            const serial = Number(r.SERIAL_NO);
            if (!detachedIds.has(Number(r.ROLE_ID)) || selected.has(serial)) continue;
            const values = preserve.get(serial) || Object.fromEntries(flags.map((f) => [f, "N"]));
            for (const f of flags) if (String(r[f]).toUpperCase() === "Y") values[f] = "Y";
            preserve.set(serial, values);
          }
          for (const [serial, values] of preserve) {
            await c.execute(`MERGE INTO ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER t USING (SELECT :company COMPANY_CODE,:loginid LOGINID,:serial SERIAL_NO_OR_ROLE_ID FROM DUAL) s
              ON (t.COMPANY_CODE=s.COMPANY_CODE AND t.LOGINID=s.LOGINID AND t.SERIAL_NO_OR_ROLE_ID=s.SERIAL_NO_OR_ROLE_ID)
              WHEN MATCHED THEN UPDATE SET ${flags.map((f) => `t.${f}=CASE WHEN UPPER(t.${f})='Y' OR :${f}='Y' THEN 'Y' ELSE 'N' END`).join(",")}
              WHEN NOT MATCHED THEN INSERT (COMPANY_CODE,LOGINID,SERIAL_NO_OR_ROLE_ID,${flags.join(",")},USERID)
              VALUES (:company,:loginid,:serial,${flags.map((f) => ":"+f).join(",")},:actor)`,
              { company, loginid: input.loginid, serial, ...values, actor });
          }
          await c.executeMany(
            `DELETE FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER WHERE COMPANY_CODE=:company AND UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid)) AND SERIAL_NO_OR_ROLE_ID=:serial`,
            [...new Set([...serials, ...detachedIds])].map((serial) => ({ company, loginid: input.loginid, serial })));
        }
        else
          await c.executeMany(
            `MERGE INTO ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER t USING (SELECT :company COMPANY_CODE,:loginid LOGINID,:serial SERIAL_NO_OR_ROLE_ID FROM DUAL) s
            ON (t.COMPANY_CODE=s.COMPANY_CODE AND t.LOGINID=s.LOGINID AND t.SERIAL_NO_OR_ROLE_ID=s.SERIAL_NO_OR_ROLE_ID)
            WHEN MATCHED THEN UPDATE SET SNEW='Y',SMODIFY='Y',SDELETE='Y',SSAVE='Y',SSEARCH='Y',SSAVEAS='Y',SUPLOAD='Y',SUNDO='Y',SPRINT='Y',SPRINTSETUP='Y',SHELP='Y',USERID=:actor
            WHEN NOT MATCHED THEN INSERT (COMPANY_CODE,LOGINID,SERIAL_NO_OR_ROLE_ID,SNEW,SMODIFY,SDELETE,SSAVE,SSEARCH,SSAVEAS,SUPLOAD,SUNDO,SPRINT,SPRINTSETUP,SHELP,USERID)
            VALUES (:company,:loginid,:serial,'Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y',:actor)`,
            serials.map((serial) => ({
              company,
              loginid: input.loginid,
              serial,
              actor,
            })),
          );
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
        return { changed: serials.length };
      } catch (e) {
        await c.rollback();
        throw e;
      }
    });
  }
  static async isAdmin(loginid: string): Promise<boolean> {
    return Boolean(await this.getAccess(loginid));
  }

  static async getAccess(loginid: string): Promise<PlatformAccess | null> {
    const r = await oracleDb.query(
      `SELECT a.LOGINID,a.ADMIN_SCOPE,t.TENANT_ID FROM CUSTOMERS.SEC_PLATFORM_ADMIN a
      JOIN CUSTOMERS.SEC_LOGINTEST u ON u.LOGINID = a.LOGINID
      LEFT JOIN CUSTOMERS.SEC_PLATFORM_ADMIN_TENANT t ON t.LOGINID=a.LOGINID
      WHERE a.LOGINID = :loginid AND a.IS_ACTIVE = 'Y' AND u.ACTIVE_FLAG = 'Y'`,
      { loginid },
    );
    if (!r.rows?.length) return null;
    const scope = r.rows[0].ADMIN_SCOPE === "SCOPED" ? "SCOPED" : "ALL";
    return {
      loginid,
      scope,
      tenants:
        scope === "ALL"
          ? []
          : r.rows.map((r: any) => r.TENANT_ID).filter(Boolean),
    };
  }

  static async assertTenant(actor: string, tenantId: string) {
    const access = await this.getAccess(actor);
    if (
      !access ||
      (access.scope === "SCOPED" && !access.tenants.includes(tenantId))
    )
      throw new PlatformError(
        "Your account does not have access to this tenant",
        403,
      );
    return access;
  }

  static centralFilter(table: string, access: PlatformAccess | null) {
    if (!access || access.scope === "ALL") return { sql: "", binds: {} };
    const tenants = access.tenants.filter((t) => t !== "root");
    const binds = Object.fromEntries(tenants.map((t, i) => [`scope${i}`, t]));
    const list = tenants.map((_, i) => `:scope${i}`).join(",") || "NULL";
    const userFilter = `EXISTS (SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING m WHERE m.LOGINID=${table}.LOGINID AND m.TENANT_ID IN (${list}))
      AND NOT EXISTS (SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING m WHERE m.LOGINID=${table}.LOGINID AND m.TENANT_ID NOT IN (${list}))
      AND NOT EXISTS (SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN p WHERE p.LOGINID=${table}.LOGINID)`;
    return {
      sql: table === "SEC_LOGINTEST" ? userFilter : `TENANT_ID IN (${list})`,
      binds,
    };
  }

  static async screenCatalog(tenantId: string, company = "") {
    return this.scope(tenantId, async (c, owner) => {
      const cols = await this.columns(c, owner, "SEC_MODULE_DATA");
      const names = new Set(cols.map((x) => x.COLUMN_NAME));
      const select = [
        "SERIAL_NO",
        "APP_CODE",
        "LEVEL1",
        "LEVEL2",
        "LEVEL3",
        "URL_PATH",
      ]
        .map((name) =>
          names.has(name) ? name : `CAST(NULL AS VARCHAR2(100)) AS ${name}`,
        )
        .join(",");
      const active = names.has("IS_ACTIVE")
        ? " AND NVL(IS_ACTIVE,'Y')='Y'"
        : "";
      const preference = names.has("COMPANY_CODE") && company
        ? "CASE WHEN COMPANY_CODE=:company THEN 0 WHEN COMPANY_CODE IS NULL THEN 1 ELSE 2 END,"
        : "";
      const r = await c.execute<any>(
        `SELECT ${select} FROM ${owner}.SEC_MODULE_DATA WHERE SERIAL_NO>0 ${active} ORDER BY ${preference} APP_CODE,SERIAL_NO,LEVEL1,LEVEL2,LEVEL3`,
        preference ? { company } : {},
        options,
      );
      const unique = new Map<number, any>();
      for (const row of r.rows || []) {
        for (const key of ["LEVEL1", "LEVEL2", "LEVEL3"])
          if (String(row[key] ?? "").trim().toUpperCase() === "NULL") row[key] = null;
        if (!unique.has(Number(row.SERIAL_NO))) unique.set(Number(row.SERIAL_NO), row);
      }
      return [...unique.values()];
    });
  }

  static generatedColumn(table: string, column: Column) {
    return (
      column.IDENTITY_COLUMN === "YES" ||
      ["ID", "USER_MAP_ID"].includes(column.COLUMN_NAME) ||
      (table === "SEC_MODULE_DATA" && column.COLUMN_NAME === "SERIAL_NO") ||
      (table === "SEC_ROLE_MASTER" && column.COLUMN_NAME === "ROLE_ID")
    );
  }

  static async auditTrail(actor: string) {
    const access = await this.getAccess(actor);
    if (!access) throw new PlatformError("Platform access is required", 403);
    const restricted = access.scope === "SCOPED";
    return this.root(
      async (c) =>
        (
          await c.execute(
            `SELECT AUDIT_ID,ACTOR,TENANT_ID,COMPANY_CODE,ACTION,RESOURCE_NAME,DETAILS,CREATED_AT
      FROM CUSTOMERS.SEC_PLATFORM_AUDIT ${restricted ? "WHERE TENANT_ID='WMSTST_TENANT' OR ACTOR=:actor" : ""}
      ORDER BY AUDIT_ID DESC FETCH FIRST 100 ROWS ONLY`,
            restricted ? { actor } : {},
            options,
          )
        ).rows || [],
    );
  }

  static async moduleEditorRows(actor: string, tenantId: string) {
    await this.assertTenant(actor, tenantId);
    if(tenantId==='root')throw new PlatformError('Select a tenant to maintain module screens');
    return this.scope(tenantId,async(c,owner)=>{
      const columns=await this.columns(c,owner,'SEC_MODULE_DATA');
      const fields=['SERIAL_NO','APP_CODE','LEVEL1','LEVEL2','LEVEL3','URL_PATH','ICON','POSITION','COMPANY_CODE','IS_ACTIVE'].filter(name=>columns.some(col=>col.COLUMN_NAME===name));
      if(!fields.length)throw new PlatformError('Module screens are unavailable in this tenant',404);
      const order=['APP_CODE','POSITION','SERIAL_NO'].filter(name=>fields.includes(name));
      return (await c.execute<any>(`SELECT ${fields.join(',')} FROM ${owner}.SEC_MODULE_DATA ${order.length?'ORDER BY '+order.join(','):''} FETCH FIRST 10000 ROWS ONLY`,{},options)).rows||[];
    });
  }

  static async editorOptions(tenantId: string, company: string, actor: string) {
    const access = await this.assertTenant(actor, tenantId);
    return this.scope(tenantId, async (c, owner) => {
      const result: Record<
        string,
        Array<{ value: string; label: string }>
      > = {};
      const meta = await c.execute<any>(
        `SELECT TABLE_NAME,COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER=:owner
        AND TABLE_NAME IN ('MS_COMPANY','SEC_LOGIN','SEC_LOGINTEST','SEC_ROLE_MASTER','MS_PS_ROLE','MS_PS_PROJECT_MASTER','MS_HR_DIVISION','MS_PS_FLOW_MASTER','MS_CURRENCY','MS_COUNTRY','MS_COUNTRY_MASTER')`,
        { owner },
        options,
      );
      const available = new Map<string, Set<string>>();
      for (const row of meta.rows || []) {
        if (!available.has(row.TABLE_NAME))
          available.set(row.TABLE_NAME, new Set());
        available.get(row.TABLE_NAME)!.add(row.COLUMN_NAME);
      }
      const read = async (
        table: string,
        key: string,
        names: string[],
        filterCompany = true,
      ) => {
        const columns = available.get(table);
        if (!columns?.has(key)) return [];
        const description = names.find((n) => columns.has(n));
        const clauses: string[] = [];
        const binds: any = {};
        if (company && filterCompany && columns.has("COMPANY_CODE")) {
          clauses.push("COMPANY_CODE=:company");
          binds.company = company;
        }
        if (tenantId === "root" && table === "SEC_LOGINTEST") {
          const filter = this.centralFilter(table, access);
          if (filter.sql) {
            clauses.push(filter.sql);
            Object.assign(binds, filter.binds);
          }
        }
        const rows = await c.execute<any>(
          `SELECT DISTINCT ${key} AS VALUE,${description || key} AS LABEL FROM ${owner}.${table}
          ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY VALUE FETCH FIRST 3000 ROWS ONLY`,
          binds,
          options,
        );
        return (rows.rows || [])
          .filter((r) => r.VALUE != null)
          .map((r) => ({
            value: String(r.VALUE),
            label:
              r.LABEL && String(r.LABEL) !== String(r.VALUE)
                ? `${r.VALUE} · ${r.LABEL}`
                : String(r.VALUE),
          }));
      };
      result.COMPANY_CODE = await read(
        "MS_COMPANY",
        "COMPANY_CODE",
        ["COMPANY_NAME"],
        false,
      );
      result.LOGINID = await read(
        tenantId === "root" ? "SEC_LOGINTEST" : "SEC_LOGIN",
        "LOGINID",
        ["USERNAME"],
      );
      result.USER_ID = result.LOGINID;
      result.ROLE_ID = await read("SEC_ROLE_MASTER", "ROLE_ID", [
        "ROLE_DESC",
        "ROLE_DESCRIPTION",
      ]);
      result.PROJECT_ROLE_ID = await read("MS_PS_ROLE", "ROLE_ID", [
        "ROLE_NAME",
        "ROLE_DESCRIPTION",
        "ROLE_DESC",
      ]);
      result.PROJECT_CODE = await read("MS_PS_PROJECT_MASTER", "PROJECT_CODE", [
        "PROJECT_NAME",
        "PROJECT_DESCRIPTION",
      ]);
      result.DIV_CODE = await read("MS_HR_DIVISION", "DIV_CODE", [
        "DIV_NAME",
        "DIVISION_NAME",
      ]);
      result.FLOW_CODE = await read("MS_PS_FLOW_MASTER", "FLOW_CODE", [
        "FLOW_DESCRIPTION",
      ]);
      result.CURR_CODE = await read(
        "MS_CURRENCY",
        "CURR_CODE",
        ["CURR_NAME", "CURR_DESCRIPTION"],
        false,
      );
      result.COUNTRY = await read(
        available.has("MS_COUNTRY") ? "MS_COUNTRY" : "MS_COUNTRY_MASTER",
        "COUNTRY_CODE",
        ["COUNTRY_NAME"],
        false,
      );
      result.COUNTRY_CODE = result.COUNTRY;
      if (tenantId !== "root") {
        const screens = await this.screenCatalog(tenantId, company);
        result.SERIAL_NO = screens.map((s) => ({
          value: String(s.SERIAL_NO),
          label: `${s.SERIAL_NO} · ${s.APP_CODE || ""} / ${[s.LEVEL1, s.LEVEL2, s.LEVEL3].filter(Boolean).join(" / ")}`,
        }));
        result.SERIAL_NO_OR_ROLE_ID = [
          ...result.SERIAL_NO.map((s) => ({
            ...s,
            label: "Screen " + s.label,
          })),
          ...result.ROLE_ID.map((r) => ({ ...r, label: "Role " + r.label })),
        ];
      }
      result.TENANT_ID = (await this.tenants(actor)).map((t: any) => ({
        value: t.TENANT_ID,
        label: `${t.TENANT_NAME} · ${t.SCHEMA_NAME}`,
      }));
      return result;
    });
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

  static async tenants(actor?: string) {
    const access = actor ? await this.getAccess(actor) : null;
    const filter = this.centralFilter("TENANT_REGISTRY", access);
    return this.root(
      async (c) =>
        (
          await c.execute(
            `SELECT TENANT_ID,TENANT_NAME,SCHEMA_NAME,COMPANY_CODE,IS_ACTIVE
      FROM CUSTOMERS.TENANT_REGISTRY ${filter.sql ? "WHERE " + filter.sql : ""} ORDER BY TENANT_NAME`,
            filter.binds,
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

  static async catalog(tenantId: string, actor?: string) {
    const access = actor ? await this.assertTenant(actor, tenantId) : null;
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
          .map(([name, label]) => ({
            name,
            label,
            readonly:
              tenantId === "root" &&
              name === "TENANT_REGISTRY" &&
              access?.scope === "SCOPED",
          })),
      };
    });
  }

  static validateTable(table: string, allowed: Record<string, string>) {
    if (!Object.prototype.hasOwnProperty.call(allowed, table))
      throw new PlatformError("Security resource is not allowed", 403);
  }

  static async companyCodeLimit(c: oracledb.Connection, owner: string) {
    const r = await c.execute<{ MAX_LENGTH: number }>(
      `SELECT MIN(DATA_LENGTH) AS MAX_LENGTH FROM ALL_TAB_COLUMNS
       WHERE OWNER=:owner AND COLUMN_NAME='COMPANY_CODE'
         AND TABLE_NAME IN ('MS_COMPANY','MS_PS_FLOW_MASTER','MS_AC_L1','MS_AC_L2','MS_AC_L3','MS_AC_L4')
         AND DATA_TYPE IN ('VARCHAR2','CHAR')`,
      { owner },
      options,
    );
    return r.rows?.[0]?.MAX_LENGTH;
  }

  static async records(
    tenantId: string,
    table: string,
    company: string,
    page = 1,
    search = "",
    actor?: string,
  ) {
    const access = actor ? await this.assertTenant(actor, tenantId) : null;
    return this.scope(tenantId, async (c, owner, allowed) => {
      this.validateTable(table, allowed);
      const cols = await this.columns(c, owner, table);
      if (!cols.length)
        throw new PlatformError("Resource is unavailable in this tenant", 404);
      const companyCodeLimit =
        table === "MS_COMPANY"
          ? await this.companyCodeLimit(c, owner)
          : undefined;
      const visible = cols.filter((x) => !SECRETS.test(x.COLUMN_NAME));
      const binds: any = {};
      const clauses: string[] = [];
      if (tenantId === "root") {
        const filter = this.centralFilter(table, access);
        if (filter.sql) {
          clauses.push(filter.sql);
          Object.assign(binds, filter.binds);
        }
      }
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
          required: x.NULLABLE === "N" || (["SEC_LOGIN", "SEC_LOGINTEST"].includes(table) && ["LOGINID", "USERNAME", "EMAIL_ID"].includes(x.COLUMN_NAME)) || (table === "MS_COMPANY" && ["COMPANY_CODE","COMPANY_NAME"].includes(x.COLUMN_NAME)),
          secret: SECRETS.test(x.COLUMN_NAME),
          readonly:
            SYSTEM_FIELDS.test(x.COLUMN_NAME) || x.IDENTITY_COLUMN === "YES",
          maxLength: /CHAR/.test(x.DATA_TYPE)
            ? x.COLUMN_NAME === "COMPANY_CODE" && companyCodeLimit
              ? Math.min(x.DATA_LENGTH, companyCodeLimit)
              : x.DATA_LENGTH
            : undefined,
          generated: this.generatedColumn(table, x),
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
    const access = await this.assertTenant(actor, tenantId);
    if(table==='MS_COMPANY'&&remove)throw new PlatformError('Use the company deletion preview to remove a company and its related data',409);
    if (table === "SEC_LOGIN" && !payload.rowid && !remove) {
      const v = payload.values || {};
      const result = await this.provisionUser(actor, tenantId, company, {
        loginid: v.LOGINID,
        username: v.USERNAME,
        email: v.EMAIL_ID,
        password: v.USERPASS || v.SEC_PASSWD || v.PASSWORD,
      });
      return { changed: 1, ...result };
    }
    if (
      tenantId === "root" &&
      access.scope === "SCOPED" &&
      table === "TENANT_REGISTRY"
    )
      throw new PlatformError(
        "Tenant connection settings are managed by the production administrator",
        403,
      );
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
      if (tenantId === "root") {
        const filter = this.centralFilter(table, access);
        if (filter.sql) {
          where += ` AND ${filter.sql}`;
          Object.assign(binds, filter.binds);
        }
      }
      if (rowid) {
        if (typeof rowid !== "string" || !/^[A-Za-z0-9+/]{18}$/.test(rowid))
          throw new PlatformError("Invalid record identifier");
        // Match provisioning's lock order: central login before tenant user.
        if (table === "SEC_LOGIN" && !remove)
          await c.execute(
            "LOCK TABLE CUSTOMERS.SEC_LOGINTEST IN EXCLUSIVE MODE WAIT 5",
          );
        binds.rid = rowid;
        if (company && hasCompany) {
          where += " AND COMPANY_CODE=:scopeCompany";
          binds.scopeCompany = company;
        }
        const old = await c.execute<any>(
          `SELECT ${["SEC_LOGINTEST", "SEC_LOGIN"].includes(table) ? "LOGINID" : "1 AS FOUND"} FROM ${owner}.${table} WHERE ${where}`,
          binds,
          options,
        );
        if (!old.rows?.length)
          throw new PlatformError("Record no longer exists in this scope", 404);
        if (
          ["SEC_LOGIN", "SEC_LOGINTEST"].includes(table) &&
          payload.values?.LOGINID &&
          payload.values.LOGINID !== old.rows[0].LOGINID
        )
          throw new PlatformError(
            "Login IDs cannot be renamed here because they link the central and tenant accounts",
          );
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
      if (table === "MS_COMPANY" && !remove) {
        if (
          !rowid &&
          (!String(values.COMPANY_CODE || "").trim() ||
            !String(values.COMPANY_NAME || "").trim())
        )
          throw new PlatformError("Company code and company name are required");
        if (!rowid) {
          values.COMPANY_CODE = String(values.COMPANY_CODE).trim();
          const limit = await this.companyCodeLimit(c, owner);
          if (limit && Buffer.byteLength(values.COMPANY_CODE, "utf8") > limit)
            throw new PlatformError(
              `Company code is too long. Use at most ${limit} characters to match the company setup tables.`,
            );
          await c.execute(
            `LOCK TABLE ${owner}.MS_COMPANY IN EXCLUSIVE MODE WAIT 5`,
          );
          const duplicate = await c.execute(
            `SELECT 1 FROM ${owner}.MS_COMPANY WHERE UPPER(TRIM(COMPANY_CODE))=UPPER(:code)`,
            { code: values.COMPANY_CODE },
            options,
          );
          if (duplicate.rows?.length)
            throw new PlatformError(
              "This company code already exists. Choose a unique company code.",
            );
        }
      }
      if (tenantId === "root" && access.scope === "SCOPED") {
        if (table === "SEC_LOGINTEST") {
          if (!rowid)
            throw new PlatformError(
              "Select WMSTST and use Create user to create a central and tenant account together",
            );
          if (values.LOGINID) {
            const original = await c.execute<any>(
              `SELECT LOGINID FROM CUSTOMERS.SEC_LOGINTEST WHERE ${where}`,
              binds,
              options,
            );
            if (original.rows?.[0]?.LOGINID !== values.LOGINID)
              throw new PlatformError(
                "Login IDs cannot be renamed by this account",
                403,
              );
          }
        }
        if (table === "USER_TENANT_MAPPING" && !remove) {
          if (!access.tenants.includes(String(values.TENANT_ID)))
            throw new PlatformError(
              "Mapping is outside your allowed tenants",
              403,
            );
          const outside = await c.execute(
            `SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING WHERE LOGINID=:id AND TENANT_ID<>'WMSTST_TENANT'
            UNION ALL SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN WHERE LOGINID=:id`,
            { id: values.LOGINID },
            options,
          );
          if (outside.rows?.length)
            throw new PlatformError(
              "This account is managed outside your QA scope",
              403,
            );
        }
      }
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
      if(table==='SEC_MODULE_DATA'&&!remove){
        for(const key of ['APP_CODE','LEVEL1','LEVEL2','LEVEL3','ICON','URL_PATH'])if(key in values)values[key]=String(values[key]??'').trim();
        if(!values.APP_CODE||!values.LEVEL1)throw new PlatformError('Choose App Code and Level 1 for this screen');
        if(!Number.isInteger(Number(values.POSITION))||Number(values.POSITION)<1)throw new PlatformError('Position must be a whole number of at least 1');
        if(!values.URL_PATH)values.URL_PATH=[values.APP_CODE,values.LEVEL1,values.LEVEL2,values.LEVEL3].filter(Boolean).join('/').toLowerCase();
      }
      // IDs on older schemas have no sequence/default. Hold the table lock until commit.
      if (!rowid && !remove) {
        for (const col of cols.filter(
          (x) => this.generatedColumn(table, x) && x.IDENTITY_COLUMN !== "YES",
        )) {
          if (!values[col.COLUMN_NAME]) {
            await c.execute(
              `LOCK TABLE ${owner}.${table} IN EXCLUSIVE MODE WAIT 5`,
            );
            const id = await c.execute<any>(
              `SELECT GREATEST(NVL(MAX(${col.COLUMN_NAME}),0),${table === "SEC_ROLE_MASTER" ? 90000 : 0})+1 AS ID FROM ${owner}.${table}`,
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
        if ((String(password).length < 8 || String(password).length > 20))
          throw new PlatformError(
            "Password must contain 8 to 20 characters",
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
              ...Object.fromEntries(
                Object.entries(binds).filter(
                  ([key]) => key === "rid" || key.startsWith("scope"),
                ),
              ),
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
        if (table === "SEC_LOGIN" && rowid && !remove)
          await this.syncCentralLogin(
            c,
            owner,
            tenantId,
            company,
            actor,
            rowid,
            values,
            access,
          );
        if (table === "MS_COMPANY" && !remove && !rowid && values.COMPANY_CODE) {
          try {
            console.log(`[PlatformAdmin] Auto-provisioning Finance setup for new company '${values.COMPANY_CODE}' in ${owner}`);
            await c.execute(
              `BEGIN ${owner}.PROC_INITIALIZE_COMPANY_FINANCE_SETUP(p_new_company=>:code, p_source_company=>NULL, p_currency=>:currency, p_loginid=>:actor, p_status=>:status, p_message=>:msg); END;`,
              {
                code: String(values.COMPANY_CODE).trim(),
                currency: values.CURR_CODE ? String(values.CURR_CODE).trim() : null,
                actor: actor || "ADMIN",
                status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
                msg: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
              }
            );
          } catch (finErr: any) {
            console.warn(`[PlatformAdmin] Finance auto-provision notice for '${values.COMPANY_CODE}':`, finErr.message);
          }
        }
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
