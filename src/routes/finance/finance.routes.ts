import * as express from "express";
import passport from "passport";
import { Router } from "express";
import { getFinanceListData } from "../../controllers/finance/finance.controller";
import { checkUserAuthorization } from "../../middleware/checkUserAthorization";
import masterRoutes from "../finance/accounts/master_finance.routes";
import transactionsRoutes from "../finance/accounts/transactions_finance.routes";
import { tenantContextMiddleware } from "../../../src/middleware/tenantContext.middleware";
import { tenantMiddleware } from "../../../src/middleware/tenant.middleware";
import { updBankReconBulk } from "../../controllers/finance/accounts/transactions/updBankReconBulk";
import { insUpdTrAcJVBulk } from "../../controllers/finance/accounts/transactions/insUpdTrAcBulk";
const router = express.Router();
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);


router.post(
  "/updBankReconBulk",
  updBankReconBulk
);

//Define routes for finance master data
router.use(
  "/master",
  // authenticate the user using the jwt token
  passport.authenticate("jwt", { session: false }),
  // check if the user has the necessary permissions
  checkUserAuthorization,
  // call the masterRoutes to handle the request
  masterRoutes
);

router.post(
  "/insUpdTrAcJVBulk",
  insUpdTrAcJVBulk
);
// import * as express from "express";
// import passport from "passport";
// import { getFinanceListData } from "../../controllers/finance/finance.controller";
// import { checkUserAuthorization } from "../../middleware/checkUserAthorization";
// import masterRoutes from "../finance/accounts/master_finance.routes";
// import transactionsRoutes from "../finance/accounts/transactions_finance.routes";
// const router = express.Router();

// Get finance master data
router.get(
  "/:master",
  // authenticate the user using the jwt token
  passport.authenticate("jwt", { session: false }),
  // check if the user has the necessary permissions
  checkUserAuthorization,
  // call the getFinanceListData function to handle the request
  getFinanceListData
);

// // Define routes for finance master data
// router.use(
//   "/master",
//   // authenticate the user using the jwt token
//   passport.authenticate("jwt", { session: false }),
//   // check if the user has the necessary permissions
//   checkUserAuthorization,
//   // call the masterRoutes to handle the request
//   masterRoutes
// );

// Define routes for finance transactions data
router.use(
  "/transactions",
  // authenticate the user using the jwt token
  passport.authenticate("jwt", { session: false }),
  // check if the user has the necessary permissions
  checkUserAuthorization,
  // call the transactionsRoutes to handle the request
  transactionsRoutes
);

 export default router;



