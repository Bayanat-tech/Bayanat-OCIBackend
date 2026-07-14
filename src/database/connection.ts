import "reflect-metadata";
import * as oracledb from "oracledb";
import { DataSource, Repository, EntityTarget, ObjectLiteral } from "typeorm";
import constants from "../helpers/constants";
import { TenantManager } from "../database/TenantManager";

// Add these imports at the top of connection.ts, after the existing imports
import { HrAirport } from "../models/Hr/hr_airport";
import { HrBank } from "../models/Hr/hr_bank";
import { Categorymaster } from "../models/Hr/hr_category";
import { HrContract } from "../models/Hr/hr_contract";
import { HrDepartment } from "../models/Hr/hr_department";
import { HrDesignation } from "../models/Hr/hr_designation";
import { HrDivision } from "../models/Hr/hr_division";
import { HrEmpStatus } from "../models/Hr/hr_employee_status";
import { HrGrade } from "../models/Hr/hr_grade";
import { KpiNamemaster } from "../models/Hr/hr_kpiname";
import { HrLabourDesignation } from "../models/Hr/hr_labour_designation";
import { Leavetype } from "../models/Hr/hr_leavetype";
import { OperationMaster } from "../models/Hr/hr_operation";
import { HrPaycomponent } from "../models/Hr/hr_paycomponents";
import { HrSection } from "../models/Hr/hr_section";
import { HrSponsor } from "../models/Hr/hr_sponsor";
import { HrViewEmp } from "../views/hr/hr_view_employee";
import { Account } from "../models/finance/accounts/masters/account_finance.entity";
import { AccountBlSetup } from "../models/finance/accounts/masters/account_finance_bl.entity";
import { AccountPlSetup } from "../models/finance/accounts/masters/account_finance_pl.entity";
import { AccountLevelTwo } from "../models/finance/accounts/masters/account_level_two.entity";
import { AccountLevelThree } from "../models/finance/accounts/masters/account_level_three.entity";
import { AccountLevelFour } from "../models/finance/accounts/masters/account_level_four.entity";
import {
  AccessRoleAppAccess,
  AccessSecModuleData,
  AccessSecOperation,
  AccessUserSecMaster,
  AccessUserSecRoleAccess,
  Company,
  FlowMaster,
  MSCompanyUserAssign,
  MSHRDivisionMaster,
  MSPSProjectMaster,
  MSProjectUserAssign,
  MsPsUserRoleMapping,
  MsRole,
  QueryMaster,
  ReportMaster,
  RoleMaster,
  SecLogin,
  SecLoginRoleAccess,
  SecLoginUserDivision,
  SecModule,
  User,
} from "../entity/Security";
import { TsStn } from "../entity/WMS/TsStn.entity";
import { TsStndetail } from "../entity/WMS/TsStndetail.entity";
import { TaAdjDetail } from "../entity/WMS/taAdjDetail.entity";
import {TaAdjHeader} from "../entity/WMS/taAdjHeader.entity";
import {InboundJobWms} from "../entities/wms/transaction/inbound/InboundJobWms.entity"
import { JobOutboundWms } from "../models/wms/transaction/outbound/JobOutboundWms.entity";
import { TiContainer } from "../entities/wms/transaction/inbound/TiContainer.entity";
import { PackingDetailsInboundWms } from "../entity/WMS/transaction/inbound/PackingDetailsInboundWms.entity";
import { TtBatch } from "../entity/WMS/transaction/inbound/TtBatch.entity";
import { Product } from "../entity/WMS/product.entity";
import { TiPackdet } from "../entity/WMS/TiPackdet";
import { AcSetup } from "../entity/WMS/acsetup.entity";
import { Activity } from "../entity/WMS/activity.entity";
import { ActivityGroupMaster } from "../entity/WMS/activitygroup.entity";
import { ActivityKpi } from "../entity/WMS/activitykpi.entity";
import { ActivitySubgroup } from "../entity/WMS/activity_subgroup.entity";
import { Airline } from "../entity/WMS/airline.entity";
import { Alert } from "../entity/WMS/alert.entity";
import { BillingActivity } from "../entity/WMS/billing_activity.entity";
import { Brand } from "../entity/WMS/brand.entity";
import { ConfirmInboundjob } from "../entity/WMS/confirmInboundjob.entity";
import { CountryMaster } from "../entity/WMS/country.entity";
import { CurrencyMaster } from "../entity/WMS/currency.entity";
import { CustomerMaster } from "../entity/WMS/Customer.entity";
import { DepartmentMaster } from "../entity/WMS/department.entity";
import { Division } from "../entity/WMS/division.entity";
import { ProductGroup } from "../entity/WMS/group.entity";
import { Harmonize } from "../entity/WMS/harmonize.entity";
import { LineMaster } from "../entity/WMS/line.entity";
import { LocationMaster } from "../entity/WMS/location.entity";
import { LocationType } from "../entity/WMS/locationtype.entity";
import { Manufacturer } from "../entity/WMS/manufacturer.entity";
import { MocMaster } from "../entity/WMS/moc.entity";
import { BrokerMaster } from "../entity/WMS/partner.entity";
import { PortMaster } from "../entity/WMS/port.entity";
import { PrincipalMaster } from "../entity/WMS/principal.entity";
import { PrincipalContactDetl } from "../entity/WMS/principalcontactdetl.entity";
import { UploadedFilesDlts } from "../entity/WMS/principalfile.entity";
import { ProducttypeMaster } from "../entity/WMS/producttype.entity";
import { ProductEDI } from "../entity/WMS/product_edi.entity";
import { SalesmanMaster } from "../entity/WMS/salesman.entity";
import { MntStorageHdr } from "../entity/WMS/storage.entity";
import { SupplierMaster } from "../entity/WMS/suppliermaster.entity";
import { ActivityUOC } from "../entity/WMS/uoc.entity";
import { UomMaster } from "../entity/WMS/uom.entity";
import { Vessel } from "../entity/WMS/vessel.entity";
import { Warehouse } from "../entity/WMS/Warehouse.entity";
import { TiTallyDetail } from "../entity/WMS/TiTallyDetail.entity";
import { FilesAFEntity } from "../entities/account_files.entity";
// TEMP EMERGENCY: allow skipping Oracle thick client init using FORCE_THIN_ORACLE=1
if (process.env.FORCE_THIN_ORACLE === "1") {
  console.warn("FORCE_THIN_ORACLE=1 set — skipping oracledb.initOracleClient() (using thin mode)");
} else {
  try {
    oracledb.initOracleClient({
      libDir:
        constants.DATABASE.ORACLE_INSTANT_CLIENT_PATH ||
        process.env.ORACLE_INSTANT_CLIENT_PATH,
    });
    console.log("Oracle thick mode initialized");
  } catch (err) {
    console.error("Error initializing Oracle thick mode:", err);
    console.log("Using thin mode as fallback");
  }
} 

