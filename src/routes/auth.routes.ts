import * as express from "express";
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

// Create a new Express router
const router = express.Router();

router.get("/public/invoice", public_invoice)
router.post("/login", login);
router.post("/forgotPassword", forgotPassword);
router.post("/change-password", changePasswordByEmail);
router.post("/resetPassword", resetPassword);
router.post("/reset-password-loginid", resetPasswordWithLoginId);


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
