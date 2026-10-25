// Import required modules and controllers
import * as express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import { deleteHrMaster, getHrMaster } from "../controllers/hr.controller";
import hrGmRoutes from "./HR/gmHr.routes";
import employeeHrRoutes from "./HR/employeHr.routes";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { insUpdAccrualAcctSetup } from "../controllers/purchase_sales/insUpdAccrualAcctSetup";
import { saveLeaveSlap } from "../controllers/HR/leaveSlap.controller";
import { insUpdHrSalaryAdvDed } from "../controllers/HR/insUpdHrAdvanceSalaryRecovery";
import { getHrReport } from "../controllers/HR/Hr-Reports/hr_reports";
import { upsertHrEmpLeaveEntitle } from "../controllers/HR/controller_leave_entitlement";
import { getEmployeeMasterPrint } from "../controllers/HR/Hr-Reports/employeeMasterReport";
import { getMobileLeaveBucket, getLeaveWorkflowIdentity } from "../controllers/HR/mobileLeave.controller";
import { getLeaveWorkflowTargets, getLeaveWorkflowRequest, saveLeaveWorkflowAction } from "../controllers/HR/leaveWorkflowAction.controller";
import { getHrMasterReportHtml } from "../controllers/HR/Hr-Reports/Hrmasterreport";
import { getGradeMasterReportHtml } from "../controllers/HR/Hr-Reports/Grademasterreport";

// Initialize the Express router
const router = express.Router();

console.log("HR Routes Loaded");

const workflowAuth = [passport.authenticate('jwt', { session: false }), tenantContextMiddleware, checkUserAuthorization];
router.get('/workflow/identity', ...workflowAuth, getLeaveWorkflowIdentity);
router.get('/workflow/leave/request/:requestNumber', ...workflowAuth, getLeaveWorkflowRequest);
router.get('/workflow/leave/:requestNumber/targets', ...workflowAuth, getLeaveWorkflowTargets);
router.post('/workflow/leave/:requestNumber/action', ...workflowAuth, saveLeaveWorkflowAction);
router.get('/workflow/leave/:bucket', ...workflowAuth, getMobileLeaveBucket);

router.get('/mobile/leave/:bucket',
  passport.authenticate('jwt', { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getMobileLeaveBucket,
);

// Define a common GET API endpoint to retrieve HR master data based on the master name
router.get(
  "/:masters",
  // Authenticate the request using JWT and disable session
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getHrMaster
);

// Define a route for GM HR-related endpoints
router.use(
  "/gm",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  hrGmRoutes
);

// Define a route for employee HR-related endpoints
router.use(
  "/employee",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  employeeHrRoutes
);


router.get(
  "/reports/grade_master",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getGradeMasterReportHtml
);

router.get(
  "/reports/:master",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getHrMasterReportHtml
);




// Define a DELETE API endpoint to delete HR master data
router.delete(
  "/leavetype/delete",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  // Call the deleteHrMaster controller function to handle the request
  deleteHrMaster
);

// Accrual Account Setup — must be registered before the "/:master" catch-all
// below, otherwise Express matches that generic route first and this never
// gets hit.
router.post(
  "/insUpdAccrualAcctSetup",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  insUpdAccrualAcctSetup
);

// Define a POST API endpoint to create HR master data
router.post(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  deleteHrMaster
);

router.post(
  "/leaveslap/save",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  saveLeaveSlap
);

router.post(
  "/advancesalaryrecovery/insUpd",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  insUpdHrSalaryAdvDed
)

router.all("/reports/:type/:report",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getHrReport);

router.post("/leave-entitlement/save", upsertHrEmpLeaveEntitle);
router.post(
  "/hr-reports/employee-master/print/:type", 
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  getEmployeeMasterPrint
);

// Export the router as the default module
export default router;