// ==================== RAW ORACLE CONFIG ====================
const dbConfig: oracledb.PoolAttributes = {
  user: constants.DATABASE.ORACLE_USER || process.env.ORACLE_USER,
  password:
    constants.DATABASE.ORACLE_PASSWORD ||
    process.env.ORACLE_PASSWORD,
  connectString:
    constants.DATABASE.ORACLE_CONNECTION_STRING ||
    process.env.ORACLE_CONNECTION_STRING,
  poolMin: 5,
  poolMax: 20,
  poolIncrement: 2,
  poolTimeout: 60,
};

let oraclePool: oracledb.Pool | null = null;

// ==================== TYPEORM CONFIG - FIXED ====================
export const AppDataSource = new DataSource({
  type: "oracle",
  connectString:
    constants.DATABASE.ORACLE_CONNECTION_STRING ||
    process.env.ORACLE_CONNECTION_STRING ,
  username: constants.DATABASE.ORACLE_USER || process.env.ORACLE_USER ,
  password:
    constants.DATABASE.ORACLE_PASSWORD ||
    process.env.ORACLE_PASSWORD,
  synchronize: false,
  logging: true,
  entities: [
  HrAirport,
  HrBank,
  Categorymaster,
  HrContract,
  HrDepartment,
  HrDesignation,
  HrDivision,
  HrEmpStatus,
  HrGrade,
  KpiNamemaster,
  HrLabourDesignation,
  Leavetype,
  OperationMaster,
  HrPaycomponent,
  HrSection,
  HrSponsor,
  HrViewEmp,
  Account,
  AccountBlSetup,
  AccountPlSetup,
  AccountLevelTwo,
  AccountLevelThree,
  AccountLevelFour,
  AccessRoleAppAccess,
  AccessSecModuleData,
  AccessSecOperation,
  AccessUserSecMaster,
  AccessUserSecRoleAccess,
  Company,
  FlowMaster,
  MSCompanyUserAssign,
  MSHRDivisionMaster,
  MSPSProjectMaster,
  MSProjectUserAssign,
  MsPsUserRoleMapping,
  MsRole,
  QueryMaster,
  ReportMaster,
  RoleMaster,
  SecLogin,
  SecLoginRoleAccess,
  SecLoginUserDivision,
  SecModule,
  User,
  TsStn, 
  TsStndetail,
  TaAdjDetail,
  TaAdjHeader,
  InboundJobWms,
  JobOutboundWms,
  TiContainer,
  PackingDetailsInboundWms,
  TtBatch,
  TiPackdet,
  Product,
  TiTallyDetail,
  AcSetup,
  Activity,
  ActivityGroupMaster,
  ActivityKpi,
  ActivitySubgroup,
  Airline,
  Alert,
  BillingActivity,
  Brand,
  ConfirmInboundjob,
  CountryMaster,
  CurrencyMaster,
  CustomerMaster,
  DepartmentMaster,
  Division,
  ProductGroup,
  Harmonize,
  LineMaster,
  LocationMaster,
  LocationType,
  Manufacturer,
  MocMaster,
  BrokerMaster,
  PortMaster,
  PrincipalMaster,
  PrincipalContactDetl,
  UploadedFilesDlts,
  ProducttypeMaster,
  ProductEDI,
  SalesmanMaster,
  MntStorageHdr,
  SupplierMaster,
  TiTallyDetail,
  ActivityUOC,
  UomMaster,
  Vessel,
  Warehouse,
  FilesAFEntity
],

  migrations: ["src/migration/**/*.ts"],
  subscribers: ["src/subscriber/**/*.ts"],
  extra: {
    poolMin: 5,
    poolMax: 20,
    poolIncrement: 2,
    poolTimeout: 60,
  },
});

