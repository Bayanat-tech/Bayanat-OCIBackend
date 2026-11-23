import oracledb from "oracledb";
import { PlatformAdminService as Platform } from "./platformAdmin.service";
export function isGeneralMaster(row: Record<string, any>) {
  if (["SECURITY","SUPPORT","BTSUPPORT"].includes(String(row.APP_CODE || "").replace(/[^a-z]/gi, "").toUpperCase())) return false;
  const level = String(row.LEVEL2 || "").replace(/[^a-z]/gi, "").toLowerCase();
  return /\/masters\/gm\//i.test(String(row.URL_PATH || "")) || level === "generalmaster" || level === "generalmasters";
}
export async function seedDefaultMasterAccess(c: oracledb.Connection, owner: string, tenant: string, company: string, loginid: string) {
  const screens = (await Platform.screenCatalog(tenant, company)).filter(isGeneralMaster);
  const disabled = await c.execute<any>("SELECT SERIAL_NO FROM CUSTOMERS.SEC_COMPANY_SCREEN_ACCESS WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND IS_ENABLED='N'", { tenant, company }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  const deny = new Set((disabled.rows || []).map(r => Number(r.SERIAL_NO)));
  const serials = [...new Set(screens.map(s => Number(s.SERIAL_NO)).filter(n => n > 0 && n < 90001 && !deny.has(n)))];
  if (serials.length) await c.executeMany(`MERGE INTO ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER t USING (SELECT :company COMPANY_CODE,:loginid LOGINID,:serial SERIAL_NO_OR_ROLE_ID FROM DUAL) s
    ON (t.COMPANY_CODE=s.COMPANY_CODE AND t.LOGINID=s.LOGINID AND t.SERIAL_NO_OR_ROLE_ID=s.SERIAL_NO_OR_ROLE_ID)
    WHEN NOT MATCHED THEN INSERT (COMPANY_CODE,LOGINID,SERIAL_NO_OR_ROLE_ID,SNEW,SMODIFY,SDELETE,SSAVE,SSEARCH,SSAVEAS,SUPLOAD,SUNDO,SPRINT,SPRINTSETUP,SHELP,USERID)
    VALUES (:company,:loginid,:serial,'N','N','N','N','Y','N','N','N','N','N','N',:loginid)`, serials.map(serial => ({ company, loginid, serial })));
  return serials.length;
}

// Only platform-provisioned accounts receive internal company administration.
export async function seedCompanyAdminAccess(c: oracledb.Connection, owner: string, tenant: string, company: string, loginid: string) {
  const screens = (await Platform.screenCatalog(tenant, company)).filter(s => /^security\/masters\/gm\/(sec_login|access_assign_user|company)\/?$/i.test(String(s.URL_PATH || '').replace(/^\//, '')));
  const rows = [...new Map(screens.map(s => [Number(s.SERIAL_NO), s])).values()];
  const flags = ['SNEW','SMODIFY','SDELETE','SSAVE','SSEARCH','SSAVEAS','SUPLOAD','SUNDO','SPRINT','SPRINTSETUP','SHELP'];
  for (const screen of rows) {
    const companyScreen = /\/company\/?$/i.test(String(screen.URL_PATH));
    await c.execute(`MERGE INTO ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER t USING (SELECT :company COMPANY_CODE,:loginid LOGINID,:serial SERIAL_NO_OR_ROLE_ID FROM DUAL) s
      ON(t.COMPANY_CODE=s.COMPANY_CODE AND t.LOGINID=s.LOGINID AND t.SERIAL_NO_OR_ROLE_ID=s.SERIAL_NO_OR_ROLE_ID)
      WHEN NOT MATCHED THEN INSERT(COMPANY_CODE,LOGINID,SERIAL_NO_OR_ROLE_ID,${flags.join(',')},USERID)
      VALUES(:company,:loginid,:serial,${flags.map(f => companyScreen && ['SNEW','SDELETE'].includes(f) ? "'N'" : "'Y'").join(',')},:loginid)`, {company, loginid, serial:Number(screen.SERIAL_NO)});
  }
  return rows.length;
}
