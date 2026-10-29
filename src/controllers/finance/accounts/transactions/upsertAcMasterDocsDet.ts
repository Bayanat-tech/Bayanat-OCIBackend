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

const result: any = await connection.execute(
  `BEGIN PROC_GET_MS_AC_MASTER_DOCS_DET(:p_company_code, :p_ac_code, :p_cursor); END;`,
  {
    p_company_code: companyCode || null,
    p_ac_code: acCode,
    p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
  },
  { outFormat: oracledb.OUT_FORMAT_OBJECT }
);
const cursor = result.outBinds.p_cursor;
const rows: any[] = [];
let chunk: any[];
while ((chunk = await cursor.getRows(1000)) && chunk.length > 0) {
  rows.push(...chunk);
}
await cursor.close();
const resultRows = rows;

res.json({
    success:true,
    data:resultRows
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

const result: any = await connection.execute(
  `BEGIN PROC_DELETE_MS_AC_MASTER_DOCS_DET(:p_company_code, :p_ac_code, :p_srno, :p_status, :p_message); END;`,
  {
    p_company_code: companyCode || null,
    p_ac_code: acCode,
    p_srno: srno,
    p_status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
    p_message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
  }
);
const status = result.outBinds?.p_status;
const message = result.outBinds?.p_message;
if (status === 'ERROR') {
  res.status(400).json({ success: false, message });
  return;
}

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
