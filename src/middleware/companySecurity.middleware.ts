import { Response, NextFunction } from "express";
import { RequestWithUser } from "../interfaces/common.interface";
import { CompanySecurityService, CompanyActor } from "../services/Security/companySecurity.service";
import { PlatformAdminService, PlatformError } from "../services/Security/platformAdmin.service";

export async function companySecurityPolicy(req: RequestWithUser, res: Response, next: NextFunction) {
  try {
    const actor = req.user as CompanyActor;
    const platform = await PlatformAdminService.getAccess(actor.loginid);
    if (platform?.scope === "ALL") return next();
    if (platform) throw new PlatformError("Use your scoped platform administration console", 403);
    if (!actor.tenantId || !actor.company_code) throw new PlatformError("Select your tenant company", 403);
    const path = req.path.toLowerCase();
    const writing = req.method !== "GET";
    if (writing) {
      const checkCompany = (value: any): void => {
        if (!value || typeof value !== "object") return;
        for (const [key, item] of Object.entries(value)) {
          if (key.toLowerCase() === "company_code" && String(item ?? "").trim() !== actor.company_code)
            throw new PlatformError("You can manage only your own company", 403);
          if (item && typeof item === "object") checkCompany(item);
        }
      };
      checkCompany(req.body);
      if (req.body && !Object.prototype.hasOwnProperty.call(req.body, "company_code")) req.body.company_code = actor.company_code;
    }
    if (/tenant[_-](user|registry|mapping)/.test(path) || (writing && /secmoduledata|sec_module_data|query_master/.test(path)))
      throw new PlatformError("This resource is managed by PRODADMIN or QAADMIN", 403);
    if ((path === "/seccompany" && req.method === "POST") || (path === "/sec_company" && writing))
      throw new PlatformError("Only platform administrators can create or remove companies. You may edit your existing company.", 403);
    if (path === "/seccompany" && writing) {
      await CompanySecurityService.capability(actor, ["company", "sec_company"], "SMODIFY");
      req.body.company_code = actor.company_code;
    }
    if (/^\/accessassign(user|role)(\/delete)?$/.test(path)) {
      const roleMode = path.includes("accessassignrole");
      const source = req.method === "GET" ? req.query : req.body;
      const rows = path.endsWith("/delete") ? source.screen_details : [source];
      if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new PlatformError("Select up to 5000 screen assignments");
      const policy = await CompanySecurityService.capability(actor, [roleMode ? "access_assign_role" : "access_assign_user"], !writing ? "SSEARCH" : path.endsWith("/delete") ? "SDELETE" : "SSAVE");
      const checkedUsers = new Set<string>();
      for (const row of rows) {
        if (!row || typeof row !== "object") throw new PlatformError("Provide valid screen assignments");
        if (!roleMode && !checkedUsers.has(String(row.loginid || ""))) {
          await CompanySecurityService.targetUser(actor, String(row.loginid || ""));
          checkedUsers.add(String(row.loginid || ""));
        }
        if (writing && !path.endsWith("/delete")) for (const f of ["snew","smodify","sdelete","ssave","ssearch","ssaveas","supload","sundo","sprint","sprintsetup","shelp"]) {
          const value = String(row[f] ?? "N").trim().toUpperCase();
          if (!["Y", "N", "NA"].includes(value)) throw new PlatformError("Choose valid operation permissions");
          row[f] = value;
        }
        await CompanySecurityService.assignment(actor, row, roleMode, !writing || path.endsWith("/delete"), !writing, policy, true);
      }
      if (writing) req.body.company_code = actor.company_code;
      if (writing && !roleMode && !path.endsWith("/delete")) req.body.userid = req.body.loginid;
    }
    if (/^\/accessassign(user|role)\/\d+$/.test(path)) {
      const policy = await CompanySecurityService.policy(actor);
      const serial = Number(path.split("/").pop());
      if (!policy.screens.some(s => Number(s.SERIAL_NO) === serial)) throw new PlatformError("This screen is outside your assigned modules", 403);
      const json = res.json.bind(res);
      res.json = ((payload: any) => {
        if (Array.isArray(payload?.data)) payload.data = payload.data.map((row: any) => {
          const masked = { ...row };
          for (const key of ["snew","smodify","sdelete","ssave","ssearch","ssaveas","supload","sundo","sprint","sprintsetup","shelp"])
            if (policy.permissions.get(serial)?.[key.toUpperCase()] !== "Y") masked[key] = "NA";
          return masked;
        });
        return json(payload);
      }) as typeof res.json;
    }
    // Alternative procedure-based security writers must not bypass the checked API.
    if (writing && /inssecrolefunctionaccessuser/.test(path))
      throw new PlatformError("Use the company-scoped user and role assignment screens", 403);
    if (writing && path === "/secmaster") {
      await CompanySecurityService.capability(actor, ["sec_login"], req.method === "POST" ? "SNEW" : "SMODIFY");
      req.body.company_code = actor.company_code;
      if (req.method !== "POST") await CompanySecurityService.targetUser(actor, req.body.loginid);
    }
    // Audit only identifiers and outcomes; never copy password-bearing request bodies.
    if (writing) res.once("finish", () => {
      void PlatformAdminService.audit(actor.loginid, actor.tenantId, actor.company_code,
        res.statusCode < 400 ? "COMPANY_SECURITY_UPDATE" : "COMPANY_SECURITY_FAILED", path,
        { status: res.statusCode }).catch(() => console.error("Company security audit could not be recorded"));
    });
    next();
  } catch (e: any) {
    res.status(e instanceof PlatformError ? e.status : 503).json({ success: false, message: e instanceof PlatformError ? e.message : "Unable to verify company security policy" });
  }
}

