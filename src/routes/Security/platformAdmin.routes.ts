import { Router } from "express";
import passport from "passport";
import { requirePlatformAdmin } from "../../middleware/platformAdmin.middleware";
import {
  PlatformAdminService,
  PlatformError,
} from "../../services/Security/platformAdmin.service";
import { oracleDb } from "../../database/connection";
import { CompanySubscriptionService } from "../../services/Security/companySubscription.service";
import { CompanyBillingService } from "../../services/Security/companyBilling.service";
import { companyModuleReadiness } from "../../services/Security/companyReadiness.service";

const router = Router();
router.use(
  passport.authenticate("jwt", { session: false }),
  requirePlatformAdmin,
);
const handle =
  (fn: (req: any) => Promise<any>) => async (req: any, res: any) => {
    try {
      res.json({ success: true, data: await fn(req) });
    } catch (e: any) {
      console.error("Platform admin request failed", {
        code: e.code,
        message: e.message,
      });
      res.status(e instanceof PlatformError ? e.status : 500).json({
        success: false,
        message:
          e instanceof PlatformError
            ? e.message
            : "Unable to complete security operation. Check the selected resource and required fields.",
      });
    }
  };
router.get(
  "/tenants",
  handle((req) => PlatformAdminService.tenants(req.user.loginid)),
);
router.get(
  "/audit",
  handle((req) => PlatformAdminService.auditTrail(req.user.loginid)),
);
router.use("/:tenant", (req: any, res, next) => {
  const access = req.platformAccess;
  if (
    access.scope === "SCOPED" &&
    !access.tenants.includes(req.params.tenant)
  ) {
    res.status(403).json({
      success: false,
      message: "Your account does not have access to this tenant",
    });
    return;
  }
  next();
});
router.get("/:tenant/subscription", handle(req => CompanySubscriptionService.get(req.user.loginid, req.params.tenant, String(req.query.company || ""))));
router.put("/:tenant/subscription", handle(req => CompanySubscriptionService.save(req.user.loginid, req.params.tenant, String(req.query.company || ""), req.body)));
router.get("/:tenant/billing", handle(req => CompanyBillingService.overview(req.user.loginid, req.params.tenant, String(req.query.company || ""))));
router.get("/:tenant/readiness", handle(req => companyModuleReadiness(req.user.loginid, req.params.tenant, String(req.query.company || ""))));
router.post("/:tenant/billing/control", handle(req => CompanyBillingService.control(req.user.loginid, req.params.tenant, String(req.query.company || ""), req.body)));
router.post("/:tenant/billing/invoices/:invoice/pay", handle(req => CompanyBillingService.pay(req.user.loginid, req.params.tenant, String(req.query.company || ""), Number(req.params.invoice), req.body)));
router.post("/:tenant/billing/run", handle(async req => {
  await CompanyBillingService.production(req.user.loginid);
  await CompanySubscriptionService.validateCompany(req.user.loginid, req.params.tenant, String(req.query.company || ""));
  return CompanyBillingService.processCompany(req.params.tenant, String(req.query.company || ""));
}));
router.get(
  "/:tenant/options",
  handle((req) =>
    PlatformAdminService.editorOptions(
      req.params.tenant,
      String(req.query.company || ""),
      req.user.loginid,
    ),
  ),
);
router.get(
  "/:tenant/catalog",
  handle((req) =>
    PlatformAdminService.catalog(req.params.tenant, req.user.loginid),
  ),
);
router.post(
  "/:tenant/users",
  handle((req) =>
    PlatformAdminService.provisionUser(
      req.user.loginid,
      req.params.tenant,
      String(req.query.company || ""),
      req.body,
    ),
  ),
);
router.get(
  "/:tenant/access",
  handle((req) =>
    PlatformAdminService.userAccess(
      req.params.tenant,
      String(req.query.company || ""),
      String(req.query.loginid || ""),
    ),
  ),
);
router.put(
  "/:tenant/access",
  handle((req) =>
    PlatformAdminService.grant(
      req.user.loginid,
      req.params.tenant,
      String(req.query.company || ""),
      req.body,
    ),
  ),
);
router.get(
  "/:tenant/records/:table",
  handle((req) =>
    PlatformAdminService.records(
      req.params.tenant,
      req.params.table,
      String(req.query.company || ""),
      Number(req.query.page) || 1,
      String(req.query.search || ""),
      req.user.loginid,
    ),
  ),
);
router.post(
  "/:tenant/records/:table",
  handle((req) =>
    PlatformAdminService.mutate(
      req.user.loginid,
      req.params.tenant,
      req.params.table,
      String(req.query.company || ""),
      req.body,
    ),
  ),
);
router.delete(
  "/:tenant/records/:table",
  handle((req) =>
    PlatformAdminService.mutate(
      req.user.loginid,
      req.params.tenant,
      req.params.table,
      String(req.query.company || ""),
      req.body,
      true,
    ),
  ),
);
router.get(
  "/:tenant/screens",
  handle(async (req) => {
    const tenantId = req.params.tenant;
    const company = String(req.query.company || "");
    const catalog = await PlatformAdminService.catalog(tenantId);
    if (
      !company ||
      !(catalog.companies as any[]).some((c) => c.COMPANY_CODE === company)
    )
      throw new PlatformError("Select a company in this tenant");
    const screens = await PlatformAdminService.screenCatalog(tenantId, company);
    const disabled = await oracleDb.query(
      "SELECT SERIAL_NO FROM CUSTOMERS.SEC_COMPANY_SCREEN_ACCESS WHERE TENANT_ID=:tenantId AND COMPANY_CODE=:company AND IS_ENABLED='N'",
      { tenantId, company },
    );
    const denied = new Set(
      (disabled.rows || []).map((r: any) => Number(r.SERIAL_NO)),
    );
    return screens.map((s) => ({
      ...s,
      enabled: !denied.has(Number(s.SERIAL_NO)),
    }));
  }),
);
router.put(
  "/:tenant/screens",
  handle(async (req) => {
    const tenantId = req.params.tenant;
    const company = String(req.query.company || "");
    const catalog = await PlatformAdminService.catalog(tenantId);
    if (
      !company ||
      !(catalog.companies as any[]).some((c) => c.COMPANY_CODE === company)
    )
      throw new PlatformError("Select a company in this tenant");
    const { serialNo, enabled } = req.body;
    if (!Number.isSafeInteger(serialNo) || typeof enabled !== "boolean")
      throw new PlatformError("Invalid screen assignment");
    const exists = await PlatformAdminService.tenantQuery(
      tenantId,
      "SELECT 1 FROM #SCHEMA#.SEC_MODULE_DATA WHERE SERIAL_NO=:serialNo",
      { serialNo },
    );
    if (!exists.length)
      throw new PlatformError("Screen does not belong to this tenant");
    const actor = req.user.loginid;
    await PlatformAdminService.audit(
      actor,
      tenantId,
      company,
      "ATTEMPT",
      "COMPANY_SCREENS",
      { serialNo, enabled },
    );
    await PlatformAdminService.root(async (connection) => {
      try {
        await connection.execute(
          `MERGE INTO CUSTOMERS.SEC_COMPANY_SCREEN_ACCESS t USING (SELECT :tenantId TENANT_ID,:company COMPANY_CODE,:serialNo SERIAL_NO FROM DUAL) s
    ON (t.TENANT_ID=s.TENANT_ID AND t.COMPANY_CODE=s.COMPANY_CODE AND t.SERIAL_NO=s.SERIAL_NO)
    WHEN MATCHED THEN UPDATE SET t.IS_ENABLED=:flag,t.UPDATED_BY=:actor,t.UPDATED_AT=SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (TENANT_ID,COMPANY_CODE,SERIAL_NO,IS_ENABLED,UPDATED_BY) VALUES (:tenantId,:company,:serialNo,:flag,:actor)`,
          { tenantId, company, serialNo, flag: enabled ? "Y" : "N", actor },
        );
        await PlatformAdminService.audit(
          actor,
          tenantId,
          company,
          "UPDATE",
          "COMPANY_SCREENS",
          { serialNo, enabled },
          connection,
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
    return { changed: 1 };
  }),
);
export default router;
