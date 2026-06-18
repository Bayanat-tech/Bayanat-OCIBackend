import { Response } from "express";
import oracledb from "oracledb";
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = Record<string, any>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function text(v: unknown): string {
    if (v == null) return "";
    return String(v);
}

function amount(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function fmtNumber(n: number): string {
    const abs = Math.abs(n);
    const fmt = abs.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    return n < 0 ? `(${fmt})` : fmt;
}

function dateText(v: unknown): string {
    if (!v) return "";
    const d = new Date(String(v));
    return isNaN(d.getTime())
        ? String(v).substring(0, 10)
        : d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(v: unknown): string {
    return text(v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(v: unknown): string {
    return text(v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function normalize(rows: any[] = []): ReportRow[] {
    return rows.map((row) =>
        Object.keys(row).reduce((acc: ReportRow, key) => {
            acc[key.toLowerCase()] = row[key];
            return acc;
        }, {})
    );
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
    let tenantId = getCurrentTenantId();
    if (!tenantId && req.user?.loginid)
        tenantId = await TenantManager.getTenantForUser(req.user.loginid);
    if (!tenantId)
        throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
    return TenantManager.getConnection(tenantId);
}

async function closeConn(conn?: oracledb.Connection) {
    if (conn) try { await conn.close(); } catch (e) { console.warn("closeConn:", e); }
}

// ─── Param parser ─────────────────────────────────────────────────────────────

function parseCommon(req: RequestWithUser) {
    const companyCode = text(req.body.company_code || req.user?.company_code);
    const fromDate = text(req.body.from_date);
    const toDate = text(req.body.to_date);
    const divisionCode = text(req.body.division_code || "All");

    if (!companyCode || !fromDate || !toDate)
        throw Object.assign(
            new Error("company_code, from_date, and to_date are required"),
            { status: 400 }
        );

    return { companyCode, fromDate, toDate, divisionCode };
}

// ─── Shared HTML page shell — identical to trailBalanceSubLevel ───────────────

function buildPage(opts: {
    title: string;
    reportName: string;
    tableHtml: string;
    drillLevel: "l3" | null;
    companyCode: string;
    fromDate: string;
    toDate: string;
    divisionCode: string;
    loginId: string;
    plCode?: string;
    acCode?: string;
}): string {
    const {
        title, reportName, tableHtml, drillLevel,
        companyCode, fromDate, toDate, divisionCode, loginId,
    } = opts;

    const printDateTime = new Date().toLocaleString("en-GB", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
    });

    // L2 → L3 drill: clicking an AC row sends PNL_DRILL_DOWN with drillLevel:"l3"
    const drillScript = drillLevel === "l3" ? `
  <script>
    (function () {
      var COMPANY_CODE  = ${JSON.stringify(companyCode)};
      var FROM_DATE     = ${JSON.stringify(fromDate)};
      var TO_DATE       = ${JSON.stringify(toDate)};
      var DIVISION_CODE = ${JSON.stringify(divisionCode)};

      document.querySelectorAll("tbody tr[data-accode]").forEach(function (tr) {
        tr.style.cursor = "pointer";
        tr.addEventListener("mouseenter", function () { tr.style.background = "#f0f9f5"; });
        tr.addEventListener("mouseleave", function () { tr.style.background = ""; });
        tr.addEventListener("click", function () {
          var acCode = tr.getAttribute("data-accode");
          window.parent.postMessage({
            type:          "PNL_DRILL_DOWN",
            drillLevel:    "l3",
            company_code:  COMPANY_CODE,
            from_date:     FROM_DATE,
            to_date:       TO_DATE,
            division_code: DIVISION_CODE,
            ac_code:       acCode,
          }, "*");
        });
      });
    })();
  </script>` : "";

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif; font-size: 11px; color: #111827;
      background: #eef2f7;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .sheet {
      min-width: 260mm; margin: 14px auto; background: #fff;
      padding: 8mm 10mm; border: 1px solid #aab7c8; border-radius: 4px;
    }
    .logo-area { margin-bottom: 10px; }
    .divider-thick { border-top: 2px solid #000; margin: 7px 0 4px; }
    .divider-thin  { border-top: 1px solid #000; margin: 4px 0 8px; }
    .meta-row { display: flex; align-items: baseline; font-size: 11px; margin-bottom: 2px; }
    .meta-label { font-weight: 700; width: 80px; flex-shrink: 0; }
    .drill-hint {
      font-size: 10px; color: #1a5f4a; background: #f0f9f5;
      border: 1px solid #a7d7c5; border-radius: 4px;
      padding: 4px 10px; margin-bottom: 8px;
      display: inline-flex; align-items: center; gap: 6px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th {
      border: 1px solid #000; padding: 3px 8px;
      text-align: center; font-weight: 700; background: #1a5f4a; color: #fff;
    }
    th.right { text-align: right; }
    td { border: 1px solid #ccc; padding: 2px 8px; }
    td.center { text-align: center; }
    td.left   { text-align: left; }
    td.num    { text-align: right; font-variant-numeric: tabular-nums; font-family: "Courier New", monospace; }
    td.code   { font-family: monospace; font-size: 10px; }
    tr.total-row td {
      border: 2px solid #000; font-weight: 700; background: #a7d7c5;
      text-align: right; font-variant-numeric: tabular-nums;
    }
    tr.total-row td.empty { border: 1px solid #ccc; background: #fff; }
    .balance-neg { color: #c0392b; }
    .end-of-report {
      text-align: center; margin-top: 10px; margin-bottom: 4px;
      font-size: 10px; border-top: 1px solid #ccc; padding-top: 5px; color: #666;
    }
    .report-footer {
      display: flex; justify-content: space-between;
      font-size: 10px; color: #9ca3af;
      border-top: 1px solid #e2e8f0; padding-top: 4px; margin-top: 4px;
    }
    @media print {
      body { background: #fff; }
      .sheet { border: none; margin: 0; width: auto; min-height: auto; padding: 0; border-radius: 0; }
      .drill-hint { display: none !important; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tbody tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="logo-area">
      <svg width="160" height="50" viewBox="0 0 360 112" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <rect width="360" height="112" rx="4" fill="#1a5f4a"/>
        <text x="16" y="46" font-family="Arial" font-size="26" font-weight="700" fill="#d4a017">al madina المدينة</text>
        <text x="16" y="72" font-family="Arial" font-size="15" font-weight="400" fill="#d4a017" letter-spacing="4">LOGISTICS اللوجستية</text>
        <polygon points="310,20 355,56 310,92" fill="#d4a017"/>
      </svg>
    </div>
    <div class="divider-thick"></div>
    <div class="meta-row"><span class="meta-label">Title :</span><span>${escapeHtml(title)}</span></div>
    <div class="meta-row"><span class="meta-label">Period :</span><span>${escapeHtml(dateText(fromDate))} &ndash; ${escapeHtml(dateText(toDate))}</span></div>
    <div class="meta-row"><span class="meta-label">Division :</span><span>${escapeHtml(divisionCode)}</span></div>
    <div class="meta-row"><span class="meta-label">Date :</span><span>${escapeHtml(printDateTime)}</span></div>
    <div class="meta-row"><span class="meta-label">User :</span><span>${escapeHtml(loginId)}</span></div>
    <div class="divider-thin"></div>
    ${drillLevel === "l3"
            ? `<div class="drill-hint">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
             <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
           </svg>
           Click any row to drill down to transaction detail
         </div>`
            : ""}
    ${tableHtml}
    <div class="end-of-report">End of Report</div>
    <div class="report-footer">
      <span>Report: ${escapeHtml(reportName)}</span>
      <span>Powered by Bayanat Technology</span>
    </div>
  </div>
  ${drillScript}
</body>
</html>`;
}

// ─── Shared XLSX styles (used by both L2 and L3 Excel exports) ────────────────

const SUMMARY_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>
  <fonts count="5">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A5F4A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8F8F8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF1A5F4A"/></left><right style="thin"><color rgb="FF1A5F4A"/></right>
      <top style="thin"><color rgb="FF1A5F4A"/></top><bottom style="thin"><color rgb="FF1A5F4A"/></bottom>
      <diagonal/>
    </border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
    <border>
      <left style="medium"><color rgb="FF000000"/></left><right style="medium"><color rgb="FF000000"/></right>
      <top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="4" fillId="3" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ─── XLSX zip builder ─────────────────────────────────────────────────────────

function buildXlsxZip(sheetXml: string, stylesXml: string, sheetName: string): Buffer {
    const safe = sheetName.replace(/[\\/?*[\]]/g, "_").substring(0, 31);

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(safe)}" sheetId="1" r:id="rId1"/></sheets>
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
  <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
    zip.addFile("_rels/.rels", Buffer.from(rels));
    zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
    zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
    zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
    zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
    return zip.toBuffer();
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function sendHtml(res: Response, html: string) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
}

function sendExcel(res: Response, buffer: Buffer, filename: string) {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(buffer);
}

// ─── Helper: build a simple 6-col summary sheet XML ──────────────────────────

function buildSummarySheetXml(
    rows: ReportRow[],
    titleLine: string,
    metaLine: string,
    loginId: string,
    colHeaders: [string, string, string, string, string, string],
    codeField: string,
    totals: {
        opening: number;
        debit: number;
        credit: number;
        amount: number;
    },
): string {
    const SHD = 1; // title
    const SMT = 2; // meta
    const STH = 3; // table header
    const STX = 4; // text cell
    const SNM = 5; // number cell
    const STL = 6; // total label
    const STN = 7; // total number

    const colXml = [{ wch: 14 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.wch}" customWidth="1"/>`)
        .join("");

    const sheetRowsData: any[][] = [
        [titleLine, "", "", "", "", ""],
        [],
        [metaLine, "", "", "", "", ""],
        [],
        [...colHeaders],
    ];

    const DATA_START = sheetRowsData.length + 1;

    rows.forEach((r) => {
        sheetRowsData.push([
            text(r[codeField]),
            text(r.ac_name),
            amount(r.opening),
            amount(r.debit_amount),
            amount(r.credit_amount),
            amount(r.amount),
        ]);
    });

    if (!rows.length) sheetRowsData.push(["", "No data found", "", "", "", ""]);

    const TOTAL_ROW = sheetRowsData.length + 1;
    sheetRowsData.push(["", "", totals.opening, totals.debit, totals.credit, totals.amount]);

    function xc(v: unknown, s: number, ref: string): string {
        if (typeof v === "number")
            return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(v ?? "")}</t></is></c>`;
    }

    let sheetData = "";
    const merges = [
        "A1:F1", "A3:F3",
        `A${TOTAL_ROW}:B${TOTAL_ROW}`,
    ];

    sheetRowsData.forEach((row, ri) => {
        const rn = ri + 1;
        if (!row || !row.length) return;
        let rowXml = `<row r="${rn}"${rn === 1 ? ` ht="22" customHeight="1"` : ""}>`;
        row.forEach((v, ci) => {
            if (v === undefined || v === null || v === "") return;
            const ref = String.fromCharCode(65 + ci) + rn;
            let s = 0;
            if (rn === 1) s = SHD;
            else if (rn === 3) s = SMT;
            else if (rn === 5) s = STH;
            else if (rn === TOTAL_ROW) s = ci < 2 ? STL : STN;
            else if (rn >= DATA_START && ci >= 2) s = SNM;
            else if (rn >= DATA_START) s = STX;
            rowXml += xc(v, s, ref);
        });
        rowXml += "</row>";
        sheetData += rowXml;
    });

    const mergeXml = `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;
}

// ─── Level-2: Account Summary ─────────────────────────────────────────────────

export const getPnlDrilldownL2 = async (
    req: RequestWithUser,
    res: Response
): Promise<void> => {
    let conn: oracledb.Connection | undefined;
    try {
        const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
        const plCode = text(req.body.pl_code);

        if (!plCode)
            throw Object.assign(new Error("pl_code is required"), { status: 400 });

        const sql = `
      SELECT
        TR_AC_DETAIL.company_code,
        TR_AC_DETAIL.ac_code,
        max(ac_name)                                                              ac_name,
        sum(round(lcur_amount * sign_ind, 3))                                     amount,
        00000000000.000000                                                         opening,
        sum(CASE WHEN sign_ind > 0 THEN lcur_amount ELSE 0 END)                   debit_amount,
        sum(CASE WHEN sign_ind < 0 THEN lcur_amount ELSE 0 END)                   credit_amount,
        TR_AC_DETAIL.div_code
      FROM
        TR_AC_DETAIL,
        MS_ACCODES
      WHERE
            TR_AC_DETAIL.ac_code       = MS_ACCODES.ac_code
        AND TR_AC_DETAIL.company_code  = :companyCode
        AND TR_AC_DETAIL.doc_date     >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date     <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ms_accodes.pl_bl_code      = :plCode
        AND TR_AC_DETAIL.doc_type     <> 'EJV'
        AND TR_AC_DETAIL.cancelled    <> 'Y'
        AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
      GROUP BY
        TR_AC_DETAIL.div_code,
        TR_AC_DETAIL.company_code,
        TR_AC_DETAIL.ac_code
      ORDER BY
        TR_AC_DETAIL.ac_code
    `;

        conn = await getConn(req);
        const result = await conn.execute(
            sql,
            { companyCode, fromDate, toDate, plCode, divisionCode },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const rows = normalize(result.rows as any[]);

        const totals = rows.reduce(
            (acc, r) => ({
                opening: acc.opening + amount(r.opening),
                debit: acc.debit + amount(r.debit_amount),
                credit: acc.credit + amount(r.credit_amount),
                amount: acc.amount + amount(r.amount),
            }),
            { opening: 0, debit: 0, credit: 0, amount: 0 }
        );
        const dataRows = rows.map((r) =>
            `<tr data-accode="${escapeHtml(r.ac_code)}">
        <td class="center code">${escapeHtml(r.ac_code)}</td>
        <td class="left">${escapeHtml(r.ac_name)}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.opening)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.debit_amount)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.credit_amount)))}</td>
        <td class="num">${escapeHtml(fmtNumber(amount(r.amount)))}</td>
      </tr>`
        ).join("") || `<tr><td colspan="6" class="center" style="color:#666">No data found</td></tr>`;

        const tableHtml = `
      <table>
        <thead><tr>
          <th style="width:110px">A/C Code</th>
          <th>Account Name</th>
          <th class="right">Opening</th>
          <th class="right">Debit Amount</th>
          <th class="right">Credit Amount</th>
          <th class="right">Amount</th>
        </tr></thead>
        <tbody>${dataRows}</tbody>
        <tfoot><tr class="total-row">
          <td class="empty" colspan="2"></td>
          <td>${escapeHtml(fmtNumber(totals.opening))}</td>
          <td>${escapeHtml(fmtNumber(totals.debit))}</td>
          <td>${escapeHtml(fmtNumber(totals.credit))}</td>
          <td>${escapeHtml(fmtNumber(totals.amount))}</td>
        </tr></tfoot>
      </table>`;

        const title = `Account Summary — PL Code: ${plCode}  |  ${dateText(fromDate)} – ${dateText(toDate)}`;
        sendHtml(
            res,
            buildPage({
                title,
                reportName: "rpt_pnl_drilldown_l2",
                tableHtml,
                drillLevel: "l3",
                companyCode,
                fromDate,
                toDate,
                divisionCode,
                loginId: req.user?.loginid ?? "",
                plCode,
            })
        );
    } catch (error: any) {
        console.error("P&L Drilldown L2 error:", error);
        res.status(error.status || 500).json({ success: false, message: error.message });
    } finally {
        await closeConn(conn);
    }
};

export const getPnlDrilldownL2Excel = async (
    req: RequestWithUser,
    res: Response
): Promise<void> => {
    let conn: oracledb.Connection | undefined;
    try {
        const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
        const plCode = text(req.body.pl_code);

        if (!plCode)
            throw Object.assign(new Error("pl_code is required"), { status: 400 });

        const sql = `
      SELECT TR_AC_DETAIL.company_code, TR_AC_DETAIL.ac_code, max(ac_name) ac_name,
        sum(round(lcur_amount * sign_ind, 3)) amount, 00000000000.000000 opening,
        sum(CASE WHEN sign_ind > 0 THEN lcur_amount ELSE 0 END) debit_amount,
        sum(CASE WHEN sign_ind < 0 THEN lcur_amount ELSE 0 END) credit_amount,
        TR_AC_DETAIL.div_code
      FROM TR_AC_DETAIL, MS_ACCODES
      WHERE TR_AC_DETAIL.ac_code = MS_ACCODES.ac_code
        AND TR_AC_DETAIL.company_code  = :companyCode
        AND TR_AC_DETAIL.doc_date     >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date     <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND ms_accodes.pl_bl_code      = :plCode
        AND TR_AC_DETAIL.doc_type     <> 'EJV'
        AND TR_AC_DETAIL.cancelled    <> 'Y'
        AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
      GROUP BY TR_AC_DETAIL.div_code, TR_AC_DETAIL.company_code, TR_AC_DETAIL.ac_code
      ORDER BY TR_AC_DETAIL.ac_code`;

        conn = await getConn(req);
        const result = await conn.execute(
            sql,
            { companyCode, fromDate, toDate, plCode, divisionCode },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const rows = normalize(result.rows as any[]);

        const totals = rows.reduce<{
            opening: number;
            debit: number;
            credit: number;
            amount: number;
        }>(
            (acc, r) => ({
                opening: acc.opening + amount(r.opening),
                debit: acc.debit + amount(r.debit_amount),
                credit: acc.credit + amount(r.credit_amount),
                amount: acc.amount + amount(r.amount),
            }),
            {
                opening: 0,
                debit: 0,
                credit: 0,
                amount: 0,
            }
        );

        const printDateTime = new Date().toLocaleString("en-GB", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: false,
        });
        const titleLine = `AL MADINA LOGISTICS — P&L Account Summary`;
        const metaLine = `PL: ${plCode}  |  ${dateText(fromDate)} – ${dateText(toDate)}  |  Division: ${divisionCode}  |  User: ${req.user?.loginid ?? ""}  |  Date: ${printDateTime}`;

        const sheetXml = buildSummarySheetXml(
            rows,
            titleLine,
            metaLine,
            req.user?.loginid ?? "",
            ["A/C Code", "Account Name", "Opening", "Debit Amount", "Credit Amount", "Amount"],
            "ac_code",
            totals,
        );

        const buffer = buildXlsxZip(sheetXml, SUMMARY_STYLES_XML, "Account Summary");
        sendExcel(res, buffer, `pnl_l2_${plCode}_${fromDate}_${toDate}.xlsx`.replace(/\//g, "-"));
    } catch (error: any) {
        console.error("P&L Drilldown L2 Excel error:", error);
        res.status(error.status || 500).json({ success: false, message: error.message });
    } finally {
        await closeConn(conn);
    }
};

// ─── Level-3: Transaction Detail ──────────────────────────────────────────────

export const getPnlDrilldownL3 = async (
    req: RequestWithUser,
    res: Response
): Promise<void> => {
    let conn: oracledb.Connection | undefined;
    try {
        const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
        const acCode = text(req.body.ac_code);

        if (!acCode)
            throw Object.assign(new Error("ac_code is required"), { status: 400 });

        const sql = `
      SELECT
        TR_AC_DETAIL.COMPANY_CODE,
        TR_AC_DETAIL.DOC_TYPE,
        TR_AC_DETAIL.DOC_NO,
        TR_AC_DETAIL.DOC_DATE,
        TR_AC_DETAIL.AC_CODE,
        TR_AC_DETAIL.REMARKS,
        TR_AC_DETAIL.AMOUNT,
        TR_AC_DETAIL.SIGN_IND,
        TR_AC_DETAIL.CURR_CODE,
        TR_AC_DETAIL.EX_RATE,
        TR_AC_DETAIL.LCUR_AMOUNT,
        TR_AC_DETAIL.PDC_IND,
        TR_AC_DETAIL.CHEQUE_NO,
        TR_AC_DETAIL.CHEQUE_DATE,
        TR_AC_DETAIL.CHEQUE_DESC,
        TR_AC_DETAIL.PDC_CLEARED_DATE,
        MS_ACCODES_A.AC_NAME,
        MS_ACCODES_B.AC_NAME  bank_ac_name,
        MS_ACCODES_A.CURR_CODE ac_curr_code,
        000000000.000          op_balance,
        (
          SELECT MAX(OTHER_REMARKS)
          FROM   TR_AC_LPO_DETAIL l
          WHERE  l.company_code        = TR_AC_DETAIL.company_code
            AND  l.doc_type            = NVL(TR_AC_DETAIL.REF_DOC_TYPE,    ' ')
            AND  l.doc_no              = NVL(TR_AC_DETAIL.REF_DOC_NO,        0)
            AND  l.serial_no           = NVL(TR_AC_DETAIL.REF_DOC_SERIAL_NO, 0)
        ) lpo_otherremarks,
        (
          SELECT ref_no
          FROM   TR_AC_HEADER th
          WHERE  th.company_code = TR_AC_DETAIL.company_code
            AND  th.doc_type     = NVL(TR_AC_DETAIL.doc_type, ' ')
            AND  th.doc_no       = NVL(TR_AC_DETAIL.doc_no,   0)
        ) ref_inv_no,
        (
          SELECT ref_date
          FROM   TR_AC_HEADER th
          WHERE  th.company_code = TR_AC_DETAIL.company_code
            AND  th.doc_type     = NVL(TR_AC_DETAIL.doc_type, ' ')
            AND  th.doc_no       = NVL(TR_AC_DETAIL.doc_no,   0)
        ) ref_inv_dt,
        TR_AC_DETAIL.DIV_CODE
      FROM
        TR_AC_DETAIL,
        MS_ACCODES MS_ACCODES_A,
        MS_ACCODES MS_ACCODES_B
      WHERE
            TR_AC_DETAIL.ac_code       = MS_ACCODES_A.ac_code(+)
        AND TR_AC_DETAIL.bank_ac_code  = MS_ACCODES_B.ac_code(+)
        AND TR_AC_DETAIL.company_code  = :companyCode
        AND TR_AC_DETAIL.ac_code       = :acCode
        AND TR_AC_DETAIL.doc_date     >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date     <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND TR_AC_DETAIL.cancelled    <> 'Y'
        AND TR_AC_DETAIL.doc_type     <> 'UJV'
        AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
      ORDER BY
        TR_AC_DETAIL.doc_date,
        TR_AC_DETAIL.doc_no
    `;

        conn = await getConn(req);
        const result = await conn.execute(
            sql,
            { companyCode, acCode, fromDate, toDate, divisionCode },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const rows = normalize(result.rows as any[]);

        const acName = text(rows[0]?.ac_name);
        let runBalance = 0;
        let totalDebit = 0;
        let totalCredit = 0;

        const dataRows = rows.map((r) => {
            const debit = amount(r.sign_ind) >= 0 ? Math.abs(amount(r.lcur_amount)) : 0;
            const credit = amount(r.sign_ind) < 0 ? Math.abs(amount(r.lcur_amount)) : 0;
            runBalance += debit - credit;
            totalDebit += debit;
            totalCredit += credit;

            const balClass = runBalance < 0 ? "balance-neg" : "";
            return `<tr>
        <td class="center">${escapeHtml(text(r.doc_type))}</td>
        <td class="center">${escapeHtml(text(r.doc_no ?? ""))}</td>
        <td class="center">${escapeHtml(dateText(r.doc_date))}</td>
        <td class="left">${escapeHtml(text(r.remarks ?? ""))}</td>
        <td class="center">${escapeHtml(text(r.cheque_no ?? ""))}</td>
        <td class="center">${escapeHtml(dateText(r.cheque_date))}</td>
        <td class="left">${escapeHtml(text(r.bank_ac_name ?? ""))}</td>
        <td class="num">${debit > 0 ? escapeHtml(fmtNumber(debit)) : ""}</td>
        <td class="num">${credit > 0 ? escapeHtml(fmtNumber(credit)) : ""}</td>
        <td class="num ${balClass}">${escapeHtml(fmtNumber(runBalance))}</td>
      </tr>`;
        }).join("") || `<tr><td colspan="10" class="center" style="color:#666">No transactions found</td></tr>`;

        const tableHtml = `
      <table>
        <thead><tr>
          <th style="width:50px">Type</th>
          <th style="width:65px">Doc No.</th>
          <th style="width:82px">Doc Date</th>
          <th>Remarks</th>
          <th style="width:80px">Chq No.</th>
          <th style="width:82px">Chq Date</th>
          <th style="width:140px">Bank</th>
          <th class="right" style="width:110px">Debit</th>
          <th class="right" style="width:110px">Credit</th>
          <th class="right" style="width:120px">Balance</th>
        </tr></thead>
        <tbody>
          <tr style="background:#f0f9f5">
            <td colspan="10" style="font-weight:700; color:#1a5f4a; padding:4px 8px">
              ${escapeHtml(acCode)} &mdash; ${escapeHtml(acName)}
            </td>
          </tr>
          ${dataRows}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td class="empty" colspan="7" style="text-align:left;padding-left:12px">
              Total &mdash; ${escapeHtml(acName)}
            </td>
            <td>${escapeHtml(fmtNumber(totalDebit))}</td>
            <td>${escapeHtml(fmtNumber(totalCredit))}</td>
            <td>${escapeHtml(fmtNumber(runBalance))}</td>
          </tr>
        </tfoot>
      </table>`;

        const title = `Transaction Detail — ${acCode} ${acName}  |  ${dateText(fromDate)} – ${dateText(toDate)}`;
        sendHtml(
            res,
            buildPage({
                title,
                reportName: "rpt_pnl_drilldown_l3",
                tableHtml,
                drillLevel: null,   // no further drill-down from L3
                companyCode,
                fromDate,
                toDate,
                divisionCode,
                loginId: req.user?.loginid ?? "",
                acCode,
            })
        );
    } catch (error: any) {
        console.error("P&L Drilldown L3 error:", error);
        res.status(error.status || 500).json({ success: false, message: error.message });
    } finally {
        await closeConn(conn);
    }
};

export const getPnlDrilldownL3Excel = async (
    req: RequestWithUser,
    res: Response
): Promise<void> => {
    let conn: oracledb.Connection | undefined;
    try {
        const { companyCode, fromDate, toDate, divisionCode } = parseCommon(req);
        const acCode = text(req.body.ac_code);

        if (!acCode)
            throw Object.assign(new Error("ac_code is required"), { status: 400 });

        const sql = `
      SELECT TR_AC_DETAIL.COMPANY_CODE, TR_AC_DETAIL.DOC_TYPE, TR_AC_DETAIL.DOC_NO,
        TR_AC_DETAIL.DOC_DATE, TR_AC_DETAIL.AC_CODE, TR_AC_DETAIL.REMARKS,
        TR_AC_DETAIL.SIGN_IND, TR_AC_DETAIL.LCUR_AMOUNT,
        TR_AC_DETAIL.CHEQUE_NO, TR_AC_DETAIL.CHEQUE_DATE,
        MS_ACCODES_A.AC_NAME, MS_ACCODES_B.AC_NAME bank_ac_name,
        000000000.000 op_balance, TR_AC_DETAIL.DIV_CODE
      FROM TR_AC_DETAIL, MS_ACCODES MS_ACCODES_A, MS_ACCODES MS_ACCODES_B
      WHERE TR_AC_DETAIL.ac_code      = MS_ACCODES_A.ac_code(+)
        AND TR_AC_DETAIL.bank_ac_code = MS_ACCODES_B.ac_code(+)
        AND TR_AC_DETAIL.company_code  = :companyCode
        AND TR_AC_DETAIL.ac_code       = :acCode
        AND TR_AC_DETAIL.doc_date     >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        AND TR_AC_DETAIL.doc_date     <  TO_DATE(:toDate,   'YYYY-MM-DD')
        AND TR_AC_DETAIL.cancelled    <> 'Y'
        AND TR_AC_DETAIL.doc_type     <> 'UJV'
        AND ('All' = :divisionCode OR TR_AC_DETAIL.div_code = :divisionCode)
      ORDER BY TR_AC_DETAIL.doc_date, TR_AC_DETAIL.doc_no`;

        conn = await getConn(req);
        const result = await conn.execute(
            sql,
            { companyCode, acCode, fromDate, toDate, divisionCode },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const rows = normalize(result.rows as any[]);

        const acName = text(rows[0]?.ac_name);
        const printDateTime = new Date().toLocaleString("en-GB", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: false,
        });

        // 10-column transaction ledger Excel
        const headers = ["Type", "Doc No.", "Doc Date", "Remarks", "Chq No.", "Chq Date", "Bank", "Debit", "Credit", "Balance"];
        const colWidths = [8, 10, 12, 30, 12, 12, 22, 16, 16, 16];

        const SHD = 1; const SMT = 2; const STH = 3;
        const STX = 4; const SNM = 5; const STL = 6; const STN = 7;

        const sheetRowsData: any[][] = [
            [`AL MADINA LOGISTICS — P&L Transaction Detail`, ...Array(9).fill("")],
            [],
            [`${acCode} — ${acName}  |  ${dateText(fromDate)} – ${dateText(toDate)}  |  Division: ${divisionCode}`, ...Array(9).fill("")],
            [`Date: ${printDateTime}   User: ${req.user?.loginid ?? ""}`, ...Array(9).fill("")],
            [],
            headers,
        ];

        const DATA_START = sheetRowsData.length + 1;
        let runBalance = 0;
        let totalDebit = 0;
        let totalCredit = 0;

        for (const r of rows) {
            const debit = amount(r.sign_ind) >= 0 ? Math.abs(amount(r.lcur_amount)) : 0;
            const credit = amount(r.sign_ind) < 0 ? Math.abs(amount(r.lcur_amount)) : 0;
            runBalance += debit - credit;
            totalDebit += debit;
            totalCredit += credit;

            sheetRowsData.push([
                text(r.doc_type),
                text(r.doc_no ?? ""),
                dateText(r.doc_date),
                text(r.remarks ?? ""),
                text(r.cheque_no ?? ""),
                dateText(r.cheque_date),
                text(r.bank_ac_name ?? ""),
                debit > 0 ? debit : "",
                credit > 0 ? credit : "",
                runBalance,
            ]);
        }

        if (!rows.length) sheetRowsData.push(["No transactions found", ...Array(9).fill("")]);

        const TOTAL_ROW = sheetRowsData.length + 1;
        sheetRowsData.push([`Total — ${acName}`, "", "", "", "", "", "", totalDebit, totalCredit, runBalance]);

        const colXml = colWidths
            .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
            .join("");

        function xc(v: unknown, s: number, ref: string): string {
            if (typeof v === "number")
                return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
            return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(v ?? "")}</t></is></c>`;
        }

        let sheetData = "";
        const merges = [
            "A1:J1", "A3:J3", "A4:J4",
            `A${TOTAL_ROW}:G${TOTAL_ROW}`,
        ];

        sheetRowsData.forEach((row, ri) => {
            const rn = ri + 1;
            if (!row || !row.length) return;
            let rowXml = `<row r="${rn}"${rn === 1 ? ` ht="20" customHeight="1"` : ""}>`;
            row.forEach((v, ci) => {
                if (v === "" || v === null || v === undefined) return;
                const ref = String.fromCharCode(65 + ci) + rn;
                let s = 0;
                if (rn === 1) s = SHD;
                else if (rn === 3 || rn === 4) s = SMT;
                else if (rn === 6) s = STH;
                else if (rn === TOTAL_ROW) s = ci < 7 ? STL : STN;
                else if (rn >= DATA_START && ci >= 7) s = SNM;
                else if (rn >= DATA_START) s = STX;
                rowXml += xc(v, s, ref);
            });
            rowXml += "</row>";
            sheetData += rowXml;
        });

        const mergeXml = `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;

        const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colXml}</cols>
  <sheetData>${sheetData}</sheetData>
  ${mergeXml}
</worksheet>`;

        const buffer = buildXlsxZip(sheetXml, SUMMARY_STYLES_XML, "Transaction Detail");
        sendExcel(res, buffer, `pnl_l3_${acCode}_${fromDate}_${toDate}.xlsx`.replace(/\//g, "-"));
    } catch (error: any) {
        console.error("P&L Drilldown L3 Excel error:", error);
        res.status(error.status || 500).json({ success: false, message: error.message });
    } finally {
        await closeConn(conn);
    }
};