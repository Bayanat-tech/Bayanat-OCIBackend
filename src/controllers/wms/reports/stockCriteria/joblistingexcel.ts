import { Request, Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
// @ts-ignore
const AdmZip = require("adm-zip");
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// --- HELPER FUNCTIONS ---
const text = (v: any) => (v == null ? "" : String(v));
const amount = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };
const formatDate = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};
function escapeXml(value: unknown): string {
    return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// --- PROFESSIONAL STYLES (From Reference) ---
const excelStyles = {
    title: {
        font: { bold: true, sz: 14, color: { rgb: "111111" } },
        fill: { fgColor: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
    },
    company: {
        font: {
            bold: true,
            sz: 18,
            color: { rgb: "FFFFFF" }
        },
        fill: {
            patternType: "solid",
            fgColor: { rgb: "0D4D89" }
        },
        alignment: {
            horizontal: "center",
            vertical: "center"
        }
    },
    section: {
        font: { bold: true, color: { rgb: "111111" } },
        fill: { fgColor: { rgb: "FFFFFF" } },
        border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
    },
    tableHead: {
        font: {
            bold: true,
            color: { rgb: "FFFFFF" }
        },
        fill: {
            fgColor: { rgb: "0D4D89" }
        },
        alignment: {
            horizontal: "center",
            vertical: "center"
        },
        border: {
            top: { style: "thin" },
            bottom: { style: "thin" },
            left: { style: "thin" },
            right: { style: "thin" }
        }
    },
    normal: {
        alignment: { vertical: "top", wrapText: true },
        border: { bottom: { style: "thin", color: { rgb: "999999" } } },
    },
    number: {
        alignment: { horizontal: "right", vertical: "top" },
        numFmt: "#,##0.00",
        border: { bottom: { style: "thin", color: { rgb: "999999" } } },
    }
};

// --- LAYOUT HELPERS ---
function applyStyle(ws: XLSX.WorkSheet, row: number, col: number, style: any) {
    const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
    if (!ws[ref]) ws[ref] = { t: "s", v: "" };
    (ws[ref] as any).s = style;
}

function styleRange(ws: XLSX.WorkSheet, row: number, startCol: number, endCol: number, style: any) {
    for (let col = startCol; col <= endCol; col++) applyStyle(ws, row, col, style);
}

// --- CORE EXCEL BUFFER GENERATOR (XML Logic) ---
const styleIdBySignature = new Map<string, number>([
    [JSON.stringify(excelStyles.title), 1],
    [JSON.stringify(excelStyles.company), 2],
    [JSON.stringify(excelStyles.section), 3],
    [JSON.stringify(excelStyles.tableHead), 4],
    [JSON.stringify(excelStyles.normal), 6],
    [JSON.stringify(excelStyles.number), 7],
]);

function workbookBufferFromSheet(ws: XLSX.WorkSheet): Buffer {
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const getStyleId = (cell: any) => {
        const style = cell?.s;
        if (!style) return 0;
        return styleIdBySignature.get(JSON.stringify(style)) ?? 0;
    };

    let sheetData = "";
    for (let r = range.s.r; r <= range.e.r; r++) {
        let cells = "";
        for (let c = range.s.c; c <= range.e.c; c++) {
            const ref = XLSX.utils.encode_cell({ r, c });
            const cell = ws[ref];
            const sId = getStyleId(cell);
            if (!cell && !sId) continue;
            const attrs = `r="${ref}"${sId ? ` s="${sId}"` : ""}`;
            if (typeof cell?.v === "number") {
                cells += `<c ${attrs}><v>${cell.v}</v></c>`;
            } else {
                cells += `<c ${attrs} t="inlineStr"><is><t>${escapeXml(cell?.v ?? "")}</t></is></c>`;
            }
        }
        sheetData += `<row r="${r + 1}">${cells}</row>`;
    }

    const merges = (ws["!merges"] || [])
        .map(m => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`)
        .join("");

    const colDefs = (ws["!cols"] || [])
        .map((c: any, i: number) => `<col min="${i + 1}" max="${i + 1}" width="${c.wch || 12}" customWidth="1"/>`)
        .join("");

    // ── STYLES XML ───────────────────────────────────────────────────────────
    const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">

  <!-- FONTS  (index matches xf fontId) -->
  <fonts count="6">
    <font><sz val="11"/><name val="Calibri"/></font>                                         <!-- 0 default -->
    <font><b/><sz val="14"/><color rgb="FF111111"/><name val="Calibri"/></font>              <!-- 1 title -->
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>              <!-- 2 company -->
    <font><b/><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/></font>              <!-- 3 section -->
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>              <!-- 4 tableHead -->
    <font><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/></font>                  <!-- 5 normal/number -->
  </fonts>

  <!-- FILLS  (0=none,1=gray125 are mandatory) -->
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>                                            <!-- 0 -->
    <fill><patternFill patternType="gray125"/></fill>                                         <!-- 1 -->
    <fill><patternFill patternType="none"/></fill>                                            <!-- 2 white (title/section) -->
    <fill><patternFill patternType="solid"><fgColor rgb="FF0D4D89"/></patternFill></fill>     <!-- 3 blue (company/tableHead) -->
    <fill><patternFill patternType="none"/></fill>                                            <!-- 4 normal -->
  </fills>

  <!-- BORDERS -->
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>                               <!-- 0 none -->
    <border>                                                                                  <!-- 1 all-thin (title/section/tableHead) -->
      <left style="thin"/><right style="thin"/>
      <top style="thin"/><bottom style="thin"/>
    </border>
    <border><bottom style="thin"><color rgb="FF999999"/></bottom></border>                    <!-- 2 normal -->
    <border><bottom style="thin"><color rgb="FF999999"/></bottom></border>                    <!-- 3 number -->
  </borders>

  <!-- NUM FMTS -->
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0.00"/>
  </numFmts>

  <!-- CELL XFS  (s="N" in sheet XML references index N here) -->
  <cellXfs count="8">
    <!-- 0 default -->
    <xf numFmtId="0"  fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1 title -->
    <xf numFmtId="0"  fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2 company -->
    <xf numFmtId="0"  fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 3 section -->
    <xf numFmtId="0"  fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <!-- 4 tableHead -->
    <xf numFmtId="0"  fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 5 (unused slot, keep indices aligned) -->
    <xf numFmtId="0"  fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 6 normal -->
    <xf numFmtId="0"  fontId="5" fillId="4" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <!-- 7 number -->
    <xf numFmtId="164" fontId="5" fillId="4" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
  </cellXfs>

</styleSheet>`;

    const zip = new AdmZip();

    zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetViews><sheetView workbookViewId="0">` +
        `<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/>` +
        `</sheetView></sheetViews>` +
        `<cols>${colDefs}</cols>` +
        `<sheetData>${sheetData}</sheetData>` +
        `<mergeCells>${merges}</mergeCells>` +
        `</worksheet>`
    ));

    zip.addFile("xl/styles.xml", Buffer.from(stylesXml));

    zip.addFile("[Content_Types].xml", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`
    ));

    zip.addFile("_rels/.rels", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
    ));

    zip.addFile("xl/workbook.xml", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Job Listing" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`
    ));

    zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`
    ));

    return zip.toBuffer();
}

// --- MAIN EXPORT CONTROLLER ---
export const exportJobListingExcel = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        const { parameter, loginid, ...codes } = req.body;
        let tenantId = getCurrentTenantId() || await TenantManager.getTenantForUser(loginid);
        if (!tenantId) { res.status(400).json({ message: "TenantId required" }); return; }

        connection = await TenantManager.getConnection(tenantId);
        const binds: any = { parameter, loginid, ...codes, out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 } };
        // Fill missing codes
        for (let i = 1; i <= 20; i++) if (!binds[`code${i}`]) binds[`code${i}`] = null;
        ["number1", "number2", "number3", "number4", "date1", "date2", "date3", "date4"].forEach(k => binds[k] = null);

        const sqlResult = await connection.execute(`DECLARE V_SQL VARCHAR2(32767); BEGIN PROC_BUILD_DYNAMIC_SQL_COMMON20(:parameter, :loginid, :code1, :code2, :code3, :code4, :code5, :code6, :code7, :code8, :code9, :code10, :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20, :number1, :number2, :number3, :number4, :date1, :date2, :date3, :date4, V_SQL); :out_sql := V_SQL; END;`, binds);
        const data = await connection.execute((sqlResult.outBinds as any).out_sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = data.rows as any[];

        // Build AOA (Array of Arrays)
        const aoa: any[][] = [
            [
                "AL MADINA LOGISTICS SERVICES COMPANY",
                "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""
            ],

            [
                "Transaction Report - Job Listing",
                "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""
            ],

            [
                `Date : ${formatDate(new Date())}`,
                "", "", "", "", "", "", "",
                "",
                "",
                `User : ${loginid}`,
                "", "", "", "", ""
            ],

            [],

            [
                "SN",
                "Department",
                "Job Type",
                "Job No",
                "Principal",
                "Job Class",
                "Job Date",
                "Confirm Date",
                "GRN/DN",
                "GRN Date",
                "Invoice No",
                "Invoice Date",
                "Bill Amount",
                "User",
                "Confirmed",
                "Invoiced"
            ]
        ];
        rows.forEach((r, i) => {
            aoa.push([
                i + 1, text(r.DEPT_NAME), text(r.JOB_TYPE), text(r.JOB_NO), text(r.PRIN_NAME), text(r.JOB_CLASS),
                formatDate(r.JOB_DATE), formatDate(r.CONFIRME_DATE), text(r.GRN_NO), formatDate(r.GRN_DATE),
                text(r.INV_NO), formatDate(r.INV_DATE), amount(r.ACT_BILL_AMT), text(r.USER_ID), text(r.CONFIRMED), text(r.INVOICED)
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [

            { wch: 6 },   // SN
            { wch: 18 },  // Department
            { wch: 15 },  // Type
            { wch: 15 },  // Job No
            { wch: 30 },  // Principal
            { wch: 15 },  // Class
            { wch: 14 },  // Job Date
            { wch: 14 },  // Confirm
            { wch: 14 },  // GRN
            { wch: 14 },  // GRN Date
            { wch: 15 },  // Invoice
            { wch: 14 },  // Invoice Date
            { wch: 15 },  // Amount
            { wch: 12 },  // User
            { wch: 12 },  // Confirmed
            { wch: 12 }   // Invoiced

        ];
        ws["!merges"] = [

            // Company Name
            {
                s: { r: 0, c: 0 },
                e: { r: 0, c: 15 }
            },

            // Report Title
            {
                s: { r: 1, c: 0 },
                e: { r: 1, c: 15 }
            },

            // Date
            {
                s: { r: 2, c: 0 },
                e: { r: 2, c: 7 }
            },

            // User
            {
                s: { r: 2, c: 10 },
                e: { r: 2, c: 15 }
            }

        ];

        // Apply Reference Styles
        applyStyle(ws, 1, 1, excelStyles.company);
        // Company Name
        styleRange(ws, 1, 1, 16, excelStyles.company);

        // Report Title
        styleRange(ws, 2, 1, 16, excelStyles.title);

        // Date
        styleRange(ws, 3, 1, 8, excelStyles.section);

        // User
        styleRange(ws, 3, 11, 16, excelStyles.section);

        // Table Header
        styleRange(ws, 5, 1, 16, excelStyles.tableHead);

        // Data
        for (let i = 6; i <= aoa.length; i++) {

            styleRange(ws, i, 1, 12, excelStyles.normal);

            applyStyle(ws, i, 13, excelStyles.number);

            styleRange(ws, i, 14, 16, excelStyles.normal);

        }

        const buffer = workbookBufferFromSheet(ws);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="JobListingReport.xlsx"`);
        res.send(buffer);

    } catch (err: any) {
        console.error(err);
        res.status(500).json({ message: err.message });
    } finally {
        if (connection) await connection.close();
    }
};