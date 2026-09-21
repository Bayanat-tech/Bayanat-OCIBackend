// import { Response } from "express";
// import oracledb from "oracledb";
// const AdmZip = require("adm-zip");
// import TenantManager from "../../../database/TenantManager";
// import { getCurrentTenantId } from "../../../middleware/tenantContext.middleware";
// import { RequestWithUser } from "../../../interfaces/common.interface";

// // ─── Types ────────────────────────────────────────────────────────────────

// type ReportRow = Record<string, any>;

// interface ReqParams {
//   loginid:      string;
//   company_code: string;
//   fromdate:     string; // "All" or "YYYY-MM-DD"
//   todate:       string;
//   user_id:      string; // "All" or user_code
//   search_text:  string; // "All" or free text
//   status:       string; // "All" | "PENDING" | "APPROVED" | "REJECTED"
//   report_type:  string; // "SUMMARY" | "DETAILS"
// }

// // ─── DB helpers ─────────────────────────────────────────────────────────────

// async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
//   let tenantId = getCurrentTenantId();
//   if (!tenantId && req.user?.loginid) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
//   if (!tenantId) throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
//   return TenantManager.getConnection(tenantId);
// }

// async function closeConn(conn?: oracledb.Connection) {
//   if (conn) try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
// }

// function normalize(rows: any[] = []): ReportRow[] {
//   return rows.map((row) =>
//     Object.keys(row).reduce((acc: ReportRow, key) => {
//       acc[key.toLowerCase()] = row[key];
//       return acc;
//     }, {})
//   );
// }

// // ─── Formatting helpers ─────────────────────────────────────────────────────

// function text(value: unknown): string {
//   if (value == null) return "";
//   return String(value);
// }

// function num(v: unknown): number {
//   const n = parseFloat(String(v));
//   return Number.isFinite(n) ? n : 0;
// }

// function dateText(value: unknown): string {
//   if (!value) return "\u2014";
//   const d = new Date(String(value));
//   if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
//   return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
// }

// function escapeHtml(value: unknown): string {
//   return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
// }

// function escapeXml(value: unknown): string {
//   return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
// }

// function amtFmt(value: unknown): string {
//   const n = Number(value);
//   if (!Number.isFinite(n)) return "0.000";
//   return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
// }

// function rateFmt(value: unknown): string {
//   const n = Number(value);
//   if (!Number.isFinite(n)) return "1.00";
//   return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// }

// // ─── Param extraction ───────────────────────────────────────────────────────

// function extractParams(req: RequestWithUser): ReqParams {
//   const b = req.body || {};
//   return {
//     loginid:      text(req.user?.loginid) || text(b.loginid) || "ADMIN",
//     company_code: text(b.company_code),
//     fromdate:     text(b.fromdate) || "All",
//     todate:       text(b.todate) || "All",
//     user_id:      text(b.user_id) || "All",
//     search_text:  text(b.search_text) || "All",
//     status:       text(b.status) || "All",
//     report_type:  text(b.report_type).toUpperCase() === "DETAILS" ? "DETAILS" : "SUMMARY",
//   };
// }

// // ─── Data loader ────────────────────────────────────────────────────────────

// async function loadPrRegisterOldData(req: RequestWithUser, p: ReqParams): Promise<ReportRow[]> {
//   const conn = await getConn(req);
//   try {
//     const toDate = (iso: string): Date | null => {
//       if (!iso || iso.toUpperCase() === "ALL") return null;
//       const d = new Date(iso + "T00:00:00");
//       return Number.isNaN(d.getTime()) ? null : d;
//     };

//     const dispatchParam = p.report_type === "DETAILS" ? "PR_REGISTER_OLD_DETAILS" : "PR_REGISTER_OLD_SUMMARY";

//     const binds: any = {
//       parameter: dispatchParam,
//       loginid: p.loginid,
//       code1: p.company_code || null,
//       code2: p.user_id || null,
//       code3: p.search_text || null,
//       code4: p.status || null,
//       number1: null,
//       number2: null,
//       number3: null,
//       number4: null,
//       date1: toDate(p.fromdate),
//       date2: toDate(p.todate),
//       date3: null,
//       date4: null,
//       out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
//     };

