
import express from "express";
import { insUpdPurchaseRequest } from "../../controllers/ALMS/insUpdPurchaseRequest";
import { insPsUserRoleMappingBulk } from "../../controllers/ALMS/insPsUserRoleMappingBulk";




const router = express.Router();


router.post(
  "/insUpdPurchaseRequest",
  insUpdPurchaseRequest
);

router.post(
  "/insPsUserRoleMappingBulk",
  insPsUserRoleMappingBulk
);


export default router;
