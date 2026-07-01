import { Request, Response } from "express";
import oracledb from "oracledb";

import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

export const upsertPLSetup = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {

    const data = req.body;

    // Validation
    if (!data?.company_code || !data?.pl_code) {
      res.status(400).json({
        success: false,
        message: "company_code and pl_code are required"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;

    try {
      tenantId = getCurrentTenantId();
    } catch {}

    if (!tenantId && data?.loginid) {
      tenantId = await TenantManager.getTenantForUser(
        data.loginid
      );
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(
      tenantId
    );

    // Oracle object class
    const PLSetupObjClass =
      await connection.getDbObjectClass(
        "TR_AC_PLSETUP_OBJ"
      );

    // Create object
    const obj:any = new PLSetupObjClass({

      COMPANY_CODE: data.company_code,
      PL_CODE: data.pl_code,
      PL_NAME: data.pl_name,
      PL_TYPE: data.pl_type,
      H_CODE: data.h_code,
      PRV_CODE: data.prv_code

    });

    // Execute procedure
    await connection.execute(
      `
      BEGIN
        PROC_UPSERT_PLSETUP(:p_data);
      END;
      `,
      {
        p_data: obj
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Record saved successfully"
    });

  } catch(err:any){

    console.error(
      "Oracle Error:",
      err
    );

    res.status(500).json({
      success:false,
      message:"Upsert failed",
      details:err.message
    });

  } finally {

    if(connection){
      await connection.close()
      .catch(()=>{});
    }

  }
};