// ==================== TYPEORM SERVICE ====================
class TypeORMService {
  private static initialized = false;
  private static initPromise: Promise<void> | null = null;

  static async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.initialized && AppDataSource.isInitialized) {
      return;
    }

    this.initPromise = this._performInitialize();
    return this.initPromise;
  }

  private static async _performInitialize(): Promise<void> {
    try {
      if (!AppDataSource.isInitialized) {
        console.log("Attempting TypeORM connection...");
        console.log("TypeORM Config:", {
          type: "oracle",
          connectString:
            constants.DATABASE.ORACLE_CONNECTION_STRING ||
            process.env.ORACLE_CONNECTION_STRING,
          username: process.env.ORACLE_USER,
        });

        await AppDataSource.initialize();
        console.log("TypeORM Connected to Oracle Database");

        await AppDataSource.query(
          "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'"
        );

        this.initialized = true;
        this.initPromise = null;
      }
    } catch (error) {
      this.initPromise = null;
      console.error("TypeORM connection failed:", error);
      console.log("TypeORM failed, but raw Oracle connection is active");
      throw error;
    }
  }

  static getRepository<T extends ObjectLiteral>(
    entity: EntityTarget<T>
  ): Repository<T> {
    if (!this.initialized || !AppDataSource.isInitialized) {
      console.error("TypeORM not initialized. Current state:", {
        serviceInitialized: this.initialized,
        dataSourceInitialized: AppDataSource.isInitialized
      });
      throw new Error("TypeORM not initialized. Call initialize() first.");
    }
    if (!this.initialized && AppDataSource.isInitialized) {
      this.initialized = true;
    }

    const repo = AppDataSource.getRepository(entity);

    const dataMethods = new Set([
      "find",
      "findOne",
      "findOneBy",
      "findBy",
      "findAndCount",
      "count",
      "save",
      "update",
      "delete",
      "remove",
      "createQueryBuilder",
      "query"
    ]);

    // Methods that return synchronous objects (not promises) and shouldn't be awaited
    const syncMethods = new Set(["createQueryBuilder"]);

    return new Proxy(repo, {
      get(target, prop: string | symbol) {
        const value: any = Reflect.get(target, prop as any);
        if (typeof prop === "string" && typeof value === "function" && dataMethods.has(prop)) {
          // For synchronous methods like createQueryBuilder, don't wrap with async/await
          if (syncMethods.has(prop)) {
            return function (...args: any[]) {
              try {
                // Dynamic require to avoid circular import at module load
                const { ensureCorrectSchema } = require("./TypeORMTenantInterceptor");
                if (ensureCorrectSchema) {
                  // Don't await schema check for sync methods - just trigger it
                  ensureCorrectSchema().catch((err: any) => {
                    console.warn("ensureCorrectSchema failed:", err);
                  });
                }
              } catch (err) {
                console.warn("ensureCorrectSchema failed:", err);
              }
              return value.apply(target, args);
            };
          }
          // For async methods, wrap with async/await
          return async function (...args: any[]) {
            try {
              // Dynamic require to avoid circular import at module load
              const { ensureCorrectSchema } = require("./TypeORMTenantInterceptor");
              if (ensureCorrectSchema) await ensureCorrectSchema();
            } catch (err) {
              console.warn("ensureCorrectSchema failed:", err);
            }
            return await value.apply(target, args);
          };
        }
        return value;
      },
    }) as unknown as Repository<T>;
  }

  static async ensureConnection(): Promise<void> {
    try {
      if (!AppDataSource.isInitialized) {
        console.log("Connection lost - reinitializing...");
        this.initialized = false;
        this.initPromise = null;
        await this.initialize();
        console.log(" Connection restored");
        return;
      }
      await AppDataSource.query("SELECT 1 FROM DUAL");
    } catch (error) {
      console.log("Connection health check failed - reconnecting...");
      this.initialized = false;
      this.initPromise = null;
      
      try {
        await AppDataSource.destroy();
      } catch (destroyErr) {
        console.warn("Error destroying connection:", destroyErr);
      }
      
      await this.initialize();
      console.log("Connection restored after health check");
    }
  }

  static async close(): Promise<void> {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      this.initialized = false;
      console.log("TypeORM connection closed");
    } else {
      this.initialized = false;
    }
  }

  static isConnected(): boolean {
    return AppDataSource.isInitialized || this.initialized;
  }

  static isInitialized(): boolean {
    return this.initialized && AppDataSource.isInitialized;
  }
}

