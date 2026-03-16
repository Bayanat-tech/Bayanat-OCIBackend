// Import required modules and controllers
import * as express from "express";
import passport from "passport";
import {
  getSMSMaster,
  getAllMasterData,
} from "../../controllers/SMS/sms.controller";
import gmcfsRouter from "./sms.gmroutes";
import { deleteSMSMaster } from "../../controllers/SMS/sms.controller";
import { checkUserAuthorization } from "../../middleware/checkUserAthorization";
import { tenantContextMiddleware } from "../../middleware/tenantContext.middleware";
import {
  getSalesPipelineSummary,
  getSalesPerformance,
  getDealProbabilityAnalysis,
  getMonthlyPipelineForecast,
  getNextActionsOverview,
  getSegmentPerformance,
} from "../../controllers/SMS/dashboard.controller";

// Initialize the Express router
const router = express.Router();

router.get(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getSMSMaster
);

// New route to get all master data
router.get(
  "/masters/all",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getAllMasterData
);

router.use(
  "/gm",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  gmcfsRouter
);

router.post(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  deleteSMSMaster
);

// Dashboard routes
router.get(
  "/dashboard/pipeline-summary",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getSalesPipelineSummary
);

router.get(
  "/dashboard/sales-performance",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getSalesPerformance
);

router.get(
  "/dashboard/deal-probability",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getDealProbabilityAnalysis
);

router.get(
  "/dashboard/monthly-forecast",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getMonthlyPipelineForecast
);

router.get(
  "/dashboard/next-actions",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getNextActionsOverview
);

router.get(
  "/dashboard/segment-performance",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getSegmentPerformance
);

export default router;
