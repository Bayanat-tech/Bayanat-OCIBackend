import cron from "node-cron";
import { PlatformAdminService as Platform } from "../services/Security/platformAdmin.service";
import { CompanyBillingService as Billing } from "../services/Security/companyBilling.service";
import { deliverBillingReminders } from "./billingEmail";
import { PublicRegistrationService } from '../services/Security/publicRegistration.service';

let running = false;
export async function runCompanyBilling() {
  if (running) return;
  running = true;
  try {
    const companies = await Platform.root(async c => (await c.execute<any>("SELECT TENANT_ID,COMPANY_CODE FROM CUSTOMERS.SEC_COMPANY_SUBSCRIPTION WHERE BILLING_ENABLED='Y'", {}, { outFormat: 4002 })).rows || []);
    for (const row of companies) {
      try { await Billing.processCompany(row.TENANT_ID, row.COMPANY_CODE); }
      catch { console.error("Billing cycle processing failed", { tenant: row.TENANT_ID, company: row.COMPANY_CODE }); }
    }
    await deliverBillingReminders();
    await PublicRegistrationService.deliverWelcome();
  } catch { console.error("Company billing scheduler failed; retrying on next scheduled run"); }
  finally { running = false; }
}
export function startCompanyBillingScheduler() { cron.schedule("*/15 * * * *", () => { void runCompanyBilling(); }); }
