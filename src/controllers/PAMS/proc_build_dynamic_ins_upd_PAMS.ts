import { Response } from "express";
import { QueryExecutor } from "../../database/QueryExecutor";
import { RequestWithUser } from "../../interfaces/common.interface";
import oracledb from "oracledb";
import { getPamsLoginId, getPamsTenantSchema, validatePamsGeneratedSql } from "./pamsTenantSafety";

export const proc_build_dynamic_ins_upd_PAMS = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const {
      parameter,

      // INSERT / UPDATE VALUES
      val1s1,
      val1s2,
      val1s3,
      val1s4,
      val1s5,
      val1s6,
      val1s7,
      val1s8,
      val1s9,
      val1s10,

      val1n1,
      val1n2,
      val1n3,
      val1n4,
      val1n5,

      val1d1,
      val1d2,
      val1d3,
      val1d4,
      val1d5,

      // WHERE VALUES
      wval1s1,
      wval1s2,
      wval1s3,
      wval1s4,
      wval1s5,

      wval1n1,
      wval1n2,
      wval1n3,
      wval1n4,
      wval1n5,

      wval1d1,
      wval1d2,
      wval1d3,
      wval1d4,
      wval1d5
    } = req.body;

    if (!parameter) {
      res.status(400).json({
        success: false,
        message: "Missing required parameter 'parameter'"
      });
      return;
    }

    const tenantSchema = await getPamsTenantSchema();

    // Call procedure to build INSERT / UPDATE SQL (Tenant-Aware)
    const result = await QueryExecutor.executeRawQuery(
      `
      DECLARE
        v_sql CLOB;
      BEGIN
        ${tenantSchema}.PROC_BUILD_DYNAMIC_INS_UPD_PAMS(
          :parameter,
          :loginid,

          :val1s1, :val1s2, :val1s3, :val1s4, :val1s5,
          :val1s6, :val1s7, :val1s8, :val1s9, :val1s10,

          :val1n1, :val1n2, :val1n3, :val1n4, :val1n5,

          :val1d1, :val1d2, :val1d3, :val1d4, :val1d5,

          :wval1s1, :wval1s2, :wval1s3, :wval1s4, :wval1s5,

          :wval1n1, :wval1n2, :wval1n3, :wval1n4, :wval1n5,

          :wval1d1, :wval1d2, :wval1d3, :wval1d4, :wval1d5,

          v_sql
        );
        :out_sql := v_sql;
      END;
      `,
      {
        parameter,
        loginid: getPamsLoginId(req),

        val1s1,
        val1s2,
        val1s3,
        val1s4,
        val1s5,
        val1s6,
        val1s7,
        val1s8,
        val1s9,
        val1s10,

        val1n1,
        val1n2,
        val1n3,
        val1n4,
        val1n5,

        val1d1,
        val1d2,
        val1d3,
        val1d4,
        val1d5,

        wval1s1,
        wval1s2,
        wval1s3,
        wval1s4,
        wval1s5,

        wval1n1,
        wval1n2,
        wval1n3,
        wval1n4,
        wval1n5,

        wval1d1,
        wval1d2,
        wval1d3,
        wval1d4,
        wval1d5,

        out_sql: {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 32767
        }
      }
    );

    interface ProcOut {
      out_sql: string | null;
    }

    const outBinds = result.outBinds as ProcOut;
    const dynamicSql = outBinds?.out_sql;

    if (!dynamicSql) {
      res.status(400).json({
        success: false,
        message: "Procedure returned no SQL"
      });
      return;
    }

    if (/^BEGIN\s+NULL\s*;\s*END\s*;?$/i.test(dynamicSql.trim())) {
      res.json({ success: true });
      return;
    }

    // Execute INSERT / UPDATE (Tenant-Aware)
    validatePamsGeneratedSql(dynamicSql, "write");
    await QueryExecutor.executeRawQuery(dynamicSql, []);

    res.json({
      success: true,
      // message: "Appraisal Created Successfully"
    });

  } catch (error: any) {
    console.error("Oracle Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute insert/update",
      details: error.message
    });
  }
};
