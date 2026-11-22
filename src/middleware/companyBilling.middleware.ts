import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import constants from "../helpers/constants";
import { CompanyBillingService as Billing } from "../services/Security/companyBilling.service";
import { PlatformAdminService as Platform } from "../services/Security/platformAdmin.service";

export async function companyBillingGate(req: Request, res: Response, next: NextFunction) {
  const path = req.originalUrl.split("?")[0].replace(/^\/api\//, "").toLowerCase();
  // Account recovery, support and security administration remain available.
  if (/^(auth|security|support|files|notification|diagnostics)(\/|$)/.test(path)) return next();
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return next();
  let actor: any;
  try { actor = jwt.verify(token, constants.AUTHENTICATION.APP_SECRET || process.env.APP_SECRET || "BAYANAT"); }
  catch { return next(); } // The endpoint's authentication middleware handles invalid tokens.
  if (!actor.tenantId || !actor.company_code || !actor.loginid) return next();
  try {
    const modules = await Billing.blockedModules(actor.tenantId, actor.company_code);
    if (!modules.length) return next();
    const admin = await Platform.getAccess(actor.loginid);
    if (admin && (admin.scope === "ALL" || admin.tenants.includes(actor.tenantId))) return next();
    const catalog = await Platform.screenCatalog(actor.tenantId, actor.company_code);
    const prefixes = new Set(catalog.filter(s => modules.includes(String(s.APP_CODE).trim().toUpperCase()))
      .map(s => String(s.URL_PATH || "").replace(/^\//, "").split("/")[0].toLowerCase()).filter(Boolean));
    for (const code of modules) {
      if (["FMS","FINANCE"].includes(code)) { prefixes.add("finance"); prefixes.add("accounts"); }
      if (code === "IMS") { prefixes.add("purchase_sales"); prefixes.add("purchase-sales"); }
      if (["HR","EMS"].includes(code)) { prefixes.add("hr"); prefixes.add("ems"); prefixes.add("gm/hr"); }
      prefixes.add(code.toLowerCase());
    }
    if ([...prefixes].some(p => path === p || path.startsWith(p + "/"))) {
      res.status(403).json({ success: false, code: "COMPANY_BILLING_RESTRICTED", message: "Access to this module is suspended or its subscription has ended. Contact your company administrator." });
      return;
    }
    next();
  } catch { res.status(503).json({ success: false, message: "Unable to verify company billing access. Please retry." }); }
}