//     const result = await conn.execute(
//       `DECLARE
//          v_sql VARCHAR2(32767);
//        BEGIN
//          PROC_BUILD_DYNAMIC_SQL_PR_REGISTER_OLD(
//            :parameter, :loginid,
//            :code1,  :code2,  :code3,  :code4,
//            :number1, :number2, :number3, :number4,
//            :date1,   :date2,   :date3,   :date4,
//            v_sql
//          );
//          :out_sql := v_sql;
//        END;`,
//       binds
//     );

//     const rawSql = (result.outBinds as any).out_sql;
//     if (!rawSql) throw new Error("Procedure did not return a valid SQL query.");

//     console.log("=== GENERATED SQL ===\n", rawSql, "\n=== END ===");

//     const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
//     return normalize(dataResult.rows as any[]);
//   } finally {
//     await closeConn(conn);
//   }
// }

// // ─── Report line model (grouped by Purchase Status, like the PDF sample) ───

// interface StatusGroup {
//   status: string;
//   rows: ReportRow[];
//   amountTotal: number;
// }

// function groupByStatus(rows: ReportRow[]): { groups: StatusGroup[]; grandAmount: number } {
//   const byStatus = new Map<string, StatusGroup>();
//   const order: string[] = [];

//   for (const r of rows) {
//     const key = text(r.purch_status) || "(Not Set)";
//     if (!byStatus.has(key)) {
//       byStatus.set(key, { status: key, rows: [], amountTotal: 0 });
//       order.push(key);
//     }
//     const g = byStatus.get(key)!;
//     g.rows.push(r);
//     g.amountTotal += num(r.amount);
//   }

//   const groups = order.map((k) => byStatus.get(k)!);
//   const grandAmount = groups.reduce((s, g) => s + g.amountTotal, 0);

//   return { groups, grandAmount };
// }

// // ─── HTML renderer (Purchase Summary Report visual style, per PDF sample) ──

// const REPORT_TITLE = "PURCHASE SUMMARY REPORT";
// const REPORT_NAME = "rep_pfs_txns_datewise";

// function renderHtml(rows: ReportRow[], loginId: string): string {
//   const printDateTime = new Date().toLocaleString("en-GB", {
//     day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
//   });

//   const { groups, grandAmount } = groupByStatus(rows);

//   let bodyHtml = "";

//   groups.forEach((g) => {
//     bodyHtml += `
//             <div class="status-block">
//                 <div class="status-header">Purchase Status: ${escapeHtml(g.status)}</div>
//                 <table class="report-table">
//                     <thead>
//                         <tr>
//                             <th>Request No</th>
//                             <th>Request Date</th>
//                             <th>Create User</th>
//                             <th>Description</th>
//                             <th>Currency</th>
//                             <th class="right">EX Rate</th>
//                             <th class="right">Amount</th>
//                         </tr>
//                     </thead>
//                     <tbody>`;

//     g.rows.forEach((r) => {
//       bodyHtml += `
//                         <tr>
//                             <td>${escapeHtml(r.request_number)}</td>
//                             <td>${escapeHtml(dateText(r.request_date))}</td>
//                             <td>${escapeHtml(r.create_user)}</td>
//                             <td>${escapeHtml(r.description)}</td>
//                             <td>${escapeHtml(r.curr_code)}</td>
//                             <td class="right">${rateFmt(r.currency_rate)}</td>
//                             <td class="right amount">${amtFmt(r.amount)}</td>
//                         </tr>`;
//     });

//     bodyHtml += `
//                         <tr class="subtotal-row">
//                             <td colspan="6">Total Amount for ${escapeHtml(g.status)}</td>
//                             <td class="right">${amtFmt(g.amountTotal)}</td>
//                         </tr>
//                     </tbody>
//                 </table>
//             </div>`;
//   });

