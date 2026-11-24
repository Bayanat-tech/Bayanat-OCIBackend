import crypto from 'crypto';
import oracledb from 'oracledb';
import { PlatformAdminService as Platform, PlatformError } from './platformAdmin.service';
import { seedCompanyAdminAccess } from './defaultMasterAccess.service';
import { registrationQuote, reservedPublicModule, validRegistrationPassword, publicModuleKey } from './registrationPolicy';
import { billingMailConfigured, sendRegistrationMail } from '../../scheduler/billingEmail';
import { addDays, billingToday, periodStart } from './billingCalendar';
import {registrationAppUrl, registrationStorageAvailable} from './registrationRuntime.service';

const options = {outFormat:oracledb.OUT_FORMAT_OBJECT, fetchInfo:{CONFIG_JSON:{type:oracledb.STRING},PAYLOAD:{type:oracledb.STRING}}};
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const email = (value: unknown) => String(value || '').trim().toLowerCase();
const validEmail = (value: string) => value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
const unavailable = () => new PlatformError('Online registration is not open yet. Please contact Bayanat to create your company.',503);
const installed = async () => { if (!await registrationStorageAvailable()) throw unavailable(); };

export class PublicRegistrationService {
  static async settings() {
    await installed();
    return Platform.root(async c => {
      const r=await c.execute<any>("SELECT CONFIG_JSON FROM CUSTOMERS.SEC_REGISTRATION_CONFIG WHERE CONFIG_ID=1",{},options);
      return r.rows?.[0] ? JSON.parse(r.rows[0].CONFIG_JSON) : {enabled:false,tenant:'',currency:'INR',offers:[],version:0};
    });
  }
  static async adminSettings(actor:string) {
    if ((await Platform.getAccess(actor))?.scope!=='ALL') throw new PlatformError('Only PRODADMIN can configure public registration',403);
    const settings=await this.settings();
    const tenants=(await Platform.tenants(actor)).filter((t:any)=>t.IS_ACTIVE==='Y' && !['CUSTOMERS','WMSDEV'].includes(String(t.SCHEMA_NAME).toUpperCase()));
    return {settings:{...settings,publicAppUrl:settings.publicAppUrl||process.env.PUBLIC_APP_URL||''},tenants};
  }
  static async saveSettings(actor:string,input:any) {
    const previous=await this.adminSettings(actor);
    const tenant=String(input.tenant||'');
    if (!tenant || tenant==='root') throw new PlatformError('Choose the dedicated registration tenant');
    const catalog=await Platform.screenCatalog(tenant);
    const tenants=await Platform.tenants(actor);
    if (!tenants.some((t:any)=>t.TENANT_ID===tenant && t.IS_ACTIVE==='Y' && !['CUSTOMERS','WMSDEV'].includes(String(t.SCHEMA_NAME).toUpperCase()))) throw new PlatformError('Choose an active, non-central registration tenant');
    if (!/^[A-Z]{3}$/.test(String(input.currency))) throw new PlatformError('Choose a three-letter currency');
    if (!Array.isArray(input.offers) || input.offers.length>30) throw new PlatformError('Configure up to 30 modules');
    const seen=new Set<string>();
    const offers=input.offers.map((offer:any)=>{
      const code=publicModuleKey(offer.code),price=Number(offer.price);
      if (seen.has(code)||reservedPublicModule(code)||!catalog.some(s=>publicModuleKey(s.APP_CODE)===code)||!(price>0)||price>100000000||Math.abs(price*100-Math.round(price*100))>0.001) throw new PlatformError('Each offer needs a unique available module and a positive price with two decimal places');
      seen.add(code);return {code,label:String(offer.label||code).trim().slice(0,80),price,enabled:offer.enabled===true};
    });
    const publicAppUrl=String(input.publicAppUrl ?? previous.settings.publicAppUrl ?? '').trim();
    if(publicAppUrl || input.enabled)registrationAppUrl({publicAppUrl});
    if (input.enabled && (!offers.some((o:any)=>o.enabled)||!billingMailConfigured()||process.env.SCHEDULER_ENABLED?.toLowerCase()==='false')) throw new PlatformError('Configure billing SMTP, scheduler and a priced module before enabling registration');
    if(input.enabled)await Platform.scope(tenant,async(c,owner)=>{
      for(const table of ['MS_COMPANY','SEC_LOGIN','SEC_MODULE_DATA','SEC_ROLE_FUNCTION_ACCESS_USER'])if(!(await Platform.columns(c,owner,table)).length)throw new PlatformError(`Prepare ${table} in the registration tenant before enabling signup`);
      const required=['sec_login','access_assign_user','company'];
      if(required.some(route=>!catalog.some(s=>String(s.URL_PATH||'').toLowerCase().replace(/^\//,'').replace(/\/$/,'')===`security/masters/gm/${route}`)))throw new PlatformError('Prepare the Company, Users and Screen Assignment security screens in the registration tenant');
      if(offers.some((o:any)=>o.enabled&&['FINANCE','ACCOUNTS','AC'].includes(o.code))&&!(await c.execute("SELECT 1 FROM ALL_PROCEDURES WHERE OWNER=:owner AND OBJECT_NAME='PROC_INITIALIZE_COMPANY_FINANCE_SETUP' AND PROCEDURE_NAME IS NULL",{owner})).rows?.length)throw new PlatformError('Install the Finance company setup procedure in the registration tenant before offering Finance');
    });
    return Platform.root(async c=>{
      try {
        const r=await c.execute<any>('SELECT CONFIG_JSON FROM CUSTOMERS.SEC_REGISTRATION_CONFIG WHERE CONFIG_ID=1 FOR UPDATE',{},options);
        const current=r.rows?.[0]?JSON.parse(r.rows[0].CONFIG_JSON):{version:0};
        if (Number(input.version)!==Number(current.version)) throw new PlatformError('Registration settings changed. Reload before saving.',409);
        const config={enabled:input.enabled===true,tenant,currency:input.currency,publicAppUrl,offers,version:Number(current.version)+1};
        await c.execute('UPDATE CUSTOMERS.SEC_REGISTRATION_CONFIG SET CONFIG_JSON=:json,UPDATED_BY=:actor,UPDATED_AT=SYSTIMESTAMP WHERE CONFIG_ID=1',{json:JSON.stringify(config),actor});
        await Platform.audit(actor,'root','','UPDATE','PUBLIC_REGISTRATION_SETTINGS',{tenant,enabled:config.enabled,modules:offers.map((o:any)=>o.code)},c);
        await c.commit();return config;
      } catch(e){await c.rollback();throw e;}
    });
  }
  static async catalog() {
    if (!await registrationStorageAvailable()) return {enabled:false,modules:[],reason:'SETUP_REQUIRED'};
    const config=await this.settings();
    if(!config.enabled) return {enabled:false,modules:[],reason:'PAUSED'};
    const limits=await Platform.scope(config.tenant,async(c,owner)=>{const columns=await Platform.columns(c,owner,'MS_COMPANY');return {companyCode:Math.min(7,columns.find(col=>col.COLUMN_NAME==='COMPANY_CODE')?.DATA_LENGTH||7),companyName:Math.min(80,columns.find(col=>col.COLUMN_NAME==='COMPANY_NAME')?.DATA_LENGTH||80)};});
    return {enabled:true,currency:config.currency,trialDays:7,testMode:config.tenant==='WMSTST_TENANT',modules:config.offers.filter((o:any)=>o.enabled),limits};
  }
  static async request(input:any) {
    const config=await this.settings();if(!config.enabled)throw unavailable();
    const appUrl=registrationAppUrl(config);
    const adminEmail=email(input.email),copyEmails=[...new Set([email(input.billingEmail),email(input.alternateEmail)].filter(Boolean))].filter(x=>x!==adminEmail);
    const company=String(input.companyCode||'').trim().toUpperCase(),name=String(input.companyName||'').trim(),loginid=String(input.loginid||'').trim(),username=String(input.adminName||'').trim();
    if(!validEmail(adminEmail)||copyEmails.some(x=>!validEmail(x)))throw new PlatformError('Enter valid contact email addresses');
    if(!/^[A-Z][A-Z0-9]{1,6}$/.test(company)||!name||name.length>80||!username||username.length>50||!/^[A-Za-z0-9_.-]{3,15}$/.test(loginid))throw new PlatformError('Provide a company code (2–7 letters/digits), company name, admin name and login (3–15 characters)');
    if(input.acceptTerms!==true)throw new PlatformError('Confirm the trial and payment terms');
    await Platform.scope(config.tenant,async(c,owner)=>{
      const columns=await Platform.columns(c,owner,'MS_COMPANY');
      for(const [key,value] of [['COMPANY_CODE',company],['COMPANY_NAME',name]]){const max=columns.find(col=>col.COLUMN_NAME===key)?.DATA_LENGTH;if(max&&Buffer.byteLength(value,'utf8')>max)throw new PlatformError(`${key==='COMPANY_CODE'?'Company code':'Company name'} must fit within ${max} characters in the registration tenant.`);}
    });
    let quote;try{quote=registrationQuote(input.modules,config.offers);}catch(e:any){throw new PlatformError(e.message);}
    const payload={company,name,loginid,username,adminEmail,copyEmails,quote,currency:config.currency,tenant:config.tenant,address:String(input.address||'').trim().slice(0,100),phone:String(input.phone||'').trim().slice(0,30),country:String(input.country||'').trim().slice(0,5)};
    if(await Platform.isAdmin(loginid))throw new PlatformError('Choose another login ID');
    // Never accept tenant, price, permissions or trial dates from the caller.
    const token=crypto.randomBytes(32).toString('hex');
    await Platform.scope(config.tenant,async(c,owner)=>{
      try {
        const duplicate=await c.execute(`SELECT 1 FROM ${owner}.MS_COMPANY WHERE COMPANY_CODE=:company UNION ALL SELECT 1 FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(TRIM(LOGINID))=LOWER(:loginid) OR LOWER(TRIM(EMAIL_ID))=:adminEmail`,{company,loginid,adminEmail});
        if(duplicate.rows?.length)throw new PlatformError('This company or login is already registered. Sign in or contact support.',409);
        const existing=await c.execute<any>('SELECT STATE,CASE WHEN UPDATED_AT>CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)-INTERVAL \'2\' MINUTE THEN 1 ELSE 0 END RECENT FROM CUSTOMERS.SEC_PUBLIC_SIGNUP WHERE EMAIL=:adminEmail FOR UPDATE',{adminEmail},options);
        if(existing.rows?.[0]?.STATE==='COMPLETE')throw new PlatformError('This email is already registered. Please sign in.',409);
        if(existing.rows?.[0]?.RECENT)throw new PlatformError('A verification email was requested recently. Check your inbox or try again in two minutes.',429);
        await c.execute(`MERGE INTO CUSTOMERS.SEC_PUBLIC_SIGNUP r USING(SELECT :adminEmail EMAIL FROM DUAL)s ON(r.EMAIL=s.EMAIL)
          WHEN MATCHED THEN UPDATE SET TOKEN_HASH=:hash,PAYLOAD=:payload,TENANT_ID=:tenant,COMPANY_CODE=:company,EXPIRES_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)+INTERVAL '1' DAY,UPDATED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)
          WHEN NOT MATCHED THEN INSERT(EMAIL,TOKEN_HASH,PAYLOAD,TENANT_ID,COMPANY_CODE,STATE,EXPIRES_AT) VALUES(:adminEmail,:hash,:payload,:tenant,:company,'PENDING',CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)+INTERVAL '1' DAY)`,{adminEmail,hash:digest(token),payload:JSON.stringify(payload),tenant:config.tenant,company});
        await c.commit();
      }catch(e){await c.rollback();throw e;}
    });
    const link=new URL('/register/verify',appUrl);link.hash=token;
    await sendRegistrationMail(adminEmail,'Verify your Bayanat company registration',`Hello ${username},\n\nVerify your email and choose your admin password:\n${link}\n\nCompany: ${name} (${company})\nAdmin login: ${loginid}\nModules: ${quote.modules.join(', ')}\nMonthly subscription: ${config.currency} ${quote.amount.toFixed(2)}\nYour seven-day trial starts only after you finish setup. Payment is recorded by Bayanat billing; this email does not collect payments. This link expires in 24 hours.\n\nIf you did not request this registration, ignore this email.`);
    return {message:'Check your admin email to verify your company and set your password. The link expires in 24 hours.'};
  }
  static async complete(input:any) {
    await installed();if(!/^[a-f0-9]{64}$/.test(String(input.token||''))||!validRegistrationPassword(input.password))throw new PlatformError('Use a valid verification link and a password of 8 to 20 characters');
    const config=await this.settings();if(!config.enabled)throw unavailable();
    const tokenHash=digest(input.token);
    const pending=await Platform.root(async c=>(await c.execute<any>("SELECT PAYLOAD,STATE FROM CUSTOMERS.SEC_PUBLIC_SIGNUP WHERE TOKEN_HASH=:tokenHash",{tokenHash},options)).rows?.[0]);
    if(!pending||pending.STATE!=='PENDING')throw new PlatformError('This verification link is invalid or already used. Sign in or request a new link.',400);
    const p=JSON.parse(pending.PAYLOAD);
    if(config.tenant!==p.tenant)throw new PlatformError('Registration settings changed. Please register again.',409);
    let quote;try{quote=registrationQuote(p.quote.modules,config.offers);}catch(e:any){throw new PlatformError(e.message);}
    if(quote.amount!==p.quote.amount||config.currency!==p.currency)throw new PlatformError('Module pricing changed. Please register again to review the new price.',409);
    const catalog=await Platform.screenCatalog(p.tenant,p.company);
    const selected=catalog.filter(s=>quote.modules.includes(publicModuleKey(s.APP_CODE))&&!reservedPublicModule(s.APP_CODE));
    if(quote.modules.some(code=>!selected.some(s=>publicModuleKey(s.APP_CODE)===code)))throw new PlatformError('A selected module is not available in the registration tenant');
    const result=await Platform.scope(p.tenant,async(c,owner)=>{
      try {
        const lock=await c.execute<any>("SELECT STATE FROM CUSTOMERS.SEC_PUBLIC_SIGNUP WHERE TOKEN_HASH=:tokenHash AND EXPIRES_AT>CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP) FOR UPDATE WAIT 5",{tokenHash},options);
        if(lock.rows?.[0]?.STATE!=='PENDING')throw new PlatformError('Verification link expired or already used. Please register again.',409);
        await c.execute(`LOCK TABLE ${owner}.MS_COMPANY IN EXCLUSIVE MODE WAIT 5`);
        if((await c.execute(`SELECT 1 FROM ${owner}.MS_COMPANY WHERE COMPANY_CODE=:company`,{company:p.company})).rows?.length)throw new PlatformError('Company code was taken. Register with a different code.',409);
        const columns=await Platform.columns(c,owner,'MS_COMPANY');
        const values:Record<string,any>={COMPANY_CODE:p.company,COMPANY_NAME:p.name,ADDRESS1:p.address,COUNTRY:p.country,PHONE:p.phone,CONTACT_NUMBER:p.phone,EMAIL:p.adminEmail,CURR_CODE:p.currency,STATUS:'A',ACTIVE_FLAG:'Y',IS_ACTIVE:'Y',USERID:p.loginid,CREATE_USER:p.loginid,CREATED_BY:p.loginid,CREATE_DATE:new Date()};
        const keys=Object.keys(values).filter(k=>columns.some(col=>col.COLUMN_NAME===k));
        for(const key of keys){const column=columns.find(col=>col.COLUMN_NAME===key)!;if(typeof values[key]==='string'&&/CHAR/.test(column.DATA_TYPE)&&Buffer.byteLength(values[key],'utf8')>column.DATA_LENGTH)throw new PlatformError(`${key.replace(/_/g,' ').toLowerCase()} is too long for the registration tenant (maximum ${column.DATA_LENGTH} bytes).`);}
        await c.execute(`INSERT INTO ${owner}.MS_COMPANY (${keys.join(',')}) VALUES(${keys.map((_,i)=>':v'+i).join(',')})`,Object.fromEntries(keys.map((k,i)=>['v'+i,values[k]])));
        await Platform.provisionRegistrationUser(c,owner,p.tenant,p.company,{loginid:p.loginid,username:p.username,email:p.adminEmail,password:input.password,contact:p.phone});
        await seedCompanyAdminAccess(c,owner,p.tenant,p.company,p.loginid,catalog);
        const flags=['SNEW','SMODIFY','SDELETE','SSAVE','SSEARCH','SSAVEAS','SUPLOAD','SUNDO','SPRINT','SPRINTSETUP','SHELP'];
        // Only selected modules are enabled. Internal users cannot delegate beyond this ceiling.
        for(const screen of catalog){
          const enabled=selected.some(s=>Number(s.SERIAL_NO)===Number(screen.SERIAL_NO))||/^security\/masters\/gm\/(sec_login|access_assign_user|company)\/?$/i.test(String(screen.URL_PATH||'').replace(/^\//,''));
          await c.execute('INSERT INTO CUSTOMERS.SEC_COMPANY_SCREEN_ACCESS(TENANT_ID,COMPANY_CODE,SERIAL_NO,IS_ENABLED,UPDATED_BY) VALUES(:tenant,:company,:serial,:enabled,\'PUBLIC_REGISTRATION\')',{tenant:p.tenant,company:p.company,serial:Number(screen.SERIAL_NO),enabled:enabled?'Y':'N'});
        }
        for(const screen of selected)await c.execute(`INSERT INTO ${owner}.SEC_ROLE_FUNCTION_ACCESS_USER(COMPANY_CODE,LOGINID,SERIAL_NO_OR_ROLE_ID,${flags.join(',')},USERID) VALUES(:company,:loginid,:serial,${flags.map(()=>"'Y'").join(',')},:loginid)`,{company:p.company,loginid:p.loginid,serial:Number(screen.SERIAL_NO)});
        const start=billingToday(),next=periodStart(start,'MONTHLY',1),due=addDays(start,7);
        await c.execute(`INSERT INTO CUSTOMERS.SEC_COMPANY_SUBSCRIPTION(TENANT_ID,COMPANY_CODE,PLAN_NAME,STATUS,BILLING_CYCLE,CURRENCY,AMOUNT,NEXT_BILL_DATE,BILLING_ENABLED,START_DATE,MODULE_CODES,BILLING_EMAIL,DUE_DAYS,GRACE_DAYS,SUSPENDED,PERIOD_NO,VERSION_NO,UPDATED_BY)
          VALUES(:tenant,:company,'Self-service monthly','DRAFT','MONTHLY',:currency,:amount,TO_DATE(:next,'YYYY-MM-DD'),'Y',TO_DATE(:start,'YYYY-MM-DD'),:modules,:email,7,0,'N',1,1,'PUBLIC_REGISTRATION')`,{tenant:p.tenant,company:p.company,currency:p.currency,amount:quote.amount,next,start,modules:quote.modules.join(','),email:p.adminEmail});
        await c.execute(`INSERT INTO CUSTOMERS.SEC_BILLING_INVOICE(TENANT_ID,COMPANY_CODE,PERIOD_START,PERIOD_END,DUE_DATE,GRACE_END,PLAN_NAME,MODULE_CODES,CURRENCY,AMOUNT)
          VALUES(:tenant,:company,TO_DATE(:start,'YYYY-MM-DD'),TO_DATE(:end,'YYYY-MM-DD'),TO_DATE(:due,'YYYY-MM-DD'),TO_DATE(:due,'YYYY-MM-DD'),'Self-service monthly',:modules,:currency,:amount)`,{tenant:p.tenant,company:p.company,start,end:addDays(next,-1),due,modules:quote.modules.join(','),currency:p.currency,amount:quote.amount});
        await c.execute(`INSERT INTO CUSTOMERS.SEC_BILLING_REMINDER(INVOICE_ID,KIND,EMAIL_TO) SELECT INVOICE_ID,'ISSUED',:email FROM CUSTOMERS.SEC_BILLING_INVOICE WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND PERIOD_START=TO_DATE(:start,'YYYY-MM-DD')`,{email:p.adminEmail,tenant:p.tenant,company:p.company,start});
        await c.execute("UPDATE CUSTOMERS.SEC_PUBLIC_SIGNUP SET STATE='COMPLETE',TOKEN_HASH=NULL,WELCOME_STATUS='PENDING',UPDATED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP) WHERE EMAIL=:email",{email:p.adminEmail});
        await Platform.audit(p.loginid,p.tenant,p.company,'REGISTER','PUBLIC_COMPANY',{modules:quote.modules,amount:quote.amount,trialDays:7},c);
        await c.commit();return {loginid:p.loginid,company:p.company,trialDays:7};
      }catch(e){await c.rollback();throw e;}
    });
    // Finance procedure owns its transaction, so it must run after the signup commit.
    try { await this.finishSetup(p); return {...result,setupReady:true}; }
    catch { return {...result,setupReady:false,message:'Your company was created. Initial module setup will retry automatically; contact Bayanat if sign-in remains unavailable.'}; }
  }
  static async finishSetup(p:any) {
    await Platform.scope(p.tenant,async(c,owner)=>{
      const state=await c.execute<any>("SELECT SETUP_STATUS FROM CUSTOMERS.SEC_PUBLIC_SIGNUP WHERE EMAIL=:email AND STATE='COMPLETE'",{email:p.adminEmail},options);
      if(state.rows?.[0]?.SETUP_STATUS==='READY')return;
      if(p.quote.modules.some((m:string)=>['FINANCE','ACCOUNTS','AC'].includes(m))) {
        const result=await c.execute<any>(`BEGIN ${owner}.PROC_INITIALIZE_COMPANY_FINANCE_SETUP(:company,NULL,:actor,:status,:msg); END;`,{company:p.company,actor:p.loginid,status:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:100},msg:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:4000}});
        const status=String(result.outBinds?.status||'').toUpperCase();
        if(['E','ERROR','FAILED','FAILURE','N','0'].includes(status))throw new Error('Finance setup failed');
      }
      const start=billingToday(),next=periodStart(start,'MONTHLY',1),due=addDays(start,7);
      // Delayed setup must not consume the customer's trial or invoice period.
      await c.execute(`UPDATE CUSTOMERS.SEC_BILLING_INVOICE SET PERIOD_START=TO_DATE(:start,'YYYY-MM-DD'),PERIOD_END=TO_DATE(:end,'YYYY-MM-DD'),DUE_DATE=TO_DATE(:due,'YYYY-MM-DD'),GRACE_END=TO_DATE(:due,'YYYY-MM-DD') WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND STATUS='PENDING'`,{tenant:p.tenant,company:p.company,start,end:addDays(next,-1),due});
      await c.execute("UPDATE CUSTOMERS.SEC_COMPANY_SUBSCRIPTION SET STATUS='ACTIVE',START_DATE=TO_DATE(:start,'YYYY-MM-DD'),NEXT_BILL_DATE=TO_DATE(:next,'YYYY-MM-DD') WHERE TENANT_ID=:tenant AND COMPANY_CODE=:company AND STATUS='DRAFT'",{tenant:p.tenant,company:p.company,start,next});
      await c.execute("UPDATE CUSTOMERS.SEC_PUBLIC_SIGNUP SET SETUP_STATUS='READY',TRIAL_END_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)+INTERVAL '7' DAY WHERE EMAIL=:email AND STATE='COMPLETE' AND SETUP_STATUS='PENDING'",{email:p.adminEmail});await c.commit();
    });
  }
  static async deliverWelcome(send=sendRegistrationMail) {
    if(!await registrationStorageAvailable())return;
    const appUrl=registrationAppUrl(await this.settings());
    await Platform.root(async c=>{await c.execute("UPDATE CUSTOMERS.SEC_PUBLIC_SIGNUP SET WELCOME_STATUS='FAILED' WHERE WELCOME_STATUS='SENDING' AND UPDATED_AT<CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)-INTERVAL '30' MINUTE");await c.commit();});
    const rows=await Platform.root(async c=>(await c.execute<any>("SELECT EMAIL,PAYLOAD,TO_CHAR(TRIAL_END_AT,'YYYY-MM-DD HH24:MI') TRIAL_END FROM CUSTOMERS.SEC_PUBLIC_SIGNUP WHERE STATE='COMPLETE' AND WELCOME_STATUS IN ('PENDING','FAILED') AND MAIL_ATTEMPTS<5 AND UPDATED_AT<CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP)-INTERVAL '1' MINUTE FETCH FIRST 10 ROWS ONLY",{},options)).rows||[]);
    for(const row of rows){
      try{await this.finishSetup(JSON.parse(row.PAYLOAD));}catch{continue;}
      const claimed=await Platform.root(async c=>{const r=await c.execute("UPDATE CUSTOMERS.SEC_PUBLIC_SIGNUP SET WELCOME_STATUS='SENDING',MAIL_ATTEMPTS=MAIL_ATTEMPTS+1,UPDATED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP) WHERE EMAIL=:email AND WELCOME_STATUS IN ('PENDING','FAILED')",{email:row.EMAIL});await c.commit();return r.rowsAffected;});
      if(!claimed)continue;
      let status='SENT';try{
        const p=JSON.parse(row.PAYLOAD);
        await send([p.adminEmail,...p.copyEmails].join(','),'Your Bayanat company is ready',`Company: ${p.name} (${p.company})\nAdmin login: ${p.loginid}\nSign in: ${new URL('/login',appUrl)}\nModules: ${p.quote.modules.join(', ')}\nTrial ends: ${row.TRIAL_END} UTC\nMonthly invoice: ${p.currency} ${p.quote.amount.toFixed(2)}\n\nYour password was chosen securely by the admin and is never emailed. Contact Bayanat billing to pay your invoice before the trial ends. Access continues after Bayanat records payment. You can create internal users and assign only your company's enabled screens.`);
      }catch{status='FAILED';}
      await Platform.root(async c=>{await c.execute("UPDATE CUSTOMERS.SEC_PUBLIC_SIGNUP SET WELCOME_STATUS=:status,UPDATED_AT=CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS TIMESTAMP) WHERE EMAIL=:email",{email:row.EMAIL,status});await c.commit();});
    }
  }
}
