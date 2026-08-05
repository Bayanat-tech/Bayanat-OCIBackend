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
import { delDocAccodeBulk } from "../../controllers/finance/accounts/transactions/delDocAccodeBulk";
import { upsertHrDocTypes } from "../../controllers/finance/accounts/transactions/upsertHrDocTypes";
import { insUpdMSACPLSetup } from "../../controllers/finance/accounts/transactions/insUpdMSACPLSetup";
import { upsertSetupDoc } from "../../controllers/finance/accounts/transactions/upsertSetupDoc";
import { insUpdHrGrade } from "../../controllers/HR/insUpdHrGrade";
import { insUpdHrPayComponent } from "../../controllers/HR/insUpdHrPayComponent";
import { insUpdSecPayCompAc } from "../../controllers/HR/insUpdSecPayCompAc";
import { insUpdHrEmployee } from "../../controllers/HR/insUpdHrEmployee";
import { insUpdHrSalaryAdvDed } from "../../controllers/HR/insUpdHrSalaryAdvDed";
import { insUpdHrJoinRpt } from "../../controllers/HR/insUpdHrJoinRpt";
import { insUpdHrPayCompDepend } from "../../controllers/HR/insUpdHrPayCompDepend";
import { insUpdHrGradeComponent } from "../../controllers/HR/insUpdHrGradeComponent";
import { proc_common_sql_finance } from "../../controllers/finance/accounts_controller";
import { upsertHrIntEvalForm } from "../../controllers/finance/accounts/transactions/upsertHrIntEvalForm";
import { procBulkAccountEntry } from "../../controllers/finance/accounts/transactions/procBulkAccountEntry";
import { upsertHrEmpEducation } from "../../controllers/HR/upsertHrEmpEducation";
import { upsertHrEmpComponents } from "../../controllers/HR/upsertHrEmpComponents";
import { upsertSecDivUser } from "../../models/Hr/upsertSecDivUser";
import { deleteAcMasterDocsDet, getAcMasterDocsDet, upsertAcMasterDocsDet } from "../../controllers/finance/accounts/transactions/upsertAcMasterDocsDet";
import { deleteVendorActivity, upsertVendorActivity } from "../../controllers/finance/accounts/transactions/upsertVendorActivity";
import { upsertPLSetup } from "../../controllers/finance/accounts/transactions/upsertPLSetup";
import { insUpdEmpLeaveencashment } from "../../controllers/HR/insUpdEmpLeaveencashment";
import { insUpdGradeSalaryIncrement } from "../../controllers/HR/insUpdGradeSalaryIncrement";
import { insUpdEmpSalaryIncrement } from "../../controllers/HR/insUpdEmpSalaryIncrement";
import { insUpdBudgetRequestBulk } from "../../controllers/finance/accounts/transactions/insUpdBudgetRequestBulk";
import { insLoadBudgetData } from "../../controllers/finance/accounts/transactions/insLoadBudgetData";
import { insUpdTnInvoiceBulk } from "../../controllers/wms/insUpdTnInvoiceBulk";
import {insUpdMsApproverLevels} from "../../controllers/Security/insUpdMsApproverLevels.controller";
import {insSecRoleFunctionAccessUser} from "../../controllers/Security/insSecRoleFunctionAccessUser.controller";
const router = express.Router();
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);

router.post(
  "/insUpdTnInvoiceBulk",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  insUpdTnInvoiceBulk
);

router.post(
  "/insLoadBudgetData",
  insLoadBudgetData);

router.post(
  "/insUpdBudgetRequestBulk",
  insUpdBudgetRequestBulk
);

router.post(
  "/insUpdChqDepositBulk",
  insUpdChqDepositBulk
);



router.post(
  "/insUpdEmpLeaveencashment",
  insUpdEmpLeaveencashment
);


router.post(
  "/upsertBudget",
  upsertBudget
);

router.post(
  "/upsertPLSetup",
  upsertPLSetup
);

router.post(
  "/insUpdAcExpTypeBulk",
  insUpdAcExpTypeBulk
);

router.post(
  "/upsertAcMasterDocsDet",
  upsertAcMasterDocsDet
);

router.get(
  "/acMasterDocsDet/:ac_code",
  getAcMasterDocsDet
);

router.delete(
  "/acMasterDocsDet/:ac_code/:srno",
  deleteAcMasterDocsDet
);

router.post(
  "/upsertVendorActivity",
  upsertVendorActivity
);

router.delete(
  "/vendorActivity/:ac_code/:srno",
  deleteVendorActivity
);

// Account entry for BP/BR/CR/CP/DN/CN

router.post(
  "/procBulkAccountEntry",
  procBulkAccountEntry);


router.post(
  "/insDocAccodeBulk",
  insDocAccodeBulk);

router.post(
  "/delDocAccodeBulk",
  delDocAccodeBulk);
// hr
router.post(
  "/upsertHrDocTypes",
  upsertHrDocTypes)

  // hr
router.post(
  "/upsertSecDivUser",
  upsertSecDivUser)

   
  router.post(
  "/upsertHrIntEvalForm", 
upsertHrIntEvalForm)

  // hr
router.post(
  "/insUpdHrGradeComponent",
  insUpdHrGradeComponent)
   

  // hr
router.post(
  "/upsertHrEmpEducation",
  upsertHrEmpEducation)

  // hr
router.post(
  "/upsertHrEmpComponents",
  upsertHrEmpComponents)

  //hr 

router.post(
  "/insUpdGradeSalaryIncrement",
  insUpdGradeSalaryIncrement)

  router.post(
  "/insUpdEmpSalaryIncrement",
  insUpdEmpSalaryIncrement )

  // hr
router.post(
  "/insUpdHrPayCompDepend",
  insUpdHrPayCompDepend)
  
// hr
router.post(
  "/insUpdHrSalaryAdvDed", 
  insUpdHrSalaryAdvDed)

// hr
router.post(
  "/insUpdHrJoinRpt", 
  insUpdHrJoinRpt)


  router.post(
  "/insUpdHrEmployee",
  insUpdHrEmployee)

//hr
  router.post(
  "/insUpdSecPayCompAc",
  insUpdSecPayCompAc)

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

  "/insUpdBudgetRequestBulk",

  insUpdBudgetRequestBulk

);

router.post(
  "/insUpdHrPayComponent",
  insUpdHrPayComponent)


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

// Common procedure for finance modules
router.post(
  "/proc_common_sql_finance",
  proc_common_sql_finance
);
router.post("/insUpdMsApproverLevels", insUpdMsApproverLevels);
router.post("/insSecRoleFunctionAccessUser", insSecRoleFunctionAccessUser); 
 export default router;