//   return `<!doctype html>
// <html>
// <head>
//     <meta charset="utf-8"/>
//     <title>${escapeHtml(REPORT_TITLE)}</title>
//     <style>
//         @media print {
//             @page { size: A4 landscape; margin: 8mm; }
//             .no-print { display: none !important; }
//             .report-container { box-shadow: none !important; border: none !important; }
//             .status-block { break-inside: avoid; }
//         }
//         * { box-sizing: border-box; }
//         body {
//             margin: 0;
//             padding: 20px;
//             font-family: Arial, Helvetica, sans-serif;
//             font-size: 12px;
//             background: #f3f4f6;
//             color: #111827;
//         }
//         .report-container {
//             max-width: 1200px;
//             margin: 0 auto;
//             background: #ffffff;
//             border-radius: 12px;
//             box-shadow: 0 1px 3px rgba(0,0,0,0.1);
//             padding: 24px 28px;
//         }
//         .report-header {
//             display: flex;
//             justify-content: space-between;
//             align-items: flex-start;
//             border-bottom: 2px solid #1d4ed8;
//             padding-bottom: 14px;
//             margin-bottom: 20px;
//         }
//         .report-meta-left { font-size: 11px; color: #6b7280; line-height: 1.7; }
//         .report-meta-left strong { color: #374151; }
//         .report-title-area { text-align: center; flex: 1; }
//         .report-title { font-size: 18px; font-weight: 700; color: #1e3a8a; letter-spacing: 1px; }
//         .status-block { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
//         .status-header {
//             padding: 8px 16px; background: #1e3a8a; color: #fff;
//             font-size: 12px; font-weight: 600; letter-spacing: 0.03em;
//         }
//         .report-table { width: 100%; border-collapse: collapse; font-size: 12px; }
//         .report-table thead th {
//             background: #f3f4f6; padding: 8px 14px; text-align: left; font-weight: 600; color: #374151;
//             border-bottom: 2px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
//         }
//         .report-table tbody td { padding: 7px 14px; border-bottom: 1px solid #f3f4f6; }
//         .report-table tbody tr:hover td { background: #f8fafc; }
//         .report-table .right { text-align: right; }
//         .report-table .amount { font-weight: 500; color: #065f46; }
//         .subtotal-row td { background: #eef2f7; font-weight: 700; color: #1e3a8a; padding: 7px 14px; }
//         .report-footer {
//             display: flex; justify-content: space-between; align-items: center;
//             padding-top: 14px; margin-top: 14px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280;
//         }
//         .grand-total-area { display: flex; align-items: center; gap: 12px; }
//         .grand-total-label { font-size: 13px; font-weight: 600; color: #374151; }
//         .grand-total-value { font-size: 18px; font-weight: 700; color: #065f46; }
//         .empty-state { text-align: center; padding: 40px 20px; color: #6b7280; }
//         .empty-state .icon { font-size: 40px; margin-bottom: 12px; }
//         @media print {
//             .report-header { border-bottom-color: #000; }
//             .status-header { background: #333 !important; }
//             .report-table thead th { background: #e5e7eb !important; }
//             .report-container { border-radius: 0; padding: 10mm; }
//         }
//     </style>
// </head>
// <body>
//     <div class="report-container">
//         <div class="report-header">
//             <div class="report-meta-left">
//                 <div><strong>Date:</strong> ${escapeHtml(printDateTime)}</div>
//                 <div><strong>User:</strong> ${escapeHtml(loginId)}</div>
//                 <div><strong>Report:</strong> ${escapeHtml(REPORT_NAME)}</div>
//             </div>
//             <div class="report-title-area">
//                 <div class="report-title">${escapeHtml(REPORT_TITLE)}</div>
//             </div>
//             <div style="width:140px;"></div>
//         </div>

//         ${rows.length === 0 ? `
//             <div class="empty-state">
//                 <div class="icon">\ud83d\udcc4</div>
//                 <div>No records found for the selected filters.</div>
//             </div>
//         ` : `
//             ${bodyHtml}

//             <div class="report-footer">
//                 <span>Report: ${escapeHtml(REPORT_NAME)}</span>
//                 <div class="grand-total-area">
//                     <span class="grand-total-label">Grand Total Amount</span>
//                     <span class="grand-total-value">${amtFmt(grandAmount)}</span>
//                 </div>
//             </div>
//         `}
//     </div>
//     <div style="text-align:center;padding:12px;font-size:11px;color:#9ca3af;">
//         Powered by Bayanat Technology
//     </div>
// </body>
// </html>`;
// }

// // ─── Excel builder (raw OOXML, same styling engine as PO Order Register) ──

// function buildExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
//   const printDateTime = new Date().toLocaleString("en-GB", {
//     day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
//   });

//   const BLUE = "FF1D4ED8";
//   const WHITE = "FFFFFFFF";
//   const HEADER_BLUE = "FF1E3A8A";
//   const GREEN_BG = "FFD1FAE5";

//   const { groups, grandAmount } = groupByStatus(rows);

//   const COL_COUNT = 7; // Request No, Request Date, Create User, Description, Currency, EX Rate, Amount

//   interface XlCell { v: unknown; styleKey: string }
//   type Row = (XlCell | null)[];
//   const rows_: Row[] = [];
//   const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

