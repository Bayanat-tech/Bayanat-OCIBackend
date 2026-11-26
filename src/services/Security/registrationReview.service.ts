import oracledb from 'oracledb';
import {PlatformAdminService as Platform,PlatformError} from './platformAdmin.service';
import {sendRegistrationMail} from '../../scheduler/billingEmail';
import {registrationAppUrl} from './registrationRuntime.service';

const options={outFormat:oracledb.OUT_FORMAT_OBJECT,fetchInfo:{PAYLOAD:{type:oracledb.STRING},CONFIG_JSON:{type:oracledb.STRING}}};
const read=async(c:oracledb.Connection,sql:string,b:any={})=>(await c.execute<any>(sql,b,options)).rows||[];
export const validReviewEmail=(value:string)=>value.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);

export class RegistrationReviewService {
 private static readyUntil=0;
 static async access(actor:string) {
  const access=await Platform.getAccess(actor),login=actor.trim().toLowerCase();
  if(!access||!((login==='prodadmin'&&access.scope==='ALL')||(login==='qaadmin'&&access.scope==='SCOPED')))
   throw new PlatformError('Registration review is restricted to PRODADMIN and QAADMIN',403);
  return access;
 }
 static async ready(c?:oracledb.Connection) {
  if(Date.now()<this.readyUntil)return;
  const check=async(conn:oracledb.Connection)=>{
   if(!(await read(conn,"SELECT 1 FROM ALL_TABLES WHERE OWNER='CUSTOMERS' AND TABLE_NAME='SEC_REGISTRATION_REVIEW'")).length)
    throw new PlatformError('Registration approval storage needs to be installed by the administrator',503);
   this.readyUntil=Date.now()+30000;
  };
  if(c)await check(c);else await Platform.root(check);
 }
 static async create(c:oracledb.Connection,email:string,notificationEmail:string) {
  await this.ready(c);
  const result=await c.execute(`INSERT INTO CUSTOMERS.SEC_REGISTRATION_REVIEW(SIGNUP_ID,NOTIFY_EMAIL)
    SELECT SIGNUP_ID,:notificationEmail FROM CUSTOMERS.SEC_PUBLIC_SIGNUP WHERE EMAIL=:email`,{email,notificationEmail:validReviewEmail(notificationEmail)?notificationEmail:null});
  if(result.rowsAffected!==1)throw new PlatformError('Registration approval request could not be recorded',503);
 }
 static async updateRecipient(c:oracledb.Connection,tenant:string,address:string) {
  await this.ready(c);
  await c.execute(`UPDATE CUSTOMERS.SEC_REGISTRATION_REVIEW SET NOTIFY_EMAIL=:address,ADMIN_MAIL_STATUS='PENDING',ADMIN_MAIL_ATTEMPTS=0,UPDATED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)
   WHERE STATUS='PENDING' AND ADMIN_MAIL_STATUS IN ('PENDING','FAILED') AND SIGNUP_ID IN(SELECT SIGNUP_ID FROM CUSTOMERS.SEC_PUBLIC_SIGNUP WHERE TENANT_ID=:tenant)`,{address,tenant});
 }
 static async assertApproved(tenant:string,company:string) {
  await this.ready();
  const row=await Platform.root(async c=>(await read(c,`SELECT v.STATUS FROM CUSTOMERS.SEC_REGISTRATION_REVIEW v
   JOIN CUSTOMERS.SEC_PUBLIC_SIGNUP r ON r.SIGNUP_ID=v.SIGNUP_ID WHERE r.TENANT_ID=:tenant AND r.COMPANY_CODE=:company AND r.STATE='COMPLETE'`,{tenant,company}))[0]);
  if(row?.STATUS==='PENDING')throw new PlatformError('Your registration is awaiting administrator approval. We will email you when your company is ready.',403);
  if(row?.STATUS==='REJECTED')throw new PlatformError('Your registration was not approved. Check your email or contact Bayanat.',403);
 }
 static async overview(actor:string,input:any={}) {
  const access=await this.access(actor);await this.ready();
  const page=Math.max(1,Math.min(100000,Number.isFinite(Number(input.page))?Math.floor(Number(input.page))||1:1)),status=String(input.status||'PENDING').toUpperCase();
  if(!['ALL','PENDING','APPROVED','REJECTED'].includes(status))throw new PlatformError('Choose a valid registration status');
  const binds:any={},scope=access.scope==='ALL'?'1=1':access.tenants.filter(t=>t!=='root').map((t,i)=>{binds['tenant'+i]=t;return `r.TENANT_ID=:tenant${i}`;}).join(' OR ')||'1=0';
  return Platform.root(async c=>{
   const metrics=(await read(c,`SELECT COUNT(*) TOTAL,SUM(CASE WHEN v.STATUS='PENDING' THEN 1 ELSE 0 END) PENDING,
    SUM(CASE WHEN v.STATUS='REJECTED' THEN 1 ELSE 0 END) REJECTED,SUM(CASE WHEN v.STATUS='APPROVED' OR v.STATUS IS NULL THEN 1 ELSE 0 END) APPROVED
    FROM CUSTOMERS.SEC_PUBLIC_SIGNUP r LEFT JOIN CUSTOMERS.SEC_REGISTRATION_REVIEW v ON v.SIGNUP_ID=r.SIGNUP_ID WHERE r.STATE='COMPLETE' AND (${scope})`,binds))[0];
   const search=String(input.search||'').trim().slice(0,100),filter=`r.STATE='COMPLETE' AND (${scope})${status==='ALL'?'':status==='APPROVED'?" AND (v.STATUS='APPROVED' OR v.STATUS IS NULL)":' AND v.STATUS=:status'}${search?" AND (LOWER(r.COMPANY_CODE) LIKE :search OR LOWER(r.EMAIL) LIKE :search OR LOWER(JSON_VALUE(r.PAYLOAD,'$.name')) LIKE :search)":''}`;
   const listBinds={...binds,...(status!=='ALL'&&status!=='APPROVED'?{status}:{}),...(search?{search:'%'+search.toLowerCase()+'%'}:{})};
   const count=Number((await read(c,`SELECT COUNT(*) CNT FROM CUSTOMERS.SEC_PUBLIC_SIGNUP r LEFT JOIN CUSTOMERS.SEC_REGISTRATION_REVIEW v ON v.SIGNUP_ID=r.SIGNUP_ID WHERE ${filter}`,listBinds))[0].CNT);
   const rows=await read(c,`SELECT r.SIGNUP_ID,r.EMAIL,r.PAYLOAD,r.TENANT_ID,r.COMPANY_CODE,r.SETUP_STATUS,r.WELCOME_STATUS,
    TO_CHAR(r.CREATED_AT,'YYYY-MM-DD HH24:MI') CREATED_AT,TO_CHAR(r.TRIAL_END_AT,'YYYY-MM-DD HH24:MI') TRIAL_END_AT,
    NVL(v.STATUS,'EXISTING') REVIEW_STATUS,v.REVIEWED_BY,TO_CHAR(v.REVIEWED_AT,'YYYY-MM-DD HH24:MI') REVIEWED_AT,v.REASON,v.ADMIN_MAIL_STATUS
    FROM CUSTOMERS.SEC_PUBLIC_SIGNUP r LEFT JOIN CUSTOMERS.SEC_REGISTRATION_REVIEW v ON v.SIGNUP_ID=r.SIGNUP_ID WHERE ${filter}
    ORDER BY r.CREATED_AT DESC,r.SIGNUP_ID DESC OFFSET :offset ROWS FETCH NEXT 20 ROWS ONLY`,{...listBinds,offset:(page-1)*20});
   return {metrics:metrics||{},count,page,rows:rows.map(row=>{const p=JSON.parse(row.PAYLOAD);const {PAYLOAD,...safe}=row;return {...safe,companyName:p.name,adminName:p.username,loginid:p.loginid,address:p.address,phone:p.phone,country:p.country,modules:p.quote.modules,contacts:p.copyEmails||[]};})};
  });
 }
 static async decide(actor:string,id:number,input:any) {
  input=input||{};
  const access=await this.access(actor);await this.ready();
  if(!Number.isSafeInteger(id)||id<=0||!['APPROVED','REJECTED'].includes(input.decision))throw new PlatformError('Choose approve or reject');
  const reason=String(input.reason||'').trim();
  if(reason.length>1000||input.decision==='REJECTED'&&!reason)throw new PlatformError('Enter a rejection reason of 1 to 1000 characters');
  const result=await Platform.root(async c=>{
   try{
    const [row]=await read(c,`SELECT r.TENANT_ID,r.COMPANY_CODE,r.PAYLOAD,v.STATUS FROM CUSTOMERS.SEC_PUBLIC_SIGNUP r
      JOIN CUSTOMERS.SEC_REGISTRATION_REVIEW v ON v.SIGNUP_ID=r.SIGNUP_ID WHERE r.SIGNUP_ID=:id AND r.STATE='COMPLETE' FOR UPDATE OF v.STATUS WAIT 5`,{id});
    if(!row||access.scope!=='ALL'&&!access.tenants.includes(row.TENANT_ID))throw new PlatformError('Registration request not found in your allowed tenants',404);
    if(row.STATUS!=='PENDING')throw new PlatformError('This request was already reviewed. Refresh the list.',409);
    await c.execute(`UPDATE CUSTOMERS.SEC_REGISTRATION_REVIEW SET STATUS=:decision,REVIEWED_BY=:actor,REVIEWED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP),REASON=:reason,
     REJECT_MAIL_STATUS=CASE WHEN :decision='REJECTED' THEN 'PENDING' ELSE 'NOT_REQUIRED' END,UPDATED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP) WHERE SIGNUP_ID=:id`,{decision:input.decision,actor,reason:reason||null,id});
    await Platform.audit(actor,row.TENANT_ID,row.COMPANY_CODE,input.decision,'PUBLIC_REGISTRATION_REVIEW',{signupId:id,reason:reason||null},c);
    await c.commit();return {payload:JSON.parse(row.PAYLOAD),decision:input.decision};
   }catch(e){await c.rollback();throw e;}
  });
  if(result.decision==='APPROVED'){
   const {PublicRegistrationService}=await import('./publicRegistration.service');
   try{await PublicRegistrationService.finishSetup(result.payload);return {decision:result.decision,setupReady:true,message:'Approved. The company is ready; the approval email is queued.'};}
   catch{return {decision:result.decision,setupReady:false,message:'Approved. Company setup will retry automatically; sign-in stays blocked until setup is ready.'};}
  }
  return {decision:result.decision,message:'Registration rejected. The applicant notification is queued.'};
 }
 static async processNotifications(send=sendRegistrationMail) {
  await this.ready();
  await Platform.root(async c=>{await c.execute(`UPDATE CUSTOMERS.SEC_REGISTRATION_REVIEW SET
   ADMIN_MAIL_STATUS=CASE WHEN ADMIN_MAIL_STATUS='SENDING' THEN 'FAILED' ELSE ADMIN_MAIL_STATUS END,
   REJECT_MAIL_STATUS=CASE WHEN REJECT_MAIL_STATUS='SENDING' THEN 'FAILED' ELSE REJECT_MAIL_STATUS END
   WHERE UPDATED_AT<CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)-INTERVAL '30' MINUTE AND (ADMIN_MAIL_STATUS='SENDING' OR REJECT_MAIL_STATUS='SENDING')`);await c.commit();});
  const config=await Platform.root(async c=>{const [row]=await read(c,'SELECT CONFIG_JSON FROM CUSTOMERS.SEC_REGISTRATION_CONFIG WHERE CONFIG_ID=1');return row?JSON.parse(row.CONFIG_JSON):{};});
  const appUrl=registrationAppUrl(config);
  const rows=await Platform.root(c=>read(c,`SELECT v.SIGNUP_ID,v.STATUS,v.NOTIFY_EMAIL,v.REASON,v.ADMIN_MAIL_STATUS,v.REJECT_MAIL_STATUS,r.PAYLOAD FROM CUSTOMERS.SEC_REGISTRATION_REVIEW v
   JOIN CUSTOMERS.SEC_PUBLIC_SIGNUP r ON r.SIGNUP_ID=v.SIGNUP_ID WHERE r.STATE='COMPLETE' AND
   ((v.STATUS='PENDING' AND v.NOTIFY_EMAIL IS NOT NULL AND v.ADMIN_MAIL_STATUS IN ('PENDING','FAILED') AND v.ADMIN_MAIL_ATTEMPTS<5) OR
    (v.STATUS='REJECTED' AND v.REJECT_MAIL_STATUS IN ('PENDING','FAILED') AND v.REJECT_MAIL_ATTEMPTS<5)) ORDER BY v.REQUESTED_AT FETCH FIRST 10 ROWS ONLY`));
  for(const row of rows){
   const admin=row.STATUS==='PENDING',column=admin?'ADMIN_MAIL_STATUS':'REJECT_MAIL_STATUS',attempts=admin?'ADMIN_MAIL_ATTEMPTS':'REJECT_MAIL_ATTEMPTS';
   const claimed=await Platform.root(async c=>{const r=await c.execute(`UPDATE CUSTOMERS.SEC_REGISTRATION_REVIEW SET ${column}='SENDING',${attempts}=${attempts}+1,UPDATED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP) WHERE SIGNUP_ID=:id AND STATUS=:status AND ${column} IN ('PENDING','FAILED')`,{id:row.SIGNUP_ID,status:row.STATUS});await c.commit();return r.rowsAffected;});
   if(!claimed)continue;
   let status='SENT';try{const p=JSON.parse(row.PAYLOAD);await send(admin?row.NOTIFY_EMAIL:p.adminEmail,admin?'New Bayanat registration awaiting approval':'Your Bayanat registration request',admin?
    `A verified registration is awaiting review.\n\nCompany: ${p.name} (${p.company})\nAdministrator: ${p.username}\nEmail: ${p.adminEmail}\nLogin ID: ${p.loginid}\nModules: ${p.quote.modules.join(', ')}\n\nReview securely in the administration console:\n${new URL('/workspace/security/platform-admin',appUrl)}\n\nSign-in remains blocked until approval. No password or approval token is included in this email.`:
    `Your registration for ${p.name} (${p.company}) was not approved.\n\nReason: ${row.REASON}\n\nContact Bayanat if you need help. Your company cannot sign in.`);
   }catch{status='FAILED';}
   await Platform.root(async c=>{await c.execute(`UPDATE CUSTOMERS.SEC_REGISTRATION_REVIEW SET ${column}=:status,UPDATED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP) WHERE SIGNUP_ID=:id AND ${column}='SENDING'`,{id:row.SIGNUP_ID,status});await c.commit();});
  }
 }
}
