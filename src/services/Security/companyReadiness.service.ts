import oracledb from "oracledb";
import { PlatformAdminService as Platform } from "./platformAdmin.service";
import { CompanySubscriptionService as Subscription } from "./companySubscription.service";

export async function companyModuleReadiness(actor: string, tenant: string, company: string) {
  await Subscription.validateCompany(actor, tenant, company);
  return Platform.scope(tenant, async (c, owner) => {
    const result = await c.execute<any>(`SELECT u.LOGINID,COUNT(DISTINCT m.APP_CODE) MODULE_COUNT
      FROM ${owner}.SEC_LOGIN u LEFT JOIN (
        SELECT LOGINID,COMPANY_CODE,SERIAL_NO_OR_ROLE_ID SERIAL_NO FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER
        WHERE SERIAL_NO_OR_ROLE_ID<90001
        UNION ALL
        SELECT b.LOGINID,b.COMPANY_CODE,a.SERIAL_NO FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER b
        JOIN ${owner}.SEC_ROLE_APP_ACCESS a ON a.ROLE_ID=b.SERIAL_NO_OR_ROLE_ID
        WHERE a.COMPANY_CODE=:company OR a.COMPANY_CODE IS NULL
      ) g ON UPPER(TRIM(g.LOGINID))=UPPER(TRIM(u.LOGINID)) AND (g.COMPANY_CODE=:company OR g.COMPANY_CODE IS NULL)
      LEFT JOIN ${owner}.SEC_MODULE_DATA m ON m.SERIAL_NO=g.SERIAL_NO AND UPPER(TRIM(m.APP_CODE)) NOT IN ('SECURITY','SUPPORT')
      AND NOT EXISTS (SELECT 1 FROM CUSTOMERS.SEC_COMPANY_SCREEN_ACCESS x WHERE x.TENANT_ID=:tenant AND x.COMPANY_CODE=:company AND x.SERIAL_NO=m.SERIAL_NO AND x.IS_ENABLED='N')
      WHERE u.COMPANY_CODE=:company GROUP BY u.LOGINID ORDER BY u.LOGINID`, { company, tenant }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const users = result.rows || [];
    return { users, companyNeedsModules: !users.some(u => Number(u.MODULE_COUNT) > 0), userCount: users.length };
  });
}
