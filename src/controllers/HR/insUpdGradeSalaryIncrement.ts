import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

export const insUpdGradeSalaryIncrement = async (
  req: Request,
  res: Response
): Promise<void> => {

let connection: oracledb.Connection | undefined;

try {

    const data=req.body;

    const tenantId=getCurrentTenantId();

    if(!tenantId){
        res.status(400).json({
            success:false,
            message:"Tenant not found"
        });
        return;
    }

    connection=await TenantManager.getConnection(
        tenantId
    );

    await connection.execute(
    `
    BEGIN
        PROC_INS_UPD_GRADE_SAL_INCREMENT(
            :p_data
        );
    END;
    `,
    {
        p_data:{
            type:"HR_GRADE_SAL_INC_OBJ",
            val:{

                COMPANY_CODE:data.company_code,
                GRADE_CODE:data.grade_code,
                PAY_COMP_ID:data.pay_comp_id,
                OLD_GRADE_AMT:data.old_grade_amt,
                PERC_INCREMENT:data.perc_increment,
                AMT_INCREMENT:data.amt_increment,

                INCREMENTED_BY:data.incremented_by,

                INCREMENTED_ON:data.incremented_on
                ? new Date(data.incremented_on)
                :null,

                APPROVED_BY:data.approved_by,

                APPROVED_ON:data.approved_on
                ? new Date(data.approved_on)
                :null,

                ARREARS_FLAG:data.arrears_flag,
                ARREARS_AMT:data.arrears_amt,

                EFFECTIVE_DATE:data.effective_date
                ? new Date(data.effective_date)
                :null,

                ACTUAL_EFFECTIVE_DATE:data.actual_effective_date
                ? new Date(data.actual_effective_date)
                :null,

                USER_ID:data.user_id,

                USER_DT:data.user_dt
                ? new Date(data.user_dt)
                :null,

                VERIFIED_BY:data.verified_by,

                VERIFIED_ON:data.verified_on
                ? new Date(data.verified_on)
                :null,

                STATUS:data.status,
                REMARKS:data.remarks,
                APPROVAL_STATUS:data.approval_status,
                POSTED:data.posted,
                ARREARS_PERCENT:data.arrears_percent,
                POSTED_TO_EMP_INCR:data.posted_to_emp_incr,

                SLNO:data.slno,

                INCREMENT_TYPE:data.increment_type
            }
        }
    },
    {
        autoCommit:false
    });

    await connection.commit();

    res.status(200).json({
        success:true,
        message:"Salary Increment saved successfully"
    });

}
catch(error:any){

    if(connection){
        await connection.rollback();
    }

    res.status(500).json({
        success:false,
        message:error.message
    });

}
finally{

    if(connection){
        await connection.close();
    }

}

};