import { Request, Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import {
  reportHeader,
  reportFooter,
  buildReportDocument,
} from "../../../common/report_common";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
  let tenantId = getCurrentTenantId();
  if (!tenantId && req.user?.loginid)
    tenantId = await TenantManager.getTenantForUser(req.user.loginid);
  if (!tenantId)
    throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
  return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
  if (conn)
    try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
}

function normalize(rows: any[] = []): ReportRow[] {
  return rows.map((row) =>
    Object.keys(row).reduce((acc: ReportRow, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {}),
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

function dateText(value: unknown): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
  const day   = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-GB", { month: "short" });
  const year  = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Request Param Parsers ────────────────────────────────────────────────────

function parseCommon(req: RequestWithUser) {
  const companyCode  = text(req.body.company_code  || req.user?.company_code);
  const asOnDate     = text(req.body.as_on_date);
  const divisionCode = text(req.body.division_code || "All");

  if (!companyCode || !asOnDate)
    throw Object.assign(
      new Error("company_code and as_on_date are required"),
      { status: 400 },
    );

  return { companyCode, asOnDate, divisionCode };
}

function parseCodeArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return raw.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

function sqlLiteralList(codes: string[]): string {
  return codes.length
    ? codes.map(c => `'${c.replace(/'/g, "''")}'`).join(",")
    : "'All'";
}

// ─── Drill-down click script ─────────────────────────────────────────────────

const CODE_FIELD_MAP: Record<string, string> = {
  ac:     "bl_code",
  detail: "ac_code",
};

function buildDrillScript(
  drillLevel: "ac" | "detail" | null,
  companyCode: string,
  asOnDate: string,
  divisionCode: string,
): string {
  if (!drillLevel) return "";
  return `
  <script>
    (function () {
      var DRILL_LEVEL   = ${JSON.stringify(drillLevel)};
      var COMPANY_CODE  = ${JSON.stringify(companyCode)};
      var AS_ON_DATE    = ${JSON.stringify(asOnDate)};
      var DIVISION_CODE = ${JSON.stringify(divisionCode)};
      var CODE_FIELD    = ${JSON.stringify(CODE_FIELD_MAP[drillLevel] ?? "")};

      document.querySelectorAll("tbody tr[data-code]").forEach(function (tr) {
        tr.addEventListener("click", function () {
          var code = tr.getAttribute("data-code");
          window.parent.postMessage({
            type:          "DRILL_DOWN",
            drillLevel:    DRILL_LEVEL,
            company_code:  COMPANY_CODE,
            as_on_date:    AS_ON_DATE,
            division_code: DIVISION_CODE,
            code:          code,
            codeField:     CODE_FIELD,
          }, "*");
        });
      });
    })();
  </script>`;
}

// ─── Blue theme CSS ──────────────────────────────────────────────────────────

const DRILLDOWN_EXTRA_CSS = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  .doc-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 4px 0 12px 0;
  }
  .doc-title-row h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0b4ca1;
  }

  .drill-hint {
    font-size: 10px;
    color: #0b4ca1;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 4px;
    padding: 4px 10px;
    margin-bottom: 8px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  @media print { .drill-hint { display: none !important; } }

  .table-frame {
    border: 1px solid #b8c4d2;
    border-radius: 3px;
    overflow: hidden;
  }

  table.drill-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  table.drill-table thead th {
    background: #0b4ca1;
    color: #ffffff;
    padding: 7px 6px;
    font-size: 9px;
    font-weight: 700;
    text-align: left;
    border-right: 1px solid rgba(255,255,255,0.16);
    white-space: nowrap;
  }
  table.drill-table thead th:last-child { border-right: 0; }
  table.drill-table thead th.right  { text-align: right; }
  table.drill-table thead th.center { text-align: center; }

  table.drill-table tbody td {
    padding: 5px 6px;
    font-size: 10px;
    color: #263445;
    border-right: 1px solid #e3e8ef;
    border-bottom: 1px solid #e3e8ef;
    vertical-align: middle;
    overflow-wrap: anywhere;
  }
  table.drill-table tbody td:last-child { border-right: 0; }
  table.drill-table tbody td.center { text-align: center; }
  table.drill-table tbody td.left   { text-align: left; }
  table.drill-table tbody td.num    { text-align: right; font-variant-numeric: tabular-nums; }
  table.drill-table tbody td.mono   { font-family: 'Courier New', monospace; font-size: 9.5px; }

  table.drill-table tbody tr[data-code] { cursor: pointer; }
  table.drill-table tbody tr[data-code]:hover { background: #eff6ff !important; }
  table.drill-table tbody tr.group-header td { background: #f0f9ff; font-weight: 700; }
  table.drill-table tbody tr.item-row td { background: #ffffff; }

  .balance-pos { color: #0f172a; }
  .balance-neg { color: #991b1b; }

  tr.total-row td {
    background: #eff6ff !important;
    border-top: 2px solid #0b4ca1 !important;
    border-bottom: 2px solid #0b4ca1 !important;
    font-weight: 800;
    color: #0b4ca1;
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding: 6px;
  }
  tr.total-row td.empty {
    border: 1px solid #b8c4d2 !important;
    border-right: none !important;
    background: #f8fafc !important;
  }

  @media print {
    tr.total-row { page-break-inside: avoid; }
  }
`;

// ─── Excel builder (manual OOXML via AdmZip — blue theme) ────────────────────

const STYLE_ID = {
  default:       0,
  title:         1,
  metaLabel:     2,
  metaValue:     3,
  tableHeader:   4,
  cellText:      5,
  cellNumber:    6,
  groupHeader:   7,
  totalLabel:    8,
  totalNumber:   9,
  subInfo:      10,
} as const;

type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }

function xc(v: unknown, style: StyleKey): XlCell {
  return { v, s: STYLE_ID[style] };
}

interface BuildXlsxOptions {
  title: string;
  meta: { label: string; value: string }[];
  headers: string[];
  colWidths: number[];
  dataRows: (XlCell | null)[][];
  totalRow?: (XlCell | null)[];
  sheetName: string;
}

function buildXlsxBuffer(opts: BuildXlsxOptions): Buffer {
  const NCOLS = opts.headers.length;
  const skip  = null;

  type Row = (XlCell | null)[];
  const rows: Row[] = [];

  rows.push([xc(opts.title, "title"), ...Array(NCOLS - 1).fill(skip)]);
  rows.push(Array(NCOLS).fill(skip));

  for (const m of opts.meta) {
    rows.push([
      xc(m.label, "metaLabel"),
      xc(m.value, "metaValue"),
      ...Array(NCOLS - 2).fill(skip),
    ]);
  }
  rows.push(Array(NCOLS).fill(skip));

  rows.push(opts.headers.map(h => xc(h, "tableHeader")));
  for (const row of opts.dataRows) rows.push(row);
  if (opts.totalRow) rows.push(opts.totalRow);

  const colXml = opts.colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const merges: string[] = [];
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    let spanStart = -1;
    row.forEach((cell, ci) => {
      if (cell !== null && spanStart === -1) {
        spanStart = ci;
      } else if (cell === null && spanStart !== -1) {
        let end = ci;
        while (end + 1 < row.length && row[end + 1] === null) end++;
        if (end > spanStart) {
          merges.push(
            `${String.fromCharCode(65 + spanStart)}${rn}:${String.fromCharCode(65 + end)}${rn}`
          );
        }
        spanStart = -1;
      } else if (cell !== null) {
        spanStart = ci;
      }
    });
  });

  let sheetDataXml = "";
  rows.forEach((row, ri) => {
    const rn  = ri + 1;
    const ht  = rn === 1 ? ` ht="22" customHeight="1"` : "";
    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = `${String.fromCharCode(65 + ci)}${rn}`;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += `</row>`;
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetDataXml}</sheetData>
  ${mergeXml}
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
  <fonts count="7">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0B4CA1"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="FF334155"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B4CA1"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF0B4CA1"/></left><right style="thin"><color rgb="FF0B4CA1"/></right>
      <top style="thin"><color rgb="FF0B4CA1"/></top><bottom style="thin"><color rgb="FF0B4CA1"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="3" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="5" borderId="3" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="5" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const safeName = opts.sheetName.replace(/[\\/?*\[\]]/g, "_").substring(0, 31);
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(safeName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml",        Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                Buffer.from(rels));
  zip.addFile("xl/workbook.xml",            Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml",   Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml",              Buffer.from(stylesXml));
  return zip.toBuffer();
}

function sendExcel(res: Response, buffer: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(buffer);
}

// ─── AC Level Drilldown ───────────────────────────────────────────────────────

async function loadAcRows(
  req: RequestWithUser,
  companyCode: string,
  asOnDate: string,
  divisionCode: string,
  blCodes: string[],
): Promise<ReportRow[]> {
  const blIn = sqlLiteralList(blCodes);

  const sql = `
    SELECT
      TR_AC_DETAIL.company_code,
      TR_AC_DETAIL.ac_code,
      max(ac_name) ac_name,
      00000000000.000000 opening,
      sum(round(lcur_amount * sign_ind, 3)) amount,
      sum(case when sign_ind > 0 then lcur_amount else 0 end) debit_amount,
      sum(case when sign_ind < 0 then lcur_amount else 0 end) credit_amount,
      TR_AC_DETAIL.div_code
    FROM TR_AC_DETAIL, MS_ACCODES
    WHERE TR_AC_DETAIL.ac_code      = MS_ACCODES.ac_code
      AND TR_AC_DETAIL.company_code = :companyCode
      AND TR_AC_DETAIL.doc_date     < TO_DATE(:asOnDate, 'YYYY-MM-DD')
      AND ('All' IN (${blIn}) OR MS_ACCODES.pl_bl_code IN (${blIn}))
      AND TR_AC_DETAIL.doc_type    <> 'EJV'
      AND TR_AC_DETAIL.CANCELLED   <> 'Y'
      AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
    GROUP BY TR_AC_DETAIL.div_code, TR_AC_DETAIL.company_code, TR_AC_DETAIL.ac_code
    ORDER BY TR_AC_DETAIL.ac_code
  `;

  const conn = await getConn(req);
  try {
    const result = await conn.execute(sql,
      { companyCode, asOnDate, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

function renderAcBody(
  rows: ReportRow[],
  title: string,
  companyCode: string,
  asOnDate: string,
  divisionCode: string,
): string {
  const totals = rows.reduce<{
    opening: number;
    debit: number;
    credit: number;
    amount: number;
  }>(
    (acc, r) => ({
      opening: acc.opening + amount(r.opening),
      debit:   acc.debit   + amount(r.debit_amount),
      credit:  acc.credit  + amount(r.credit_amount),
      amount:  acc.amount  + amount(r.amount),
    }),
    { opening: 0, debit: 0, credit: 0, amount: 0 },
  );

  const dataRows = rows.map(r => `
    <tr data-code="${escapeHtml(r.ac_code)}" class="item-row">
      <td class="center mono">${escapeHtml(r.ac_code)}</td>
      <td class="left">${escapeHtml(r.ac_name)}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(r.opening)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(r.debit_amount)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(r.credit_amount)))}</td>
      <td class="num">${escapeHtml(fmtNumber(amount(r.amount)))}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="center" style="color:#64748b;font-style:italic;padding:18px;">No data found</td></tr>`;

  const tableHtml = `
    <div class="table-frame">
      <table class="drill-table">
        <colgroup>
          <col style="width: 11%" />
          <col style="width: 39%" />
          <col style="width: 12%" />
          <col style="width: 13%" />
          <col style="width: 13%" />
          <col style="width: 12%" />
        </colgroup>
        <thead>
          <tr>
            <th class="center">A/C Code</th>
            <th>Account Name</th>
            <th class="right">Opening</th>
            <th class="right">Debit Amount</th>
            <th class="right">Credit Amount</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>${dataRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td class="empty" colspan="2"></td>
            <td>${escapeHtml(fmtNumber(totals.opening))}</td>
            <td>${escapeHtml(fmtNumber(totals.debit))}</td>
            <td>${escapeHtml(fmtNumber(totals.credit))}</td>
            <td>${escapeHtml(fmtNumber(totals.amount))}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;

  return `
    <div class="doc-title-row">
      <div><h1>${escapeHtml(title)}</h1></div>
    </div>
    <div class="drill-hint">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      Click any row to drill down
    </div>
    ${tableHtml}
    ${buildDrillScript("detail", companyCode, asOnDate, divisionCode)}
  `;
}

function buildSummaryExcel(
  rows: ReportRow[],
  codeField: string,
  codeHeader: string,
  sheetTitle: string,
  loginId: string,
): Buffer {
  const totals = rows.reduce(
    (acc, r) => ({
      opening: acc.opening + amount(r.opening),
      debit:   acc.debit   + amount(r.debit_amount),
      credit:  acc.credit  + amount(r.credit_amount),
      amount:  acc.amount  + amount(r.amount),
    }),
    { opening: 0, debit: 0, credit: 0, amount: 0 },
  );

  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const dataRows: (XlCell | null)[][] = rows.map(r => [
    xc(text(r[codeField]), "cellText"),
    xc(text(r.ac_name), "cellText"),
    xc(amount(r.opening), "cellNumber"),
    xc(amount(r.debit_amount), "cellNumber"),
    xc(amount(r.credit_amount), "cellNumber"),
    xc(amount(r.amount), "cellNumber"),
  ]);

  if (!rows.length) {
    dataRows.push([xc("No data found", "cellText"), null, null, null, null, null]);
  }

  const totalRow: (XlCell | null)[] = [
    xc("", "totalLabel"),
    xc("", "totalLabel"),
    xc(totals.opening, "totalNumber"),
    xc(totals.debit, "totalNumber"),
    xc(totals.credit, "totalNumber"),
    xc(totals.amount, "totalNumber"),
  ];

  return buildXlsxBuffer({
    title: "al madina LOGISTICS - Balance Sheet Drill-Down",
    meta: [
      { label: "Title", value: sheetTitle },
      { label: "Date",  value: printDateTime },
      { label: "User",  value: loginId },
    ],
    headers: [codeHeader, "Account Name", "Opening", "Debit Amount", "Credit Amount", "Amount"],
    colWidths: [12, 40, 18, 18, 18, 18],
    dataRows,
    totalRow,
    sheetName: "BS Drill-Down",
  });
}

// ─── Detail Level Drilldown ───────────────────────────────────────────────────

async function loadDetailRows(
  req: RequestWithUser,
  companyCode: string,
  asOnDate: string,
  divisionCode: string,
  acCodes: string[],
): Promise<ReportRow[]> {
  const acIn = sqlLiteralList(acCodes);

  const sql = `
    SELECT
      TR_AC_DETAIL.company_code, TR_AC_DETAIL.doc_type, TR_AC_DETAIL.doc_no,
      TR_AC_DETAIL.doc_date, TR_AC_DETAIL.ac_code, TR_AC_DETAIL.remarks,
      TR_AC_DETAIL.amount, TR_AC_DETAIL.sign_ind, TR_AC_DETAIL.curr_code,
      TR_AC_DETAIL.ex_rate, TR_AC_DETAIL.lcur_amount, TR_AC_DETAIL.pdc_ind,
      TR_AC_DETAIL.cheque_no, TR_AC_DETAIL.cheque_date, TR_AC_DETAIL.cheque_desc,
      TR_AC_DETAIL.pdc_cleared_date,
      MS_ACCODES_A.ac_name, MS_ACCODES_A.curr_code ac_curr_code,
      000000000.000 op_balance,
      TR_AC_DETAIL.div_code, TR_AC_DETAIL.bank_ac_code,
      MS_ACCODES_B.ac_name bank_ac_name
    FROM TR_AC_DETAIL, MS_ACCODES MS_ACCODES_A, MS_ACCODES MS_ACCODES_B
    WHERE TR_AC_DETAIL.ac_code      = MS_ACCODES_A.ac_code(+)
      AND TR_AC_DETAIL.bank_ac_code = MS_ACCODES_B.ac_code(+)
      AND TR_AC_DETAIL.company_code = :companyCode
      AND ('All' IN (${acIn}) OR TR_AC_DETAIL.ac_code IN (${acIn}))
      AND TR_AC_DETAIL.doc_date    < TO_DATE(:asOnDate, 'YYYY-MM-DD')
      AND TR_AC_DETAIL.cancelled  <> 'Y'
      AND TR_AC_DETAIL.doc_type   <> 'UJV'
      AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
    ORDER BY TR_AC_DETAIL.ac_code, TR_AC_DETAIL.doc_date, TR_AC_DETAIL.doc_no
  `;

  const conn = await getConn(req);
  try {
    const result = await conn.execute(sql,
      { companyCode, asOnDate, divisionCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return normalize(result.rows as any[]);
  } finally {
    await closeConn(conn);
  }
}

function renderDetailBody(rows: ReportRow[], title: string): string {
  const grouped = new Map<string, ReportRow[]>();
  rows.forEach(r => {
    const key = text(r.ac_code);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  });

  let grandDebit = 0;
  let grandCredit = 0;
  let bodyHtml = "";

  grouped.forEach((acRows, acCode) => {
    const acName = text(acRows[0]?.ac_name);
    const opening = amount(acRows[0]?.op_balance);
    let runBalance = opening;
    let acDebit = 0;
    let acCredit = 0;

    bodyHtml += `
      <tr class="group-header">
        <td class="center mono" style="font-weight:700">${escapeHtml(acCode)}</td>
        <td class="left" style="font-weight:700" colspan="6">${escapeHtml(acName)}</td>
        <td class="num" style="font-weight:700; color:#0b4ca1">Opening&nbsp;&nbsp;${escapeHtml(fmtNumber(opening))}</td>
        <td></td>
        <td class="num" style="font-weight:700">${escapeHtml(fmtNumber(opening))}</td>
      </tr>`;

    for (const r of acRows) {
      const debit = amount(r.sign_ind) >= 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      const credit = amount(r.sign_ind) < 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      runBalance += debit - credit;
      acDebit += debit;
      acCredit += credit;
      const balClass = runBalance < 0 ? "balance-neg" : "balance-pos";

      bodyHtml += `
        <tr class="item-row">
          <td class="center mono">${escapeHtml(r.ac_code)}</td>
          <td class="center">${escapeHtml(r.doc_type)}</td>
          <td class="center">${escapeHtml(String(r.doc_no ?? ""))}</td>
          <td class="center">${escapeHtml(dateText(r.doc_date))}</td>
          <td class="center">${escapeHtml(String(r.cheque_no ?? ""))}</td>
          <td class="center">${escapeHtml(dateText(r.cheque_date))}</td>
          <td class="left">${escapeHtml(text(r.bank_ac_name))}</td>
          <td class="num">${debit > 0 ? escapeHtml(fmtNumber(debit)) : ""}</td>
          <td class="num">${credit > 0 ? escapeHtml(fmtNumber(credit)) : ""}</td>
          <td class="num ${balClass}">${escapeHtml(fmtNumber(runBalance))}</td>
        </tr>`;
    }

    grandDebit += acDebit;
    grandCredit += acCredit;

    bodyHtml += `
      <tr class="total-row">
        <td class="empty" colspan="7" style="text-align:left; padding-left:12px">Total — ${escapeHtml(acName)}</td>
        <td>${escapeHtml(fmtNumber(acDebit))}</td>
        <td>${escapeHtml(fmtNumber(acCredit))}</td>
        <td>${escapeHtml(fmtNumber(runBalance))}</td>
      </tr>
      <tr><td colspan="10" style="height:6px; border:0; background:transparent"></td></tr>`;
  });

  if (!rows.length) {
    bodyHtml = `<tr><td colspan="10" class="center" style="color:#64748b;font-style:italic;padding:18px;">No transactions found</td></tr>`;
  }

  const tableHtml = `
    <div class="table-frame">
      <table class="drill-table">
        <colgroup>
          <col style="width: 9%" />
          <col style="width: 5%" />
          <col style="width: 6%" />
          <col style="width: 8%" />
          <col style="width: 8%" />
          <col style="width: 8%" />
          <col style="width: 18%" />
          <col style="width: 10%" />
          <col style="width: 10%" />
          <col style="width: 12%" />
        </colgroup>
        <thead>
          <tr>
            <th class="center">A/C Code</th>
            <th class="center">Type</th>
            <th class="center">Doc No.</th>
            <th class="center">Doc Date</th>
            <th class="center">Chq No.</th>
            <th class="center">Chq Date</th>
            <th>Bank</th>
            <th class="right">Debit</th>
            <th class="right">Credit</th>
            <th class="right">Balance</th>
          </tr>
        </thead>
        <tbody>${bodyHtml}</tbody>
        <tfoot>
          <tr class="total-row">
            <td class="empty" colspan="7" style="text-align:left; padding-left:12px">Grand Total</td>
            <td>${escapeHtml(fmtNumber(grandDebit))}</td>
            <td>${escapeHtml(fmtNumber(grandCredit))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;

  return `
    <div class="doc-title-row">
      <div><h1>${escapeHtml(title)}</h1></div>
    </div>
    ${tableHtml}
  `;
}

function buildDetailExcel(rows: ReportRow[], sheetTitle: string, loginId: string): Buffer {
  const printDateTime = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const headers = ["A/C Code", "Type", "Doc No.", "Doc Date", "Chq No.", "Chq Date", "Bank", "Debit", "Credit", "Balance"];
  const dataRows: (XlCell | null)[][] = [];

  const grouped = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const key = text(r.ac_code);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  let grandDebit = 0;
  let grandCredit = 0;

  grouped.forEach((acRows, acCode) => {
    const acName = text(acRows[0]?.ac_name);
    let runBalance = 0;
    let acDebit = 0;
    let acCredit = 0;

    dataRows.push([
      xc(`${acCode} — ${acName}`, "groupHeader"),
      null, null, null, null, null, null, null, null, null,
    ]);

    for (const r of acRows) {
      const debit = amount(r.sign_ind) >= 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      const credit = amount(r.sign_ind) < 0 ? Math.abs(amount(r.lcur_amount)) : 0;
      runBalance += debit - credit;
      acDebit += debit;
      acCredit += credit;

      dataRows.push([
        xc(text(r.ac_code), "cellText"),
        xc(text(r.doc_type), "cellText"),
        xc(text(r.doc_no ?? ""), "cellText"),
        xc(dateText(r.doc_date), "cellText"),
        xc(text(r.cheque_no ?? ""), "cellText"),
        xc(dateText(r.cheque_date), "cellText"),
        xc(text(r.bank_ac_name ?? ""), "cellText"),
        xc(debit > 0 ? debit : 0, "cellNumber"),
        xc(credit > 0 ? credit : 0, "cellNumber"),
        xc(runBalance, "cellNumber"),
      ]);
    }

    grandDebit += acDebit;
    grandCredit += acCredit;

    dataRows.push([
      xc(`Total — ${acName}`, "totalLabel"),
      null, null, null, null, null, null,
      xc(acDebit, "totalNumber"),
      xc(acCredit, "totalNumber"),
      xc(runBalance, "totalNumber"),
    ]);
    dataRows.push([null, null, null, null, null, null, null, null, null, null]);
  });

  if (!rows.length) {
    dataRows.push([
      xc("No transactions found", "cellText"),
      null, null, null, null, null, null, null, null, null,
    ]);
  }

  dataRows.push([
    xc("Grand Total", "totalLabel"),
    null, null, null, null, null, null,
    xc(grandDebit, "totalNumber"),
    xc(grandCredit, "totalNumber"),
    xc("", "totalNumber"),
  ]);

  return buildXlsxBuffer({
    title: "al madina LOGISTICS - Account Ledger",
    meta: [
      { label: "Title", value: sheetTitle },
      { label: "Date",  value: printDateTime },
      { label: "User",  value: loginId },
    ],
    headers,
    colWidths: [14, 8, 10, 12, 12, 12, 22, 16, 16, 16],
    dataRows,
    sheetName: "Ledger Detail",
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS  (exports required by transactions_finance.routes.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export const getBalanceSheetDrilldownAc = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { companyCode, asOnDate, divisionCode } = parseCommon(req);
    const blCodes = parseCodeArray(req.body.bl_code);
    const rows = await loadAcRows(req, companyCode, asOnDate, divisionCode, blCodes);
    const blLabel = blCodes.length ? ` [BL: ${blCodes.join(", ")}]` : "";
    const title = `Account Breakdown${blLabel} | As on ${dateText(asOnDate)}`;

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const bodyHtml = renderAcBody(rows, title, companyCode, asOnDate, divisionCode);
    const footerHtml = reportFooter({
      reportName: "rpt_drilldown_balancesheet_ac",
      userName: req.user?.loginid ?? "",
      extraLeft: `Object: ${escapeHtml(companyCode)} — ${escapeHtml(blLabel || "All")}`,
      extraRight: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: DRILLDOWN_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Balance Sheet Drilldown AC error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate drill-down" });
  }
};

export const getBalanceSheetDrilldownAcExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { companyCode, asOnDate, divisionCode } = parseCommon(req);
    const blCodes = parseCodeArray(req.body.bl_code);
    const rows = await loadAcRows(req, companyCode, asOnDate, divisionCode, blCodes);
    const blLabel = blCodes.length ? ` [BL: ${blCodes.join(", ")}]` : "";
    const title = `Account Breakdown${blLabel} | As on ${dateText(asOnDate)}`;
    const buffer = buildSummaryExcel(rows, "ac_code", "A/C Code", title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `balance_sheet_drilldown_ac_${companyCode}_${asOnDate}.xlsx`);
  } catch (error: any) {
    console.error("Balance Sheet Drilldown AC Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to export drill-down" });
  }
};

export const getBalanceSheetDrilldownDetail = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { companyCode, asOnDate, divisionCode } = parseCommon(req);
    const acCodes = parseCodeArray(req.body.ac_code);
    const rows = await loadDetailRows(req, companyCode, asOnDate, divisionCode, acCodes);

    const acLabel = acCodes.length ? ` — ${acCodes.join(", ")}` : "";
    const title = `Account Ledger${acLabel} | As on ${dateText(asOnDate)}`;

    const headerHtml = await reportHeader({ company_code: companyCode, req });
    const bodyHtml = renderDetailBody(rows, title);
    const footerHtml = reportFooter({
      reportName: "rpt_drilldown_balancesheet_detail",
      userName: req.user?.loginid ?? "",
      extraLeft: `Object: ${escapeHtml(companyCode)} — ${escapeHtml(acLabel || "All")}`,
      extraRight: "Powered by Bayanat Technology",
    });

    const html = buildReportDocument({
      title,
      headerHtml,
      bodyHtml,
      footerHtml,
      extraCss: DRILLDOWN_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("Balance Sheet Drilldown Detail error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate drill-down" });
  }
};

export const getBalanceSheetDrilldownDetailExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const { companyCode, asOnDate, divisionCode } = parseCommon(req);
    const acCodes = parseCodeArray(req.body.ac_code);
    const rows = await loadDetailRows(req, companyCode, asOnDate, divisionCode, acCodes);
    const acLabel = acCodes.length ? ` — ${acCodes.join(", ")}` : "";
    const title = `Account Ledger${acLabel} | As on ${dateText(asOnDate)}`;
    const buffer = buildDetailExcel(rows, title, req.user?.loginid ?? "");
    sendExcel(res, buffer, `balance_sheet_drilldown_detail_${companyCode}_${asOnDate}.xlsx`);
  } catch (error: any) {
    console.error("Balance Sheet Drilldown Detail Excel error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to export drill-down" });
  }
};