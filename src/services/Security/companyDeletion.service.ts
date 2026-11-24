import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import oracledb from 'oracledb';
import {deflateRawSync,inflateRawSync} from 'zlib';
import {PlatformAdminService as Platform,PlatformError} from './platformAdmin.service';
import {ensureCompanyDeletionLocks} from './companyDeletionLocks.service';

type Relation={child:string;parent:string;pairs:[string,string][]};
type Node={owner:string;table:string;direct?:string;parents:Relation[];count:number;companyScoped?:boolean};
const options={outFormat:oracledb.OUT_FORMAT_OBJECT};
const ident=(name:string)=>{if(!/^[A-Z][A-Z0-9_$#]*$/.test(name))throw new PlatformError('Unsupported database identifier');return `"${name}"`;};
const qualified=(n:{owner:string;table:string})=>`${ident(n.owner)}.${ident(n.table)}`;
const key=(owner:string,table:string)=>`${owner}.${table}`;
const secret=()=>{if(!process.env.APP_SECRET)throw new PlatformError('Company deletion requires the application signing key',503);return process.env.APP_SECRET;};
const read=async(c:oracledb.Connection,sql:string,binds:any={})=>(await c.execute<any>(sql,binds,options)).rows||[];
const excluded=new Set(['TENANT_REGISTRY','SEC_PLATFORM_ADMIN','SEC_PLATFORM_ADMIN_TENANT','SEC_PLATFORM_AUDIT']);

export function deletionOrder(nodes:Map<string,Node>) {
 const done=new Set<string>(),visiting=new Set<string>(),order:string[]=[];
 const visit=(id:string)=>{
  if(done.has(id))return;
  if(visiting.has(id))throw new PlatformError('Circular table relationships require a reviewed database cleanup. No data was deleted.',409);
  visiting.add(id);
  for(const [child,node]of nodes)if(child!==id&&node.parents.some(r=>r.parent===id))visit(child);
  visiting.delete(id);done.add(id);order.push(id);
 };
 for(const id of [...nodes.keys()].sort((a,b)=>Number(a.endsWith('.MS_COMPANY'))-Number(b.endsWith('.MS_COMPANY'))||a.localeCompare(b)))visit(id);
 return order;
}

export function deletionPredicate(id:string,nodes:Map<string,Node>,alias='d',trail:string[]=[]):string {
 const node=nodes.get(id)!;
 if(node.direct)return node.direct.replace(/\$row/g,alias);
 if(trail.includes(id)||trail.length>24)throw new PlatformError('Unresolved table relationships require manual review',409);
 const clauses=node.parents.filter(r=>r.parent!==id).map((r,index)=>{
  const parent=nodes.get(r.parent)!,p=`p${trail.length}_${index}`;
  return `EXISTS (SELECT 1 FROM ${qualified(parent)} ${p} WHERE ${r.pairs.map(([child,parentColumn])=>`${alias}.${ident(child)}=${p}.${ident(parentColumn)}`).join(' AND ')} AND (${deletionPredicate(r.parent,nodes,p,[...trail,id])}))`;
 });
 if(!clauses.length)throw new PlatformError('Unscoped table cannot be deleted',409);
 return clauses.map(s=>`(${s})`).join(' OR ');
}

export class CompanyDeletionService {
 static async authorize(actor:string,tenant:string) {
  const access=await Platform.assertTenant(actor,tenant),login=actor.trim().toLowerCase();
  if(tenant==='root'||!((login==='prodadmin'&&access.scope==='ALL')||(login==='qaadmin'&&access.scope==='SCOPED'&&tenant==='WMSTST_TENANT')))
   throw new PlatformError('Permanent company deletion is restricted to PRODADMIN and QAADMIN in WMSTST',403);
  return access;
 }

 private static async plan(c:oracledb.Connection,owner:string,tenant:string,company:string,actor:string) {
  if(!/^[A-Za-z0-9_-]{1,20}$/.test(company)||['CUSTOMERS','SYS','SYSTEM'].includes(owner))throw new PlatformError('Select a tenant company');
  const registry=(await read(c,'SELECT COMPANY_CODE,SCHEMA_NAME FROM CUSTOMERS.TENANT_REGISTRY WHERE TENANT_ID=:tenant AND IS_ACTIVE=\'Y\'',{tenant}))[0];
  if(!registry||String(registry.SCHEMA_NAME).trim().toUpperCase()!==owner)throw new PlatformError('Tenant registry changed; refresh before deleting',409);
  if(String(registry.COMPANY_CODE||'').trim()===company)throw new PlatformError('The tenant default/template company is protected. Select another company.',409);
  const companyColumns=await Platform.columns(c,owner,'MS_COMPANY');
  const stateFields=['STATUS','ACTIVE_FLAG','IS_ACTIVE'].filter(name=>companyColumns.some(col=>col.COLUMN_NAME===name));
  const records=await read(c,`SELECT ROWIDTOCHAR(ROWID) COMPANY_ROWID,ORA_ROWSCN COMPANY_SCN,COMPANY_NAME${stateFields.length?','+stateFields.join(','):''} FROM ${ident(owner)}.MS_COMPANY WHERE TRIM(COMPANY_CODE)=:company`,{company});
  const record=records[0];
  if(!record)throw new PlatformError('Company no longer exists',404);
  if(records.length!==1)throw new PlatformError('Duplicate or padded company codes require database administrator review before deletion',409);
  const inactive=stateFields.some(name=>['I','N','INACTIVE','DISABLED','0'].includes(String(record[name]||'').trim().toUpperCase()));
  if(!inactive)throw new PlatformError('Deactivate this company before previewing permanent deletion. If this legacy schema has no activation field, use a reviewed database cleanup.',409);
  const protectedUsers=await read(c,`SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN p WHERE EXISTS(SELECT 1 FROM ${ident(owner)}.SEC_LOGIN u WHERE UPPER(TRIM(u.LOGINID))=UPPER(TRIM(p.LOGINID)) AND TRIM(u.COMPANY_CODE)=:company) OR EXISTS(SELECT 1 FROM CUSTOMERS.SEC_LOGINTEST r JOIN CUSTOMERS.USER_TENANT_MAPPING m ON UPPER(TRIM(m.LOGINID))=UPPER(TRIM(r.LOGINID)) WHERE UPPER(TRIM(r.LOGINID))=UPPER(TRIM(p.LOGINID)) AND TRIM(r.COMPANY_CODE)=:company AND m.TENANT_ID=:tenant)`,{company,tenant});
  if(protectedUsers.length)throw new PlatformError('This company contains a protected platform administrator',409);
  const users=await read(c,`SELECT DISTINCT UPPER(TRIM(u.LOGINID)) LOGINID,
    CASE WHEN EXISTS(SELECT 1 FROM ${ident(owner)}.SEC_LOGIN other WHERE UPPER(TRIM(other.LOGINID))=UPPER(TRIM(u.LOGINID)) AND (TRIM(other.COMPANY_CODE)<>:company OR other.COMPANY_CODE IS NULL)) THEN 'Y' ELSE 'N' END SHARED_LOCAL,
    CASE WHEN EXISTS(SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING m WHERE UPPER(TRIM(m.LOGINID))=UPPER(TRIM(u.LOGINID)) AND m.TENANT_ID<>:tenant) THEN 'Y' ELSE 'N' END SHARED_TENANT,
    CASE WHEN EXISTS(SELECT 1 FROM CUSTOMERS.SEC_LOGINTEST r WHERE UPPER(TRIM(r.LOGINID))=UPPER(TRIM(u.LOGINID)) AND TRIM(r.COMPANY_CODE)=:company) THEN 'Y' ELSE 'N' END ROOT_MATCH
    FROM (SELECT LOGINID FROM ${ident(owner)}.SEC_LOGIN WHERE TRIM(COMPANY_CODE)=:company
      UNION SELECT r.LOGINID FROM CUSTOMERS.SEC_LOGINTEST r WHERE TRIM(r.COMPANY_CODE)=:company AND EXISTS(SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING m WHERE UPPER(TRIM(m.LOGINID))=UPPER(TRIM(r.LOGINID)) AND m.TENANT_ID=:tenant)) u ORDER BY LOGINID`,{company,tenant});
  if(users.length>900)throw new PlatformError('This company requires a reviewed bulk cleanup because it has more than 900 users',409);
  const reassignments:{loginid:string;company:string;tenant:string}[]=[];
  for(const user of users.filter(u=>u.ROOT_MATCH==='Y'&&(u.SHARED_LOCAL==='Y'||u.SHARED_TENANT==='Y'))){
   let replacement:any;
   if(user.SHARED_LOCAL==='Y'){
    const [other]=await read(c,`SELECT TRIM(COMPANY_CODE) COMPANY_CODE FROM ${ident(owner)}.SEC_LOGIN WHERE UPPER(TRIM(LOGINID))=:loginid AND TRIM(COMPANY_CODE)<>:company ORDER BY COMPANY_CODE FETCH FIRST 1 ROWS ONLY`,{loginid:user.LOGINID,company});
    if(other)replacement={company:other.COMPANY_CODE,tenant};
   }else{
    if(actor.trim().toLowerCase()==='qaadmin')throw new PlatformError(`PRODADMIN must reassign shared account ${user.LOGINID} before this company can be deleted in QA`,409);
    const mappings=await read(c,"SELECT t.TENANT_ID,t.SCHEMA_NAME FROM CUSTOMERS.USER_TENANT_MAPPING m JOIN CUSTOMERS.TENANT_REGISTRY t ON t.TENANT_ID=m.TENANT_ID WHERE UPPER(TRIM(m.LOGINID))=:loginid AND m.TENANT_ID<>:tenant AND t.IS_ACTIVE='Y' AND t.CONNECTION_TYPE='SCHEMA' ORDER BY m.IS_DEFAULT DESC,t.TENANT_ID",{loginid:user.LOGINID,tenant});
    for(const mapping of mappings){
     const schema=String(mapping.SCHEMA_NAME).trim().toUpperCase();
     const [other]=await read(c,`SELECT TRIM(COMPANY_CODE) COMPANY_CODE FROM ${ident(schema)}.SEC_LOGIN WHERE UPPER(TRIM(LOGINID))=:loginid AND COMPANY_CODE IS NOT NULL ORDER BY COMPANY_CODE FETCH FIRST 1 ROWS ONLY`,{loginid:user.LOGINID});
     if(other){replacement={company:other.COMPANY_CODE,tenant:mapping.TENANT_ID};break;}
    }
   }
   if(!replacement)throw new PlatformError(`Reassign shared account ${user.LOGINID} to another company before deleting this company`,409);
   reassignments.push({loginid:user.LOGINID,...replacement});
  }
  const binds:Record<string,string>={company,tenant},nodes=new Map<string,Node>();
  const metadata=await read(c,`SELECT col.OWNER,col.TABLE_NAME,col.COLUMN_NAME,col.DATA_TYPE FROM ALL_TAB_COLUMNS col JOIN ALL_TABLES t ON t.OWNER=col.OWNER AND t.TABLE_NAME=col.TABLE_NAME
    WHERE col.OWNER IN (:owner,'CUSTOMERS') AND t.TEMPORARY='N' AND t.NESTED='NO' ORDER BY col.OWNER,col.TABLE_NAME,col.COLUMN_ID`,{owner});
  const tables=new Map<string,{owner:string;table:string;columns:Set<string>;types:Record<string,string>}>();
  for(const row of metadata){const id=key(row.OWNER,row.TABLE_NAME);if(!tables.has(id))tables.set(id,{owner:row.OWNER,table:row.TABLE_NAME,columns:new Set(),types:{}});tables.get(id)!.columns.add(row.COLUMN_NAME);tables.get(id)!.types[row.COLUMN_NAME]=row.DATA_TYPE;}
  for(const [id,t]of tables){
   if(t.owner==='CUSTOMERS'&&excluded.has(t.table))continue;
   const column=['COMPANY_CODE','COMPANYCODE','COMP_CODE'].find(col=>t.columns.has(col));
   if(!column||t.owner==='CUSTOMERS'&&!t.columns.has('TENANT_ID'))continue;
   const companyExpression=['CHAR','NCHAR'].includes(t.types[column])?`TRIM($row.${ident(column)})`:`$row.${ident(column)}`;
   const direct=`${companyExpression}=:company`+(t.owner==='CUSTOMERS'?' AND $row.TENANT_ID=:tenant':'');
   nodes.set(id,{owner:t.owner,table:t.table,direct,parents:[],count:0,companyScoped:true});
  }
  const signup=tables.get(key('CUSTOMERS','SEC_PUBLIC_SIGNUP'));
  if(signup?.columns.has('PAYLOAD'))nodes.set(key('CUSTOMERS','SEC_PUBLIC_SIGNUP'),{owner:'CUSTOMERS',table:'SEC_PUBLIC_SIGNUP',direct:"($row.TENANT_ID=:tenant AND TRIM($row.COMPANY_CODE)=:company) OR (JSON_VALUE($row.PAYLOAD,'$.tenant' NULL ON ERROR)=:tenant AND JSON_VALUE($row.PAYLOAD,'$.company' NULL ON ERROR)=:company)",parents:[],count:0});
  // Legacy security assignment tables use USER_ID / DIV_CODE instead of COMPANY_CODE.
  // Preserve mappings for a retained user or for a code shared with another company.
  for(const [table,parent,childColumn,parentColumn]of [
   ['MS_COMPANY_USER_ASSIGN','MS_HR_DIVISION','DIV_CODE','DIV_CODE'],
   ['MS_PROJECT_USER_ASSIGN','MS_PS_PROJECT_MASTER','PROJECT_CODE','PROJECT_CODE'],
  ]){
   const id=key(owner,table),mapping=tables.get(id),userTable=tables.get(key(owner,'SEC_LOGIN')),parentTable=tables.get(key(owner,parent));
   if(!mapping||nodes.has(id))continue;
   const clauses:string[]=[],dependencies:Relation[]=[];
   if(mapping.columns.has('USER_ID')&&userTable?.columns.has('USER_ID')){
    clauses.push(`EXISTS(SELECT 1 FROM ${ident(owner)}.SEC_LOGIN u WHERE TRIM(u.COMPANY_CODE)=:company AND TRIM(u.USER_ID)=TRIM($row.USER_ID) AND NOT EXISTS(SELECT 1 FROM ${ident(owner)}.SEC_LOGIN other WHERE TRIM(other.USER_ID)=TRIM(u.USER_ID) AND (TRIM(other.COMPANY_CODE)<>:company OR other.COMPANY_CODE IS NULL)))`);
    dependencies.push({child:id,parent:key(owner,'SEC_LOGIN'),pairs:[]});
   }
   if(mapping.columns.has(childColumn)&&parentTable?.columns.has(parentColumn)&&parentTable.columns.has('COMPANY_CODE')){
    clauses.push(`EXISTS(SELECT 1 FROM ${ident(owner)}.${ident(parent)} p WHERE TRIM(p.COMPANY_CODE)=:company AND $row.${ident(childColumn)}=p.${ident(parentColumn)} AND NOT EXISTS(SELECT 1 FROM ${ident(owner)}.${ident(parent)} other WHERE other.${ident(parentColumn)}=p.${ident(parentColumn)} AND (TRIM(other.COMPANY_CODE)<>:company OR other.COMPANY_CODE IS NULL)))`);
    dependencies.push({child:id,parent:key(owner,parent),pairs:[]});
   }
   if(clauses.length)nodes.set(id,{owner,table,direct:clauses.map(value=>`(${value})`).join(' OR '),parents:dependencies.filter(r=>nodes.has(r.parent)),count:0});
  }
  const addUsers=(table:string,selected:any[],extra:string)=>{
   if(!selected.length||!tables.has(key('CUSTOMERS',table)))return;
   const names=selected.map((u,i)=>{const name=`${table==='SEC_LOGINTEST'?'rootUser':'mappingUser'}${i}`;binds[name]=u.LOGINID;return ':'+name;});
   nodes.set(key('CUSTOMERS',table),{owner:'CUSTOMERS',table,direct:`UPPER(TRIM($row.LOGINID)) IN (${names.join(',')}) AND ${extra}`,parents:[],count:0});
  };
  addUsers('SEC_LOGINTEST',users.filter(u=>u.SHARED_LOCAL==='N'&&u.SHARED_TENANT==='N'&&u.ROOT_MATCH==='Y'),"TRIM($row.COMPANY_CODE)=:company AND NOT EXISTS(SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN pa WHERE UPPER(TRIM(pa.LOGINID))=UPPER(TRIM($row.LOGINID)))");
  addUsers('USER_TENANT_MAPPING',users.filter(u=>u.SHARED_LOCAL==='N'),'$row.TENANT_ID=:tenant');
  // Older installations do not declare these ownership relationships as FKs.
  const known:Relation[]=[
   ...['SUPPORT_ATTACHMENT','SUPPORT_MESSAGE','SUPPORT_EVENT','SUPPORT_EMAIL_OUTBOX','SUPPORT_READ_RECEIPT'].map(table=>({child:key('CUSTOMERS',table),parent:key('CUSTOMERS','SUPPORT_TICKET'),pairs:[['TICKET_ID','TICKET_ID']] as [string,string][]})),
   {child:key('CUSTOMERS','SEC_BILLING_REMINDER'),parent:key('CUSTOMERS','SEC_BILLING_INVOICE'),pairs:[['INVOICE_ID','INVOICE_ID']]},
  ];
  const fkRows=await read(c,`SELECT fk.OWNER CHILD_OWNER,fk.TABLE_NAME CHILD_TABLE,fk.CONSTRAINT_NAME,pk.OWNER PARENT_OWNER,pk.TABLE_NAME PARENT_TABLE,fc.COLUMN_NAME CHILD_COLUMN,pc.COLUMN_NAME PARENT_COLUMN,fc.POSITION
   FROM ALL_CONSTRAINTS fk JOIN ALL_CONSTRAINTS pk ON pk.OWNER=fk.R_OWNER AND pk.CONSTRAINT_NAME=fk.R_CONSTRAINT_NAME
   JOIN ALL_CONS_COLUMNS fc ON fc.OWNER=fk.OWNER AND fc.CONSTRAINT_NAME=fk.CONSTRAINT_NAME
   JOIN ALL_CONS_COLUMNS pc ON pc.OWNER=pk.OWNER AND pc.CONSTRAINT_NAME=pk.CONSTRAINT_NAME AND pc.POSITION=fc.POSITION
   WHERE fk.CONSTRAINT_TYPE='R' AND pk.OWNER IN (:owner,'CUSTOMERS') ORDER BY fk.OWNER,fk.CONSTRAINT_NAME,fc.POSITION`,{owner});
  const fks=new Map<string,Relation>();
  for(const row of fkRows){const id=key(row.CHILD_OWNER,row.CONSTRAINT_NAME);if(!fks.has(id))fks.set(id,{child:key(row.CHILD_OWNER,row.CHILD_TABLE),parent:key(row.PARENT_OWNER,row.PARENT_TABLE),pairs:[]});fks.get(id)!.pairs.push([row.CHILD_COLUMN,row.PARENT_COLUMN]);}
  const relations=[...known.filter(r=>tables.has(r.child)&&tables.has(r.parent)),...fks.values()];
  // Ticket receipts are owned by the ticket even when another company's developer read it.
  if(nodes.has(key('CUSTOMERS','SUPPORT_TICKET'))&&tables.has(key('CUSTOMERS','SUPPORT_READ_RECEIPT')))
   nodes.set(key('CUSTOMERS','SUPPORT_READ_RECEIPT'),{owner:'CUSTOMERS',table:'SUPPORT_READ_RECEIPT',parents:[],count:0});
  for(let pass=0;pass<=tables.size;pass++){
   let added=false;
   for(const relation of relations){
    if(!nodes.has(relation.parent))continue;
    if(!tables.has(relation.child)||relation.child.startsWith('CUSTOMERS.')&&excluded.has(relation.child.split('.')[1]))continue;
    if(!nodes.has(relation.child)){const table=tables.get(relation.child)!;nodes.set(relation.child,{owner:table.owner,table:table.table,parents:[],count:0});added=true;}
    const child=nodes.get(relation.child)!;
    if(!child.parents.some(r=>r.parent===relation.parent&&JSON.stringify(r.pairs)===JSON.stringify(relation.pairs)))child.parents.push(relation);
   }
   if(!added)break;
  }
  const order=deletionOrder(nodes);
  const usedBinds=(sql:string)=>Object.fromEntries(Object.entries(binds).filter(([name])=>new RegExp(':'+name+'(?![A-Za-z0-9_])').test(sql)));
  // Count in batches so large Oracle tenant schemas do not require one network round trip per table.
  for(let offset=0;offset<order.length;offset+=30){
   const ids=order.slice(offset,offset+30),sql=ids.map((id,index)=>`SELECT ${index} IDX,COUNT(*) CNT FROM ${qualified(nodes.get(id)!)} d WHERE ${deletionPredicate(id,nodes)}`).join(' UNION ALL ');
   for(const row of await read(c,sql,usedBinds(sql)))nodes.get(ids[Number(row.IDX)])!.count=Number(row.CNT);
  }
  // Never follow a relationship into another company's directly scoped row.
  for(const relation of relations){
   if(!nodes.has(relation.parent))continue;
   const child=nodes.get(relation.child),parent=nodes.get(relation.parent)!;
   if(child&&!child.direct||relation.child===relation.parent&&!child?.direct)continue;
   const parts=relation.child.split('.'),childTable={owner:parts[0],table:parts[1]};
   const joins=relation.pairs.map(([a,b])=>`x.${ident(a)}=p.${ident(b)}`).join(' AND ');
   const predicate=child?`AND CASE WHEN (${deletionPredicate(relation.child,nodes,'x')}) THEN 0 ELSE 1 END=1`:'';
   const sql=`SELECT 1 FROM ${qualified(childTable)} x WHERE EXISTS(SELECT 1 FROM ${qualified(parent)} p WHERE ${joins} AND (${deletionPredicate(relation.parent,nodes,'p')})) ${predicate} AND ROWNUM=1`;
   if((await read(c,sql,usedBinds(sql))).length)throw new PlatformError(`Related rows outside this company were found in ${relation.child}. A reviewed cleanup is required; nothing was deleted.`,409);
  }
  const rows=order.map(id=>({table:id,count:nodes.get(id)!.count}));
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({rowid:record.COMPANY_ROWID,scn:record.COMPANY_SCN,rows,users,reassignments,relations:relations.filter(r=>nodes.has(r.parent))})).digest('hex');
  return {nodes,order,binds,usedBinds,rows,fingerprint,users,reassignments,companyName:record.COMPANY_NAME,total:rows.reduce((sum,row)=>sum+row.count,0)};
 }

 static async preview(actor:string,tenant:string,company:string) {
  company=String(company||'').trim();
  await this.authorize(actor,tenant);secret();
  return Platform.scope(tenant,async(c,owner)=>{
   const plan=await this.plan(c,owner,tenant,company,actor),operationId=crypto.randomUUID();
   const lockList=Buffer.from(JSON.stringify(plan.order));
   if(lockList.length>256000)throw new PlatformError('This schema requires a reviewed bulk cleanup',409);
   const locks=deflateRawSync(lockList).toString('base64url');
   const token=jwt.sign({purpose:'COMPANY_DELETE',actor,tenant,company,fingerprint:plan.fingerprint,operationId,locks},secret(),{algorithm:'HS256',expiresIn:'10m'});
   return {company,companyName:plan.companyName,totalRows:plan.total,tables:plan.rows.filter(row=>row.count>0),users:plan.users.length,sharedUsersPreserved:plan.users.filter(u=>u.SHARED_LOCAL==='Y'||u.SHARED_TENANT==='Y'||u.ROOT_MATCH!=='Y').length,reassignments:plan.reassignments,token,expiresInMinutes:10};
  });
 }

 static async remove(actor:string,tenant:string,company:string,input:any) {
  company=String(company||'').trim();input=input||{};
  await this.authorize(actor,tenant);
  if(input.confirmCompany!==company||input.confirmPermanent!==true)throw new PlatformError('Type the exact company code and confirm permanent deletion');
  let approval:any;
  try{approval=jwt.verify(String(input.token||''),secret(),{algorithms:['HS256']});}catch{throw new PlatformError('Deletion preview expired. Load a new preview.',409);}
  if(approval.purpose!=='COMPANY_DELETE'||approval.actor!==actor||approval.tenant!==tenant||approval.company!==company)throw new PlatformError('Deletion preview does not match this company or administrator',403);
  return Platform.scope(tenant,async(c,owner)=>{
   try{
    let lockIds:string[];
    try{lockIds=JSON.parse(inflateRawSync(Buffer.from(approval.locks,'base64url'),{maxOutputLength:256000}).toString('utf8'));}
    catch{throw new PlatformError('Deletion preview is invalid. Refresh it before deleting.',409);}
    if(!Array.isArray(lockIds)||!lockIds.length||lockIds.length>10000||lockIds.some(id=>typeof id!=='string'||id.split('.').length!==2||![owner,'CUSTOMERS'].includes(id.split('.')[0])))throw new PlatformError('Deletion preview scope is invalid',409);
    const lockNodes=lockIds.map(id=>{const [nodeOwner,table]=id.split('.');ident(table);return {owner:nodeOwner,table};});
    // Lock both empty and populated scoped tables; busy systems fail immediately instead of waiting.
    const helpers=await ensureCompanyDeletionLocks(c,tenant,owner);
    const tenantTables=lockNodes.filter(node=>node.owner===owner).map(node=>node.table).sort();
    const central=lockNodes.filter(node=>node.owner==='CUSTOMERS').map(qualified).sort();
    // Lock the central login/mapping tables first, matching normal user provisioning.
    for(let i=0;i<central.length;i+=25)await c.execute(`LOCK TABLE ${central.slice(i,i+25).join(',')} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    await c.execute(`BEGIN ${helpers.lockProcedure}(:tables); END;`,{tables:{val:JSON.stringify(tenantTables),type:oracledb.CLOB}});
    const repeated=await read(c,"SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_AUDIT WHERE RESOURCE_NAME='COMPANY_PURGE' AND JSON_VALUE(DETAILS,'$.operationId' NULL ON ERROR)=:operationId",{operationId:approval.operationId});
    if(repeated.length)throw new PlatformError('This deletion preview has already been used',409);
    const plan=await this.plan(c,owner,tenant,company,actor);
    if(approval.fingerprint!==plan.fingerprint)throw new PlatformError('Company data changed since the preview. Refresh the preview before deleting.',409);
    let deleted=0;
    for(const id of plan.order){const node=plan.nodes.get(id)!;if(!node.count)continue;
     const sql=`DELETE FROM ${qualified(node)} d WHERE ${deletionPredicate(id,plan.nodes)}`;
     let changed=0;
     if(node.owner===owner){
      const deleteRows=async(rowids:string[]|null)=>{
       const result=await c.execute<any>(`BEGIN ${helpers.deleteProcedure}(:tableName,:company,:rowids,:deleted); END;`,{tableName:node.table,company,rowids:{val:rowids?JSON.stringify(rowids):null,type:oracledb.CLOB},deleted:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER}});
       changed+=Number(result.outBinds?.deleted||0);
      };
      if(node.companyScoped)await deleteRows(null);
      else{
       const select=`SELECT ROWIDTOCHAR(d.ROWID) RID FROM ${qualified(node)} d WHERE ${deletionPredicate(id,plan.nodes)}`;
       const selected=await c.execute<any>(select,plan.usedBinds(select),{...options,resultSet:true,fetchArraySize:1000});
       try{let rows:any[];while((rows=await selected.resultSet!.getRows(1000)).length)await deleteRows(rows.map(row=>row.RID));}
       finally{await selected.resultSet?.close();}
      }
     }else changed=(await c.execute(sql,plan.usedBinds(sql))).rowsAffected||0;
     if(changed!==node.count)throw new PlatformError('Company data changed during deletion. All changes were rolled back.',409);
     deleted+=changed;
    }
    for(const user of plan.users.filter(u=>u.SHARED_LOCAL==='N'&&u.SHARED_TENANT==='Y'))await c.execute(`UPDATE CUSTOMERS.USER_TENANT_MAPPING SET IS_DEFAULT='Y' WHERE USER_MAP_ID=(SELECT MIN(m.USER_MAP_ID) FROM CUSTOMERS.USER_TENANT_MAPPING m WHERE UPPER(TRIM(m.LOGINID))=:loginid AND NOT EXISTS(SELECT 1 FROM CUSTOMERS.USER_TENANT_MAPPING d WHERE UPPER(TRIM(d.LOGINID))=:loginid AND d.IS_DEFAULT='Y'))`,{loginid:user.LOGINID});
    for(const replacement of plan.reassignments){
     await c.execute('UPDATE CUSTOMERS.SEC_LOGINTEST SET COMPANY_CODE=:replacementCompany WHERE UPPER(TRIM(LOGINID))=:loginid AND TRIM(COMPANY_CODE)=:company',{replacementCompany:replacement.company,loginid:replacement.loginid,company});
     // If the removed tenant was the default, align the surviving default with the new primary company.
     if(replacement.tenant!==tenant){
      await c.execute("UPDATE CUSTOMERS.USER_TENANT_MAPPING SET IS_DEFAULT=CASE WHEN TENANT_ID=:replacementTenant THEN 'Y' ELSE 'N' END WHERE UPPER(TRIM(LOGINID))=:loginid",{replacementTenant:replacement.tenant,loginid:replacement.loginid});
     }
    }
    await Platform.audit(actor,tenant,company,'DELETE','COMPANY_PURGE',{operationId:approval.operationId,fingerprint:plan.fingerprint,deletedRows:deleted,tables:plan.rows.filter(row=>row.count).length,users:plan.users.length},c);
    await c.commit();return {company,deletedRows:deleted};
   }catch(error:any){await c.rollback();if(error?.errorNum===54)throw new PlatformError('Company tables are busy. Nothing was deleted. Try again shortly.',409);throw error;}
  });
 }
}
