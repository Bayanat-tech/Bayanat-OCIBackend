const nodemailer = require("nodemailer");
import oracledb from "oracledb";
import { PlatformAdminService as Platform } from "../services/Security/platformAdmin.service";

function mailConfig() {
  const user = process.env.BILLING_SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.BILLING_SMTP_PASSWORD || process.env.EMAIL_PASS;
  const from = process.env.BILLING_SMTP_FROM || user;
  const host = process.env.BILLING_SMTP_HOST;
  return { user, pass, from, host };
}
export function billingMailConfigured() {
  const c = mailConfig();
  return Boolean(c.from && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.from) && ((c.user && c.pass) || (c.host && process.env.BILLING_SMTP_AUTH === "false")));
}
export async function sendRegistrationMail(to: string, subject: string, text: string) {
  if (!billingMailConfigured()) throw new Error('REGISTRATION_EMAIL_NOT_CONFIGURED');
  const c = mailConfig(), port = Number(process.env.BILLING_SMTP_PORT || 587);
  const transport = nodemailer.createTransport(c.host
    ? {host:c.host,port,secure:port===465,auth:c.user&&c.pass?{user:c.user,pass:c.pass}:undefined,connectionTimeout:10000,socketTimeout:30000}
    : {service:'Outlook365',auth:{user:c.user,pass:c.pass},connectionTimeout:10000,socketTimeout:30000});
  try { await transport.sendMail({from:c.from,to,subject,text}); }
  finally { transport.close(); }
}
export async function sendBillingMail(row: any) {
  if (!billingMailConfigured()) throw new Error("BILLING_EMAIL_NOT_CONFIGURED");
  const c = mailConfig(), port = Number(process.env.BILLING_SMTP_PORT || 587);
  const transport = nodemailer.createTransport(c.host
    ? { host: c.host, port, secure: port === 465, auth: c.user && c.pass ? { user: c.user, pass: c.pass } : undefined, connectionTimeout: 10000, socketTimeout: 30000 }
    : { service: "Outlook365", auth: { user: c.user, pass: c.pass }, connectionTimeout: 10000, socketTimeout: 30000 });
  const label = row.KIND === "ISSUED" ? "New invoice" : row.KIND === "GRACE_EXPIRED" ? "Payment grace period expired" : "Payment overdue";
  let cc:string[]=[],publicSignup=false;
  if(process.env.PUBLIC_REGISTRATION_INSTALLED==='true') {
    const signup=await Platform.root(async connection=>(await connection.execute<any>("SELECT PAYLOAD FROM CUSTOMERS.SEC_PUBLIC_SIGNUP WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND STATE='COMPLETE'",{tenant:row.TENANT_ID,company:row.COMPANY_CODE},{outFormat:oracledb.OUT_FORMAT_OBJECT,fetchInfo:{PAYLOAD:{type:oracledb.STRING}}})).rows?.[0]);
    if(signup){publicSignup=true;cc=JSON.parse(signup.PAYLOAD).copyEmails||[];}
  }
  try {
    await transport.sendMail({
      from: c.from, to: row.EMAIL_TO, cc,
      messageId: `<billing-${row.INVOICE_ID}-${String(row.KIND).toLowerCase()}@bayanat.local>`,
      subject: `${label} — invoice ${row.INVOICE_ID} / ${row.COMPANY_CODE}`,
      text: `${label}\nCompany: ${row.COMPANY_CODE}\nInvoice: ${row.INVOICE_ID}\nPeriod: ${row.PERIOD_START} to ${row.PERIOD_END}\nAmount: ${row.CURRENCY} ${Number(row.AMOUNT).toFixed(2)}\nDue: ${row.DUE_DATE}\nGrace period ends: ${row.GRACE_END}\n\nPlease contact your administrator with your payment reference. This email does not collect payment. ${publicSignup?'Self-service company access stops when the unpaid trial or payment period ends. Arrange payment before the deadline to continue.':'Access suspension remains controlled by your administrator.'}`,
    });
  } finally { transport.close(); }
}

