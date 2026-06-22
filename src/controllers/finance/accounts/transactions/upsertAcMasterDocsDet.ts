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