//   const cell = (v: unknown, styleKey: string): XlCell => ({ v, styleKey });

//   // ── Title ──
//   rows_.push([cell(REPORT_TITLE, "title"), null, null, null, null, null, null]);
//   merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

//   // ── Meta ──
//   rows_.push([
//     cell(`Date: ${printDateTime}`, "meta"), null,
//     cell(`User: ${loginId}`, "meta"), null,
//     cell(`Report: ${REPORT_NAME}`, "meta"), null, null,
//   ]);
//   merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } });
//   merges.push({ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } });
//   merges.push({ s: { r: 1, c: 4 }, e: { r: 1, c: 6 } });

//   rows_.push([null, null, null, null, null, null, null]);

//   // ── Header ──
//   rows_.push([
//     cell("Request No", "header"), cell("Request Date", "header"), cell("Create User", "header"),
//     cell("Description", "header"), cell("Currency", "header"), cell("EX Rate", "header"), cell("Amount", "header"),
//   ]);

//   // ── Data grouped by Purchase Status ──
//   groups.forEach((g) => {
//     const rIdx = rows_.length;
//     rows_.push([cell(`Purchase Status: ${g.status}`, "groupHeader"), null, null, null, null, null, null]);
//     merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: COL_COUNT - 1 } });

//     g.rows.forEach((r) => {
//       rows_.push([
//         cell(text(r.request_number), "data"),
//         cell(dateText(r.request_date), "data"),
//         cell(text(r.create_user), "data"),
//         cell(text(r.description), "data"),
//         cell(text(r.curr_code), "data"),
//         cell(num(r.currency_rate), "dataNum2"),
//         cell(num(r.amount), "dataNum3"),
//       ]);
//     });

//     const dtRow = rows_.length;
//     rows_.push([
//       cell(`Total Amount for ${g.status}`, "groupTotal"), null, null, null, null, null,
//       cell(g.amountTotal, "groupTotalNum"),
//     ]);
//     merges.push({ s: { r: dtRow, c: 0 }, e: { r: dtRow, c: 5 } });

//     rows_.push([null, null, null, null, null, null, null]);
//   });

//   // ── Grand total ──
//   const gtRow = rows_.length;
//   rows_.push([cell("Grand Total Amount", "grandTotal"), null, null, null, null, null, cell(grandAmount, "grandTotalNum")]);
//   merges.push({ s: { r: gtRow, c: 0 }, e: { r: gtRow, c: 5 } });

//   // ── Footer ──
//   rows_.push([null, null, null, null, null, null, cell("Powered by Bayanat Technology", "footer")]);

//   // ── Style definitions ──
//   const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
//   const styleDefs: Record<string, any> = {
//     title: {
//       font: { bold: true, sz: 16, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: BLUE } },
//       alignment: { horizontal: "center", vertical: "center" },
//     },
//     meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
//     header: {
//       font: { bold: true, sz: 10, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: BLUE } },
//       alignment: { horizontal: "center", vertical: "center", wrapText: true },
//       border: { top: borderThin(BLUE), bottom: borderThin(BLUE), left: borderThin(BLUE), right: borderThin(BLUE) },
//     },
//     groupHeader: {
//       font: { bold: true, sz: 11, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: HEADER_BLUE } },
//       alignment: { horizontal: "left", vertical: "center" },
//     },
//     groupTotal: {
//       font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
//       fill: { fgColor: { rgb: GREEN_BG } },
//       alignment: { horizontal: "left", vertical: "center" },
//       border: { top: borderThin("FF065F46") },
//     },
//     groupTotalNum: {
//       font: { bold: true, sz: 10, color: { rgb: "FF065F46" } },
//       fill: { fgColor: { rgb: GREEN_BG } },
//       alignment: { horizontal: "right", vertical: "center" },
//       numFmt: "#,##0.000",
//       border: { top: borderThin("FF065F46") },
//     },
//     data: { font: { sz: 10 }, alignment: { vertical: "center" }, border: { bottom: borderThin("FFF3F4F6") } },
//     dataNum2: {
//       font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
//       numFmt: "#,##0.00", border: { bottom: borderThin("FFF3F4F6") },
//     },
//     dataNum3: {
//       font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
//       numFmt: "#,##0.000", border: { bottom: borderThin("FFF3F4F6") },
//     },
//     grandTotal: {
//       font: { bold: true, sz: 12, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: BLUE } },
//       alignment: { horizontal: "left", vertical: "center" },
//     },
//     grandTotalNum: {
//       font: { bold: true, sz: 12, color: { rgb: WHITE } },
//       fill: { fgColor: { rgb: BLUE } },
//       alignment: { horizontal: "right", vertical: "center" },
//       numFmt: "#,##0.000",
//     },
//     footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },
//   };

