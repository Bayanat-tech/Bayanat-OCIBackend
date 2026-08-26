// File: prRegisterReport.handler.ts

import { Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import { RequestWithUser } from "../../interfaces/common.interface";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { TenantManager } from "../../database/TenantManager";
const AdmZip = require("adm-zip");

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportRow = {
    REQUEST_NUMBER: string;
    REQUEST_DATE: string;
    CREATE_USER: string;
    AMOUNT: number;
    STATUS: string;
    DIV_CODE: string;
    DIV_NAME: string;
    COMPANY_CODE: string;
    LOGO_URL: string | null; // now sourced from MS_HR_DIVISION.COMP_LOGO, per DIV_CODE
};

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

// ─── Formatters ───────────────────────────────────────────────────────────────

function text(value: unknown): string {
    if (value == null) return "";
    return String(value);
}

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function fmt2(n: number): string {
    return num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// ─── Status Labels ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
    SAVEASDRAFT: "Draft",
    SUBMITTED: "Submitted",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    SENDBACK: "Sent Back",
    CANCELED: "Canceled",
};

// ─── Data Loader ──────────────────────────────────────────────────────────────

async function loadPRRegisterData(
    req: RequestWithUser,
    division: string,
    status: string
): Promise<ReportRow[]> {
    const conn = await getConn(req);
    const companyCode = req.user?.company_code || "";

    try {
        const result: any = await conn.execute(
            `BEGIN 
                proc_build_dynamic_sql_common(
                    P_PARAMETER => :param,
                    P_LOGINID => :loginid,
                    P_CODE1 => :code1,
                    P_CODE2 => :code2,
                    P_CODE3 => :code3,
                    P_CODE4 => :code4,
                    P_NUMBER1 => :num1,
                    P_NUMBER2 => :num2,
                    P_NUMBER3 => :num3,
                    P_NUMBER4 => :num4,
                    P_DATE1 => :date1,
                    P_DATE2 => :date2,
                    P_DATE3 => :date3,
                    P_DATE4 => :date4,
                    P_RETURN_STRING => :ret
                );
            END;`,
            {
                param: "PS_PREQUEST_ENTRY_SUMMARY_REPORT",
                loginid: req.user?.loginid || "",
                code1: companyCode,
                code2: division || "ALL",
                code3: status || "ALL",
                code4: "",
                num1: 0,
                num2: 0,
                num3: 0,
                num4: 0,
                date1: null,
                date2: null,
                date3: null,
                date4: null,
                ret: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32000 },
            }
        );

        const sql = (result.outBinds as any)?.ret as string || "";

        if (!sql) {
            throw new Error("Report SQL could not be built. Check PS_PREQUEST_ENTRY_SUMMARY_REPORT branch.");
        }

        const dataResult = await conn.execute(sql, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        return (dataResult.rows || []) as ReportRow[];

    } finally {
        await closeConn(conn);
    }
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderHtml(rows: ReportRow[], loginId: string, division: string, status: string): string {
    const printDateTime = new Date().toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });

    // Group rows by Division
    const groups = new Map<string, { divName: string; rows: ReportRow[] }>();
    rows.forEach((r) => {
        if (!groups.has(r.DIV_CODE)) {
            groups.set(r.DIV_CODE, {
                divName: r.DIV_NAME,
                rows: [],
            });
        }
        groups.get(r.DIV_CODE)!.rows.push(r);
    });

    const grandTotal = rows.reduce((s, r) => s + num(r.AMOUNT), 0);

    // Top header logo — dynamic based on DIV_CODE (from MS_HR_DIVISION.COMP_LOGO).
    // If a specific division is filtered, this is that division's logo.
    // If "All" is selected, this shows the first row's division logo.
    const headerLogo = rows.length > 0 ? rows[0].LOGO_URL : null;

    // Status badge shown once under the division name:
    // - if a specific status filter was applied, show that
    // - else, if every row in the group happens to share the same status, show it
    // - otherwise (mixed statuses under "All"), show nothing
    const resolveGroupStatus = (groupRows: ReportRow[]): string | null => {
        if (status !== "ALL") return status;
        const unique = Array.from(new Set(groupRows.map((r) => r.STATUS)));
        return unique.length === 1 ? unique[0] : null;
    };

    let bodyHtml = "";

    groups.forEach((group) => {
        const groupStatus = resolveGroupStatus(group.rows);

        bodyHtml += `
            <div class="group-container">
                <div class="group-header">
                    <div class="group-header-left">
                        <div>
                            <span class="group-label">Division</span>
                            <span class="group-name">${escapeHtml(group.divName)}</span>
                            ${groupStatus ? `<div class="group-status"><span class="status-badge status-${escapeHtml(groupStatus)}">${escapeHtml(STATUS_LABELS[groupStatus] || groupStatus)}</span></div>` : ''}
                        </div>
                    </div>
                </div>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Request No</th>
                            <th>Request Date</th>
                            <th>Create User</th>
                            <th class="right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>`;

        group.rows.forEach((r) => {
            bodyHtml += `
                        <tr>
                            <td class="request-no">${escapeHtml(r.REQUEST_NUMBER)}</td>
                            <td>${escapeHtml(r.REQUEST_DATE)}</td>
                            <td>${escapeHtml(r.CREATE_USER)}</td>
                            <td class="right amount">${fmt2(r.AMOUNT)}</td>
                        </tr>`;
        });

        bodyHtml += `
                    </tbody>
                </table>
            </div>`;
    });

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8"/>
    <title>Purchase Request Register Report</title>
    <style>
        @media print {
            @page { size: A4 portrait; margin: 8mm; }
            .no-print { display: none !important; }
            .report-container { box-shadow: none !important; border: none !important; }
            .group-container { break-inside: avoid; }
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 20px;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 12px;
            background: #f3f4f6;
            color: #111827;
        }
        .report-container {
            max-width: 1100px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 24px 28px;
        }
        .report-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #1d4ed8;
            padding-bottom: 14px;
            margin-bottom: 20px;
        }
        .report-title-area {
            display: flex;
            align-items: center;
            gap: 14px;
        }
        .logo-img {
            max-height: 50px;
            max-width: 120px;
            object-fit: contain;
        }
        .report-title {
            font-size: 18px;
            font-weight: 700;
            color: #1e3a8a;
            letter-spacing: 1px;
        }
        .report-subtitle {
            font-size: 12px;
            color: #6b7280;
            font-weight: 400;
            letter-spacing: 0.5px;
        }
        .report-meta {
            text-align: right;
            font-size: 11px;
            color: #6b7280;
            line-height: 1.6;
        }
        .report-meta strong {
            color: #374151;
        }
        .group-container {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            margin-bottom: 16px;
            overflow: hidden;
        }
        .group-header {
            display: flex;
            align-items: center;
            padding: 10px 16px;
            background: #f8fafc;
            border-bottom: 1px solid #e5e7eb;
        }
        .group-header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .group-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #6b7280;
            display: block;
        }
        .group-name {
            font-size: 14px;
            font-weight: 600;
            color: #111827;
        }
        .group-status {
            margin-top: 4px;
        }
        .report-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        .report-table thead th {
            background: #f3f4f6;
            padding: 8px 14px;
            text-align: left;
            font-weight: 600;
            color: #374151;
            border-bottom: 2px solid #d1d5db;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .report-table tbody td {
            padding: 7px 14px;
            border-bottom: 1px solid #f3f4f6;
        }
        .report-table tbody tr:hover td {
            background: #f8fafc;
        }
        .report-table .right {
            text-align: right;
        }
        .report-table .request-no {
            color: #1d4ed8;
            font-weight: 500;
        }
        .report-table .amount {
            font-weight: 500;
            color: #065f46;
        }
        .status-badge {
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            display: inline-block;
        }
        .status-SAVEASDRAFT { background: #f3f4f6; color: #6b7280; }
        .status-SUBMITTED { background: #dbeafe; color: #1d4ed8; }
        .status-APPROVED { background: #d1fae5; color: #065f46; }
        .status-REJECTED { background: #fee2e2; color: #dc2626; }
        .status-SENDBACK { background: #fef3c7; color: #d97706; }
        .status-CANCELED { background: #e5e7eb; color: #6b7280; }
        .report-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 14px;
            margin-top: 14px;
            border-top: 1px solid #e5e7eb;
            font-size: 11px;
            color: #6b7280;
        }
        .grand-total-area {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .grand-total-label {
            font-size: 13px;
            font-weight: 600;
            color: #374151;
        }
        .grand-total-value {
            font-size: 18px;
            font-weight: 700;
            color: #065f46;
        }
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #6b7280;
        }
        .empty-state .icon {
            font-size: 40px;
            margin-bottom: 12px;
        }
        @media print {
            .report-header { border-bottom-color: #000; }
            .group-header { background: #f0f0f0 !important; }
            .report-table thead th { background: #e5e7eb !important; }
            .report-container { border-radius: 0; padding: 10mm; }
        }
    </style>
</head>
<body>
    <div class="report-container">
        <div class="report-header">
            <div class="report-title-area">
                ${headerLogo ? `<img src="${escapeHtml(headerLogo)}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />` : ''}
                <div>
                    <div class="report-title">Purchase Request Register</div>
                    <div class="report-subtitle">Summary Report</div>
                </div>
            </div>
            <div class="report-meta">
                <div><strong>Print Date:</strong> ${printDateTime}</div>
                <div><strong>Print User:</strong> ${escapeHtml(loginId)}</div>
            </div>
        </div>

        ${rows.length === 0 ? `
            <div class="empty-state">
                <div class="icon">📄</div>
                <div>No records found for the selected filters.</div>
            </div>
        ` : `
            ${bodyHtml}

            <div class="report-footer">
                <span>Report: rpt_pr_register_summary</span>
                <div class="grand-total-area">
                    <span class="grand-total-label">Grand Total</span>
                    <span class="grand-total-value">${fmt2(grandTotal)}</span>
                </div>
            </div>
        `}
    </div>
    <div style="text-align:center;padding:12px;font-size:11px;color:#9ca3af;">
        Powered by Bayanat Technology
    </div>
</body>
</html>`;
}

// ─── Excel Builder ────────────────────────────────────────────────────────────

function buildExcelBuffer(rows: ReportRow[], loginId: string, division: string, status: string): Buffer {
    const printDateTime = new Date().toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });

    const BLUE = "FF1D4ED8";
    const WHITE = "FFFFFFFF";
    const LBLUE = "FFDBEAFE";
    const GREEN_BG = "FFD1FAE5";

    const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });

    const styles = {
        title: {
            font: { bold: true, sz: 16, color: { rgb: WHITE } },
            fill: { fgColor: { rgb: BLUE } },
            alignment: { horizontal: "center", vertical: "center" },
        },
        meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
        header: {
            font: { bold: true, sz: 10, color: { rgb: WHITE } },
            fill: { fgColor: { rgb: BLUE } },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            border: {
                top: borderThin(BLUE),
                bottom: borderThin(BLUE),
                left: borderThin(BLUE),
                right: borderThin(BLUE),
            },
        },
        groupHeader: {
            font: { bold: true, sz: 11, color: { rgb: "FF111827" } },
            fill: { fgColor: { rgb: LBLUE } },
            alignment: { horizontal: "left", vertical: "center" },
            border: { bottom: borderThin("FFE5E7EB") },
        },
        groupTotal: {
            font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
            fill: { fgColor: { rgb: GREEN_BG } },
            alignment: { horizontal: "right", vertical: "center" },
            numFmt: "#,##0.00",
            border: { top: borderThin("FF065F46") },
        },
        data: {
            font: { sz: 10 },
            alignment: { vertical: "center" },
            border: { bottom: borderThin("FFF3F4F6") },
        },
        dataNum: {
            font: { sz: 10 },
            alignment: { horizontal: "right", vertical: "center" },
            numFmt: "#,##0.00",
            border: { bottom: borderThin("FFF3F4F6") },
        },
        dataRequestNo: {
            font: { sz: 10, color: { rgb: "FF1D4ED8" } },
            alignment: { vertical: "center" },
            border: { bottom: borderThin("FFF3F4F6") },
        },
        grandTotal: {
            font: { bold: true, sz: 12, color: { rgb: WHITE } },
            fill: { fgColor: { rgb: BLUE } },
            alignment: { horizontal: "right", vertical: "center" },
            numFmt: "#,##0.00",
        },
    };

    // Group rows by Division (matches on-screen grouping)
    const groups = new Map<string, { divName: string; rows: ReportRow[] }>();
    rows.forEach((r) => {
        if (!groups.has(r.DIV_CODE)) {
            groups.set(r.DIV_CODE, { divName: r.DIV_NAME, rows: [] });
        }
        groups.get(r.DIV_CODE)!.rows.push(r);
    });

    const COL_COUNT = 5; // Request No, Date, Create User, Amount, Status
    const sheetData: any[][] = [];
    const merges: XLSX.Range[] = [];
    const rowStyles: Array<Record<number, any>> = [];

    const addRow = (cells: any[], styleMap: Record<number, any>) => {
        sheetData.push(cells);
        rowStyles.push(styleMap);
    };

    const allStyle = (style: any) =>
        Object.fromEntries(Array.from({ length: COL_COUNT }, (_, i) => [i, style]));

    // ── Title ──
    const titleR = sheetData.length;
    addRow(["Purchase Request Register Report", ...Array(COL_COUNT - 1).fill("")], allStyle(styles.title));
    merges.push({ s: { r: titleR, c: 0 }, e: { r: titleR, c: COL_COUNT - 1 } });

    // ── Meta ──
    const metaR = sheetData.length;
    const statusDisplay = status !== "ALL" ? (STATUS_LABELS[status] || status) : "All";
    addRow(
        [`Print Date: ${printDateTime}`, "", `Print User: ${loginId}`, ...Array(COL_COUNT - 3).fill("")],
        { 0: styles.meta, 2: styles.meta },
    );
    merges.push({ s: { r: metaR, c: 0 }, e: { r: metaR, c: 1 } });
    merges.push({ s: { r: metaR, c: 2 }, e: { r: metaR, c: COL_COUNT - 1 } });

    const filterR = sheetData.length;
    addRow(
        [`Division: ${division === "ALL" ? "All" : division}`, `Status: ${statusDisplay}`, `Records: ${rows.length}`],
        { 0: styles.meta, 1: styles.meta, 2: styles.meta },
    );
    merges.push({ s: { r: filterR, c: 0 }, e: { r: filterR, c: COL_COUNT - 1 } });

    addRow(Array(COL_COUNT).fill(""), {});

    // ── Headers ──
    addRow(["Request No", "Request Date", "Create User", "Amount", "Status"], allStyle(styles.header));

    // ── Data (grouped by division) ──
    let grandTotal = 0;

    groups.forEach((group) => {
        const gRow = sheetData.length;
        addRow([`Division: ${group.divName}`, ...Array(COL_COUNT - 1).fill("")], allStyle(styles.groupHeader));
        merges.push({ s: { r: gRow, c: 0 }, e: { r: gRow, c: COL_COUNT - 1 } });

        group.rows.forEach((r) => {
            const amount = num(r.AMOUNT);
            grandTotal += amount;
            addRow(
                [r.REQUEST_NUMBER, r.REQUEST_DATE, r.CREATE_USER, amount, STATUS_LABELS[r.STATUS] || r.STATUS],
                {
                    0: styles.dataRequestNo,
                    1: styles.data,
                    2: styles.data,
                    3: styles.dataNum,
                    4: styles.data,
                },
            );
        });

        const divTotal = group.rows.reduce((s, r) => s + num(r.AMOUNT), 0);
        const dtRow = sheetData.length;
        addRow([`Division Total: ${group.divName}`, "", "", divTotal, ""], allStyle(styles.groupTotal));
        merges.push({ s: { r: dtRow, c: 0 }, e: { r: dtRow, c: 2 } });

        addRow(Array(COL_COUNT).fill(""), {});
    });

    // ── Grand Total ──
    const gtRow = sheetData.length;
    addRow(["Grand Total", "", "", grandTotal, ""], allStyle(styles.grandTotal));
    merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 2 } });

    // ── Footer ──
    addRow(
        ["", "", "", "", "Powered by Bayanat Technology"],
        { 4: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } } },
    );

    // ── Build worksheet ──
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws["!merges"] = merges;
    ws["!cols"] = [
        { wch: 18 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
    ];
    ws["!rows"] = sheetData.map((_, i) => ({ hpt: i === 0 ? 30 : i <= 3 ? 20 : 16 }));

    // ── Style engine ──
    interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
    interface FillDef { color?: string; }
    interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
    interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

    const fonts: FontDef[] = [{}];
    const fills: FillDef[] = [{}, {}];
    const borders: BorderDef[] = [{}];
    const numFmts: Array<{ id: number; code: string }> = [];
    const cellXfs: XfDef[] = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
    const sigCache = new Map<string, number>();
    let nextCustomNumFmtId = 164;

    const registerFont = (f: any): number => {
        const def: FontDef = { bold: !!f?.bold, italic: !!f?.italic, sz: f?.sz ?? 10, color: f?.color?.rgb };
        const key = `font:${JSON.stringify(def)}`;
        if (sigCache.has(key)) return sigCache.get(key)!;
        fonts.push(def);
        const idx = fonts.length - 1;
        sigCache.set(key, idx);
        return idx;
    };

    const registerFill = (f: any): number => {
        if (!f?.fgColor?.rgb) return 0;
        const def: FillDef = { color: f.fgColor.rgb };
        const key = `fill:${JSON.stringify(def)}`;
        if (sigCache.has(key)) return sigCache.get(key)!;
        fills.push(def);
        const idx = fills.length - 1;
        sigCache.set(key, idx);
        return idx;
    };

    const registerBorder = (b: any): number => {
        if (!b) return 0;
        const def: BorderDef = {
            top: b.top?.color?.rgb,
            bottom: b.bottom?.color?.rgb,
            left: b.left?.color?.rgb,
            right: b.right?.color?.rgb,
        };
        if (!def.top && !def.bottom && !def.left && !def.right) return 0;
        const key = `border:${JSON.stringify(def)}`;
        if (sigCache.has(key)) return sigCache.get(key)!;
        borders.push(def);
        const idx = borders.length - 1;
        sigCache.set(key, idx);
        return idx;
    };

    const registerNumFmt = (code?: string): number => {
        if (!code) return 0;
        const existing = numFmts.find((n) => n.code === code);
        if (existing) return existing.id;
        const id = nextCustomNumFmtId++;
        numFmts.push({ id, code });
        return id;
    };

    const registerXf = (styleObj: any): number => {
        if (!styleObj) return 0;
        const fontId = registerFont(styleObj.font);
        const fillId = registerFill(styleObj.fill);
        const borderId = registerBorder(styleObj.border);
        const numFmtId = registerNumFmt(styleObj.numFmt);
        const align = styleObj.alignment?.horizontal;
        const wrap = !!styleObj.alignment?.wrapText;
        const key = `xf:${JSON.stringify({ fontId, fillId, borderId, numFmtId, align, wrap })}`;
        if (sigCache.has(key)) return sigCache.get(key)!;
        cellXfs.push({ fontId, fillId, borderId, numFmtId, align, wrap });
        const idx = cellXfs.length - 1;
        sigCache.set(key, idx);
        return idx;
    };

    const cellStyleIndex = new Map<string, number>();
    sheetData.forEach((row, r) => {
        const styleMap = rowStyles[r];
        if (styleMap) {
            row.forEach((_: any, c: number) => {
                if (styleMap[c]) {
                    cellStyleIndex.set(`${r},${c}`, registerXf(styleMap[c]));
                }
            });
        }
    });

    // ── Sheet XML ──
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    let sheetXmlData = "";
    for (let r2 = range.s.r; r2 <= range.e.r; r2++) {
        const cells: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
            const ref = XLSX.utils.encode_cell({ r: r2, c });
            const cell = ws[ref] as XLSX.CellObject | undefined;
            const styleIdx = cellStyleIndex.get(`${r2},${c}`);
            if (!cell && styleIdx === undefined) continue;
            const sAttr = styleIdx !== undefined ? ` s="${styleIdx}"` : "";
            const value = cell?.v;
            if (typeof value === "number") {
                cells.push(`<c r="${ref}"${sAttr}><v>${value}</v></c>`);
            } else if (value !== undefined && value !== null && value !== "") {
                cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`);
            } else if (styleIdx !== undefined) {
                cells.push(`<c r="${ref}"${sAttr}/>`);
            }
        }
        if (cells.length) sheetXmlData += `<row r="${r2 + 1}">${cells.join("")}</row>`;
    }

    const mergesXml = merges.map((m) => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`).join("");
    const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";
    const colsXml = (ws["!cols"] || []).map((col: any, i: number) =>
        `<col min="${i + 1}" max="${i + 1}" width="${col.wch || 16}" customWidth="1"/>`
    ).join("");

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheetFormatPr defaultRowHeight="14"/>
    <cols>${colsXml}</cols>
    <sheetData>${sheetXmlData}</sheetData>
    ${mergeFinal}
</worksheet>`;

    const numFmtsXml = numFmts.length
        ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`).join("")}</numFmts>`
        : "";

    const fontsXml = `<fonts count="${fonts.length}">${fonts.map((f) => `
    <font>
        ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="10"/>'}
        ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
        <name val="Arial"/>
        ${f.bold ? "<b/>" : ""}
        ${f.italic ? "<i/>" : ""}
    </font>`).join("")}
</fonts>`;

    const fillsXml = `<fills count="${fills.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills.slice(2).map((f) => `
    <fill>
        <patternFill patternType="solid">
            <fgColor rgb="${f.color}"/>
            <bgColor rgb="${f.color}"/>
        </patternFill>
    </fill>`).join("")}
</fills>`;

    const borderEdge = (rgb?: string) => rgb ? `<color rgb="${rgb}"/>` : "";
    const bordersXml = `<borders count="${borders.length}">${borders.map((b) => `
    <border>
        <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
        <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
        <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
        <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
        <diagonal/>
    </border>`).join("")}
</borders>`;

    const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs.map((xf) => {
        const applyAlign = xf.align || xf.wrap;
        return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
        ${applyAlign ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${xf.wrap ? ` wrapText="1"` : ""} vertical="center"/>` : ""}
    </xf>`;
    }).join("")}
</cellXfs>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    ${numFmtsXml}
    ${fontsXml}
    ${fillsXml}
    ${bordersXml}
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    ${cellXfsXml}
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheets><sheet name="PR Register" sheetId="1" r:id="rId1"/></sheets>
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
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
    zip.addFile("_rels/.rels", Buffer.from(rels));
    zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
    zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
    zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
    zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
    return zip.toBuffer();
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getPRRegisterReportHtml = async (
    req: RequestWithUser,
    res: Response,
): Promise<void> => {
    try {
        const { division, status, code2, code3 } = req.body;
        const divCode = division || code2 || "ALL";
        const statusCode = status || code3 || "ALL";

        const rows = await loadPRRegisterData(req, divCode, statusCode);
        const html = renderHtml(rows, req.user?.loginid || "", divCode, statusCode);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);

    } catch (error: any) {
        console.error("PR Register Report HTML error:", error);
        res.status(error.status || 500).json({
            success: false,
            message: error.message || "Unable to generate report",
        });
    }
};

export const exportPRRegisterReportExcel = async (
    req: RequestWithUser,
    res: Response,
): Promise<void> => {
    try {
        const { division, status, code2, code3 } = req.body;
        const divCode = division || code2 || "ALL";
        const statusCode = status || code3 || "ALL";
        const rows = await loadPRRegisterData(req, divCode, statusCode);
        const buffer = buildExcelBuffer(rows, req.user?.loginid || "", divCode, statusCode);
        const filename = `pr_register_report_${new Date().toISOString().slice(0, 10)}.xlsx`;

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.end(buffer);

    } catch (error: any) {
        console.error("PR Register Report Excel error:", error);
        res.status(error.status || 500).json({
            success: false,
            message: error.message || "Unable to export report",
        });
    }
};