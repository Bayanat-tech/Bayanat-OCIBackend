import { VendorService } from "./vendor.service";
import { TenantManager } from "../database/TenantManager";
import { QueryExecutor } from "../database/QueryExecutor";
import cron from "node-cron";

export class SchedulerService {
  static async processUnsentVendorData() {
    try {
        // Iterate active tenants and process unsent header records per tenant
      const tenantIds = await TenantManager.listActiveTenants();

      type Header = {
        COMPANY_CODE: string;
        DOC_NO: string;
        [key: string]: any;
      };

      for (const tenantId of tenantIds) {
        try {
          const headersRes = await QueryExecutor.executeRawQueryForTenant(
            tenantId,
            `SELECT * FROM VMS_FLOW_HDR WHERE LAST_ACTION = 'SUBMITTED' AND DATA_TRANSFER = 'N'`
          );

          const unsentHeaders = headersRes.rows || headersRes;

          for (const header of unsentHeaders) {
            try {
              // Send header data
              await VendorService.insertAcHeader(header as any);

              // Get and send related detail records
              const detailsRes = await QueryExecutor.executeRawQueryForTenant(
                tenantId,
                `SELECT * FROM VMS_FLOW_DTL WHERE COMPANY_CODE = :companyCode AND DOC_NO = :docNo`,
                { companyCode: header.COMPANY_CODE, docNo: header.DOC_NO }
              );

              const details = detailsRes.rows || detailsRes;

              for (const detail of details) {
                await VendorService.insertAcDetail(detail as any);
              }

              // Mark header as transferred for this tenant
              await QueryExecutor.executeRawQueryForTenant(
                tenantId,
                `UPDATE VMS_FLOW_HDR SET DATA_TRANSFER = 'Y' WHERE COMPANY_CODE = :companyCode AND DOC_NO = :docNo`,
                { companyCode: header.COMPANY_CODE, docNo: header.DOC_NO }
              );

              console.log(`Successfully processed document ${header.DOC_NO}`);
            } catch (error) {
              console.error(`Error processing document ${header.DOC_NO}:`, error);
              continue;
            }
          }
        } catch (tenantErr) {
          console.error(`Error processing tenant ${tenantId}:`, tenantErr);
          continue;
        }
      }
    } catch (error) {
      console.error("Error in vendor scheduler process:", error);
    }
  }

  static initializeScheduler() {
    // Run vendor data sync every 6 hours
    cron.schedule("0 */6 * * *", async () => {
      console.log("Running vendor data transfer check...");
      await this.processUnsentVendorData();
    });

    console.log("Scheduler initialized");
  }
}
