import * as express from "express";
import passport from "passport";
import { Router } from "express";

import { tenantContextMiddleware } from "../../../src/middleware/tenantContext.middleware";
import { tenantMiddleware } from "../../../src/middleware/tenant.middleware";
import {
  proc_build_dynamic_del_FREIGHT,
  proc_build_dynamic_ins_upd_FREIGHT,
  proc_build_dynamic_sql_FREIGHT,
} from "../../controllers/Freight/freightDynamicProcedures";
import {
  frtEnquiryCancel,
  frtEnquiryDelete,
  frtEnquiryGet,
  frtEnquiryList,
  frtEnquirySave,
} from "../../controllers/Freight/freightEnquiryProcedures";
import {
  frtEnquiryActivityDelete,
  frtEnquiryActivityList,
  frtEnquiryActivitySave,
} from "../../controllers/Freight/freightEnquiryActivityProcedures";
import {
  frtRfqDelete,
  frtRfqGet,
  frtRfqList,
  frtRfqSave,
} from "../../controllers/Freight/freightRfqProcedures";
import {
  frtRfqActivityDelete,
  frtRfqActivityList,
  frtRfqActivitySave,
} from "../../controllers/Freight/freightRfqActivityProcedures";
import {
  frtQuotationDelete,
  frtQuotationGet,
  frtQuotationList,
  frtQuotationSave,
} from "../../controllers/Freight/freightQuotationProcedures";
import {
  frtJobSearch,
  frtWorkspaceSummary,
} from "../../controllers/Freight/freightWorkspaceProcedures";
import { insUpdTfEnquiryBulk } from "../../controllers/Freight/insUpdTfEnquiryBulk";

const router = express.Router();
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);


router.post(
  "/insUpdTfEnquiryBulk",
  insUpdTfEnquiryBulk 
);

router.post("/enquiry/list", frtEnquiryList);
router.post("/enquiry/get", frtEnquiryGet);
router.post("/enquiry/save", frtEnquirySave);
router.post("/enquiry/cancel", frtEnquiryCancel);
router.post("/enquiry/delete", frtEnquiryDelete);

router.post("/enquiry-activities/list", frtEnquiryActivityList);
router.post("/enquiry-activities/save", frtEnquiryActivitySave);
router.post("/enquiry-activities/delete", frtEnquiryActivityDelete);

router.post("/rfq/list", frtRfqList);
router.post("/rfq/get", frtRfqGet);
router.post("/rfq/save", frtRfqSave);
router.post("/rfq/cancel", frtEnquiryCancel);
router.post("/rfq/delete", frtRfqDelete);

router.post("/rfq-activities/list", frtRfqActivityList);
router.post("/rfq-activities/save", frtRfqActivitySave);
router.post("/rfq-activities/delete", frtRfqActivityDelete);

router.post("/quotation/list", frtQuotationList);
router.post("/quotation/get", frtQuotationGet);
router.post("/quotation/save", frtQuotationSave);
router.post("/quotation/delete", frtQuotationDelete);

router.post("/workspace/summary", frtWorkspaceSummary);
router.post("/workspace/job-search", frtJobSearch);

router.post(
  "/gm/proc_build_dynamic_sql_freight",
  proc_build_dynamic_sql_FREIGHT
);

router.post(
  "/gm/proc_build_dynamic_ins_upd_freight",
  proc_build_dynamic_ins_upd_FREIGHT
);

router.post(
  "/gm/proc_build_dynamic_del_freight",
  proc_build_dynamic_del_FREIGHT
);


 export default router;



