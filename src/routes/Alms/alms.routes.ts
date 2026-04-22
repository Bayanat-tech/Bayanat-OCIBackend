
import express from "express";
import { insPsUserRoleMappingBulk } from "../../controllers/ALMS/insPsUserRoleMappingBulk";
import { insPsFlowRoleMappingBulk } from "../../controllers/ALMS/insPsFlowRoleMappingBulk ";
import { proc_build_dynamic_ins_upd_ALMS } from "../../controllers/ALMS/insUpdPurchaseRequest";




const router = express.Router();

router.post(
  "/insUpdPurchaseRequest",
  proc_build_dynamic_ins_upd_ALMS
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
