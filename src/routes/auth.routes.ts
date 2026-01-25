import * as express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import {
  login,
  me,
  resetPassword,
  forgotPassword,
    resetPasswordWithLoginId,
} from "../controllers/auth.controller";

// Create a new Express router
const router = express.Router();

router.post("/login", login);
router.post("/forgotPassword", forgotPassword);
router.post("/resetPassword", resetPassword);
router.post("/reset-password-loginid", resetPasswordWithLoginId);


router.get("/me", 
  passport.authenticate("jwt", { session: false }), 
  tenantContextMiddleware,
  me
);

// Export the router
export default router;
