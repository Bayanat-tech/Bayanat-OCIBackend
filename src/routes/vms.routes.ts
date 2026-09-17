import express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { createWaybillRequest, listWaybillRequests } from "../controllers/vms/waybill.controller";
import { deleteWaybillMaster, listWaybillMaster, saveWaybillMaster } from "../controllers/vms/waybillMasters.controller";
import { getWaybillBilling, processWaybillBilling, reviewWaybillRevenue, saveWaybillBillingSettings } from "../controllers/vms/waybillBilling.controller";

const router = express.Router();
const secured = [
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  checkUserAuthorization,
];

router.get("/waybill-requests", ...secured, listWaybillRequests);
router.post("/waybill-requests", ...secured, createWaybillRequest);
router.get("/waybill-revenue", ...secured, getWaybillBilling);
router.post("/waybill-revenue/process", ...secured, processWaybillBilling);
router.put("/waybill-revenue/settings", ...secured, saveWaybillBillingSettings);
router.put("/waybill-revenue/:id/review", ...secured, reviewWaybillRevenue);

for (const kind of ["rates", "wells", "distances"] as const) {
  router.get(`/waybill-masters/${kind}`, ...secured, listWaybillMaster(kind));
  router.post(`/waybill-masters/${kind}`, ...secured, saveWaybillMaster(kind));
  router.put(`/waybill-masters/${kind}/:id`, ...secured, saveWaybillMaster(kind, true));
  router.delete(`/waybill-masters/${kind}/:id`, ...secured, deleteWaybillMaster(kind));
}

export default router;
