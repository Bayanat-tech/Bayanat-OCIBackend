import { Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../interfaces/common.interface";

/**
 * Fetch unallocated payments/receipts and open unpaid invoices for a given account.
 * Follows PowerBuilder uo_ac_unallocatedinv_allocate and dw_tr_ac_bill_allocation_forunallocated.
 */
export const getUnallocatedBills = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    const companyCode = req.user?.company_code || "BTIND";
    const acCode = String(req.query.ac_code || "").trim();
    const divCode = String(req.query.div_code || "").trim();

    if (!acCode) {
      res.status(400).json({ success: false, message: "Account code (ac_code) is required" });
      return;
    }

    conn = await TenantManager.getConnection(tenantId);

    // 1. Unallocated Receipts / Payments from VW_AC_UNALLOCATED_BILLS & TR_AC_INVDETAIL
    const unallocatedQuery = `
      SELECT 
        COMPANY_CODE,
        DOC_TYPE,
        AC_CODE,
        INV_NO,
        ORGAMT_OFUNALLOCATED AS AMOUNT,
        DIV_CODE
      FROM VW_AC_UNALLOCATED_BILLS
      WHERE (COMPANY_CODE = :cc OR :cc IS NULL)
        AND AC_CODE = :ac
        ${divCode ? "AND DIV_CODE = :dc" : ""}
    `;
    const unallocBinds: Record<string, any> = { cc: companyCode, ac: acCode };
    if (divCode) unallocBinds.dc = divCode;

    const unallocResult = await conn.execute(unallocatedQuery, unallocBinds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    // 2. Open unpaid invoices for this account (grouped by inv_no, net balance != 0)
    // Matches dw_tr_ac_bill_allocation_forunallocated
    const openInvoicesQuery = `
      SELECT 
        INV_NO,
        TO_CHAR(MAX(INV_DATE), 'YYYY-MM-DD') AS INV_DATE,
        SUM(LCUR_AMOUNT * SIGN_IND) AS BALANCE_AMOUNT,
        SUM(NVL(AMOUNT_ORIGIN, AMOUNT) * SIGN_IND) AS BALANCE_AMOUNT_ORIGIN,
        MAX(CURR_CODE) AS ORG_CURR_CODE,
        MAX(NVL(CURR_CODE_ORIGIN, CURR_CODE)) AS CURR_CODE_ORIGIN,
        MAX(EX_RATE) AS EX_RATE,
        MAX(NVL(EX_RATE_ORIGIN, EX_RATE)) AS EX_RATE_ORIGIN,
        MAX(DIV_CODE) AS DIV_CODE
      FROM TR_AC_INVDETAIL
      WHERE (COMPANY_CODE = :cc OR :cc IS NULL)
        AND AC_CODE = :ac
        ${divCode ? "AND DIV_CODE = :dc" : ""}
      GROUP BY INV_NO
      HAVING SUM(LCUR_AMOUNT * SIGN_IND) <> 0
    `;
    const openBinds: Record<string, any> = { cc: companyCode, ac: acCode };
    if (divCode) openBinds.dc = divCode;

    const openResult = await conn.execute(openInvoicesQuery, openBinds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const mappedInvoices = (openResult.rows || []).map((row: any) => {
      const bal = Number(row.BALANCE_AMOUNT || 0);
      const balOrig = Number(row.BALANCE_AMOUNT_ORIGIN ?? bal);
      return {
        ...row,
        SIGN_IND: bal >= 0 ? 1 : -1,
        DR_CR: bal >= 0 ? "Dr" : "Cr",
        RAW_BALANCE: bal,
        BALANCE_AMOUNT: Math.abs(bal),
        RAW_BALANCE_ORIGIN: balOrig,
        BALANCE_AMOUNT_ORIGIN: Math.abs(balOrig),
        CURR_CODE_ORIGIN: row.CURR_CODE_ORIGIN || row.ORG_CURR_CODE || "INR",
        EX_RATE_ORIGIN: Number(row.EX_RATE_ORIGIN || row.EX_RATE || 1),
      };
    });

    // Also get Account details
    const acRes = await conn.execute(
      `SELECT AC_CODE, AC_NAME, CURR_CODE FROM MS_ACCODES WHERE COMPANY_CODE = :cc AND AC_CODE = :ac`,
      { cc: companyCode, ac: acCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const acInfo = acRes.rows?.[0] as any;

    res.json({
      success: true,
      data: {
        account: acInfo || { ac_code: acCode, ac_name: "" },
        unallocated_bills: unallocResult.rows || [],
        open_invoices: mappedInvoices,
      },
    });
  } catch (err: any) {
    console.error("Error in getUnallocatedBills:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to retrieve unallocated bills" });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
  }
};

/**
 * Save invoice allocation voucher (UJV)
 * Offsets open invoice balances in TR_AC_INVDETAIL and posts to TR_AC_HEADER / TR_AC_DETAIL.
 * Matches PowerBuilder uo_ac_unallocatedinv_allocate ue_save.
 */
export const allocateUnallocatedInvoices = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    const companyCode = req.user?.company_code || "BTIND";
    const loginUser = req.user?.loginid || req.user?.username || "SYSTEM";
    const {
      div_code,
      ac_code,
      doc_date,
      remarks,
      allocations, // Array of { inv_no, inv_date, amount, sign_ind, curr_code, ex_rate }
      unallocated_ref_no,
      unallocated_amount,
    } = req.body;

    if (!div_code) {
      res.status(400).json({ success: false, message: "Division code (div_code) is required" });
      return;
    }
    if (!ac_code) {
      res.status(400).json({ success: false, message: "Account code (ac_code) is required" });
      return;
    }
    if (!Array.isArray(allocations) || allocations.length === 0) {
      res.status(400).json({ success: false, message: "At least one invoice allocation line is required" });
      return;
    }

    conn = await TenantManager.getConnection(tenantId);

    const docType = "UJV";
    const effDate = doc_date || new Date().toISOString().slice(0, 10);
    const dateObj = new Date(effDate);
    const yearStr = String(dateObj.getFullYear());
    const monthStr = String(dateObj.getMonth() + 1).padStart(2, "0");

    // Generate next UJV Doc No: format YY + DIV + MM + sequence
    const prefix = `${yearStr.slice(2)}${div_code}${monthStr}`;
    const maxDocRes = await conn.execute(
      `SELECT DOC_NO 
       FROM TR_AC_HEADER 
       WHERE COMPANY_CODE = :cc AND DOC_TYPE = :dt AND DOC_NO LIKE :prefix`,
      { cc: companyCode, dt: docType, prefix: `${prefix}%` },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    let maxSeq = 0;
    if (Array.isArray(maxDocRes.rows)) {
      for (const row of maxDocRes.rows as any[]) {
        const dNo = String(row.DOC_NO || "");
        if (dNo.startsWith(prefix)) {
          const tail = dNo.slice(prefix.length);
          const seq = parseInt(tail, 10);
          if (!isNaN(seq) && seq > maxSeq) {
            maxSeq = seq;
          }
        }
      }
    }

    let currSeq = maxSeq + 1;
    let newDocNo = `${prefix}${String(currSeq).padStart(3, "0")}`;

    // Safety loop to ensure DOC_NO never collides with PK_TR_AC_HEADER
    while (true) {
      const existsCheck = await conn.execute(
        `SELECT COUNT(*) AS CNT FROM TR_AC_HEADER WHERE COMPANY_CODE = :cc AND DOC_TYPE = :dt AND DOC_NO = :dn`,
        { cc: companyCode, dt: docType, dn: newDocNo },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const cnt = Number((existsCheck.rows as any[])?.[0]?.CNT ?? 0);
      if (cnt === 0) break;
      currSeq++;
      newDocNo = `${prefix}${String(currSeq).padStart(3, "0")}`;
    }

    // Calculate total allocated amount
    const totalAllocated = allocations.reduce((sum: number, line: any) => sum + Number(line.amount || 0), 0);
    const baseRemarks = remarks || `Bill Allocation UJV ${newDocNo} for A/C ${ac_code}`;

    // 1. Insert TR_AC_HEADER
    await conn.execute(
      `INSERT INTO TR_AC_HEADER (
        COMPANY_CODE, DOC_TYPE, DOC_NO, DOC_DATE, AC_CODE,
        REMARKS, CURR_CODE, EX_RATE, CANCELED,
        CREATE_USER, CREATE_DATE, EDIT_USER, EDIT_DATE,
        DIV_CODE, REF_NO
      ) VALUES (
        :cc, :dt, :dn, TO_DATE(:dd, 'YYYY-MM-DD'), :ac,
        :rm, 'INR', 1, 'N',
        :usr, SYSDATE, :usr, SYSDATE,
        :dc, :ref_no
      )`,
      {
        cc: companyCode,
        dt: docType,
        dn: newDocNo,
        dd: effDate,
        ac: ac_code,
        rm: baseRemarks.slice(0, 250),
        usr: loginUser,
        dc: div_code,
        ref_no: unallocated_ref_no ? String(unallocated_ref_no).slice(0, 50) : null,
      }
    );

    // 2. Insert TR_AC_DETAIL (Offset line)
    await conn.execute(
      `INSERT INTO TR_AC_DETAIL (
        COMPANY_CODE, DOC_TYPE, DOC_NO, SERIAL_NO, DOC_DATE,
        AC_CODE, HEADER_AC_CODE, REMARKS, AMOUNT, LCUR_AMOUNT,
        SIGN_IND, CURR_CODE, EX_RATE, CANCELLED, DIV_CODE
      ) VALUES (
        :cc, :dt, :dn, 1, TO_DATE(:dd, 'YYYY-MM-DD'),
        :ac, :ac, :rm, :amt, :amt,
        1, 'INR', 1, 'N', :dc
      )`,
      {
        cc: companyCode,
        dt: docType,
        dn: newDocNo,
        dd: effDate,
        ac: ac_code,
        rm: baseRemarks.slice(0, 250),
        amt: totalAllocated,
        dc: div_code,
      }
    );

    // 3. Insert TR_AC_INVDETAIL for each allocated invoice
    for (let i = 0; i < allocations.length; i++) {
      const line = allocations[i];
      const allocAmt = Number(line.amount || 0);
      if (allocAmt <= 0) continue;

      // Invert sign to offset the invoice:
      // If invoice has sign_ind = 1 (DR), allocation must have sign_ind = -1 (CR)
      const origSign = Number(line.sign_ind || 1);
      const allocSign = origSign > 0 ? -1 : 1;
      const invDt = line.inv_date ? String(line.inv_date).slice(0, 10) : effDate;

      await conn.execute(
        `INSERT INTO TR_AC_INVDETAIL (
          COMPANY_CODE, DOC_TYPE, DOC_NO, SERIAL_NO, DTL_SR_NO,
          DOC_DATE, AC_CODE, INV_NO, INV_DATE, AMOUNT,
          LCUR_AMOUNT, SIGN_IND, CURR_CODE, EX_RATE,
          INDICATOR_ORIGIN, DIV_CODE, CREATED_BY
        ) VALUES (
          :cc, :dt, :dn, 1, :dtl_sr,
          TO_DATE(:dd, 'YYYY-MM-DD'), :ac, :inv_no, TO_DATE(:inv_dt, 'YYYY-MM-DD'), :amt,
          :amt, :sign, :curr, :ex,
          'N', :dc, :usr
        )`,
        {
          cc: companyCode,
          dt: docType,
          dn: newDocNo,
          dtl_sr: i + 1,
          dd: effDate,
          ac: ac_code,
          inv_no: String(line.inv_no),
          inv_dt: invDt,
          amt: allocAmt,
          sign: allocSign,
          curr: line.curr_code || "INR",
          ex: Number(line.ex_rate || 1),
          dc: div_code,
          usr: loginUser,
        }
      );
    }

    // 4. If an unallocated reference receipt/payment was specified, insert offset origin line
    if (unallocated_ref_no) {
      await conn.execute(
        `INSERT INTO TR_AC_INVDETAIL (
          COMPANY_CODE, DOC_TYPE, DOC_NO, SERIAL_NO, DTL_SR_NO,
          DOC_DATE, AC_CODE, INV_NO, INV_DATE, AMOUNT,
          LCUR_AMOUNT, SIGN_IND, CURR_CODE, EX_RATE,
          INDICATOR_ORIGIN, DIV_CODE, CREATED_BY
        ) VALUES (
          :cc, :dt, :dn, 1, :dtl_sr,
          TO_DATE(:dd, 'YYYY-MM-DD'), :ac, :inv_no, TO_DATE(:dd, 'YYYY-MM-DD'), :amt,
          :amt, 1, 'INR', 1,
          'N', :dc, :usr
        )`,
        {
          cc: companyCode,
          dt: docType,
          dn: newDocNo,
          dtl_sr: allocations.length + 1,
          dd: effDate,
          ac: ac_code,
          inv_no: String(unallocated_ref_no),
          amt: totalAllocated,
          dc: div_code,
          usr: loginUser,
        }
      );
    }

    await conn.commit();

    res.status(201).json({
      success: true,
      message: `Invoice allocation voucher ${newDocNo} generated successfully`,
      data: {
        doc_no: newDocNo,
        doc_type: docType,
        total_allocated: totalAllocated,
      },
    });
  } catch (err: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    console.error("Error in allocateUnallocatedInvoices:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to allocate invoices" });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
  }
};

/**
 * Get Asset Depreciation Exceptions from TMP_AC_ASSET_DEPRCN_EXCPTN / VW_AC_ASSET_DEPRCN_EXCPTN
 */
export const getAssetDepreciationExceptions = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    const companyCode = req.user?.company_code || "BTIND";
    const divCode = String(req.query.div_code || "").trim();

    conn = await TenantManager.getConnection(tenantId);

    const query = `
      SELECT 
        ASSET_ID,
        ASSET_NAME,
        COMPANY_CODE,
        DIV_CODE,
        SALES_DATE,
        SALVAGE_VALUE,
        LAST_DPRC_DATE,
        DPRC_COMMENCE_DATE,
        WD_VALUE,
        AMOUNT,
        ACUUDRPC_OPENING,
        ACCUDPRC_AMOUNT,
        DPREC_AMT
      FROM TMP_AC_ASSET_DEPRCN_EXCPTN
      WHERE (COMPANY_CODE = :cc OR :cc IS NULL)
        ${divCode ? "AND DIV_CODE = :dc" : ""}
    `;
    const binds: Record<string, any> = { cc: companyCode };
    if (divCode) binds.dc = divCode;

    const result = await conn.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    res.json({
      success: true,
      data: result.rows || [],
    });
  } catch (err: any) {
    console.error("Error in getAssetDepreciationExceptions:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to retrieve depreciation exceptions" });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
  }
};

