import { PlatformAdminService as Platform, PlatformError } from "./platformAdmin.service";
import oracledb from "oracledb";
import { assertRegistrationAccess } from './registrationAccess.service';
const inactive = (value: any) => ["N","I","INACTIVE","DISABLED","0"].includes(String(value || "").trim().toUpperCase());
export class CompanyAccountService {
  private static async stateProjection(c: oracledb.Connection, owner: string, table: string, candidates: string[]) {
    const columns = await Platform.columns(c, owner, table);
    const present = candidates.filter(name => columns.some(column => column.COLUMN_NAME === name));
    // Legacy tenant company tables have no activation column. Still check that
    // the company exists, without selecting a column that is absent there.
    return present.length ? present.join(",") : "1 AS FOUND";
  }
  static async assertActive(tenant: string, company: string, loginid: string) {
    if (!tenant || !company || !loginid) throw new PlatformError("Select your tenant company", 403);
    await assertRegistrationAccess(tenant,company);
    return Platform.scope(tenant, async (c, owner) => {
      const companyState = await this.stateProjection(c, owner, "MS_COMPANY", ["STATUS", "ACTIVE_FLAG", "IS_ACTIVE"]);
      const companyRow = await c.execute<any>(`SELECT ${companyState} FROM ${owner}.MS_COMPANY WHERE COMPANY_CODE=:company`, { company }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!companyRow.rows?.length || companyRow.rows.some(row => Object.values(row).some(inactive))) throw new PlatformError("Your company is inactive. Contact your administrator.", 403);
      const userState = await this.stateProjection(c, owner, "SEC_LOGIN", ["ACTIVE_FLAG", "IS_ACTIVE"]);
      const user = await c.execute<any>(`SELECT ${userState} FROM ${owner}.SEC_LOGIN WHERE COMPANY_CODE=:company AND UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid))`, { company, loginid }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!user.rows?.length || user.rows.some(row => Object.values(row).some(inactive))) throw new PlatformError("Your account is inactive. Contact your administrator.", 403);
      const root = await c.execute<any>("SELECT ACTIVE_FLAG FROM CUSTOMERS.SEC_LOGINTEST WHERE UPPER(TRIM(LOGINID))=UPPER(TRIM(:loginid))", { loginid }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      if (!root.rows?.length || root.rows.some(row => inactive(row.ACTIVE_FLAG))) throw new PlatformError("Your account is inactive. Contact your administrator.", 403);
    });
  }
}
