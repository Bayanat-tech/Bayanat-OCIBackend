import constants from "../helpers/constants";
import { QueryExecutor } from "../database/QueryExecutor";

export type SmsTableConfig = {
  table: string;
  pk: string;
  columns: string[];
  dateColumns?: string[];
  uniqueColumns?: string[];
  defaultOrder: string;
  salesScoped?: boolean;
};

export const smsListConfigs: Record<string, SmsTableConfig> = {
  lead: {
    table: constants.TABLE.SMS_COMPANY,
    pk: "id",
    columns: ["company_code", "company_name", "address", "city", "country", "created_by", "updated_by", "created_at", "updated_at"],
    uniqueColumns: ["company_name"],
    defaultOrder: "id DESC",
  },
  services: {
    table: constants.TABLE.SMS_SERVICE,
    pk: "id",
    columns: ["service_code", "service_name", "created_by", "updated_by", "created_at", "updated_at"],
    uniqueColumns: ["service_name"],
    defaultOrder: "id DESC",
  },
  segment_master: {
    table: constants.TABLE.SMS_SEGMENT,
    pk: "id",
    columns: ["segment_code", "segment_name", "created_by", "updated_by", "created_at", "updated_at"],
    uniqueColumns: ["segment_name"],
    defaultOrder: "id DESC",
  },
  salesman_master: {
    table: constants.TABLE.SMS_SALES,
    pk: "id",
    columns: ["sales_code", "sales_name", "contact_no", "email", "created_by", "updated_by", "created_at", "updated_at"],
    uniqueColumns: ["sales_name"],
    defaultOrder: "id DESC",
  },
  reject_reason: {
    table: constants.TABLE.SMS_REASON,
    pk: "id",
    columns: ["reason_code", "lost_reason", "created_by", "updated_by", "created_at", "updated_at"],
    uniqueColumns: ["lost_reason"],
    defaultOrder: "id DESC",
  },
  deal_status: {
    table: constants.TABLE.SMS_DEAL_STATUS,
    pk: "id",
    columns: ["status_code", "deal_status", "status_percentage", "created_by", "updated_by", "created_at", "updated_at"],
    uniqueColumns: ["deal_status"],
    defaultOrder: "id DESC",
  },
  deal_probability: {
    table: constants.TABLE.SMS_DEAL_PROBABILITY,
    pk: "id",
    columns: ["probability_code", "deal_probability", "created_by", "updated_by", "created_at", "updated_at"],
    uniqueColumns: ["deal_probability"],
    defaultOrder: "id DESC",
  },
  sales_request: {
    table: constants.TABLE.SMS_SALES_REQUEST,
    pk: "sr_no",
    columns: [
      "sales_name",
      "company_name",
      "service_offered",
      "segment",
      "contact_name",
      "contact_number",
      "deal_desc",
      "deal_ref",
      "deal_date",
      "deal_size",
      "deal_probability",
      "deal_status",
      "weighted_forecast",
      "lost_reason",
      "status_update",
      "project_closing_date",
      "next_action",
      "note",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    dateColumns: ["deal_date", "project_closing_date"],
    defaultOrder: "sr_no DESC",
    salesScoped: true,
  },
};

export const smsGmConfigs: Record<string, SmsTableConfig> = {
  company_master: smsListConfigs.lead,
  service_master: smsListConfigs.services,
  segment_master: smsListConfigs.segment_master,
  sales_master: smsListConfigs.salesman_master,
  reason_master: smsListConfigs.reject_reason,
  deal_master: smsListConfigs.deal_status,
  probability_master: smsListConfigs.deal_probability,
  sales_request: smsListConfigs.sales_request,
};

export function getSmsConfig(master: string) {
  return smsListConfigs[master] || smsGmConfigs[master];
}

export async function selectSmsRows(config: SmsTableConfig, options: { page?: number; limit?: number; salesName?: string } = {}) {
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.max(Number(options.limit) || 20, 1);
  const offset = (page - 1) * limit;
  const binds: Record<string, unknown> = {};
  const where: string[] = [];

  if (config.salesScoped && options.salesName) {
    where.push("sales_name = :salesName");
    binds.salesName = options.salesName;
  }

  const whereClause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const countResult = await QueryExecutor.executeRawQuery(`SELECT COUNT(*) AS total_count FROM ${config.table}${whereClause}`, binds);
  const dataResult = await QueryExecutor.executeRawQuery(
    `SELECT * FROM ${config.table}${whereClause} ORDER BY ${config.defaultOrder} OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset, limit },
  );

  return {
    tableData: normalizeRows(dataResult.rows || []),
    count: Number((countResult.rows || [])[0]?.TOTAL_COUNT || 0),
  };
}

export async function selectAllSmsMasterData() {
  const [companies, services, segments, salesmen, reasons, deals, probabilities] = await Promise.all([
    selectAll(smsListConfigs.lead),
    selectAll(smsListConfigs.services),
    selectAll(smsListConfigs.segment_master),
    selectAll(smsListConfigs.salesman_master),
    selectAll(smsListConfigs.reject_reason),
    selectAll(smsListConfigs.deal_status),
    selectAll(smsListConfigs.deal_probability),
  ]);
  return { companies, services, segments, salesmen, reasons, deals, probabilities };
}

export async function insertSmsRecord(config: SmsTableConfig, record: Record<string, unknown>, loginid: string) {
  const payload = buildPayload(config, record, loginid, false);
  await assertUnique(config, payload);
  const columns = Object.keys(payload);
  const binds = columns.reduce<Record<string, unknown>>((acc, column) => {
    acc[column] = payload[column];
    return acc;
  }, {});
  await QueryExecutor.executeRawQuery(
    `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${columns.map((column) => `:${column}`).join(", ")})`,
    binds,
  );
}

export async function updateSmsRecord(config: SmsTableConfig, record: Record<string, unknown>, loginid: string) {
  const id = record[config.pk];
  if (id === undefined || id === null || id === "") throw new Error(`${config.pk} is required`);
  const payload = buildPayload(config, record, loginid, true);
  await assertUnique(config, payload, id);
  const columns = Object.keys(payload).filter((column) => column !== config.pk);
  const binds = columns.reduce<Record<string, unknown>>((acc, column) => {
    acc[column] = payload[column];
    return acc;
  }, { id });
  await QueryExecutor.executeRawQuery(
    `UPDATE ${config.table} SET ${columns.map((column) => `${column} = :${column}`).join(", ")} WHERE ${config.pk} = :id`,
    binds,
  );
}

export async function deleteSmsRows(config: SmsTableConfig, ids: unknown[]) {
  if (!ids?.length) throw new Error("At least one record is required");
  const binds = ids.reduce<Record<string, unknown>>((acc, id, index) => {
    acc[`id${index}`] = id;
    return acc;
  }, {});
  await QueryExecutor.executeRawQuery(
    `DELETE FROM ${config.table} WHERE ${config.pk} IN (${ids.map((_, index) => `:id${index}`).join(", ")})`,
    binds,
  );
}

export async function selectSmsDashboardView(viewName: string, salesName?: string) {
  const allowedViews = new Set([
    "vw_sales_pipeline_summary",
    "vw_sales_performance",
    "vw_deal_probability_analysis",
    "vw_monthly_pipeline_forecast",
    "vw_next_actions_overview",
    "vw_segment_performance",
  ]);
  if (!allowedViews.has(viewName)) throw new Error("Invalid dashboard view");
  const binds: Record<string, unknown> = {};
  const where = salesName ? " WHERE sales_name = :salesName" : "";
  if (salesName) binds.salesName = salesName;
  const result = await QueryExecutor.executeRawQuery(`SELECT * FROM ${viewName}${where}`, binds);
  return normalizeRows(result.rows || []);
}

function buildPayload(config: SmsTableConfig, record: Record<string, unknown>, loginid: string, update: boolean) {
  const payload: Record<string, unknown> = {};
  const dateColumns = new Set(config.dateColumns || []);

  for (const column of config.columns) {
    if (column === "created_at" || column === "updated_at") continue;
    if (column === "created_by" && update) continue;
    if (column === "created_by" || column === "updated_by") {
      payload[column] = loginid;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(record, column)) {
      payload[column] = dateColumns.has(column) ? toDate(record[column]) : record[column];
    }
  }

  if (!update) {
    payload.created_by = loginid;
    payload.created_at = new Date();
  }
  payload.updated_by = loginid;
  payload.updated_at = new Date();

  if (config.table === constants.TABLE.SMS_SALES_REQUEST) {
    payload.weighted_forecast = calculateWeightedForecast(payload);
  }

  return payload;
}

async function assertUnique(config: SmsTableConfig, payload: Record<string, unknown>, currentId?: unknown) {
  if (!config.uniqueColumns?.length) return;
  const presentColumns = config.uniqueColumns.filter((column) => payload[column] !== undefined && payload[column] !== null && payload[column] !== "");
  if (!presentColumns.length) return;
  const binds: Record<string, unknown> = {};
  const where = presentColumns.map((column) => {
    binds[column] = payload[column];
    return `${column} = :${column}`;
  });
  if (currentId !== undefined) {
    binds.currentId = currentId;
    where.push(`${config.pk} <> :currentId`);
  }
  const result = await QueryExecutor.executeRawQuery(`SELECT COUNT(*) AS total_count FROM ${config.table} WHERE ${where.join(" AND ")}`, binds);
  if (Number((result.rows || [])[0]?.TOTAL_COUNT || 0) > 0) {
    throw new Error("Record already exists");
  }
}

async function selectAll(config: SmsTableConfig) {
  const result = await QueryExecutor.executeRawQuery(`SELECT * FROM ${config.table} ORDER BY ${config.defaultOrder}`);
  return normalizeRows(result.rows || []);
}

function normalizeRows(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) normalized[key.toLowerCase()] = value;
    return normalized;
  });
}

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function calculateWeightedForecast(payload: Record<string, unknown>) {
  const statusPercent: Record<string, number> = {
    Qualify: 20,
    Quoted: 40,
    Negotiation: 60,
    Won: 100,
    Lost: 0,
    Cancelled: 0,
    Delayed: 0,
  };
  const probabilityPercent: Record<string, number> = { High: 100, Medium: 80, Low: 50 };
  const dealSize = Number(String(payload.deal_size || "0").replace(/[^\d.]/g, "")) || 0;
  const status = String(payload.deal_status || "");
  if (status.toLowerCase() === "won") return dealSize;
  return ((statusPercent[status] || 0) / 100) * ((probabilityPercent[String(payload.deal_probability || "")] || 0) / 100) * dealSize;
}
