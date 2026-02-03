import TenantManager from "./TenantManager";

/**
 * TenantQueryBuilder - Simplified interface for executing tenant queries
 * Replaces TypeORM getRepository() for multi-tenant queries
 */
export class TenantQueryBuilder {
  /**
   * Execute a SELECT query in the user's tenant database
   * @param loginid - User login ID (auto-detects tenant)
   * @param query - SQL SELECT query
   * @param params - Query parameters
   * @returns Array of results
   */
  static async find<T = any>(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<T[]> {
    try {
      const results = await TenantManager.executeForUser(loginid, query, params);
      return results as T[];
    } catch (error) {
      console.error(`[TenantQueryBuilder.find] Error:`, 
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Execute a SELECT COUNT query
   * @param loginid - User login ID
   * @param query - SQL SELECT COUNT query
   * @param params - Query parameters
   * @returns Count value
   */
  static async count(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<number> {
    try {
      const result = await TenantManager.executeForUser(loginid, query, params);
      const count = result[0]?.CNT || result[0]?.count || 0;
      return Number(count);
    } catch (error) {
      console.error(`[TenantQueryBuilder.count] Error:`, 
        error instanceof Error ? error.message : String(error)
      );
      return 0;
    }
  }

  /**
   * Execute a SELECT query with pagination
   * @param loginid - User login ID
   * @param query - SQL SELECT query (without OFFSET/FETCH)
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @param params - Query parameters
   * @returns { data: T[], count: number }
   */
  static async findAndCount<T = any>(
    loginid: string,
    query: string,
    page: number = 1,
    limit: number = 20,
    params: any = {}
  ): Promise<{ data: T[]; count: number }> {
    try {
      const offset = (page - 1) * limit;

      // Add pagination to query
      const paginatedQuery = `${query} OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;

      // Execute data query
      const data = await TenantManager.executeForUser(
        loginid,
        paginatedQuery,
        { ...params, offset, limit }
      );

      // Extract count query (remove OFFSET/FETCH)
      const countQuery = query.includes("OFFSET")
        ? query.substring(0, query.indexOf("OFFSET")).trim()
        : query;
      const cleanCountQuery = `SELECT COUNT(*) AS cnt FROM (${countQuery})`;

      // Execute count query
      const countResult = await TenantManager.executeForUser(
        loginid,
        cleanCountQuery,
        params
      );

      const count = countResult[0]?.CNT || 0;

      return { data: data as T[], count: Number(count) };
    } catch (error) {
      console.error(`[TenantQueryBuilder.findAndCount] Error:`, 
        error instanceof Error ? error.message : String(error)
      );
      return { data: [], count: 0 };
    }
  }

  /**
   * Execute an INSERT query
   * @param loginid - User login ID
   * @param query - SQL INSERT query
   * @param params - Query parameters
   * @returns Success flag
   */
  static async insert(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<boolean> {
    try {
      await TenantManager.executeForUser(loginid, query, params);
      return true;
    } catch (error) {
      console.error(`[TenantQueryBuilder.insert] Error:`, 
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  /**
   * Execute an UPDATE query
   * @param loginid - User login ID
   * @param query - SQL UPDATE query
   * @param params - Query parameters
   * @returns Number of affected rows
   */
  static async update(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<number> {
    try {
      const result = await TenantManager.executeForUser(loginid, query, params);
      // Oracle doesn't return row count in result, so we estimate 1
      return 1;
    } catch (error) {
      console.error(`[TenantQueryBuilder.update] Error:`, 
        error instanceof Error ? error.message : String(error)
      );
      return 0;
    }
  }

  /**
   * Execute a DELETE query
   * @param loginid - User login ID
   * @param query - SQL DELETE query
   * @param params - Query parameters
   * @returns Success flag
   */
  static async delete(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<boolean> {
    try {
      await TenantManager.executeForUser(loginid, query, params);
      return true;
    } catch (error) {
      console.error(`[TenantQueryBuilder.delete] Error:`, 
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  /**
   * Execute a single row SELECT query
   * @param loginid - User login ID
   * @param query - SQL SELECT query
   * @param params - Query parameters
   * @returns Single result or null
   */
  static async findOne<T = any>(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<T | null> {
    try {
      const results = await TenantManager.executeForUser(loginid, query, params);
      return (results[0] as T) || null;
    } catch (error) {
      console.error(`[TenantQueryBuilder.findOne] Error:`, 
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  /**
   * Execute raw SQL query (for complex operations)
   * @param loginid - User login ID
   * @param query - SQL query
   * @param params - Query parameters
   * @returns Query results
   */
  static async raw<T = any>(
    loginid: string,
    query: string,
    params: any = {}
  ): Promise<T[]> {
    try {
      const results = await TenantManager.executeForUser(loginid, query, params);
      return results as T[];
    } catch (error) {
      console.error(`[TenantQueryBuilder.raw] Error:`, 
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}

export default TenantQueryBuilder;