// Company Master uses a generic procedure endpoint as well as the legacy API.
export async function dynamicCompanySecurity(req: RequestWithUser, res: Response, next: NextFunction) {
  try {
    const actor = req.user as CompanyActor;
    const platform = await PlatformAdminService.getAccess(actor.loginid);
    if (platform?.scope === "ALL") {
      (req as any).verifiedPlatformSecurity = true;
      return next();
    }
    const parameter = String(req.body?.parameter || "").trim().toLowerCase();
    if (platform && /^(security_|sec_|ms_company)/.test(parameter))
      throw new PlatformError("Use your scoped platform administration console", 403);
    if (parameter === "security_master_company") {
      const rows = await PlatformAdminService.tenantQuery(actor.tenantId, "SELECT * FROM #SCHEMA#.MS_COMPANY WHERE COMPANY_CODE=:company", { company: actor.company_code });
      res.json({ success: true, data: rows });
      return;
    }
    if (["ms_company_ins_upd", "ms_companyinfo_ins_upd"].includes(parameter)) {
      await CompanySecurityService.capability(actor, ["company", "sec_company"], "SMODIFY");
      if (String(req.body.val1s1 || "").trim() !== actor.company_code || req.path.toLowerCase().includes("del"))
        throw new PlatformError("You can edit your own company only. New companies are created by platform administrators.", 403);
      const exists = await PlatformAdminService.tenantQuery(actor.tenantId, "SELECT 1 FROM #SCHEMA#.MS_COMPANY WHERE COMPANY_CODE=:company", { company: actor.company_code });
      if (!exists.length) throw new PlatformError("Your company no longer exists. Contact the platform administrator.", 403);
      req.body.loginid = actor.loginid;
      (req as any).verifiedCompanyUpdate = true;
      res.once("finish", () => { void PlatformAdminService.audit(actor.loginid, actor.tenantId, actor.company_code,
        res.statusCode < 400 ? "UPDATE" : "FAILED", "COMPANY_PROFILE", { status: res.statusCode }).catch(() => console.error("Company audit failed")); });
    } else if (/^(security_|sec_|ms_company)/.test(parameter)) {
      throw new PlatformError("Use the company-scoped security screens to manage these records", 403);
    }
    next();
  } catch (e: any) {
    res.status(e instanceof PlatformError ? e.status : 503).json({ success: false, message: e instanceof PlatformError ? e.message : "Unable to verify company access" });
  }
}

export function assertSafeDynamicSecuritySql(req: any, sql: string) {
  if (req.verifiedPlatformSecurity) return;
  // Also inspect generated SQL so an alternate procedure alias cannot write a
  // security table without passing the company-scoped APIs.
  const targets = [...String(sql).matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+(?:"?\w+"?\.)?"?(SEC_\w+|MS_COMPANY\w*)"?/gi)].map(m => m[1].toUpperCase());
  if (targets.length && (!req.verifiedCompanyUpdate || targets.some(t => !["MS_COMPANY", "MS_COMPANYINFO"].includes(t))))
    throw new PlatformError("Security changes must use the company-scoped administration APIs", 403);
}
