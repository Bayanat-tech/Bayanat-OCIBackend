/**
 * @fileoverview Inbound WMS Routes - Handles all inbound warehouse management system routes
 * @requires express
 * @requires passport
 */

import * as express from "express";
import passport from "passport";
// Update the import path if the middleware is located elsewhere, for example:
import { tenantMiddleware } from "../../../middleware/tenant.middleware";
import { tenantContextMiddleware } from "../../../middleware/tenantContext.middleware";
import { insUpdTrAcJVBulk } from "../../../controllers/finance/accounts/transactions/insUpdTrAcJVBulk";
import { procBulkAccountEntry } from "../../../controllers/finance/accounts/transactions/procBulkAccountEntry";
import {
  exportFinanceDocumentReportExcel,
  getFinanceDocumentReportHtml
} from "../../../controllers/finance/accounts/transactions/financeDocumentReport.controller";
import { exportBalanceSheetReportExcel, getBalanceSheetReportHtml } from "../../../controllers/finance/accounts/accounts-report/getBalanceSheetReport";
import {
  getChequeDetail,
  getChequePaymentDetail,
  getChequePaymentHeader,
  getChildTableName,
  getCompanyInfo,
  getDefaultTransactionDetails,
  getPurchaseHeader,
  getTransactionChildren,
  createBulkTransactionDocument,
  createChequePaymentDocument,
  createChequePaymentStoreProcess,
  updateChequePaymentDocument,
  updatePurchaseDocument,
  cancelDocument,
  deleteDocument,
  deleteDetailItem,
  deleteChildrenItem,
  createPurchaseDocument,
  createLPODocument,
  createSalesDocument,
  getInvoiceOutstandingBalances,
  getDocAccounts,
  getLpoDoc,
  getLPOHeader,
  getLPOPrint,
  getLpoDetail,
  updateLPODocument,
  cancelLPODocument
} from "../../../controllers/finance/accounts/transactions/transactionFinance.controller";
import { exportAcTrialBalanceReportExcel, exportTrialBalanceReportExcel, getAcTrialBalanceReportHtml, getTrialBalanceReportHtml } from "../../../controllers/finance/accounts/transactions/trailBalanceReport";
import { getChequeMonitoringReport } from "../../../controllers/finance/accounts/accounts-report/AccontReportCheque";
import { getLedgerWithDetailsReport } from "../../../controllers/finance/accounts/accounts-report/ledgerwithdetailsreport";
import { getLedgerWithOppositeEntryReport } from "../../../controllers/finance/accounts/accounts-report/ledgerwithoppositeentryreport";
import { getSummaryDumpReport } from "../../../controllers/finance/accounts/accounts-report/summarydumpreport";
import { getBalanceSheetDrilldownAc, getBalanceSheetDrilldownAcExcel, getBalanceSheetDrilldownDetail, getBalanceSheetDrilldownDetailExcel } from "../../../controllers/finance/accounts/accounts-report/balanceSheetDrilldown.controller";

