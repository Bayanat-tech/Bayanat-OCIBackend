import { Request, Response } from "express";
import oracledb from "oracledb";
// @ts-ignore
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const money = (v: any) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};
const text = (v: any) => (v == null ? "" : String(v));
const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};
const formatBalance = (value: number) =>
  value < 0 ? `(${money(Math.abs(value))})` : money(value);

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Shared DB fetch ──────────────────────────────────────────────────────────
async function fetchRows(req: Request) {
  const { parameter, loginid, code1, code2, code3, code4, code5, code6, code7, code8, code20 } = req.body;

  let tenantId = getCurrentTenantId();
  if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
  if (!tenantId) throw new Error("Tenant not found");

  const connection = await TenantManager.getConnection(tenantId);
  try {
    const binds: any = {
      parameter: parameter || "Account_Report_Ledger_Details",
      loginid: loginid || "ADMIN",
      code1: code1 || null, code2: code2 || null, code3: code3 || null,
      code4: code4 || null, code5: code5 || null, code6: code6 || null,
      code7: code7 || null, code8: code8 || null, code20: code20 || null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };
    for (let i = 9; i <= 20; i++) binds[`code${i}`] = req.body[`code${i}`] || null;
    for (let i = 1; i <= 4; i++) {
      binds[`number${i}`] = req.body[`number${i}`] || null;
      if (i > 2) binds[`date${i}`] = req.body[`date${i}`] || null;
    }
    binds.date1 = null;
    binds.date2 = null;

    const result = await connection.execute(
      `DECLARE v_sql VARCHAR2(32767); BEGIN PROC_BUILD_DYNAMIC_SQL_COMMON20(
          :parameter, :loginid,
          :code1, :code2, :code3, :code4, :code5, :code6, :code7, :code8, :code9, :code10,
          :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
          :number1, :number2, :number3, :number4,
          :date1, :date2, :date3, :date4,
          v_sql); :out_sql := v_sql; END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("The procedure did not return a valid SQL query.");
    console.log("Generated SQL for Ledger With Details Report:", rawSql);

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return {
      rows: (dataResult.rows as any[]).map((row) =>
        Object.keys(row).reduce((acc: any, key) => {
          acc[key.toLowerCase()] = row[key];
          return acc;
        }, {})
      ),
      connection,
    };
  } catch (e) {
    await connection.close();
    throw e;
  }
}

// ─── Excel Style IDs ──────────────────────────────────────────────────────────
const STYLE_ID = {
  default:     0,
  company:     1,
  title:       2,
  section:     3,
  tableHead:   4,
  normal:      5,
  numData:     6,
  groupHeader: 7,
  subGroup:    8,
  totalRow:    9,
  numTotal:    10,
  grandTotal:  11,
  numGrand:    12,
  narration:   13,
} as const;
type StyleKey = keyof typeof STYLE_ID;
interface XlCell { v: unknown; s: number }
function xc(v: unknown, style: StyleKey): XlCell { return { v, s: STYLE_ID[style] }; }

// ─── Excel Buffer Builder ─────────────────────────────────────────────────────
function buildLedgerWithDetailsExcelBuffer(
  rows: any[],
  loginid: string,
  parameter: string,
  code5: string,
  code6: string
): Buffer {
  type Row = (XlCell | null)[];
  const skip = null;
  const NCOLS = 9;

  const tableRows: Row[] = [];

  // Row 1 — Company
  tableRows.push([xc("AL MADINA LOGISTICS SERVICES COMPANY", "company"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 2 — Report Title
  tableRows.push([xc(`Ledger With Details Report ${code5} - ${code6}`, "title"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 3 — Date | User
  tableRows.push([
    xc(`Date : ${formatDateStr(new Date())}`, "section"),
    ...Array(3).fill(skip),
    xc(`User : ${loginid}`, "section"),
    ...Array(3).fill(skip),
  ]);

  // Row 4 — Parameter
  tableRows.push([xc(`Report : ${text(parameter)}`, "section"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 5 — Spacer
  tableRows.push(Array(NCOLS).fill(skip));

  // Row 6 — Table Header
  tableRows.push([
    xc("Type",      "tableHead"),
    xc("Doc No.",   "tableHead"),
    xc("Doc Date",  "tableHead"),
    xc("Chq No.",   "tableHead"),
    xc("Chq Date",  "tableHead"),
    xc("Bank",      "tableHead"),
    xc("Debit",     "tableHead"),
    xc("Credit",    "tableHead"),
    xc("Balance",   "tableHead"),
  ]);

  // ── Group by ac_code + ac_name ────────────────────────────────────────────
  const groups: Record<string, any[]> = {};
  rows.forEach((r) => {
    const key = `${r.ac_code}||${r.ac_name || ""}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  let grandTotalDebit  = 0;
  let grandTotalCredit = 0;

  Object.entries(groups).forEach(([key, groupRows]) => {
    const [ac_code, ac_name] = key.split("||");
    const opening = Number(groupRows[0]?.op_balance) || 0;
    let totalDebit     = 0;
    let totalCredit    = 0;
    let runningBalance = opening;

    // Account header row
    tableRows.push([
      xc(`${text(ac_code)}  ${text(ac_name)}`, "groupHeader"),
      ...Array(5).fill(skip),
      xc("Opening",  "groupHeader"),
      xc(opening,    "numTotal"),
      skip,
    ]);

    // PDC / Normal sub-groups
    const pdcGroups: Record<string, any[]> = {};
    groupRows.forEach((r) => {
      const k = r.pdc_ind === "Y" ? "PDC" : "NORMAL";
      if (!pdcGroups[k]) pdcGroups[k] = [];
      pdcGroups[k].push(r);
    });

    Object.entries(pdcGroups).forEach(([pdcType, pdcRows]) => {
      tableRows.push([
        xc(pdcType === "PDC" ? "PDC CHEQUES" : "NORMAL CHEQUES", "subGroup"),
        ...Array(NCOLS - 1).fill(skip),
      ]);

      pdcRows.forEach((r) => {
        const amount = Number(r.lcur_amount) || 0;
        const dr = r.sign_ind > 0 ? amount : 0;
        const cr = r.sign_ind < 0 ? Math.abs(amount) : 0;
        totalDebit     += dr;
        totalCredit    += cr;
        runningBalance += dr - cr;

        tableRows.push([
          xc(text(r.doc_type    || ""), "normal"),
          xc(text(r.doc_no      || ""), "normal"),
          xc(formatDateStr(r.doc_date), "normal"),
          xc(text(r.cheque_no   || ""), "normal"),
          xc(formatDateStr(r.cheque_date), "normal"),
          xc(text(r.bank        || ""), "normal"),
          xc(dr,                         "numData"),
          xc(cr,                         "numData"),
          xc(formatBalance(runningBalance), "numData"),
        ]);

        // Narration row
        const narration = text(r.narration || r.remarks || r.details || "").trim();
        if (narration) {
          tableRows.push([
            xc(narration, "narration"),
            ...Array(NCOLS - 1).fill(skip),
          ]);
        }
      });
    });

    grandTotalDebit  += totalDebit;
    grandTotalCredit += totalCredit;
    const closing = opening + totalDebit - totalCredit;

    // Total row
    tableRows.push([
      ...Array(4).fill(skip),
      xc("Total :",       "totalRow"),
      skip,
      xc(totalDebit,      "numTotal"),
      xc(totalCredit,     "numTotal"),
      skip,
    ]);

    // Closing row
    tableRows.push([
      ...Array(6).fill(skip),
      xc("Closing",           "totalRow"),
      xc(formatBalance(closing), "numTotal"),
      skip,
    ]);
  });

  // Grand total row
  tableRows.push([
    ...Array(4).fill(skip),
    xc("Grand Total :",       "grandTotal"),
    skip,
    xc(grandTotalDebit,       "numGrand"),
    xc(grandTotalCredit,      "numGrand"),
    skip,
  ]);

  // ── Build merges ──────────────────────────────────────────────────────────
  const merges: string[] = [];
  tableRows.forEach((row, ri) => {
    const rn = ri + 1;
    let ci = 0;
    while (ci < row.length) {
      if (row[ci] !== null) {
        let end = ci + 1;
        while (end < row.length && row[end] === null) end++;
        if (end - 1 > ci) {
          merges.push(
            String.fromCharCode(65 + ci) + rn + ":" +
            String.fromCharCode(65 + end - 1) + rn
          );
        }
        ci = end;
      } else {
        ci++;
      }
    }
  });

  // ── Sheet XML ─────────────────────────────────────────────────────────────
  const COL_WIDTHS = [8, 14, 12, 14, 12, 20, 14, 14, 14];
  const colXml = COL_WIDTHS.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  ).join("");

  let sheetDataXml = "";
  tableRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht =
      rn === 1 ? ` ht="24" customHeight="1"` :
      rn === 2 ? ` ht="20" customHeight="1"` :
      rn === 6 ? ` ht="28" customHeight="1"` : "";

    let rowXml = `<row r="${rn}"${ht}>`;
    row.forEach((cell, ci) => {
      if (cell === null) return;
      const ref = String.fromCharCode(65 + ci) + rn;
      if (typeof cell.v === "number") {
        rowXml += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
      } else {
        rowXml += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v ?? "")}</t></is></c>`;
      }
    });
    rowXml += "</row>";
    sheetDataXml += rowXml;
  });

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colXml}</cols>` +
    `<sheetData>${sheetDataXml}</sheetData>` +
    mergeXml +
    `</worksheet>`;

  // ── Styles XML ────────────────────────────────────────────────────────────
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="11">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0D4D89"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCFD8E3"/></left>
      <right style="thin"><color rgb="FFCFD8E3"/></right>
      <top style="thin"><color rgb="FFCFD8E3"/></top>
      <bottom style="thin"><color rgb="FFCFD8E3"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FF0D4D89"/></left>
      <right style="thin"><color rgb="FF0D4D89"/></right>
      <top style="thin"><color rgb="FF0D4D89"/></top>
      <bottom style="thin"><color rgb="FF0D4D89"/></bottom>
    </border>
    <border>
      <top style="thin"><color rgb="FF94A3B8"/></top>
      <bottom style="thin"><color rgb="FF94A3B8"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="7" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="8" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="9" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="9" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="10" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="10" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1" indent="2"/></xf>
  </cellXfs>
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0.000"/>
  </numFmts>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Ledger With Details" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml",        Buffer.from(contentTypes));
  zip.addFile("_rels/.rels",                Buffer.from(rels));
  zip.addFile("xl/workbook.xml",            Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml",   Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml",              Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── HTML Controller ──────────────────────────────────────────────────────────
export const getLedgerWithDetailsReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { parameter, loginid, code5, code6 } = req.body;
    const { rows, connection: conn } = await fetchRows(req);
    connection = conn;

    const groups: Record<string, any[]> = {};
    rows.forEach((r) => {
      const key = `${r.ac_code}||${r.ac_name || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    const formatBalance = (value: number) =>
      value < 0 ? `(${money(Math.abs(value))})` : money(value);

    let tableBodyHtml = "";
    let grandTotalDebit = 0, grandTotalCredit = 0;

    Object.entries(groups).forEach(([key, groupRows]) => {
      const [ac_code, ac_name] = key.split("||");
      const opening = Number(groupRows[0]?.op_balance) || 0;
      let totalDebit = 0, totalCredit = 0;
      let runningBalance = opening;

      tableBodyHtml += `
        <tr class="grp-hdr">
          <td colspan="6"><strong>${text(ac_code)}</strong>&nbsp;&nbsp;${text(ac_name)}</td>
          <td class="opening-label" style="text-align:right"><strong>Opening</strong></td>
          <td class="num opening-val" colspan="2"><strong>${formatBalance(opening)}</strong></td>
        </tr>`;

      const pdcGroups: Record<string, any[]> = {};
      groupRows.forEach((r) => {
        const k = r.pdc_ind === "Y" ? "PDC" : "NORMAL";
        if (!pdcGroups[k]) pdcGroups[k] = [];
        pdcGroups[k].push(r);
      });

      Object.entries(pdcGroups).forEach(([pdcType, pdcRows]) => {
        tableBodyHtml += `
          <tr class="sub-grp-hdr">
            <td colspan="9"><strong>${pdcType === "PDC" ? "PDC CHEQUES" : "NORMAL CHEQUES"}</strong></td>
          </tr>`;

        pdcRows.forEach((r) => {
          const amount = Number(r.lcur_amount) || 0;
          const dr = r.sign_ind > 0 ? amount : 0;
          const cr = r.sign_ind < 0 ? Math.abs(amount) : 0;
          totalDebit   += dr;
          totalCredit  += cr;
          runningBalance += dr - cr;

          const narration = text(r.narration || r.remarks || r.details || "").trim();

          tableBodyHtml += `
            <tr class="data-row">
              <td>${text(r.doc_type || "")}</td>
              <td>${text(r.doc_no || "")}</td>
              <td>${formatDateStr(r.doc_date)}</td>
              <td>${text(r.cheque_no || "")}</td>
              <td>${formatDateStr(r.cheque_date)}</td>
              <td>${text(r.bank || "")}</td>
              <td class="num" style="color:#b45309">${money(dr)}</td>
              <td class="num" style="color:#b45309">${money(cr)}</td>
              <td class="num">${formatBalance(runningBalance)}</td>
            </tr>
            ${narration ? `
            <tr class="data-row">
              <td colspan="9" style="border-top:none; text-align:center; font-style:italic; color:#475569; font-size:10px; padding:0 5px 4px;">
                ${narration}
              </td>
            </tr>` : ""}`;
        });
      });

      grandTotalDebit  += totalDebit;
      grandTotalCredit += totalCredit;
      const closing = opening + totalDebit - totalCredit;

      tableBodyHtml += `
        <tr class="total-row">
          <td colspan="5" style="text-align:right"><strong>Total :</strong></td>
          <td class="num" colspan="2"><strong>${money(totalDebit)}</strong></td>
          <td class="num"><strong>${money(totalCredit)}</strong></td>
          <td></td>
        </tr>
        <tr class="closing-row">
          <td colspan="7" style="text-align:right"><strong>Closing</strong></td>
          <td class="num" colspan="2"><strong>${formatBalance(closing)}</strong></td>
        </tr>`;
    });

    tableBodyHtml += `
      <tr class="grand-row">
        <td colspan="5" style="text-align:right"><strong>Grand Total :</strong></td>
        <td class="num" colspan="2"><strong>${formatBalance(grandTotalDebit)}</strong></td>
        <td class="num"><strong>${formatBalance(grandTotalCredit)}</strong></td>
        <td></td>
      </tr>`;

    const reportTitle = `Ledger With Details Report ${text(code5)} - ${text(code6)}`;
    const generatedBy = text(loginid) || "Unknown User";
    const reportDate  = formatDateStr(new Date());

    const reportHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${reportTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; background: #e5e7eb; color: #111; padding: 10px; }
    .page { width: 277mm; max-width: 277mm; margin: 10px auto; background: #fff; padding: 14px 16px; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
    .header { display: flex; align-items: flex-start; gap: 16px; border-bottom: 2.5px solid #b8860b; padding-bottom: 10px; margin-bottom: 12px; }
    .logo-block { background: #1a5276; padding: 8px 14px; border-radius: 4px; min-width: 150px; text-align: center; }
    .logo-arabic { font-size: 12px; font-weight: 700; color: #f0c040; direction: rtl; }
    .logo-name   { font-size: 18px; font-weight: 800; color: #f0c040; letter-spacing: 0.04em; }
    .logo-sub    { font-size: 9px; letter-spacing: 0.18em; color: #cce0f5; margin-top: 2px; }
    .meta-block { flex: 1; }
    .meta-block table { border-collapse: collapse; }
    .meta-block td { padding: 1.5px 6px; font-size: 11px; vertical-align: top; }
    .meta-block .lbl { font-weight: 700; color: #333; width: 72px; }
    .page-info { font-size: 10px; color: #555; white-space: nowrap; text-align: right; }
    table.rt { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10.5px; }
    table.rt th { background: #1a5276; color: #fff; font-weight: 600; padding: 5px; border: 1px solid #2471a3; text-align: center; }
    table.rt td { border: 1px solid #d5d8dc; padding: 3px 5px; vertical-align: top; }
    tr.sub-hdr th { background: #d6e4f0; color: #1a3c6e; font-size: 10px; font-weight: 600; border-top: none; text-align: center; }
    tr.grp-hdr td { background: #eaf2fb; font-weight: 700; color: #1a3c6e; border-top: 2px solid #2471a3; padding: 5px; }
    .opening-label { color: #c00; font-weight: 700; }
    .opening-val   { color: #c00; font-weight: 700; font-family: 'Courier New', monospace; }
    tr.sub-grp-hdr td { background: #f8fafc; font-weight: 700; color: #374151; padding: 3px 5px; border-top: 1px solid #cbd5e1; }
    tr.data-row td { background: #fff; }
    tr.total-row td { background: #eaf0fb; font-weight: 700; border-top: 1.5px solid #2471a3; }
    tr.closing-row td { background: #eaf0fb; font-weight: 700; }
    tr.grand-row td { background: #d4e6f1; font-weight: 700; border-top: 2px solid #1a5276; }
    .num { text-align: right; font-family: 'Courier New', monospace; white-space: nowrap; }
    table.rt col.c1 { width: 6%;  } table.rt col.c2 { width: 11%; } table.rt col.c3 { width: 9%;  }
    table.rt col.c4 { width: 10%; } table.rt col.c5 { width: 9%;  } table.rt col.c6 { width: 14%; }
    table.rt col.c7 { width: 11%; } table.rt col.c8 { width: 11%; } table.rt col.c9 { width: 12%; }
    .footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #d5d8dc; font-size: 10px; color: #777; text-align: center; }
    .no-print { margin-bottom: 10px; text-align: right; }
    .btn { padding: 7px 20px; background: #1a5276; color: #fff; border: none; border-radius: 4px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn:hover { background: #154360; }
    @media print { body { background: #fff; padding: 0; } .page { box-shadow: none; margin: 0; border-radius: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
<div class="no-print"><button class="btn" onclick="window.print()">Print / Save PDF</button></div>
<div class="page">
  <div class="header">
    <div class="logo-block">
      <div class="logo-arabic">المدينة اللوجستية</div>
      <div class="logo-name">al madina</div>
      <div class="logo-sub">L O G I S T I C S</div>
    </div>
    <div class="meta-block">
      <table>
        <tr><td class="lbl">Title :</td><td>${reportTitle}</td></tr>
        <tr><td class="lbl">Date :</td><td>${reportDate}</td></tr>
        <tr><td class="lbl">User :</td><td>${generatedBy}</td></tr>
        <tr><td class="lbl">Report :</td><td>${text(parameter)}</td></tr>
        <tr><td class="lbl">Currency :</td><td>OMR</td></tr>
      </table>
    </div>
    <div class="page-info">Page 1 of 1</div>
  </div>
  <table class="rt">
    <colgroup>
      <col class="c1"/><col class="c2"/><col class="c3"/>
      <col class="c4"/><col class="c5"/><col class="c6"/>
      <col class="c7"/><col class="c8"/><col class="c9"/>
    </colgroup>
    <thead>
      <tr>
        <th>Type</th><th>Doc No.</th><th>Doc Date</th>
        <th>Chq No.</th><th>Chq Date</th><th>Bank</th>
        <th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th>
      </tr>
      <tr class="sub-hdr">
        <th colspan="2">Salesman Code/Name</th>
        <th colspan="4">Ref Ac Code/ Name</th>
        <th colspan="3"></th>
      </tr>
    </thead>
    <tbody>${tableBodyHtml || '<tr><td colspan="9" style="text-align:center;padding:36px 0;color:#888;">No records found.</td></tr>'}</tbody>
  </table>
  <div class="footer">Generated by ${generatedBy} &bull; ${reportDate}</div>
</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Ledger With Details Report Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};

// ─── Excel Controller ─────────────────────────────────────────────────────────
export const exportLedgerWithDetailsExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { parameter, loginid, code5, code6 } = req.body;
    const { rows, connection: conn } = await fetchRows(req);
    connection = conn;

    const buffer = buildLedgerWithDetailsExcelBuffer(
      rows,
      text(loginid) || "ADMIN",
      text(parameter),
      text(code5),
      text(code6)
    );

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="LedgerWithDetailsReport.xlsx"`);
    res.send(buffer);

  } catch (error: any) {
    console.error("Ledger With Details Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};