import * as express from "express";
import passport from "passport";
import {
  getLogs,
  getUnReadLogsCount,
  updateReadLog,
} from "../controllers/log.controller";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";

const router = express.Router();

router.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getLogs
);

router.get(
  "/read",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getUnReadLogsCount
);

router.put(
  "/allRead",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  updateReadLog
);

export default router;
