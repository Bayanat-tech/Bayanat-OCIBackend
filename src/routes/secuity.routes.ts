import * as express from "express";
import passport from "passport";
import { getSecMaster, deleteSecMaster } from "../controllers/Security/security.controller";
import gmSecRouter from "./Security/gm_Security.routes";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
const router = express.Router();
console.log("Router declaration for Security");
router.get(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getSecMaster
);

router.use(
  "/gm",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  gmSecRouter
);

router.post(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  deleteSecMaster
);
export default router;
