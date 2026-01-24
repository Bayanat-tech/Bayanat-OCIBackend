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
    if (this.initialized || this.centralPool) {
      console.log("TenantManager already initialized");
      return;
    }

    try {
      console.log("TenantManager: Creating central pool...");
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
      console.log("✅ TenantManager: Central pool created successfully");
    } catch (error) {
      console.error("❌ TenantManager initialization failed:", error);
      // Don't throw - allow app to continue without this
      this.initialized = true; // Mark as initialized anyway to prevent retries
    }
  }

  // Get central connection
  private static async getCentralConnection(): Promise<oracledb.Connection> {
    if (!this.centralPool) {
      await this.initialize();
    }
    return await this.centralPool!.getConnection();
  }

  // Get tenant for user
  static async getTenantForUser(loginid: string): Promise<string> {
    const conn = await this.getCentralConnection();
    try {
      const result = await conn.execute(
        `SELECT TENANT_ID FROM USER_TENANT_MAPPING 
         WHERE LOGINID = :loginid AND IS_DEFAULT = 'Y'`,
        { loginid },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return (result.rows as any[])?.[0]?.TENANT_ID || 'WMSTST_TENANT';
    } finally {
      await conn.close();
    }
  }

  // Get tenant configuration
  static async getTenantConfig(tenantId: string): Promise<TenantConfig> {
    const conn = await this.getCentralConnection();
    try {
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

      if (!result.rows || result.rows.length === 0) {
        throw new Error(`Tenant ${tenantId} not found`);
      }

      const config = result.rows[0] as any;
      
      // Set defaults if not provided
      if (!config.DB_HOST) config.DB_HOST = '10.10.2.56';
      if (!config.DB_PORT) config.DB_PORT = 1521;
      if (!config.DB_SERVICE) config.DB_SERVICE = 'BayaiiiiDB_dxb1c4.jumpsn.prodvcn.oraclevcn.com';

      return config as TenantConfig;
    } finally {
      await conn.close();
    }
  }

  // Get connection for tenant
  static async getConnection(tenantId: string): Promise<oracledb.Connection> {
    const config = await this.getTenantConfig(tenantId);
    
    // For SCHEMA type: Connect with tenant's credentials
    const pool = await this.getPoolForTenant(config);
    const conn = await pool.getConnection();
    
    // Set schema if needed
    if (config.CONNECTION_TYPE === 'SCHEMA' && config.SCHEMA_NAME) {
      await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${config.SCHEMA_NAME}`);
    }
    
    return conn;
  }

  // Get or create pool for tenant
  private static async getPoolForTenant(config: TenantConfig): Promise<oracledb.Pool> {
    const poolKey = `${config.TENANT_ID}_${config.DB_USER}`;
    
    if (this.tenantPools.has(poolKey)) {
      return this.tenantPools.get(poolKey)!.pool;
    }

    const pool = await oracledb.createPool({
      user: config.DB_USER,
      password: config.DB_PASSWORD, // Plain password for now
      connectString: `${config.DB_HOST}:${config.DB_PORT}/${config.DB_SERVICE}`,
      poolMin: 2,
      poolMax: 10,
      poolIncrement: 1,
      poolTimeout: 60,
    });

    this.tenantPools.set(poolKey, { pool, config });
    console.log(`✅ Created pool for tenant: ${config.TENANT_ID}`);
    
    return pool;
  }

  // Execute query in tenant context
  static async executeInTenant(
    tenantId: string,
    query: string,
    params: any = {}
  ): Promise<any[]> {
    const conn = await this.getConnection(tenantId);
    
    try {
      const result = await conn.execute(query, params, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      });
      
      return result.rows || [];
    } finally {
      await conn.close();
    }
  }

  // Execute query for user (auto-detect tenant)
  static async executeForUser(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<any[]> {
    const tenantId = await this.getTenantForUser(loginid);
    return await this.executeInTenant(tenantId, query, params);
  }

  // Cleanup
  static async closeAll(): Promise<void> {
    for (const [key, poolObj] of this.tenantPools) {
      try {
        await poolObj.pool.close();
        console.log(`✅ Closed pool: ${key}`);
      } catch (error) {
        console.error(`❌ Error closing pool ${key}:`, error);
      }
    }
    this.tenantPools.clear();

    if (this.centralPool) {
      try {
        await this.centralPool.close();
        this.centralPool = null;
        console.log("✅ Central pool closed");
      } catch (error) {
        console.error("❌ Error closing central pool:", error);
      }
    }
  }
}

export default TenantManager;
