import * as express from "express";
import { checkUserAuthorization } from "../../../middleware/checkUserAthorization";
import passport from "passport";
import {
  exportStockDetailReportExcel,
  getStockDetailReportHtml,
} from "../../../controllers/wms/reports/stockDetailReportController";
import {
  getStockSummaryReportHtml,
  exportStockSummaryReportExcel,
} from "../../../controllers/wms/reports/StockSummaryReport.controller";
import {
  getStockAgeingQuantityReportHtml,
  exportStockAgeingQuantityReportExcel,
  getStockAgeingVolumeReportHtml,
  exportStockAgeingVolumeReportExcel,
} from "../../../controllers/wms/reports/Stockageingcontroller";
import {
  getStockConfirmationReportHtml,
  exportStockConfirmationReportExcel,
  getStockTransferReportHtml,
  exportStockTransferReportExcel,
} from "../../../controllers/wms/reports/stockTransferReportController";
import { getSalaryAdvDedReportHtml } from "../../../controllers/wms/reports/SalaryAdvDedReport.controller";
import { getAbsentMemoReportHtml } from "../../../controllers/wms/reports/AbsentMemoReport.controller";
import { getRetirementReportHtml } from "../../../controllers/wms/reports/RetirementReportController";
import { getAbsenceReportHtml } from "../../../controllers/wms/reports/AbsenceReport.controller";
import { getDocumentReportHtml } from "../../../controllers/wms/reports/HrDocumentReport.controller";
import { getLabourCardExpiryReportHtml } from "../../../controllers/wms/reports/HrLabourExpiryCard.controller";
import { getEmployeeHeadCountReportHtml } from "../../../controllers/wms/reports/HrEmployeeHeadCountList.controller";
import { getSalaryRegisterHtml } from "../../../controllers/wms/reports/SalaryRegister.controller";
import { getHrVarianceReportHtml } from "../../../controllers/wms/reports/VarianceReport.controller";
import { getHrEmployeeDetailsHtml } from "../../../controllers/wms/reports/EmployeeDetails.controller";
import { getHrEmployeeWiseCostHtml } from "../../../controllers/wms/reports/EmployeeWiseCostReport.controller";


import { getSectionMasterReportHtml } from "../../../controllers/wms/reports/HrSectionMasterReport.controller";

import { getFormalDesignationReportHtml } from "../../../controllers/wms/reports/HrFormalDesignationReport.controller";

import { getCategoryReportHtml } from "../../../controllers/wms/reports/HrCategoryReport.controller";

const router = express.Router();

// ─── Stock Transfer ───────────────────────────────────────────────────────────

router.get(
  "/stocktransfer-report/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getStockTransferReportHtml
);

router.get(
  "/stocktransfer-report/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  exportStockTransferReportExcel
);

// ─── Stock Confirmation ───────────────────────────────────────────────────────

router.get(
  "/stockconfirmation-report/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getStockConfirmationReportHtml
);

router.get(
  "/stockconfirmation-report/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  exportStockConfirmationReportExcel
);

// ─── Stock Details ────────────────────────────────────────────────────────────

router.post(
  "/stockdetails/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getStockDetailReportHtml
);

router.post(
  "/stockdetails/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  exportStockDetailReportExcel
);

// ─── Stock Summary ────────────────────────────────────────────────────────────

router.post(
  "/stocksummary/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getStockSummaryReportHtml
);

router.post(
  "/stocksummary/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  exportStockSummaryReportExcel
);

// ─── Stock Ageing (Quantity) ──────────────────────────────────────────────────

router.post(
  "/stockageing/quantity/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getStockAgeingQuantityReportHtml
);

router.post(
  "/stockageing/quantity/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  exportStockAgeingQuantityReportExcel
);

// ─── Stock Ageing (Volume) ────────────────────────────────────────────────────

router.post(
  "/stockageing/volume/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getStockAgeingVolumeReportHtml
);

router.post(
  "/stockageing/volume/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  exportStockAgeingVolumeReportExcel
);

// ─── Salary Addition / Deduction ──────────────────────────────────────────────

router.post(
  "/salary-adv-ded/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getSalaryAdvDedReportHtml
);

// ─── Absent Memo ──────────────────────────────────────────────────────────────

router.post(
  "/absent-memo/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getAbsentMemoReportHtml
);

// 👇 NEW SECTION MASTER REPORT ROUTE ADDED HERE
router.post(
  "/section-master/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getSectionMasterReportHtml
);
// ─────────────────────────────────────────────────────────────────────────────

// ─── Retirement Report ────────────────────────────────────────────────────────

router.get(
  "/hr/retirement/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getRetirementReportHtml
);

router.post(
  "/hr/retirement/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getRetirementReportHtml
);

// ─── Salary Register Report ───────────────────────────────────────────────────

router.get(
  "/hr/salary-register/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getSalaryRegisterHtml
);

router.post(
  "/hr/salary-register/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getSalaryRegisterHtml
);

// ─── HR Variance Report ───────────────────────────────────────────────────────

router.get(
  "/hr/variance-report/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getHrVarianceReportHtml
);

router.post(
  "/hr/variance-report/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getHrVarianceReportHtml
);

// ─── HR Employee Details Report ───────────────────────────────────────────────

router.get(
  "/hr/employee-details/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getHrEmployeeDetailsHtml
);

router.post(
  "/hr/employee-details/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getHrEmployeeDetailsHtml
);

// ─── Employee Wise Cost Report ────────────────────────────────────────────────

router.get(
  "/hr/employee-wise-cost/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getHrEmployeeWiseCostHtml
);

router.post(
  "/hr/employee-wise-cost/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getHrEmployeeWiseCostHtml
);

// ─── Absence Report ───────────────────────────────────────────────────────────

router.get(
  "/hr/absence/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getAbsenceReportHtml
);

router.post(
  "/hr/absence/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getAbsenceReportHtml
);

// ─── HR Document Report ───────────────────────────────────────────────────────

router.get(
  "/hr/document/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getDocumentReportHtml
);

router.post(
  "/hr/document/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getDocumentReportHtml
);

// ─── Labour Card Expiry Listing Report ────────────────────────────────────────

router.get(
  "/hr/labour-card-expiry/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getLabourCardExpiryReportHtml
);

router.post(
  "/hr/labour-card-expiry/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getLabourCardExpiryReportHtml
);

// ─── Employee Head Count List Report ──────────────────────────────────────────

router.get(
  "/hr/employee-head-count/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getEmployeeHeadCountReportHtml
);

router.post(
  "/hr/employee-head-count/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getEmployeeHeadCountReportHtml
);

router.post(
  "/formal-designation/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getFormalDesignationReportHtml
);

router.post(
  "/category/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getCategoryReportHtml
);

export default router;