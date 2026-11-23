import { PlatformAdminService, PlatformError } from "./platformAdmin.service";
import bcrypt from "bcrypt";
import oracledb from "oracledb";
import { CompanyBillingService } from "./companyBilling.service";
import { isGeneralMaster } from "./defaultMasterAccess.service";

const flags = ["SNEW", "SMODIFY", "SDELETE", "SSAVE", "SSEARCH", "SSAVEAS", "SUPLOAD", "SUNDO", "SPRINT", "SPRINTSETUP", "SHELP"];
export type CompanyActor = { loginid: string; tenantId: string; company_code: string };

// A tenant administrator may delegate only permissions they currently hold.
// Resolve from the database on every request, never from a browser-supplied list.
export class CompanySecurityService {
  static async updateUser(actor: CompanyActor, input: any) {
    const actorPolicy = await this.capability(actor, ["sec_login"], "SMODIFY");
    await this.targetUser(actor, input.loginid);
    const targetPolicy = await this.policy({ ...actor, loginid: input.loginid }, false);
    for (const [serial, grant] of targetPolicy.permissions) for (const flag of flags)
      if (grant[flag] === "Y" && actorPolicy.permissions.get(serial)?.[flag] !== "Y" && !(flag === "SSEARCH" && isGeneralMaster(targetPolicy.screens.find(s => Number(s.SERIAL_NO) === serial) || {})))
        throw new PlatformError("This user has broader access. A platform administrator must edit their sign-in account.", 403);
    const values: Record<string, any> = {};
    for (const key of ["username", "email_id", "contact_no", "active_flag"])
      if (Object.prototype.hasOwnProperty.call(input, key)) values[key.toUpperCase()] = input[key];
    if (input.userpass) {
      if (typeof input.userpass !== "string" || input.userpass.length < 12) throw new PlatformError("Password must contain at least 12 characters");
      const hash = await bcrypt.hash(input.userpass, 12);
      for (const key of ["USERPASS", "SEC_PASSWD", "PASSWORD"]) values[key] = hash;
    }
    return PlatformAdminService.scope(actor.tenantId, async (c, owner) => {
      try {
        await c.execute("LOCK TABLE CUSTOMERS.SEC_LOGINTEST IN EXCLUSIVE MODE WAIT 5");
        const shared = await c.execute(`SELECT 1 FROM ${owner}.SEC_LOGIN WHERE LOWER(TRIM(LOGINID))=LOWER(TRIM(:loginid)) AND COMPANY_CODE<>:company`, { loginid: input.loginid, company: actor.company_code });
        if (shared.rows?.length) throw new PlatformError("Shared accounts must be edited by a platform administrator", 403);
        const record = await c.execute<any>(`SELECT ROWIDTOCHAR(ROWID) RID FROM ${owner}.SEC_LOGIN WHERE ID=:id AND LOGINID=:loginid AND COMPANY_CODE=:company FOR UPDATE`,
          { id: input.id, loginid: input.loginid, company: actor.company_code }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        if (record.rows?.length !== 1) throw new PlatformError("Company user was not found", 404);
        const cols = await PlatformAdminService.columns(c, owner, "SEC_LOGIN");
        const keys = Object.keys(values).filter(key => cols.some(col => col.COLUMN_NAME === key));
        if (!keys.length) { await c.rollback(); return true; }
        await c.execute(`UPDATE ${owner}.SEC_LOGIN SET ${keys.map((key, i) => `${key}=:v${i}`).join(",")} WHERE ROWID=CHARTOROWID(:rid)`,
          { rid: record.rows[0].RID, ...Object.fromEntries(keys.map((key, i) => [`v${i}`, values[key]])) });
        await PlatformAdminService.syncCentralLogin(c, owner, actor.tenantId, actor.company_code, actor.loginid, record.rows[0].RID, values,
          { loginid: actor.loginid, scope: "SCOPED", tenants: [actor.tenantId] });
        await PlatformAdminService.audit(actor.loginid, actor.tenantId, actor.company_code, "UPDATE", "COMPANY_USER", { loginid: input.loginid, fields: keys }, c);
        await c.commit(); return true;
      } catch (e) { await c.rollback(); throw e; }
    });
  }
  static async policy(actor: CompanyActor, requireActive = true) {
    if (!actor.loginid || !actor.tenantId || !actor.company_code)
      throw new PlatformError("Sign in to a tenant company first", 403);
    const catalog = await PlatformAdminService.screenCatalog(actor.tenantId, actor.company_code);
    const billingBlocked = await CompanyBillingService.blockedSerials(actor.tenantId, actor.company_code);
    return PlatformAdminService.scope(actor.tenantId, async (c, owner) => {
      const binds = { loginid: actor.loginid, company: actor.company_code };
      const active = await c.execute(`SELECT 1 FROM ${owner}.SEC_LOGIN WHERE UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid)) AND COMPANY_CODE=:company ${requireActive ? "AND NVL(ACTIVE_FLAG,'Y')='Y'" : ""}`, binds);
      if (!active.rows?.length) throw new PlatformError("Your company account is unavailable", 403);
      const r = await c.execute<any>(`SELECT a.SERIAL_NO,${flags.map(f => "a." + f).join(",")} FROM ${owner}.SEC_ROLE_APP_ACCESS a
        JOIN ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER b ON a.ROLE_ID=b.SERIAL_NO_OR_ROLE_ID
        WHERE UPPER(TRIM(b.LOGINID))=UPPER(TRIM(:loginid)) AND (b.COMPANY_CODE=:company OR b.COMPANY_CODE IS NULL)
        AND (a.COMPANY_CODE=:company OR a.COMPANY_CODE IS NULL)
        UNION ALL SELECT SERIAL_NO_OR_ROLE_ID SERIAL_NO,${flags.join(",")} FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER
        WHERE UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid)) AND (COMPANY_CODE=:company OR COMPANY_CODE IS NULL) AND SERIAL_NO_OR_ROLE_ID<90001`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const denied = await c.execute<any>(`SELECT SERIAL_NO FROM CUSTOMERS.SEC_COMPANY_SCREEN_ACCESS WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND IS_ENABLED='N'`, { tenant: actor.tenantId, company: actor.company_code }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const disabled = new Set((denied.rows || []).map(r => Number(r.SERIAL_NO)));
      billingBlocked.forEach(serial => disabled.add(serial));
      const permissions = new Map<number, Record<string, string>>();
      for (const row of r.rows || []) {
        const serial = Number(row.SERIAL_NO);
        if (disabled.has(serial)) continue;
        const value = permissions.get(serial) || Object.fromEntries(flags.map(f => [f, "N"]));
        for (const f of flags) if (String(row[f]).toUpperCase() === "Y") value[f] = "Y";
        permissions.set(serial, value);
      }
      return { permissions, screens: catalog.filter(s => permissions.has(Number(s.SERIAL_NO))) };
    });
  }

  static async capability(actor: CompanyActor, routes: string[], action?: string) {
    const policy = await this.policy(actor);
    const allowed = policy.screens.some(s => routes.some(route => String(s.URL_PATH || "").toLowerCase().endsWith("/" + route)) &&
      (!action || policy.permissions.get(Number(s.SERIAL_NO))?.[action] === "Y"));
    if (!allowed) throw new PlatformError("Your assigned screens do not allow this security operation", 403);
    return policy;
  }

  static async targetUser(actor: CompanyActor, loginid: string) {
    if (!loginid) throw new PlatformError("Select a company user");
    await PlatformAdminService.scope(actor.tenantId, async (c, owner) => {
      const r = await c.execute(`SELECT 1 FROM ${owner}.SEC_LOGIN WHERE COMPANY_CODE=:company AND UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid))`, { company: actor.company_code, loginid });
      if (!r.rows?.length || await PlatformAdminService.isAdmin(loginid)) throw new PlatformError("Select a user in your own company", 403);
    });
  }

  static async assignment(actor: CompanyActor, row: any, roleMode = false, deleting = false, reading = false,
    checkedPolicy?: Awaited<ReturnType<typeof CompanySecurityService.policy>>, checkedUser = false) {
    const policy = checkedPolicy || await this.capability(actor, [roleMode ? "access_assign_role" : "access_assign_user"], reading ? "SSEARCH" : deleting ? "SDELETE" : "SSAVE");
    if (!roleMode && !checkedUser) await this.targetUser(actor, String(row.loginid || ""));
    const serial = Number(roleMode ? row.serial_no : row.serial_no_or_role_id);
    if (!Number.isSafeInteger(serial) || serial <= 0) throw new PlatformError("Select a valid screen");
    const serials = serial < 90001 ? [serial] : await PlatformAdminService.scope(actor.tenantId, async (c, owner) => {
      const r = await c.execute<any>(`SELECT SERIAL_NO,COMPANY_CODE,${flags.join(",")} FROM ${owner}.SEC_ROLE_APP_ACCESS WHERE ROLE_ID=:role`, { role: serial }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!r.rows?.length || r.rows.some(x => x.COMPANY_CODE !== actor.company_code)) throw new PlatformError("Select a role belonging only to your company", 403);
      for (const grant of r.rows) for (const f of flags)
        if (grant[f] === "Y" && policy.permissions.get(Number(grant.SERIAL_NO))?.[f] !== "Y") throw new PlatformError("This role exceeds your assigned operations", 403);
      return r.rows.map(x => Number(x.SERIAL_NO));
    });
    for (const n of serials) {
      if (!policy.screens.some(s => Number(s.SERIAL_NO) === n)) throw new PlatformError("You can assign only your own available screens and modules", 403);
      if (!deleting && serial < 90001) for (const f of flags)
        if (String(row[f.toLowerCase()] || "N").toUpperCase() === "Y" && policy.permissions.get(n)?.[f] !== "Y") throw new PlatformError("You cannot grant an operation you do not have", 403);
    }
    if (roleMode) await PlatformAdminService.scope(actor.tenantId, async (c, owner) => {
      const role = Number(row.role_id);
      const own = await c.execute(`SELECT 1 FROM ${owner}.SEC_ROLE_MASTER WHERE ROLE_ID=:role AND COMPANY_CODE=:company`, { role, company: actor.company_code });
      const shared = await c.execute(`SELECT 1 FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER WHERE SERIAL_NO_OR_ROLE_ID=:role AND (COMPANY_CODE<>:company OR COMPANY_CODE IS NULL)`, { role, company: actor.company_code });
      if (!own.rows?.length || shared.rows?.length) throw new PlatformError("Shared roles must be managed by a platform administrator", 403);
    });
  }
}
