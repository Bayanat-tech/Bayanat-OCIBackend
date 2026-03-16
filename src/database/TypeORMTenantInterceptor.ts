import { AppDataSource } from "./connection";
import { getCurrentTenantId, tenantContextStorage } from "../middleware/tenantContext.middleware";
import { TenantManager } from "./TenantManager";

interface SchemaCache {
  tenantId: string;
  connection: any;
  timestamp: number;
}

const schemaCache: Map<string, SchemaCache> = new Map();
const CACHE_TTL = 60000; 
export async function ensureCorrectSchema(): Promise<void> {
  const tenantId = getCurrentTenantId();

  if (!tenantId) {
    console.log("[ensureCorrectSchema] [WARN] No tenant context found in AsyncLocalStorage, checking fallback...");
    const globalContext = (global as any).__currentRequestContext;
    if (globalContext?.tenantId) {
      console.log(`[ensureCorrectSchema] [OK] Found context in global: ${globalContext.tenantId}`);
      const tenantConfig = await TenantManager.getTenantConfig(globalContext.tenantId);
      const schemaName = tenantConfig.SCHEMA_NAME;
      const connection = await AppDataSource.query(
        `ALTER SESSION SET CURRENT_SCHEMA = ${schemaName}`
      );
      console.log(`[ensureCorrectSchema] [OK] Schema switched to ${schemaName} (from global fallback)`);
      return;
    }
    
    console.log("[ensureCorrectSchema]  No tenant context at all, using default schema");
    return;
  }

  try {
    // Get TypeORM connection
    if (!AppDataSource.isInitialized) {
      console.warn("[ensureCorrectSchema] TypeORM not initialized");
      return;
    }

    // Get tenant config to know what schema to switch to
    const tenantConfig = await TenantManager.getTenantConfig(tenantId);
    const schemaName = tenantConfig.SCHEMA_NAME;

    console.log(
      `[ensureCorrectSchema] Setting schema to ${schemaName} for tenant ${tenantId}`
    );

    // Switch schema on TypeORM connection
    const connection = await AppDataSource.query(
      `ALTER SESSION SET CURRENT_SCHEMA = ${schemaName}`
    );

    console.log(`[ensureCorrectSchema] [OK] Schema switched to ${schemaName}`);
  } catch (error) {
    console.error("[ensureCorrectSchema] Error switching schema:", error);
    throw error;
  }
}

export async function ensureCorrectSchemaOnQueryRunner(queryRunner: any): Promise<void> {
  if (!queryRunner) return;

  const tenantId = getCurrentTenantId();

  if (!tenantId) {
    const globalContext = (global as any).__currentRequestContext;
    if (globalContext?.tenantId) {
      const tenantConfig = await TenantManager.getTenantConfig(globalContext.tenantId);
      const schemaName = tenantConfig.SCHEMA_NAME;
      try {
        await queryRunner.query(`ALTER SESSION SET CURRENT_SCHEMA = ${schemaName}`);
        console.log(`[ensureCorrectSchemaOnQueryRunner] [OK] Schema switched to ${schemaName} (from global fallback)`);
      } catch (err) {
        console.warn(`[ensureCorrectSchemaOnQueryRunner] Failed to switch schema on QueryRunner (global fallback):`, err);
      }
      return;
    }
    return;
  }

  try {
    const tenantConfig = await TenantManager.getTenantConfig(tenantId!);
    const schemaName = tenantConfig.SCHEMA_NAME;
    await queryRunner.query(`ALTER SESSION SET CURRENT_SCHEMA = ${schemaName}`);
    console.log(`[ensureCorrectSchemaOnQueryRunner] [OK] Schema switched to ${schemaName} for tenant ${tenantId}`);
  } catch (error) {
    console.error("[ensureCorrectSchemaOnQueryRunner] Error switching schema on QueryRunner:", error);
    throw error;
  }
}

export async function createTenantQueryBuilder<Entity>(
  repository: any,
  alias: string
): Promise<any> {
  const tenantId = getCurrentTenantId();

  if (!tenantId) {
    return repository.createQueryBuilder(alias);
  }

  // Ensure schema is set first
  await ensureCorrectSchema();

  // Now create query builder (will use correct schema)
  return repository.createQueryBuilder(alias);
}

export function AutoSchemaSwitch() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        // Ensure schema is correct before method runs
        await ensureCorrectSchema();
        
        // Execute method in correct schema context
        return await originalMethod.apply(this, args);
      } catch (error) {
        console.error(
          `[AutoSchemaSwitch] Error in ${propertyKey}:`,
          error
        );
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Wrap multiple repository methods in a service
 * Call this at the top of your service class
 * 
 * Example:
 *   private companyRepo = wrapRepositoryForTenant(
 *     getRepository(Company),
 *     "Company repository"
 *   );
 */
export function wrapRepositoryForTenant<Entity>(
  repository: any,
  name: string
): any {
  return new Proxy(repository, {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      // Only intercept data methods
      if (typeof value === "function" && [
        "find", "findOne", "findOneBy", "count", "save", "update", "delete", "remove"
      ].includes(String(prop))) {
        return async function (...args: any[]) {
          try {
            // Ensure schema before each operation
            await ensureCorrectSchema();
            return await value.apply(target, args);
          } catch (error) {
            console.error(
              `[wrapRepositoryForTenant:${name}.${String(prop)}] Error:`,
              error
            );
            throw error;
          }
        };
      }

      return value;
    },
  });
}

/**
 * Example of how to use in a service:
 * 
 * export class CompanyService {
 *   private companyRepo = wrapRepositoryForTenant(
 *     getRepository(Company),
 *     "CompanyRepository"
 *   );
 *
 *   @AutoSchemaSwitch()
 *   async findByCode(code: string): Promise<Company | null> {
 *     // This will automatically use the tenant schema!
 *     return await this.companyRepo.findOne({ where: { code } });
 *   }
 * }
 */
