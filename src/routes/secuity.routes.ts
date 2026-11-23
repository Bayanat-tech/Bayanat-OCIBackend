import * as express from "express";
import passport from "passport";
import { getSecMaster, deleteSecMaster } from "../controllers/Security/security.controller";
import gmSecRouter from "./Security/gm_Security.routes";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import platformAdminRouter from "./Security/platformAdmin.routes";
import { protectRootSecurity } from "../middleware/platformAdmin.middleware";
import { companySecurityPolicy } from "../middleware/companySecurity.middleware";
const router = express.Router();
router.use("/platform", platformAdminRouter);
console.log("Router declaration for Security");
router.get(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  protectRootSecurity,
  tenantContextMiddleware,
  checkUserAuthorization,
  companySecurityPolicy,
  getSecMaster
);

router.use(
  "/gm",
  passport.authenticate("jwt", { session: false }),
  protectRootSecurity,
  tenantContextMiddleware,
  checkUserAuthorization,
  companySecurityPolicy,
  gmSecRouter
);

router.post(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  protectRootSecurity,
  tenantContextMiddleware,
  companySecurityPolicy,
  deleteSecMaster
);
export default router;
