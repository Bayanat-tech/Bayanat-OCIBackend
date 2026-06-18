import { Request, Response } from "express";
import oracledb from "oracledb";
import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
import TenantManager from "../../../database/TenantManager";
// @ts-ignore
const AdmZip = require("adm-zip");
// import TenantManager from "../../../../database/TenantManager";
// import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const text = (v: any) => (v == null ? "" : String(v));
const num = (v: any) => Number(v) || 0;

const formatDateStr = (v: any) => {
    if (!v) return "00-00-0000";
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
    title: {
        font: { bold: true, sz: 13, color: { rgb: "111111" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: { bottom: { style: "thin" } },
    },
    companyName: {
        font: { bold: true, sz: 14, color: { rgb: "185FA5" } },
        alignment: { horizontal: "right", vertical: "center" },
    },
    metaLabel: {
        font: { bold: true, sz: 10, color: { rgb: "555555" } },
    },
    metaValue: {
        font: { sz: 10, color: { rgb: "111111" } },
    },
    principalBanner: {
        font: { bold: true, sz: 11, color: { rgb: "111111" } },
        fill: { fgColor: { rgb: "F3F4F6" } },
        border: { top: { style: "thin" }, bottom: { style: "thin" } },
    },
    tableHead: {
        font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "185FA5" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
    },
    tableHeadNum: {
        font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "185FA5" } },
        alignment: { horizontal: "right", vertical: "center" },
        border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } },
    },
    prodHeader: {
        font: { bold: true, sz: 11, color: { rgb: "111111" } },
        fill: { fgColor: { rgb: "F5F5F5" } },
        border: { top: { style: "medium" }, bottom: { style: "thin" } },
    },
    detailRow1: {
        font: { sz: 10, color: { rgb: "111111" } },
        border: { bottom: { style: "hair", color: { rgb: "EEEEEE" } } },
    },
    detailRow1Num: {
        font: { sz: 10, color: { rgb: "111111" } },
        alignment: { horizontal: "right" },
        border: { bottom: { style: "hair", color: { rgb: "EEEEEE" } } },
    },
    detailRow2: {
        font: { sz: 9, color: { rgb: "777777" }, italic: true },
        fill: { fgColor: { rgb: "FAFAFA" } },
        border: { bottom: { style: "thin", color: { rgb: "DDDDDD" } } },
    },
    closingRow: {
        font: { bold: true, sz: 10, color: { rgb: "111111" } },
        fill: { fgColor: { rgb: "EFF6FF" } },
        border: { top: { style: "medium" }, bottom: { style: "medium" } },
    },
    closingRowNum: {
        font: { bold: true, sz: 10, color: { rgb: "111111" } },
        fill: { fgColor: { rgb: "EFF6FF" } },
        alignment: { horizontal: "right" },
        border: { top: { style: "medium" }, bottom: { style: "medium" } },
    },
};

const styleIdMap = new Map<string, number>();
let styleCounter = 1;
Object.values(S).forEach(s => {
    const key = JSON.stringify(s);
    if (!styleIdMap.has(key)) styleIdMap.set(key, styleCounter++);
});

// ─── Worksheet helpers ────────────────────────────────────────────────────────

type WS = Record<string, any> & { "!ref"?: string; "!cols"?: any[]; "!merges"?: any[] };

function encodeCell(r: number, c: number) {
    const col = c < 26
        ? String.fromCharCode(65 + c)
        : String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
    return `${col}${r + 1}`;
}

function setCell(ws: WS, r: number, c: number, v: any, style?: any) {
    const ref = encodeCell(r, c);
    ws[ref] = { v, t: typeof v === "number" ? "n" : "s", s: style };
}

function mergeCell(ws: WS, r1: number, c1: number, r2: number, c2: number) {
    ws["!merges"] = ws["!merges"] || [];
    ws["!merges"].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
}

function updateRef(ws: WS, maxRow: number, maxCol: number) {
    ws["!ref"] = `A1:${encodeCell(maxRow, maxCol)}`;
}

// ─── XML builder ──────────────────────────────────────────────────────────────

