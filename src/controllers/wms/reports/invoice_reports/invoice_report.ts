import { Request, Response } from "express";
import { getConn } from "../../../../res/oracleDbConnect";
import { execDynamicProc } from "../../../../res/helperFunction";
import { executeRawSql } from "../../../wms.controller";
import {
  buildInvoiceHtmlAMKSA,
  buildInvoiceHtmlBTIND,
  InvoiceMeta,
  InvoiceRow,
  normalizeOracleInvoiceRows,   // <-- NEW
} from "./render_html";
import {
  encryptInvoiceToken,
  decryptInvoiceToken,
  generateInvoiceQrDataUrl,
} from "./qrToken";
import { getStampDataUrl } from "./stampImage";
import { getMonthPeriodLabel } from "./dateRange";
import oracledb from "oracledb";

const BASE_URL = process.env.BACKEND_URL || "https://yourdomain.com";

const report = {
  AMKSA: { parameter: "INVOICE_AMKSA", template: "AMKSA" },
  BTIND: { parameter: "INVOICE_AMKSA", template: "BTIND" },
};

const templateBuilders: Record<string, (rows: InvoiceRow[], meta: InvoiceMeta) => string> = {
  AMKSA: buildInvoiceHtmlAMKSA,
  BTIND: buildInvoiceHtmlBTIND,
};


/* ------------------------------------------------------------------ */
/*  Sorting helpers: highest amount first                             */
/* ------------------------------------------------------------------ */

/** Mirrors getBillAmount() in render_html.ts — prefers FC_BILL over BILL. */
function getRowAmount(r: InvoiceRow): number {
  const fc = (r as any).fc_bill;
  if (fc !== null && fc !== undefined && String(fc).trim() !== "") {
    const n = Number(fc);
    if (!Number.isNaN(n)) return n;
  }
  return Number((r as any).bill ?? 0);
}

/**
 * Keep rows that share the same SRNO together (the templates group by SRNO),
 * then sort those groups by their summed amount descending.
 */
function sortRowsByAmountDesc(rows: InvoiceRow[]): InvoiceRow[] {
  const groups = new Map<string, InvoiceRow[]>();
  const order: string[] = [];

  for (const r of rows) {
    const key = String((r as any).srno ?? 0);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(r);
  }

  return order
    .map((k) => groups.get(k)!)
    .sort((a, b) => {
      const sumA = a.reduce((s, r) => s + getRowAmount(r), 0);
      const sumB = b.reduce((s, r) => s + getRowAmount(r), 0);
      return sumB - sumA;
    })
    .flat();
}
/* ------------------------------------------------------------------ */
/*  Render HTML from rows + meta (shared by both endpoints)            */
/* ------------------------------------------------------------------ */
function buildHtmlFromRows(rows: InvoiceRow[], meta: InvoiceMeta, company_code: string): string {
  const companyConfig = report[company_code as keyof typeof report];
  const templateKey = companyConfig?.template || "AMKSA";
  const buildHtml = templateBuilders[templateKey] || buildInvoiceHtmlAMKSA;
  return buildHtml(rows, meta);
}

function resolveInvoicePeriod(
  explicitPeriod: string | undefined,
  queryInvoiceDate: string | undefined,
  firstRow: InvoiceRow | undefined,
): string {
  if (explicitPeriod && explicitPeriod.trim()) return explicitPeriod.trim();
  const monthSourceDate =
    queryInvoiceDate || firstRow?.invoice_date || firstRow?.user_dt || firstRow?.from_date || null;
  return getMonthPeriodLabel(monthSourceDate);
}

/* ------------------------------------------------------------------ */
/*  Extract CURR_CODE + EX_RATE from a normalized row                 */
/* ------------------------------------------------------------------ */
function extractCurrencyAndRate(row: InvoiceRow | undefined): {
  currCode: string;
  exRate: number | null;
} {
  if (!row) return { currCode: "", exRate: null };
  const anyRow = row as any;
  const currCode =
    (row.curr_code as string) ||
    anyRow.ac_curr_code ||
    anyRow.bill_curr_code ||
    "";
  const exRateRaw = row.ex_rate ?? anyRow.EX_RATE ?? anyRow.exchange_rate ?? anyRow.ac_ex_rate ?? null;
  const exRate = exRateRaw != null ? Number(exRateRaw) : null;
  return { currCode: String(currCode || "").trim(), exRate: Number.isFinite(exRate as number) ? (exRate as number) : null };
}

