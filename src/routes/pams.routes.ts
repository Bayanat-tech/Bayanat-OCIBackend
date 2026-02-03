
import * as express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";


import gmPamsRouter from "./Pams/pams.routes";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";

const router = express.Router();
// Route for transaction operations
router.use(
  "/:transaction",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  gmPamsRouter    
);

export default router;
  