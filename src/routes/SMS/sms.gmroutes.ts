import * as express from "express";
import { RequestWithUser } from "../../interfaces/common.interface";
import { insertSmsRecord, smsGmConfigs, updateSmsRecord } from "../../services/smsTenant.service";
import {
  batchCreateSalesRequest,
  batchUpdateSalesRequest,
} from "../../controllers/SMS/Transaction/salesRequest_sms.controller";

const router = express.Router();

function createMaster(endpoint: keyof typeof smsGmConfigs) {
  return async (req: RequestWithUser, res: express.Response) => {
    try {
      await insertSmsRecord(smsGmConfigs[endpoint], req.body, req.user.loginid);
      res.json({ success: true, message: "Record created successfully" });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };
}

function updateMaster(endpoint: keyof typeof smsGmConfigs) {
  return async (req: RequestWithUser, res: express.Response) => {
    try {
      await updateSmsRecord(smsGmConfigs[endpoint], req.body, req.user.loginid);
      res.json({ success: true, message: "Record updated successfully" });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };
}

router.post("/company_master", createMaster("company_master"));
router.put("/company_master", updateMaster("company_master"));

router.post("/service_master", createMaster("service_master"));
router.put("/service_master", updateMaster("service_master"));

router.post("/segment_master", createMaster("segment_master"));
router.put("/segment_master", updateMaster("segment_master"));

router.post("/sales_master", createMaster("sales_master"));
router.put("/sales_master", updateMaster("sales_master"));

router.post("/reason_master", createMaster("reason_master"));
router.put("/reason_master", updateMaster("reason_master"));

router.post("/deal_master", createMaster("deal_master"));
router.put("/deal_master", updateMaster("deal_master"));

router.post("/probability_master", createMaster("probability_master"));
router.put("/probability_master", updateMaster("probability_master"));

router.post("/sales_request", (req, res, next) => {
  (batchCreateSalesRequest as unknown as (req: express.Request, res: express.Response) => Promise<any>)(req, res).catch(next);
});

router.patch("/sales_request", (req, res, next) => {
  (batchUpdateSalesRequest as unknown as (req: express.Request, res: express.Response) => Promise<any>)(req, res).catch(next);
});

export default router;
