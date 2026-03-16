import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware"

export const insUpdMsProductEdiBulk = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection;

  try {
    const products = req.body?.products;

    if (!Array.isArray(products) || products.length === 0) {
      res.status(400).json({
        success: false,
        message: "products array is required"
      });
      return;
    }

    // Resolve tenant
    let tenantId: string | undefined;
    try {
      tenantId = getCurrentTenantId();
    } catch (e) {}

    if (!tenantId && req.body?.loginid) {
      tenantId = await TenantManager.getTenantForUser(req.body.loginid);
    }

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    await connection.execute(
      `
      BEGIN
        PROC_INS_UPD_MS_PRODUCT_EDI(:p_products);
      END;
      `,
      {
        p_products: {
          type: "MS_PRODUCT_EDI_TAB",
          val: products.map((p: any) => ({
            ...p,
            CREATED_AT: p.created_at ? new Date(p.created_at) : null,
            UPDATED_AT: p.updated_at ? new Date(p.updated_at) : null
          }))
        }
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${products.length} products processed successfully`
    });

  } catch (err: any) {

    console.error("Oracle error:", err);

    res.status(500).json({
      success: false,
      message: "Bulk procedure execution failed",
      details: err.message
    });

  } finally {
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
};
