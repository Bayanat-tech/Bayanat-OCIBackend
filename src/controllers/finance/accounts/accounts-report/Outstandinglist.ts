import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";
import { RequestWithUser } from "../../../../interfaces/common.interface";
import {
  FREIGHT_COLORS as C,
  reportHeader,
  reportFooter,
  reportAppliedFilters,
  buildReportDocument,
} from "../../../common/report_common";

/* ───────────────────────── helpers ───────────────────────── */
const text = (v: any) => (v == null ? "" : String(v));
const num = (v: any) => Number(v) || 0;
const money = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.000";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};
/** Negative = red, zero = dimmed */
const moneyCell = (v: number) =>
  `<span class="${v < 0 ? "neg" : v === 0 ? "zero" : ""}">${money(v)}</span>`;
const pct = (part: number, whole: number) =>
  whole ? `${((part / whole) * 100).toFixed(1)}%` : "0.0%";
const plural = (n: number, one: string, many = one + "s") =>
  `${n} ${n === 1 ? one : many}`;

const escapeHtml = (v: any) =>
  text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/** Accepts ISO, dd/mm/yyyy, dd-mm-yyyy, dd-MMM-yyyy, Date objects. */
const parseDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};
const formatDate = (v: any) => {
  const d = parseDate(v);
  if (!d) return text(v);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};
const DAY_MS = 86400000;

/* Ageing buckets */
const BUCKETS = [
  { key: "b0", label: "0 – 30 days", fg: "#15803d", bg: "#dcfce7" },
  { key: "b1", label: "31 – 60 days", fg: "#a16207", bg: "#fef9c3" },
  { key: "b2", label: "61 – 90 days", fg: "#c2410c", bg: "#ffedd5" },
  { key: "b3", label: "Over 90 days", fg: "#b91c1c", bg: "#fee2e2" },
];
const bucketOf = (age: number) =>
  age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;

