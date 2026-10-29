import { normalizeAccountingSign, postingAmounts } from "./financePostingAmounts";
import { validateFinanceDocumentScope } from "./financeDocumentScope";
import { validateSavedPosting } from "./financePostingValidation";
import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { IUser } from '../../../../interfaces/user.interface';

const normalizeSignInd = normalizeAccountingSign;

const defaultDetailSign = (docType?: string): 1 | -1 =>
  docType === "PI" || docType === "PO" ? 1 : -1;

const defaultInvoiceSign = (docType?: string): 1 | -1 | undefined => {
  if (docType === "PI" || docType === "PO") return -1;
  if (docType === "SI" || docType === "SV") return 1;
  return undefined;
};

const oneChar = (value: unknown, fallback: string | null = null): string | null => {
  const source = value ?? fallback;
  if (source === null || source === undefined || source === "") return null;
  return String(source).substring(0, 1);
};

const normalizeUniqueSerials = <T extends Record<string, any>>(rows: T[] = [], fallbackDocNo = "0"): T[] => {
  const seen = new Set<number>();
  return rows.map((row, index) => {
    const rawSerial = Number(row?.serial_no ?? index + 1);
    let nextSerial = Number.isFinite(rawSerial) && rawSerial > 0 && !seen.has(rawSerial) ? rawSerial : index + 1;
    while (seen.has(nextSerial)) nextSerial = index + 1 + seen.size;
    seen.add(nextSerial);
    return {
      ...row,
      doc_no: row?.doc_no ?? fallbackDocNo,
      serial_no: nextSerial,
      dtl_sr_no: Number.isFinite(Number(row?.dtl_sr_no)) && Number(row?.dtl_sr_no) > 0 ? Number(row.dtl_sr_no) : index + 1,
    } as T;
  });
};

// Child rows share their parent's SERIAL_NO. Their unique key is the pair
// (SERIAL_NO, DTL_SR_NO), so never make SERIAL_NO unique across allocations.
export const normalizeChildSequences = <T extends Record<string, any>>(rows: T[] = [], fallbackDocNo = "0"): T[] => {
  const nextSequenceByParent = new Map<number, number>();
  return rows.map((row, index) => {
    const rawParentSerial = Number(row?.serial_no);
    const parentSerial = Number.isFinite(rawParentSerial) && rawParentSerial > 0
      ? rawParentSerial
      : index + 1;
    const nextSequence = (nextSequenceByParent.get(parentSerial) || 0) + 1;
    nextSequenceByParent.set(parentSerial, nextSequence);
    return {
      ...row,
      doc_no: row?.doc_no ?? fallbackDocNo,
      serial_no: parentSerial,
      dtl_sr_no: nextSequence,
    } as T;
  });
};