/* ------------------------------------------------------------------ */
/*  1. AUTHENTICATED endpoint — stored proc                           */
/* ------------------------------------------------------------------ */
export const invoice_report = async (req: Request, res: Response): Promise<void> => {
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

  const conn = await getConn(req);
  // after: const conn = await getConn(req);

let invoiceDateResolved = invoice_date;
let invoicePeriodInput = invoice_period;

if (!invoiceDateResolved || !invoicePeriodInput) {
  // adjust to your conn wrapper; this is oracledb-style
  const dtRes: any = await conn.execute(
    `SELECT TO_CHAR(t.INVOICE_DATE,'DD/MM/YYYY') AS INV_DT,
            TO_CHAR(t.FROM_DATE,'DD/MM/YYYY')    AS FR_DT,
            TO_CHAR(t.TO_DATE,'DD/MM/YYYY')      AS TO_DT
       FROM TN_INVOICE_CONSOLE t
      WHERE t.INVOICE_NO = :inv AND t.COMPANY_CODE = :cc AND t.PRIN_CODE = :pc`,
    { inv: invoice_no, cc: company_code, pc: prin_code },
    { outFormat: 4002 } // oracledb OUT_FORMAT_OBJECT
  );
  const d = dtRes?.rows?.[0];
  if (d) {
    invoiceDateResolved = invoiceDateResolved ?? d.INV_DT;
    invoicePeriodInput  = invoicePeriodInput  ?? `${d.FR_DT} - ${d.TO_DT}`;
  }
}


  const companyConfig = report[company_code as keyof typeof report];
  const rawRows = await execDynamicProc<InvoiceRow>(conn, "PROC_BUILD_DYNAMIC_INVOICE", {
    parameter: companyConfig.parameter,
    code1: company_code,
    code2: prin_code,
    code3: invoice_no,
  });

  // Normalize in case the proc returns UPPERCASE keys
const result: InvoiceRow[] = sortRowsByAmountDesc(
  normalizeOracleInvoiceRows(rawRows as any[]),
);

const resolvedInvoicePeriod = resolveInvoicePeriod(invoicePeriodInput, invoiceDateResolved, result[0]);


  if (!result.length) {
    res.status(404).send("<h3>No invoice report data was found for the selected invoice.</h3>");
    return;
  }

  const { currCode: rowCurrCode, exRate: rowExRate } = extractCurrencyAndRate(result[0]);
  const exchangeRate = rowExRate ?? undefined;

  const stampDataUrl = getStampDataUrl();
  // const resolvedInvoicePeriod = resolveInvoicePeriod(invoice_period, invoice_date, result[0]);

  const token = encryptInvoiceToken({
    company_code,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    data: result,
    meta: {
      invoiceNo: invoice_no,
      invoiceDate: invoiceDateResolved,
      invoicePeriod: resolvedInvoicePeriod,
      clientName: client_name,
      clientAddress: client_address,
      clientVatNo: client_vat_no,
      reportType: report_type,
      exchangeRate,
      curr_code: rowCurrCode || undefined,
    },
  });

  const qrCodeDataUrl = await generateInvoiceQrDataUrl(token, BASE_URL);

  const html = buildHtmlFromRows(
    result,
    {
      invoiceNo: invoice_no,
      invoiceDate: invoiceDateResolved,
      invoicePeriod: resolvedInvoicePeriod,
      clientName: client_name,
      clientAddress: client_address,
      clientVatNo: client_vat_no,
      qrCodeDataUrl,
      reportType: report_type,
      stampDataUrl,
      exchangeRate,
      curr_code: rowCurrCode || undefined,
    },
    company_code,
  );

  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
};

/* ------------------------------------------------------------------ */
/*  2. PUBLIC endpoint — from token only                              */
/* ------------------------------------------------------------------ */
export const public_invoice = async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    res.status(400).send("<h3>Missing access token</h3>");
    return;
  }

  const payload = decryptInvoiceToken(token);
  if (!payload) {
    res.status(401).send("<h3>Invalid or corrupted link</h3>");
    return;
  }

  if (Date.now() > payload.exp * 1000) {
    res.status(401).send("<h3>Link expired</h3>");
    return;
  }

  const rows: InvoiceRow[] = Array.isArray(payload.data)
    ? normalizeOracleInvoiceRows(payload.data as any[])
    : [];

  const stampDataUrl = getStampDataUrl();
  const { currCode: rowCurrCode, exRate: rowExRate } = extractCurrencyAndRate(rows[0]);
  const exchangeRate =
    payload.meta?.exchangeRate != null ? Number(payload.meta.exchangeRate) : rowExRate ?? undefined;

  const html = buildHtmlFromRows(
    rows,
    {
      invoiceNo: payload.meta?.invoiceNo,
      invoiceDate: payload.meta?.invoiceDate,
      invoicePeriod: payload.meta?.invoicePeriod,
      clientName: payload.meta?.clientName,
      clientAddress: payload.meta?.clientAddress,
      clientVatNo: payload.meta?.clientVatNo,
      reportType: payload.meta?.reportType,
      stampDataUrl,
      exchangeRate,
      curr_code: (payload.meta as any)?.curr_code || rowCurrCode || undefined,
    },
    payload.company_code,
  );

  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
};

