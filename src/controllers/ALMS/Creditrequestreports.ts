  import { Response } from "express";
  import oracledb from "oracledb";
  const AdmZip = require("adm-zip");
  import TenantManager from "../../database/TenantManager";
  import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
  import { RequestWithUser } from "../../interfaces/common.interface";
  import { buildReportDocument, reportFooter, reportHeader } from "../../controllers/common/report_common";

  // ─── Types ────────────────────────────────────────────────────────────────

  type ReportRow = Record<string, any>;

  interface ReqParams {
    loginid: string;
    company_code: string;
    request_number: string;
  }

  // Request number / company code go into a dynamic SQL string inside the
  // procedure, so only allow safe characters.
  const SAFE_ID = /^[A-Za-z0-9_\-\/ ]{1,40}$/;

  // ─── DB helpers ─────────────────────────────────────────────────────────────

  async function getConn(req: RequestWithUser): Promise<oracledb.Connection> {
    let tenantId = getCurrentTenantId();
    if (!tenantId && req.user?.loginid) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
    if (!tenantId) throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
    return TenantManager.getConnection(tenantId);
  }

  async function closeConn(conn?: oracledb.Connection) {
    if (conn) try { await conn.close(); } catch (e) { console.warn("Close conn error:", e); }
  }

  function normalize(rows: any[] = []): ReportRow[] {
    return rows.map((row) =>
      Object.keys(row).reduce((acc: ReportRow, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );
  }

  // ─── Formatting helpers ─────────────────────────────────────────────────────

  const text = (v: unknown): string => (v == null ? "" : String(v));

  function num(v: unknown): number {
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
  }

  function dateText(value: unknown): string {
    if (!value) return "";
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value).substring(0, 10);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function dateTimeText(value: unknown): string {
    if (!value) return "";
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }

  function escapeHtml(value: unknown): string {
    return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function escapeXml(value: unknown): string {
    return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  // Amount columns are NUMBER(12,3)
  function amt3(value: unknown): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0.000";
    return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  // ─── Params ─────────────────────────────────────────────────────────────────

  function extractParams(req: RequestWithUser): ReqParams {
    const b = req.body || {};
    return {
      loginid: text(req.user?.loginid) || text(b.loginid) || "ADMIN",
      company_code: text(b.company_code) || text(req.user?.company_code) || text(req.query.company_code) || "BSG",
      request_number: text(b.request_number) || text(b.doc_no),
    };
  }

  function assertSafe(p: ReqParams) {
    if (!SAFE_ID.test(p.request_number)) {
      throw Object.assign(new Error("Invalid request number"), { status: 400 });
    }
    if (!SAFE_ID.test(p.company_code)) {
      throw Object.assign(new Error("Invalid company code"), { status: 400 });
    }
  }

  // ─── Data loaders (via PROC_BUILD_DYNAMIC_CR_REPORT) ────────────────────────
  // code1 = DOC_NO (request number), code2 = company code

  async function runDynamic(req: RequestWithUser, p: ReqParams, parameter: string): Promise<ReportRow[]> {
    const conn = await getConn(req);
    try {
      const binds: any = {
        parameter,
        loginid: p.loginid,
        code1: p.request_number, // DOC_NO
        code2: p.company_code,
        code3: null,
        code4: null,
        number1: null,
        number2: null,
        number3: null,
        number4: null,
        date1: null,
        date2: null,
        date3: null,
        date4: null,
        out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
      };

      const result = await conn.execute(
        `DECLARE
          v_sql VARCHAR2(32767);
        BEGIN
          PROC_BUILD_DYNAMIC_CR_REPORT(
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
      if (!rawSql || rawSql === "INVALID PARAMETER VALUE") {
        throw new Error(`Procedure did not return a valid SQL for ${parameter}.`);
      }

      console.log(`=== GENERATED SQL (${parameter}) ===\n`, rawSql, "\n=== END ===");

      const dataResult = await conn.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return normalize(dataResult.rows as any[]);
    } finally {
      await closeConn(conn);
    }
  }

  const loadCreditRequestHeader = (req: RequestWithUser, p: ReqParams) =>
    runDynamic(req, p, "CR_REPORT_HEADER");

  const loadCreditRequestHistory = (req: RequestWithUser, p: ReqParams) =>
  runDynamic(req, p, "CR_REPORT_HISTORY");

export const getCreditRequestHistoryApi = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const params = extractParams(req);
    assertSafe(params);
    const rows = await loadCreditRequestHistory(req, params);
    res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error("Credit Request history error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to load history",
    });
  }
};

  


  

  type KvPair = [string, string];

function kvBoxHtml(title: string, pairs: KvPair[], plainKeys: string[] = []): string {
  const rows = pairs
    .map(([k, v]) => {
      const safe = escapeHtml(v || "-");
      const val = plainKeys.includes(k) ? safe : "<b>" + safe + "</b>";
      return "<tr><td>" + escapeHtml(k) + "</td><td>:</td><td>" + val + "</td></tr>";
    })
    .join("");
  return (
    '<table class="pr-kv-box">' +
    '<thead><tr><th colspan="3">' + escapeHtml(title) + "</th></tr></thead>" +
    "<tbody>" + rows + "</tbody>" +
    "</table>"
  );
}

function kvTwoBoxesHtml(leftTitle: string, left: KvPair[], rightTitle: string, right: KvPair[]): string {
  return (
    '<table class="grn-two-col"><tbody><tr>' +
    "<td>" + kvBoxHtml(leftTitle, left) + "</td>" +
    "<td>" + kvBoxHtml(rightTitle, right) + "</td>" +
    "</tr></tbody></table>"
  );
}

function titleBlock(title: string, subtitle: string, cancelled: boolean): string {
  const shownTitle = cancelled ? title + " - CANCELLED" : title;
  const shownSub = cancelled ? subtitle + " (This document is cancelled)" : subtitle;
  return (
    '<div class="doc-title-row" style="margin:0 0 8px 0;">' +
    '<h1 class="report-title" style="margin:0;font-size:18px;font-weight:800;color:#0b4ca1;">' +
    escapeHtml(shownTitle) +
    "</h1>" +
    '<div class="doc-sub" style="margin:2px 0 0;font-size:11px;color:#64748b;">' +
    escapeHtml(shownSub) +
    "</div>" +
    "</div>"
  );
}

function renderCreditRequestBody(h: ReportRow, history: ReportRow[]): string {
  const cancelled =
    text(h.last_action).toUpperCase() === "CANCELED" ||
    text(h.cancel_flag).toUpperCase() === "Y";

  const env = [
    text(h.account_env_tms) === "Y" && "TMS",
    text(h.account_env_wms) === "Y" && "WMS",
    text(h.account_env_freight) === "Y" && "FREIGHT",
  ]
    .filter(Boolean)
    .join(", ") || "—";

  // ── Important: 2 boxes only ─────────────────────────────────────────────
  const leftPairs: KvPair[] = [
    ["Company", text(h.company_name)],
    ["Customer Code", text(h.aware_customer_code)],
    ["City", text(h.city)],
    ["Tel", text(h.office_tel_no)],
    ["Email", text(h.email)],
  ].filter(([, v]) => !!text(v).trim()) as KvPair[];

  const rightPairs: KvPair[] = [
    ["Request No", text(h.request_number)],
    ["Request Date", dateText(h.request_date)],
    ["Created By", text(h.create_user)],
    ["Status", text(h.last_action)],
    ["Credit Limit", amt3(h.credit_limit)],
    ["Requested Period", String(num(h.requested_credit_period) || "—")],
    ["Sanctioned Limit", amt3(h.sanctioned_credit_limit_amt)],
    ["Sanctioned Period", String(num(h.sanctioned_credit_period) || "—")],
    ["Account Env", env],
    ["Account No", text(h.account_no)],
  ];

  // ── Other info → table (listing style) ──────────────────────────────────
  const otherRows: KvPair[] = [
    ["Address", [text(h.way_no), text(h.bldg_no), text(h.flat_no)].filter(Boolean).join(", ")],
    ["Location", text(h.location)],
    ["Po Box", text(h.po_box)],
    ["Postal Code", text(h.postal_code)],
    ["Fax", text(h.fax_no)],
    ["Website", text(h.website)],
    ["Finance Contact", text(h.fin_contact_person)],
    ["Finance Tel", text(h.fin_contact_number)],
    ["Finance Email", text(h.fin_contact_email)],
    ["Commercial Reg No", text(h.commercial_reg_no)],
    ["Business Sector", text(h.business_sector)],
    ["Contact Person", text(h.remarks_contact_person)],
    ["Authorized Signatory", text(h.authorized_signatory)],
    ["Signature Date", dateText(h.credit_form_signature_date)],
    ["Description", text(h.description)],
    ["Comments", text(h.comments)],
    ["Remarks", text(h.remarks)],
  ];

  const otherTableRows = otherRows
    .map(
      ([k, v]) =>
        "<tr><td><b>" +
        escapeHtml(k) +
        "</b></td><td>" +
        escapeHtml(v || "—") +
        "</td></tr>"
    )
    .join("");

  const otherHtml =
    '<div class="section-title" style="margin:14px 0 6px 0;font-size:12px;font-weight:700;color:#0b4ca1;">Other Details</div>' +
    '<table class="data-table cr-other">' +
    "<thead><tr><th>Field</th><th>Value</th></tr></thead>" +
    "<tbody>" +
    otherTableRows +
    "</tbody></table>";

  // ── Approval History ────────────────────────────────────────────────────
  let historyHtml = "";
  if (history.length) {
    const historyRows = history
      .map((r, i) => {
        const remark =
          text(r.reject_reason) || text(r.sentback_reason) || text(r.cancel_remark) || "—";
        return (
          "<tr>" +
          "<td>" + (i + 1) + "</td>" +
          "<td>" + escapeHtml(text(r.last_action) || "—") + "</td>" +
          "<td>" + escapeHtml(text(r.user_id) || "—") + "</td>" +
          "<td>" + escapeHtml(dateTimeText(r.user_dt) || "—") + "</td>" +
          '<td class="right">' + escapeHtml(text(r.flow_level_running) || "—") + "</td>" +
          "<td>" + escapeHtml(text(r.next_action_by) || "—") + "</td>" +
          "<td>" + escapeHtml(remark) + "</td>" +
          "</tr>"
        );
      })
      .join("");

    historyHtml =
      '<div class="section-title" style="margin:14px 0 6px 0;font-size:12px;font-weight:700;color:#0b4ca1;">Approval History</div>' +
      '<table class="data-table cr-history">' +
      "<thead><tr>" +
      "<th>Sr.No</th><th>Action</th><th>By</th><th>Date &amp; Time</th>" +
      '<th class="right">Level</th><th>Next Action By</th><th>Remarks</th>' +
      "</tr></thead>" +
      "<tbody>" + historyRows + "</tbody></table>";
  }

  return (
    titleBlock(
      "Credit Request",
      "Request No: " + text(h.request_number) + (text(h.company_name) ? " — " + text(h.company_name) : ""),
      cancelled
    ) +
    kvTwoBoxesHtml("Company / Customer", leftPairs, "Request / Credit", rightPairs) +
    otherHtml +
    historyHtml
  );
}
  // ─── Route handler ──────────────────────────────────────────────────────────

  export const getCreditRequestReportHtml = async (req: RequestWithUser, res: Response): Promise<void> => {
    try {
      const params = extractParams(req);
      assertSafe(params);

      const headerRows = await loadCreditRequestHeader(req, params);
      if (!headerRows.length) {
        res.status(200).json({ success: false, message: "No data found for the selected credit request." });
        return;
      }

      // History is optional: the report still prints if it cannot be loaded.
      let history: ReportRow[] = [];
      try {
        history = await loadCreditRequestHistory(req, params);
      } catch (e) {
        console.warn("Credit request history load failed:", e);
      }

      const headerHtml = await reportHeader({ company_code: params.company_code, req });
      const footerHtml = reportFooter({
        reportName: `Credit Request ${params.request_number}`,
        userName: params.loginid,
        endLabel: "Powered by Bayanat Technology",
      });
      const bodyHtml = renderCreditRequestBody(headerRows[0], history);

      const html = buildReportDocument({
        title: "Credit Request",
        headerHtml,
        bodyHtml,
        footerHtml,
        autoPrint: false,
        showPrintButton: true,
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error: any) {
      console.error("Credit Request report error:", error);
      res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate report" });
    }
  };

  // ─── Generic OOXML Excel builder engine ─────────────────────────────────────

  interface XlCell { v: unknown; styleKey: string }
  type XlRow = (XlCell | null)[];
  interface XlMerge { s: { r: number; c: number }; e: { r: number; c: number } }

  const XL_BLUE = "FF1D4ED8";
  const XL_WHITE = "FFFFFFFF";
  const XL_LIGHT_BLUE_BG = "FFE8F0FA";

  function xlCell(v: unknown, styleKey: string): XlCell {
    return { v, styleKey };
  }

  function defaultXlStyleDefs(): Record<string, any> {
    const borderThin = (color: string) => ({ style: "thin", color: { rgb: color } });
    return {
      title: {
        font: { bold: true, sz: 16, color: { rgb: XL_WHITE } },
        fill: { fgColor: { rgb: XL_BLUE } },
        alignment: { horizontal: "center", vertical: "center" },
      },
      meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
      // Section strip (same look as the report boxes: light blue strip, navy bold text)
      section: {
        font: { bold: true, sz: 10, color: { rgb: "FF0B4CA1" } },
        fill: { fgColor: { rgb: XL_LIGHT_BLUE_BG } },
        alignment: { horizontal: "left", vertical: "center" },
        border: { bottom: borderThin("FFCBD5E1") },
      },
      label: {
        font: { sz: 10, color: { rgb: "FF334155" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: { bottom: borderThin("FFF3F4F6") },
      },
      value: {
        font: { bold: true, sz: 10, color: { rgb: "FF0F172A" } },
        alignment: { horizontal: "left", vertical: "center", wrapText: true },
        border: { bottom: borderThin("FFF3F4F6") },
      },
      header: {
        font: { bold: true, sz: 10, color: { rgb: XL_WHITE } },
        fill: { fgColor: { rgb: XL_BLUE } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: { top: borderThin(XL_BLUE), bottom: borderThin(XL_BLUE), left: borderThin(XL_BLUE), right: borderThin(XL_BLUE) },
      },
      data: { font: { sz: 10 }, alignment: { vertical: "center", wrapText: true }, border: { bottom: borderThin("FFF3F4F6") } },
      dataNumInt: {
        font: { sz: 10 }, alignment: { horizontal: "right", vertical: "center" },
        numFmt: "#,##0", border: { bottom: borderThin("FFF3F4F6") },
      },
      footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } }, alignment: { horizontal: "right" } },
    };
  }

  function buildXlsxBuffer(sheetName: string, colCount: number, colWidth: number, rows_: XlRow[], merges: XlMerge[], styleDefs: Record<string, any>): Buffer {
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
        top: b.top?.color?.rgb, bottom: b.bottom?.color?.rgb, left: b.left?.color?.rgb, right: b.right?.color?.rgb,
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

    const styleIndexFor = (styleKey: string): number => registerXf(styleDefs[styleKey]);

    const colXml = Array.from({ length: colCount }, (_, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${colWidth}" customWidth="1"/>`
    ).join("");

    let sheetDataXml = "";
    rows_.forEach((row, ri) => {
      const rn = ri + 1;
      let rowXml = `<row r="${rn}">`;
      row.forEach((c, ci) => {
        if (c === null) return;
        const ref = String.fromCharCode(65 + ci) + rn;
        const s = styleIndexFor(c.styleKey);
        if (typeof c.v === "number") {
          rowXml += `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
        } else {
          rowXml += `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(c.v ?? "")}</t></is></c>`;
        }
      });
      rowXml += "</row>";
      sheetDataXml += rowXml;
    });

    const mergesXml = merges.map((m) =>
      `<mergeCell ref="${String.fromCharCode(65 + m.s.c)}${m.s.r + 1}:${String.fromCharCode(65 + m.e.c)}${m.e.r + 1}"/>`
    ).join("");
    const mergeFinal = merges.length ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>` : "";

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheetFormatPr defaultRowHeight="15"/>
    <cols>${colXml}</cols>
    <sheetData>${sheetDataXml}</sheetData>
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

    const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
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
    <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
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

  // ─── Excel builder: Credit Request ──────────────────────────────────────────

  function buildCreditRequestExcelBuffer(h: ReportRow, history: ReportRow[]): Buffer {
    const COL_COUNT = 7; // A..G
    const rows_: XlRow[] = [];
    const merges: XlMerge[] = [];

    const status = text(h.last_action).toUpperCase();
    const cancelled = status === "CANCELED" || text(h.cancel_flag).toUpperCase() === "Y";

    const env = [
      text(h.account_env_tms) === "Y" && "TMS",
      text(h.account_env_wms) === "Y" && "WMS",
      text(h.account_env_freight) === "Y" && "FREIGHT",
    ].filter(Boolean).join(", ");

    // Title
    rows_.push([xlCell(cancelled ? "CREDIT REQUEST - CANCELLED" : "CREDIT REQUEST", "title"), ...new Array(COL_COUNT - 1).fill(null)]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } });

    // Meta line
    rows_.push([
      xlCell(`Request No: ${text(h.request_number)}`, "meta"), null, null,
      xlCell(`Date: ${dateText(h.request_date)}`, "meta"), null,
      xlCell(`Status: ${text(h.last_action)}`, "meta"), null,
    ]);
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } });
    merges.push({ s: { r: 1, c: 3 }, e: { r: 1, c: 4 } });
    merges.push({ s: { r: 1, c: 5 }, e: { r: 1, c: 6 } });

    rows_.push(new Array(COL_COUNT).fill(null));

    // Section strip across A:G
    const addSection = (title: string) => {
      const r = rows_.length;
      const row: XlRow = new Array(COL_COUNT).fill(null);
      row[0] = xlCell(title, "section");
      rows_.push(row);
      merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 1 } });
    };

    // Label (A:B) : Value (C:G)
    const addKV = (label: string, value: unknown) => {
      const r = rows_.length;
      const row: XlRow = new Array(COL_COUNT).fill(null);
      row[0] = xlCell(label, "label");
      row[2] = xlCell(text(value), "value");
      rows_.push(row);
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      merges.push({ s: { r, c: 2 }, e: { r, c: COL_COUNT - 1 } });
    };

    const gap = () => rows_.push(new Array(COL_COUNT).fill(null));

    addSection("Request Details");
    addKV("Request Number", h.request_number);
    addKV("Request Date", dateText(h.request_date));
    addKV("Company Name", h.company_name);
    if (h.aware_customer_code) addKV("Customer Code", h.aware_customer_code);
    addKV("Created By", h.create_user);
    addKV("Created Date", dateText(h.create_date));
    addKV("Status", h.last_action);
    gap();

    addSection("Office Address");
    addKV("Way No", h.way_no);
    addKV("Bldg No", h.bldg_no);
    addKV("Flat No", h.flat_no);
    addKV("Location", h.location);
    addKV("Po Box", h.po_box);
    addKV("Postal Code", h.postal_code);
    addKV("City", h.city);
    addKV("Tel No", h.office_tel_no);
    addKV("Fax No", h.fax_no);
    addKV("Website", h.website);
    addKV("Email", h.email);
    gap();

    addSection("Finance Details");
    addKV("Finance Contact Person", h.fin_contact_person);
    addKV("Finance Tel No", h.fin_contact_number);
    addKV("Finance Email", h.fin_contact_email);
    addKV("Commercial Reg No", h.commercial_reg_no);
    addKV("Business Sector", h.business_sector);
    addKV("Contact Person", h.remarks_contact_person);
    addKV("Authorized Signatory", h.authorized_signatory);
    addKV("Signature Date", dateText(h.credit_form_signature_date));
    gap();

    addSection("Credit Requested / Sanctioned");
    addKV("Credit Limit", amt3(h.credit_limit));
    addKV("Requested Credit Period", num(h.requested_credit_period));
    addKV("Sanctioned Credit Limit", amt3(h.sanctioned_credit_limit_amt));
    addKV("Sanctioned Credit Period", num(h.sanctioned_credit_period));
    addKV("Account Environment", env);
    addKV("Account No", h.account_no);
    gap();

    addSection("Comments");
    addKV("Description", h.description);
    addKV("Comments", h.comments);
    addKV("Remarks", h.remarks);

    if (history.length) {
      gap();
      addSection("Approval History");
      rows_.push([
        xlCell("S.No", "header"), xlCell("Action", "header"), xlCell("By", "header"),
        xlCell("Date & Time", "header"), xlCell("Level", "header"),
        xlCell("Next Action By", "header"), xlCell("Remarks", "header"),
      ]);
      history.forEach((r, i) => {
        const remark = text(r.reject_reason) || text(r.sentback_reason) || text(r.cancel_remark);
        rows_.push([
          xlCell(i + 1, "dataNumInt"),
          xlCell(text(r.last_action), "data"),
          xlCell(text(r.user_id), "data"),
          xlCell(dateTimeText(r.user_dt), "data"),
          xlCell(num(r.flow_level_running), "dataNumInt"),
          xlCell(text(r.next_action_by), "data"),
          xlCell(remark, "data"),
        ]);
      });
    }

    rows_.push(new Array(COL_COUNT).fill(null));
    const footer: XlRow = new Array(COL_COUNT).fill(null);
    footer[COL_COUNT - 1] = xlCell("Powered by Bayanat Technology", "footer");
    rows_.push(footer);

    return buildXlsxBuffer("Credit Request", COL_COUNT, 20, rows_, merges, defaultXlStyleDefs());
  }

  // ─── Route handler (Excel) ──────────────────────────────────────────────────

  export const getCreditRequestReportExcel = async (req: RequestWithUser, res: Response): Promise<void> => {
    try {
      const params = extractParams(req);
      assertSafe(params);

      const headerRows = await loadCreditRequestHeader(req, params);
      if (!headerRows.length) {
        res.status(200).json({ success: false, message: "No data found for the selected credit request." });
        return;
      }

      let history: ReportRow[] = [];
      try {
        history = await loadCreditRequestHistory(req, params);
      } catch (e) {
        console.warn("Credit request history load failed:", e);
      }

      const buffer = buildCreditRequestExcelBuffer(headerRows[0], history);
      const safeName = params.request_number.replace(/[^A-Za-z0-9_-]/g, "_");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="Credit_Request_${safeName}.xlsx"`);
      res.end(buffer);
    } catch (error: any) {
      console.error("Credit Request Excel error:", error);
      res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate Excel" });
    }
  };