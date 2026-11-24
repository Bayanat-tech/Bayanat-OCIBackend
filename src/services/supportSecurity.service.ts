import oracledb from 'oracledb';
export type SupportIdentity = { loginid: string; tenantId: string; companyCode: string };
const read = async (c: oracledb.Connection, sql: string, b: any = {}) =>
    (await c.execute<any>(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows || [];

export async function supportSecuritySchema(c: oracledb.Connection, _tenantId: string) {
    try {
        const [r] = await read(c, "SELECT SCHEMA_NAME FROM CUSTOMERS.TENANT_REGISTRY WHERE TENANT_ID=(SELECT CONFIG_VALUE FROM CUSTOMERS.SUPPORT_CONFIG WHERE CONFIG_KEY='SECURITY_TENANT') AND IS_ACTIVE='Y'", {});
        const owner = String(r?.SCHEMA_NAME || '').toUpperCase();
        if (!/^[A-Z][A-Z0-9_]*$/.test(owner)) return '';
        return owner;
    } catch {
        return '';
    }
}

export async function nativeSupportRole(c: oracledb.Connection, id: SupportIdentity): Promise<'admin' | 'developer' | 'user'> {
 if (id.tenantId.trim().toUpperCase() === 'BTIND_TENANT') {
   const [developer] = await read(c, `SELECT 1 OK FROM CUSTOMERS.SUPPORT_DEVELOPER d
     JOIN CUSTOMERS.SEC_LOGINTEST s ON UPPER(TRIM(s.LOGINID))=UPPER(TRIM(d.LOGINID))
     JOIN CUSTOMERS.USER_TENANT_MAPPING m ON UPPER(TRIM(m.LOGINID))=UPPER(TRIM(s.LOGINID))
     JOIN CUSTOMERS.TENANT_REGISTRY t ON t.TENANT_ID=m.TENANT_ID
     WHERE UPPER(TRIM(d.LOGINID))=UPPER(TRIM(:loginid))
       AND d.ACTIVE_FLAG='Y' AND s.ACTIVE_FLAG='Y'
       AND m.TENANT_ID='BTIND_TENANT' AND t.IS_ACTIVE='Y' AND UPPER(TRIM(t.SCHEMA_NAME))='BTIND'
       AND UPPER(TRIM(d.COMPANY_CODE))=UPPER(TRIM(:companyCode))
       AND EXISTS (SELECT 1 FROM BTIND.SEC_LOGIN l WHERE UPPER(TRIM(l.LOGINID))=UPPER(TRIM(s.LOGINID))
         AND UPPER(TRIM(l.COMPANY_CODE))=UPPER(TRIM(:companyCode)))`, {loginid:id.loginid,companyCode:id.companyCode});
   return developer ? 'developer' : 'user';
 }
 if (id.loginid.trim().toUpperCase() !== 'DEVADMIN' || id.tenantId.trim().toUpperCase() !== 'WMSDEV_TENANT') return 'user';
 const [approved] = await read(c, `SELECT 1 OK FROM CUSTOMERS.SEC_LOGINTEST s JOIN CUSTOMERS.USER_TENANT_MAPPING m ON UPPER(TRIM(m.LOGINID))=UPPER(TRIM(s.LOGINID)) AND m.IS_DEFAULT='Y' JOIN CUSTOMERS.TENANT_REGISTRY t ON t.TENANT_ID=m.TENANT_ID AND t.IS_ACTIVE='Y' WHERE UPPER(TRIM(s.LOGINID))='DEVADMIN' AND s.ACTIVE_FLAG='Y' AND m.TENANT_ID='WMSDEV_TENANT' AND UPPER(t.SCHEMA_NAME)='WMSDEV' AND s.COMPANY_CODE=:companyCode`, {companyCode:id.companyCode});
 return approved ? 'admin' : 'user';
}

export async function setNativeSupportAccess(c: oracledb.Connection, id: SupportIdentity, kind: 'ADMIN' | 'DEVELOPER', active: boolean, actor: string) {
    if (kind !== 'ADMIN' || await nativeSupportRole(c, id) !== 'admin') return;
    const owner = await supportSecuritySchema(c, id.tenantId);
    if (!owner) return;
    const label = kind === 'ADMIN' ? 'Support Administrator' : 'Support Developer';
    try {
        const rows = await read(c, `SELECT r.ROLE_ID FROM ${owner}.SEC_ROLE_MASTER r WHERE UPPER(r.ROLE_DESC)=UPPER(:label)`, { label });
        if (rows.length !== 1) return;
        const flag = active ? 'Y' : 'N';
        const flags = ['SNEW', 'SMODIFY', 'SDELETE', 'SSAVE', 'SSEARCH', 'SSAVEAS', 'SUPLOAD', 'SUNDO', 'SPRINT', 'SPRINTSETUP', 'SHELP'];
        await c.execute(`MERGE INTO ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER d USING(SELECT :loginid LOGINID,:rid ROLE_ID,:company COMPANY_CODE FROM dual)s
            ON(UPPER(d.LOGINID)=s.LOGINID AND d.SERIAL_NO_OR_ROLE_ID=s.ROLE_ID AND d.COMPANY_CODE=s.COMPANY_CODE)
            WHEN MATCHED THEN UPDATE SET ${flags.map(k => `d.${k}=:flag`).join(',')},USERID=:actor,USER_DT=systimestamp
            WHEN NOT MATCHED THEN INSERT(COMPANY_CODE,LOGINID,SERIAL_NO_OR_ROLE_ID,${flags.join(',')},USERID,CREATE_USER,CREATE_DATE)
            VALUES(:company,:loginid,:rid,${flags.map(() => ':flag').join(',')},:actor,:actor,systimestamp)`, { loginid: id.loginid, company: id.companyCode, rid: rows[0].ROLE_ID, flag, actor });
    } catch {
        // ignore schema permission errors
    }
}

export async function prepareSupportAccess(c: oracledb.Connection, id: SupportIdentity) {
    if (await nativeSupportRole(c, id) !== 'admin') return;
    await setNativeSupportAccess(c, id, 'ADMIN', true, 'SUPPORT_SETUP');
    await cacheSupportMember(c, id, 'ADMIN');
}

export async function cacheSupportMember(c: oracledb.Connection, id: SupportIdentity, kind: 'ADMIN' | 'DEVELOPER') {
    try {
        await c.execute(`MERGE INTO CUSTOMERS.SUPPORT_MEMBER d USING(SELECT :loginid LOGINID,:tenantId TENANT_ID,:companyCode COMPANY_CODE FROM dual)s
            ON(d.LOGINID=s.LOGINID AND d.TENANT_ID=s.TENANT_ID AND d.COMPANY_CODE=s.COMPANY_CODE)
            WHEN MATCHED THEN UPDATE SET SUPPORT_ROLE=:kind,ACTIVE_FLAG='Y',SECURITY_SYNCED='Y'
            WHEN NOT MATCHED THEN INSERT(LOGINID,TENANT_ID,COMPANY_CODE,SUPPORT_ROLE,ACTIVE_FLAG,SECURITY_SYNCED,CREATED_BY) VALUES(:loginid,:tenantId,:companyCode,:kind,'Y','Y','SECURITY_ROLE')`, { ...id, kind });
    } catch {
        // ignore
    }
}

export async function nativeSupportDevelopers(c: oracledb.Connection) {
    try {
        return await read(c, `SELECT DISTINCT 
            UPPER(d.LOGINID) AS LOGINID,
            NVL(d.USERNAME, NVL(s.USERNAME, d.LOGINID)) AS USERNAME,
            NVL(d.EMAIL_ID, s.EMAIL_ID) AS EMAIL_ID,
            NVL(d.COMPANY_CODE, NVL(s.COMPANY_CODE, 'BSG')) AS COMPANY_CODE,
            NVL(m.TENANT_ID, 'BTIND_TENANT') AS TENANT_ID,
            NVL(d.ACTIVE_FLAG, 'Y') AS ACTIVE_FLAG,
            d.SKILL_TAGS,
            CASE WHEN p.LAST_SEEN_AT >= SYSDATE - (3/1440) THEN 'Y' ELSE 'N' END AS IS_ONLINE,
            TO_CHAR(p.LAST_SEEN_AT, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS LAST_SEEN_AT
        FROM CUSTOMERS.SUPPORT_DEVELOPER d
        LEFT JOIN CUSTOMERS.SEC_LOGINTEST s ON UPPER(s.LOGINID)=UPPER(d.LOGINID)
        LEFT JOIN CUSTOMERS.USER_TENANT_MAPPING m ON UPPER(m.LOGINID)=UPPER(d.LOGINID) AND m.IS_DEFAULT='Y'
        LEFT JOIN CUSTOMERS.SUPPORT_PRESENCE p ON UPPER(p.LOGINID)=UPPER(d.LOGINID)
        ORDER BY USERNAME`);
    } catch {
        return [];
    }
}

export async function nativeSupportMenu(c: oracledb.Connection, id: SupportIdentity) {
    const role = await nativeSupportRole(c, id);
    if (role === 'user') return [];

    if (role === 'developer') {
        return [
            {
                SERIAL_NO: 98001,
                APP_CODE: 'Support',
                LEVEL1: 'Developer Desk',
                LEVEL2: 'My Assignments',
                MODULE_CODE: 'support',
                MODULE_NAME: 'My Assignments',
                URL_PATH: 'support/assigned',
                PARENT_SERIAL_NO: 0,
                POSITION: 1,
                IS_ACTIVE: 'Y',
                ICON: 'Briefcase'
            }
        ];
    }

    // Role is admin (e.g. DEVADMIN)
    return [
        {
            SERIAL_NO: 97001,
            APP_CODE: 'Support',
            LEVEL1: 'Service Desk',
            LEVEL2: 'Support Dashboard',
            MODULE_CODE: 'support',
            MODULE_NAME: 'Support Dashboard',
            URL_PATH: 'support/dashboard',
            PARENT_SERIAL_NO: 0,
            POSITION: 1,
            IS_ACTIVE: 'Y',
            ICON: 'LayoutDashboard'
        },
        {
            SERIAL_NO: 97002,
            APP_CODE: 'Support',
            LEVEL1: 'Service Desk',
            LEVEL2: 'Ticket Queue',
            MODULE_CODE: 'support',
            MODULE_NAME: 'Ticket Queue',
            URL_PATH: 'support/tickets',
            PARENT_SERIAL_NO: 0,
            POSITION: 2,
            IS_ACTIVE: 'Y',
            ICON: 'MessageSquare'
        },
        {
            SERIAL_NO: 97003,
            APP_CODE: 'Support',
            LEVEL1: 'Service Desk',
            LEVEL2: 'Developers',
            MODULE_CODE: 'support',
            MODULE_NAME: 'Developers',
            URL_PATH: 'support/team',
            PARENT_SERIAL_NO: 0,
            POSITION: 3,
            IS_ACTIVE: 'Y',
            ICON: 'Users'
        },
        {
            SERIAL_NO: 97004,
            APP_CODE: 'Support',
            LEVEL1: 'Service Desk',
            LEVEL2: 'Category Master',
            MODULE_CODE: 'support',
            MODULE_NAME: 'Category Master',
            URL_PATH: 'support/categories',
            PARENT_SERIAL_NO: 0,
            POSITION: 4,
            IS_ACTIVE: 'Y',
            ICON: 'Tags'
        },
        {
            SERIAL_NO: 97005,
            APP_CODE: 'Support',
            LEVEL1: 'Service Desk',
            LEVEL2: 'Service Overview',
            MODULE_CODE: 'support',
            MODULE_NAME: 'Service Overview',
            URL_PATH: 'support/reports',
            PARENT_SERIAL_NO: 0,
            POSITION: 5,
            IS_ACTIVE: 'Y',
            ICON: 'BarChart3'
        },
        {
            SERIAL_NO: 97006,
            APP_CODE: 'Support',
            LEVEL1: 'Service Desk',
            LEVEL2: 'Notifications',
            MODULE_CODE: 'support',
            MODULE_NAME: 'Notifications',
            URL_PATH: 'support/settings',
            PARENT_SERIAL_NO: 0,
            POSITION: 6,
            IS_ACTIVE: 'Y',
            ICON: 'Bell'
        }
    ];
}
