import { Request, Response } from "express";
import oracledb from "oracledb";
// @ts-ignore
const AdmZip = require("adm-zip");
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const text = (v: any) => (v == null ? "" : String(v).trim());
const num  = (v: any) => Number(v) || 0;

const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
};

const qtyFmt = (v: any) => {
  const n = num(v);
  return n === 0 ? 0 : n;
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
  default:     0,
  company:     1,  // navy bg, white bold 18
  title:       2,  // white bg, dark bold 14
  section:     3,  // white bg, dark bold 11
  tableHead:   4,  // navy bg, white bold 11
  normal:      5,  // normal data
  numData:     6,  // right-align number
  prodHeader:  7,  // light grey bg, bold
  closing:     8,  // closing balance row
  closingNum:  9,  // closing balance number
} as const;
type StyleKey = keyof typeof STYLE_ID;

interface XlCell { v: unknown; s: number }
const xc = (v: unknown, style: StyleKey): XlCell => ({ v, s: STYLE_ID[style] });
const skip = null;

// ─── Excel Buffer Builder ─────────────────────────────────────────────────────
function buildTransactionWithoutTransfersExcelBuffer(
  rows: any[],
  loginid: string,
  code2: string,
  periodStr: string
): Buffer {
  type Row = (XlCell | null)[];

  // 19 columns total
  const NCOLS = 19;

  const COL_WIDTHS = [
    11,  // A  TXN Date
    6,   // B  Type
    12,  // C  Job No
    16,  // D  Container No
    14,  // E  Order No
    14,  // F  Doc Ref
    14,  // G  Inb Job No
    10,  // H  Qty Primary
    6,   // I  UOM
    10,  // J  Qty Least
    6,   // K  UOM
    10,  // L  Cl.Bal Primary
    6,   // M  UOM
    10,  // N  Cl.Bal Least
    6,   // O  UOM
    11,  // P  MFG Date
    11,  // Q  EXP Date
    12,  // R  Lot No
    12,  // S  Batch No
  ];

  const tableRows: Row[] = [];

  // ── Report header rows ────────────────────────────────────────────────────
  // Row 1 — Company
  tableRows.push([xc("TOPMOST — FREIGHT SOLUTIONS", "company"), ...Array(NCOLS - 1).fill(skip)]);

  // Row 2 — Title
  tableRows.push([
    xc(`Transaction Report WithOut Transfers  for the Period ${periodStr}`, "title"),
    ...Array(NCOLS - 1).fill(skip),
  ]);

  // Row 3 — Date | User
  tableRows.push([
    xc(`Date : ${formatDateStr(new Date())}`, "section"),
    ...Array(8).fill(skip),
    xc(`User : ${loginid}`, "section"),
    ...Array(NCOLS - 10).fill(skip),
  ]);

  // Row 4 — Principal
  tableRows.push([
    xc(`Principal : ${code2}`, "section"),
    ...Array(NCOLS - 1).fill(skip),
  ]);

  // Row 5 — Spacer
  tableRows.push(Array(NCOLS).fill(skip));

  // Row 6 — Table Header
  tableRows.push([
    xc("TXN Date",       "tableHead"),
    xc("Type",           "tableHead"),
    xc("Job No",         "tableHead"),
    xc("Container No",   "tableHead"),
    xc("Order No",       "tableHead"),
    xc("Doc Ref",        "tableHead"),
    xc("Inb Job No",     "tableHead"),
    xc("Qty Primary",    "tableHead"),
    xc("UOM",            "tableHead"),
    xc("Qty Least",      "tableHead"),
    xc("UOM",            "tableHead"),
    xc("Cl.Bal Primary", "tableHead"),
    xc("UOM",            "tableHead"),
    xc("Cl.Bal Least",   "tableHead"),
    xc("UOM",            "tableHead"),
    xc("MFG Date",       "tableHead"),
    xc("EXP Date",       "tableHead"),
    xc("Lot No",         "tableHead"),
    xc("Batch No",       "tableHead"),
  ]);

  // ── Group rows by prod_code ───────────────────────────────────────────────
  type TxnRow = (typeof rows)[0] & { _running_p?: number; _running_l?: number };
  type ProdGroup = {
    prod_code: string;
    prod_name: string;
    p_uom: string;
    l_uom: string;
    uppp: any;
    pqty_op_balance: number;
    lqty_op_balance: number;
    rows: TxnRow[];
  };

  const prodMap = new Map<string, ProdGroup>();
  rows.forEach((r) => {
    const key = text(r.prod_code);
    if (!prodMap.has(key)) {
      prodMap.set(key, {
        prod_code:       key,
        prod_name:       text(r.prod_name),
        p_uom:           text(r.p_uom) || "PCS",
        l_uom:           text(r.l_uom) || "PCS",
        uppp:            r.uppp,
        // ✅ FIX: qty_opening is the correct date-bound opening balance column
        // (pqty_op_balance from the base view is unreliable / always 0 — do not use it)
        pqty_op_balance: num(r.qty_opening),
        lqty_op_balance: num(r.lqty_op_balance),
        rows:            [],
      });
    }
    prodMap.get(key)!.rows.push(r);
  });

  // ── Running closing-balance calculation ─────────────────────────────────
  // ✅ FIX: pqty_cl_balance / lqty_cl_balance from the view are unreliable,
  // so closing balance is computed here in JS as a running total, same as
  // the working HTML report controller.
  prodMap.forEach((prod) => {
    let runningPQty = prod.pqty_op_balance;
    let runningLQty = prod.lqty_op_balance;
    prod.rows.forEach((r) => {
      runningPQty += num(r.qunatity); // NOTE: DB alias is spelled QUNATITY (typo preserved)
      r._running_p = runningPQty;
      r._running_l = runningLQty;     // no Least-side movement column available yet
    });
  });

  // ── Build data rows ───────────────────────────────────────────────────────
  prodMap.forEach((prod) => {
    // Product header row — spans all columns
    const headerLabel =
      `${prod.prod_code}    ${prod.prod_name}    ` +
      `UPPP: ${text(prod.uppp)}    ` +
      `Opening Balance: ${qtyFmt(prod.pqty_op_balance)} ${prod.p_uom}  /  ` +
      `${qtyFmt(prod.lqty_op_balance)} ${prod.l_uom}`;

    tableRows.push([
      xc(headerLabel, "prodHeader"),
      ...Array(NCOLS - 1).fill(skip),
    ]);

    // Transaction rows (flat — one row per txn)
    prod.rows.forEach((r) => {
      const containerLine = [
        text(r.container_no),
        text(r.order_no),
      ].filter(Boolean).join(" / ");

      tableRows.push([
        xc(formatDateStr(r.txn_date),   "normal"),
        xc(text(r.txn_type),            "normal"),
        xc(text(r.job_no),              "normal"),
        xc(containerLine,               "normal"),
        xc(text(r.order_no),            "normal"),
        xc(text(r.doc_ref),             "normal"),
        xc(text(r.inb_jobno),           "normal"),
        xc(qtyFmt(r.qunatity),          "numData"),
        xc(prod.p_uom,                  "normal"),
        xc(0,                           "numData"),   // least qty — bind if/when data available
        xc(prod.l_uom,                  "normal"),
        xc(qtyFmt(r._running_p),        "numData"),   // ✅ running total, not raw column
        xc(prod.p_uom,                  "normal"),
        xc(qtyFmt(r._running_l),        "numData"),   // ✅ running total, not raw column
        xc(prod.l_uom,                  "normal"),
        xc(formatDateStr(r.mfg_date),   "normal"),
        xc(formatDateStr(r.exp_date),   "normal"),
        xc(text(r.lot_no),              "normal"),
        xc(text(r.batch_no),            "normal"),
      ]);
    });

    // Closing balance row
    const lastRow  = prod.rows[prod.rows.length - 1];
    const finalPCl = lastRow ? num(lastRow._running_p) : prod.pqty_op_balance;
    const finalLCl = lastRow ? num(lastRow._running_l) : prod.lqty_op_balance;

    tableRows.push([
      xc("Closing Balance", "closing"),
      ...Array(6).fill(skip),                       // A–G merged
      xc(finalPCl,  "closingNum"),                  // H
      xc(prod.p_uom,"closing"),                     // I
      xc(finalLCl,  "closingNum"),                  // J
      xc(prod.l_uom,"closing"),                     // K
      ...Array(NCOLS - 11).fill(xc("", "closing")), // L–S
    ]);

    // Empty spacer between products
    tableRows.push(Array(NCOLS).fill(skip));
  });

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
      rn === 6 ? ` ht="30" customHeight="1"` : "";

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
  <fonts count="10">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF374151"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1B5E20"/><bgColor indexed="64"/></patternFill></fill>
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
      <left style="thin"><color rgb="FF1B5E20"/></left>
      <right style="thin"><color rgb="FF1B5E20"/></right>
      <top style="thin"><color rgb="FF1B5E20"/></top>
      <bottom style="thin"><color rgb="FF1B5E20"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: company (green bg, white bold 18, centered) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2: title (white bg, dark bold 14, centered) -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 3: section (white bg, dark bold 11) -->
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 4: tableHead (green bg, white bold 11, centered, wrap) -->
    <xf numFmtId="0" fontId="4" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 5: normal data -->
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <!-- 6: numData (right-align) -->
    <xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
    <!-- 7: prodHeader (light grey bg, dark bold 11) -->
    <xf numFmtId="0" fontId="7" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 8: closing row (light grey bg, dark bold 10) -->
    <xf numFmtId="0" fontId="8" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 9: closingNum (right-align, bold) -->
    <xf numFmtId="164" fontId="9" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
  </cellXfs>
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0.##"/>
  </numFmts>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Txn WithoutTransfers" sheetId="1" r:id="rId1"/></sheets>` +
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

// ─── Excel Controller ─────────────────────────────────────────────────────────
export const exportTransactionWithoutTransfersExcel = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const {
      loginid,
      code1, code2, code3, code4, code5, code6, code7, code8,
      code9, code10, code11, code12, code13, code14,
      code15, code16, code17, code18, code19, code20,
      number1, number2, number3, number4,
      date1, date2, date3, date4,
    } = req.body;

    const parameter = "WMS_Stock_TRANSACTION_WITHOUT_TRANSFER_REPORT";

    // ── Tenant / connection ─────────────────────────────────────────────────
    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    // ── Binds (same as HTML controller) ────────────────────────────────────
    const binds: any = {
      parameter,
      loginid: loginid || "ADMIN",
      code1:  code1  || null, code2:  code2  || null,
      code3:  code3  || null, code4:  code4  || null,
      code5:  code5  || null, code6:  code6  || null,
      code7:  code7  || null, code8:  code8  || null,
      code9:  code9  || null, code10: code10 || null,
      code11: code11 || null, code12: code12 || null,
      code13: code13 || null, code14: code14 || null,
      code15: code15 || null, code16: code16 || null,
      code17: code17 || null, code18: code18 || null,
      code19: code19 || null, code20: code20 || null,
      number1: number1 || null, number2: number2 || null,
      number3: number3 || null, number4: number4 || null,
      date1: date1 || null, date2: date2 || null,
      date3: date3 || null, date4: date4 || null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

    // ── Execute procedure → dynamic SQL ────────────────────────────────────
    const result = await connection.execute(
      `DECLARE
         v_sql VARCHAR2(32767);
       BEGIN
         PROC_BUILD_DYNAMIC_SQL_COMMON20(
           :parameter, :loginid,
           :code1,  :code2,  :code3,  :code4,  :code5,
           :code6,  :code7,  :code8,  :code9,  :code10,
           :code11, :code12, :code13, :code14, :code15,
           :code16, :code17, :code18, :code19, :code20,
           :number1, :number2, :number3, :number4,
           :date1,   :date2,   :date3,   :date4,
           v_sql
         );
         :out_sql := v_sql;
       END;`,
      binds
    );

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

    console.log("Transaction WithoutTransfers Excel — Dynamic SQL:", rawSql);

    // ── Execute dynamic SQL ─────────────────────────────────────────────────
    const dataResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    // ── Build & send Excel ──────────────────────────────────────────────────
    const principalCode = rows.length > 0 ? text(rows[0].prin_code) : text(code2);
    const periodStr = text(date3) && text(date4) ? `${text(date3)} - ${text(date4)}` : "";

    const buffer = buildTransactionWithoutTransfersExcelBuffer(
      rows,
      text(loginid) || "ADMIN",
      principalCode,
      periodStr
    );

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="TransactionWithoutTransfersReport.xlsx"`);
    res.send(buffer);

  } catch (error: any) {
    console.error("Transaction WithoutTransfers Excel Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate Excel", details: error.message });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) { console.error("Connection close error:", e); }
    }
  }
};