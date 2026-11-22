import { PlatformAdminService as Platform, PlatformError } from "./platformAdmin.service";
import oracledb from "oracledb";
const inactive = (value: any) => ["N","I","INACTIVE","DISABLED","0"].includes(String(value || "").trim().toUpperCase());
export class CompanyAccountService {
  static async assertActive(tenant: string, company: string, loginid: string) {
    if (!tenant || !company || !loginid) throw new PlatformError("Select your tenant company", 403);
    return Platform.scope(tenant, async (c, owner) => {
      const companyRow = await c.execute<any>(`SELECT STATUS FROM ${owner}.MS_COMPANY WHERE COMPANY_CODE=:company`, { company }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!companyRow.rows?.length || inactive(companyRow.rows[0].STATUS)) throw new PlatformError("Your company is inactive. Contact your administrator.", 403);
      const user = await c.execute<any>(`SELECT ACTIVE_FLAG FROM ${owner}.SEC_LOGIN WHERE COMPANY_CODE=:company AND UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid))`, { company, loginid }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!user.rows?.length || user.rows.some(row => inactive(row.ACTIVE_FLAG))) throw new PlatformError("Your account is inactive. Contact your administrator.", 403);
      const root = await c.execute<any>("SELECT ACTIVE_FLAG FROM CUSTOMERS.SEC_LOGINTEST WHERE UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid))", { loginid }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!root.rows?.length || root.rows.some(row => inactive(row.ACTIVE_FLAG))) throw new PlatformError("Your account is inactive. Contact your administrator.", 403);
    });
  }
}
