
/**
 * @fileoverview Inbound WMS Routes - Handles all inbound warehouse management system routes
 * @requires express
 * @requires passport
 */

import * as express from "express";
import passport from "passport";
import {
  // getInboundJob,
  // getReports,
  getTallyProductData,
} from "../../../controllers/wms/transaction/inbound/inboundJobWms.controller";
import {
  createBulkPAckingDetails, // Create multiple packing details at once
  createPackingItem, // Create single packing item
  deletePackingItem, // Delete packing item
  exportPackingDetails, // Export packing details
  getPackingDetail, // Get packing details
  updatePackingItem, // Update packing item
  addReceivingDetails, // Add receiving details (qty1_arrived, qty2_arrived)
  updateClearanceStatus, // Update clearance status to 'Y'
} from "../../../controllers/wms/transaction/inbound/packingDetails_wms.controller";
import {
  // createBulkTallyDetails, // Create multiple tally details
  createTallyItem,
  deleteTallyItem, // Create single tally item
  // deleteTallyItem, // Delete tally item
  // exportTallyDetails, // Export tally details
  // getTallyDetail, // Get tally details
  // updateTallyItem, // Update tally item
} from "../../../controllers/wms/transaction/inbound/tallyDetails_wms.controller";

import {
  createBulkShipmentDetails, // Create multiple shipment details
  createShipmentItem, // Create single shipment item
  deleteShipmentItem, // Delete shipment item
  exportShipmentDetails, // Export shipment details
  getAllShipmentDetails, // Get all shipment details with pagination
  getShipmentDetail, // Get shipment details
  updateShipmentItem, // Update shipment item
} from "../../../controllers/wms/transaction/inbound/shipmentdetails_wms.controller";
import {
  exportPutwayPackingItem, // Export putway packing items
  putwayPackingItem, // Update putway packing item
} from "../../../controllers/wms/transaction/inbound/putwayPackingItem_wms.controller";
import { checkUserAuthorization } from "../../../middleware/checkUserAthorization"; // Middleware for user authorization
// import { updateQualityclearance } from "../../../controllers/wms/transaction/inbound/qualityClearance_wms.controller";
import createinboundjobWms from "../../../views/wms/transportation/inbound/createinboundJobWms";
import {executeRawSql, executeRawSqlbody, proc_build_dynamic_sql_wms} from "../../../../src/controllers/wms.controller"
import {createInboundjob} from "../../../controllers/wms/transaction/inbound/createinboundJobWms.controller";
 import {Putawaywithpalletid} from "../../../../src/controllers/wms/transaction/inbound/putwaywithtally_wms_controller"
