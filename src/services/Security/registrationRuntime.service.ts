import oracledb from 'oracledb';
import {PlatformAdminService as Platform, PlatformError} from './platformAdmin.service';

let cached: {available:boolean;until:number} | undefined;
let pending: Promise<boolean> | undefined;

// The migration is verified in Oracle. A missing container flag must not hide
// PRODADMIN's enabled setting or bypass an existing company's trial restrictions.
export async function registrationStorageAvailable(): Promise<boolean> {
  if(cached && cached.until>Date.now())return cached.available;
  if(pending)return pending;
  pending=Platform.root(async c=>{
    const result=await c.execute<any>(`SELECT COUNT(*) TABLE_COUNT FROM ALL_TABLES WHERE OWNER='CUSTOMERS' AND TABLE_NAME IN ('SEC_REGISTRATION_CONFIG','SEC_PUBLIC_SIGNUP')`,{}, {outFormat:oracledb.OUT_FORMAT_OBJECT});
    const available=Number(result.rows?.[0]?.TABLE_COUNT)===2;
    cached={available,until:Date.now()+30000};
    return available;
  });
  try{return await pending;}finally{pending=undefined;}
}

export function registrationAppUrl(config:{publicAppUrl?:string}): URL {
  try {
    const url=new URL(config.publicAppUrl || process.env.PUBLIC_APP_URL || '');
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash)throw new Error('Invalid public URL');
    return new URL(url.origin);
  } catch {
    throw new PlatformError('Configure the HTTPS public application URL in PRODADMIN registration settings.',503);
  }
}
