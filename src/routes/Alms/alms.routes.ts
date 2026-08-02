
import express from "express";
import { insPsUserRoleMappingBulk } from "../../controllers/ALMS/insPsUserRoleMappingBulk";
import { insPsFlowRoleMappingBulk } from "../../controllers/ALMS/insPsFlowRoleMappingBulk ";
import { insUpdTtePrequestBulk } from "../../controllers/ALMS/insUpdTtePrequestBulk";





const router = express.Router();

router.post(
  "/insUpdTtePrequestBulk",
  insUpdTtePrequestBulk
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