/**
 * Get list of existing UJV allocations
 */
export const getAllocationsList = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    const companyCode = req.user?.company_code || "BTIND";
    const divCode = String(req.query.div_code || "").trim();
    const acCode = String(req.query.ac_code || "").trim();

    conn = await TenantManager.getConnection(tenantId);

    const query = `
      SELECT 
        h.DOC_TYPE,
        h.DOC_NO,
        TO_CHAR(h.DOC_DATE, 'YYYY-MM-DD') AS DOC_DATE,
        h.AC_CODE,
        m.AC_NAME,
        h.REMARKS,
        h.CANCELED,
        h.CREATE_USER,
        TO_CHAR(h.CREATE_DATE, 'YYYY-MM-DD HH24:MI') AS CREATE_DATE,
        h.DIV_CODE,
        (SELECT NVL(SUM(d.AMOUNT), 0) FROM TR_AC_INVDETAIL d 
         WHERE d.COMPANY_CODE = h.COMPANY_CODE AND d.DOC_TYPE = h.DOC_TYPE AND d.DOC_NO = h.DOC_NO AND d.SIGN_IND = -1) AS ALLOCATED_AMOUNT
      FROM TR_AC_HEADER h
      LEFT JOIN MS_ACCODES m ON h.AC_CODE = m.AC_CODE AND h.COMPANY_CODE = m.COMPANY_CODE
      WHERE h.COMPANY_CODE = :cc AND h.DOC_TYPE = 'UJV'
        ${divCode ? "AND h.DIV_CODE = :dc" : ""}
        ${acCode ? "AND h.AC_CODE = :ac" : ""}
      ORDER BY h.DOC_DATE DESC, h.DOC_NO DESC
      FETCH FIRST 100 ROWS ONLY
    `;
    const binds: Record<string, any> = { cc: companyCode };
    if (divCode) binds.dc = divCode;
    if (acCode) binds.ac = acCode;

    const result = await conn.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    res.json({
      success: true,
      data: result.rows || [],
    });
  } catch (err: any) {
    console.error("Error in getAllocationsList:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to retrieve allocations list" });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
  }
};

