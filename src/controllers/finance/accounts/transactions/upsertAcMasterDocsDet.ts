import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";


const toNumber = (val:any):number|null=>{
    if(val===undefined || val===null || val==="")
        return null;

    const n=Number(val);

    return isNaN(n)?null:n;
};

const toDate=(val:any):Date|null=>{
    if(!val) return null;

    const d=new Date(val);

    return isNaN(d.getTime())
        ? null
        : d;
};


export const upsertAcMasterDocsDet=async(
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
"TR_MS_AC_MASTER_DOCS_DET_OBJ"
);

const TableClass=
await connection.getDbObjectClass(
"TR_MS_AC_MASTER_DOCS_DET_TAB"
);


const rows=data.records.map(
(r:any)=>
new ObjClass({

COMPANY_CODE:data.company_code,
AC_CODE:data.ac_code,

SRNO:toNumber(r.srno),

DOC_TYPE:r.doc_type,

DOC_PATH:r.doc_path,

EXP_DATE:toDate(
r.exp_date
),

MANDATORY:r.mandatory,

USER_ID:r.user_id,

USER_DT:toDate(
r.user_dt
),

DOC_NAME:r.doc_name

})
);


const collectionObj=
new TableClass(rows);


await connection.execute(

`
BEGIN
PROC_UPSERT_MS_AC_MASTER_DOCS_DET(
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

await connection.close()
.catch(()=>{});

}

}

};

export const getAcMasterDocsDet=async(
req:Request,
res:Response
):Promise<void>=>{

let connection:oracledb.Connection|undefined;

try{

const acCode=String(req.params.ac_code || req.query.ac_code || "").trim();
const companyCode=String(req.query.company_code || "").trim();
const loginid=String(req.query.loginid || "").trim();

if(!acCode){
    res.status(400).json({
        success:false,
        message:"ac_code required"
    });
    return;
}

let tenantId:string|undefined;

try{
    tenantId=getCurrentTenantId();
}
catch{}

if(!tenantId && loginid){
    tenantId=await TenantManager.getTenantForUser(loginid);
}

if(!tenantId){
    res.status(400).json({
        success:false,
        message:"Tenant not found"
    });
    return;
}

connection=await TenantManager.getConnection(tenantId);

const binds:any={ acCode };
let companyFilter="";

if(companyCode){
    binds.companyCode=companyCode;
    companyFilter=" AND COMPANY_CODE = :companyCode";
}

const result=await connection.execute(
`
SELECT
  COMPANY_CODE,
  AC_CODE,
  SRNO,
  DOC_TYPE,
  DOC_PATH,
  EXP_DATE,
  MANDATORY,
  USER_ID,
  USER_DT,
  DOC_NAME
FROM MS_AC_MASTER_DOCS_DET
WHERE AC_CODE = :acCode
${companyFilter}
ORDER BY SRNO DESC
`,
binds,
{ outFormat: oracledb.OUT_FORMAT_OBJECT }
);

res.json({
    success:true,
    data:result.rows || []
});

}
catch(err:any){

console.log(err);

res.status(500).json({
    success:false,
    message:"Load failed",
    details:err.message
});

}
finally{

if(connection){
    await connection.close()
    .catch(()=>{});
}

}

};

export const deleteAcMasterDocsDet=async(
req:Request,
res:Response
):Promise<void>=>{

let connection:oracledb.Connection|undefined;

try{

const acCode=String(req.params.ac_code || req.body?.ac_code || "").trim();
const srno=toNumber(req.params.srno || req.body?.srno);
const companyCode=String(req.body?.company_code || req.query.company_code || "").trim();
const loginid=String(req.body?.loginid || req.query.loginid || "").trim();

if(!acCode || !srno){
    res.status(400).json({
        success:false,
        message:"ac_code and srno required"
    });
    return;
}

let tenantId:string|undefined;

try{
    tenantId=getCurrentTenantId();
}
catch{}

if(!tenantId && loginid){
    tenantId=await TenantManager.getTenantForUser(loginid);
}

if(!tenantId){
    res.status(400).json({
        success:false,
        message:"Tenant not found"
    });
    return;
}

connection=await TenantManager.getConnection(tenantId);

const binds:any={ acCode, srno };
let companyFilter="";

if(companyCode){
    binds.companyCode=companyCode;
    companyFilter=" AND COMPANY_CODE = :companyCode";
}

const result=await connection.execute(
`
DELETE FROM MS_AC_MASTER_DOCS_DET
WHERE AC_CODE = :acCode
  AND SRNO = :srno
${companyFilter}
`,
binds
);

await connection.commit();

res.json({
    success:true,
    message:"Document deleted successfully",
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
    await connection.close()
    .catch(()=>{});
}

}

};