import { getDetailDumpReport } from "../../../controllers/finance/accounts/accounts-report/detaildumpreport";
import { getAccountPayeeWiseReport } from "../../../controllers/finance/accounts/accounts-report/accountpayeewisereport";
import { getChequeDateWiseReport } from "../../../controllers/finance/accounts/accounts-report/chequedatewisereport";
// import { getProfitLossReport } from "../../../controllers/finance/accounts/accounts-report/ProfitLossReport";
// Initialize Express router
import { InvdatewiseDetail } from "../../../controllers/finance/accounts/accounts-report/InvdatewiseDetail";
import { InvdatewiseSummary } from "../../../controllers/finance/accounts/accounts-report/Invdatewisesummary";
import { DuedatewiseDetail } from "../../../controllers/finance/accounts/accounts-report/Duedatewisedetail";
import { DuedatewiseSummary } from "../../../controllers/finance/accounts/accounts-report/Duedatewisesummary";
import { OutstandingList } from "../../../controllers/finance/accounts/accounts-report/Outstandinglist";
import { AcStatementReport } from "../../../controllers/finance/accounts/accounts-report/AC_StatementReport";
import { OutstandingDetailReport } from "../../../controllers/finance/accounts/accounts-report/OutstandingDetailReport";
import { OutstandingSummaryReport } from "../../../controllers/finance/accounts/accounts-report/OutstandingSummaryReport";
import { getTaxInvoiceSummaryReport } from "../../../controllers/finance/accounts/accounts-report/tax-report/taxoutsummaryledger";
import { getTransactionProductReport } from "../../wms/reports/TransactionProductReport";
import { getJobListingReport } from "../../../controllers/wms/reports/stockCriteria/joblistingreport";
import { exportJobListingExcel } from "../../../controllers/wms/reports/stockCriteria/joblistingexcel";
import { getVisaExpiryReport } from "../../../controllers/HR/Hr-Reports/Visaexpiryreport";
import { getDnSummaryReportExcel, getDnSummaryReportHtml } from "../../../controllers/wms/reports/Dnsummaryreport";
import { getDrilldownAc, getDrilldownAcExcel, getDrilldownDetail, getDrilldownDetailExcel, getDrilldownL2, getDrilldownL2Excel, getDrilldownL3, getDrilldownL3Excel, getDrilldownL4, getDrilldownL4Excel } from "../../../controllers/finance/accounts/transactions/trailBalanceSubLevel";
import { getProfitLossReportExcel, getProfitLossReportHtml } from "../../../controllers/finance/accounts/accounts-report/Profitlossreport";
import { getPnlDrilldownL2, getPnlDrilldownL2Excel, getPnlDrilldownL3, getPnlDrilldownL3Excel } from "../../../controllers/finance/accounts/accounts-report/ProfitlossSublevel";
import { exportTaxInvoiceExcel } from "../../../controllers/finance/accounts/accounts-report/tax-report/taxoutledgerexcel";
import { exportTaxInvoiceSummaryExcel } from "../../../controllers/finance/accounts/accounts-report/tax-report/taxoutsummaryledgerexcel";
import { exportChequeDateWiseExcel } from "../../../controllers/finance/accounts/accounts-report/chequedatewiseexcel";
import { exportAccountPayeeWiseExcel } from "../../../controllers/finance/accounts/accounts-report/aaccountpayeewiseexcel";
import { getTaxInvoiceReport } from "../../../controllers/finance/accounts/accounts-report/tax-report/taxoutledger";
import { exportTransactionProductExcel } from "../../wms/reports/TransactionProductExcel";
import { exportDueDetailExcel, exportDueSummaryExcel, exportInvDetailExcel, exportInvSummaryExcel, exportOutstandingListExcel } from "../../../controllers/finance/accounts/accounts-report/PeriodwiseExcel";
import { exportAcStatementExcel } from "../../../controllers/finance/accounts/accounts-report/Acstatementexcel";
import { exportOutstandingDetailExcel, exportOutstandingSummaryExcel } from "../../../controllers/finance/accounts/accounts-report/Outstandingexcel";
import { exportLedgerWithDetailsExcel } from "../../../controllers/finance/accounts/accounts-report/ledgerwithdetailsexcels";
import { getTransactionWithoutTransfersReport } from "../../wms/reports/Transactionwithouttransfersreport";
import { exportTransactionWithoutTransfersExcel } from "../../wms/reports/WithoutTrasactionExcel";
import { getGrnSummaryReportExcel, getGrnSummaryReportHtml } from "../../../controllers/wms/reports/GrnSummaryreport.controller";
import { CapexApprovalReport } from "../../../controllers/ALMS/CapexApprovalReport";
import { exportCapexApprovalExcel } from "../../../controllers/ALMS/Capexapprovalexcel";
import { PRPurchaseReport } from "../../../controllers/ALMS/Prpurchasereport";


const router = express.Router();

// Apply tenant middleware to ensure database switching
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);

router.post("/insUpdTrAcJVBulk", insUpdTrAcJVBulk );
router.post("/account-entry/bulk", procBulkAccountEntry);
router.get("/report/:doc_type/:doc_no", getFinanceDocumentReportHtml);
router.get("/report/:doc_type/:doc_no/excel", exportFinanceDocumentReportExcel);

router.post("/report/trialbalance/html/ac",getAcTrialBalanceReportHtml);
router.post("/report/trialbalance/excel/ac",exportAcTrialBalanceReportExcel);
router.post("/report/trialbalance/html/:level", getTrialBalanceReportHtml);
router.post("/report/trialbalance/excel/:level", exportTrialBalanceReportExcel); 

router.post("/report/trialbalance/drilldown/l2",     getDrilldownL2);
router.post("/report/trialbalance/drilldown/l3",     getDrilldownL3);
router.post("/report/trialbalance/drilldown/l4",     getDrilldownL4);
router.post("/report/trialbalance/drilldown/ac",     getDrilldownAc);
router.post("/report/trialbalance/drilldown/detail", getDrilldownDetail);
router.post("/report/trialbalance/drilldown/l2/excel",     getDrilldownL2Excel);
router.post("/report/trialbalance/drilldown/l3/excel",     getDrilldownL3Excel);
router.post("/report/trialbalance/drilldown/l4/excel",     getDrilldownL4Excel);
router.post("/report/trialbalance/drilldown/ac/excel",     getDrilldownAcExcel);
router.post("/report/trialbalance/drilldown/detail/excel", getDrilldownDetailExcel);

