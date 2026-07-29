import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";


const toNumber=(val:any):number|null=>{

if(
val===undefined ||
val===null ||
val===""
)
return null;

const n=Number(val);

return isNaN(n)
? null
: n;

};


const toDate=(val:any):Date|null=>{

if(!val)
return null;

const d=new Date(val);

return isNaN(d.getTime())
? null
: d;

};

const paramValue=(val:string|string[]|undefined):string=>{
return Array.isArray(val)
? val[0] ?? ""
: val ?? "";
};



export const upsertVendorActivity=async(
req:Request,
res:Response
):Promise<void>=>{


let connection:oracledb.Connection|undefined;


try{

const data=req.body;


if(
!data?.company_code ||
!data?.ac_code ||
!Array.isArray(data.records)
){

res.status(400).json({

success:false,
message:"company_code, ac_code and records required"

});

return;

}


let tenantId:string|undefined;

try{

tenantId=getCurrentTenantId();

}
catch{}


if(!tenantId && data?.loginid){

tenantId=
await TenantManager.getTenantForUser(
data.loginid
);

}


if(!tenantId){

res.status(400).json({

success:false,
message:"Tenant not found"

});

return;

}


connection=
await TenantManager.getConnection(
tenantId
);



const ObjClass=
await connection.getDbObjectClass(
"TR_MS_AC_VENDOR_ACTVY_OBJ"
);


const TableClass=
await connection.getDbObjectClass(
"TR_MS_AC_VENDOR_ACTVY_TAB"
);



const rows=data.records.map(
(r:any)=>

new ObjClass({

COMPANY_CODE:data.company_code,

AC_CODE:data.ac_code,

SRNO:toNumber(
r.srno
),

ACT_CODE:r.act_code,

ACT_DESC:r.act_desc,

USER_ID:r.user_id,

USER_DT:toDate(
r.user_dt
)

})

);



const collectionObj=
new TableClass(
rows
);



await connection.execute(

`
BEGIN
PROC_UPSERT_MS_AC_VENDOR_ACTVY(
:p_data
);
END;
`,
{
p_data:collectionObj
}

);


await connection.commit();


res.json({

success:true,
message:"Records saved successfully"

});

}
catch(err:any){

console.log(err);


res.status(500).json({

success:false,
message:"Save failed",
details:err.message

});

}
finally{


if(connection){

await connection
.close()
.catch(()=>{});

}

}

};

export const deleteVendorActivity=async(
req:Request,
res:Response
):Promise<void>=>{

let connection:oracledb.Connection|undefined;

try{

const ac_code=paramValue(req.params.ac_code);
const srno=paramValue(req.params.srno);
const data=req.body || {};

if(
!ac_code ||
!srno ||
!data?.company_code
){

res.status(400).json({
success:false,
message:"company_code, ac_code and srno required"
});

return;

}

let tenantId:string|undefined;

try{
tenantId=getCurrentTenantId();
}
catch{}

if(!tenantId && data?.loginid){
tenantId=await TenantManager.getTenantForUser(data.loginid);
}

if(!tenantId){
res.status(400).json({
success:false,
message:"Tenant not found"
});
return;
}

connection=await TenantManager.getConnection(tenantId);

const result=await connection.execute(
`
DELETE FROM MS_AC_VENDOR_ACTVY
WHERE COMPANY_CODE = :company_code
  AND AC_CODE = :ac_code
  AND SRNO = :srno
`,
{
company_code:data.company_code,
ac_code,
srno:toNumber(srno)
},
{ autoCommit:false }
);

await connection.commit();

res.json({
success:true,
message:"Activity deleted successfully",
rowsAffected:result.rowsAffected || 0
});

}
catch(err:any){

console.log(err);

res.status(500).json({
success:false,
message:"Delete failed",
details:err.message
});

}
finally{

if(connection){
await connection.close().catch(()=>{});
}

}

};