//   // ── Style registration engine ──
//   interface FontDef { bold?: boolean; italic?: boolean; sz?: number; color?: string; }
//   interface FillDef { color?: string; }
//   interface BorderDef { top?: string; bottom?: string; left?: string; right?: string; }
//   interface XfDef { fontId: number; fillId: number; borderId: number; numFmtId: number; align?: string; wrap?: boolean; }

//   const fonts: FontDef[] = [{}];
//   const fills: FillDef[] = [{}, {}];
//   const borders: BorderDef[] = [{}];
//   const numFmts: Array<{ id: number; code: string }> = [];
//   const cellXfs: XfDef[] = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
//   const sigCache = new Map<string, number>();
//   let nextCustomNumFmtId = 164;

//   const registerFont = (f: any): number => {
//     const def: FontDef = { bold: !!f?.bold, italic: !!f?.italic, sz: f?.sz ?? 10, color: f?.color?.rgb };
//     const key = `font:${JSON.stringify(def)}`;
//     if (sigCache.has(key)) return sigCache.get(key)!;
//     fonts.push(def);
//     const idx = fonts.length - 1;
//     sigCache.set(key, idx);
//     return idx;
//   };

//   const registerFill = (f: any): number => {
//     if (!f?.fgColor?.rgb) return 0;
//     const def: FillDef = { color: f.fgColor.rgb };
//     const key = `fill:${JSON.stringify(def)}`;
//     if (sigCache.has(key)) return sigCache.get(key)!;
//     fills.push(def);
//     const idx = fills.length - 1;
//     sigCache.set(key, idx);
//     return idx;
//   };

//   const registerBorder = (b: any): number => {
//     if (!b) return 0;
//     const def: BorderDef = {
//       top: b.top?.color?.rgb, bottom: b.bottom?.color?.rgb, left: b.left?.color?.rgb, right: b.right?.color?.rgb,
//     };
//     if (!def.top && !def.bottom && !def.left && !def.right) return 0;
//     const key = `border:${JSON.stringify(def)}`;
//     if (sigCache.has(key)) return sigCache.get(key)!;
//     borders.push(def);
//     const idx = borders.length - 1;
//     sigCache.set(key, idx);
//     return idx;
//   };

//   const registerNumFmt = (code?: string): number => {
//     if (!code) return 0;
//     const existing = numFmts.find((n) => n.code === code);
//     if (existing) return existing.id;
//     const id = nextCustomNumFmtId++;
//     numFmts.push({ id, code });
//     return id;
//   };

//   const registerXf = (styleObj: any): number => {
//     if (!styleObj) return 0;
//     const fontId = registerFont(styleObj.font);
//     const fillId = registerFill(styleObj.fill);
//     const borderId = registerBorder(styleObj.border);
//     const numFmtId = registerNumFmt(styleObj.numFmt);
//     const align = styleObj.alignment?.horizontal;
//     const wrap = !!styleObj.alignment?.wrapText;
//     const key = `xf:${JSON.stringify({ fontId, fillId, borderId, numFmtId, align, wrap })}`;
//     if (sigCache.has(key)) return sigCache.get(key)!;
//     cellXfs.push({ fontId, fillId, borderId, numFmtId, align, wrap });
//     const idx = cellXfs.length - 1;
//     sigCache.set(key, idx);
//     return idx;
//   };

//   const styleIndexFor = (styleKey: string): number => registerXf(styleDefs[styleKey]);

//   // ── Sheet XML ──
//   const colXml = Array.from({ length: COL_COUNT }, (_, i) =>
//     `<col min="${i + 1}" max="${i + 1}" width="20" customWidth="1"/>`
//   ).join("");

//   let sheetDataXml = "";
//   rows_.forEach((row, ri) => {
//     const rn = ri + 1;
//     let rowXml = `<row r="${rn}">`;
//     row.forEach((c, ci) => {
//       if (c === null) return;
//       const ref = String.fromCharCode(65 + ci) + rn;
//       const s = styleIndexFor(c.styleKey);
//       if (typeof c.v === "number") {
//         rowXml += `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
//       } else {
//         rowXml += `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(c.v ?? "")}</t></is></c>`;
//       }
//     });
//     rowXml += "</row>";
//     sheetDataXml += rowXml;
//   });

