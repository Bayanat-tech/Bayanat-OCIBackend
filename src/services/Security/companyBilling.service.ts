import oracledb from "oracledb";
import { PlatformAdminService as Platform, PlatformError } from "./platformAdmin.service";
import { CompanySubscriptionService as Subscription } from "./companySubscription.service";
import { addDays, billingToday, periodStart, validDate } from "./billingCalendar";
import { billingMailConfigured } from "../../scheduler/billingEmail";

const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const subSelect = `SELECT s.*,TO_CHAR(START_DATE,'YYYY-MM-DD') START_DAY,TO_CHAR(NEXT_BILL_DATE,'YYYY-MM-DD') NEXT_DAY,TO_CHAR(CANCEL_ON,'YYYY-MM-DD') CANCEL_DAY FROM CUSTOMERS.SEC_COMPANY_SUBSCRIPTION s`;
const invoiceSelect = `SELECT INVOICE_ID,TENANT_ID,COMPANY_CODE,PLAN_NAME,MODULE_CODES,CURRENCY,AMOUNT,STATUS,PAYMENT_REFERENCE,PAID_BY,
 TO_CHAR(PERIOD_START,'YYYY-MM-DD') PERIOD_START,TO_CHAR(PERIOD_END,'YYYY-MM-DD') PERIOD_END,TO_CHAR(DUE_DATE,'YYYY-MM-DD') DUE_DATE,
 TO_CHAR(GRACE_END,'YYYY-MM-DD') GRACE_END,TO_CHAR(PAID_ON,'YYYY-MM-DD') PAID_ON,CREATED_AT FROM CUSTOMERS.SEC_BILLING_INVOICE`;
export const splitModules = (value: any): string[] => [...new Set(String(value || "").split(",").map(x => x.trim().toUpperCase()).filter(Boolean))];

export class CompanyBillingService {
  static async production(actor: string) {
    if ((await Platform.getAccess(actor))?.scope !== "ALL") throw new PlatformError("Only PRODADMIN / production administrators can control invoice billing", 403);
  }
  static async overview(actor: string, tenant: string, company: string) {
    const subscription = await Subscription.get(actor, tenant, company);
    const catalog = await Platform.screenCatalog(tenant, company);
    const modules = [...new Set(catalog.map(x => String(x.APP_CODE || "").trim().toUpperCase()).filter(x => x && !["SECURITY","SUPPORT"].includes(x)))].sort();
    const history = await Platform.root(async c => {
      const invoices = await c.execute<any>(`${invoiceSelect} WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company ORDER BY PERIOD_START DESC FETCH FIRST 100 ROWS ONLY`, { tenant, company }, options);
      const reminders = await c.execute<any>(`SELECT r.REMINDER_ID,r.INVOICE_ID,r.KIND,r.EMAIL_TO,r.EMAIL_STATUS,r.ATTEMPTS,r.LAST_ERROR,r.CREATED_AT
        FROM CUSTOMERS.SEC_BILLING_REMINDER r JOIN CUSTOMERS.SEC_BILLING_INVOICE i ON i.INVOICE_ID=r.INVOICE_ID
        WHERE i.TENANT_ID=:tenant AND i.COMPANY_CODE=:company ORDER BY r.REMINDER_ID DESC FETCH FIRST 100 ROWS ONLY`, { tenant, company }, options);
      return { invoices: invoices.rows || [], reminders: reminders.rows || [] };
    });
    return { subscription, modules, ...history, canManage: (await Platform.getAccess(actor))?.scope === "ALL", emailConfigured: billingMailConfigured(), schedulerEnabled: process.env.SCHEDULER_ENABLED?.toLowerCase() !== "false", today: billingToday() };
  }