/**
 * Get details of a specific UJV allocation
 */
export const getAllocationDetails = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    const companyCode = req.user?.company_code || "BTIND";
    const docNo = String(req.params.docNo || "").trim();

    if (!docNo) {
      res.status(400).json({ success: false, message: "Document number is required" });
      return;
    }

    conn = await TenantManager.getConnection(tenantId);

    const query = `
      SELECT 
        DTL_SR_NO,
        INV_NO,
        TO_CHAR(INV_DATE, 'YYYY-MM-DD') AS INV_DATE,
        AMOUNT,
        LCUR_AMOUNT,
        SIGN_IND,
        CURR_CODE,
        EX_RATE,
        INDICATOR_ORIGIN,
        DIV_CODE
      FROM TR_AC_INVDETAIL
      WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'UJV' AND DOC_NO = :dn
      ORDER BY DTL_SR_NO ASC
    `;

    const result = await conn.execute(query, { cc: companyCode, dn: docNo }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    res.json({
      success: true,
      data: result.rows || [],
    });
  } catch (err: any) {
    console.error("Error in getAllocationDetails:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to retrieve allocation details" });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
  }
};

/**
 * Cancel / Unallocate a UJV allocation
 */
export const cancelAllocation = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    const companyCode = req.user?.company_code || "BTIND";
    const loginUser = req.user?.loginid || "SYSTEM";
    const { doc_no } = req.body;

    if (!doc_no) {
      res.status(400).json({ success: false, message: "Document number is required" });
      return;
    }

    conn = await TenantManager.getConnection(tenantId);

    // Check if voucher exists and is already canceled
    const chkRes = await conn.execute(
      `SELECT CANCELED FROM TR_AC_HEADER WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'UJV' AND DOC_NO = :dn`,
      { cc: companyCode, dn: doc_no },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!chkRes.rows || chkRes.rows.length === 0) {
      res.status(404).json({ success: false, message: `Allocation voucher ${doc_no} not found` });
      return;
    }

    const isCanceled = (chkRes.rows[0] as any).CANCELED === "Y";
    if (isCanceled) {
      res.status(400).json({ success: false, message: `Allocation voucher ${doc_no} is already unallocated/canceled` });
      return;
    }

    // 1. Delete rows from TR_AC_INVDETAIL (removes the offset links, restoring original bills to unpaid)
    await conn.execute(
      `DELETE FROM TR_AC_INVDETAIL WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'UJV' AND DOC_NO = :dn`,
      { cc: companyCode, dn: doc_no }
    );

    // 2. Delete rows from TR_AC_DETAIL
    await conn.execute(
      `DELETE FROM TR_AC_DETAIL WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'UJV' AND DOC_NO = :dn`,
      { cc: companyCode, dn: doc_no }
    );

    // 3. Mark TR_AC_HEADER as canceled
    await conn.execute(
      `UPDATE TR_AC_HEADER 
       SET CANCELED = 'Y', EDIT_USER = :usr, EDIT_DATE = SYSDATE 
       WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'UJV' AND DOC_NO = :dn`,
      { cc: companyCode, dn: doc_no, usr: loginUser }
    );

    await conn.commit();

    res.json({
      success: true,
      message: `Allocation voucher ${doc_no} successfully unallocated. Invoices and payments have been restored to open balance.`,
    });
  } catch (err: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    console.error("Error in cancelAllocation:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to unallocate voucher" });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
  }
};