// import  { getddSiteLocation }   from "../../../../src/views/wms/transportation/inbound/ddSiteLocation"
import  {getddPrinceProduct }   from "../../../../src/views/wms/transportation/inbound/ddPrinceProduct"
import {
  getInboundJob, // Get single inbound job
  GetsingleInboundjob, // Update inbound job
  cancelConfirmedInboundJob, // Cancel confirmed inbound job
} from "../../../controllers/wms/transaction/inbound/createinboundJobWms.controller";
import {
  // getconfirmInboundjob, // Get confirmation details
  confirmInboundjob, // Confirm inbound job
} from "../../../controllers/wms/transaction/inbound/confirminboundjob_wms.controller";
import { createOrUpdateJob ,editJob} from "../../../controllers/wms/transaction/outbound/createTojob";
//import { upsertTIJobHandler } from "../../../controllers/Purchaseflow/updateinsertti_job";
//import { createOrUpdateJob } from "../../../controllers/wms/transaction/outbound/createTojob";
// import {
//   getconfirmInboundjob, // Get confirmation details
//   confirmInboundjob, // Confirm inbound job
// } from "../../../controllers/wms/transaction/inbound/confirminboundjob_wms.controller";
import {cancelInboundJob} from "../../../controllers/wms/transaction/inbound/createinboundJobWms.controller"
import {upsertPackDetailEDIHandler,getEDIPackdetHandler,copyEDIToPackdetHandler} from "../../../controllers/wms/transaction/inbound/packdet_wms.controller";
import {upsertPutawaymanualHandler} from "../../../controllers/wms/transaction/inbound/manualputaway.controller";
import { insUpdMsProductEdiBulk } from "../../../controllers/wms/transaction/inbound/insUpdMsProductEdit.controller";
import { insUpdMsLocationEdiBulk } from "../../../controllers/wms/transaction/inbound/insUpdMsLocationEdiBulk";
import { insUpdMsSiteEdiBulk } from "../../../controllers/wms/transaction/inbound/insUpdMsSiteEdiBulk";
import { insUpdTcStockCountBulk } from "../../../controllers/stockcount/insUpdTcStockCountBulk";
import { insUpdTcCountDetailsBulk } from "../../../controllers/stockcount/insUpdTcCountDetailsBulk";
import { insUpdTsStnDetailEdiBulk } from "../../../controllers/StockTransfer/insUpdTsStnDetailEdiBulk";
import { upsertMsPrincipal } from "../../../controllers/wms/transaction/inbound/upsertMsPrincipal";
import { upsertMsActivityBilling } from "../../../controllers/wms/transaction/inbound/upsertMsActivityBilling";
import { upsertMsProduct } from "../../../controllers/wms/transaction/inbound/upsertMsProduct";
import { getWmsJobDetailsReportExcel, getWmsJobDetailsReportHtml } from "../../../controllers/wms/reports/job_detailsReport.controller";
import { getTallyPutawayReportExcel, getTallyPutawayReportHtml } from "../../../controllers/wms/reports/Putawayreport.controller";
import { getGrnReportExcel, getGrnReportHtml } from "../../../controllers/wms/reports/GrnReport.controller";
import { getTallyReportExcel, getTallyReportHtml } from "../../../controllers/wms/reports/TallReport.controller";
import { getStockSummaryReportHtml, exportStockSummaryReportExcel } from "../../../controllers/wms/reports/StockSummaryReport.controller";
import { getWmsInboundServiceActivityReportExcel, getWmsInboundServiceActivityReportHtml } from "../../../controllers/wms/reports/Inboundserviceactivityreport.controller";
import { getWmsAdjConfirmReportExcel, getWmsAdjConfirmReportHtml } from "../../../controllers/wms/reports/Adjustmentconfirmreport.controller";
import { getWmsInvoiceDetailReportExcel, getWmsInvoiceDetailReportHtml } from "../../../controllers/wms/reports/Wmsinvoicedetailreport.controller";
import { getGrnSummaryReportExcel, getGrnSummaryReportHtml } from "../../../controllers/wms/reports/GrnSummaryreport.controller";
const router = express.Router();

router.put("/upsertPackDetailEDIHandler", upsertPackDetailEDIHandler);
router.get("/getEDIPackdetHandler", getEDIPackdetHandler);
router.post("/copyEDIToPackdetHandler", copyEDIToPackdetHandler);
router.post("/upsertPutawaymanualHandler", upsertPutawaymanualHandler);
router.post('/executeRawSql', executeRawSql);
router.post('/executeRawSqlbody', executeRawSqlbody);
router.post("/proc_build_dynamic_sql_wms", proc_build_dynamic_sql_wms);

// router.get('/getddSiteLocation',getddSiteLocation)

router.get('/getddPrinceProduct',getddPrinceProduct)
// router.get('/getEDIPackdetHandler', getEDIPackdetHandler);
// router.post('/copyEDIToPackdetHandler', copyEDIToPackdetHandler);

// Job routes - Handle individual job operations
router.get(
  "/job/:job_no",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getInboundJob
);

// Update inbound job
router.put(
  "/job/:job_no",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  GetsingleInboundjob
);

// Inbound Job routes - Handle creation and retrieval of inbound jobs
router.post("/inboundjob", createOrUpdateJob);
router.put("/editInboundJob/:job_no", editJob); 
router.patch("/canceljob", cancelInboundJob)

// Cancel confirmed inbound job route
router.post(
  "/cancel_confirmed_job",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  cancelConfirmedInboundJob
);

router.put("/inboundjob",createOrUpdateJob);


//router.put("/inboundjob", GetsingleInboundjob);

// router.put(
//   "/inboundjob",
//   passport.authenticate("jwt", { session: false }),
//   checkUserAuthorization,
//   GetsingleInboundjob
// );

// --------- Shipment Details---------
router.get("/shipment_details/export", exportShipmentDetails);
router.get(
  "/shipment_details",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  getAllShipmentDetails
);
router.post(
  "/shipment_details",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  createShipmentItem
);
router.put(
  "/shipment_details",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  updateShipmentItem
);
router.post("/shipment_details/bulk", createBulkShipmentDetails);
router.post(
  "/shipment_details/delete",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deleteShipmentItem
);

// --------- Packing Details ---------
router.get("/packing_details", getPackingDetail);

router.post(
  "/packing_details",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  createPackingItem
);

// ADD RECEIVING DETAILS - SPECIFIC ROUTE FIRST
router.put(
  "/packing_details/receiving",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  addReceivingDetails
);

// UPDATE CLEARANCE - SPECIFIC ROUTE
router.put(
  "/packing_details/clearance",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  updateClearanceStatus
);

