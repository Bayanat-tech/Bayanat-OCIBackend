import * as express from "express";
import passport from "passport";
// NOTE: getPfMaster and deletepfMaster are not exported from available controllers
// Providing stub implementations for now - please review what functionality is actually needed
const getPfMaster = async (req: any, res: any) => {
  res.status(501).json({ error: "Not implemented" });
};
const deletepfMaster = async (req: any, res: any) => {
  res.status(501).json({ error: "Not implemented" });
};
// import {
//   getPfMaster,
//   deletepfMaster,
// } from "../controllers/Purchaseflow_Al/purchaseflow.controller";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";

const router = express.Router();


router.get(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getPfMaster
);



router.post(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  deletepfMaster
);
export default router;