/**
 * Check if the JV for an asset depreciation doc_no is active or canceled in TR_AC_HEADER
 */
export const getAssetDepreciationStatus = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    const companyCode = req.user?.company_code || "BTIND";
    const docNo = req.query.doc_no ? Number(req.query.doc_no) : 0;
    const divCode = String(req.query.div_code || "").trim();

    if (!docNo) {
      res.status(400).json({ success: false, message: "doc_no is required" });
      return;
    }

    conn = await TenantManager.getConnection(tenantId);

    // Get REF_DOC_NO from TR_AC_ASSET_DPRCREGISTER
    const regRes = await conn.execute(
      `SELECT DISTINCT REF_DOC_NO, REF_DOC_TYPE 
       FROM TR_AC_ASSET_DPRCREGISTER 
       WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'ADP' AND DOC_NO = :dn AND (:dc IS NULL OR DIV_CODE = :dc)`,
      { cc: companyCode, dn: docNo, dc: divCode || null },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!regRes.rows || regRes.rows.length === 0) {
      res.json({ success: true, exists: false, isJvPosted: false, isJvCanceled: false, jvNo: null });
      return;
    }

    const jvNo = (regRes.rows[0] as any).REF_DOC_NO;
    if (!jvNo) {
      res.json({ success: true, exists: true, isJvPosted: false, isJvCanceled: false, jvNo: null });
      return;
    }

    // Check TR_AC_HEADER for this JV's cancellation status
    const hdrRes = await conn.execute(
      `SELECT CANCELED FROM TR_AC_HEADER WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'JV' AND DOC_NO = :jn`,
      { cc: companyCode, jn: jvNo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const isCanceled = hdrRes.rows && hdrRes.rows.length > 0 ? (hdrRes.rows[0] as any).CANCELED === "Y" : false;

    res.json({
      success: true,
      exists: true,
      isJvPosted: true,
      isJvCanceled: isCanceled,
      jvNo: jvNo,
    });
  } catch (err: any) {
    console.error("Error in getAssetDepreciationStatus:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to check depreciation status" });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
  }
};

