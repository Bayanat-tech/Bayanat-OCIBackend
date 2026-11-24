import {Router} from 'express';
import {PublicRegistrationService as Registration} from '../services/Security/publicRegistration.service';
import {PlatformError} from '../services/Security/platformAdmin.service';

const router=Router();
// Bounded local throttle; deploy behind the existing gateway/WAF for a shared
// IP quota across replicas. Never trust a caller-supplied X-Forwarded-For here.
const attempts=new Map<string,{count:number;until:number}>();
router.use((req,res,next)=>{
  const key=req.socket.remoteAddress||'unknown',now=Date.now();
  for(const [ip,value] of attempts)if(value.until<now)attempts.delete(ip);
  const current=attempts.get(key)||{count:0,until:now+15*60*1000};
  if(current.count>=30 || (!attempts.has(key)&&attempts.size>=10000)){res.status(429).json({success:false,message:'Too many registration attempts. Please try again later.'});return;}
  current.count++;attempts.set(key,current);res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');next();
});
router.use((req,res,next)=>{
  if(req.method==='POST'&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body))){res.status(400).json({success:false,message:'Provide valid registration details.'});return;}
  next();
});
const handle=(fn:(req:any)=>Promise<any>)=>async(req:any,res:any)=>{
  try{res.json({success:true,data:await fn(req)});}
  catch(e){res.status(e instanceof PlatformError?e.status:503).json({success:false,message:e instanceof PlatformError?e.message:'Registration could not be completed. Please try again or contact Bayanat.'});}
};
router.get('/catalog',handle(()=>Registration.catalog()));
router.post('/request',handle(req=>Registration.request(req.body)));
router.post('/complete',handle(req=>Registration.complete(req.body)));
export default router;
