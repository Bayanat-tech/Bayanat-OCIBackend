import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";

export const insertQuotationComparison = async (
  req: Request,
  res: Response
): Promise<void> => {
  console.log(
    "insertQuotationComparison called-------------"
  );

  console.log(
    "req.body:",
    req.body
  );

  let connection:
    | oracledb.Connection
    | undefined;

  try {
    const {
      company_code,
      div_code,
      quotation_nos,
      user_id,
    } = req.body;

    /*
     * Validation
     */

    if (
      !company_code ||
      !div_code ||
      !quotation_nos
    ) {
      res.status(400).json({
        success: false,
        message:
          "Company code, division code and quotation numbers are required",
      });

      return;
    }

    /*
     * Tenant
     */

    const tenantId =
      getCurrentTenantId();

    if (!tenantId) {
      res.status(400).json({
        success: false,
        message: "Tenant not found",
      });

      return;
    }

    /*
     * Connection
     */

    connection =
      await TenantManager.getConnection(
        tenantId
      );

    /*
     * Quotation string
     *
     * Example:
     *
     * PQA001,PQA002,PQA003
     */

    const quotationNos =
      String(quotation_nos).trim();

    console.log(
      "Quotation Numbers:",
      quotationNos
    );

    /*
     * Call Oracle procedure
     */

    const result =
      await connection.execute(
        `
        BEGIN

          PROC_INSERT_QUOTATION_COMPARISON(
            P_COMPANY_CODE  => :p_company_code,
            P_DIV_CODE      => :p_div_code,
            P_QUOTATION_NOS => :p_quotation_nos,
            P_USER_ID       => :p_user_id,
            P_COMPARISON_ID => :p_comparison_id
          );

        END;
        `,
        {
          p_company_code:
            company_code,

          p_div_code:
            div_code,

          p_quotation_nos:
            quotationNos,

          p_user_id:
            user_id ?? null,

          p_comparison_id: {
            dir: oracledb.BIND_OUT,
            type: oracledb.NUMBER,
          },
        },
        {
          autoCommit: false,
        }
      );

    /*
     * Get OUT parameter
     */

    const comparisonId =
      (result.outBinds as any)
        ?.p_comparison_id;

    console.log(
      "Comparison ID:",
      comparisonId
    );

    /*
     * Commit
     */

    await connection.commit();

    /*
     * Response
     */

    res.json({
      success: true,

      message:
        "Quotation comparison created successfully.",

      comparison_id:
        comparisonId,
    });

  } catch (err: any) {

    console.error(
      "Oracle Error:",
      err
    );

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      success: false,

      message:
        "Quotation comparison failed.",

      details:
        err?.message ||
        "Unknown error",
    });

  } finally {

    if (connection) {
      await connection.close();
    }

  }
};