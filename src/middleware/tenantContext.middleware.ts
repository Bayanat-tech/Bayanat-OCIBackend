import {  Response, NextFunction } from "express";
import { TenantManager } from "../database/TenantManager";
import { AppDataSource } from "../database/connection";
import { RequestWithUser } from "../interfaces/common.interface";
import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
  loginid: string;
  tenantId: string;
  userId?: string;
  email?: string;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export async function tenantContextMiddleware(
  req: RequestWithUser,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.loginid) {
      console.log(`[tenantContextMiddleware]  No user context yet (public route or unauthenticated)`);
      return next();
    }

    console.log(`[tenantContextMiddleware] MIDDLEWARE CALLED for user: ${req.user.loginid}`);
    console.log(`[tenantContextMiddleware] STEP 1: User from req: ${req.user.loginid}`);

    let tenantId = (req.user && (req.user as any).tenantId) || (req as any).tenantId;

    if (!tenantId) {
      console.log(`[tenantContextMiddleware] STEP 2: Tenant not set, looking up from database...`);
      return next();
    } else {
      console.log(`[tenantContextMiddleware] STEP 2: Tenant already set: ${tenantId}`);
    }

    if (!tenantId) {
      console.error(`[tenantContextMiddleware] No tenant found for user: ${req.user.loginid}`);
      res.status(403).json({
        success: false,
        message: "No tenant mapped for this user",
      });
      return;
    }

    console.log(`[tenantContextMiddleware]  Tenant detected: ${tenantId} for user: ${req.user.loginid}`);

    // Create tenant context
    const tenantContext: TenantContext = {
      loginid: req.user.loginid,
      tenantId: tenantId,
      userId: req.user.id,
      email: req.user.email_id,
    };

    // Attach to request for direct access
    req.user!.tenantId = tenantId;
    (req as any).tenantContext = tenantContext;
    
    console.log(`[tenantContextMiddleware] CONTEXT SET: loginid=${req.user!.loginid}, tenant=${tenantId}, schema=${tenantId.split('_')[0]}`);
    
    (global as any).__currentRequestContext = tenantContext;

    tenantContextStorage.enterWith(tenantContext);
    
    // ✨ CRITICAL: Switch TypeORM schema to tenant schema and WAIT before proceeding
    console.log(`[tenantContextMiddleware] STEP 3: Switching TypeORM schema to tenant (awaiting)...`);
    try {
      if (AppDataSource.isInitialized) {
        const tenantConfig = await TenantManager.getTenantConfig(tenantId);
        const schemaName = tenantConfig.SCHEMA_NAME;

        const queryRunner = AppDataSource.createQueryRunner();
        try {
          console.log(`[tenantContextMiddleware] Executing ALTER SESSION for schema: ${schemaName}`);
          await queryRunner.query(`ALTER SESSION SET CURRENT_SCHEMA = ${schemaName}`);
          console.log(`[tenantContextMiddleware] TypeORM schema switched to ${schemaName}`);
        } finally {
          await queryRunner.release();
        }
      } else {
        console.log(`[tenantContextMiddleware] TypeORM not initialized, skipping schema switch`);
      }
    } catch (schemaError) {
      console.warn(`[tenantContextMiddleware] Schema switch failed (continuing anyway):`, schemaError);
    }
    
    // ✨ Clear global context when response finishes to prevent memory leaks
    res.on('finish', () => {
      if ((global as any).__currentRequestContext?.tenantId === tenantId) {
        (global as any).__currentRequestContext = undefined;
      }
    });
    
    // Now safe to call next() since schema switch awaited
    next();
  } catch (error: any) {
    console.error(`[tenantContextMiddleware]  ERROR:`, error.message);
    res.status(500).json({
      success: false,
      message: "Error setting up tenant context",
      error: error.message,
    });
  }
}


export function getCurrentTenantContext(): TenantContext | undefined {
  // ✨ CRITICAL FIX: Check AsyncLocalStorage first (for direct calls)
  const asyncContext = tenantContextStorage.getStore();
  if (asyncContext) {
    return asyncContext;
  }
  
  // ✨ FALLBACK: If AsyncLocalStorage fails, try to get from global request context
  // This handles the case where Express switches async contexts on next()
  if ((global as any).__currentRequestContext) {
    return (global as any).__currentRequestContext;
  }
  
  return undefined;
}

export function getCurrentLoginid(): string | undefined {
  const context = getCurrentTenantContext();
  return context?.loginid;
}

export function getCurrentTenantId(): string | undefined {
  const context = getCurrentTenantContext();
  return context?.tenantId;
}


export async function runInTenantContext<T>(
  loginid: string,
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> {
  const context: TenantContext = { loginid, tenantId };
  return new Promise((resolve, reject) => {
    tenantContextStorage.run(context, async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
