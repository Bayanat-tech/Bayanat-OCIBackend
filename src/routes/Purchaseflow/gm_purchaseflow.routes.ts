import { IUser } from "../../interfaces/user.interface";
import express, {
  Request,
  Response,
  RequestHandler,
  NextFunction,
} from "express";
import { cancelFinalApproval, Fetchmessagebox } from "../../controllers/Purchaseflow/purchaseRequest_pf.Controller";

import {
  upsertAMCDetails  
  } from "../../controllers/Purchaseflow/update_requestAMCdata"
import { getBudgetexcel } from "../../controllers/Purchaseflow/budgetRequest_pf.Controller";
import { budgetexcelupload } from "../../controllers/Purchaseflow/budgetRequest_pf.Controller";
import { CheckBudgetStatus } from "../../controllers/Purchaseflow/budgetRequest_pf.Controller";
import passport from "passport";
import { TCostbudget } from "../../interfaces/Purchaseflow/Budgetflow.interface";
import { handleInsertBudgetCosts } from "../../controllers/Purchaseflow/budgetRequest_pf.Controller";
import { saveexcelbudgetdata } from "../../controllers/Purchaseflow/budgetRequest_pf.Controller";
export interface RequestWithUser extends Request {
  user?: IUser; // Optional user if not always present
}
import { checkUserAuthorization } from "../../middleware/checkUserAthorization";
import { CostmasterController } from "../../controllers/Purchaseflow/pf_costmaster.controller";

 import {
  createcostmaster,
  updatecostmaster,
} from "../../controllers/Purchaseflow/costmaster_pf.controller";
import { ProjectMasterController } from "../../controllers/Purchaseflow/pf_projectmaster.controller";
import { fetchMessageBox } from "../../controllers/Purchaseflow/pf_purchaseRequest.controller";
import { MaterialCategoryController } from "../../controllers/Purchaseflow/pf_MaterialCategory.controller";

// import {
//   creatematerialcategory,
//   updatematerialcategory,
//   deletematerialcategory,
// } from "../../controllers/Purchaseflow/material_category_pf_controller";

// import {
//   createOrUpdateBudgetRequestSequential,
//   getBudgetRequest,
// } from "../../controllers/Purchaseflow/budgetRequest_pf.Controller";
// import { getMaterialRequestNumber } from "../../controllers/Purchaseflow/materialRequest_pf.Controller";
// import {
//   createOrUpdateMaterialRequestSequential,
//   MaterialRequestListing
//   } from "../../controllers/Purchaseflow/materialRequest_pf.Controller";
// import {
//   createOrUpdatePurchaseRequestSequential,
//   getPurchaserequest,
//   updatePurchaseOrder,
//   getPurchaseRequestLog,
//   fetchPRregisterdata,
//   fetchPOregisterdata,
//   fetchRequestNoFromGTSession,
//   fetchUserlevel,
//   bugetcurstatusprojectwiseconsolidated,
//   CheckCostcontroller,
  //Fetchmessagebox,
//   FetchGenPOString,
//   fetchProjectwisebudgetAllocation,
//   fetchCostwisebudgetAllocation,
//   fetchPurchaseRecovery,
//   updatecancelrejectsentBack,
//   fetchPOlisting,
// } from "../../controllers/Purchaseflow/purchaseRequest_pf.Controller";
// import {
//   getddProjectMaster,
//   getddProductMaster,
// } from "../../controllers/Purchaseflow/getdddivisiondata_pf.cotroller";

// import { executeRawSql, getDashboardData,handleGenerateExpenseAdj ,handleSaveExpSamt} from "../../controllers/Purchaseflow/getDashboardData_pf_controller";

// import {
//   updateReasonForPO,
//   updatePrintSignatureInfo,
// } from "../../controllers/Purchaseflow/purchaseRquestdbupdate_pf.Controller";
// import { UpdPurchaseRecoveryData } from "../../controllers/Purchaseflow/purchaserecovery_pf.controller";
// import { deletepfMaster } from "../../controllers/Purchaseflow/purchaseflow.controller";
// import { getPfglobalseearch } from "../../controllers/Purchaseflow/purchaseflow.globalserch.controller";
// /*import {
//   createcostmaster,
//   updatecostmaster,
//   createOrUpdatePurchaseRequestSequential,
//   getPurchaserequest,
//   deletepfMaster,
// } from "../../controllers/Purchaseflow/purchaseflow.controller";*/

// import {
//   createitemmaster,
//   updateitemmaster,
// } from "../../controllers/Purchaseflow/itemmaster_pf.controller";

// import {
//   createprojectmaster,
//   updateprojectmaster,
// } from "../../controllers/Purchaseflow/projectmaster_pf.controller";
// import {
//   createSupplier,
//   updateSupplier,
// } from "../../controllers/Purchaseflow/supplier_pf_controller";

