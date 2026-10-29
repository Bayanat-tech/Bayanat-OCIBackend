
import express from "express";
import { insPsUserRoleMappingBulk } from "../../controllers/ALMS/insPsUserRoleMappingBulk";
import { insPsFlowRoleMappingBulk } from "../../controllers/ALMS/insPsFlowRoleMappingBulk";
import { insUpdTtePrequestBulk } from "../../controllers/ALMS/insUpdTtePrequestBulk";
// import { getPrRegisterDetailReportExcel, getPrRegisterDetailReportHtml, getPrRegisterSummaryReportExcel, getPrRegisterSummaryReportHtml } from "../../controllers/ALMS/PurchaseRequestReports";

const router = express.Router();


// router.post('/reports/PR_Register_Summary/html', getPrRegisterSummaryReportHtml);
// router.post('/reports/PR_Register_Summary/excel', getPrRegisterSummaryReportExcel);

// router.post('/reports/PR_Register_Details/html', getPrRegisterDetailReportHtml);
// router.post('/reports/PR_Register_Details/excel', getPrRegisterDetailReportExcel);


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
