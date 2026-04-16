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
import { insUpdTrAcJVBulk } from "../../controllers/finance/accounts/transactions/insUpdTrAcJVBulk";
import { upsertAssetSaleRegister } from "../../controllers/finance/accounts/transactions/upsertAssetSaleRegister";
import { insUpdTrAcAssetTransferBulk } from "../../controllers/finance/accounts/transactions/insUpdTrAcAssetTransferBulk";
import { upsertPrepaid } from "../../controllers/finance/accounts/transactions/upsertPrepaid";
import { upsertBankRemittance } from "../../controllers/finance/accounts/transactions/upsertBankRemittance";
import { insUpdChqDepositBulk } from "../../controllers/finance/accounts/transactions/insUpdChqDepositBulk";
import { upsertBudget } from "../../controllers/finance/accounts/transactions/upsertBudget";
import { upsertAcBudget } from "../../controllers/finance/accounts/masters/upsertAcBudget";
import { insUpdAcExpTypeBulk } from "../../controllers/finance/accounts/transactions/insUpdAcExpTypeBulk";
import { insUpdBTProject } from "../../controllers/finance/accounts/transactions/insUpdBTProject";
import { upsertMsAcAsset } from "../../controllers/finance/accounts/transactions/upsertMsAcAsset";
import { insDocAccodeBulk } from "../../controllers/finance/accounts/transactions/insDocAccodeBulk";
import { upsertHrDocTypes } from "../../controllers/finance/accounts/transactions/upsertHrDocTypes";
import { insUpdMSACPLSetup } from "../../controllers/finance/accounts/transactions/insUpdMSACPLSetup";
import { upsertSetupDoc } from "../../controllers/finance/accounts/transactions/upsertSetupDoc";
import { insUpdHrGrade } from "../../controllers/HR/insUpdHrGrade";
const router = express.Router();
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);



router.post(
  "/insUpdChqDepositBulk",
  insUpdChqDepositBulk
);

router.post(
  "/upsertBudget",
  upsertBudget
);

router.post(
  "/insUpdAcExpTypeBulk",
  insUpdAcExpTypeBulk
);

router.post(
  "/insDocAccodeBulk",
  insDocAccodeBulk);

router.post(
  "/upsertHrDocTypes",
  upsertHrDocTypes)

router.post(
  "/insUpdBTProject",
  insUpdBTProject
);
 
router.post(
  "/insUpdMSACPLSetup",
  insUpdMSACPLSetup
);

router.post(
  "/upsertBankRemittance",
  upsertBankRemittance
);

router.post(
  "/upsertSetupDoc",
  upsertSetupDoc
);


router.post(
  "/upsertAcBudget",
  upsertAcBudget 
);



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
router.post(
  "/insUpdTrAcAssetTransferBulk",
  insUpdTrAcAssetTransferBulk
);

router.post(
  "/upsertAssetSaleRegister",
  upsertAssetSaleRegister
);

router.post(
  "/upsertMsAcAsset",
  upsertMsAcAsset
);


router.post(
  "/insUpdHrGrade",
  insUpdHrGrade);

router.post(
  "/upsertPrepaid",
  upsertPrepaid
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



