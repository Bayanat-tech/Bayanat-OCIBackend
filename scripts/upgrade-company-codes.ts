import 'dotenv/config';
import oracledb from 'oracledb';
import fs from 'fs';
import path from 'path';
// Explicit administrative migration. Public requests never alter tenant schemas.
const args=process.argv.slice(2),tenant=args.find(arg=>!arg.startsWith('--'));
const apply=args.includes('--apply'),reportArg=args.find(arg=>arg.startsWith('--report='));
if(!tenant)throw new Error('Usage: npx ts-node scripts/upgrade-company-codes.ts TENANT_ID [--apply] [--report=path.json]');
try{oracledb.initOracleClient({libDir:process.env.ORACLE_INSTANT_CLIENT_PATH});}catch(e:any){if(e.code!=='NJS-077')throw e;}
(async()=>{
 const c=await oracledb.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECTION_STRING});
 const options={outFormat:oracledb.OUT_FORMAT_OBJECT};
 try{
  const registry=await c.execute<any>("SELECT SCHEMA_NAME,CONNECTION_TYPE,IS_ACTIVE FROM CUSTOMERS.TENANT_REGISTRY WHERE TENANT_ID=:tenant",{tenant},options);
  const config=registry.rows?.[0],owner=String(config?.SCHEMA_NAME||'').toUpperCase();
  if(!config||config.IS_ACTIVE!=='Y'||config.CONNECTION_TYPE?.trim().toUpperCase()!=='SCHEMA'||!/^\w+$/.test(owner)||['CUSTOMERS','SYS','SYSTEM','WMSDEV'].includes(owner))throw new Error('Select an active company schema tenant');
  await c.execute('ALTER SESSION SET DDL_LOCK_TIMEOUT=5');
  const found=await c.execute<any>(`SELECT col.TABLE_NAME,col.COLUMN_NAME,col.DATA_TYPE,col.DATA_LENGTH,col.CHAR_LENGTH,col.CHAR_USED FROM ALL_TAB_COLUMNS col JOIN ALL_TABLES tab ON tab.OWNER=col.OWNER AND tab.TABLE_NAME=col.TABLE_NAME
   WHERE col.OWNER=:owner AND col.COLUMN_NAME IN ('COMPANY_CODE','COMPANYCODE','COMP_CODE') AND col.DATA_TYPE IN ('VARCHAR2','NVARCHAR2','CHAR') AND col.CHAR_LENGTH<8
   ORDER BY CASE WHEN col.TABLE_NAME='MS_COMPANY' THEN 1 ELSE 0 END,col.TABLE_NAME,col.COLUMN_NAME`,{owner},options);
  const results:any[]=[];
  for(const row of found.rows||[]){
   if(!/^[A-Z0-9_$#]+$/.test(row.TABLE_NAME)||!/^[A-Z0-9_]+$/.test(row.COLUMN_NAME))throw new Error('Unsupported identifier in tenant metadata');
   const type=row.DATA_TYPE==='NVARCHAR2'?'NVARCHAR2(8)':`VARCHAR2(8 ${row.CHAR_USED==='C'?'CHAR':'BYTE'})`;
   const sql=`ALTER TABLE "${owner}"."${row.TABLE_NAME}" MODIFY ("${row.COLUMN_NAME}" ${type})`;
   const item:any={table:row.TABLE_NAME,column:row.COLUMN_NAME,oldType:row.DATA_TYPE,oldLength:row.CHAR_LENGTH,sql,status:apply?'PENDING':'PREVIEW'};
   if(row.DATA_TYPE==='CHAR'){
    const populated=await c.execute(`SELECT 1 FROM "${owner}"."${row.TABLE_NAME}" WHERE "${row.COLUMN_NAME}" IS NOT NULL AND ROWNUM=1`);
    if(populated.rows?.length){item.status='BLOCKED';item.message='Nonempty fixed-width CHAR column requires a separately reviewed conversion';results.push(item);continue;}
   }
   if(apply)try{await c.execute(sql);item.status='UPGRADED';}catch(e:any){item.status='FAILED';item.message=e.message;}
   results.push(item);
   if(apply&&results.length%100===0)console.log(`${owner}: ${results.length}/${found.rows?.length} columns processed`);
  }
  const blocked=results.filter(item=>['BLOCKED','FAILED'].includes(item.status));
  const report={tenant,owner,apply,total:results.length,upgraded:results.filter(item=>item.status==='UPGRADED').length,blocked:blocked.length,results};
  if(reportArg){const target=path.resolve(reportArg.slice('--report='.length));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2));}
  console.log(JSON.stringify({tenant,owner,apply,total:report.total,upgraded:report.upgraded,blocked:report.blocked}));
  if(blocked.length){console.error(JSON.stringify(blocked.map(item=>({table:item.table,column:item.column,message:item.message}))));process.exitCode=1;}
 }finally{await c.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
