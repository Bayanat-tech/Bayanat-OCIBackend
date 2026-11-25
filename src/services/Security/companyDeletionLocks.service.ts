import oracledb from 'oracledb';
import {PlatformError} from './platformAdmin.service';

const procedure='SEC_LOCK_COMPANY_PURGE';
const deleteProcedure='SEC_DELETE_COMPANY_ROWS';
const marker='COMPANY_PURGE_LOCK_V1';
const quote=(value:string)=>{if(!/^[A-Z][A-Z0-9_$#]*$/.test(value))throw new PlatformError('Invalid deletion lock identifier');return `"${value}"`;};
// Definer rights allow only locks on this schema's own base tables. No DML or commits.
const source=`CREATE PROCEDURE ${procedure}(P_TABLES IN CLOB) AUTHID DEFINER AS
 -- ${marker}
 V_COUNT NUMBER; V_OWNER VARCHAR2(128);
 BEGIN
  V_OWNER:=SYS_CONTEXT('USERENV','CURRENT_USER');
  FOR R IN (SELECT TABLE_NAME FROM JSON_TABLE(P_TABLES,'$[*]' COLUMNS(TABLE_NAME VARCHAR2(128) PATH '$' ERROR ON ERROR))) LOOP
   IF NOT REGEXP_LIKE(R.TABLE_NAME,'^[A-Z][A-Z0-9_$#]*$') THEN RAISE_APPLICATION_ERROR(-20001,'Invalid table identifier'); END IF;
   SELECT COUNT(*) INTO V_COUNT FROM USER_TABLES WHERE TABLE_NAME=R.TABLE_NAME AND TEMPORARY='N';
   IF V_COUNT<>1 THEN RAISE_APPLICATION_ERROR(-20002,'Only owned base tables can be locked'); END IF;
   EXECUTE IMMEDIATE 'LOCK TABLE "'||V_OWNER||'"."'||R.TABLE_NAME||'" IN SHARE ROW EXCLUSIVE MODE NOWAIT';
  END LOOP;
 END;`;
const deleteSource=`CREATE PROCEDURE ${deleteProcedure}(P_TABLE_NAME IN VARCHAR2,P_COMPANY IN VARCHAR2,P_ROWIDS IN CLOB,P_DELETED OUT NUMBER) AUTHID DEFINER AS
 -- ${marker}
 V_COUNT NUMBER; V_OWNER VARCHAR2(128); V_COLUMN VARCHAR2(128); V_TYPE VARCHAR2(30); V_COMPANY_EXPR VARCHAR2(300); V_SQL VARCHAR2(32767);
 BEGIN
  IF P_COMPANY IS NULL OR NOT REGEXP_LIKE(P_TABLE_NAME,'^[A-Z][A-Z0-9_$#]*$') THEN RAISE_APPLICATION_ERROR(-20001,'Invalid company deletion scope'); END IF;
  V_OWNER:=SYS_CONTEXT('USERENV','CURRENT_USER');
  SELECT COUNT(*) INTO V_COUNT FROM USER_TABLES WHERE TABLE_NAME=P_TABLE_NAME AND TEMPORARY='N';
  IF V_COUNT<>1 THEN RAISE_APPLICATION_ERROR(-20002,'Only owned base tables can be deleted'); END IF;
  SELECT MIN(COLUMN_NAME) KEEP(DENSE_RANK FIRST ORDER BY CASE COLUMN_NAME WHEN 'COMPANY_CODE' THEN 0 WHEN 'COMPANYCODE' THEN 1 ELSE 2 END)
   INTO V_COLUMN FROM USER_TAB_COLUMNS WHERE TABLE_NAME=P_TABLE_NAME AND COLUMN_NAME IN ('COMPANY_CODE','COMPANYCODE','COMP_CODE');
  IF V_COLUMN IS NOT NULL THEN
   SELECT DATA_TYPE INTO V_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME=P_TABLE_NAME AND COLUMN_NAME=V_COLUMN;
   V_COMPANY_EXPR:='"'||V_COLUMN||'"';
   IF V_TYPE IN ('CHAR','NCHAR') THEN V_COMPANY_EXPR:='TRIM('||V_COMPANY_EXPR||')'; END IF;
  END IF;
  V_SQL:='DELETE FROM "'||V_OWNER||'"."'||P_TABLE_NAME||'" WHERE ';
  IF P_ROWIDS IS NOT NULL THEN
   V_SQL:=V_SQL||'ROWID IN (SELECT CHARTOROWID(RID) FROM JSON_TABLE(:payload,''$[*]'' COLUMNS(RID VARCHAR2(18) PATH ''$'' ERROR ON ERROR)))';
   IF V_COLUMN IS NOT NULL THEN
    V_SQL:=V_SQL||' AND '||V_COMPANY_EXPR||'=:company';
    EXECUTE IMMEDIATE V_SQL USING P_ROWIDS,P_COMPANY;
   ELSE EXECUTE IMMEDIATE V_SQL USING P_ROWIDS; END IF;
  ELSIF V_COLUMN IS NOT NULL THEN
   V_SQL:=V_SQL||V_COMPANY_EXPR||'=:company';
   EXECUTE IMMEDIATE V_SQL USING P_COMPANY;
  ELSE RAISE_APPLICATION_ERROR(-20003,'Related rows require explicit row identifiers'); END IF;
  P_DELETED:=SQL%ROWCOUNT;
 END;`;

export async function ensureCompanyDeletionLocks(c:oracledb.Connection,tenant:string,owner:string) {
 const options={outFormat:oracledb.OUT_FORMAT_OBJECT};
 const existing=await c.execute<any>("SELECT STATUS FROM ALL_OBJECTS WHERE OWNER=:owner AND OBJECT_NAME=:name AND OBJECT_TYPE='PROCEDURE'",{owner,name:procedure},options);
 const [root]=((await c.execute<any>("SELECT SYS_CONTEXT('USERENV','CURRENT_USER') ROOT_USER,SYS_CONTEXT('USERENV','DB_UNIQUE_NAME') DB_NAME,SYS_CONTEXT('USERENV','CON_NAME') CONTAINER FROM DUAL",{},options)).rows||[]);
 if(!root)throw new PlatformError('Unable to verify deletion database connection',503);
 const qualified=`${quote(owner)}.${quote(procedure)}`;
 if(existing.rows?.length){
  const version=await c.execute("SELECT 1 FROM ALL_SOURCE WHERE OWNER=:owner AND NAME=:name AND TYPE='PROCEDURE' AND INSTR(TEXT,:marker)>0",{owner,name:procedure,marker});
  if(existing.rows[0].STATUS!=='VALID'||!version.rows?.length)throw new PlatformError('The tenant deletion lock helper requires administrator review',503);
  const grant=await c.execute("SELECT 1 FROM ALL_TAB_PRIVS WHERE TABLE_SCHEMA=:owner AND TABLE_NAME=:name AND GRANTEE=:grantee AND PRIVILEGE='EXECUTE'",{owner,name:procedure,grantee:root.ROOT_USER});
  const extra=await c.execute("SELECT 1 FROM ALL_OBJECTS o WHERE o.OWNER=:owner AND o.OBJECT_NAME=:name AND o.OBJECT_TYPE='PROCEDURE' AND o.STATUS='VALID' AND EXISTS(SELECT 1 FROM ALL_SOURCE s WHERE s.OWNER=o.OWNER AND s.NAME=o.OBJECT_NAME AND s.TYPE='PROCEDURE' AND INSTR(s.TEXT,:marker)>0) AND EXISTS(SELECT 1 FROM ALL_TAB_PRIVS p WHERE p.TABLE_SCHEMA=o.OWNER AND p.TABLE_NAME=o.OBJECT_NAME AND p.GRANTEE=:grantee AND p.PRIVILEGE='EXECUTE')",{owner,name:deleteProcedure,marker,grantee:root.ROOT_USER});
  if(grant.rows?.length&&extra.rows?.length)return {lockProcedure:qualified,deleteProcedure:`${quote(owner)}.${quote(deleteProcedure)}`};
 }
 const [config]=((await c.execute<any>("SELECT DB_USER,DB_PASSWORD,DB_HOST,DB_PORT,DB_SERVICE,SCHEMA_NAME,CONNECTION_TYPE FROM CUSTOMERS.TENANT_REGISTRY WHERE TENANT_ID=:tenant AND IS_ACTIVE='Y'",{tenant},options)).rows||[]);
 if(!config||config.CONNECTION_TYPE?.trim().toUpperCase()!=='SCHEMA'||String(config.DB_USER).trim().toUpperCase()!==owner||String(config.SCHEMA_NAME).trim().toUpperCase()!==owner)
  throw new PlatformError('Deletion requires the registered tenant owner connection to install its locking helper',503);
 let connection:oracledb.Connection|undefined;
 try{
  connection=await oracledb.getConnection({user:config.DB_USER,password:config.DB_PASSWORD,connectString:`${config.DB_HOST}:${config.DB_PORT}/${config.DB_SERVICE}`});
  const [actual]=((await connection.execute<any>("SELECT SYS_CONTEXT('USERENV','CURRENT_USER') OWNER,SYS_CONTEXT('USERENV','DB_UNIQUE_NAME') DB_NAME,SYS_CONTEXT('USERENV','CON_NAME') CONTAINER FROM DUAL",{},options)).rows||[]);
  if(actual?.OWNER!==owner||actual.DB_NAME!==root.DB_NAME||actual.CONTAINER!==root.CONTAINER)throw new PlatformError('Tenant owner connection does not match the central database',503);
  const found=await connection.execute("SELECT 1 FROM USER_OBJECTS WHERE OBJECT_NAME=:name",{name:procedure});
  if(found.rows?.length&&!existing.rows?.length)throw new PlatformError('Deletion helper changed during installation. Refresh the preview.',409);
  if(!found.rows?.length)await connection.execute(source);
  const errors=await connection.execute('SELECT 1 FROM USER_ERRORS WHERE NAME=:name',{name:procedure});
  if(errors.rows?.length)throw new PlatformError('Tenant deletion lock helper could not compile. Contact the database administrator.',503);
  await connection.execute(`GRANT EXECUTE ON ${qualified} TO ${quote(root.ROOT_USER)}`);
  const [deleteObject]=((await connection.execute<any>("SELECT STATUS FROM USER_OBJECTS WHERE OBJECT_NAME=:name AND OBJECT_TYPE='PROCEDURE'",{name:deleteProcedure},options)).rows||[]);
  if(deleteObject){
   const checked=await connection.execute("SELECT 1 FROM USER_SOURCE WHERE NAME=:name AND TYPE='PROCEDURE' AND INSTR(TEXT,:marker)>0",{name:deleteProcedure,marker});
   if(deleteObject.STATUS!=='VALID'||!checked.rows?.length)throw new PlatformError('The tenant deletion helper requires database administrator review',503);
  }else{
   await connection.execute(deleteSource);
   if((await connection.execute('SELECT 1 FROM USER_ERRORS WHERE NAME=:name',{name:deleteProcedure})).rows?.length)throw new PlatformError('Tenant row deletion helper could not compile',503);
  }
  const qualifiedDelete=`${quote(owner)}.${quote(deleteProcedure)}`;
  await connection.execute(`GRANT EXECUTE ON ${qualifiedDelete} TO ${quote(root.ROOT_USER)}`);
  return {lockProcedure:qualified,deleteProcedure:qualifiedDelete};
 }catch(error:any){if(error instanceof PlatformError)throw error;throw new PlatformError('Unable to install the tenant deletion lock helper. Ask the database administrator to check tenant owner credentials and CREATE PROCEDURE permission.',503);}
 finally{await connection?.close();}
}
