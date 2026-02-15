
import express from "express";
import { insUpdPurchaseRequest } from "../../controllers/ALMS/insUpdPurchaseRequest";




const router = express.Router();


router.post(
  "/insUpdPurchaseRequest",
  insUpdPurchaseRequest
);

export default router;
