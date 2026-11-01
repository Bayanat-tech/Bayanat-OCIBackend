import { Request, Response } from "express";
import { getConn } from "../../res/oracleDbConnect";
import { execDynamicProc } from "../../res/helperFunction";
import {
  buildFreightInvoiceHtmlAMKSA,
  buildFreightInvoiceHtmlBTIND,
  buildFreightInvoiceHtmlMHDL,
  FreightInvoiceMeta,
  FreightInvoiceRow,
} from "./freightInvoiceRenderHtml";

const templateBuilders: Record<string, (rows: FreightInvoiceRow[], meta: FreightInvoiceMeta) => string> = {
  AMKSA: buildFreightInvoiceHtmlAMKSA,
  BTIND: buildFreightInvoiceHtmlBTIND,
  MHDL: buildFreightInvoiceHtmlMHDL,
  BSG: buildFreightInvoiceHtmlMHDL,
};

export const frtInvoiceReportHtml = async (req: Request, res: Response): Promise<void> => {
    const {
    prin_code,
    invoice_no,
    company_code,
    invoice_date,
    invoice_period,
    client_name,
    client_address,
    client_vat_no,
    report_type,
  } = req.query as Record<string, string | undefined>;

  if (!company_code || !prin_code || !invoice_no) {
    res.status(400).send("<h3>Company, principal, and invoice number are required.</h3>");
    return;
  }

  let connection: any;
  try {
    connection = await getConn(req);
    const oracledb = await import("oracledb");
    const outFormat = (oracledb as any).default?.OUT_FORMAT_OBJECT || (oracledb as any).OUT_FORMAT_OBJECT || 4002;

    let rawRows: FreightInvoiceRow[] = [];
    try {
      rawRows = await execDynamicProc<FreightInvoiceRow>(
        connection,
        "PROC_BUILD_DYNAMIC_FRT_INVOICE",
        {
          parameter: "FREIGHT_INVOICE",
          code1: company_code,
          code2: prin_code,
          code3: invoice_no,
        }
      );
    } catch (procErr) {
      console.warn("PROC_BUILD_DYNAMIC_FRT_INVOICE fallback:", procErr);
    }

    // Direct fallback from TN_INVOICE and TN_INVOICE_DET if procedure returned no rows
    if (!rawRows || rawRows.length === 0) {
      const directSql = `
        SELECT 
          h.company_code, h.prin_code, nvl(mp.prin_name, mc.cust_name) as client_name,
          nvl(mp.prin_addr1, mc.cust_addr1) as prin_addr1,
          nvl(mp.prin_addr2, mc.cust_addr2) as prin_addr2,
          nvl(mp.prin_addr3, mc.cust_addr3) as prin_addr3,
          nvl(mp.prin_addr4, mc.cust_addr4) as prin_addr4,
          nvl(mp.prin_city, mc.cust_city) as prin_city,
          nvl(mp.prin_telno1, mc.cust_telno1) as prin_telno1,
          nvl(mp.prin_faxno1, mc.cust_faxno1) as prin_faxno1,
          nvl(mp.prin_email1, mc.cust_email1) as prin_email1,
          nvl(mp.trn_no, mc.vat_no) as prin_trn_no,
          h.invoice_no, nvl(h.invno_prefixed, h.invoice_no) as invno_prefixed,
          h.invoice_date, h.from_date, h.to_date, h.curr_code, h.inv_amount,
          h.creditdays, h.salesman_code, h.remarks as onl_remrks, h.div_code,
          d.srno, d.act_code, nvl(d.inv_desc, ma.activity) as inv_desc,
          ma.activity, mag.act_group_name, mag.activity_group_code,
          nvl(d.quantity, 1) as quantity, d.bill_rate, d.bill,
          d.tx_compnt_perc_1, d.tx_compnt_amt_1, d.job_no
        FROM TN_INVOICE h
        INNER JOIN TN_INVOICE_DET d 
          ON d.company_code = h.company_code 
         AND (
           (h.inv_type = 'C' AND d.consolidated_invno = h.invoice_no)
           OR (nvl(h.inv_type, 'N') <> 'C' AND d.invoice_no = h.invoice_no)
           OR (NOT EXISTS (SELECT 1 FROM TN_INVOICE_DET d2 WHERE d2.company_code = h.company_code AND d2.consolidated_invno = h.invoice_no) AND d.invoice_no = h.invoice_no)
         )
        LEFT JOIN MS_PRINCIPAL mp 
          ON mp.company_code = h.company_code AND mp.prin_code = h.prin_code
        LEFT JOIN MS_CUSTOMER mc
          ON mc.company_code = h.company_code AND mc.cust_code = h.prin_code
        LEFT JOIN MS_ACTIVITY ma 
          ON ma.company_code = d.company_code AND ma.activity_code = d.act_code
        LEFT JOIN MS_ACTIVITY_GROUP mag 
          ON mag.company_code = ma.company_code AND mag.activity_group_code = ma.activity_group_code
        WHERE h.company_code = :company_code 
          AND (h.invoice_no = :invoice_no OR h.invno_prefixed = :invoice_no)
          AND nvl(d.cancelled, 'N') = 'N'
        ORDER BY NVL2(d.job_no, 0, 1), d.srno
      `;
      try {
        const directRes = await connection.execute(directSql, { company_code, invoice_no }, { outFormat });
        if (directRes.rows && directRes.rows.length > 0) {
          rawRows = directRes.rows.map((r: any) => ({
            ...r,
            prin_code: r.PRIN_CODE || r.prin_code,
            client_name: r.CLIENT_NAME || r.client_name,
            company_code: r.COMPANY_CODE || r.company_code,
            invoice_no: r.INVOICE_NO || r.invoice_no,
            invno_prefixed: r.INVNO_PREFIXED || r.invno_prefixed,
            invoice_date: r.INVOICE_DATE || r.invoice_date,
            from_date: r.FROM_DATE || r.from_date,
            to_date: r.TO_DATE || r.to_date,
            curr_code: r.CURR_CODE || r.curr_code,
            inv_amount: r.INV_AMOUNT || r.inv_amount,
            creditdays: r.CREDITDAYS || r.creditdays,
            salesman_code: r.SALESMAN_CODE || r.salesman_code,
            onl_remrks: r.ONL_REMRKS || r.onl_remrks,
            div_code: r.DIV_CODE || r.div_code,
            srno: r.SRNO || r.srno,
            act_code: r.ACT_CODE || r.act_code,
            inv_desc: r.INV_DESC || r.inv_desc,
            activity: r.ACTIVITY || r.activity,
            act_group_name: r.ACT_GROUP_NAME || r.act_group_name,
            activity_group_code: r.ACTIVITY_GROUP_CODE || r.activity_group_code,
            quantity: r.QUANTITY || r.quantity,
            bill_rate: r.BILL_RATE || r.bill_rate,
            bill: r.BILL || r.bill,
            tx_compnt_perc_1: r.TX_COMPNT_PERC_1 || r.tx_compnt_perc_1,
            tx_compnt_amt_1: r.TX_COMPNT_AMT_1 || r.tx_compnt_amt_1,
            job_no: r.JOB_NO || r.job_no,
            prin_addr1: r.PRIN_ADDR1 || r.prin_addr1,
            prin_addr2: r.PRIN_ADDR2 || r.prin_addr2,
            prin_addr3: r.PRIN_ADDR3 || r.prin_addr3,
            prin_addr4: r.PRIN_ADDR4 || r.prin_addr4,
            prin_city: r.PRIN_CITY || r.prin_city,
            prin_telno1: r.PRIN_TELNO1 || r.prin_telno1,
            prin_faxno1: r.PRIN_FAXNO1 || r.prin_faxno1,
            prin_email1: r.PRIN_EMAIL1 || r.prin_email1,
            prin_trn_no: r.PRIN_TRN_NO || r.prin_trn_no,
          }));
        }
      } catch (directErr) {
        console.warn("Direct query fallback failed:", directErr);
      }
    }

    if (!rawRows || !rawRows.length) {
      res.status(404).send("<h3>No Freight invoice report data was found for the selected invoice.</h3>");
      return;
    }

    // 1. Query Division Info (Bank invoice details, division name, address, contact)
    let divisionInfo: any = null;
    const targetDivCode = rawRows[0]?.div_code || null;
    try {
      const divRes = await connection.execute(
        `SELECT 
           d.div_code, d.div_name, d.div_short_name, d.div_address1, d.div_address2, d.div_address3,
           d.phone, d.fax, d.email, d.trn_no as div_trn_no, d.comp_logo,
           d.bank_name_inv, d.bank_address_inv, d.ac_code_inv, d.reference_no_inv, d.swift_code_inv,
           d.ac_code_inv_usd, d.ref_no_inv_usd, d.swift_code_inv_usd
         FROM MS_HR_DIVISION d
         WHERE d.company_code = :company_code
           AND (d.div_code = :div_code OR :div_code IS NULL)
           AND ROWNUM = 1`,
        { company_code, div_code: targetDivCode },
        { outFormat }
      );
      if (divRes.rows && divRes.rows.length > 0) {
        divisionInfo = divRes.rows[0];
      }
    } catch (e) {
      console.warn("Could not query MS_HR_DIVISION:", e);
    }

    // 2. Query Official Company Info & MS_COMPANYINFO
    let companyInfo: any = null;
    try {
      const compRes = await connection.execute(
        `SELECT 
           c.company_name, c.company_logo, c.address1, c.address2, c.address3, c.city, c.country,
           c.contact_number,
           ci.trn_no as comp_trn_no, ci.tax_num as comp_tax_num, ci.email as comp_email, ci.tel_no as comp_tel,
           ci.bank_name, ci.ac_code, ci.reference_no, ci.swift_code, ci.bank_address, ci.logo_title, ci.company_short_name
         FROM MS_COMPANY c
         LEFT JOIN MS_COMPANYINFO ci ON ci.company_code = c.company_code
         WHERE c.company_code = :company_code AND ROWNUM = 1`,
        { company_code },
        { outFormat }
      );
      if (compRes.rows && compRes.rows.length > 0) {
        companyInfo = compRes.rows[0];
      }
    } catch (e) {
      console.warn("Could not query MS_COMPANY / MS_COMPANYINFO:", e);
    }

    // 3. Query Bank Accounts from MS_AC_BANKCODE
    let bankAccounts: any[] = [];
    try {
      const bankRes = await connection.execute(
        `SELECT b.ac_code, b.bank_ac_code, b.bank_address
         FROM MS_AC_BANKCODE b
         WHERE b.company_code = :company_code`,
        { company_code },
        { outFormat }
      );
      if (bankRes.rows && bankRes.rows.length > 0) {
        bankAccounts = bankRes.rows;
      }
    } catch (e) {
      console.warn("Could not query MS_AC_BANKCODE:", e);
    }

    // Deduplicate lines by (srno, act_code, desc)
    const seenLines = new Set<string>();
    const rows: FreightInvoiceRow[] = [];
    for (const r of rawRows) {
      const lineKey = `${r.srno ?? ""}|${r.act_code ?? ""}|${r.inv_desc ?? (r as any).activity ?? ""}`;
      if (!seenLines.has(lineKey)) {
        seenLines.add(lineKey);
        rows.push({
          ...r,
          company_name: companyInfo?.COMPANY_NAME || companyInfo?.company_name || r.company_name,
          company_logo: companyInfo?.COMPANY_LOGO || companyInfo?.company_logo || r.company_logo,
          div_name: divisionInfo?.DIV_NAME || divisionInfo?.div_name || r.div_name,
          div_short_name: divisionInfo?.DIV_SHORT_NAME || divisionInfo?.div_short_name || r.div_short_name,
          div_address1: divisionInfo?.DIV_ADDRESS1 || divisionInfo?.div_address1 || r.div_address1,
          div_address2: divisionInfo?.DIV_ADDRESS2 || divisionInfo?.div_address2 || r.div_address2,
          div_address3: divisionInfo?.DIV_ADDRESS3 || divisionInfo?.div_address3 || r.div_address3,
          phone: divisionInfo?.PHONE || divisionInfo?.phone || r.phone,
          fax: divisionInfo?.FAX || divisionInfo?.fax || r.fax,
          email: divisionInfo?.EMAIL || divisionInfo?.email || r.email,
          bank_name_inv: divisionInfo?.BANK_NAME_INV || divisionInfo?.bank_name_inv || r.bank_name_inv,
          bank_address_inv: divisionInfo?.BANK_ADDRESS_INV || divisionInfo?.bank_address_inv || r.bank_address_inv,
          ac_code_inv: divisionInfo?.AC_CODE_INV || divisionInfo?.ac_code_inv || r.ac_code_inv,
          reference_no_inv: divisionInfo?.REFERENCE_NO_INV || divisionInfo?.reference_no_inv || r.reference_no_inv,
          swift_code_inv: divisionInfo?.SWIFT_CODE_INV || divisionInfo?.swift_code_inv || r.swift_code_inv,
          comp_trn_no: divisionInfo?.DIV_TRN_NO || divisionInfo?.div_trn_no || companyInfo?.COMP_TRN_NO || companyInfo?.comp_trn_no || r.comp_trn_no,
        });
      }
    }

    const calculatedBase = rows.reduce((sum, r) => sum + (Number(r.bill) || 0), 0);
    const calculatedVat = rows.reduce((sum, r) => sum + (Number(r.tx_compnt_amt_1) || 0), 0);
    for (const r of rows) {
      r.inv_amount = calculatedBase;
      r.tot_vat_amt = calculatedVat;
    }

    // 1. Identify targetJobNo across rows and invoice details
    let targetJobNo = rows.find(r => r.job_no && String(r.job_no).trim())?.job_no || rawRows.find(r => r.job_no && String(r.job_no).trim())?.job_no || null;
    if (!targetJobNo) {
      try {
        const jFind = await connection.execute(
          `SELECT job_no FROM TN_INVOICE_DET 
           WHERE company_code = :company_code 
             AND (invoice_no = :invoice_no OR consolidated_invno = :invoice_no)
             AND job_no IS NOT NULL AND ROWNUM = 1`,
          { company_code, invoice_no },
          { outFormat }
        );
        if (jFind.rows && jFind.rows.length > 0) {
          targetJobNo = jFind.rows[0].JOB_NO || jFind.rows[0].job_no;
        }
      } catch (_) {}
    }

    if (targetJobNo) {
      for (const r of rows) {
        if (!r.job_no) r.job_no = targetJobNo;
      }
    }

    // Normalize divisionInfo
    if (divisionInfo) {
      const normDiv: any = {};
      for (const k of Object.keys(divisionInfo)) {
        normDiv[k.toLowerCase()] = divisionInfo[k];
        normDiv[k.toUpperCase()] = divisionInfo[k];
      }
      divisionInfo = normDiv;
    }

    // Normalize companyInfo
    if (companyInfo) {
      const normComp: any = {};
      for (const k of Object.keys(companyInfo)) {
        normComp[k.toLowerCase()] = companyInfo[k];
        normComp[k.toUpperCase()] = companyInfo[k];
      }
      companyInfo = normComp;
    }

    // Query shipment info from TI_JOB and TF_PACKLIST if job_no exists
    let shipmentInfo: any = null;
    if (targetJobNo) {
      try {
        const jobRes = await connection.execute(
          `SELECT 
             j.job_no, j.transport_mode, j.job_type, j.place_receipt, j.place_delivery,
             j.doc_ref, j.hawb, j.description1, j.vessel_name, j.voyage_no, j.confirm_date,
             p.no_of_packings, p.net_wt, p.gross_wt, p.volume, p.container_no,
             p.po_no, p.issue_date, p.bl_date, p.bl_no, p.prod_description,
             p.consignee_name, p.consignee_address, p.remarks as pack_remarks
           FROM TI_JOB j
           LEFT JOIN TF_PACKLIST p 
             ON p.company_code = j.company_code AND p.job_no = j.job_no
          WHERE j.company_code = :company_code AND j.job_no = :job_no AND ROWNUM = 1`,
          { company_code, job_no: targetJobNo },
          { outFormat }
        );
        if (jobRes.rows && jobRes.rows.length > 0) {
          const rawJob = jobRes.rows[0];
          shipmentInfo = {};
          for (const k of Object.keys(rawJob)) {
            shipmentInfo[k.toLowerCase()] = rawJob[k];
            shipmentInfo[k.toUpperCase()] = rawJob[k];
          }
        }
      } catch (err) {
        console.warn("Could not load supplementary shipment info:", err);
      }
    }

    const meta: FreightInvoiceMeta = {
      invoiceNo: invoice_no,
      invoiceDate: invoice_date,
      invoicePeriod: invoice_period,
      clientName: client_name,
      clientAddress: client_address,
      clientVatNo: client_vat_no,
      reportType: report_type,
      shipmentInfo,
      divisionInfo,
      companyInfo,
      bankAccounts,
    };

    const templateKey = company_code === "BTIND" ? "BTIND" : "MHDL";
    const buildHtml = templateBuilders[templateKey];
    const html = buildHtml(rows, meta);

    res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (error: any) {
    console.error("Freight invoice report error:", error);
    res.status(500).send(
      `<h3>Failed to generate Freight invoice report.</h3><p>${escapeHtml(
        error?.message || "Unknown error"
      )}</p>`
    );
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (_) {}
    }
  }
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