  static async control(actor: string, tenant: string, company: string, input: any) {
    await this.production(actor);
    await Subscription.validateCompany(actor, tenant, company);
    const action = String(input.action || "");
    if (!["activate","deactivate","suspend","restore","cancel"].includes(action)) throw new PlatformError("Choose a valid billing action");
    const catalog = action === "activate" ? await Platform.screenCatalog(tenant, company) : [];
    await Platform.root(async c => {
      try {
        const result = await c.execute<any>(`${subSelect} WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company FOR UPDATE WAIT 5`, { tenant, company }, options);
        const sub = result.rows?.[0];
        if (!sub) throw new PlatformError("Save subscription settings first");
        if (Number(input.version) !== Number(sub.VERSION_NO)) throw new PlatformError("Billing settings changed. Reload before continuing.", 409);
        let sql: string;
        const today = billingToday();
        if (action === "activate") {
          if (sub.BILLING_ENABLED === "Y") throw new PlatformError("Billing is already active");
          const modules = splitModules(sub.MODULE_CODES);
          if (!modules.length || modules.some(m => ["SECURITY","SUPPORT"].includes(m) || !catalog.some(s => String(s.APP_CODE).trim().toUpperCase() === m))) throw new PlatformError("Choose valid billable application modules");
          if (!(Number(sub.AMOUNT) > 0) || !sub.CURRENCY || !sub.BILLING_EMAIL || !sub.START_DAY) throw new PlatformError("Save a positive amount, currency, billing email and start date before activation");
          if (!billingMailConfigured()) throw new PlatformError("Billing email is not configured on the server. Configure SMTP before activating billing.");
          if (process.env.SCHEDULER_ENABLED?.toLowerCase() === "false") throw new PlatformError("Enable the server scheduler before activating automated invoice billing");
          if (sub.START_DAY < today) throw new PlatformError("Choose today or a future start date. Activation never creates unreviewed historical charges.");
          if (sub.BILLING_CYCLE === "CUSTOM" && !(Number(sub.CUSTOM_DAYS) >= 1)) throw new PlatformError("Set custom-cycle days");
          const previous = await c.execute<any>("SELECT TO_CHAR(MAX(PERIOD_END),'YYYY-MM-DD') LAST_DAY FROM CUSTOMERS.SEC_BILLING_INVOICE WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company", { tenant, company }, options);
          if (previous.rows?.[0]?.LAST_DAY >= sub.START_DAY) throw new PlatformError("Start the new billing schedule after the last invoiced period to avoid overlapping charges");
          sql = "BILLING_ENABLED='Y',STATUS='ACTIVE',SUSPENDED='N',CANCEL_ON=NULL,PERIOD_NO=0,NEXT_BILL_DATE=START_DATE";
        } else if (action === "deactivate") {
          sql = "BILLING_ENABLED='N'";
        } else {
          if (sub.BILLING_ENABLED !== "Y") throw new PlatformError("Billing is inactive for this company");
          const overdue = await this.overdue(c, tenant, company, today);
          if (action === "suspend") {
            if (!overdue) throw new PlatformError("Suspension requires an unpaid invoice past its grace period");
            sql = "SUSPENDED='Y'";
          } else if (action === "restore") {
            if (overdue) throw new PlatformError("Record payment for overdue invoices before restoring access");
            if (sub.CANCEL_DAY && sub.CANCEL_DAY < today) throw new PlatformError("The subscription has ended. Configure and activate a new period.");
            sql = "SUSPENDED='N'";
          } else {
            const last = await c.execute<any>("SELECT TO_CHAR(MAX(PERIOD_END),'YYYY-MM-DD') LAST_DAY FROM CUSTOMERS.SEC_BILLING_INVOICE WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company", { tenant, company }, options);
            const end = last.rows?.[0]?.LAST_DAY || today;
            await c.execute(`UPDATE CUSTOMERS.SEC_COMPANY_SUBSCRIPTION SET CANCEL_ON=TO_DATE(:endDay,'YYYY-MM-DD') WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company`, { endDay: end, tenant, company });
            sql = "STATUS='CLOSED'";
          }
        }
        await c.execute(`UPDATE CUSTOMERS.SEC_COMPANY_SUBSCRIPTION SET ${sql},VERSION_NO=VERSION_NO+1,UPDATED_BY=:actor,UPDATED_AT=SYSTIMESTAMP WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company`, { tenant, company, actor });
        await Platform.audit(actor, tenant, company, action.toUpperCase(), "COMPANY_BILLING", { modules: splitModules(sub.MODULE_CODES), amount: sub.AMOUNT, currency: sub.CURRENCY, start: sub.START_DAY }, c);
        await c.commit();
      } catch (e) { await c.rollback(); throw e; }
    });
    if (action === "activate") {
      try { await this.processCompany(tenant, company); }
      catch { return { action, warning: "Billing is active. Invoice generation will retry on the next scheduled run." }; }
    }
    return { action };
  }