/**
 * Delete / Rollback an asset depreciation month calculation.
 * Allowed only if:
 * 1. No future period depreciation exists (strict reverse order: Dec -> Nov -> Oct).
 * 2. The linked JV is either NOT posted or has been CANCELED in TR_AC_HEADER.
 */
export const deleteAssetDepreciation = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn: oracledb.Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    const companyCode = req.user?.company_code || "BTIND";
    const { doc_no, div_code } = req.body;
    const numDocNo = Number(doc_no);

    if (!numDocNo) {
      res.status(400).json({ success: false, message: "Valid doc_no is required" });
      return;
    }

    conn = await TenantManager.getConnection(tenantId);

    // 1. Check if future period exists
    const futureCheck = await conn.execute(
      `SELECT COUNT(*) AS CNT 
       FROM TR_AC_ASSET_DPRCREGISTER 
       WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'ADP' AND DOC_NO > :dn AND DIV_CODE = :dc`,
      { cc: companyCode, dn: numDocNo, dc: div_code || "16" },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const futureCnt = Number((futureCheck.rows?.[0] as any)?.CNT || 0);
    if (futureCnt > 0) {
      res.status(400).json({
        success: false,
        message: `Cannot delete: Future period depreciation records exist. Please delete later months first (sequential rollback).`,
      });
      return;
    }

    // 2. Check if linked JV is active
    const jvCheck = await conn.execute(
      `SELECT DISTINCT r.REF_DOC_NO, h.CANCELED 
       FROM TR_AC_ASSET_DPRCREGISTER r
       LEFT JOIN TR_AC_HEADER h ON h.COMPANY_CODE = r.COMPANY_CODE AND h.DOC_TYPE = 'JV' AND h.DOC_NO = r.REF_DOC_NO
       WHERE r.COMPANY_CODE = :cc AND r.DOC_TYPE = 'ADP' AND r.DOC_NO = :dn`,
      { cc: companyCode, dn: numDocNo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (jvCheck.rows && jvCheck.rows.length > 0) {
      const row = jvCheck.rows[0] as any;
      if (row.REF_DOC_NO && row.CANCELED !== "Y") {
        res.status(400).json({
          success: false,
          message: `Cannot delete: Linked Journal Voucher (${row.REF_DOC_NO}) is active in General Ledger. Please cancel the JV in Journal Voucher screen first.`,
        });
        return;
      }
    }

    // 3. Fetch each asset's dprc_amount in this document to roll back MS_AC_ASSET
    const dprcLines = await conn.execute(
      `SELECT ASSET_ID, DPRC_AMOUNT 
       FROM TR_AC_ASSET_DPRCREGISTER 
       WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'ADP' AND DOC_NO = :dn`,
      { cc: companyCode, dn: numDocNo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    for (const line of (dprcLines.rows || []) as any[]) {
      const assetId = line.ASSET_ID;
      const amt = Number(line.DPRC_AMOUNT || 0);
      if (assetId && amt > 0) {
        // Find previous last_dprc_date before this doc_no
        const prevDateRes = await conn.execute(
          `SELECT MAX(DOC_DATE) AS PREV_DATE 
           FROM TR_AC_ASSET_DPRCREGISTER 
           WHERE COMPANY_CODE = :cc AND ASSET_ID = :aid AND DOC_NO < :dn`,
          { cc: companyCode, aid: assetId, dn: numDocNo },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const prevDate = (prevDateRes.rows?.[0] as any)?.PREV_DATE || null;

        await conn.execute(
          `UPDATE MS_AC_ASSET 
           SET WD_VALUE = WD_VALUE + :amt, 
               ACCUDPRC_AMOUNT = GREATEST(0, NVL(ACCUDPRC_AMOUNT, 0) - :amt), 
               YTD_DPRCN = GREATEST(0, NVL(YTD_DPRCN, 0) - :amt),
               LAST_DPRC_DATE = :pdate
           WHERE COMPANY_CODE = :cc AND ASSET_ID = :aid`,
          { amt: amt, pdate: prevDate, cc: companyCode, aid: assetId }
        );
      }
    }

    // 4. Delete the register records
    await conn.execute(
      `DELETE FROM TR_AC_ASSET_DPRCREGISTER 
       WHERE COMPANY_CODE = :cc AND DOC_TYPE = 'ADP' AND DOC_NO = :dn`,
      { cc: companyCode, dn: numDocNo }
    );

    await conn.commit();

    res.json({
      success: true,
      message: `Depreciation document ${numDocNo} has been successfully deleted and asset values restored. You can now re-calculate depreciation fresh.`,
    });
  } catch (err: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    console.error("Error in deleteAssetDepreciation:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to delete asset depreciation" });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {}
    }
  }
};
