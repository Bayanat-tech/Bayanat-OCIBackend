
import * as express from "express";
import passport from "passport";

import { tenantContextMiddleware } from "../../../src/middleware/tenantContext.middleware"



import { checkUserAuthorization } from "../../../src/middleware/checkUserAthorization"
import { updBankReconBulk } from "../../controllers/finance/accounts/transactions/updBankReconBulk";
import { insUpdTrAcJVBulk } from "../../controllers/finance/accounts/transactions/insUpdTrAcBulk";
//import { insUpdTrAcJVBulk, insUpdTrAcJVBulk } from "../../controllers/finance/accounts/transactions/insUpdTrAcBulk";
const router = express.Router();


router.post(
  "/updBankReconBulk",
  updBankReconBulk
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

// // Get finance master data
// router.get(
//   "/:master",
//   // authenticate the user using the jwt token
//   passport.authenticate("jwt", { session: false }),
//   // check if the user has the necessary permissions
//   checkUserAuthorization,
//   // call the getFinanceListData function to handle the request
//   getFinanceListData
// );

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

// // Define routes for finance transactions data
// router.use(
//   "/transactions",
//   // authenticate the user using the jwt token
//   passport.authenticate("jwt", { session: false }),
//   // check if the user has the necessary permissions
//   checkUserAuthorization,
//   // call the transactionsRoutes to handle the request
//   transactionsRoutes
// );

 export default router;

