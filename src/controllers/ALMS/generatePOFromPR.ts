import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";

export const generatePOFromPR = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { companyCode, requestNumber, docType } = req.body;

  if (!companyCode || !requestNumber) {
    res.status(400).json({
      success: false,
      message: 'companyCode and requestNumber are required.',
    });
    return;
  }

  let connection: oracledb.Connection | undefined;

  try {
    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found."
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    await connection.execute(
      `BEGIN
         PROC_GEN_PO_FROM_PR(
           P_COMPANY_CODE   => :companyCode,
           P_REQUEST_NUMBER => :requestNumber,
           P_DOC_TYPE       => :docType
         );
       END;`,
      {
        companyCode,
        requestNumber,
        docType: docType || 'LPO',
      },
      { autoCommit: true }
    );

    res.json({ 
      success: true, 
      message: 'PO generated successfully.' 
    });

  } catch (error: any) {
    console.error('PROC_GEN_PO_FROM_PR error:', error);
    
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate PO from PR.',
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Connection close error:", closeError);
      }
    }
  }
};