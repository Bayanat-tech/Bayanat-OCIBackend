
import * as express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";


import gmalmsRouter from "./Alms/alms.routes";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";

const router = express.Router();
// Route for transaction operations
router.use(
  "/:transaction",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  gmalmsRouter    
);

export default router;
  