/* ───────────────────────── report CSS ───────────────────────── */
const OUTSTANDING_EXTRA_CSS = `
  :root {
    --bd: ${C.rule};
    --bd-soft: ${C.ruleSoft};
    ${BUCKETS.map((b) => `--${b.key}-fg:${b.fg}; --${b.key}-bg:${b.bg};`).join(" ")}
  }

  /* ===== Title + Currency bar (clean UX) ===== */
  .doc-title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin: 0 0 10px 0;
    padding-bottom: 8px;
    border-bottom: 2px solid ${C.navy};
  }
  .doc-title-row .report-title {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.3px;
    color: ${C.navy};
  }
  .doc-title-row .currency-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: ${C.strip};
    border: 1px solid ${C.stripBorder};
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    color: ${C.navy};
    white-space: nowrap;
  }
  .doc-title-row .currency-pill .curr-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: ${C.muted};
  }

  /* ===== Numbered section headings ===== */
  .sec {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 18px 0 8px 0;
    break-after: avoid;
  }
  .sec .sec-no {
    flex: 0 0 auto;
    width: 18px; height: 18px;
    display: inline-flex; align-items: center; justify-content: center;
    background: ${C.navy};
    color: #fff;
    font-size: 10px;
    font-weight: 800;
    border-radius: 3px;
  }
  .sec .sec-name {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: ${C.navy};
    white-space: nowrap;
  }
  .sec .sec-line { flex: 1; height: 1px; background: var(--bd); }
  .sec .sec-note { font-size: 9px; color: ${C.muted}; white-space: nowrap; }

  /* ===== Joined stat strips ===== */
  .stat-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border: 1px solid var(--bd);
    border-radius: 4px;
    overflow: hidden;
    background: #fff;
  }
  .stat-strip > .stat {
    min-width: 0;
    padding: 8px 10px;
    border-right: 1px solid var(--bd);
  }
  .stat-strip > .stat:last-child { border-right: 0; }
  .stat.accent { background: ${C.strip}; }
  .stat .stat-label {
    display: flex; align-items: center; gap: 5px;
    font-size: 9px; font-weight: 700; letter-spacing: 0.4px;
    text-transform: uppercase; color: ${C.muted};
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .stat .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
  .stat .stat-value {
    margin-top: 3px;
    font-size: 14px; font-weight: 800; color: ${C.navy};
    font-variant-numeric: tabular-nums;
    white-space: nowrap; overflow: hidden; text-overflow: clip;
  }
  .stat .stat-sub {
    margin-top: 2px; font-size: 9px; color: ${C.muted};
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .stat .bar { margin-top: 5px; }

  .bar {
    position: relative; height: 5px;
    background: var(--bd-soft); border-radius: 3px; overflow: hidden;
  }
  .bar > i {
    position: absolute; left: 0; top: 0; bottom: 0;
    display: block; background: ${C.navy};
  }

  /* ===== CRITICAL: fixed-layout tables that never overflow ===== */
  table.data-table.grid {
    table-layout: fixed;          /* ← forces columns to respect widths */
    width: 100%;
    max-width: 100%;
    border: 1px solid var(--bd);
    border-collapse: collapse;
  }
  table.data-table.grid thead th {
    border: 1px solid ${C.navyDeep} !important;
    padding: 6px 6px;
    font-size: 9.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  table.data-table.grid tbody tr td {
    border: 1px solid var(--bd) !important;
    padding: 4px 6px;
    min-width: 0;                 /* allows flex/grid children to shrink */
    overflow: hidden;
    vertical-align: top;
    font-size: 10px;
  }
  /* Narration / any long text – wrap hard */
  table.data-table.grid td.wrap {
    white-space: normal !important;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.35;
  }
  table.data-table.grid td.num,
  table.data-table.grid th.num {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  table.data-table.grid td.center,
  table.data-table.grid th.center {
    text-align: center;
    white-space: nowrap;
  }
  table.data-table.grid tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .neg  { color: #b91c1c; }
  .zero { color: #94a3b8; }

  /* ===== Summary table ===== */
  table.data-table.summary tbody tr td { background: #fff !important; }
  table.data-table.summary tbody tr:nth-child(even) td { background: ${C.rowAlt} !important; }
  table.data-table.summary tbody tr.sum-total td {
    background: ${C.grandTotalBg} !important;
    color: ${C.navy};
    font-weight: 800;
  }
  .share { display: flex; align-items: center; gap: 6px; }
  .share .bar { flex: 1; min-width: 0; }
  .share span { flex: 0 0 auto; width: 38px; text-align: right; font-variant-numeric: tabular-nums; }

  /* ===== Badges / chips ===== */
  .badge {
    display: inline-block; padding: 1px 6px; margin-right: 6px;
    border-radius: 3px; font-size: 9px; font-weight: 800;
    letter-spacing: 0.3px; white-space: nowrap; vertical-align: middle;
  }
  .badge.l4 { background: ${C.navy}; color: #fff; }
  .badge.ac { background: #fff; color: ${C.navy}; border: 1px solid ${C.stripBorder}; }
  .chip {
    display: inline-block; min-width: 34px; padding: 1px 6px;
    border-radius: 9px; font-size: 9px; font-weight: 800; text-align: center;
  }
  ${BUCKETS.map(
    (b) => `.chip.${b.key} { color: var(--${b.key}-fg); background: var(--${b.key}-bg); }
  .dot.${b.key} { background: var(--${b.key}-fg); }
  .bar > i.${b.key} { background: var(--${b.key}-fg); }`
  ).join("\n  ")}

  /* ===== Group block ===== */
  .grp { margin: 0 0 14px 0; }
  .grp-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 6px 10px;
    background: ${C.strip};
    border: 1px solid var(--bd);
    border-left: 4px solid ${C.navy};
    border-bottom: 0;
    break-after: avoid;
  }
  .grp-head .gh-title {
    min-width: 0; flex: 1 1 auto;
    font-size: 11px; font-weight: 800; color: ${C.navy};
    white-space: normal; overflow-wrap: anywhere;
  }
  .grp-head .gh-meta {
    flex: 0 0 auto; display: flex; gap: 6px;
  }
  .grp-head .gh-pill {
    padding: 1px 7px; background: #fff; border: 1px solid ${C.stripBorder};
    border-radius: 9px; font-size: 9px; font-weight: 700; color: ${C.label};
    white-space: nowrap;
  }

  table.data-table.detail tbody tr.ac-row td {
    background: ${C.subtotalBg} !important;
    color: ${C.text};
    font-weight: 800;
  }
  table.data-table.detail tbody tr.detail-row td { background: #fff !important; }
  table.data-table.detail tbody tr.detail-row.alt td { background: ${C.rowAlt} !important; }
  table.data-table.detail tbody tr.detail-row td.sl { color: ${C.muted}; text-align: center; }
  table.data-table.detail tbody tr.detail-row td.inv { font-weight: 700; color: ${C.navy}; }
  table.data-table.detail tbody tr.ac-total td {
    background: ${C.rowAlt} !important;
    color: ${C.text};
    font-weight: 700;
    border-top: 1.5px solid ${C.muted} !important;
  }
  table.data-table.detail tbody tr.l4-total td {
    background: ${C.strip} !important;
    color: ${C.navy};
    font-weight: 800;
    border-top: 1.5px solid ${C.navy} !important;
  }

  /* ===== Grand total bar ===== */
  table.data-table.grandbar { margin-top: 4px; }
  table.data-table.grandbar tbody tr td {
    background: ${C.navy} !important;
    color: #fff;
    font-weight: 800;
    font-size: 11px;
    padding: 8px 7px;
    border: 1px solid ${C.navyDeep} !important;
  }

  /* ===== Legend ===== */
  .legend {
    display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
    margin-top: 10px; padding: 6px 10px;
    border: 1px solid var(--bd); border-radius: 4px; background: #f8fafc;
    font-size: 9px; color: ${C.muted};
  }
  .legend .lg-title { font-weight: 800; color: ${C.label}; text-transform: uppercase; letter-spacing: 0.4px; }
  .legend .lg-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }

  /* ===== Print safety ===== */
  @media print {
    .stat-strip, .grp-head, .bar, .bar > i, .badge, .chip, .dot, .legend, .sec-no,
    .currency-pill {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .stat-strip, .legend { break-inside: avoid; }
    .grp-head { break-after: avoid; }
    table.data-table.grid {
      width: 100% !important;
      max-width: 100% !important;
    }
    table.data-table.grid thead th {
      background: ${C.navy} !important; color: #fff !important;
      border: 1px solid ${C.navyDeep} !important;
    }
    table.data-table.grid tbody tr td {
      border: 1px solid var(--bd) !important;
      font-size: 9.5px;
    }
    table.data-table.detail tbody tr.ac-row { break-after: avoid; }
    table.data-table.detail tbody tr.ac-total,
    table.data-table.detail tbody tr.l4-total { break-inside: avoid; }
    table.data-table.grandbar { break-inside: avoid; }
    table.data-table.grandbar tbody tr td { background: ${C.navy} !important; color: #fff !important; }
  }
`;

