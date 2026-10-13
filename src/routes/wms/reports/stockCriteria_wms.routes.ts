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

// ─── Retirement Report ────────────────────────────────────────────────────────

router.get(
  "/hr/retirement/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getRetirementReportHtml
);

// Optional: also allow POST for parity with other routes
router.post(
  "/hr/retirement/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getRetirementReportHtml
);

export default router;