import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const money = (v: any) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};

const formatBalance = (value: number) => {
  return value < 0 ? `(${money(Math.abs(value))})` : money(value);
};

const text = (v: any) => (v == null ? "" : String(v));

const formatDateStr = (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
};

export const getBalanceSheetReport = async (req: Request, res: Response): Promise<void> => {
  let connection;
  try {
    const {
      parameter, loginid,
      code1, code2, code3, code4, code5, code6, code7, code8, code20
    } = req.body;

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid) tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) { res.status(400).json({ success: false, message: "Tenant not found" }); return; }

    connection = await TenantManager.getConnection(tenantId);

    const binds: any = {
      parameter: parameter || "BALANCE_SHEET_REPORT_MAIN",
      loginid: loginid || "ADMIN",
      code1: code1 || null, code2: code2 || null, code3: code3 || null,
      code4: code4 || null, code5: code5 || null, code6: code6 || null,
      code7: code7 || null, code8: code8 || null, code20: code20 || null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 }
    };
    for (let i = 9; i <= 20; i++) binds[`code${i}`] = req.body[`code${i}`] || null;
    for (let i = 1; i <= 4; i++) {
      binds[`number${i}`] = req.body[`number${i}`] || null;
      if (i > 2) binds[`date${i}`] = req.body[`date${i}`] || null;
    }
    binds.date1 = null; binds.date2 = null;

    const result = await connection.execute(
      `DECLARE v_sql VARCHAR2(32767); BEGIN PROC_BUILD_DYNAMIC_SQL_COMMON20(
          :parameter, :loginid,
          :code1, :code2, :code3, :code4, :code5, :code6, :code7, :code8, :code9, :code10,
          :code11, :code12, :code13, :code14, :code15, :code16, :code17, :code18, :code19, :code20,
          :number1, :number2, :number3, :number4,
          :date1, :date2, :date3, :date4,
          v_sql); :out_sql := v_sql; END;`, binds);

    const rawSql = (result.outBinds as any).out_sql;
    if (!rawSql) throw new Error("The procedure did not return a valid SQL query.");
    console.log("Generated SQL for Balance Sheet Report:", rawSql);

    const dataResult = await connection.execute(rawSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => { acc[key.toLowerCase()] = row[key]; return acc; }, {})
    );

    // ── Aggregate by H_NAME (heading) then BL_CODE/BL_NAME (line item) ──
    // ── Aggregate by H_CODE/H_NAME (heading) then BL_CODE/BL_NAME (line item) ──
    type LineItem = { bl_code: string; bl_name: string; amount: number };
    type HeadingGroup = { h_code: string; h_name: string; total: number; items: LineItem[] };

    const headingMap = new Map<string, HeadingGroup>();

    rows.forEach((r) => {
      const hKey = `${r.h_code}||${r.h_name}`;
      const amount = Number(r.lcur_amount) || 0;

      if (!headingMap.has(hKey)) {
        headingMap.set(hKey, {
          h_code: text(r.h_code),
          h_name: text(r.h_name),
          total: 0,
          items: [],
        });
      }

      const heading = headingMap.get(hKey)!;
      heading.total += amount;

      const lineKey = `${r.bl_code}||${r.bl_name}`;
      let item = heading.items.find((i) => `${i.bl_code}||${i.bl_name}` === lineKey);
      if (!item) {
        item = { bl_code: text(r.bl_code), bl_name: text(r.bl_name), amount: 0 };
        heading.items.push(item);
      }
      item.amount += amount;
    });

    const headings = Array.from(headingMap.values());

    // ── Classify headings using H_CODE directly ──
    // 11 = Non Current Assets
    // 12 = Current Assets
    // 21 = Non Current Liabilities
    // 22 = Current Liabilities
    // 3x = Owners Equity
    // Fallback: leading digit 1 = Assets, 2 = Liabilities, other = Equity

    const nonCurrentAssets      = headings.filter((h) => h.h_code.startsWith("11"));
    const currentAssets         = headings.filter((h) => h.h_code.startsWith("12"));
    const nonCurrentLiabilities = headings.filter((h) => h.h_code.startsWith("21"));
    const currentLiabilities    = headings.filter((h) => h.h_code.startsWith("22"));
    const ownersEquity          = headings.filter((h) => h.h_code.startsWith("3"));

    // Fallback for anything not matched above
    const classified = new Set([
      ...nonCurrentAssets, ...currentAssets,
      ...nonCurrentLiabilities, ...currentLiabilities, ...ownersEquity,
    ]);
    headings.forEach((h) => {
      if (classified.has(h)) return;
      const digit = h.h_code.charAt(0);
      if (digit === "1") currentAssets.push(h);
      else if (digit === "2") currentLiabilities.push(h);
      else ownersEquity.push(h);
    });

    const sum = (arr: HeadingGroup[]) => arr.reduce((s, h) => s + h.total, 0);

    const totalNonCurrentAssets      = sum(nonCurrentAssets);
    const totalCurrentAssets         = sum(currentAssets);
    const totalAssets                = totalNonCurrentAssets + totalCurrentAssets;

    const totalNonCurrentLiabilities = sum(nonCurrentLiabilities);
    const totalCurrentLiabilities    = sum(currentLiabilities);
    const totalLiabilities           = totalNonCurrentLiabilities + totalCurrentLiabilities;

    const netAssets         = totalAssets - totalLiabilities;
    const totalOwnersEquity = sum(ownersEquity);

    // ── Render helpers ──

    const renderLineItems = (heading: HeadingGroup) =>
      heading.items
        .map((item) => `
        <tr class="data-row">
          <td>${text(item.bl_name)}</td>
          <td class="num">${formatBalance(item.amount)}</td>
        </tr>`)
        .join("");

    const renderHeadingGroup = (heading: HeadingGroup) => `
      <tr class="sub-group-header">
        <td><strong>${text(heading.h_name)}</strong></td>
        <td></td>
      </tr>
      ${renderLineItems(heading)}`;

    // Always renders section even when empty — shows "No entries" and 0.000 total
    const renderSection = (title: string, sectionHeadings: HeadingGroup[], total: number) => {
      return `
      <tr class="section-header">
        <td colspan="2"><strong>${title}</strong></td>
      </tr>
      ${sectionHeadings.length === 0
        ? `<tr class="data-row"><td colspan="2" style="padding-left:28px;color:#9ca3af;font-style:italic;">No entries</td></tr>`
        : sectionHeadings.map(renderHeadingGroup).join("")
      }
      <tr class="total-row">
        <td><strong>TOTAL ${title.toUpperCase()}</strong></td>
        <td class="num"><strong>${formatBalance(total)}</strong></td>
      </tr>`;
    };

    const tableBodyHtml = `
      ${renderSection("Non Current Assets", nonCurrentAssets, totalNonCurrentAssets)}
      ${renderSection("Current Assets", currentAssets, totalCurrentAssets)}
      <tr class="grand-total-row">
        <td><strong>TOTAL ASSETS</strong></td>
        <td class="num"><strong>${formatBalance(totalAssets)}</strong></td>
      </tr>

      ${renderSection("Non Current Liabilities", nonCurrentLiabilities, totalNonCurrentLiabilities)}
      ${renderSection("Current Liabilities", currentLiabilities, totalCurrentLiabilities)}
      <tr class="grand-total-row">
        <td><strong>TOTAL LIABILITIES</strong></td>
        <td class="num"><strong>${formatBalance(totalLiabilities)}</strong></td>
      </tr>

      <tr class="net-assets-row">
        <td><strong>NET ASSETS</strong></td>
        <td class="num"><strong>${formatBalance(netAssets)}</strong></td>
      </tr>

      ${renderSection("Owners Equity", ownersEquity, totalOwnersEquity)}
      <tr class="grand-total-row">
        <td><strong>TOTAL OWNERS EQUITY</strong></td>
        <td class="num"><strong>${formatBalance(totalOwnersEquity)}</strong></td>
      </tr>
    `;

    const asOnDate = formatDateStr(code5 || new Date());
    const divisionLabel = (code2 && code2 !== "All") ? ` (Division : ${text(code2)})` : "";
    const reportTitle = `Balance Sheet as on ${asOnDate}${divisionLabel}`;
    const generatedBy = text(loginid) || "Unknown User";
    const reportDate = formatDateStr(new Date());

    const reportHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${reportTitle}</title>
        <style>
          :root { color-scheme: light; }
          body { margin: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f2f4f7; color: #1f2937; }
          .page { width: auto; max-width: 800px; margin: 24px auto; padding: 28px 32px; background: #fff; border-radius: 12px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08); box-sizing: border-box; }
          .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid #d1d5db; padding-bottom: 20px; margin-bottom: 24px; }
          .meta-info { border-collapse: collapse; width: auto; }
          .meta-info td { padding: 4px 8px; vertical-align: top; }
          .label { font-weight: 700; width: 100px; color: #475569; white-space: nowrap; }
          .report-title { font-size: 1rem; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
          .brand-block { text-align: right; }
          .brand-name { font-size: 18px; font-weight: 800; letter-spacing: 0.12em; color: #0d4d89; margin-bottom: 4px; }
          .brand-subtitle { font-size: 0.85rem; letter-spacing: 0.18em; color: #334155; }
          .report-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .report-table th, .report-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; word-break: break-word; white-space: normal; }
          .report-table th { background: #f8fafc; color: #334155; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.02em; text-align: left; }
          .report-table td { background: #fff; font-size: 0.88rem; }
          .section-header td { background: #185FA5; color: #fff; font-weight: 700; padding-top: 10px; padding-bottom: 10px; border-bottom: none; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; }
          .sub-group-header td { background: #eff6ff; font-weight: 700; color: #1e3a8a; border-bottom: 1px solid #c7d2fe; text-decoration: underline; }
          .data-row td { padding-left: 28px; }
          .total-row td { font-weight: 700; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #334155; background: #f8fafc; }
          .grand-total-row td { border-top: 2px solid #334155; border-bottom: 2px solid #334155; font-size: 0.95rem; background: #e6f1fb; color: #0C447C; font-weight: 800; padding-top: 10px; padding-bottom: 10px; }
          .net-assets-row td { font-size: 0.98rem; color: #b91c1c; font-weight: 800; background: #fef2f2; border-top: 2px solid #334155; border-bottom: 2px solid #334155; padding-top: 10px; padding-bottom: 10px; }
          .num { text-align: right; font-family: 'Courier New', Courier, monospace; }
          .footer { margin-top: 30px; text-align: center; color: #475569; font-size: 0.82rem; padding-top: 10px; border-top: 1px solid #e2e8f0; }
          .no-print { margin-bottom: 16px; text-align: right; }
          .button { display: inline-flex; align-items: center; justify-content: center; padding: 10px 18px; border-radius: 999px; border: none; background: #2563eb; color: #fff; font-weight: 700; cursor: pointer; transition: background-color 0.2s ease; }
          .button:hover { background: #1d4ed8; }
          @media print { body { background: #fff; } .page { box-shadow: none; margin: 0; border-radius: 0; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="no-print">
          <button class="button" onclick="window.print()">Print / Save PDF</button>
        </div>
        <div class="page">
          <div class="header-top">
            <div>
              <div class="report-title">${reportTitle}</div>
              <table class="meta-info">
                <tr><td class="label">Title</td><td>${reportTitle}</td></tr>
                <tr><td class="label">Date</td><td>${reportDate}</td></tr>
                <tr><td class="label">User</td><td>${generatedBy}</td></tr>
                <tr><td class="label">Report</td><td>rpt_balance_sheet</td></tr>
              </table>
            </div>
            <div class="brand-block">
              <div class="brand-name">AL MADINA</div>
              <div class="brand-subtitle">LOGISTICS COMPANY</div>
            </div>
          </div>
          <table class="report-table">
            <thead>
              <tr>
                <th>Description</th>
                <th class="num" style="width:160px;">Amount</th>
              </tr>
            </thead>
            <tbody>${tableBodyHtml || '<tr><td colspan="2" style="text-align:center;padding:36px 0;">No records found.</td></tr>'}</tbody>
          </table>
          <div class="footer">Generated by ${generatedBy} • ${reportDate}</div>
        </div>
      </body>
      </html>`;

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(reportHtml);

  } catch (error: any) {
    console.error("Balance Sheet Report Error:", error);
    res.status(500).json({ success: false, message: "Unable to generate report", details: error.message });
  } finally {
    if (connection) { try { await connection.close(); } catch (e) { console.error(e); } }
  }
};