  static async overdue(c: oracledb.Connection, tenant: string, company: string, today: string) {
    const r = await c.execute("SELECT 1 FROM CUSTOMERS.SEC_BILLING_INVOICE WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND STATUS='PENDING' AND GRACE_END<TO_DATE(:today,'YYYY-MM-DD') AND ROWNUM=1", { tenant, company, today });
    return Boolean(r.rows?.length);
  }

  static async processCompany(tenant: string, company: string, today = billingToday()) {
    validDate(today);
    return Platform.root(async c => {
      try {
        const r = await c.execute<any>(`${subSelect} WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company FOR UPDATE WAIT 1`, { tenant, company }, options);
        const sub = r.rows?.[0];
        if (!sub || sub.BILLING_ENABLED !== "Y") { await c.rollback(); return { generated: 0 }; }
        let generated = 0, next = sub.NEXT_DAY, index = Number(sub.PERIOD_NO);
        while (sub.STATUS === "ACTIVE" && next && next <= today && generated < 24) {
          const following = periodStart(sub.START_DAY, sub.BILLING_CYCLE, index + 1, sub.CUSTOM_DAYS);
          if (following <= next) throw new Error("Invalid billing calendar progression");
          const existing = await c.execute("SELECT 1 FROM CUSTOMERS.SEC_BILLING_INVOICE WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND PERIOD_START=TO_DATE(:day,'YYYY-MM-DD')", { tenant, company, day: next });
          if (!existing.rows?.length) {
            const due = addDays(next, Number(sub.DUE_DAYS));
            await c.execute(`INSERT INTO CUSTOMERS.SEC_BILLING_INVOICE (TENANT_ID,COMPANY_CODE,PERIOD_START,PERIOD_END,DUE_DATE,GRACE_END,PLAN_NAME,MODULE_CODES,CURRENCY,AMOUNT)
              VALUES (:tenant,:company,TO_DATE(:startDay,'YYYY-MM-DD'),TO_DATE(:endDay,'YYYY-MM-DD'),TO_DATE(:dueDay,'YYYY-MM-DD'),TO_DATE(:graceDay,'YYYY-MM-DD'),:plan,:modules,:currency,:amount)`,
              { tenant, company, startDay: next, endDay: addDays(following, -1), dueDay: due, graceDay: addDays(due, Number(sub.GRACE_DAYS)), plan: sub.PLAN_NAME, modules: sub.MODULE_CODES, currency: sub.CURRENCY, amount: sub.AMOUNT });
            await Platform.audit("BILLING_SCHEDULER", tenant, company, "INSERT", "BILLING_INVOICE", { periodStart: next, periodEnd: addDays(following, -1), amount: sub.AMOUNT, currency: sub.CURRENCY }, c);
            generated++;
          }
          index++; next = following;
        }
        if (index !== Number(sub.PERIOD_NO)) await c.execute("UPDATE CUSTOMERS.SEC_COMPANY_SUBSCRIPTION SET PERIOD_NO=:idx,NEXT_BILL_DATE=TO_DATE(:nextDay,'YYYY-MM-DD') WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company", { idx: index, nextDay: next, tenant, company });
        const pending = await c.execute<any>(`${invoiceSelect} WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND STATUS='PENDING'`, { tenant, company }, options);
        for (const invoice of pending.rows || []) {
          const kinds = ["ISSUED", ...(today > invoice.DUE_DATE ? ["OVERDUE"] : []), ...(today > invoice.GRACE_END ? ["GRACE_EXPIRED"] : [])];
          for (const kind of kinds) await c.execute(`MERGE INTO CUSTOMERS.SEC_BILLING_REMINDER r USING (SELECT :id INVOICE_ID,:kind KIND FROM DUAL) s ON (r.INVOICE_ID=s.INVOICE_ID AND r.KIND=s.KIND)
            WHEN NOT MATCHED THEN INSERT (INVOICE_ID,KIND,EMAIL_TO) VALUES (:id,:kind,:email)`, { id: invoice.INVOICE_ID, kind, email: sub.BILLING_EMAIL });
        }
        await c.commit();
        return { generated };
      } catch (e: any) { await c.rollback(); if ([54,30006].includes(e.errorNum)) return { generated: 0 }; throw e; }
    });
  }