router.post('/reports/cheque-monitoring/html', getChequeMonitoringReport);
router.post('/reports/ledger-with-details/html', getLedgerWithDetailsReport);
router.post('/reports/ledger-with-details/excel', exportLedgerWithDetailsExcel);
router.post('/reports/ledger-opposite-entry/html', getLedgerWithOppositeEntryReport);
router.post('/reports/balance-sheet/html', getBalanceSheetReportHtml);
router.post('/reports/getBalanceSheetReport/html', getBalanceSheetReportHtml);
router.post('/reports/getBalanceSheetReport/excel', exportBalanceSheetReportExcel);
router.post('/report/balancesheet/html', getBalanceSheetReportHtml);
router.post('/report/balancesheet/excel', exportBalanceSheetReportExcel);
router.post('/report/balancesheet/drilldown/ac', getBalanceSheetDrilldownAc);
router.post('/report/balancesheet/drilldown/ac/excel', getBalanceSheetDrilldownAcExcel);
router.post('/report/balancesheet/drilldown/detail', getBalanceSheetDrilldownDetail);
router.post('/report/balancesheet/drilldown/detail/excel', getBalanceSheetDrilldownDetailExcel);




router.post('/reports/summary-dump/html', getSummaryDumpReport);
router.post('/reports/detail-dump/html', getDetailDumpReport);
router.post('/reports/account-payee-wise/html', getAccountPayeeWiseReport);
router.post('/reports/cheque-date-wise/html', getChequeDateWiseReport)


// ── Profit & Loss ─────────────────────────────────────────────────────────────
router.post("/reports/profitloss/html",  getProfitLossReportHtml);
router.post("/reports/profitloss/excel", getProfitLossReportExcel);  
 
// P&L drilldowns (own endpoints — separate from Trial Balance drilldowns)
router.post("/reports/profitloss/drilldown/l2",         getPnlDrilldownL2);
router.post("/reports/profitloss/drilldown/l2/excel",   getPnlDrilldownL2Excel);
router.post("/reports/profitloss/drilldown/l3",         getPnlDrilldownL3);
router.post("/reports/profitloss/drilldown/l3/excel",   getPnlDrilldownL3Excel);
 
router.post('/reports/account-payee-wise/excel', exportAccountPayeeWiseExcel);
router.post('/reports/cheque-date-wise/html', getChequeDateWiseReport);
router.post('/reports/cheque-date-wise/excel', exportChequeDateWiseExcel);

router.post('/reports/getProfitLossReport/html', getProfitLossReportHtml);
router.post('/reports/getProfitLossReport/excel', getProfitLossReportExcel);

// ---------HR Reports Routes------
router.post('/reports/getVisaExpiryReport/html', getVisaExpiryReport);

// WMS REPORTS ROUTES
router.post('/reports/getDnSummaryReport/html', getDnSummaryReportHtml);
router.post('/reports/getDnSummaryReport/excel', getDnSummaryReportExcel);

//inbound Grn Summary report
router.post('/reports/GrnSummaryReport/html', getGrnSummaryReportHtml);
router.post('/reports/GrnSummaryReport/excel', getGrnSummaryReportExcel);


router.post('/reports/tax-vat-out-ledger/html', getTaxInvoiceReport);
router.post('/reports/tax-vat-out-ledger/excel', exportTaxInvoiceExcel);
router.post('/reports/tax-vat-out-ledger-summary/html', getTaxInvoiceSummaryReport);
router.post('/reports/tax-vat-out-ledger-summary/excel', exportTaxInvoiceSummaryExcel);



// -----------------------------WMS Reports Routes----------------------
router.post('/reports/wms-joblisting/html', getJobListingReport);
router.post('/reports/wms-TransactionProductReport/html', getTransactionProductReport);
router.post('/reports/wms-TransactionProductWithoutTransfersReport/html', getTransactionWithoutTransfersReport);

router.post('/reports/wms-exportTransactionProductExcel/excel', exportTransactionProductExcel);
router.post('/reports/wms-exportTransactionWithoutTransfersExcel/excel', exportTransactionWithoutTransfersExcel);

router.post('/reports/wms-joblisting', exportJobListingExcel);

// ------Ageing Reports Routes------
 router.post('/reports/InvdatewiseDetail/html', InvdatewiseDetail);
 router.post('/reports/InvdatewiseSummary/html', InvdatewiseSummary);