function buildXlsx(ws: WS): Buffer {
    const ref = ws["!ref"] || "A1:A1";
    const [startRef, endRef] = ref.split(":");
    const startC = startRef.replace(/\d/g, "").split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
    const startR = parseInt(startRef.replace(/\D/g, "")) - 1;
    const endC = endRef.replace(/\d/g, "").split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
    const endR = parseInt(endRef.replace(/\D/g, "")) - 1;

    const getStyleId = (cell: any) => {
        if (!cell?.s) return 0;
        return styleIdMap.get(JSON.stringify(cell.s)) || 0;
    };

    let sheetData = "";
    for (let r = startR; r <= endR; r++) {
        let cells = "";
        for (let c = startC; c <= endC; c++) {
            const ref = encodeCell(r, c);
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
        .map((m: any) => `<mergeCell ref="${encodeCell(m.s.r, m.s.c)}:${encodeCell(m.e.r, m.e.c)}"/>`)
        .join("");

    const colDefs = (ws["!cols"] || [])
        .map((c: any, i: number) => `<col min="${i + 1}" max="${i + 1}" width="${c.wch || 12}" customWidth="1"/>`)
        .join("");

    const zip = new AdmZip();
    zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
        `<cols>${colDefs}</cols><sheetData>${sheetData}</sheetData><mergeCells>${merges}</mergeCells></worksheet>`
    ));
    zip.addFile("[Content_Types].xml", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    ));
    zip.addFile("_rels/.rels", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ));
    zip.addFile("xl/workbook.xml", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Transaction Report" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ));
    zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    ));
    return zip.toBuffer();
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const exportTransactionProductExcel = async (req: Request, res: Response): Promise<void> => {
    let connection;
    try {
        const { loginid, code1, code2, code3, code4, code5, code6, code7, code8,
                code9, code10, code11, code12, code13, code14, code15, code16, code17,
                date1, date2, date3, date4 } = req.body;

        const parameter = "WMS_Stock_TRANSACTION_PRODUCT_REPORT";

        let tenantId = getCurrentTenantId();
        if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
        if (!tenantId) { res.status(400).json({ success: false, message: "Tenant not found" }); return; }
        connection = await TenantManager.getConnection(tenantId);

        const binds: any = {
            parameter, loginid: loginid || "ADMIN",
            code1:  code1  || null,
            code2:  code2  || null,
            code3:  code3  || "",
            code4:  code4  || "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
            code5:  code5  || "",
            code6:  code6  || "ZZZZZ",
            code7:  code7  || "",
            code8:  code8  || "ZZZZZZZZZZZZZZZ",
            code9:  code9  || "",
            code10: code10 || "ZZZZZ",
            code11: code11 || "",
            code12: code12 || "ZZZZZZZZZZZZZZZZZZZZ",
            code13: code13 || "",
            code14: code14 || "ZZZZZZZZZZZZZZZZZZZZ",
            code15: code15 || "All",
            code16: code16 || "All",
            code17: code17 || "ZZZZZZZZZZZZZZZZZZZZ",
            code18: null, code19: null, code20: null,
            number1: null, number2: null, number3: null, number4: null,
            date1: date1 || null,
            date2: date2 || null,
            date3: date3 || null,
            date4: date4 || null,
            out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
        };

        const result = await connection.execute(
            `DECLARE v_sql VARCHAR2(32767); BEGIN PROC_BUILD_DYNAMIC_SQL_COMMON20(
               :parameter, :loginid,
               :code1,:code2,:code3,:code4,:code5,:code6,:code7,:code8,:code9,:code10,
               :code11,:code12,:code13,:code14,:code15,:code16,:code17,:code18,:code19,:code20,
               :number1,:number2,:number3,:number4,
               :date1,:date2,:date3,:date4, v_sql);
             :out_sql := v_sql; END;`,
            binds
        );

        let rawSql = (result.outBinds as any).out_sql;
        if (!rawSql) throw new Error("Procedure did not return SQL.");

        // Remove exp date filter if dates not provided
        if (!date1 || !date2) {
            rawSql = rawSql
                .replace(/AND EXP_DATE >= TO_DATE\('[^']*','DD-MON-YYYY'\)\s*/gi, "")
                .replace(/AND EXP_DATE < TO_DATE\('[^']*','DD-MON-YYYY'\)\s*/gi, "");
        }

        const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (dataResult.rows as any[]).map(row =>
            Object.keys(row).reduce((acc: any, key) => { acc[key.toLowerCase()] = row[key]; return acc; }, {})
        );

        // ── Group by prod_code ────────────────────────────────────────────────
        type ProdGroup = {
            prod_code: string; prod_name: string;
            p_uom: string; l_uom: string; uppp: any;
            pqty_op: number; lqty_op: number;
            rows: any[];
        };
        const prodMap = new Map<string, ProdGroup>();
        rows.forEach(r => {
            const key = text(r.prod_code);
            if (!prodMap.has(key)) {
                prodMap.set(key, {
                    prod_code: key, prod_name: text(r.prod_name),
                    p_uom: text(r.p_uom), l_uom: text(r.l_uom), uppp: r.uppp,
                    pqty_op: num(r.pqty_op_balance), lqty_op: num(r.lqty_op_balance),
                    rows: [],
                });
            }
            prodMap.get(key)!.rows.push(r);
        });

        const principalCode = rows.length > 0 ? text(rows[0].prin_code) : text(code2);
        const now = new Date();
        const reportDateTime = `${String(now.getDate()).padStart(2,"0")}/${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")} ${now.getHours() >= 12 ? "PM" : "AM"}`;

        // ── Build worksheet ───────────────────────────────────────────────────
        const ws: WS = {};
        ws["!cols"] = [
            { wch: 14 }, // A: Product / TXN Date / MFG Date
            { wch: 12 }, // B: TXN Date 2nd / EXP Date
            { wch: 18 }, // C: Container/Order/Job No
            { wch: 16 }, // D: Doc Ref
            { wch: 8  }, // E: Site
            { wch: 14 }, // F: Location
            { wch: 8  }, // G: Type
            { wch: 10 }, // H: Qty Primary
            { wch: 6  }, // I: UOM
            { wch: 10 }, // J: Qty Least
            { wch: 6  }, // K: UOM
            { wch: 10 }, // L: Closing Primary
            { wch: 6  }, // M: UOM
            { wch: 10 }, // N: Closing Least
            { wch: 6  }, // O: UOM
        ];
        ws["!merges"] = [];

        let r = 0; // current row index (0-based)
        const TOTAL_COLS = 14; // 0..14 = 15 cols (A..O)

        // ── Row 0: Company name ───────────────────────────────────────────────
        setCell(ws, r, 0, "Transaction Report grouped on Product", S.title);
        mergeCell(ws, r, 0, r, 10);
        setCell(ws, r, 11, "YOUR COMPANY", S.companyName);
        mergeCell(ws, r, 11, r, TOTAL_COLS);
        r++;

        // ── Row 1: blank ──────────────────────────────────────────────────────
        r++;

        // ── Rows 2-4: meta ────────────────────────────────────────────────────
        setCell(ws, r, 0, "Date :", S.metaLabel);
        setCell(ws, r, 1, reportDateTime, S.metaValue);
        mergeCell(ws, r, 1, r, 5);
        r++;
        setCell(ws, r, 0, "User :", S.metaLabel);
        setCell(ws, r, 1, text(loginid), S.metaValue);
        r++;
        setCell(ws, r, 0, "Report :", S.metaLabel);
        setCell(ws, r, 1, "rpt_txn_prod", S.metaValue);
        r++;

        // ── Row 5: blank ──────────────────────────────────────────────────────
        r++;

        // ── Row 6: Principal banner ───────────────────────────────────────────
        setCell(ws, r, 0, `Principal:   ${principalCode}`, S.principalBanner);
        mergeCell(ws, r, 0, r, TOTAL_COLS);
        r++;

        // ── Row 7: blank ──────────────────────────────────────────────────────
        r++;

        // ── Rows 8-9: Table header (2 rows) ───────────────────────────────────
        const headerRow1 = r;
        setCell(ws, r, 0, "Product", S.tableHead);       mergeCell(ws, r, 0, r+1, 0);
        setCell(ws, r, 1, "TXN Date", S.tableHead);      mergeCell(ws, r, 1, r+1, 1);
        setCell(ws, r, 2, "Container No./Order No./Job No", S.tableHead); mergeCell(ws, r, 2, r+1, 2);
        setCell(ws, r, 3, "Doc. Ref.", S.tableHead);     mergeCell(ws, r, 3, r+1, 3);
        setCell(ws, r, 4, "Site", S.tableHead);          mergeCell(ws, r, 4, r+1, 4);
        setCell(ws, r, 5, "Location", S.tableHead);      mergeCell(ws, r, 5, r+1, 5);
        setCell(ws, r, 6, "Type", S.tableHead);          mergeCell(ws, r, 6, r+1, 6);
        setCell(ws, r, 7, "Quantity", S.tableHead);      mergeCell(ws, r, 7, r, 10);
        setCell(ws, r, 11, "Closing balance", S.tableHead); mergeCell(ws, r, 11, r, TOTAL_COLS);
        r++;
        // header row 2
        setCell(ws, r, 7, "Primary", S.tableHeadNum);
        setCell(ws, r, 8, "UOM", S.tableHead);
        setCell(ws, r, 9, "Least", S.tableHeadNum);
        setCell(ws, r, 10, "UOM", S.tableHead);
        setCell(ws, r, 11, "Primary", S.tableHeadNum);
        setCell(ws, r, 12, "UOM", S.tableHead);
        setCell(ws, r, 13, "Least", S.tableHeadNum);
        setCell(ws, r, 14, "UOM", S.tableHead);
        r++;

        // ── Data rows ─────────────────────────────────────────────────────────
        prodMap.forEach(prod => {
            // Product header row
            const prodHeaderText = `${prod.prod_code}   ${prod.prod_name}`;
            setCell(ws, r, 0, prodHeaderText, S.prodHeader);
            mergeCell(ws, r, 0, r, 5);
            setCell(ws, r, 6, `UPPP: ${text(prod.uppp)}`, S.prodHeader);
            mergeCell(ws, r, 6, r, 7);
            setCell(ws, r, 8, `Opening: ${qtyFmt(prod.pqty_op)} ${prod.p_uom}`, S.prodHeader);
            mergeCell(ws, r, 8, r, 10);
            setCell(ws, r, 11, `${qtyFmt(prod.lqty_op)} ${prod.l_uom}`, S.prodHeader);
            mergeCell(ws, r, 11, r, TOTAL_COLS);
            r++;

            prod.rows.forEach(txn => {
                const qty  = qtyFmt(txn.quantity);
                const pCl  = qtyFmt(txn.pqty_cl_balance);
                const lCl  = qtyFmt(txn.lqty_cl_balance);

                // Detail row 1
                setCell(ws, r, 0, formatDateStr(txn.txn_date), S.detailRow1);
                setCell(ws, r, 1, "", S.detailRow1);
                setCell(ws, r, 2, text(txn.container_no), S.detailRow1);
                setCell(ws, r, 3, text(txn.doc_ref), S.detailRow1);
                setCell(ws, r, 4, text(txn.site_code), S.detailRow1);
                setCell(ws, r, 5, text(txn.location_code), S.detailRow1);
                setCell(ws, r, 6, text(txn.txn_type), S.detailRow1);
                setCell(ws, r, 7, qty, S.detailRow1Num);
                setCell(ws, r, 8, prod.p_uom, S.detailRow1);
                setCell(ws, r, 9, 0, S.detailRow1Num);
                setCell(ws, r, 10, prod.l_uom, S.detailRow1);
                setCell(ws, r, 11, pCl, S.detailRow1Num);
                setCell(ws, r, 12, prod.p_uom, S.detailRow1);
                setCell(ws, r, 13, lCl, S.detailRow1Num);
                setCell(ws, r, 14, prod.l_uom, S.detailRow1);
                r++;

                // Detail row 2
                setCell(ws, r, 0, formatDateStr(txn.mfg_date), S.detailRow2);
                setCell(ws, r, 1, formatDateStr(txn.exp_date), S.detailRow2);
                const jobInfo = [text(txn.order_no), text(txn.job_no)].filter(Boolean).join(" / ");
                setCell(ws, r, 2, jobInfo, S.detailRow2);
                mergeCell(ws, r, 2, r, 3);
                const userInfo = `user: ${text(txn.cust_code)}  user dt: ${formatDateStr(txn.txn_date)}  Unit Price:${text(txn.lot_no) ? "  Lot: " + text(txn.lot_no) : ""}${text(txn.batch_no) ? "  Batch: " + text(txn.batch_no) : ""}`;
                setCell(ws, r, 4, userInfo, S.detailRow2);
                mergeCell(ws, r, 4, r, TOTAL_COLS);
                r++;
            });

            // Closing balance row
            const lastRow = prod.rows[prod.rows.length - 1];
            const finalPCl = lastRow ? qtyFmt(lastRow.pqty_cl_balance) : qtyFmt(prod.pqty_op);
            const finalLCl = lastRow ? qtyFmt(lastRow.lqty_cl_balance) : qtyFmt(prod.lqty_op);

            setCell(ws, r, 0, "", S.closingRow);
            mergeCell(ws, r, 0, r, 6);
            setCell(ws, r, 7, "Closing Balance :", S.closingRow);
            mergeCell(ws, r, 7, r, 8);  // wait — right-align label
            setCell(ws, r, 7, "Closing Balance :", { ...S.closingRow, alignment: { horizontal: "right" } });
            setCell(ws, r, 9, finalPCl, S.closingRowNum);
            setCell(ws, r, 10, prod.p_uom, S.closingRow);
            setCell(ws, r, 11, finalLCl, S.closingRowNum);
            setCell(ws, r, 12, prod.l_uom, S.closingRow);
            setCell(ws, r, 13, "", S.closingRow);
            setCell(ws, r, 14, "", S.closingRow);
            r++;

            // Spacer row
            r++;
        });

        // End of report
        setCell(ws, r, 0, "End of Report", S.metaLabel);
        mergeCell(ws, r, 0, r, TOTAL_COLS);
        r++;
        setCell(ws, r, TOTAL_COLS - 1, "powered by A W A R E", S.metaValue);
        r++;

        updateRef(ws, r, TOTAL_COLS);

        const buffer = buildXlsx(ws);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="TransactionProductReport.xlsx"`);
        res.send(buffer);

    } catch (err: any) {
        console.error("Transaction Product Excel Error:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
};