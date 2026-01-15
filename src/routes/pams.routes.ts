
import * as express from "express";
import passport from "passport";


import gmPamsRouter from "./Pams/pams.routes";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";

const router = express.Router();
// Route for transaction operations
router.use(
  "/:transaction",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  gmPamsRouter    
);

export default router;
  