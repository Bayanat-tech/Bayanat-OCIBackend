
import express from "express";
import { insPsUserRoleMappingBulk } from "../../controllers/ALMS/insPsUserRoleMappingBulk";
import { insPsFlowRoleMappingBulk } from "../../controllers/ALMS/insPsFlowRoleMappingBulk ";
import { insUpdPurchaseRequest } from '../../controllers/ALMS/insUpdPurchaseRequest';




const router = express.Router();

router.post(
  "/insUpdPurchaseRequest",
  insUpdPurchaseRequest
);

router.post(
  "/insPsUserRoleMappingBulk",
  insPsUserRoleMappingBulk
);

router.post(
  "/insPsFlowRoleMappingBulk",
  insPsFlowRoleMappingBulk 
);


export default router;
