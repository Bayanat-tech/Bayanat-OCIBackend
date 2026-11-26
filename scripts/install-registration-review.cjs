require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path'),db=require('oracledb');
try{db.initOracleClient({libDir:process.env.ORACLE_INSTANT_CLIENT_PATH});}catch(e){if(e.code!=='NJS-077')throw e;}
(async()=>{const c=await db.getConnection({user:process.env.ORACLE_USER,password:process.env.ORACLE_PASSWORD,connectString:process.env.ORACLE_CONNECTION_STRING});try{
 const sql=fs.readFileSync(path.join(__dirname,'../migrations/20261125_public_registration_review.sql'),'utf8');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))try{await c.execute(statement);}catch(e){if(e.errorNum!==955)throw e;}
 console.log('Registration review storage installed. Existing signups were not changed.');
}finally{await c.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
