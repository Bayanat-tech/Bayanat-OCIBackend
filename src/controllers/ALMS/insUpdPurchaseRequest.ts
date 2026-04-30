import { Request, Response } from "express";
import { QueryExecutor } from "../../database/QueryExecutor";
import oracledb from "oracledb";

// ── shared helper — always passes all 38 params correctly ──────────────────
const buildProcCall = (bindVars: Record<string, any>) => ({
  sql: `
    DECLARE
      v_sql VARCHAR2(32767);
    BEGIN
      PROC_BUILD_DYNAMIC_INS_UPD_COMMON(
        :parameter, :loginid,
        :val1s1,  :val1s2,  :val1s3,  :val1s4,  :val1s5,
        :val1s6,  :val1s7,  :val1s8,  :val1s9,  :val1s10,
        :val1n1,  :val1n2,  :val1n3,  :val1n4,  :val1n5,
        :val1d1,  :val1d2,  :val1d3,  :val1d4,  :val1d5,
        :wval1s1, :wval1s2, :wval1s3, :wval1s4, :wval1s5,
        :wval1n1, :wval1n2, :wval1n3, :wval1n4, :wval1n5,
        :wval1d1, :wval1d2, :wval1d3, :wval1d4, :wval1d5,
        v_sql
      );
      :out_sql := v_sql;
    END;
  `,
  binds: {
    parameter: bindVars.parameter,
    loginid:   bindVars.loginid,
    val1s1:  bindVars.val1s1  ?? null,
    val1s2:  bindVars.val1s2  ?? null,
    val1s3:  bindVars.val1s3  ?? null,
    val1s4:  bindVars.val1s4  ?? null,
    val1s5:  bindVars.val1s5  ?? null,
    val1s6:  bindVars.val1s6  ?? null,
    val1s7:  bindVars.val1s7  ?? null,
    val1s8:  bindVars.val1s8  ?? null,
    val1s9:  bindVars.val1s9  ?? null,
    val1s10: bindVars.val1s10 ?? null,
    val1n1:  bindVars.val1n1  ?? null,
    val1n2:  bindVars.val1n2  ?? null,
    val1n3:  bindVars.val1n3  ?? null,
    val1n4:  bindVars.val1n4  ?? null,
    val1n5:  bindVars.val1n5  ?? null,
    val1d1:  null,
    val1d2:  null,
    val1d3:  null,
    val1d4:  null,
    val1d5:  null,
    wval1s1: null,
    wval1s2: null,
    wval1s3: null,
    wval1s4: null,
    wval1s5: null,
    wval1n1: null,
    wval1n2: null,
    wval1n3: null,
    wval1n4: null,
    wval1n5: null,
    wval1d1: null,
    wval1d2: null,
    wval1d3: null,
    wval1d4: null,
    wval1d5: null,
    out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 }
  }
});

// ── helper: call proc → get SQL → execute it ──────────────────────────────
const callAndExecute = async (bindVars: Record<string, any>): Promise<void> => {
  const { sql, binds } = buildProcCall(bindVars);
  const result = await QueryExecutor.executeRawQuery(sql, binds);
  const dynamicSql = (result.outBinds as any)?.out_sql as string | null;

  if (!dynamicSql) throw new Error('Procedure returned no SQL');
  if (dynamicSql.startsWith('ERROR')) throw new Error(dynamicSql);
  if (dynamicSql === 'INVALID PARAMETER') throw new Error('Invalid parameter: ' + bindVars.parameter);

  console.log(`[insUpdPR][${bindVars.parameter}] SQL:`, dynamicSql);
  await QueryExecutor.executeRawQuery(dynamicSql, []);
};