  static async pay(actor: string, tenant: string, company: string, invoiceId: number, input: any) {
    await this.production(actor); await Subscription.validateCompany(actor, tenant, company);
    const reference = String(input.reference || "").trim();
    if (!Number.isSafeInteger(invoiceId) || invoiceId < 1 || !reference || reference.length > 100) throw new PlatformError("Enter a valid invoice and payment reference");
    let date: string;
    try { date = validDate(input.paidOn || billingToday()); } catch { throw new PlatformError("Enter a valid payment date"); }
    if (date > billingToday()) throw new PlatformError("Payment date cannot be in the future");
    return Platform.root(async c => {
      try {
        await c.execute("SELECT COMPANY_CODE FROM CUSTOMERS.SEC_COMPANY_SUBSCRIPTION WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company FOR UPDATE WAIT 5", { tenant, company });
        const invoice = await c.execute<any>("SELECT STATUS FROM CUSTOMERS.SEC_BILLING_INVOICE WHERE INVOICE_ID=:id AND TENANT_ID=:tenant AND COMPANY_CODE=:company FOR UPDATE", { id: invoiceId, tenant, company }, options);
        if (!invoice.rows?.length) throw new PlatformError("Invoice not found in this company", 404);
        if (invoice.rows[0].STATUS === "PAID") { await c.rollback(); return { alreadyPaid: true }; }
        await c.execute("UPDATE CUSTOMERS.SEC_BILLING_INVOICE SET STATUS='PAID',PAYMENT_REFERENCE=:reference,PAID_ON=TO_DATE(:paidOn,'YYYY-MM-DD'),PAID_BY=:actor WHERE INVOICE_ID=:id", { id: invoiceId, reference, paidOn: date, actor });
        await c.execute("UPDATE CUSTOMERS.SEC_BILLING_REMINDER SET EMAIL_STATUS='SKIPPED',UPDATED_AT=SYSTIMESTAMP WHERE INVOICE_ID=:id AND EMAIL_STATUS IN ('PENDING','FAILED')", { id: invoiceId });
        if (!await this.overdue(c, tenant, company, billingToday())) await c.execute("UPDATE CUSTOMERS.SEC_COMPANY_SUBSCRIPTION SET SUSPENDED='N',VERSION_NO=VERSION_NO+1 WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND SUSPENDED='Y'", { tenant, company });
        await Platform.audit(actor, tenant, company, "PAYMENT", "BILLING_INVOICE", { invoiceId, reference, paidOn: date }, c);
        await c.commit(); return { paid: true };
      } catch (e) { await c.rollback(); throw e; }
    });
  }

  static async blockedModules(tenant: string, company: string) {
    if (!tenant || !company) return [];
    return Platform.root(async c => {
      const r = await c.execute<any>("SELECT MODULE_CODES FROM CUSTOMERS.SEC_COMPANY_SUBSCRIPTION WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND BILLING_ENABLED='Y' AND (SUSPENDED='Y' OR CANCEL_ON<TO_DATE(:today,'YYYY-MM-DD'))", { tenant, company, today: billingToday() }, options);
      return splitModules(r.rows?.[0]?.MODULE_CODES);
    });
  }
  static async blockedSerials(tenant: string, company: string) {
    const modules = await this.blockedModules(tenant, company);
    if (!modules.length) return [];
    const catalog = await Platform.screenCatalog(tenant, company);
    return catalog.filter(row => modules.includes(String(row.APP_CODE).trim().toUpperCase())).map(row => Number(row.SERIAL_NO));
  }
}
