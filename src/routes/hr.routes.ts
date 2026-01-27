// Import required modules and controllers
import * as express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import { deleteHrMaster, getHrMaster } from "../controllers/hr.controller";
import hrGmRoutes from "./HR/gmHr.routes";
import employeeHrRoutes from "./HR/employeHr.routes";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";

// Initialize the Express router
const router = express.Router();

console.log("HR Routes Loaded");

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

// Define a DELETE API endpoint to delete HR master data
router.delete(
  "/leavetype/delete",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  // Call the deleteHrMaster controller function to handle the request
  deleteHrMaster
);

// Define a POST API endpoint to create HR master data
router.post(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
  deleteHrMaster
);

// Export the router as the default module
export default router;
