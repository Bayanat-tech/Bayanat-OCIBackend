import * as express from "express";
import passport from "passport";

import gmVendorRouter from "./../../src/controllers/Vendor/gm_vendor_routes";

import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
const router = express.Router();

router.use(
  "/gm",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  gmVendorRouter
);

export default router;
