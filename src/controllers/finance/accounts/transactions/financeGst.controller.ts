import { Response } from 'express';
import oracledb from 'oracledb';
import * as XLSX from 'xlsx';
import TenantManager from '../../../../database/TenantManager';
import { getCurrentTenantId } from '../../../../middleware/tenantContext.middleware';
import { RequestWithUser } from '../../../../interfaces/common.interface';
import { escapeHtml } from '../../../purchase_sales/report/common/formatters';
import { buildReportDocument, reportFooter, reportHeader } from '../../../common/report_common';

async function connectionFor(req: RequestWithUser) {
  const tenant = getCurrentTenantId() || await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { status: 400 });
  return TenantManager.getConnection(tenant);
}
const normalize = (rows: any[] = []) => rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])));

export async function readGstLines(c: oracledb.Connection, company: string, type: string, no: string) {
  try {
    return normalize((await c.execute(`SELECT * FROM TR_AC_GST_LINE WHERE company_code=:cc AND doc_type=:dt AND doc_no=:dn ORDER BY serial_no`,
      { cc: company, dt: type, dn: no }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows);
  } catch (e: any) { if (e.errorNum === 942) return []; throw e; }
}

export const getFinanceGstSetup = async (req: RequestWithUser, res: Response): Promise<void> => {
  let c: oracledb.Connection | undefined;
  try {
    c = await connectionFor(req);
    let data: any = { enabled: false, registration_state: '', states: [] };
    try {
      const setup = normalize((await c.execute(`SELECT g.enabled,g.registration_state,NVL(a.amount_decimal_nos,2) amount_decimals,NVL(a.lcur_decimal_nos,2) local_decimals FROM MS_AC_GST_SETUP g LEFT JOIN MS_AC_SETUP a ON a.company_code=g.company_code WHERE g.company_code=:cc`,
        { cc: req.user.company_code }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows)[0];
      if (setup) data = { ...setup, enabled: setup.enabled === 'Y', states: normalize((await c.execute('SELECT state_code,state_name FROM MS_AC_GST_STATE ORDER BY state_name', {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows) };
    } catch (e: any) { if (e.errorNum !== 942) throw e; }
    res.json({ success: true, data });
  } catch (e: any) { res.status(e.status || 500).json({ success: false, message: e.message }); }
  finally { if (c) await c.close(); }
};

export const getFinanceGstDocument = async (req: RequestWithUser, res: Response): Promise<void> => {
  let c: oracledb.Connection | undefined;
  try {
    c = await connectionFor(req);
    res.json({ success: true, data: await readGstLines(c, req.user.company_code, String(req.query.doc_type || ''), String(req.query.doc_no || '')) });
  } catch (e: any) { res.status(e.status || 500).json({ success: false, message: e.message }); }
  finally { if (c) await c.close(); }
};

function reportDate(value: unknown): string {
  const v = String(value || '');
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : v.replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$2-$1');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(iso))) throw Object.assign(new Error('Select valid report dates'), { status: 400 });
  return iso;
}

export const getFinanceGstRegister = async (req: RequestWithUser, res: Response): Promise<void> => {
  let c: oracledb.Connection | undefined;
  try {
    c = await connectionFor(req);
    const b = req.body || {};
    if (b.code1 && b.code1 !== req.user.company_code) throw Object.assign(new Error('Report company must match the signed-in company'), { status: 403 });
    const accounts = String(b.code5 || 'All').split(',').map((x: string) => x.trim()).filter((x: string) => x && x !== 'All');
    const groups = String(b.code4 || 'All').split(',').map((x: string) => x.trim()).filter((x: string) => x && x !== 'All');
    const binds: Record<string, any> = { cc: req.user.company_code, df: reportDate(b.date_from || b.code2), dt: reportDate(b.date_to || b.code3), div: b.division || b.code6 || 'All' };
    const list = (values: string[], prefix: string) => values.map((v, i) => { binds[prefix + i] = v; return ':' + prefix + i; }).join(',');
    const accountFilter = accounts.length ? `AND (h.ac_code IN (${list(accounts, 'ha')}) OR g.ac_code IN (${list(accounts, 'da')}))` : '';
    const groupFilter = groups.length ? `AND SUBSTR(g.ac_code,1,5) IN (${list(groups, 'gp')})` : '';
    const rows: any[] = normalize((await c.execute(`SELECT g.doc_type,g.doc_no,g.doc_date,g.serial_no,g.tax_direction,g.ac_code,a.ac_name,
      g.supplier_state,g.place_of_supply,g.hsn_sac,g.tax_rate,g.taxable_lcur*g.sign_ind*CASE g.tax_direction WHEN 'OUTPUT' THEN -1 ELSE 1 END signed_taxable,
      g.cgst_lcur*g.sign_ind*CASE g.tax_direction WHEN 'OUTPUT' THEN -1 ELSE 1 END signed_cgst,g.sgst_lcur*g.sign_ind*CASE g.tax_direction WHEN 'OUTPUT' THEN -1 ELSE 1 END signed_sgst,g.igst_lcur*g.sign_ind*CASE g.tax_direction WHEN 'OUTPUT' THEN -1 ELSE 1 END signed_igst
      FROM TR_AC_GST_LINE g JOIN TR_AC_HEADER h ON h.company_code=g.company_code AND h.doc_type=g.doc_type AND h.doc_no=g.doc_no
      LEFT JOIN MS_ACCODES a ON a.company_code=g.company_code AND a.ac_code=g.ac_code
      WHERE g.company_code=:cc AND NVL(h.canceled,'N')<>'Y' AND g.doc_date>=TO_DATE(:df,'YYYY-MM-DD')
      AND g.doc_date<TO_DATE(:dt,'YYYY-MM-DD')+1 AND (:div='All' OR :div='*' OR g.div_code=:div)
      ${accountFilter} ${groupFilter} ORDER BY g.doc_date,g.doc_type,g.doc_no,g.serial_no`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows);
    const company = normalize((await c.execute('SELECT company_name,currency FROM MS_COMPANYINFO WHERE company_code=:cc', { cc: req.user.company_code }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows)[0] || {};
    const fields = ['doc_type','doc_no','doc_date','serial_no','tax_direction','ac_code','ac_name','supplier_state','place_of_supply','hsn_sac','tax_rate','signed_taxable','signed_cgst','signed_sgst','signed_igst'];
    const headings = ['Type','Voucher','Date','Line','Input / Output','Account','Account name','Supplier state','Place of supply','HSN / SAC','GST %','Taxable base','CGST','SGST / UTGST','IGST'];
    const values = rows.map(row => fields.map(f => f === 'doc_date' ? new Date(row[f]).toISOString().slice(0,10) : row[f]));
    const totals = ['signed_taxable','signed_cgst','signed_sgst','signed_igst'].map(f => rows.reduce((s, row) => s + Number(row[f] || 0), 0));
    if (req.params.format === 'excel') {
      const ws = XLSX.utils.aoa_to_sheet([[company.company_name, 'GST register', company.currency], [], headings, ...values, [...Array(10).fill(''), 'Total', ...totals]]);
      ws['!cols'] = headings.map((_, i) => ({ wch: i === 6 ? 32 : 17 }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'GST register');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="GST-register.xlsx"');
      res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); return;
    }
    const money = (n: unknown) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const headingHtml = headings.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
    const rowHtml = values.map(row => '<tr>' + row.map((v, i) => '<td>' + escapeHtml(i >= 11 ? money(v) : String(v ?? '')) + '</td>').join('') + '</tr>').join('');
    const totalHtml = totals.map(v => '<th>' + money(v) + '</th>').join('');
    const bodyHtml = '<h2>GST register</h2><p>' + escapeHtml(binds.df) + ' to ' + escapeHtml(binds.dt) + ' ? ' + escapeHtml(company.currency || '') + '. Normal input/output tax is positive; reversing entries are negative. Cancelled vouchers excluded.</p><table><thead><tr>' + headingHtml + '</tr></thead><tbody>' + (rowHtml || '<tr><td colspan="15">No GST postings in this period.</td></tr>') + '</tbody><tfoot><tr><th colspan="11">Total</th>' + totalHtml + '</tr></tfoot></table>';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildReportDocument({ title: 'GST register', headerHtml: await reportHeader({ company_code: req.user.company_code, req }), bodyHtml,
      footerHtml: reportFooter({ reportName: 'GST register', userName: req.user.loginid }), extraCss: '@page{size:A4 landscape}table{width:100%;border-collapse:collapse;font-size:9px}td,th{padding:5px;border:1px solid #cbd5e1}th{background:#eef3f9;text-align:left}td:nth-child(n+12){text-align:right;font-variant-numeric:tabular-nums}' }));
  } catch (e: any) { res.status(e.status || 500).json({ success: false, message: e.message }); }
  finally { if (c) await c.close(); }
};
