import oracledb from 'oracledb';
import {registrationStorageAvailable} from './registrationRuntime.service';
import { PlatformAdminService as Platform, PlatformError } from './platformAdmin.service';

// Restriction is evaluated on login AND on existing JWTs. No scheduler timing gap.
// Existing companies have no registration row and retain their existing billing policy.
export async function assertRegistrationAccess(tenant: string, company: string) {
  if (!await registrationStorageAvailable()) return;
  const blocked = await Platform.root(async c => (await c.execute(`SELECT 1 FROM CUSTOMERS.SEC_PUBLIC_SIGNUP r
    JOIN CUSTOMERS.SEC_COMPANY_SUBSCRIPTION s ON s.TENANT_ID=r.TENANT_ID AND s.COMPANY_CODE=r.COMPANY_CODE
    WHERE r.TENANT_ID=:tenant AND r.COMPANY_CODE=:company AND r.STATE='COMPLETE'
    AND (r.SETUP_STATUS<>'READY' OR (s.BILLING_ENABLED='Y' AND (s.SUSPENDED='Y' OR s.CANCEL_ON<TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)))) OR
      (r.TRIAL_END_AT<=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP) AND NOT EXISTS
        (SELECT 1 FROM CUSTOMERS.SEC_BILLING_INVOICE i WHERE i.TENANT_ID=r.TENANT_ID AND i.COMPANY_CODE=r.COMPANY_CODE AND i.STATUS='PAID' AND i.PERIOD_START<=TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)) AND i.PERIOD_END>=TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)))
        AND NOT EXISTS(SELECT 1 FROM CUSTOMERS.SEC_BILLING_INVOICE i WHERE i.TENANT_ID=r.TENANT_ID AND i.COMPANY_CODE=r.COMPANY_CODE AND i.STATUS='PENDING' AND i.PERIOD_START<=TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)) AND i.GRACE_END>=TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP))
          AND EXISTS(SELECT 1 FROM CUSTOMERS.SEC_BILLING_INVOICE p WHERE p.TENANT_ID=r.TENANT_ID AND p.COMPANY_CODE=r.COMPANY_CODE AND p.STATUS='PAID'))) OR
      (s.BILLING_ENABLED='Y' AND EXISTS(SELECT 1 FROM CUSTOMERS.SEC_BILLING_INVOICE i WHERE i.TENANT_ID=r.TENANT_ID AND i.COMPANY_CODE=r.COMPANY_CODE AND i.STATUS='PENDING' AND i.GRACE_END<TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)))))`, {tenant,company}, {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows?.length);
  if (blocked) throw new PlatformError('Your trial or paid period has ended. Contact billing with your payment reference to continue.', 403);
}
