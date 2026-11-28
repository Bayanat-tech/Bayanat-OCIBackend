import * as express from "express";
import publicRegistrationRoutes from './publicRegistration.routes';
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import {
  login,
  me,
  resetPassword,
  forgotPassword,
  changePasswordByEmail,
  resetPasswordWithLoginId,
  diagnosticPermissions,
} from "../controllers/auth.controller";
import { public_invoice } from "../controllers/wms/reports/invoice_reports/invoice_report";
import { getCompanyLogoDirect } from "../controllers/Freight/companyLogo.controller";
import { PlatformAdminService } from "../services/Security/platformAdmin.service";

// Create a new Express router
const router = express.Router();
router.use('/registration',publicRegistrationRoutes);

router.get("/public/invoice", public_invoice)
router.post("/login", login);
router.post("/forgotPassword", forgotPassword);
router.post("/change-password", changePasswordByEmail);
router.post("/resetPassword", resetPassword);
router.post("/reset-password-loginid", resetPasswordWithLoginId);
router.get("/billing-notices", passport.authenticate("jwt", { session: false }), async (req: any, res) => {
  const tenant = req.user?.tenantId, company = req.user?.company_code;
  if (!tenant || !company || req.user?.isPlatformAdmin) { res.json({ success: true, data: [] }); return; }
  try {
    const data = await PlatformAdminService.root(async c => (await c.execute<any>(`SELECT i.INVOICE_ID,TO_CHAR(i.DUE_DATE,'YYYY-MM-DD') DUE_DATE,TO_CHAR(i.GRACE_END,'YYYY-MM-DD') GRACE_END,s.SUSPENDED,TO_CHAR(s.CANCEL_ON,'YYYY-MM-DD') CANCEL_ON
      FROM CUSTOMERS.SEC_BILLING_INVOICE i JOIN CUSTOMERS.SEC_COMPANY_SUBSCRIPTION s ON s.TENANT_ID=i.TENANT_ID AND s.COMPANY_CODE=i.COMPANY_CODE
      WHERE i.TENANT_ID=:tenant AND i.COMPANY_CODE=:company AND s.BILLING_ENABLED='Y' AND i.STATUS='PENDING'
      ORDER BY i.PERIOD_START FETCH FIRST 5 ROWS ONLY`, { tenant, company }, { outFormat: 4002 })).rows || []);
    res.json({ success: true, data });
  } catch { res.status(503).json({ success: false, message: "Unable to load company billing notices" }); }
});


router.get("/me", 
  passport.authenticate("jwt", { session: false }), 
  tenantContextMiddleware,
  me
);

router.get("/company-logo",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  getCompanyLogoDirect
);

router.get("/diagnostic-permissions",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  diagnosticPermissions
);

// Export the router
export default router;
