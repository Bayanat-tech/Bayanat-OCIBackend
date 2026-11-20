import oracledb from "oracledb";
import { PlatformAdminService as Platform, PlatformError } from "./platformAdmin.service";

export class CompanySubscriptionService {
  static async validateCompany(actor: string, tenant: string, company: string) {
    await Platform.assertTenant(actor, tenant);
    if (tenant === "root" || !company) throw new PlatformError("Choose a tenant company");
    const rows = await Platform.tenantQuery(tenant, "SELECT 1 FROM #SCHEMA#.MS_COMPANY WHERE COMPANY_CODE=:company", { company });
    if (!rows.length) throw new PlatformError("Company was not found in this tenant", 404);
  }
  static async get(actor: string, tenant: string, company: string) {
    await this.validateCompany(actor, tenant, company);
    return Platform.scope(tenant, async c => {
      const result = await c.execute<any>(`SELECT PLAN_NAME,STATUS,BILLING_CYCLE,CURRENCY,AMOUNT,TO_CHAR(NEXT_BILL_DATE,'YYYY-MM-DD') NEXT_BILL_DATE,
        BILLING_REFERENCE,NOTES,VERSION_NO,UPDATED_BY,UPDATED_AT FROM CUSTOMERS.SEC_COMPANY_SUBSCRIPTION WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company`,
        { tenant, company }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return result.rows?.[0] || { STATUS: "DRAFT", BILLING_CYCLE: "MONTHLY", VERSION_NO: 0 };
    });
  }
  static async save(actor: string, tenant: string, company: string, input: any) {
    await this.validateCompany(actor, tenant, company);
    const text = (key: string, max: number) => {
      const value = String(input[key] ?? "").trim();
      if (value.length > max) throw new PlatformError(`${key} is too long`);
      return value || null;
    };
    const status = text("STATUS", 20), cycle = text("BILLING_CYCLE", 20), currency = text("CURRENCY", 3);
    const amount = input.AMOUNT === "" || input.AMOUNT == null ? null : Number(input.AMOUNT);
    const date = text("NEXT_BILL_DATE", 10);
    if (!["DRAFT","ACTIVE","PAUSED","CLOSED"].includes(status || "") || !["MONTHLY","QUARTERLY","YEARLY","CUSTOM"].includes(cycle || "")) throw new PlatformError("Choose a valid status and billing cycle");
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new PlatformError("Currency must be a three-letter uppercase code");
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 99999999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.001)) throw new PlatformError("Enter a positive amount with up to two decimal places");
    if (amount !== null && !currency) throw new PlatformError("Choose a currency for the amount");
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) throw new PlatformError("Enter a valid billing date");
    const version = Number(input.VERSION_NO);
    if (!Number.isSafeInteger(version) || version < 0) throw new PlatformError("Refresh the subscription before saving");
    const values = { plan: text("PLAN_NAME", 100), status, cycle, currency, amount, nextDate: date, reference: text("BILLING_REFERENCE", 100), notes: text("NOTES", 1000) };
    return Platform.scope(tenant, async (c, owner) => {
      try {
        await c.execute(`SELECT COMPANY_CODE FROM ${owner}.MS_COMPANY WHERE COMPANY_CODE=:company FOR UPDATE WAIT 5`, { company });
        const existing = await c.execute<any>("SELECT VERSION_NO FROM CUSTOMERS.SEC_COMPANY_SUBSCRIPTION WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company", { tenant, company }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        if (Number(existing.rows?.[0]?.VERSION_NO || 0) !== version) throw new PlatformError("Another administrator changed this subscription. Refresh and try again.", 409);
        const binds = { tenant, company, actor, version: version + 1, ...values };
        if (version) await c.execute(`UPDATE CUSTOMERS.SEC_COMPANY_SUBSCRIPTION SET PLAN_NAME=:plan,STATUS=:status,BILLING_CYCLE=:cycle,CURRENCY=:currency,AMOUNT=:amount,NEXT_BILL_DATE=TO_DATE(:nextDate,'YYYY-MM-DD'),BILLING_REFERENCE=:reference,NOTES=:notes,VERSION_NO=:version,UPDATED_BY=:actor,UPDATED_AT=SYSTIMESTAMP WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company`, binds);
        else await c.execute(`INSERT INTO CUSTOMERS.SEC_COMPANY_SUBSCRIPTION (TENANT_ID,COMPANY_CODE,PLAN_NAME,STATUS,BILLING_CYCLE,CURRENCY,AMOUNT,NEXT_BILL_DATE,BILLING_REFERENCE,NOTES,VERSION_NO,UPDATED_BY) VALUES (:tenant,:company,:plan,:status,:cycle,:currency,:amount,TO_DATE(:nextDate,'YYYY-MM-DD'),:reference,:notes,:version,:actor)`, binds);
        await Platform.audit(actor, tenant, company, "UPDATE", "COMPANY_SUBSCRIPTION", { ...values, version: version + 1 }, c);
        await c.commit();
        return { version: version + 1 };
      } catch (e) { await c.rollback(); throw e; }
    });
  }
}
