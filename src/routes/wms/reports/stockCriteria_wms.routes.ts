import * as express from "express"; // Importing the Express framework for building web applications.
import { checkUserAuthorization } from "../../../middleware/checkUserAthorization"; // Importing middleware to check user authorization.
import passport from "passport"; // Importing Passport for authentication.
import { exportStockDetailReportExcel, getStockDetailReportHtml } from "../../../controllers/wms/reports/stockDetailReportController";
import { getStockSummaryReportHtml, exportStockSummaryReportExcel } from "../../../controllers/wms/reports/StockSummaryReport.controller";
import {
  getStockAgeingQuantityReportHtml,
  exportStockAgeingQuantityReportExcel,
  getStockAgeingVolumeReportHtml,
  exportStockAgeingVolumeReportExcel,
} from "../../../controllers/wms/reports/Stockageingcontroller";
import { stockConfirmationReportExcel, stockConfirmationReportHtml, stockTransferReportExcel, stockTransferReportHtml } from "../../../controllers/wms/reports/stockTransferReportController";
// import { getStockDetailsReport } from "../../../controllers/wms/reports/stockCriteria/stock_details.controller"; // Importing the controller for handling stock details report requests.
// import { getSummaryStockReport } from "../../../controllers/wms/reports/stockCriteria/summary_stock.controller"; // Importing the controller for handling summary stock report requests.
// import { getAgeingStockReport } from "../../../controllers/wms/reports/stockCriteria/ageing_stock.controller"; // Importing the controller for handling ageing stock report requests.
const 
router = express.Router(); // Creating a new router instance.

router.get(
  "/stocktransfer-report/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  stockTransferReportHtml
);
router.get(
  "/stocktransfer-report/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  stockTransferReportExcel
);
router.get(
  "/stockconfirmation-report/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  stockConfirmationReportHtml
);
router.get(
  "/stockconfirmation-report/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  stockConfirmationReportExcel
)
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

// ----------- stock details report ------------
// Route to get stock details report
// router.get(
//   "/stock-criteria/detailstock",
//   passport.authenticate("jwt", { session: false }), // Authenticate using JWT without session
//   checkUserAuthorization, // Middleware to check if the user is authorized
//   getStockDetailsReport // Controller function to handle the request
// );

// ---------- summary report ------------
// Route to get summary stock report
// router.get(
//   "/stock-criteria/summarystock",
//   passport.authenticate("jwt", { session: false }), // Authenticate using JWT without session
//   checkUserAuthorization, // Middleware to check if the user is authorized
//   getSummaryStockReport // Controller function to handle the request
// );

// ---------- Ageing Report ---------
// Route to get ageing stock report
// router.get(
//   "/stock-criteria/aging",
//   passport.authenticate("jwt", { session: false }), // Authenticate using JWT without session
//   getAgeingStockReport // Controller function to handle the request
// );

export default router; // Exporting the router to be used in other parts of the application.