export const procBulkAccountEntry = async (
  req: Request,
  res: Response
): Promise<void> => {

  let connection: oracledb.Connection | undefined;

  try {
    const user = req.user as IUser;
    const header = req.body?.header;
    const details = req.body?.details || [];
    const invoiceDetail = req.body?.invoiceDetails || req.body?.invoiceDetail || [];
    const expenseDetail = req.body?.expenseDetails || req.body?.expenseDetail || [];
    const jobDetail = req.body?.jobDetails || req.body?.jobDetail || [];
    const loginid = user?.loginid;

    if (!header) {

      res.status(400).json({
        success: false,
        message: "Header required"
      });

      return;
    }

    validateFinanceDocumentScope(user?.company_code, header, [details, invoiceDetail, expenseDetail, jobDetail]);
    if (oneChar(header.canceled) === 'Y') {
      res.status(400).json({ success: false, message: 'Use the document cancellation action to cancel a voucher and release its allocations' });
      return;
    }
    const tenantId = getCurrentTenantId();

    if (!tenantId) {

      res.status(400).json({
        success: false,
        message: "Tenant not found"
      });

      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    if (header.doc_no && String(header.doc_no) !== '0') {
      const existing = await connection.execute<{ CANCELED: string }>(
        `SELECT canceled FROM TR_AC_HEADER
          WHERE company_code=:cc AND doc_type=:dt AND doc_no=:dn FOR UPDATE`,
        { cc: header.company_code, dt: header.doc_type, dn: String(header.doc_no) },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (existing.rows?.[0]?.CANCELED === 'Y') {
        res.status(400).json({ success: false, message: 'Cancelled vouchers cannot be edited or reactivated' });
        return;
      }
    }

   if (oneChar(header.canceled) !== 'Y' && header.doc_date) {
     // 1. Fetch current active financial period and accounting period lock rules
     const activeFyRes: any = await connection!.execute(
       `SELECT 
          v.ac_fy_period,
          p.date_from AS fy_date_from,
          p.date_to AS fy_date_to,
          s.financial_yr_start,
          s.financial_yr_end,
          s.doc_edit_from,
          s.doc_edit_to,
          s.doc_date_editable
        FROM VW_COMPANY_INFO v
        LEFT JOIN MS_FY_PERIOD p 
          ON p.company_code = v.company_code 
         AND p.fy_period = TO_CHAR(v.ac_fy_period)
        LEFT JOIN MS_AC_SETUP s
          ON s.company_code = v.company_code
        WHERE v.company_code = :cc`,
       { cc: header.company_code },
       { outFormat: oracledb.OUT_FORMAT_OBJECT }
     );

     const fyInfo = activeFyRes.rows?.[0] || {};
     const currentFy = String(fyInfo.AC_FY_PERIOD || '226');
     const fyFrom = fyInfo.FY_DATE_FROM ? new Date(fyInfo.FY_DATE_FROM).toISOString().slice(0, 10) : null;
     const fyTo = fyInfo.FY_DATE_TO ? new Date(fyInfo.FY_DATE_TO).toISOString().slice(0, 10) : null;
     const editFrom = fyInfo.DOC_EDIT_FROM ? new Date(fyInfo.DOC_EDIT_FROM).toISOString().slice(0, 10) : null;

     const docDateStr = String(header.doc_date).slice(0, 10);
     const isNewDoc = !header.doc_no || String(header.doc_no) === '0';

     // Rule 1: New transaction entry MUST be within the CURRENT active financial period
     if (isNewDoc && fyFrom && fyTo) {
       if (docDateStr < fyFrom || docDateStr > fyTo) {
         res.status(400).json({
           success: false,
           message: `Transaction entry is allowed only in current financial period ${currentFy} (${fyFrom} to ${fyTo}). Selected date ${docDateStr} is in an invalid financial period.`
         });
         return;
       }
     }

     // Rule 2: Period Lock & No provision for backdated entry into closed periods
     if (editFrom && docDateStr < editFrom) {
       res.status(400).json({
         success: false,
         message: `Account period is locked prior to ${editFrom}. Backdated entry is not allowed.`
       });
       return;
     }

     // Rule 3: Prevent moving existing document across financial periods
     if (!isNewDoc) {
       const oldRes: any = await connection!.execute(
         `SELECT TO_CHAR(DOC_DATE,'YYYY-MM-DD') AS D FROM TR_AC_HEADER
          WHERE COMPANY_CODE = :cc AND DOC_TYPE = :dt AND DOC_NO = :dn`,
         { cc: header.company_code, dt: header.doc_type, dn: String(header.doc_no) },
         { outFormat: oracledb.OUT_FORMAT_OBJECT }
       );
       const oldDate = oldRes.rows?.[0]?.D;
       if (oldDate && fyFrom && fyTo) {
         const oldDVal = String(oldDate).slice(0, 10);
         const oldInCurrent = oldDVal >= fyFrom && oldDVal <= fyTo;
         const newInCurrent = docDateStr >= fyFrom && docDateStr <= fyTo;
         if (oldInCurrent !== newInCurrent) {
           res.status(400).json({
             success: false,
             message: `Document Date cannot be moved across financial periods. Cancel this document and create a new one in the target period.`
           });
           return;
         }
       }
     }

     // PowerBuilder Rule (uo_ac_invoice.sru): Duplicate Supplier Invoice (Ref No) check for Purchase Invoices (PI)
     const docTypeForDup = String(header.doc_type || '').toUpperCase();
     const refNoForDup = String(header.ref_no || header.inv_no || header.invoice_no || '').trim();
     const acCodeForDup = String(header.ac_code || '').trim();
     const curDocNoForDup = String(header.doc_no || '0').trim();

     if (docTypeForDup === 'PI' && refNoForDup && acCodeForDup && oneChar(header.canceled) !== 'Y') {
       const dupCheckRes: any = await connection!.execute(
         `SELECT doc_no, doc_date 
          FROM TR_AC_HEADER 
          WHERE company_code = :cc
            AND doc_type = 'PI'
            AND ac_code = :ac
            AND UPPER(TRIM(ref_no)) = UPPER(:ref_no)
            AND NVL(canceled, 'N') <> 'Y'
            AND (:cur_doc_no IS NULL OR :cur_doc_no = '0' OR TO_CHAR(doc_no) <> :cur_doc_no)
            AND ROWNUM = 1`,
         {
           cc: header.company_code,
           ac: acCodeForDup,
           ref_no: refNoForDup,
           cur_doc_no: curDocNoForDup,
         },
         { outFormat: oracledb.OUT_FORMAT_OBJECT }
       );

       if (dupCheckRes.rows && dupCheckRes.rows.length > 0) {
         const existing = dupCheckRes.rows[0];
         res.status(400).json({
           success: false,
           message: `Supplier Invoice # "${refNoForDup}" already exists for this vendor in Purchase Invoice (${existing.DOC_NO || existing.doc_no}). Duplicate invoice numbers are not allowed.`,
         });
         return;
       }
     }

     // PowerBuilder Rule (uo_ac_invoice.sru): Duplicate Ref No / LPO No check for Sales & Service Invoices (SI, SV)
     if (['SI', 'SV'].includes(docTypeForDup) && acCodeForDup && oneChar(header.canceled) !== 'Y') {
       if (refNoForDup) {
         const dupRefRes: any = await connection!.execute(
           `SELECT doc_no, doc_date 
            FROM TR_AC_HEADER 
            WHERE company_code = :cc
              AND doc_type IN ('SI', 'SV')
              AND ac_code = :ac
              AND UPPER(TRIM(ref_no)) = UPPER(:ref_no)
              AND NVL(canceled, 'N') <> 'Y'
              AND (:cur_doc_no IS NULL OR :cur_doc_no = '0' OR TO_CHAR(doc_no) <> :cur_doc_no)
              AND ROWNUM = 1`,
           {
             cc: header.company_code,
             ac: acCodeForDup,
             ref_no: refNoForDup,
             cur_doc_no: curDocNoForDup,
           },
           { outFormat: oracledb.OUT_FORMAT_OBJECT }
         );

         if (dupRefRes.rows && dupRefRes.rows.length > 0) {
           const existing = dupRefRes.rows[0];
           res.status(400).json({
             success: false,
             message: `Customer Invoice / Reference # "${refNoForDup}" already exists for this customer in Invoice (${existing.DOC_NO || existing.doc_no}). Duplicate invoice references are not allowed.`,
           });
           return;
         }
       }

       const lpoNoForDup = String(header.lpo_no || '').trim();
       if (lpoNoForDup) {
         const dupLpoRes: any = await connection!.execute(
           `SELECT doc_no, doc_date 
            FROM TR_AC_HEADER 
            WHERE company_code = :cc
              AND doc_type IN ('SI', 'SV')
              AND ac_code = :ac
              AND UPPER(TRIM(lpo_no)) = UPPER(:lpo_no)
              AND NVL(canceled, 'N') <> 'Y'
              AND (:cur_doc_no IS NULL OR :cur_doc_no = '0' OR TO_CHAR(doc_no) <> :cur_doc_no)
              AND ROWNUM = 1`,
           {
             cc: header.company_code,
             ac: acCodeForDup,
             lpo_no: lpoNoForDup,
             cur_doc_no: curDocNoForDup,
           },
           { outFormat: oracledb.OUT_FORMAT_OBJECT }
         );

         if (dupLpoRes.rows && dupLpoRes.rows.length > 0) {
           const existing = dupLpoRes.rows[0];
           res.status(400).json({
             success: false,
             message: `Customer LPO # "${lpoNoForDup}" has already been billed in Invoice (${existing.DOC_NO || existing.doc_no}). Duplicate LPO references are not allowed.`,
           });
           return;
         }
       }
     }

     // Rule 4: Block duplicate purchase booking on Freight Jobs (PI / Purchase Invoices)
     // PowerBuilder ERP allows separate Purchase Invoices for Agent Cost vs Transporter Cost vs Other Cost.
     // Duplicate check must match (job_no + cost_type + act_code) so Agent and Transporter can be booked separately.
     if (String(header.doc_type || '').toUpperCase() === 'PI' && Array.isArray(details)) {
       const freightLines = details.filter((d: any) => Boolean(d.job_no && String(d.job_no).trim()));
       const jobNos = Array.from(new Set(freightLines.map((d: any) => String(d.job_no).trim())));

       for (const jNo of jobNos) {
         const checkBooked: any = await connection!.execute(
           `SELECT h.doc_no, d.remarks, d.amount, d.lcur_amount
            FROM TR_AC_DETAIL d
            JOIN TR_AC_HEADER h
              ON h.company_code = d.company_code
             AND h.doc_type = d.doc_type
             AND h.doc_no = d.doc_no
             AND NVL(h.canceled, 'N') = 'N'
            WHERE h.company_code = :cc
              AND h.doc_type = 'PI'
              AND d.job_no = :job_no
              AND d.serial_no < 9000
              AND (:cur_doc_no IS NULL OR :cur_doc_no = '0' OR h.doc_no <> :cur_doc_no)`,
           {
             cc: header.company_code,
             job_no: String(jNo),
             cur_doc_no: String(header.doc_no || '0'),
           },
           { outFormat: oracledb.OUT_FORMAT_OBJECT }
         );

         const bookedRows: any[] = checkBooked.rows || [];
         if (bookedRows.length > 0) {
           const getCostType = (text: string) => {
             const t = text.toUpperCase();
             if (t.includes('AGENT') || t.includes('BROKER')) return 'AGENT';
             if (t.includes('TRANS')) return 'TRANS';
             if (t.includes('OTHER') || t.includes('ACTUAL')) return 'OTHER';
             return 'UNKNOWN';
           };

           const getActCode = (text: string) => {
             const m = text.match(/^([A-Z0-9_-]+)/i);
             return m ? m[1].toUpperCase() : '';
           };

           for (const incomingLine of freightLines.filter((l: any) => String(l.job_no).trim() === jNo)) {
             const incRem = String(incomingLine.remarks || '');
             const incType = getCostType(incRem);
             const incAct = getActCode(incRem);
             const incAmt = Math.abs(Number(incomingLine.amount || 0));

             const matchedDuplicate = bookedRows.find((booked: any) => {
               const bRem = String(booked.REMARKS || '');
               const bType = getCostType(bRem);
               const bAct = getActCode(bRem);
               const bAmt = Math.abs(Number(booked.AMOUNT || 0));

               // Match by cost type + activity code
               if (incType !== 'UNKNOWN' && bType !== 'UNKNOWN') {
                 if (incType === bType) {
                   if (incAct && bAct && incAct === bAct) return true;
                   if (Math.abs(incAmt - bAmt) < 0.001) return true;
                 }
                 return false;
               }

               // Fallback if cost type unknown: match activity code & amount
               if (incAct && bAct && incAct === bAct && Math.abs(incAmt - bAmt) < 0.001) {
                 return true;
               }
               return false;
             });

             if (matchedDuplicate) {
               const bookedDoc = matchedDuplicate.DOC_NO;
               res.status(400).json({
                 success: false,
                 message: `Job ${jNo} activity line [${incAct || incRem}] (${incType}) has already been booked in Purchase Invoice (${bookedDoc}). Duplicate purchase booking for the same cost item is completely blocked.`
               });
               return;
             }
           }
         }
       }
     }
   }

    const safeDetails = normalizeUniqueSerials(details, String(header.doc_no || "0"));
    const safeInvoiceDetail = normalizeChildSequences(invoiceDetail, String(header.doc_no || "0"));
    const safeExpenseDetail = normalizeChildSequences(expenseDetail, String(header.doc_no || "0"));
    const safeJobDetail = normalizeChildSequences(jobDetail, String(header.doc_no || "0"));

    console.log("========================>", header.doc_no);
    console.log("invoiceDetail raw:", invoiceDetail);
    console.log("invoiceDetail length:", invoiceDetail?.length);
    if (header.doc_no == 0) {
      header.doc_no = '0'
    }
    console.log("Header doc_no after check:", header.inv_no);

    // Accounting validation: For commercial invoices, verify settled payments before updating
    if (header.doc_no && String(header.doc_no) !== '0' && ['PI', 'PO', 'SI', 'SV'].includes(String(header.doc_type || '').toUpperCase())) {
      const existingRes = await connection.execute(
        `SELECT h.ac_code, NVL(h.canceled, 'N') AS canceled,
           NVL((
             SELECT SUM(ABS(d.lcur_amount))
             FROM TR_AC_INVDETAIL d
             JOIN TR_AC_HEADER pay_h
               ON pay_h.company_code = d.company_code
              AND pay_h.doc_no       = d.doc_no
              AND pay_h.doc_type     = d.doc_type
              AND NVL(pay_h.canceled, 'N') = 'N'
             WHERE d.company_code = h.company_code
               AND (d.ac_code = h.ac_code OR pay_h.ac_code = h.ac_code)
               AND (
                 (h.doc_type IN ('PI', 'PO') AND pay_h.doc_type IN ('BP', 'CP', 'PJV', 'DN', 'JV', 'UJV', 'CN'))
                 OR (h.doc_type IN ('SI', 'SV', 'IV') AND pay_h.doc_type IN ('BR', 'CR', 'RJV', 'CN', 'JV', 'UJV', 'DN'))
                 OR (h.doc_type NOT IN ('PI', 'PO', 'SI', 'SV', 'IV'))
               )
               AND (d.inv_no = h.doc_no OR (h.ref_no IS NOT NULL AND d.inv_no = h.ref_no))
               AND NVL(d.indicator_origin, 'N') = 'N'
               AND NVL(d.lcur_amount, 0) <> 0
           ), 0) AS paid_amount
         FROM TR_AC_HEADER h
         WHERE h.company_code = :cc
           AND h.doc_no       = :dn
           AND h.doc_type     = :dt`,
        {
          cc: header.company_code,
          dn: String(header.doc_no),
          dt: String(header.doc_type).toUpperCase(),
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const existingRow = (existingRes.rows?.[0] as any);
      if (existingRow) {
        const settledPaid = Number(existingRow.PAID_AMOUNT || 0);
        if (settledPaid > 0.0001) {
          // 1. Prevent cancelling invoice when payments exist
          if (oneChar(header.canceled) === 'Y') {
            try { await connection.close(); } catch {}
            res.status(400).json({
              success: false,
              message: `Cannot cancel invoice ${header.doc_no}. Active payments totaling ${settledPaid.toFixed(3)} have already been settled against this invoice. Please unallocate or cancel the payment vouchers first.`,
            });
            return;
          }

          // 2. Prevent changing the party account when payments exist
          if (header.ac_code && existingRow.AC_CODE && String(header.ac_code).trim() !== String(existingRow.AC_CODE).trim()) {
            try { await connection.close(); } catch {}
            res.status(400).json({
              success: false,
              message: `Cannot change party account on invoice ${header.doc_no}. Active payments totaling ${settledPaid.toFixed(3)} have already been settled against this invoice.`,
            });
            return;
          }

          // 3. Prevent reducing the invoice net amount below settled payments
          const line9001 = safeDetails.find((d: any) => Number(d.serial_no) === 9001);
          const newInvoiceTotal = line9001
            ? Math.abs(Number(line9001.lcur_amount ?? line9001.amount ?? 0))
            : safeDetails.filter((d: any) => Number(d.serial_no) !== 9001).reduce((sum: number, d: any) => sum + Math.abs(Number(d.lcur_amount ?? d.amount ?? 0)), 0);

          if (newInvoiceTotal > 0 && newInvoiceTotal < settledPaid - 0.001) {
            try { await connection.close(); } catch {}
            res.status(400).json({
              success: false,
              message: `Invoice total (${newInvoiceTotal.toFixed(3)}) cannot be less than already settled payments (${settledPaid.toFixed(3)}). Please adjust the payment vouchers or issue a debit/credit note first.`,
            });
            return;
          }
        }
      }
    }

    const result = await connection.execute(
      `
      BEGIN
        PROC_BULK_ACCOUNT_ENTRY(
          :p_header,
          :p_detail,
          :p_invdetail,
          :p_expdetail,
          :p_jobdetail,
          :p_gst_lines_json
        );
      END;
      `,
      {
        p_gst_lines_json: { type: oracledb.CLOB, val: JSON.stringify(header.gst_lines || []) },
        p_header: {
          type: "TY_TR_AC_HEADER_ACENTRY_TAB",
          dir: oracledb.BIND_INOUT,
          val: [
            {
              COMPANY_CODE: header.company_code,
              DOC_TYPE: header.doc_type,
              DOC_NO: header.doc_no || '0',
              DOC_DATE: header.doc_date ? new Date(header.doc_date) : null,
              AC_CODE: header.ac_code,
              AC_PAYEE: header.ac_payee,
              BANK_AC_CODE: header.bank_ac_code,
              REMARKS: header.remarks,
              CURR_CODE: header.curr_code,
              EX_RATE: header.ex_rate,
              CHEQUE_NO: header.cheque_no,
              CHEQUE_DATE: header.cheque_date
                ? new Date(header.cheque_date)
                : null,
              CANCELED: oneChar(header.canceled),
              CREATE_USER: header.create_user || loginid,
              EDIT_USER: header.edit_user || loginid,
              CREATE_DATE: header.create_date
                ? new Date(header.create_date)
                : null,
              EDIT_DATE: header.edit_date
                ? new Date(header.edit_date)
                : null,
              LAST_DTL_SERIAL_NO: header.last_dtl_serial_no,
              AUTO_REVERSE: oneChar(header.auto_reverse),
              DIV_CODE: header.div_code,
              SYS_GEN: oneChar(header.sys_gen),
              TX_COMPNTCAT_CODE_2: header.tx_compntcat_code_2,
              TX_COMPNTCAT_CODE_3: header.tx_compntcat_code_3,
              TX_COMPNTCAT_CODE_4: header.tx_compntcat_code_4,
              TX_COMPNT_1_EXPMT: oneChar(header.tx_compnt_1_expmt),
              TX_TAX_FILED: oneChar(header.tx_tax_filed),
              TX_COMPNT_HDISC_AMT_1: header.tx_compnt_hdisc_amt_1,
              PDO_TYPE: oneChar(header.pdo_type, "N"),
              CREATED_BY: user.loginid,
              UPDATED_BY: user.loginid,
              INV_NO: header.inv_no || header.invoice_no || null,
              INV_DATE: header.inv_date || header.invoice_date
                ? new Date(header.inv_date || header.invoice_date)
                : null,
              REF_NO: header.ref_no || header.inv_no || header.invoice_no || null,
              REF_DATE: header.ref_date || header.inv_date || header.invoice_date
                ? new Date(header.ref_date || header.inv_date || header.invoice_date)
                : null,
              REF_DOC_NO: header.ref_doc_no || null,
              PARTY_NAME: header.party_name || header.ac_name || null,
              PARTY_ADDRESS: header.party_address || null,
              PARTY_PHONE: header.party_phone || null,
              PARTY_FAX: header.party_fax || null,
              PAYMENT_TERMS: header.payment_terms || null,
              TX_CAT_CODE: header.tx_cat_code || null,
              TX_COMPNTCAT_CODE_1: header.tx_compntcat_code_1 || null,
              TX_COMPNT_PERC_1: header.tx_compnt_perc_1 ?? null,
              SALESMAN_CODE: header.salesman_code || null,
              SECTOR_CODE: header.sector_code || null,
              DLVR_CONTACT: header.dlvr_contact || null,
              DLVR_EMAIL: header.dlvr_email || null,
              DLVR_MOBILE: header.dlvr_mobile || null,
              DLVR_TERM: header.dlvr_term || null,
              DELIVERY_TO: header.delivery_to || null,
              APP_REF_NO: header.app_ref_no || null,
            }
          ]
        },

        p_detail: {
          type: "TY_TR_AC_DETAIL_ACENTRY_TAB",
          val: safeDetails.map((d: any) => ({
            COMPANY_CODE: d.company_code || header.company_code || user?.company_code,
            DOC_TYPE: d.doc_type || header.doc_type,
            DOC_NO: d.doc_no || '0',
            SERIAL_NO: d.serial_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : (header.doc_date ? new Date(header.doc_date) : null),
            AC_CODE: d.ac_code,
            JOB_NO: d.job_no || null,
            DEPT_CODE: d.dept_code || null,
            HEADER_AC_CODE: d.header_ac_code,
            REMARKS: d.remarks || null,
            AMOUNT: Math.abs(Number(d.amount) || 0),
            SIGN_IND: normalizeSignInd(d.sign_ind, defaultDetailSign(d.doc_type || header.doc_type)),
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            LCUR_AMOUNT: Math.abs(Number(d.lcur_amount !== undefined && d.lcur_amount !== null ? d.lcur_amount : d.amount) || 0),
            PDC_IND: oneChar(d.pdc_ind),
            CHEQUE_NO: d.cheque_no,
            CHEQUE_DATE: d.cheque_date
              ? new Date(d.cheque_date)
              : null,
            CANCELLED: oneChar(d.canceled ?? d.cancelled),
            RECON_IND: oneChar(d.recon_ind),
            DIV_CODE: d.div_code,
            TX_CAT_CODE: d.tx_cat_code,
            TX_COMPNTCAT_CODE_1: d.tx_compntcat_code_1,
            TX_COMPNTCAT_CODE_2: d.tx_compntcat_code_2,
            TX_COMPNTCAT_CODE_3: d.tx_compntcat_code_3,
            TX_COMPNTCAT_CODE_4: d.tx_compntcat_code_4,
            TX_COMPNT_PERC_1: d.tx_compnt_perc_1,
            TX_COMPNT_PERC_2: d.tx_compnt_perc_2,
            TX_COMPNT_PERC_3: d.tx_compnt_perc_3,
            TX_COMPNT_PERC_4: d.tx_compnt_perc_4,
            TX_COMPNT_AMT_1: d.tx_compnt_amt_1,
            TX_COMPNT_AMT_2: d.tx_compnt_amt_2,
            TX_COMPNT_AMT_3: d.tx_compnt_amt_3,
            TX_COMPNT_AMT_4: d.tx_compnt_amt_4,
            TX_COMPNT_LCURAMT_1: d.tx_compnt_lcuramt_1,
            TX_COMPNT_LCURAMT_2: d.tx_compnt_lcuramt_2,
            TX_COMPNT_LCURAMT_3: d.tx_compnt_lcuramt_3,
            TX_COMPNT_LCURAMT_4: d.tx_compnt_lcuramt_4,
            TX_COMPNT_1_EXPMT: oneChar(d.tx_compnt_1_expmt),
            TX_COMPNT_2_EXPMT: oneChar(d.tx_compnt_2_exmpt ?? d.tx_compnt_2_expmt),
            TX_COMPNT_3_EXPMT: oneChar(d.tx_compnt_3_exmpt ?? d.tx_compnt_3_expmt),
            TX_COMPNT_4_EXPMT: oneChar(d.tx_compnt_4_exmpt ?? d.tx_compnt_4_expmt),
            TX_TAX_FILED: oneChar(d.tx_tax_filed),
            TX_COMPNT_HDISC_AMT_1: d.tx_compnt_hdisc_amt_1,
            QTY: d.qty,
            PRICE: d.price,
            SIGN_CODE: d.sign_code,
            ...postingAmounts(d, header),
          }))
        },

        p_invdetail: {
          type: "TY_TR_AC_INVDETAIL_ACENTRY_TAB",
          val: safeInvoiceDetail.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no || '0',
            SERIAL_NO: d.serial_no,
            DTL_SR_NO: d.dtl_sr_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
            AC_CODE: d.ac_code,
            INV_NO: d.inv_no,
            INV_DATE: d.inv_date ? new Date(d.inv_date) : (header.inv_date ? new Date(header.inv_date) : null),
            AMOUNT: d.amount,
            LCUR_AMOUNT: d.lcur_amount,
            SIGN_IND: defaultInvoiceSign(d.doc_type || header.doc_type) ?? normalizeSignInd(d.sign_ind, defaultDetailSign(d.doc_type || header.doc_type)),
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            EX_RATE_ORIGIN: d.ex_rate_origin,
            CURR_CODE_ORIGIN: d.curr_code_origin,
            INDICATOR_ORIGIN: oneChar(
              d.indicator_origin,
              (header.doc_type === 'SI' || header.doc_type === 'PI' || header.doc_type === 'SV' || header.doc_type === 'PO') ? 'Y' : 'N'
            ),
            DIV_CODE: d.div_code
          }))
        },

        p_expdetail: {
          type: "TY_TR_AC_EXPDETAIL_ACENTRY_TAB",
          val: safeExpenseDetail.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no || '0',
            SERIAL_NO: d.serial_no,
            DTL_SR_NO: d.dtl_sr_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
            AC_CODE: d.ac_code,
            EXP_TYPE_CODE: d.exp_type_code,
            EXP_SUBTYPE_CODE: d.exp_subtype_code,
            EXP_CODE: d.exp_code,
            AMOUNT: d.amount,
            SIGN_IND: normalizeSignInd(d.sign_ind, defaultDetailSign(d.doc_type || header.doc_type)),
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            DIV_CODE: d.div_code
          }))
        },

        p_jobdetail: {
          type: "TY_TR_AC_JOBDETAIL_ACENTRY_TAB",
          val: safeJobDetail.map((d: any) => ({
            COMPANY_CODE: d.company_code,
            DOC_TYPE: d.doc_type,
            DOC_NO: d.doc_no || '0',
            SERIAL_NO: d.serial_no,
            DTL_SR_NO: d.dtl_sr_no,
            DOC_DATE: d.doc_date ? new Date(d.doc_date) : null,
            AC_CODE: d.ac_code,
            JOB_NO: d.job_no,
            DOC_REFNO: d.doc_refno,
            DOC_REFNO_2: d.doc_refno_2,
            AMOUNT: d.amount,
            SIGN_IND: normalizeSignInd(d.sign_ind, defaultDetailSign(d.doc_type || header.doc_type)),
            LCUR_AMOUNT: d.lcur_amount,
            CURR_CODE: d.curr_code,
            EX_RATE: d.ex_rate,
            DIV_CODE: d.div_code
          }))
        }
      },
      {
        autoCommit: false
      }
    );

    const outHeader = (result.outBinds as any)?.p_header?.[0];
    const generatedDocNo = outHeader?.DOC_NO || header.doc_no;
    if (oneChar(header.canceled) !== 'Y') {
      await validateSavedPosting(connection, header.company_code, header.doc_type, String(generatedDocNo));
    }
    await connection.commit();
    if (generatedDocNo && generatedDocNo !== '0' && ['SI', 'PI', 'SV', 'PO'].includes(header.doc_type)) {
      try {
        await connection.execute(
          `BEGIN PROC_FIX_INVDETAIL_SELF_INV(:p_company_code, :p_doc_no, :p_status, :p_message); END;`,
          {
            p_company_code: header.company_code,
            p_doc_no: generatedDocNo,
            p_status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
            p_message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
          }
        );
        await connection.commit();
      } catch (uErr) {
        console.warn('[procBulkAccountEntry] Could not update TR_AC_INVDETAIL.INV_NO:', uErr);
      }
    }

    res.json({
      success: true,
      message: "Account Entry saved successfully",
      doc_no: generatedDocNo,
      data: {
        ...(result.outBinds as any),
        doc_no: generatedDocNo,
      }
    });

  } catch (err: any) {

    if (connection) {
      try {
        await connection.rollback();
      } catch { }
    }

    const businessError = err.status || (Number(err.errorNum) >= 20000 && Number(err.errorNum) <= 20999);
    res.status(err.status || (businessError ? 400 : 500)).json({
      success: false,
      message: businessError ? String(err.message).split('\n')[0].replace(/^ORA-\d+:\s*/, '') : "Transaction failed",
      details: err?.message
    });

  } finally {

    if (connection) {
      try {
        await connection.close();
      } catch { }
    }

  }
};