export async function deliverBillingReminders(limit = 20, send = sendBillingMail) {
  if (!billingMailConfigured()) return;
  for (let n = 0; n < limit; n++) {
    const row = await Platform.root(async c => {
      // UPDATED_AT is a timezone-less TIMESTAMP. Cast the server clock to the
      // same type so client session timezones cannot make fresh rows look stale.
      await c.execute("UPDATE CUSTOMERS.SEC_BILLING_REMINDER SET EMAIL_STATUS='FAILED' WHERE EMAIL_STATUS='SENDING' AND UPDATED_AT<CAST(SYSTIMESTAMP AS TIMESTAMP)-INTERVAL '30' MINUTE");
      const result = await c.execute<any>(`SELECT r.REMINDER_ID,r.INVOICE_ID,r.KIND,r.EMAIL_TO,i.TENANT_ID,i.COMPANY_CODE,i.CURRENCY,i.AMOUNT,
        TO_CHAR(i.PERIOD_START,'YYYY-MM-DD') PERIOD_START,TO_CHAR(i.PERIOD_END,'YYYY-MM-DD') PERIOD_END,
        TO_CHAR(i.DUE_DATE,'YYYY-MM-DD') DUE_DATE,TO_CHAR(i.GRACE_END,'YYYY-MM-DD') GRACE_END
        FROM CUSTOMERS.SEC_BILLING_REMINDER r JOIN CUSTOMERS.SEC_BILLING_INVOICE i ON i.INVOICE_ID=r.INVOICE_ID
        JOIN CUSTOMERS.SEC_COMPANY_SUBSCRIPTION s ON s.TENANT_ID=i.TENANT_ID AND s.COMPANY_CODE=i.COMPANY_CODE
        WHERE (r.EMAIL_STATUS='PENDING' OR (r.EMAIL_STATUS='FAILED' AND r.UPDATED_AT<CAST(SYSTIMESTAMP AS TIMESTAMP)-INTERVAL '10' MINUTE)) AND r.ATTEMPTS<5 AND s.BILLING_ENABLED='Y' AND i.STATUS='PENDING' AND ROWNUM<=1
        ${process.env.PUBLIC_REGISTRATION_INSTALLED==='true'?"AND NOT EXISTS(SELECT 1 FROM CUSTOMERS.SEC_PUBLIC_SIGNUP signup WHERE signup.TENANT_ID=i.TENANT_ID AND signup.COMPANY_CODE=i.COMPANY_CODE AND signup.STATE='COMPLETE' AND signup.SETUP_STATUS<>'READY')":''}
        FOR UPDATE OF r.EMAIL_STATUS SKIP LOCKED`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const item = result.rows?.[0];
      if (item) await c.execute("UPDATE CUSTOMERS.SEC_BILLING_REMINDER SET EMAIL_STATUS='SENDING',ATTEMPTS=ATTEMPTS+1,UPDATED_AT=SYSTIMESTAMP WHERE REMINDER_ID=:id", { id: item.REMINDER_ID });
      await c.commit(); return item;
    });
    if (!row) break;
    try {
      // Recheck immediately before delivery: disabling billing stops queued sends.
      const valid = await Platform.root(async c => (await c.execute(`SELECT 1 FROM CUSTOMERS.SEC_COMPANY_SUBSCRIPTION s JOIN CUSTOMERS.SEC_BILLING_INVOICE i ON i.TENANT_ID=s.TENANT_ID AND i.COMPANY_CODE=s.COMPANY_CODE WHERE i.INVOICE_ID=:id AND i.STATUS='PENDING' AND s.BILLING_ENABLED='Y'`, { id: row.INVOICE_ID })).rows?.length);
      if (valid) await send(row);
      await Platform.root(async c => { await c.execute("UPDATE CUSTOMERS.SEC_BILLING_REMINDER SET EMAIL_STATUS=:status,LAST_ERROR=NULL,UPDATED_AT=SYSTIMESTAMP WHERE REMINDER_ID=:id", { id: row.REMINDER_ID, status: valid ? "SENT" : "SKIPPED" }); await c.commit(); });
    } catch {
      await Platform.root(async c => { await c.execute("UPDATE CUSTOMERS.SEC_BILLING_REMINDER SET EMAIL_STATUS='FAILED',LAST_ERROR='Email delivery failed; check SMTP settings',UPDATED_AT=SYSTIMESTAMP WHERE REMINDER_ID=:id", { id: row.REMINDER_ID }); await c.commit(); });
    }
  }
}
