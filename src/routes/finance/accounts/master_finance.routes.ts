import * as express from "express";
import { tenantMiddleware } from "../../../middleware/tenant.middleware";
import { tenantContextMiddleware } from "../../../middleware/tenantContext.middleware";
import {  getAcTree, getLevel3AcTreeNode, createLevel3AcTreeNode, getLevel4AcTreeNode, createLevel4AcTreeNode, updateLevel4AcTreeNode, getAccountChildrenAcTreeNode, createAccountChildrenAcTreeNode, updateLevel3AcTreeNode ,getLevel2AcTreeNode,createLevel2AcTreeNode,updateLevel2AcTreeNode,deleteLevel2AcTreeNode, deleteLevel3AcTreeNode, deleteLevel4AcTreeNode, deleteLevel5AcTreeNode, updateAccountChildrenAcTreeNode, saveFile, getVendorActivities} from "../../../controllers/finance/accounts/masters/acTree_finance.controller";

const router = express.Router();

// Apply tenant middleware to ensure database switching
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);

//--------------------AC-Tree----------------
// Get the entire account tree
router.get("/ac_tree", getAcTree);

// ------l2------
// // Get, create, and update Level 2 account tree nodes
router.get("/ac_tree/level2/:ac_code", getLevel2AcTreeNode);
router.post("/ac_tree/level2", createLevel2AcTreeNode);
router.put("/ac_tree/level2/:ac_code", updateLevel2AcTreeNode);
router.delete("/ac_tree/level2/:ac_code",deleteLevel2AcTreeNode)


// ------l3------
// // Get, create, and update Level 3 account tree nodes
router.get("/ac_tree/level3/:ac_code", getLevel3AcTreeNode);
router.post("/ac_tree/level3", createLevel3AcTreeNode);
router.put("/ac_tree/level3/:ac_code", updateLevel3AcTreeNode);
router.delete("/ac_tree/level3/:ac_code",deleteLevel3AcTreeNode)

// //------l4------
// // Get, create, and update Level 4 account tree nodes
router.get("/ac_tree/level4/:ac_code", getLevel4AcTreeNode);
router.post("/ac_tree/level4", createLevel4AcTreeNode);
router.put("/ac_tree/level4/:ac_code", updateLevel4AcTreeNode);
router.delete("/ac_tree/level4/:ac_code",deleteLevel4AcTreeNode)

// //------level5------
// // Get, create, and update account children nodes
router.get("/ac_tree/account/:ac_code", getAccountChildrenAcTreeNode);
router.post("/ac_tree/account", createAccountChildrenAcTreeNode);
router.put("/ac_tree/account/:ac_code", updateAccountChildrenAcTreeNode);
router.delete("/ac_tree/level5/:ac_code",deleteLevel5AcTreeNode)
router.post("/saveFile", saveFile as unknown as express.RequestHandler);

// Level5 Activity Approval Detail
router.get("/ac_tree/getVendorActivities", getVendorActivities);


// //----------------delete----------
// // Delete an account item based on level
// router.delete("/ac_tree/:level", deleteAccountItem);

export default router;