/* ------------------------------------------------------------------ */
/*  3. STANDARD endpoint — raw SQL on TN_INVOICE_DET_CONSOLE          */
/*     This is the one that was rendering blank. Fixed by normalizing */
/*     the Oracle UPPERCASE keys into lowercase before handing rows   */
/*     to the template.                                                */
/* ------------------------------------------------------------------ */
export const invoice_report_standard = async (req: Request, res: Response): Promise<void> => {
  const {
    prin_code,
    invoice_no,
    company_code,
    invoice_date,
    invoice_period,
    client_name,
    client_address,
    client_vat_no,
  } = req.query as Record<string, string | undefined>;

  if (!company_code || !prin_code || !invoice_no) {
    res.status(400).send("<h3>Company, principal, and invoice number are required.</h3>");
    return;
  }

  const conn = await getConn(req);

  // 1. Header dates (same logic as the working report)
  let invoiceDateResolved = invoice_date;
  let invoicePeriodInput = invoice_period;

  if (!invoiceDateResolved || !invoicePeriodInput) {
    const dtRes: any = await conn.execute(
      `SELECT TO_CHAR(t.INVOICE_DATE,'DD/MM/YYYY') AS INV_DT,
              TO_CHAR(t.FROM_DATE,'DD/MM/YYYY')    AS FR_DT,
              TO_CHAR(t.TO_DATE,'DD/MM/YYYY')      AS TO_DT
         FROM TN_INVOICE_CONSOLE t
        WHERE t.INVOICE_NO = :inv AND t.COMPANY_CODE = :cc AND t.PRIN_CODE = :pc`,
      { inv: invoice_no, cc: company_code, pc: prin_code },
      { outFormat: 4002 },
    );
    const d = dtRes?.rows?.[0];
    if (d) {
      invoiceDateResolved = invoiceDateResolved ?? d.INV_DT;
      invoicePeriodInput = invoicePeriodInput ?? `${d.FR_DT} - ${d.TO_DT}`;
    }
  }

  // 2. Full data from the SAME proc the working report uses
  const companyConfig = report[company_code as keyof typeof report];
  const rawRows = await execDynamicProc<InvoiceRow>(conn, "PROC_BUILD_DYNAMIC_INVOICE", {
    parameter: companyConfig.parameter,
    code1: company_code,
    code2: prin_code,
    code3: invoice_no,
  });

  const result: InvoiceRow[] = sortRowsByAmountDesc(
    normalizeOracleInvoiceRows(rawRows as any[]),
  );
const detRes: any = await conn.execute(
  `SELECT SRNO, ACT_CODE, BILL, BILL_RATE
     FROM TN_INVOICE_DET_CONSOLE
    WHERE COMPANY_CODE = :company_code AND PRIN_CODE = :prin_code AND INVOICE_NO = :invoice_no`,
  { company_code, prin_code, invoice_no },
  { outFormat: 4002 },
);
const detMap = new Map<string, any>(
  (detRes.rows ?? []).map((d: any) => [`${d.SRNO}|${d.ACT_CODE}`, d]),
);
for (const r of result) {
  const d = detMap.get(`${r.srno}|${r.act_code}`);
  if (d) {
    r.bill = Number(d.BILL);
    r.bill_rate = Number(d.BILL_RATE);
  }
}
  if (!result.length) {
    res.status(404).send("<h3>No invoice report data was found for the selected invoice.</h3>");
    return;
  }

  // 3. Base currency from MS_COMPANYINFO
  const curRes: any = await conn.execute(
    `SELECT CURRENCY FROM MS_COMPANYINFO WHERE COMPANY_CODE = :company_code`,
    { company_code },
    { outFormat: 4002 },
  );
  const baseCurr =
    String(curRes?.rows?.[0]?.CURRENCY ?? "").trim().toUpperCase() || "INR";

  const resolvedInvoicePeriod = resolveInvoicePeriod(
    invoicePeriodInput,
    invoiceDateResolved,
    result[0],
  );

  const stampDataUrl = getStampDataUrl();

  const stdMeta = {
    invoiceNo: invoice_no,
    invoiceDate: invoiceDateResolved,
    invoicePeriod: resolvedInvoicePeriod,
    clientName: client_name,
    clientAddress: client_address,
    clientVatNo: client_vat_no,
    reportType: "standard",
    curr_code: baseCurr,        // INR, forced for the standard report
    exchangeRate: undefined,    // not shown on a base-currency report
  };

  const token = encryptInvoiceToken({
    company_code,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    data: result,
    meta: stdMeta,
  });

  const qrCodeDataUrl = await generateInvoiceQrDataUrl(token, BASE_URL);

  const html = buildHtmlFromRows(
    result,
    { ...stdMeta, qrCodeDataUrl, stampDataUrl },
    company_code,
  );

  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
};

export default invoice_report;