import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";


export const insSecRoleFunctionAccessUser = async (
    req: Request,
    res: Response
): Promise<void> => {

    console.log("insSecRoleFunctionAccessUser called------------");
    console.log("req.body------------", req.body);

    let connection: oracledb.Connection | undefined;


    try {

        const rows = req.body?.rows;


        if (!Array.isArray(rows) || rows.length === 0) {

            res.status(400).json({
                success:false,
                message:"Rows are required"
            });

            return;
        }


        const tenantId = getCurrentTenantId();


        if (!tenantId) {

            res.status(400).json({
                success:false,
                message:"Tenant not found"
            });

            return;
        }


        connection = await TenantManager.getConnection(tenantId);



        const roleAccessRows = rows.map((r:any)=>({

            COMPANY_CODE: r.company_code ?? null,

            LOGINID: r.loginid ?? null,

            SERIAL_NO_OR_ROLE_ID:
                r.serial_no_or_role_id !== undefined &&
                r.serial_no_or_role_id !== null &&
                r.serial_no_or_role_id !== ""
                ? Number(r.serial_no_or_role_id)
                : null,


            SNEW: r.snew ?? "Y",

            SMODIFY: r.smodify ?? "Y",

            SDELETE: r.sdelete ?? "Y",

            SSAVE: r.ssave ?? "Y",

            SSEARCH: r.ssearch ?? "Y",

            SSAVEAS: r.ssaveas ?? "Y",

            SUPLOAD: r.supload ?? "Y",

            SUNDO: r.sundo ?? "Y",

            SPRINT: r.sprint ?? "Y",

            SPRINTSETUP: r.sprintsetup ?? "Y",

            SHELP: r.shelp ?? "Y",


            USER_DT:
                r.user_dt
                ? new Date(r.user_dt)
                : new Date(),


            USERID:
                r.userid ?? null,


            CREATE_USER:
                r.create_user ?? null,


            CREATE_DATE:
                r.create_date
                ? new Date(r.create_date)
                : new Date()

        }));



        await connection.execute(

            `
            BEGIN

                PROC_INS_SEC_ROLE_FUNC_ACCESS_USER(:p_data);

            END;
            `,

            {
                p_data:{
                    type:"SEC_ROLE_FUNCTION_ACCESS_USER_TAB",
                    val:roleAccessRows
                }
            },

            {
                autoCommit:false
            }

        );


        await connection.commit();



        res.json({

            success:true,

            message:"Role Function Access User saved successfully"

        });



    }
    catch(err:any){


        console.error("Oracle Error:",err);


        if(connection){

            await connection.rollback();

        }


        res.status(500).json({

            success:false,

            message:"Failed to save Role Function Access User",

            details:err?.message || "Unknown error"

        });


    }
    finally{


        if(connection){

            try{

                await connection.close();

            }
            catch(err){

                console.error("Connection close error:",err);

            }

        }

    }

};