// ── 1. Generic ins/upd (purana endpoint — waise ka waisa rehne do) ─────────
export const proc_build_dynamic_ins_upd_ALMS = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      parameter, loginid,
      val1s1, val1s2, val1s3, val1s4, val1s5,
      val1s6, val1s7, val1s8, val1s9, val1s10,
      val1n1, val1n2, val1n3, val1n4, val1n5,
    } = req.body;

    if (!parameter) {
      res.status(400).json({ success: false, message: "Missing required parameter 'parameter'" });
      return;
    }

    await callAndExecute({
      parameter, loginid,
      val1s1, val1s2, val1s3, val1s4, val1s5,
      val1s6, val1s7, val1s8, val1s9, val1s10,
      val1n1, val1n2, val1n3, val1n4, val1n5,
    });

    res.json({ success: true });

  } catch (error: any) {
    console.error("[ALMS] Oracle Error:", error);
    res.status(500).json({
      success: false,
      message: error.message ?? "Failed to execute insert/update"
    });
  }
};

// ── 2. Purchase Request save (header + detail + term ek saath) ────────────
export const insUpdPurchaseRequest = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { header, detail, term, loginid } = req.body;

    if (!header || !loginid) {
      res.status(400).json({ success: false, message: 'Missing header or loginid' });
      return;
    }

    const h = header;

    // ── STEP 1: Header save ──────────────────────────────────────────────────
    await callAndExecute({
      parameter: 'Amlspf_IU_PURCHASE_REQUEST_HEADER',
      loginid,
      val1s1:  h.request_number    ?? null,
      val1s2:  h.company_code      ?? null,
      val1s3:  h.flow_code         ?? null,
      val1s4:  h.department_code   ?? null,
      val1s5:  h.description       ?? null,
      val1s6:  h.remarks           ?? null,
      val1s7:  h.curr_code         ?? 'AED',
      val1s8:  h.last_action       ?? null,
      val1s9:  h.last_updated      ?? loginid,
      val1s10: h.tx_cat_code       ?? null,
      val1n1:  h.flow_level_initial ?? 1,
      val1n2:  h.flow_level_running ?? 1,
      val1n3:  h.flow_level_final   ?? 3,
      val1n4:  h.amount             ?? 0,
      val1n5:  h.currency_rate      ?? 1,
    });

    await QueryExecutor.executeRawQuery('COMMIT', []);

    // ── STEP 2: request_number fetch (agar INSERT tha) ───────────────────────
    let requestNumber: string = h.request_number;
    if (!requestNumber) {
      const rnResult = await QueryExecutor.executeRawQuery(
        `SELECT REQUEST_NUMBER
           FROM CUSTOMERBK.PURCHASE_REQUEST_HEADER
          WHERE COMPANY_CODE = :company_code
            AND USER_ID      = :loginid
          ORDER BY USER_DT DESC
          FETCH FIRST 1 ROWS ONLY`,
        { company_code: h.company_code, loginid }
      );
      requestNumber = (rnResult.rows as any[])?.[0]?.[0] ?? null;
    }

    if (!requestNumber) {
      res.status(500).json({ success: false, message: 'Could not determine request_number' });
      return;
    }

    // ── STEP 3: Detail rows ──────────────────────────────────────────────────
    if (Array.isArray(detail) && detail.length > 0) {
      for (const item of detail) {
        await callAndExecute({
          parameter: 'Amlspf_IU_PURCHASE_REQUEST_DETAILS',
          loginid,
          val1s1:  requestNumber,
          val1s2:  h.company_code           ?? null,
          val1s3:  item.item_code            ?? null,
          val1s4:  item.cost_code            ?? null,
          val1s5:  item.supplier             ?? null,
          val1s6:  item.curr_code            ?? 'AED',
          val1s7:  item.tx_cat_code          ?? null,
          val1s8:  item.tx_compntcat_code_1  ?? null,
          val1n1:  item.item_srno                   ?? 0,
          val1n2:  item.request_quantity            ?? 0,
          val1n3:  item.allocated_approved_quantity ?? 0,
          val1n4:  item.item_rate                   ?? 0,
          val1n5:  item.discount_amount             ?? 0,
        });
      }
    }

    await QueryExecutor.executeRawQuery('COMMIT', []);

    // ── STEP 4: Term rows (baad mein extend karna) ───────────────────────────

    res.json({ success: true, request_number: requestNumber });

  } catch (error: any) {
    console.error('[insUpdPurchaseRequest] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message ?? 'Failed to save purchase request'
    });
  }
};