// import {
//   createcustomer,
//   updatecustomer,
// } from "../../controllers/Purchaseflow/customermaster_pf.controller";

// import { saveFile } from "../../controllers/Purchaseflow/purchaseRequest_pf.Controller";

const router = express.Router();

router.post("/costmaster", CostmasterController.createcostmaster);
router.put("/costmaster", CostmasterController. updatecostmaster);

router.post("/CatMatMaster", MaterialCategoryController.createMaterialCategory);
router.put("/CatMatMaster", MaterialCategoryController.updateMaterialCategory);

// router.post("/cancelFinalApproval", cancelFinalApproval);
// router.post("/CatMatMaster", creatematerialcategory);
// router.put("/CatMatMaster", updatematerialcategory);
// router.delete("/CatMatMaster", deletematerialcategory);

//--------------------- Project Master -------------------------
router.post("/projectmaster",ProjectMasterController.createProject);
router.put("/projectmaster", ProjectMasterController.updateProject);
// router.delete("/projectmaster", deletepfMaster);

// //-----Item Master---------------
// router.post("/itemmaster", createitemmaster);
// router.put("/itemmaster", updateitemmaster);

// // ------------------Supplier Master ------------------

// router.post("/suppliermaster", createSupplier);
// router.put("/suppliermaster", updateSupplier);

// //-----Purchase Request-----------
// router.get("/purchaserequest/:request_number", getPurchaserequest);
// router.get(
//   "/getMaterialRequestNumber/:request_number",
//   getMaterialRequestNumber
// );

// // Define the route

router.get("/fetchMessageBox", fetchMessageBox);

// router.get("/getDashboardData", getDashboardData);
// router.get("/getPfglobalsearch/:master", getPfglobalsearch);
// router.get("/fetchPRregisterdata", fetchPRregisterdata);
// router.get("/fetchPOlisting/:request_number", fetchPOlisting);
// router.get("/MaterialRequestListing", MaterialRequestListing);
// router.post("/executeRawSql", executeRawSql);
// router.post("/handleGenerateExpenseAdj", handleGenerateExpenseAdj);
// router.post("/handleSaveExpSamt", handleSaveExpSamt);

// router.get(
//   "/fetchProjectwisebudgetAllocation",
//   fetchProjectwisebudgetAllocation
// );

// router.get("/getddProjectMaster", getddProjectMaster);
// router.get("/getddProductMaster", getddProductMaster);

// router.get("/fetchCostwisebudgetAllocation", fetchCostwisebudgetAllocation);
// router.get("/fetchPOregisterdata", fetchPOregisterdata);
// router.get(
//   "/bugetcurstatusprojectwiseconsolidated",
//   bugetcurstatusprojectwiseconsolidated
// );

// //below is to get data from temp_load and display on the screen.
// router.get("/excebudget/:request_number", getBudgetexcel);
// router.post("/CheckbudgetStatus", CheckBudgetStatus);

// router.get(
//   "/budgetrequest/:request_number/:cost_code?",
//   passport.authenticate("jwt", { session: false }),
//   checkUserAuthorization,
//   getBudgetRequest as unknown as RequestHandler
// );
// router.get("/fetchRequestNoFromGTSession", fetchRequestNoFromGTSession);
// router.get("/fetchUserlevel", fetchUserlevel);
// router.get("/CheckCostcontroller", CheckCostcontroller);
//router.get("/Fetchmessagebox", Fetchmessagebox);

// router.get("/FetchGenPOString", FetchGenPOString);
// console.log("inside purchase router");

// router.post("/budgetrequest/cost", handleInsertBudgetCosts);
// router.post("/purchaserequest", createOrUpdatePurchaseRequestSequential);
// router.post("/materialrequest", createOrUpdateMaterialRequestSequential);
// router.post("/budgetrequest", createOrUpdateBudgetRequestSequential);
// router.post("/purchaseorder", updatePurchaseOrder);
// router.post("/budgetexcelupload", budgetexcelupload);
// router.post("/updatecancelrejectsentback", updatecancelrejectsentBack);
// router.post("/UpdPurchaseRecoveryData", UpdPurchaseRecoveryData);
// router.post("/updateReasonForPO", updateReasonForPO);
// router.post("/updatePrintSignatureInfo", updatePrintSignatureInfo);

// router.get("/PRlogreport/:requestNumber", getPurchaseRequestLog);

// router.get("/fetchPurchaseRecovery/:type_of_pr", fetchPurchaseRecovery);

// router.post("/saveexcelbudgetdata", saveexcelbudgetdata);
// router.post("/saveFile", saveFile as RequestHandler);

// //------------------CUSTOMER MASTER------------------
// router.post("/customermaster", createcustomer);
// router.put("/customermaster", updatecustomer);



// router.post("/upsertAMCDetails",upsertAMCDetails);
export default router;
