import {
  Repository,
  SelectQueryBuilder,
  ObjectLiteral,
} from "typeorm";
import { TenantManager } from "./TenantManager";
import { getCurrentTenantId } from "../middleware/tenantContext.middleware";
export function wrapRepositoryForTenant<Entity extends ObjectLiteral>(
  repository: Repository<Entity>,
  tableName: string
): Repository<Entity> {
  return new Proxy(repository, {
    get(target, prop) {
      const originalMethod = Reflect.get(target, prop);
      if (typeof originalMethod === "function" && [
        "find", "findOne", "findOneBy", "count", "save", "update", "delete", "remove"
      ].includes(String(prop))) {
        return async function (...args: any[]) {
          const tenantId = getCurrentTenantId();
          if (!tenantId) {
            return await originalMethod.apply(target, args);
          }
          const connection = await TenantManager.getConnection(tenantId);
          try {
            return await originalMethod.apply(target, args);
          } finally {
            await connection.close();
          }
        };
      }
      return originalMethod;
    },
  }) as Repository<Entity>;
}
