// import { Request, Response } from "express";
// import oracledb from "oracledb";
// import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
// import TenantManager from "../../database/TenantManager";

// export const getPurchaseSalesDashboard = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   console.log("getPurchaseSalesDashboard called-------------");
//   console.log("req.query:", req.query);

//   let connection: oracledb.Connection | undefined;

//   try {
//     const companyCode = String(req.query.company_code || "BSG");

//     const tenantId = getCurrentTenantId();

//     if (!tenantId) {
//       res.status(400).json({
//         success: false,
//         message: "Tenant not found",
//       });

//       return;
//     }

//     connection = await TenantManager.getConnection(tenantId);

//     const result = await connection.execute(
//       `
//       BEGIN

//         PROC_PURCHASE_NSALES_DASHBOARED(
//           :P_COMPANY_CODE,
//           :P_SUMMARY,
//           :P_SUPPLIERS,
//           :P_CUSTOMERS,
//           :P_PURCHASE,
//           :P_SALES
//         );

//       END;
//       `,
//       {
//         P_COMPANY_CODE: {
//           dir: oracledb.BIND_IN,
//           val: companyCode,
//           type: oracledb.STRING,
//         },

//         P_SUMMARY: {
//           dir: oracledb.BIND_OUT,
//           type: oracledb.CURSOR,
//         },

//         P_SUPPLIERS: {
//           dir: oracledb.BIND_OUT,
//           type: oracledb.CURSOR,
//         },

//         P_CUSTOMERS: {
//           dir: oracledb.BIND_OUT,
//           type: oracledb.CURSOR,
//         },

//         P_PURCHASE: {
//           dir: oracledb.BIND_OUT,
//           type: oracledb.CURSOR,
//         },

//         P_SALES: {
//           dir: oracledb.BIND_OUT,
//           type: oracledb.CURSOR,
//         },
//       }
//     );

//     const outBinds = result.outBinds as any;

//     const summaryCursor = outBinds.P_SUMMARY;
//     const suppliersCursor = outBinds.P_SUPPLIERS;
//     const customersCursor = outBinds.P_CUSTOMERS;
//     const purchaseCursor = outBinds.P_PURCHASE;
//     const salesCursor = outBinds.P_SALES;

//     const summaryRows = await summaryCursor.getRows();
//     const supplierRows = await suppliersCursor.getRows();
//     const customerRows = await customersCursor.getRows();
//     const purchaseRows = await purchaseCursor.getRows();
//     const salesRows = await salesCursor.getRows();

//     await summaryCursor.close();
//     await suppliersCursor.close();
//     await customersCursor.close();
//     await purchaseCursor.close();
//     await salesCursor.close();

//     const summary = summaryRows[0] || {};

//     res.json({
//       success: true,

//       data: {
//         summary: {
//           totalPRequest: summary.TOTAL_PREQUEST ?? 0,

//           totalQuotation: summary.TOTAL_QUOTATION ?? 0,

//           totalPOrder: summary.TOTAL_PORDER ?? 0,

//           totalGrn: summary.TOTAL_GRN ?? 0,

//           pOrderGrnPending: summary.PORDER_GRN_PENDING ?? 0,

//           totalInvoice: summary.TOTAL_INVOICE ?? 0,

//           invoicePending: summary.INVOICE_PENDING ?? 0,

//           totalSOrder: summary.TOTAL_SORDER ?? 0,

//           totalSdn: summary.TOTAL_SDN ?? 0,

//           sOrderSdnPending: summary.SORDER_SDN_PENDING ?? 0,

//           totalSInvoice: summary.TOTAL_SINVOICE ?? 0,

//           sInvoicePending: summary.SINVOICE_PENDING ?? 0,
//         },

//         topSuppliers: supplierRows,

//         topCustomers: customerRows,

//         monthlyPurchase: purchaseRows,

//         monthlySales: salesRows,
//       },
//     });
//   } catch (err: any) {
//     console.error("Oracle Error :", err);

//     if (connection) {
//       await connection.rollback();
//     }

//     res.status(500).json({
//       success: false,

