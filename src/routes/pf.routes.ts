import * as express from "express";
import passport from "passport";


import {
  getPurchasefMaster,
  //deletepfMaster,
} from "../../src/controllers/Purchaseflow/PurchaseFlowMaster.controller"


import gmPfRouter from "./Purchaseflow/gm_purchaseflow.routes";
import gmpurchaserequestRouter from "./Purchaseflow/transaction/gm_purchaserequest.routes";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";

const router = express.Router();
// Route for transaction operations
router.use(
  "/:transaction",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  gmPfRouter
);
//gmpurchaserequestRouter
// Route for reports management
// router.use(
//   "/reports",
//   passport.authenticate("jwt", { session: false }),
//   checkUserAuthorization,
//
// );

router.get(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getPurchasefMaster
);

router.use(
  "/gm",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  gmPfRouter
);

/*router.post(
  "/:master",
  passport.authenticate("jwt", { session: false }),
  deletepfMaster
);
export default router;*/


