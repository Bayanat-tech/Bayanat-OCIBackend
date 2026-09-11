import express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { createWaybillRequest, listWaybillRequests } from "../controllers/vms/waybill.controller";

const router = express.Router();
const secured = [
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
];

router.get("/waybill-requests", ...secured, listWaybillRequests);
router.post("/waybill-requests", ...secured, createWaybillRequest);

export default router;