//       message: "Purchase Sales Dashboard load failed.",

//       details: err?.message || "Unknown error",
//     });
//   } finally {
//     if (connection) {
//       await connection.close();
//     }
//   }
// };

import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";

export const getPurchaseSalesDashboard = async (
  req: Request,
  res: Response
): Promise<void> => {
  console.log("getPurchaseSalesDashboard called-------------");
  console.log("req.query:", req.query);

  let connection: oracledb.Connection | undefined;

  try {
    const companyCode = String(req.query.company_code || "BSG");

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found",
      });

      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const now = new Date();

    // CHANGED: read year/month from query, fall back to current date (month 0 = full year)
    const year =
      req.query.year !== undefined && req.query.year !== ""
        ? Number(req.query.year)
        : now.getFullYear();
    const month =
      req.query.month !== undefined && req.query.month !== ""
        ? Number(req.query.month)
        : now.getMonth() + 1;

    console.log("PROC PARAMS:", { companyCode, year, month });

    const result = await connection.execute(
      `
        BEGIN
          PROC_PURCHASE_NSALES_DASHBOARED(
            :company_code,
            :year,
            :month,
            :summary,
            :suppliers,
            :customers,
            :purchase,
            :sales
          );
        END;
      `,
      {
        company_code: companyCode,
        year,
        month,

        summary: {
          dir: oracledb.BIND_OUT,
          type: oracledb.CURSOR,
        },

        suppliers: {
          dir: oracledb.BIND_OUT,
          type: oracledb.CURSOR,
        },

        customers: {
          dir: oracledb.BIND_OUT,
          type: oracledb.CURSOR,
        },

        purchase: {
          dir: oracledb.BIND_OUT,
          type: oracledb.CURSOR,
        },

        sales: {
          dir: oracledb.BIND_OUT,
          type: oracledb.CURSOR,
        },
      }
    );

    const outBinds = result.outBinds as any;

    const summaryCursor = outBinds.summary;
    const suppliersCursor = outBinds.suppliers;
    const customersCursor = outBinds.customers;
    const purchaseCursor = outBinds.purchase;
    const salesCursor = outBinds.sales;

    const summaryRows = await summaryCursor.getRows();
    const supplierRows = await suppliersCursor.getRows();
    const customerRows = await customersCursor.getRows();
    const purchaseRows = await purchaseCursor.getRows();
    const salesRows = await salesCursor.getRows();

    console.log("summaryRows:", summaryRows); // TEMP: remove after testing

    await summaryCursor.close();
    await suppliersCursor.close();
    await customersCursor.close();
    await purchaseCursor.close();
    await salesCursor.close();

    const summary = summaryRows[0] || {};

    res.json({
      success: true,

      data: {
        summary: {
          totalPRequest: summary.TOTAL_PREQUEST ?? 0,

          totalQuotation: summary.TOTAL_QUOTATION ?? 0,

          totalPOrder: summary.TOTAL_PORDER ?? 0,

          totalGrn: summary.TOTAL_GRN ?? 0,

          pOrderGrnPending: summary.PORDER_GRN_PENDING ?? 0,

          totalInvoice: summary.TOTAL_INVOICE ?? 0,

          invoicePending: summary.INVOICE_PENDING ?? 0,

          totalSOrder: summary.TOTAL_SORDER ?? 0,

          totalSdn: summary.TOTAL_SDN ?? 0,

          sOrderSdnPending: summary.SORDER_SDN_PENDING ?? 0,

          totalSInvoice: summary.TOTAL_SINVOICE ?? 0,

          sInvoicePending: summary.SINVOICE_PENDING ?? 0,
        },

        topSuppliers: supplierRows,

        topCustomers: customerRows,

        monthlyPurchase: purchaseRows,

        monthlySales: salesRows,
      },
    });
  } catch (err: any) {
    console.error("Oracle Error :", err);

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      success: false,

      message: "Purchase Sales Dashboard load failed.",

      details: err?.message || "Unknown error",
    });
  } finally {
    if (connection) {
      await connection.close();
    }
  }
};