/* ───────────────────────── types ───────────────────────── */
type Totals = { org: number; unalloc: number; balance: number; count: number };
type AccGroup = Totals & { ac_code: string; ac_name: string; rows: any[] };
type L4Group = Totals & {
  l4_code: string;
  l4_description: string;
  accounts: Map<string, AccGroup>;
};

/* ───────────────────────── controller ───────────────────────── */
export const OutstandingList = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;
  try {
    const {
      loginid,
      company_code,
      code1, code2, code3, code4, code5, code6,
      code7, code8, code9, code10, code11, code12, code13, code14,
      code15, code16,
    } = req.body;

    const parameter = "Account_Report_VW_PERIODWISE_OUTSTD_LIST";

    let tenantId = getCurrentTenantId();
    if (!tenantId && loginid)
      tenantId = await TenantManager.getTenantForUser(loginid);
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    const binds: any = {
      parameter,
      loginid: loginid || "ADMIN",
      code1: code1 || null, code2: code2 || null, code3: code3 || null,
      code4: code4 || null, code5: code5 || null, code6: code6 || null,
      code7: code7 || null, code8: code8 || null, code9: code9 || null,
      code10: code10 || null, code11: code11 || null, code12: code12 || null,
      code13: code13 || null, code14: code14 || null, code15: code15 || null,
      code16: code16 || null,
      code17: null, code18: null, code19: null, code20: null,
      number1: null, number2: null, number3: null, number4: null,
      date1: null, date2: null, date3: null, date4: null,
      out_sql: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
    };

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

    const dataResult = await connection.execute(rawSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows = (dataResult.rows as any[]).map((row) =>
      Object.keys(row).reduce((acc: any, key) => {
        acc[key.toLowerCase()] = row[key];
        return acc;
      }, {})
    );

    /* ─── Ageing set-up ─── */
    const asOn = parseDate(code6);
    const hasAge = !!asOn;
    const ageOf = (v: any): number | null => {
      const d = parseDate(v);
      if (!d || !asOn) return null;
      return Math.max(0, Math.floor((asOn.getTime() - d.getTime()) / DAY_MS));
    };

    /* ─── 1. Group + total ─── */
    const l4Map = new Map<string, L4Group>();
    const grand: Totals = { org: 0, unalloc: 0, balance: 0, count: 0 };
    const bucketBal = [0, 0, 0, 0];
    const bucketCnt = [0, 0, 0, 0];
    let accountCount = 0;

    rows.forEach((r) => {
      const l4Key = text(r.l4_code);
      const acKey = text(r.ac_code);

      if (!l4Map.has(l4Key))
        l4Map.set(l4Key, {
          l4_code: l4Key,
          l4_description: text(r.l4_description),
          accounts: new Map(),
          org: 0, unalloc: 0, balance: 0, count: 0,
        });
      const l4 = l4Map.get(l4Key)!;

      if (!l4.accounts.has(acKey)) {
        l4.accounts.set(acKey, {
          ac_code: acKey,
          ac_name: text(r.ac_name),
          rows: [],
          org: 0, unalloc: 0, balance: 0, count: 0,
        });
        accountCount++;
      }
      const ac = l4.accounts.get(acKey)!;

      const org = num(r.org_amt);
      const unalloc = num(r.un_allocated_amt);
      const balance = num(r.balance_amount);

      ac.rows.push(r);
      for (const t of [ac, l4, grand]) {
        t.org += org;
        t.unalloc += unalloc;
        t.balance += balance;
        t.count += 1;
      }

      if (hasAge) {
        const age = ageOf(r.inv_date);
        if (age != null) {
          const b = bucketOf(age);
          bucketBal[b] += balance;
          bucketCnt[b] += 1;
        }
      }
    });

    let sectionNo = 0;
    const section = (name: string, note = "") => `
      <div class="sec">
        <span class="sec-no">${++sectionNo}</span>
        <span class="sec-name">${escapeHtml(name)}</span>
        <span class="sec-line"></span>
        ${note ? `<span class="sec-note">${escapeHtml(note)}</span>` : ""}
      </div>`;

    /* ─── 2. Overview strip ─── */
    const overviewHtml = `
      ${section("Overview")}
      <div class="stat-strip">
        <div class="stat">
          <div class="stat-label">Total Invoiced</div>
          <div class="stat-value">${money(grand.org)}</div>
          <div class="stat-sub">${plural(grand.count, "invoice")}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Un-Allocated</div>
          <div class="stat-value">${money(grand.unalloc)}</div>
          <div class="stat-sub">${pct(grand.unalloc, grand.org)} of invoiced</div>
        </div>
        <div class="stat accent">
          <div class="stat-label">Outstanding Balance</div>
          <div class="stat-value">${money(grand.balance)}</div>
          <div class="stat-sub">${pct(grand.balance, grand.org)} of invoiced</div>
        </div>
        <div class="stat">
          <div class="stat-label">Coverage</div>
          <div class="stat-value">${accountCount}</div>
          <div class="stat-sub">${plural(accountCount, "account")} in ${plural(l4Map.size, "group")}</div>
        </div>
      </div>`;

    /* ─── 3. Ageing strip ─── */
    const ageingHtml = hasAge
      ? `
      ${section("Ageing of Balance", `As on ${formatDate(asOn)}`)}
      <div class="stat-strip">
        ${BUCKETS.map((b, i) => {
          const share = grand.balance
            ? Math.max(0, Math.min(100, (bucketBal[i] / grand.balance) * 100))
            : 0;
          return `
        <div class="stat">
          <div class="stat-label"><span class="dot ${b.key}"></span>${b.label}</div>
          <div class="stat-value">${money(bucketBal[i])}</div>
          <div class="stat-sub">${pct(bucketBal[i], grand.balance)} · ${plural(bucketCnt[i], "invoice")}</div>
          <div class="bar"><i class="${b.key}" style="width:${share.toFixed(1)}%"></i></div>
        </div>`;
        }).join("")}
      </div>`
      : "";

    /* ─── 4. Summary by group ─── */
    let sumBody = "";
    l4Map.forEach((l4) => {
      const share = grand.balance
        ? Math.max(0, Math.min(100, (l4.balance / grand.balance) * 100))
        : 0;
      sumBody += `
        <tr>
          <td class="wrap"><span class="badge l4">${escapeHtml(l4.l4_code)}</span>${escapeHtml(l4.l4_description)}</td>
          <td class="center">${l4.accounts.size}</td>
          <td class="center">${l4.count}</td>
          <td class="num">${moneyCell(l4.org)}</td>
          <td class="num">${moneyCell(l4.unalloc)}</td>
          <td class="num">${moneyCell(l4.balance)}</td>
          <td><div class="share"><div class="bar"><i style="width:${share.toFixed(1)}%"></i></div><span>${pct(l4.balance, grand.balance)}</span></div></td>
        </tr>`;
    });
    sumBody += `
        <tr class="sum-total">
          <td>Total</td>
          <td class="center">${accountCount}</td>
          <td class="center">${grand.count}</td>
          <td class="num">${moneyCell(grand.org)}</td>
          <td class="num">${moneyCell(grand.unalloc)}</td>
          <td class="num">${moneyCell(grand.balance)}</td>
          <td class="num">100.0%</td>
        </tr>`;

    const summaryHtml = `
      ${section("Summary by Group")}
      <table class="data-table grid summary">
        <colgroup>
          <col style="width:28%" />
          <col style="width:7%" />
          <col style="width:7%" />
          <col style="width:14%" />
          <col style="width:14%" />
          <col style="width:14%" />
          <col style="width:16%" />
        </colgroup>
        <thead>
          <tr>
            <th class="left">Group</th>
            <th class="center">Accts</th>
            <th class="center">Invs</th>
            <th class="num">Inv Amount</th>
            <th class="num">Un-Allocated</th>
            <th class="num">Balance</th>
            <th class="left">Share of Balance</th>
          </tr>
        </thead>
        <tbody>${sumBody}</tbody>
      </table>`;

    /* ─── 5. Invoice details – fixed columns that never overflow ─── */
    const COLS = hasAge ? 7 : 6;
    const LABEL_SPAN = hasAge ? 4 : 3;

    // Percentages carefully chosen so numbers stay on-page even with long inv_no / narration
    const colgroup = hasAge
      ? `<col style="width:4%" />
         <col style="width:22%" />
         <col style="width:11%" />
         <col style="width:9%" />
         <col style="width:18%" />
         <col style="width:18%" />
         <col style="width:18%" />`
      : `<col style="width:4%" />
         <col style="width:28%" />
         <col style="width:12%" />
         <col style="width:18%" />
         <col style="width:19%" />
         <col style="width:19%" />`;

    const theadHtml = `
        <thead>
          <tr>
            <th class="center">#</th>
            <th class="left">Invoice No</th>
            <th class="center">Inv Date</th>
            ${hasAge ? `<th class="center">Age</th>` : ""}
            <th class="num">Inv Amount</th>
            <th class="num">Un-Allocated</th>
            <th class="num">Balance</th>
          </tr>
        </thead>`;

    let groupsHtml = "";
    l4Map.forEach((l4) => {
      let body = "";

      l4.accounts.forEach((ac) => {
        body += `
          <tr class="ac-row">
            <td colspan="${COLS}" class="wrap">
              <span class="badge ac">${escapeHtml(ac.ac_code)}</span>${escapeHtml(ac.ac_name)}
            </td>
          </tr>`;

        ac.rows.forEach((r, i) => {
          const age = hasAge ? ageOf(r.inv_date) : null;
          body += `
          <tr class="detail-row${i % 2 ? " alt" : ""}">
            <td class="sl">${i + 1}</td>
            <td class="inv wrap">${escapeHtml(r.inv_no)}</td>
            <td class="center">${escapeHtml(formatDate(r.inv_date))}</td>
            ${
              hasAge
                ? `<td class="center">${
                    age == null
                      ? "–"
                      : `<span class="chip ${BUCKETS[bucketOf(age)].key}">${age}d</span>`
                  }</td>`
                : ""
            }
            <td class="num">${moneyCell(num(r.org_amt))}</td>
            <td class="num">${moneyCell(num(r.un_allocated_amt))}</td>
            <td class="num">${moneyCell(num(r.balance_amount))}</td>
          </tr>`;
        });

        body += `
          <tr class="ac-total">
            <td colspan="${LABEL_SPAN}" class="wrap">Total for ${escapeHtml(ac.ac_name)} · ${plural(ac.count, "invoice")}</td>
            <td class="num">${moneyCell(ac.org)}</td>
            <td class="num">${moneyCell(ac.unalloc)}</td>
            <td class="num">${moneyCell(ac.balance)}</td>
          </tr>`;
      });

      body += `
          <tr class="l4-total">
            <td colspan="${LABEL_SPAN}" class="wrap">Total for ${escapeHtml(l4.l4_description)}</td>
            <td class="num">${moneyCell(l4.org)}</td>
            <td class="num">${moneyCell(l4.unalloc)}</td>
            <td class="num">${moneyCell(l4.balance)}</td>
          </tr>`;

      groupsHtml += `
      <div class="grp">
        <div class="grp-head">
          <div class="gh-title">
            <span class="badge l4">${escapeHtml(l4.l4_code)}</span>${escapeHtml(l4.l4_description)}
          </div>
          <div class="gh-meta">
            <span class="gh-pill">${plural(l4.accounts.size, "account")}</span>
            <span class="gh-pill">${plural(l4.count, "invoice")}</span>
          </div>
        </div>
        <table class="data-table grid detail">
          <colgroup>${colgroup}</colgroup>
          ${theadHtml}
          <tbody>${body}</tbody>
        </table>
      </div>`;
    });

    const grandBar = `
      <table class="data-table grid grandbar">
        <colgroup>${colgroup}</colgroup>
        <tbody>
          <tr>
            <td colspan="${LABEL_SPAN}">Grand Total · ${plural(accountCount, "account")} · ${plural(grand.count, "invoice")}</td>
            <td class="num">${money(grand.org)}</td>
            <td class="num">${money(grand.unalloc)}</td>
            <td class="num">${money(grand.balance)}</td>
          </tr>
        </tbody>
      </table>`;

    const detailHtml = `
      ${section("Invoice Details", plural(l4Map.size, "group"))}
      ${groupsHtml}
      ${grandBar}`;

    const legendHtml = hasAge
      ? `
      <div class="legend">
        <span class="lg-title">Age legend</span>
        ${BUCKETS.map(
          (b) => `<span class="lg-item"><span class="chip ${b.key}">d</span>${b.label}</span>`
        ).join("")}
        <span>Age = days from invoice date to the “as on” date.</span>
      </div>`
      : "";

    /* ─── 6. Page body – improved title + currency UX ─── */
    const currency = text(code1 || "OMR"); // adjust if your currency comes from another code

    const filtersHtml = reportAppliedFilters([
      { label: "Ageing as on", value: hasAge ? formatDate(asOn) : code6 },
      { label: "Division", value: code2 || "All" },
    ]);

    const bodyHtml = l4Map.size
      ? `
      <div class="doc-title-row">
        <h1 class="report-title">Outstanding List</h1>
        <div class="currency-pill">
          <span class="curr-label">Currency</span>
          <span>${escapeHtml(currency)}</span>
        </div>
      </div>
      ${filtersHtml}
      ${overviewHtml}
      ${ageingHtml}
      ${summaryHtml}
      ${detailHtml}
      ${legendHtml}`
      : `
      <div class="doc-title-row">
        <h1 class="report-title">Outstanding List</h1>
        <div class="currency-pill">
          <span class="curr-label">Currency</span>
          <span>${escapeHtml(currency)}</span>
        </div>
      </div>
      ${filtersHtml}
      <div class="empty">No records found.</div>`;

    /* ─── 7. Header / footer / document ─── */
    const companyCode = text(
      company_code || (req as RequestWithUser).user?.company_code
    );
    const headerHtml = await reportHeader({
      company_code: companyCode,
      req: req as RequestWithUser,
    });

    const html = buildReportDocument({
      title: "Outstanding List",
      headerHtml,
      bodyHtml,
      footerHtml: reportFooter({
        reportName: "Outstanding List",
        userName: text(loginid),
        endLabel: "Powered by Bayanat Technology",
      }),
      extraCss: OUTSTANDING_EXTRA_CSS,
      autoPrint: false,
      showPrintButton: true,
      fontMode: "native",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (error: any) {
    console.error("Outstanding List Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to generate report",
      details: error.message,
    });
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