router.post('/reports/DuedatewiseDetail/html', DuedatewiseDetail);
router.post('/reports/DuedatewiseSummary/html', DuedatewiseSummary);
router.post('/reports/OutstandingList/html', OutstandingList);
// -----excel For Ageing-----
router.post("/reports/InvdatewiseDetail/excel",   exportInvDetailExcel);
router.post("/reports/InvdatewiseSummary/excel",  exportInvSummaryExcel);
router.post("/reports/DuedatewiseDetail/excel",   exportDueDetailExcel);
router.post("/reports/DuedatewiseSummary/excel",  exportDueSummaryExcel);
router.post("/reports/OutstandingList/excel",     exportOutstandingListExcel);
// -------Account Statement Report Route------
router.post('/reports/AcStatementReport/html', AcStatementReport);  
router.post('/reports/OutstandingDetailReport/html',OutstandingDetailReport);
router.post('/reports/OutstandingSummaryReport/html',OutstandingSummaryReport);
// ------excel For Account Statement Report------
router.post("/reports/AcStatement/excel", exportAcStatementExcel);
router.post("/reports/OutstandingDetail/excel",  exportOutstandingDetailExcel);
router.post("/reports/OutstandingSummary/excel", exportOutstandingSummaryExcel);



// ALMS report 1) Capex Approval Report and Excel 2) PR Purchase report and excel
router.post('/reports/CapexApprovalReport/html', CapexApprovalReport);
router.post('/reports/CapexApprovalReport/excel', exportCapexApprovalExcel);
router.post('/reports/PRPurchaseReport/html',PRPurchaseReport);






// GET Routes - Information Retrieval
router.get("/company_info", getCompanyInfo);             
router.get("/default_details", getDefaultTransactionDetails);  
router.get("/cheque_detail", getChequeDetail);                 
router.get("/header/:doc_no", getChequePaymentHeader);   
router.get("/purchaseheader/:doc_no", getPurchaseHeader);  
router.get("/detail/:doc_no", getChequePaymentDetail);          // Get payment details by document number
router.get("/children/:doc_no", getTransactionChildren);        // Get invoice/job/expense children by document number
router.get("/table_name/:ac_code", getChildTableName);          // Get related table name by account code
router.get("/doc_accounts", getDocAccounts);                    // Get doc accounts
router.get("/invoice_outstanding", getInvoiceOutstandingBalances); // Get outstanding balances for invoices
// router.get("/document_report", getChequePaymentReport);         // Generate payment report
// router.get("/export", exportTransactionDocument);               // Export transaction data

// POST Routes - Document Creation
router.post("/document/bulk", createBulkTransactionDocument);   // Create multiple transactions
router.post("/document", createChequePaymentDocument);          // Create single cheque payment
router.post("/document/storeProcess", createChequePaymentStoreProcess);

// PUT Routes - Document Updates
router.put("/document", updateChequePaymentDocument);           // Update payment document
router.put("/cancel_cheque", cancelDocument);                   // Cancel existing document

// DELETE Routes - Record Removal
router.delete("/document/:doc_type", deleteDocument);           // Delete document by type
router.delete("/detail_item/delete", deleteDetailItem);         // Delete detail record
router.delete("/children_item/delete", deleteChildrenItem);     // Delete child records

router.post("/purchase-document",createPurchaseDocument)
// PUT route for updating existing purchase documents
router.put("/purchase-document", updatePurchaseDocument);

router.post("/sales-document",createSalesDocument)

//LPO Routes
router.get("/lpo", getLpoDoc);
router.get("/lpo/:doc_no", getLPOHeader);
router.get("/lpo/:doc_no/print", getLPOPrint);
router.get("/lpo/:doc_no/detail", getLpoDetail);     
router.post("/lpo-document", createLPODocument);
router.put("/lpo-update", updateLPODocument);
router.put("/cancel_LPO", cancelLPODocument);

// Export the configured router
export default router;

// /* Router Purpose:
// This router manages financial transaction endpoints with:
// - Comprehensive cheque payment operations
// - Transaction document management
// - Information retrieval endpoints
// - Report generation capabilities
// - Export functionality

// Endpoint Groups:
// 1. Information Retrieval (GET):
//    - Company and default information
//    - Cheque and payment details
//    - Document reports and exports

// 2. Document Creation (POST):
//    - Single cheque payment creation
//    - Bulk transaction processing

// 3. Document Modification (PUT):
//    - Payment document updates
//    - Cheque cancellation

// 4. Record Deletion (DELETE):
//    - Document removal
//    - Detail record deletion
//    - Child record removal

// Security Considerations:
// - Ensure proper authentication for all routes
// - Validate document ownership before modifications
// - Implement proper authorization checks
// - Maintain audit trail for all operations

// Error Handling:
// - All routes should include proper error handling
// - Validate input parameters
// - Check for document existence before operations
// - Maintain transaction integrity
// */
