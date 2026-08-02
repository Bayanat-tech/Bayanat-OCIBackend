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
  frtApprovalConfig,
  frtEnquiryApprove,
  frtEnquiryCancel,
  frtEnquiryDelete,
  frtEnquiryGet,
  frtEnquiryList,
  frtEnquirySave,
  frtEnquiryWorkflowAction,
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
  frtQuotationApprove,
  frtQuotationDelete,
  frtQuotationGet,
  frtQuotationList,
  frtQuotationSave,
  frtQuotationWorkflowAction,
} from "../../controllers/Freight/freightQuotationProcedures";
import {
  frtAirlineTariffDelete,
  frtAirlineTariffGet,
  frtAirlineTariffList,
  frtAirlineTariffReport,
  frtAirlineTariffSave,
} from "../../controllers/Freight/freightAirlineTariffProcedures";
import {
  frtJobSearch,
  frtWorkspaceSummary,
} from "../../controllers/Freight/freightWorkspaceProcedures";
import {
  frtJobCancel,
  frtJobGet,
  frtJobList,
  frtJobSave,
} from "../../controllers/Freight/freightJobProcedures";
import {
  frtPacklistDelete,
  frtPacklistDimList,
  frtPacklistDimSave,
  frtPacklistGet,
  frtPacklistJobs,
  frtPacklistList,
  frtPacklistSave,
} from "../../controllers/Freight/freightPacklistProcedures";
import {
  frtJobActivityConfirm,
  frtJobActivityDelete,
  frtJobActivityGet,
  frtJobActivityJobList,
  frtJobActivitySave,
} from "../../controllers/Freight/freightJobActivityProcedures";
import {
  frtJobAlertCodeList,
  frtJobAlertDelete,
  frtJobAlertInit,
  frtJobAlertList,
  frtJobAlertSave,
  frtJobDepositDelete,
  frtJobDepositList,
  frtJobDepositSave,
  frtJobDocDelete,
  frtJobDocInit,
  frtJobDocList,
  frtJobDocSave,
  frtJobInstructionCodeList,
  frtJobInstructionDelete,
  frtJobInstructionInit,
  frtJobInstructionList,
  frtJobInstructionSave,
} from "../../controllers/Freight/freightJobFollowupProcedures";
import { frtReportRun } from "../../controllers/Freight/freightReportProcedures";
import {
  frtInvoiceGet,
  frtInvoiceJobSelection,
  frtInvoiceList,
  frtInvoiceSave,
} from "../../controllers/Freight/freightInvoiceProcedures";
import { insUpdTfEnquiryBulk } from "../../controllers/Freight/insUpdTfEnquiryBulk";
import {
  frtAttachmentDelete,
  frtAttachmentList,
  frtAttachmentRename,
  frtAttachmentSave,
} from "../../controllers/Freight/freightAttachmentProcedures";

const router = express.Router();
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);


router.post(
  "/insUpdTfEnquiryBulk",
  insUpdTfEnquiryBulk 
);

router.post("/enquiry/list", frtEnquiryList);
router.post("/approval/config", frtApprovalConfig);
router.post("/enquiry/get", frtEnquiryGet);
router.post("/enquiry/save", frtEnquirySave);
router.post("/enquiry/workflow-action", frtEnquiryWorkflowAction);
router.post("/enquiry/approve", frtEnquiryApprove);
router.post("/enquiry/cancel", frtEnquiryCancel);
router.post("/enquiry/delete", frtEnquiryDelete);

router.post("/enquiry-activities/list", frtEnquiryActivityList);
router.post("/enquiry-activities/save", frtEnquiryActivitySave);
router.post("/enquiry-activities/delete", frtEnquiryActivityDelete);

router.post("/rfq/list", frtRfqList);
router.post("/rfq/get", frtRfqGet);
router.post("/rfq/save", frtRfqSave);
router.post("/rfq/workflow-action", frtEnquiryWorkflowAction);
router.post("/rfq/approve", frtEnquiryApprove);
router.post("/rfq/cancel", frtEnquiryCancel);
router.post("/rfq/delete", frtRfqDelete);

router.post("/rfq-activities/list", frtRfqActivityList);
router.post("/rfq-activities/save", frtRfqActivitySave);
router.post("/rfq-activities/delete", frtRfqActivityDelete);

router.post("/quotation/list", frtQuotationList);
router.post("/quotation/get", frtQuotationGet);
router.post("/quotation/save", frtQuotationSave);
router.post("/quotation/workflow-action", frtQuotationWorkflowAction);
router.post("/quotation/approve", frtQuotationApprove);
router.post("/quotation/delete", frtQuotationDelete);

router.post("/airline-tariff/list", frtAirlineTariffList);
router.post("/airline-tariff/get", frtAirlineTariffGet);
router.post("/airline-tariff/save", frtAirlineTariffSave);
router.post("/airline-tariff/delete", frtAirlineTariffDelete);
router.post("/airline-tariff/report", frtAirlineTariffReport);

router.post("/job/list", frtJobList);
router.post("/job/get", frtJobGet);
router.post("/job/save", frtJobSave);
router.post("/job/cancel", frtJobCancel);

router.post("/packlist/jobs", frtPacklistJobs);
router.post("/packlist/list", frtPacklistList);
router.post("/packlist/get", frtPacklistGet);
router.post("/packlist/save", frtPacklistSave);
router.post("/packlist/delete", frtPacklistDelete);
router.post("/packlist/dimensions/list", frtPacklistDimList);
router.post("/packlist/dimensions/save", frtPacklistDimSave);

router.post("/job-activities/jobs", frtJobActivityJobList);
router.post("/job-activities/get", frtJobActivityGet);
router.post("/job-activities/save", frtJobActivitySave);
router.post("/job-activities/delete", frtJobActivityDelete);
router.post("/job-activities/confirm", frtJobActivityConfirm);

router.post("/job-documents/list", frtJobDocList);
router.post("/job-documents/init", frtJobDocInit);
router.post("/job-documents/save", frtJobDocSave);
router.post("/job-documents/delete", frtJobDocDelete);

router.post("/job-instructions/codes", frtJobInstructionCodeList);
router.post("/job-instructions/list", frtJobInstructionList);
router.post("/job-instructions/init", frtJobInstructionInit);
router.post("/job-instructions/save", frtJobInstructionSave);
router.post("/job-instructions/delete", frtJobInstructionDelete);

router.post("/job-alerts/codes", frtJobAlertCodeList);
router.post("/job-alerts/list", frtJobAlertList);
router.post("/job-alerts/init", frtJobAlertInit);
router.post("/job-alerts/save", frtJobAlertSave);
router.post("/job-alerts/delete", frtJobAlertDelete);

router.post("/job-deposits/list", frtJobDepositList);
router.post("/job-deposits/save", frtJobDepositSave);
router.post("/job-deposits/delete", frtJobDepositDelete);

router.post("/attachments/list", frtAttachmentList);
router.post("/attachments/save", frtAttachmentSave);
router.post("/attachments/rename", frtAttachmentRename);
router.post("/attachments/delete", frtAttachmentDelete);

router.post("/reports/run", frtReportRun);

router.post("/invoice/list", frtInvoiceList);
router.post("/invoice/get", frtInvoiceGet);
router.post("/invoice/job-selection", frtInvoiceJobSelection);
router.post("/invoice/save", frtInvoiceSave);

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



