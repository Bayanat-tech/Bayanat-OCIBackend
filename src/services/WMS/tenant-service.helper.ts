import { TenantManager } from "../../database/TenantManager";
import { tenantContextStorage } from "../../middleware/tenantContext.middleware";

export function getCurrentTenantId(): string {
  try {
    const context = tenantContextStorage.getStore();
    if (context && context.tenantId) {
      return context.tenantId;
    }
  } catch (e) {
  }
  
  const globalContext = (global as any).__currentRequestContext;
  if (globalContext && globalContext.tenantId) {
    return globalContext.tenantId;
  }
  
  throw new Error(
    "No tenant context available. Ensure request goes through tenantContextMiddleware."
  );
}


export function normalizeOracleResult(data: any): any {
  if (!data) return data;
  if (Array.isArray(data)) {
    return data.map(row => normalizeOracleResult(row));
  }
  
  const normalized: any = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

/**
 * Execute a SELECT query in the tenant schema
 */
export async function executeQuery<T>(
  sql: string,
  params: Record<string, any> = {}
): Promise<T[]> {
  const tenantId = getCurrentTenantId();
  const result = await TenantManager.executeInTenant(tenantId, sql, params);
  return normalizeOracleResult(result) as T[];
}

/**
 * Execute a query and return a single result
 */
export async function executeSingleQuery<T>(
  sql: string,
  params: Record<string, any> = {}
): Promise<T | null> {
  const results = await executeQuery<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Execute an INSERT/UPDATE/DELETE query
 */
export async function executeMutation(
  sql: string,
  params: Record<string, any> = {}
): Promise<any> {
  const tenantId = getCurrentTenantId();
  const result = await TenantManager.executeInTenant(tenantId, sql, params);
  return result;
}

/**
 * Execute a raw SQL (positional or named params) and return the driver result as-is
 */
export async function executeRaw(
  sql: string,
  params?: any
): Promise<any> {
  const tenantId = getCurrentTenantId();
  const result = await TenantManager.executeInTenant(tenantId, sql, params as any);
  return result;
}

/**
 * Execute a query and get count
 */
export async function executeCount(
  sql: string,
  params: Record<string, any> = {}
): Promise<number> {
  const results = await executeQuery<any>(sql, params);
  if (results.length > 0) {
    return results[0].cnt || results[0].count || 0;
  }
  return 0;
}
