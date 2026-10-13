import { NextFunction, Request, Response } from "express";
import { TenantManager } from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

export async function getPamsTenantSchema(): Promise<string> {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("A verified tenant context is required for PAMS database access");
  }

  const config = await TenantManager.getTenantConfig(tenantId);
  const schemaName = config.SCHEMA_NAME?.trim();
  if (
    config.CONNECTION_TYPE?.trim().toUpperCase() !== "SCHEMA" ||
    !schemaName ||
    !/^[A-Za-z][A-Za-z0-9_$#]*$/.test(schemaName)
  ) {
    throw new Error(`Tenant ${tenantId} is not configured with a valid schema`);
  }

  return schemaName;
}

export function requirePamsTenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tenantId = getCurrentTenantId();
  const authenticatedTenantId = (req.user as { tenantId?: string } | undefined)?.tenantId;

  if (!tenantId || !authenticatedTenantId || tenantId !== authenticatedTenantId) {
    res.status(403).json({
      success: false,
      message: "A verified tenant context is required for PAMS operations"
    });
    return;
  }

  next();
}

export function getPamsLoginId(req: Request): string {
  const loginid = (req.user as { loginid?: string } | undefined)?.loginid?.trim();
  if (!loginid) {
    throw new Error("Authenticated login ID is unavailable for PAMS operation");
  }
  return loginid;
}

export function validatePamsGeneratedSql(
  sql: string,
  operation: "read" | "write" | "delete"
): void {
  const statement = sql.trim();
  const allowedStart =
    operation === "read"
      ? /^(SELECT|WITH)\b/i
      : operation === "write"
        ? /^(INSERT|UPDATE)\b/i
        : /^DELETE\b/i;

  if (!statement || !allowedStart.test(statement)) {
    throw new Error(`PAMS procedure returned SQL that is not permitted for ${operation}`);
  }

  if (/;\s*\S/.test(statement) || /@[A-Za-z0-9_$#"]/i.test(statement)) {
    throw new Error("PAMS procedure returned multi-statement or database-link SQL");
  }

  const schemaQualifiedObject =
    /\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+(?:"[^"]+"|[A-Za-z][A-Za-z0-9_$#]*)\s*\./i;
  if (schemaQualifiedObject.test(statement)) {
    throw new Error("PAMS procedure returned schema-qualified SQL; tenant-local objects are required");
  }
}
