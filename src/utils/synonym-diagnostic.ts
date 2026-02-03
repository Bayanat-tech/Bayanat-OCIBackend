/**
 * Diagnostic utilities for checking Oracle synonym validity
 */
import { executeRaw } from "../services/WMS/tenant-service.helper";

/**
 * Check if a synonym exists and is valid in the current schema
 */
export async function checkSynonymValidity(synonymName: string): Promise<{
  exists: boolean;
  valid: boolean;
  targetObject?: string;
  error?: string;
}> {
  try {
    const query = `
      SELECT 
        SYNONYM_NAME,
        TABLE_OWNER,
        TABLE_NAME,
        DB_LINK
      FROM USER_SYNONYMS
      WHERE SYNONYM_NAME = :synName
    `;
    
    const result = await executeRaw(query, { synName: synonymName.toUpperCase() });
    
    if (!result || result.length === 0) {
      return {
        exists: false,
        valid: false,
        error: `Synonym '${synonymName}' not found in current schema`
      };
    }

    const synInfo = result[0];
    return {
      exists: true,
      valid: true,
      targetObject: `${synInfo.TABLE_OWNER}.${synInfo.TABLE_NAME}${synInfo.DB_LINK ? '@' + synInfo.DB_LINK : ''}`
    };
  } catch (error) {
    return {
      exists: false,
      valid: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check if a table exists in the current schema
 */
export async function checkTableValidity(tableName: string): Promise<{
  exists: boolean;
  valid: boolean;
  error?: string;
}> {
  try {
    const query = `
      SELECT COUNT(*) as cnt
      FROM USER_TABLES
      WHERE TABLE_NAME = :tabName
    `;
    
    const result = await executeRaw(query, { tabName: tableName.toUpperCase() });
    
    if (result && result.length > 0 && result[0].cnt > 0) {
      return {
        exists: true,
        valid: true
      };
    }

    return {
      exists: false,
      valid: false,
      error: `Table '${tableName}' not found in current schema`
    };
  } catch (error) {
    return {
      exists: false,
      valid: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check if a stored procedure exists
 */
export async function checkProcedureValidity(procName: string): Promise<{
  exists: boolean;
  valid: boolean;
  error?: string;
}> {
  try {
    const query = `
      SELECT COUNT(*) as cnt
      FROM USER_PROCEDURES
      WHERE OBJECT_NAME = :procName AND OBJECT_TYPE = 'PROCEDURE'
    `;
    
    const result = await executeRaw(query, { procName: procName.toUpperCase() });
    
    if (result && result.length > 0 && result[0].cnt > 0) {
      return {
        exists: true,
        valid: true
      };
    }

    return {
      exists: false,
      valid: false,
      error: `Procedure '${procName}' not found in current schema`
    };
  } catch (error) {
    return {
      exists: false,
      valid: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get current schema name
 */
export async function getCurrentSchema(): Promise<string | null> {
  try {
    const result = await executeRaw("SELECT USER as current_user FROM DUAL", {});
    return result && result.length > 0 ? result[0].CURRENT_USER : null;
  } catch (error) {
    console.error("Failed to get current schema:", error);
    return null;
  }
}

/**
 * Comprehensive diagnostic report
 */
export async function generateDiagnosticReport(): Promise<{
  currentSchema: string | null;
  ttbatchStatus: any;
  spPutawayStatus: any;
  timestamp: string;
}> {
  console.log("🔍 Starting Oracle Synonym Diagnostic Report...\n");
  
  const currentSchema = await getCurrentSchema();
  console.log(`📍 Current Schema: ${currentSchema || 'UNKNOWN'}\n`);

  console.log("📋 Checking TT_BATCH...");
  const ttbatchStatus = await checkSynonymValidity("TT_BATCH")
    .catch(async () => await checkTableValidity("TT_BATCH"));
  console.log(`   Result:`, ttbatchStatus, "\n");

  console.log("📋 Checking SP_PUTAWAY_CONFIRM_NORMAL...");
  const spPutawayStatus = await checkProcedureValidity("SP_PUTAWAY_CONFIRM_NORMAL");
  console.log(`   Result:`, spPutawayStatus, "\n");

  return {
    currentSchema,
    ttbatchStatus,
    spPutawayStatus,
    timestamp: new Date().toISOString()
  };
}