// UPDATE PACKING ITEM - GENERIC ROUTE SECOND
router.put(
  "/packing_details/:packdet_no",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  updatePackingItem
);


// Bulk operations and delete
router.post("/packing_details/bulk", createBulkPAckingDetails);
router.post(
  "/packing_details/delete",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deletePackingItem
);

// Tally Details routes - Handle all tally related operations
// router.get("/tally_details/export", exportTallyDetails);
// router.get("/tally_details", getTallyDetail);
router.get("/tally_product_data", getTallyProductData);

router.post(
   "/Putawaywithpalletid",  
   Putawaywithpalletid
 );
 
router.post(
   "/insUpdMsProductEdiBulk",
   insUpdMsProductEdiBulk);

router.post(
   "/upsertMsProduct",
   upsertMsProduct);

router.put(
   "/upsertMsActivityBilling",
   upsertMsActivityBilling );

// for principal master
   router.post(
   "/upsertMsPrincipal",
   upsertMsPrincipal);

router.post(
  "/insUpdMsLocationEdiBulk",
  insUpdMsLocationEdiBulk
);
router.post(
   "/insUpdMsSiteEdiBulk",
   insUpdMsSiteEdiBulk);
   
   router.post(
   "/insUpdTcStockCountBulk",
   insUpdTcStockCountBulk );

     router.post(
   "/insUpdTcCountDetailsBulk",
  insUpdTcCountDetailsBulk  );

 router.post(
   "/insUpdTsStnDetailEdiBulk",
  insUpdTsStnDetailEdiBulk  );



   


router.post(
  "/tally_details",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  createTallyItem
);
// router.post("/tally_details/bulk", createBulkTallyDetails);
router.post(
  "/tally_details/delete",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  deleteTallyItem
);
// router.put(
//   "/tally_details/:packdet_no/:seq_number",
//   passport.authenticate("jwt", { session: false }),
//   checkUserAuthorization,
//   updateTallyItem
// );

// Quality Clearance routes - Handle quality clearance operations
// router.put(
//   "/quality_clearance",
//   passport.authenticate("jwt", { session: false }),
//   checkUserAuthorization,
//   updateQualityclearance
// );

// Putway routes - Handle putway operations
router.get("/putway_details/export", exportPutwayPackingItem);
router.put(
  "/putway_details/:job_no",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  putwayPackingItem
);

// Job Confirmation routes - Handle job confirmation operations
// router.get("/job_confirmation", getconfirmInboundjob);
router.put(
  "/job_confirmation/:job_no", // This expects `job_no` as a URL parameter
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  confirmInboundjob
);

// --------- Reports ---------
router.get(
  "/report/grn",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  // getReports
);

//job details report route
router.get("/reports/job-details/:job_no", getWmsJobDetailsReportHtml);
// router.get("/reports/job-details/:job_no/pdf",    getWmsJobDetailsReportPdf);
router.get("/reports/job-details/:job_no/excel",  getWmsJobDetailsReportExcel);

//putaway report route
router.get("/reports/tally-putaway/:job_no", getTallyPutawayReportHtml)
router.get("/reports/tally-putaway/:job_no/excel",getTallyPutawayReportExcel)

//Grn report route
router.get("/reports/Grn-report/:job_no", getGrnReportHtml)
router.get("/reports/Grn-report/:job_no/excel",getGrnReportExcel)

//Tally report route
router.get("/reports/Tally-report/:job_no", getTallyReportHtml)
router.get("/reports/Tally-report/:job_no/excel",getTallyReportExcel)

// Stock Summary report routes
router.post("/reports/stocksummary/html", getStockSummaryReportHtml);
router.post("/reports/stocksummary/excel", exportStockSummaryReportExcel);

//inbound service activity report routes 
router.get("/reports/inb-serviceactivity/:job_no", getWmsInboundServiceActivityReportHtml);
router.get("/reports/inb-serviceactivity/:job_no/excel", getWmsInboundServiceActivityReportExcel);

//inbound service activity report routes 
router.get("/reports/AdjConfirmation_report/:adj_no", getWmsAdjConfirmReportHtml);
router.get("/reports/AdjConfirmation_report/:adj_no/excel", getWmsAdjConfirmReportExcel);

//invoce report 
router.get("/reports/invoice-detail/html", getWmsInvoiceDetailReportHtml);
router.get("/reports/invoice-detail/excel", getWmsInvoiceDetailReportExcel);

// inbound Grn Summary report
// router.post('/reports/GrnSummaryReport/html', getGrnSummaryReportHtml);
// router.post('/reports/GrnSummaryReport/excel', getGrnSummaryReportExcel);

export default router;