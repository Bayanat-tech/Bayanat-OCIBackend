import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import TenantManager from "../../database/TenantManager";
// @ts-ignore
const AdmZip = require("adm-zip");
// import TenantManager from "../../../../database/TenantManager";
// import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const text = (v: any) => (v == null ? "" : String(v));
const num = (v: any) => Number(v) || 0;

const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

const yesNo = (v: any) => {
  const s = text(v).trim().toUpperCase();
  if (s === "Y" || s === "YES") return "Yes";
  if (s === "N" || s === "NO") return "No";
  return s || "—";
};

function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Style IDs ────────────────────────────────────────────────────────────────
const STYLE_ID = {
  default:    0,
  company:    1, // navy bg, white bold 18, centered
  title:      2, // white bg, dark bold 14, centered
  section:    3, // white bg, dark bold 11
  tableHead:  4, // navy bg, white bold 11
  normal:     5, // normal data
  numData:    6, // right-align #,##0.000
  totalLabel: 7, // bold label (grand total / totals row)
  totalNum:   8, // bold right-align #,##0.000
} as const;
type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }
const xc = (v: unknown, style: StyleKey): XlCell => ({ v, s: STYLE_ID[style] });
const skip = null;

// ─── Excel Buffer Builder ─────────────────────────────────────────────────────
function buildCapexApprovalExcelBuffer(header: any, items: any[]): Buffer {
  // 7 columns: Item Code | Item Description | Rate | Qty | Amount | VAT | Grand Total
  const NCOLS = 7;
  const COL_WIDTHS = [18, 34, 12, 10, 14, 12, 14];

  type Row = (XlCell | null)[];
  const tableRows: Row[] = [];

  // ── Header rows ──────────────────────────────────────────────────────────
  // Row 1 — Company
  tableRows.push([xc("AL MADINA LOGISTIC SERVICES CO SAOC", "company"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 2 — Title
  tableRows.push([xc("Capex Approval Form", "title"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 3 — Date | Req No
  tableRows.push([
    xc(`Date : ${formatDateStr(header.request_date || new Date())}`, "section"),
    ...Array(3).fill(skip),
    xc(`Req No : ${text(header.request_number)}`, "section"),
    ...Array(NCOLS - 5).fill(skip),
  ]);

  // Row 4 — Supplier | Budgeted | Board Approved
  tableRows.push([
    xc(
      `Supplier : ${text(header.supplier)}   |   Budgeted : ${yesNo(header.budgeted)}   |   Board Approved : ${yesNo(header.board_approval)}`,
      "section"
    ),
    ...Array(NCOLS - 1).fill(skip),
  ]);

  // Row 5 — Spacer
  tableRows.push(Array(NCOLS).fill(skip));

  // Row 6 — Table header
  tableRows.push([
    xc("Item Code",        "tableHead"),
    xc("Item Description", "tableHead"),
    xc("Rate (RO)",        "tableHead"),
    xc("Quantity",         "tableHead"),
    xc("Amount",           "tableHead"),
    xc("VAT",              "tableHead"),
    xc("Grand Total",      "tableHead"),
  ]);

  // ── Item rows ─────────────────────────────────────────────────────────────
  let totalAmount = 0;
  let totalVat = 0;
  let totalGrand = 0;

  items.forEach((it) => {
    const amount = num(it.amount);
    const vat = num(it.tx_compnt_amt_1);
    const grandTotal = amount + vat;

    totalAmount += amount;
    totalVat += vat;
    totalGrand += grandTotal;

    tableRows.push([
      xc(text(it.item_code), "normal"),
      xc(text(it.item_desp), "normal"),
      xc(num(it.item_rate), "numData"),
      xc(num(it.item_qty), "numData"),
      xc(amount, "numData"),
      xc(vat, "numData"),
      xc(grandTotal, "numData"),
    ]);
  });

  // ── Totals row ────────────────────────────────────────────────────────────
  tableRows.push([
    xc("", "totalLabel"),
    xc("Total", "totalLabel"),
    xc("", "totalLabel"),
    xc("", "totalLabel"),
    xc(totalAmount, "totalNum"),
    xc(totalVat, "totalNum"),
    xc(totalGrand, "totalNum"),
  ]);

  // Row — Justification
  tableRows.push(Array(NCOLS).fill(skip));
  tableRows.push([xc("Justification", "section"), ...Array(NCOLS - 1).fill(skip)]);
  tableRows.push([
    xc(text(header.description) || "GENERATED FOR CAPEX PROCESS", "normal"),
    ...Array(NCOLS - 1).fill(skip),
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
  const colXml = COL_WIDTHS.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  ).join("");

  let sheetDataXml = "";
  tableRows.forEach((row, ri) => {
    const rn = ri + 1;
    const ht =
      rn === 1 ? ` ht="24" customHeight="1"` :
      rn === 2 ? ` ht="20" customHeight="1"` :
      rn === 6 ? ` ht="22" customHeight="1"` : "";

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
  <fonts count="9">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="thin"><color rgb="FF94A3B8"/></top>
      <bottom style="thin"><color rgb="FF94A3B8"/></bottom>
    </border>
    <border>
      <left style="medium"><color rgb="FF555555"/></left>
      <right style="medium"><color rgb="FF555555"/></right>
      <top style="medium"><color rgb="FF555555"/></top>
      <bottom style="medium"><color rgb="FF555555"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: company (navy bg, white bold 18, centered) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2: title (white bg, dark bold 14, centered) -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 3: section (white bg, dark bold 11) -->
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 4: tableHead (navy bg, white bold 11, centered, wrap) -->
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 5: normal data -->
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <!-- 6: numData (right-align, #,##0.000) -->
    <xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
    <!-- 7: totalLabel (bold, grey bg) -->
    <xf numFmtId="0" fontId="7" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 8: totalNum (bold right-align, #,##0.000, grey bg) -->
    <xf numFmtId="164" fontId="8" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
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
    `<sheets><sheet name="Capex Approval" sheetId="1" r:id="rId1"/></sheets>` +
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
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  return zip.toBuffer();
}

// ─── Excel Controller ─────────────────────────────────────────────────────────
export const exportCapexApprovalExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const { loginid, code1, code2 } = req.body;
    const companyCode = text(code1);
    const requestNumber = text(code2);

    if (!companyCode || !requestNumber) {
      res.status(400).json({ success: false, message: "Missing company_code or request_number" });
      return;
    }

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    // ── Helper: run PROC_BUILD_DYNAMIC_SQL_COMMON for a given parameter ──
    const runDynamicSql = async (parameter: string) => {
      const binds: any = {
        parameter,
        loginid: loginid || "ADMIN",
        code1: companyCode,
        code2: requestNumber,
        code3: null,
        code4: null,
        number1: null, number2: null, number3: null, number4: null,
        date1: null, date2: null, date3: null, date4: null,
        out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
      };

      const result = await connection!.execute(
        `DECLARE
           v_sql VARCHAR2(32767);
         BEGIN
           PROC_BUILD_DYNAMIC_SQL_COMMON(
             :parameter, :loginid,
             :code1,  :code2,  :code3,  :code4,
             :number1, :number2, :number3, :number4,
             :date1,   :date2,   :date3,   :date4,
             v_sql
           );
           :out_sql := v_sql;
         END;`,
        binds
      );

      const rawSql = (result.outBinds as any).out_sql;
      if (!rawSql) throw new Error(`Procedure did not return SQL for parameter "${parameter}"`);

      const dataResult = await connection!.execute(rawSql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      return (dataResult.rows as any[]).map((row) =>
        Object.keys(row).reduce((acc: any, key) => {
          acc[key.toLowerCase()] = row[key];
          return acc;
        }, {})
      );
    };

    const [headerRows, detailRows] = await Promise.all([
      runDynamicSql("Amlspf_TabCPHeader"),
      runDynamicSql("Amlspf_TabCPDetails"),
    ]);

    const header = headerRows[0] || {};

    const buffer = buildCapexApprovalExcelBuffer(header, detailRows);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="CapexApproval_${requestNumber}.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error("Capex Approval Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error(e);
      }
    }
  }
};