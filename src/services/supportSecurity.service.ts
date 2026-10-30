import oracledb from 'oracledb';
export type SupportIdentity={loginid:string;tenantId:string;companyCode:string};
const read=async(c:oracledb.Connection,sql:string,b:any={})=>(await c.execute<any>(sql,b,{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows||[];
export async function supportSecuritySchema(c:oracledb.Connection,tenantId:string){
 const [r]=await read(c,"SELECT SCHEMA_NAME FROM CUSTOMERS.TENANT_REGISTRY WHERE TENANT_ID=(SELECT CONFIG_VALUE FROM CUSTOMERS.SUPPORT_CONFIG WHERE CONFIG_KEY='SECURITY_TENANT') AND IS_ACTIVE='Y'",{});
 const owner=String(r?.SCHEMA_NAME||'').toUpperCase();if(!/^[A-Z][A-Z0-9_]*$/.test(owner))return '';return owner;
}
const activeColumns=new Map<string,boolean>();
async function activeClause(c:oracledb.Connection,owner:string){let available=activeColumns.get(owner);if(available===undefined){available=(await read(c,"SELECT 1 FROM ALL_TAB_COLUMNS WHERE OWNER=:owner AND TABLE_NAME='SEC_MODULE_DATA' AND COLUMN_NAME='IS_ACTIVE'",{owner})).length>0;activeColumns.set(owner,available);}return available?" AND NVL(m.IS_ACTIVE,'Y')='Y'":'';}
export async function nativeSupportRole(c:oracledb.Connection,id:SupportIdentity):Promise<'admin'|'developer'|'user'>{
 const owner=await supportSecuritySchema(c,id.tenantId);if(!owner)return 'user';
 const [valid]=await read(c,"SELECT 1 OK FROM CUSTOMERS.USER_TENANT_MAPPING m JOIN CUSTOMERS.SEC_LOGINTEST s ON UPPER(s.LOGINID)=UPPER(m.LOGINID) WHERE UPPER(m.LOGINID)=:loginid AND m.TENANT_ID=:tenantId AND m.IS_DEFAULT='Y' AND s.COMPANY_CODE=:companyCode AND NVL(s.ACTIVE_FLAG,'1') IN('1','Y','A')",id);if(!valid)return 'user';
 try{const rows=await read(c,`WITH granted AS (
 SELECT a.SERIAL_NO FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER u JOIN ${owner}.SEC_ROLE_APP_ACCESS a ON a.ROLE_ID=u.SERIAL_NO_OR_ROLE_ID
 WHERE UPPER(u.LOGINID)=:loginid AND u.COMPANY_CODE=:companyCode
 AND u.SSEARCH='Y' AND u.SSAVE='Y' AND u.SMODIFY='Y' AND a.SSEARCH='Y' AND a.SSAVE='Y' AND a.SMODIFY='Y'
 UNION SELECT SERIAL_NO_OR_ROLE_ID FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER WHERE UPPER(LOGINID)=:loginid AND COMPANY_CODE=:companyCode AND SSEARCH='Y' AND SSAVE='Y' AND SMODIFY='Y' AND SERIAL_NO_OR_ROLE_ID<90001
 ) SELECT m.URL_PATH FROM ${owner}.SEC_MODULE_DATA m JOIN granted g ON g.SERIAL_NO=m.SERIAL_NO
 WHERE LOWER(m.APP_CODE)='support' ${await activeClause(c,owner)}`,{loginid:id.loginid,companyCode:id.companyCode});
 if(rows.some(r=>r.URL_PATH==='support/tickets'))return 'admin';if(rows.some(r=>r.URL_PATH==='support/assigned'))return 'developer';return 'user';
 }catch(e:any){if([942,1031].includes(e.errorNum))return 'user';throw e;}
}
export async function setNativeSupportAccess(c:oracledb.Connection,id:SupportIdentity,kind:'ADMIN'|'DEVELOPER',active:boolean,actor:string){
 const owner=await supportSecuritySchema(c,id.tenantId);if(!owner)throw Object.assign(Error('The account needs an active default tenant'),{status:400});
 const label=kind==='ADMIN'?'Support Administrator':'Support Developer';
 const rows=await read(c,`SELECT r.ROLE_ID FROM ${owner}.SEC_ROLE_MASTER r WHERE UPPER(r.ROLE_DESC)=UPPER(:label)`,{label});
 if(rows.length!==1)throw Object.assign(Error('Configure the Support screen catalogue and role in this account’s tenant first'),{status:400});
 const flag=active?'Y':'N';const flags=['SNEW','SMODIFY','SDELETE','SSAVE','SSEARCH','SSAVEAS','SUPLOAD','SUNDO','SPRINT','SPRINTSETUP','SHELP'];
 await c.execute(`MERGE INTO ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER d USING(SELECT :loginid LOGINID,:rid ROLE_ID,:company COMPANY_CODE FROM dual)s
 ON(UPPER(d.LOGINID)=s.LOGINID AND d.SERIAL_NO_OR_ROLE_ID=s.ROLE_ID AND d.COMPANY_CODE=s.COMPANY_CODE)
 WHEN MATCHED THEN UPDATE SET ${flags.map(k=>`d.${k}=:flag`).join(',')},USERID=:actor,USER_DT=systimestamp
 WHEN NOT MATCHED THEN INSERT(COMPANY_CODE,LOGINID,SERIAL_NO_OR_ROLE_ID,${flags.join(',')},USERID,CREATE_USER,CREATE_DATE)
 VALUES(:company,:loginid,:rid,${flags.map(()=>':flag').join(',')},:actor,:actor,systimestamp)`,{loginid:id.loginid,company:id.companyCode,rid:rows[0].ROLE_ID,flag,actor});
}
export async function prepareSupportAccess(c:oracledb.Connection,id:SupportIdentity){
 let [m]=await read(c,'SELECT SUPPORT_ROLE,ACTIVE_FLAG,SECURITY_SYNCED FROM CUSTOMERS.SUPPORT_MEMBER WHERE LOGINID=:loginid AND TENANT_ID=:tenantId AND COMPANY_CODE=:companyCode',id);
 if(m?.SECURITY_SYNCED==='Y'||m?.ACTIVE_FLAG==='N')return;
 if(!m){const [approved]=await read(c,`SELECT 1 OK FROM CUSTOMERS.SEC_LOGINTEST s JOIN CUSTOMERS.USER_TENANT_MAPPING x ON UPPER(x.LOGINID)=UPPER(s.LOGINID) AND x.IS_DEFAULT='Y'
 JOIN CUSTOMERS.SUPPORT_CONTACT a ON LOWER(a.EMAIL_ID)=LOWER(s.EMAIL_ID) AND a.CAN_MANAGE='Y' AND a.ACTIVE_FLAG='Y'
 WHERE UPPER(s.LOGINID)=:loginid AND s.COMPANY_CODE=:companyCode AND x.TENANT_ID=:tenantId`,id);if(!approved)return;m={SUPPORT_ROLE:'ADMIN'};}
 try{await setNativeSupportAccess(c,id,m.SUPPORT_ROLE,true,'SUPPORT_SETUP');}catch(e:any){if(e.status===400)return;throw e;}
 await cacheSupportMember(c,id,m.SUPPORT_ROLE);
}
export async function cacheSupportMember(c:oracledb.Connection,id:SupportIdentity,kind:'ADMIN'|'DEVELOPER'){
 await c.execute(`MERGE INTO CUSTOMERS.SUPPORT_MEMBER d USING(SELECT :loginid LOGINID,:tenantId TENANT_ID,:companyCode COMPANY_CODE FROM dual)s
 ON(d.LOGINID=s.LOGINID AND d.TENANT_ID=s.TENANT_ID AND d.COMPANY_CODE=s.COMPANY_CODE)
 WHEN MATCHED THEN UPDATE SET SUPPORT_ROLE=:kind,ACTIVE_FLAG='Y',SECURITY_SYNCED='Y'
 WHEN NOT MATCHED THEN INSERT(LOGINID,TENANT_ID,COMPANY_CODE,SUPPORT_ROLE,ACTIVE_FLAG,SECURITY_SYNCED,CREATED_BY) VALUES(:loginid,:tenantId,:companyCode,:kind,'Y','Y','SECURITY_ROLE')`,{...id,kind});
}
export async function nativeSupportDevelopers(c:oracledb.Connection){
 const owner=await supportSecuritySchema(c,'');if(!owner)return [];
 return read(c,`SELECT DISTINCT UPPER(s.LOGINID) LOGINID,s.USERNAME,s.EMAIL_ID,s.COMPANY_CODE,x.TENANT_ID FROM CUSTOMERS.SEC_LOGINTEST s
 JOIN CUSTOMERS.USER_TENANT_MAPPING x ON UPPER(x.LOGINID)=UPPER(s.LOGINID) AND x.IS_DEFAULT='Y'
 JOIN ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER u ON UPPER(u.LOGINID)=UPPER(s.LOGINID) AND u.COMPANY_CODE=s.COMPANY_CODE
 JOIN ${owner}.SEC_ROLE_APP_ACCESS a ON a.ROLE_ID=u.SERIAL_NO_OR_ROLE_ID
 JOIN ${owner}.SEC_MODULE_DATA m ON m.SERIAL_NO=a.SERIAL_NO
 WHERE m.URL_PATH='support/assigned' AND LOWER(m.APP_CODE)='support' ${await activeClause(c,owner)}
 AND u.SSEARCH='Y' AND u.SSAVE='Y' AND u.SMODIFY='Y' AND a.SSEARCH='Y' AND a.SSAVE='Y' AND a.SMODIFY='Y'
 AND NVL(s.ACTIVE_FLAG,'1') IN('1','Y','A')`);
}
export async function nativeSupportMenu(c:oracledb.Connection,id:SupportIdentity){
 const role=await nativeSupportRole(c,id);if(role==='user')return [];
 const owner=await supportSecuritySchema(c,id.tenantId);
 return read(c,`SELECT m.* FROM ${owner}.SEC_MODULE_DATA m WHERE LOWER(m.APP_CODE)='support' ${await activeClause(c,owner)} AND EXISTS(
 SELECT 1 FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER u JOIN ${owner}.SEC_ROLE_APP_ACCESS a ON a.ROLE_ID=u.SERIAL_NO_OR_ROLE_ID
 WHERE UPPER(u.LOGINID)=:loginid AND u.COMPANY_CODE=:companyCode AND a.SERIAL_NO=m.SERIAL_NO
 AND u.SSEARCH='Y' AND u.SSAVE='Y' AND u.SMODIFY='Y' AND a.SSEARCH='Y' AND a.SSAVE='Y' AND a.SMODIFY='Y'
 UNION ALL SELECT 1 FROM ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER u WHERE UPPER(u.LOGINID)=:loginid AND u.COMPANY_CODE=:companyCode AND u.SERIAL_NO_OR_ROLE_ID=m.SERIAL_NO AND u.SSEARCH='Y' AND u.SSAVE='Y' AND u.SMODIFY='Y' AND u.SERIAL_NO_OR_ROLE_ID<90001)
 ORDER BY m.POSITION,m.SERIAL_NO`,{loginid:id.loginid,companyCode:id.companyCode});
}
