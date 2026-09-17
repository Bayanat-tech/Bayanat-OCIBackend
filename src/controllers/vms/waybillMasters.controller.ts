import { Response } from "express";
import { QueryExecutor } from "../../database/QueryExecutor";
import { RequestWithUser } from "../../interfaces/common.interface";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
import { masterDefinitions, masterTableStatements, MasterKind, validateMaster } from "./waybillMasters.model";

const initialization = new Map<string, Promise<void>>();

export async function ensureMasterTables(tenantId: string) {
  let pending = initialization.get(tenantId);
  if (!pending) {
    pending = (async () => {
      for (const statement of masterTableStatements) {
        await QueryExecutor.executeRawQuery(`BEGIN
          EXECUTE IMMEDIATE '${statement.replace(/'/g, "''")}';
          EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
        END;`);
      }
    })();
    initialization.set(tenantId, pending);
  }
  try {
    await pending;
  } catch (error) {
    initialization.delete(tenantId);
    throw error;
  }
}

function scope(req: RequestWithUser, res: Response) {
  const tenantId = getCurrentTenantId();
  const companyCode = String(req.user?.company_code || "").trim();
  if (!tenantId || !companyCode) {
    res.status(403).json({ success: false, message: "A tenant and company are required to manage waybill masters." });
    return;
  }
  return { tenantId, companyCode };
}

function failure(error: unknown, res: Response) {
  const code = (error as { errorNum?: number })?.errorNum;
  if (code === 1) {
    res.status(409).json({ success: false, message: "This master entry already exists for your company." });
  } else if (code === 2291) {
    res.status(400).json({ success: false, message: "Create the referenced city rate or well IDs in your company first." });
  } else if (code === 2292) {
    res.status(409).json({ success: false, message: "This city or well ID is referenced by another master entry and cannot be renamed or deleted. Update or remove the dependent master entries first." });
  } else {
    console.error("Waybill master operation failed:", error);
    res.status(500).json({ success: false, message: "Unable to process waybill master data." });
  }
}

export function listWaybillMaster(kind: MasterKind) {
  return async (req: RequestWithUser, res: Response) => {
    const context = scope(req, res);
    if (!context) return;
    try {
      await ensureMasterTables(context.tenantId);
      const definition = masterDefinitions[kind];
      const columns = [...definition.text, ...definition.numbers].map((key) => `m.${key}`).join(", ");
      const result = await QueryExecutor.executeRawQuery(
        `SELECT m.ID, ${columns}, m.CREATED_AT, m.UPDATED_AT
           ${kind === "wells" ? ", r.BASE_KMS, (m.ACTUAL_KMS - r.BASE_KMS - 15) AS DIVERSION_KMS" : ""}
           FROM ${definition.table} m
           ${kind === "wells" ? "JOIN VMS_WAYBILL_RATES r ON r.COMPANY_CODE = m.COMPANY_CODE AND r.CITY = m.CITY" : ""}
          WHERE m.COMPANY_CODE = :company_code
          ORDER BY m.${definition.text[0]}, m.ID`,
        { company_code: context.companyCode },
      );
      res.json({ success: true, data: result.rows || [] });
    } catch (error) { failure(error, res); }
  };
}

export function saveWaybillMaster(kind: MasterKind, update = false) {
  return async (req: RequestWithUser, res: Response) => {
    const context = scope(req, res);
    if (!context) return;
    const id = update ? Number(req.params.id) : undefined;
    if (update && (!Number.isSafeInteger(id) || Number(id) <= 0)) {
      res.status(400).json({ success: false, message: "Invalid master ID." });
      return;
    }
    let values: Record<string, string | number>;
    try {
      values = validateMaster(kind, req.body || {});
    } catch (error) {
      res.status(400).json({ success: false, message: (error as Error).message });
      return;
    }
    try {
      await ensureMasterTables(context.tenantId);
      const keys = Object.keys(values);
      const table = masterDefinitions[kind].table;
      const actor = String(req.user?.loginid || "");
      const result = await QueryExecutor.executeRawQuery(
        update
          ? `UPDATE ${table} SET ${keys.map((key) => `${key} = :${key}`).join(", ")},
               UPDATED_BY = :actor, UPDATED_AT = SYSTIMESTAMP
             WHERE ID = :id AND COMPANY_CODE = :company_code`
          : `INSERT INTO ${table} (COMPANY_CODE, ${keys.join(", ")}, CREATED_BY, UPDATED_BY)
             VALUES (:company_code, ${keys.map((key) => `:${key}`).join(", ")}, :actor, :actor)`,
        { ...values, company_code: context.companyCode, actor, ...(update ? { id } : {}) },
      );
      if (update && result.rowsAffected === 0) {
        res.status(404).json({ success: false, message: "Master entry not found." });
        return;
      }
      res.status(update ? 200 : 201).json({ success: true, message: "Master entry saved." });
    } catch (error) { failure(error, res); }
  };
}

export function deleteWaybillMaster(kind: MasterKind) {
  return async (req: RequestWithUser, res: Response) => {
    const context = scope(req, res);
    if (!context) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ success: false, message: "Invalid master ID." });
      return;
    }
    try {
      await ensureMasterTables(context.tenantId);
      const result = await QueryExecutor.executeRawQuery(
        `DELETE FROM ${masterDefinitions[kind].table} WHERE ID = :id AND COMPANY_CODE = :company_code`,
        { id, company_code: context.companyCode },
      );
      if (!result.rowsAffected) {
        res.status(404).json({ success: false, message: "Master entry not found." });
        return;
      }
      res.json({ success: true, message: "Master entry deleted." });
    } catch (error) { failure(error, res); }
  };
}