//   const mergesXml = merges.map((m) =>
//     `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`
//   ).join("");
//   const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";

//   const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
//   <sheetFormatPr defaultRowHeight="15"/>
//   <cols>${colXml}</cols>
//   <sheetData>${sheetDataXml}</sheetData>
//   ${mergeFinal}
// </worksheet>`;

//   const numFmtsXml = numFmts.length
//     ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`).join("")}</numFmts>`
//     : "";

//   const fontsXml = `<fonts count="${fonts.length}">${fonts.map((f) => `
//     <font>
//         ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="10"/>'}
//         ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
//         <name val="Arial"/>
//         ${f.bold ? "<b/>" : ""}
//         ${f.italic ? "<i/>" : ""}
//     </font>`).join("")}
// </fonts>`;

//   const fillsXml = `<fills count="${fills.length}">
//     <fill><patternFill patternType="none"/></fill>
//     <fill><patternFill patternType="gray125"/></fill>
//     ${fills.slice(2).map((f) => `
//     <fill>
//         <patternFill patternType="solid">
//             <fgColor rgb="${f.color}"/>
//             <bgColor rgb="${f.color}"/>
//         </patternFill>
//     </fill>`).join("")}
// </fills>`;

//   const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
//   const bordersXml = `<borders count="${borders.length}">${borders.map((b) => `
//     <border>
//         <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
//         <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
//         <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
//         <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
//         <diagonal/>
//     </border>`).join("")}
// </borders>`;

//   const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs.map((xf) => {
//     const applyAlign = xf.align || xf.wrap;
//     return `
//     <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
//         applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
//         applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
//         ${applyAlign ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${xf.wrap ? ` wrapText="1"` : ""} vertical="center"/>` : ""}
//     </xf>`;
//   }).join("")}
// </cellXfs>`;

//   const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
//     ${numFmtsXml}
//     ${fontsXml}
//     ${fillsXml}
//     ${bordersXml}
//     <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
//     ${cellXfsXml}
//     <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
// </styleSheet>`;

//   const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
//   <sheets><sheet name="PR Register Summary" sheetId="1" r:id="rId1"/></sheets>
// </workbook>`;

//   const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
//   <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
// </Relationships>`;

//   const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
// </Relationships>`;

//   const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
//   <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
//   <Default Extension="xml"  ContentType="application/xml"/>
//   <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
//   <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
//   <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
// </Types>`;

//   const zip = new AdmZip();
//   zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
//   zip.addFile("_rels/.rels", Buffer.from(rels));
//   zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
//   zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
//   zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
//   zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
//   return zip.toBuffer();
// }

// // ─── Route handlers ─────────────────────────────────────────────────────────
// // NOTE: These handlers currently only render the SUMMARY layout end-to-end.
// // The DETAILS report_type is dispatched to the correct SQL (PR_REGISTER_OLD_DETAILS)
// // but renderHtml()/buildExcelBuffer() still use the Summary column layout, since
// // no Details PDF/format has been provided yet. Send that and I'll branch the
// // renderer for report_type === "DETAILS".

// export const getPrRegisterOldDetailReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
//   try {
//     const params = extractParams(req);
//     const rows = await loadPrRegisterOldData(req, params);
//     if (!rows.length) {
//       res.status(200).json({ success: false, message: "No data found for the selected criteria." });
//       return;
//     }
//     res.setHeader("Content-Type", "text/html; charset=utf-8");
//     res.send(renderHtml(rows, params.loginid));
//   } catch (error: any) {
//     console.error("PR Register Old HTML error:", error);
//     res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
//   }
// };

// export const getPrRegisterOldDetailReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
//   try {
//     const params = extractParams(req);
//     const rows = await loadPrRegisterOldData(req, params);
//     if (!rows.length) {
//       res.status(200).json({ success: false, message: "No data found for the selected criteria." });
//       return;
//     }
//     const buffer = buildExcelBuffer(rows, params.loginid);

//     res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
//     res.setHeader("Content-Disposition", 'attachment; filename="PR_Register_Old_Report.xlsx"');
//     res.end(buffer);
//   } catch (error: any) {
//     console.error("PR Register Old Excel error:", error);
//     res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
//   }
// };