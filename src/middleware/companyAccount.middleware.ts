import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import constants from "../helpers/constants";
import { CompanyAccountService } from "../services/Security/companyAccount.service";
import { PlatformAdminService, PlatformError } from "../services/Security/platformAdmin.service";
export async function companyAccountGate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return next();
  let actor: any;
  try { actor = jwt.verify(token, constants.AUTHENTICATION.APP_SECRET || process.env.APP_SECRET || "BAYANAT"); } catch { return next(); }
  // Login and password recovery remain available with an expired/old session.
  if (/^\/api\/auth\/(login|forgotPassword|resetPassword|change-password|reset-password-loginid)(\/|$)/i.test(req.originalUrl.split("?")[0])) return next();
  if (!actor.tenantId || !actor.company_code || !actor.loginid) return next();
  try {
    const admin = await PlatformAdminService.getAccess(actor.loginid);
    if (admin && (admin.scope === "ALL" || admin.tenants.includes(actor.tenantId))) return next();
    await CompanyAccountService.assertActive(actor.tenantId, actor.company_code, actor.loginid);
    next();
  } catch (e: any) { res.status(e instanceof PlatformError ? e.status : 503).json({ success: false, code: "ACCOUNT_UNAVAILABLE", message: e instanceof PlatformError ? e.message : "Unable to verify company account status" }); }
}
