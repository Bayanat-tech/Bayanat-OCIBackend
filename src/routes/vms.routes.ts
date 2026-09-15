import express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { createWaybillRequest, listWaybillRequests } from "../controllers/vms/waybill.controller";
import { listWaybillMaster, saveWaybillMaster } from "../controllers/vms/waybillMasters.controller";

const router = express.Router();
const secured = [
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
];

router.get("/waybill-requests", ...secured, listWaybillRequests);
router.post("/waybill-requests", ...secured, createWaybillRequest);

for (const kind of ["rates", "wells", "distances"] as const) {
  router.get(`/waybill-masters/${kind}`, ...secured, listWaybillMaster(kind));
  router.post(`/waybill-masters/${kind}`, ...secured, saveWaybillMaster(kind));
  router.put(`/waybill-masters/${kind}/:id`, ...secured, saveWaybillMaster(kind, true));
}

export default router;