function processBindParameters(binds: any): any {
  if (!binds) return {};

  const processedBinds: any = {};

  for (const [key, value] of Object.entries(binds)) {
    if (value === undefined || value === null) {
      processedBinds[key] = { val: null };
    }
    else if (
      value &&
      typeof value === "object" &&
      ("val" in value ||
        "dir" in value ||
        "type" in value ||
        "maxSize" in value)
    ) {
      processedBinds[key] = value;
    }
    else if (
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 0
    ) {
      processedBinds[key] = { val: null };
    } else {
      processedBinds[key] = { val: value };
    }
  }

  return processedBinds;
}

// ==================== RAW ORACLE FUNCTIONS ====================
export const oracleDb = {
  authenticate: async (): Promise<void> => {
    try {
      oraclePool = await oracledb.createPool(dbConfig);
      console.log(" Oracle Database Connected (Thick Mode)");
    } catch (error: unknown) {
      console.error(
        "Oracle connection failed:",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  },

  getConnection: async (): Promise<oracledb.Connection> => {
    if (!oraclePool)
      throw new Error("Database not connected. Call authenticate() first.");
    return await oraclePool.getConnection();
  },

  withTransaction: async <T>(
    fn: (conn: oracledb.Connection) => Promise<T>
  ): Promise<T> => {
    const conn = await oracleDb.getConnection();
    try {
      await conn.execute("BEGIN NULL; END;");
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      await conn.close();
    }
  },

  query: async (
    sql: string,
    binds?: any,
    conn?: oracledb.Connection
  ): Promise<any> => {
    const useExternalConn = Boolean(conn);
    let connection: oracledb.Connection | undefined;

    try {
      connection = conn ?? (await oracleDb.getConnection());
      const options = {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: !useExternalConn,
      };

      const processedBinds = processBindParameters(binds || {});
      const result = await connection.execute(sql, processedBinds, options);
      return result;
    } catch (error: unknown) {
      console.error(
        "Query failed:",
        error instanceof Error ? error.message : String(error)
      );
      console.error("SQL that failed:", sql);
      console.error("Bind parameters:", binds);
      throw error;
    } finally {
      if (connection && !useExternalConn) {
        try {
          await connection.close();
        } catch (err) {
          console.error("Error closing connection:", err);
        }
      }
    }
  },

  close: async (): Promise<void> => {
    if (oraclePool) {
      await oraclePool.close();
      oraclePool = null;
    }
  },

  processBindParameters,
};

// ==================== UPDATED INITIALIZATION ====================
export const initializeAllConnections = async (): Promise<void> => {
  console.log("Starting database connections...");

  try {
    // 1. Initialize Tenant Manager FIRST
    console.log("Initializing Tenant Manager...");
    if (process.env.EMERGENCY_SKIP_TENANT_INIT === '1') {
      console.warn("EMERGENCY_SKIP_TENANT_INIT=1 — skipping TenantManager.initialize() (EMERGENCY MODE)");
    } else {
      try {
        await TenantManager.initialize();
        console.log(" Tenant Manager initialized");
      } catch (err) {
        console.warn(" TenantManager.initialize() failed (continuing startup):", err);
      }
    }

    // 2. Initialize legacy connection (non-blocking)
    console.log("Initializing legacy Oracle connection...");
    try {
      await oracleDb.authenticate();
      console.log("Legacy database connection ready");
    } catch (legacyError) {
      console.warn(" Legacy Oracle connection failed (app will continue):", legacyError instanceof Error ? legacyError.message : String(legacyError));
      // Continue without legacy connection
    }

    // 3. Initialize TypeORM (optional - don't block if it fails)
    console.log("Initializing TypeORM...");
    try {
      await TypeORMService.initialize();
      console.log(" TypeORM connection ready");
    } catch (typeOrmError) {
      console.warn("TypeORM initialization failed (continuing without it):", typeOrmError instanceof Error ? typeOrmError.message : String(typeOrmError));
      // Continue without TypeORM - application can still work with raw Oracle
    }

    console.log("Database initialization completed (some services may be unavailable)");
  } catch (error) {
    console.error("Critical database initialization failed:", error);
    throw error;
  }
};

export const closeAllConnections = async (): Promise<void> => {
  await TenantManager.closeAll();
  await oracleDb.close();
  await TypeORMService.close();
  console.log("All database connections closed");
};

// ==================== BACKWARD COMPATIBILITY ====================
export const databaseConnection = (): Promise<boolean> => {
  return new Promise(async (resolve) => {
    try {
      await oracleDb.authenticate();
      await oracleDb.query(
        "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'"
      );
      console.log("Oracle Database Connected and Session Set");
      resolve(true);
    } catch (error: unknown) {
      console.error(
        "Oracle authentication failed in databaseConnection check:",
        error
      );
      resolve(false);
    }
  });
};

// ==================== TENANT-AWARE QUERY HELPER ====================
export async function executeInTenantSchema<T>(
  tenantId: string,
  query: string,
  params: Record<string, any> = {}
): Promise<T[]> {
  const { TenantManager } = require("./TenantManager");
  return await TenantManager.executeInTenant(tenantId, query, params);
}

// ==================== EXPORTS ====================
export { TypeORMService };
export const getRepository = TypeORMService.getRepository.bind(TypeORMService);
export const isTypeOrmConnected = TypeORMService.isConnected;

// Monkey-patch AppDataSource.createQueryRunner to ensure tenant schema
// is applied on the QueryRunner's underlying connection before any queries run.
// We wrap the returned QueryRunner so its methods await the schema switch.
(() => {
  try {
    const originalCreateQueryRunner = (AppDataSource as any).createQueryRunner.bind(AppDataSource);
    (AppDataSource as any).createQueryRunner = function (...args: any[]) {
      const queryRunner = originalCreateQueryRunner(...args);

      // Lazily start schema enforcement immediately
      let schemaPromise: Promise<void> | null = null;
      try {
        const { ensureCorrectSchemaOnQueryRunner } = require("./TypeORMTenantInterceptor");
        schemaPromise = ensureCorrectSchemaOnQueryRunner(queryRunner).catch((err: any) => {
          console.warn("[createQueryRunner wrapper] ensureCorrectSchemaOnQueryRunner failed:", err);
        });
      } catch (err) {
        // If interceptor cannot be required, continue without schema enforcement
        console.warn("[createQueryRunner wrapper] Could not require TypeORMTenantInterceptor:", err);
      }

      // Return a proxy that ensures the schemaPromise is awaited before executing functions
      return new Proxy(queryRunner, {
        get(target, prop: string | symbol) {
          const value: any = Reflect.get(target, prop as any);
          if (typeof value === "function") {
            return async function (...fnArgs: any[]) {
              if (schemaPromise) {
                await schemaPromise;
              }
              return await value.apply(target, fnArgs);
            };
          }
          return value;
        },
      });
    };
  } catch (err) {
    console.warn("Failed to wrap AppDataSource.createQueryRunner:", err);
  }
})();
export const closeTypeOrmConnection = TypeORMService.close;

// ==================== BIND PARAMETER UTILITY (for external use) ====================
export const createBindObject = (value: any): any => {
  return { val: value };
};

export const createBindObjects = (
  params: Record<string, any>
): Record<string, any> => {
  return processBindParameters(params);
};

// ==================== SEQUELIZE SHIM (LEGACY SUPPORT) ====================
// NOTE: Sequelize is no longer used at runtime. This export is for legacy model file imports only.
// Legacy model files are being phased out in favor of TypeORM entities and oracle8 QueryExecutor.
export const sequelize: any = {
  dialect: "oracle",
  options: { logging: false },
  // Mock transaction method for legacy code
  transaction: async (callback: any) => {
    // Simple pass-through that just calls the callback with a dummy transaction object
    try {
      return await callback({ commit: async () => {}, rollback: async () => {} });
    } catch (err) {
      throw err;
    }
  },
  query: async (sql: string, options?: any) => {
    // Mock query method that returns empty array
    return [];
  },
};

// Basic QueryTypes shim for legacy code that expects QueryTypes.
export const QueryTypes = {
  SELECT: "SELECT",
  INSERT: "INSERT",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
} as const;
