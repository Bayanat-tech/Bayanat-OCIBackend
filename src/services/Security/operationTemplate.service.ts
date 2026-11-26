import oracledb from 'oracledb';
import { PlatformAdminService as Platform, PlatformError } from './platformAdmin.service';
export const operationFlags = ['snew','smodify','sdelete','ssave','ssearch','ssaveas','supload','sundo','sprint','sprintsetup','shelp'];
export async function readOperationTemplates(c:oracledb.Connection,owner:string,company:string,serial?:number) {
  const columns=await Platform.columns(c,owner,'SEC_OPERATION_MASTER');
  if(!columns.length)return [];
  const names=new Set(columns.map(col=>col.COLUMN_NAME)),hasCompany=names.has('COMPANY_CODE');
  const projection=operationFlags.map(f=>names.has(f.toUpperCase())?f.toUpperCase():`'N' AS ${f.toUpperCase()}`).join(',');
  const result=await c.execute<any>(`SELECT SERIAL_NO,${projection}${hasCompany?',COMPANY_CODE':''} FROM ${owner}.SEC_OPERATION_MASTER WHERE 1=1 ${serial?'AND SERIAL_NO=:serial':''} ${hasCompany?'AND (COMPANY_CODE=:company OR COMPANY_CODE IS NULL) ORDER BY CASE WHEN COMPANY_CODE=:company THEN 0 ELSE 1 END':''}`,{...(serial?{serial}:{}),...(hasCompany?{company}:{})},{outFormat:oracledb.OUT_FORMAT_OBJECT});
  return result.rows||[];
}
export async function operationTemplate(tenant: string, company: string, serial: number) {
  if (!tenant || !Number.isSafeInteger(serial) || serial <= 0) throw new PlatformError('Select a valid tenant screen');
  return Platform.scope(tenant, async (c, owner) => {
    const screen = await c.execute(`SELECT 1 FROM ${owner}.SEC_MODULE_DATA WHERE SERIAL_NO=:serial`, {serial});
    if (!screen.rows?.length) throw new PlatformError('Screen not found in this tenant',404);
    const template = (await readOperationTemplates(c,owner,company,serial))[0];
    // Some legacy screens have no operation-master row. The company middleware
    // still caps every returned operation to the administrator's live grants.
    return [{serial_no:serial,company_code:company,...Object.fromEntries(operationFlags.map(f=>[f,template ? String(template[f.toUpperCase()] || 'N').toUpperCase() : 'Y']))}];
  });
}
