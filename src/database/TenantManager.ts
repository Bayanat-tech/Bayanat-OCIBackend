import oracledb from "oracledb";

export interface TenantConfig {
  TENANT_ID: string;
  TENANT_NAME: string;
  CONNECTION_TYPE: string;
  SCHEMA_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_HOST?: string;
  DB_PORT?: number;
  DB_SERVICE?: string;
  COMPANY_CODE: string;
  IS_ACTIVE: string;
}

interface TenantPool {
  pool: oracledb.Pool;
  config: TenantConfig;
}

export class TenantManager {
  private static centralPool: oracledb.Pool | null = null;
  private static tenantPools: Map<string, TenantPool> = new Map();
  private static initialized = false;

  // Initialize central connection pool
  static async initialize(): Promise<void> {
    console.log(`[TenantManager.initialize] STEP 1: Checking initialization status...`);
    if (this.initialized || this.centralPool) {
      console.log(`[TenantManager.initialize] [OK] Already initialized, skipping`);
      return;
    }

    console.log(`[TenantManager.initialize] STEP 2: Validating environment variables...`);
    console.log(`  - ORACLE_USER: ${process.env.ORACLE_USER ? "[OK] Set" : "[ERROR] Missing"}`);
    console.log(`  - ORACLE_PASSWORD: ${process.env.ORACLE_PASSWORD ? "[OK] Set" : "[ERROR] Missing"}`);
    console.log(`  - ORACLE_CONNECTION_STRING: ${process.env.ORACLE_CONNECTION_STRING ? "[OK] Set" : "[ERROR] Missing"}`);

    if (!process.env.ORACLE_USER || !process.env.ORACLE_PASSWORD || !process.env.ORACLE_CONNECTION_STRING) {
      console.error(`[TenantManager.initialize] [ERROR] STEP 2 FAILED: Missing required environment variables`);
      this.initialized = true;
      return;
    }

    try {
      console.log(`[TenantManager.initialize] STEP 3: Creating central pool...`);
      console.log(`  - User: ${process.env.ORACLE_USER}`);
      console.log(`  - Connection: ${process.env.ORACLE_CONNECTION_STRING}`);
      
      this.centralPool = await oracledb.createPool({
        user: process.env.ORACLE_USER!,
        password: process.env.ORACLE_PASSWORD!,
        connectString: process.env.ORACLE_CONNECTION_STRING!,
        poolMin: 5,
        poolMax: 20,
        poolIncrement: 2,
        poolTimeout: 60,
      });

      this.initialized = true;
      console.log(`[TenantManager.initialize] [OK] STEP 3 SUCCESS: Central pool created`);
    } catch (error) {
      console.error(`[TenantManager.initialize] [ERROR] STEP 3 FAILED: Pool creation error`);
      console.error(`  - Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`  - Error Message: ${error instanceof Error ? error.message : String(error)}`);
      this.initialized = true;
    }
  }

  // Get central connection
  private static async getCentralConnection(): Promise<oracledb.Connection> {
    console.log(`[getCentralConnection] STEP 1: Checking central pool status...`);
    if (!this.centralPool) {
      console.log(`[getCentralConnection] STEP 2: Pool not initialized, initializing...`);
      await this.initialize();
    }

    if (!this.centralPool) {
      console.error(`[getCentralConnection] [ERROR] CRITICAL: Central pool is still null after initialization`);
      throw new Error("Central pool initialization failed");
    }

    console.log(`[getCentralConnection] STEP 3: Acquiring connection from pool...`);
    try {
      const conn = await this.centralPool.getConnection();
      console.log(`[getCentralConnection] [OK] STEP 3 SUCCESS: Connection acquired`);
      return conn;
    } catch (error) {
      console.error(`[getCentralConnection] [ERROR] STEP 3 FAILED: Failed to get connection`);
      console.error(`  - Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // Get tenant for user
  static async getTenantForUser(loginid: string): Promise<string> {
    console.log(`[getTenantForUser] STEP 1: Getting central connection for loginid: ${loginid}...`);
    const conn = await this.getCentralConnection();
    try {
      console.log(`[getTenantForUser] STEP 2: Executing USER_TENANT_MAPPING query...`);
      const result = await conn.execute(
        `SELECT TENANT_ID FROM USER_TENANT_MAPPING 
         WHERE LOGINID = :loginid AND IS_DEFAULT = 'Y'`,
        { loginid },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      
      console.log(`[getTenantForUser] STEP 3: Query executed, checking results...`);
      console.log(`  - Rows returned: ${result.rows ? result.rows.length : 0}`);
      
    //   if (!result.rows || result.rows.length === 0) {
    //     console.warn(`[getTenantForUser] No mapping found for loginid '${loginid}', using default tenant`);
    //     const tenantId = 'WMSTST_TENANT';
    //     console.log(`[getTenantForUser]  RESULT: Using default tenant: ${tenantId}`);
    //     return tenantId;
    //   }

      const tenantId = (result.rows as any[])[0]?.TENANT_ID;
      console.log(`[getTenantForUser] RESULT: Found tenant for user '${loginid}': ${tenantId}`);
      return tenantId;
    } catch (error) {
      console.error(`[getTenantForUser] STEP 2 FAILED: Query execution error`);
      console.error(`  - Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      console.log(`[getTenantForUser] STEP 4: Closing connection...`);
      await conn.close();
      console.log(`[getTenantForUser] Connection closed`);
    }
  }

  // Get tenant configuration
  static async getTenantConfig(tenantId: string): Promise<TenantConfig> {
    console.log(`[getTenantConfig] STEP 1: Getting central connection for tenantId: ${tenantId}...`);
    const conn = await this.getCentralConnection();
    try {
      console.log(`[getTenantConfig] STEP 2: Executing TENANT_REGISTRY query...`);
      const result = await conn.execute<TenantConfig>(
        `SELECT 
            TENANT_ID, TENANT_NAME, CONNECTION_TYPE,
            SCHEMA_NAME, DB_USER, DB_PASSWORD,
            DB_HOST, DB_PORT, DB_SERVICE, COMPANY_CODE, IS_ACTIVE
         FROM TENANT_REGISTRY 
         WHERE TENANT_ID = :tenantId AND IS_ACTIVE = 'Y'`,
        { tenantId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      console.log(`[getTenantConfig] STEP 3: Query executed, checking results...`);
      console.log(`  - Rows returned: ${result.rows ? result.rows.length : 0}`);

      if (!result.rows || result.rows.length === 0) {
        console.error(`[getTenantConfig] STEP 3 FAILED: Tenant ${tenantId} not found in registry`);
        throw new Error(`Tenant ${tenantId} not found`);
      }

      const config = result.rows[0] as any;
      console.log(`[getTenantConfig] STEP 4: Tenant found, checking configuration...`);
      console.log(`  - TENANT_NAME: ${config.TENANT_NAME}`);
      console.log(`  - CONNECTION_TYPE: ${config.CONNECTION_TYPE}`);
      console.log(`  - SCHEMA_NAME: ${config.SCHEMA_NAME}`);
      console.log(`  - DB_USER: ${config.DB_USER}`);
      
      // Set defaults if not provided
      console.log(`[getTenantConfig] STEP 5: Setting defaults for missing values...`);
      if (!config.DB_HOST) {
        config.DB_HOST = '10.10.2.56';
        console.log(`  - DB_HOST: Using default ${config.DB_HOST}`);
      } else {
        console.log(`  - DB_HOST: ${config.DB_HOST} (from config)`);
      }

      if (!config.DB_PORT) {
        config.DB_PORT = 1521;
        console.log(`  - DB_PORT: Using default ${config.DB_PORT}`);
      } else {
        console.log(`  - DB_PORT: ${config.DB_PORT} (from config)`);
      }

      if (!config.DB_SERVICE) {
        config.DB_SERVICE = 'BayaiiiiDB_dxb1c4.jumpsn.prodvcn.oraclevcn.com';
        console.log(`  - DB_SERVICE: Using default`);
      } else {
        console.log(`  - DB_SERVICE: ${config.DB_SERVICE} (from config)`);
      }

      console.log(`[getTenantConfig] RESULT: Tenant config loaded successfully`);
      return config as TenantConfig;
    } catch (error) {
      console.error(`[getTenantConfig]  STEP 2 FAILED: Query execution error`);
      console.error(`  - Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      console.log(`[getTenantConfig] STEP 6: Closing connection...`);
      await conn.close();
      console.log(`[getTenantConfig]  Connection closed`);
    }
  }

  // Get connection for tenant
  static async getConnection(tenantId: string): Promise<oracledb.Connection> {
    console.log(`[getConnection] STEP 1: Getting config for tenant: ${tenantId}...`);
    const config = await this.getTenantConfig(tenantId);
    
    console.log(`[getConnection] STEP 2: Getting pool for tenant...`);
    const pool = await this.getPoolForTenant(config);
    
    console.log(`[getConnection] STEP 3: Acquiring connection from tenant pool...`);
    const conn = await pool.getConnection();
    console.log(`[getConnection] Connection acquired`);
    
    // Set schema if needed
    if (config.CONNECTION_TYPE === 'SCHEMA' && config.SCHEMA_NAME) {
      console.log(`[getConnection] STEP 4: Setting schema to ${config.SCHEMA_NAME}...`);
      try {
        await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${config.SCHEMA_NAME}`);
        console.log(`[getConnection] Schema set successfully`);
      } catch (error) {
        console.warn(`[getConnection] Failed to set schema: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log(`[getConnection] STEP 4: Skipping schema change (CONNECTION_TYPE: ${config.CONNECTION_TYPE})`);
    }
    
    return conn;
  }

  // Get or create pool for tenant
  private static async getPoolForTenant(config: TenantConfig): Promise<oracledb.Pool> {
    const poolKey = `${config.TENANT_ID}_${config.DB_USER}`;
    
    console.log(`[getPoolForTenant] STEP 1: Checking if pool exists for: ${poolKey}...`);
    if (this.tenantPools.has(poolKey)) {
      console.log(`[getPoolForTenant] STEP 1 SUCCESS: Reusing existing pool`);
      return this.tenantPools.get(poolKey)!.pool;
    }

    console.log(`[getPoolForTenant] STEP 2: Creating new pool for tenant: ${config.TENANT_ID}...`);
    console.log(`  - Pool Key: ${poolKey}`);
    console.log(`  - DB User: ${config.DB_USER}`);
    console.log(`  - Schema: ${config.SCHEMA_NAME}`);
    console.log(`  - Connection Type: ${config.CONNECTION_TYPE}`);
    
    console.log(`[getPoolForTenant] STEP 3: Building connection string...`);
    const connectionString = `${config.DB_HOST}:${config.DB_PORT}/${config.DB_SERVICE}`;
    console.log(`  - Host: ${config.DB_HOST}`);
    console.log(`  - Port: ${config.DB_PORT}`);
    console.log(`  - Service: ${config.DB_SERVICE}`);
    console.log(`  - Full String: ${connectionString}`);
    
    try {
      console.log(`[getPoolForTenant] STEP 4: Creating Oracle connection pool...`);
      const pool = await oracledb.createPool({
        user: config.DB_USER,
        password: config.DB_PASSWORD,
        connectString: connectionString,
        poolMin: 2,
        poolMax: 10,
        poolIncrement: 1,
        poolTimeout: 60,
      });

      this.tenantPools.set(poolKey, { pool, config });
      console.log(`[getPoolForTenant]  STEP 4 SUCCESS: Pool created and cached`);
      console.log(`  - Total pools in memory: ${this.tenantPools.size}`);
      
      return pool;
    } catch (error) {
      console.error(`[getPoolForTenant]  STEP 4 FAILED: Pool creation failed`);
      console.error(`  - Tenant: ${config.TENANT_ID}`);
      console.error(`  - Pool Key: ${poolKey}`);
      console.error(`  - Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`  - Error Message: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`  - Error Code: ${(error as any)?.code || 'N/A'}`);
      throw error;
    }
  }

  // Execute query in tenant context
  static async executeInTenant(
    tenantId: string,
    query: string,
    params: any = {}
  ): Promise<any[]> {
    console.log(`[executeInTenant] STEP 1: Getting connection for tenant: ${tenantId}...`);
    const conn = await this.getConnection(tenantId);
    
    try {
      console.log(`[executeInTenant] STEP 2: Executing query...`);
      console.log(`  - Tenant: ${tenantId}`);
      console.log(`  - Query: ${query.substring(0, 100)}${query.length > 100 ? '...' : ''}`);
      console.log(`  - Params: ${JSON.stringify(params)}`);

      const result = await conn.execute(query, params, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      });
      
      console.log(`[executeInTenant]  STEP 2 SUCCESS: Query executed`);
      console.log(`  - Rows returned: ${result.rows ? result.rows.length : 0}`);
      
      return result.rows || [];
    } catch (error) {
      console.error(`[executeInTenant]  STEP 2 FAILED: Query execution error`);
      console.error(`  - Tenant: ${tenantId}`);
      console.error(`  - Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      console.log(`[executeInTenant] STEP 3: Closing connection...`);
      await conn.close();
      console.log(`[executeInTenant]  Connection closed`);
    }
  }

  // Execute query for user (auto-detect tenant)
  static async executeForUser(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<any[]> {
    console.log(`[executeForUser] STEP 1: Detecting tenant for loginid: ${loginid}...`);
    const tenantId = await this.getTenantForUser(loginid);
    console.log(`[executeForUser] STEP 2: Tenant detected: ${tenantId}`);
    
    console.log(`[executeForUser] STEP 3: Executing query in detected tenant...`);
    return await this.executeInTenant(tenantId, query, params);
  }

  // List active tenants from central registry
  static async listActiveTenants(): Promise<string[]> {
    console.log(`[listActiveTenants] STEP 1: Querying central registry for active tenants...`);
    const conn = await this.getCentralConnection();
    try {
      const result = await conn.execute(
        `SELECT TENANT_ID FROM TENANT_REGISTRY WHERE IS_ACTIVE = 'Y'`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log(`[listActiveTenants]  Found ${result.rows ? result.rows.length : 0} tenants`);
      return (result.rows as any[]).map((r) => r.TENANT_ID);
    } catch (error) {
      console.error(`[listActiveTenants] Failed to query tenant registry: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      await conn.close();
    }
  }
  
  static async runForTenant<T>(
    tenantId: string,
    fn: () => Promise<T>,
    opts?: { loginid?: string }
  ): Promise<T> {
    console.log(`[runForTenant] STEP 1: Starting run for tenant: ${tenantId}`);
    const { tenantContextStorage } = require("../middleware/tenantContext.middleware");
    const { ensureCorrectSchema } = require("./TypeORMTenantInterceptor");

    const context = { loginid: opts?.loginid || "SYSTEM_SCHEDULER", tenantId };

    return new Promise<T>((resolve, reject) => {
      try {
        tenantContextStorage.run(context, async () => {
          (global as any).__currentRequestContext = context;
          try {
            try {
              await ensureCorrectSchema();
            } catch (schemaErr) {
              console.warn(`[runForTenant] ensureCorrectSchema failed for ${tenantId}:`, schemaErr);
            }

            const res = await fn();
            resolve(res);
          } catch (err) {
            reject(err);
          } finally {
            if ((global as any).__currentRequestContext?.tenantId === tenantId) {
              delete (global as any).__currentRequestContext;
            }
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  static async closeAll(): Promise<void> {
    for (const [key, poolObj] of this.tenantPools) {
      try {
        await poolObj.pool.close();
        console.log(`Closed pool: ${key}`);
      } catch (error) {
        console.error(`Error closing pool ${key}:`, error);
      }
    }
    this.tenantPools.clear();

    if (this.centralPool) {
      try {
        await this.centralPool.close();
        this.centralPool = null;
        console.log("Central pool closed");
      } catch (error) {
        console.error("Error closing central pool:", error);
      }
    }
  }
}

export default TenantManager;
