/**
 * Diagnostic script to check TO_ORDER synonym/table status
 * Run with: npx ts-node diagnose-to-order.ts
 */
import { oracleDb } from "./src/database/connection";
import oracledb from "oracledb";

async function diagnoseToOrder() {
  let connection: oracledb.Connection | null = null;

  try {
    console.log("\n🔍 === TO_ORDER DIAGNOSTIC ===\n");
    
    // Initialize Oracle connection pool
    console.log("Initializing Oracle connection pool...");
    await oracleDb.authenticate();
    
    connection = await oracleDb.getConnection();

    // 1. Check current schema
    const schemaResult = await connection.execute(
      "SELECT USER as CURRENT_SCHEMA FROM DUAL",
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const currentSchema = (schemaResult.rows?.[0] as any)?.CURRENT_SCHEMA;
    console.log("1️⃣ Current Schema:", currentSchema);

    // 2. Check if TO_ORDER is a synonym
    const synonymResult = await connection.execute(
      `SELECT SYNONYM_NAME, TABLE_OWNER, TABLE_NAME, DB_LINK
       FROM USER_SYNONYMS
       WHERE SYNONYM_NAME = 'TO_ORDER'`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("\n2️⃣ TO_ORDER Synonym Info:", synonymResult.rows);

    // 3. Check if TO_ORDER exists as a table in current schema
    const tableResult = await connection.execute(
      `SELECT TABLE_NAME
       FROM USER_TABLES
       WHERE TABLE_NAME = 'TO_ORDER'`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("\n3️⃣ TO_ORDER Table (current schema):", tableResult.rows);

    // 4. Check all accessible TO_ORDER tables/synonyms
    const allAccessibleResult = await connection.execute(
      `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE, STATUS
       FROM ALL_OBJECTS
       WHERE OBJECT_NAME = 'TO_ORDER'
       ORDER BY OWNER, OBJECT_TYPE`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("\n4️⃣ All Accessible TO_ORDER Objects:", allAccessibleResult.rows);

    // 5. If synonym exists, check if target table is accessible
    if (synonymResult.rows && (synonymResult.rows as any[]).length > 0) {
      const syn = (synonymResult.rows as any[])[0];
      const targetOwner = syn.TABLE_OWNER;
      const targetTable = syn.TABLE_NAME;
      
      console.log(`\n5️⃣ Checking synonym target: ${targetOwner}.${targetTable}`);
      
      try {
        const targetCheck = await connection.execute(
          `SELECT COUNT(*) as CNT FROM ${targetOwner}.${targetTable} WHERE ROWNUM <= 1`,
          {},
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log("   ✅ Target table is accessible:", targetCheck.rows);
      } catch (error: any) {
        console.log("   ❌ Target table NOT accessible:", error.message);
      }
    }

    // 6. Try to query TO_ORDER directly
    console.log("\n6️⃣ Testing direct query on TO_ORDER...");
    try {
      const testQuery = await connection.execute(
        "SELECT COUNT(*) as CNT FROM TO_ORDER WHERE ROWNUM <= 1",
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log("   ✅ Query successful:", testQuery.rows);
    } catch (error: any) {
      console.log("   ❌ Query failed:", error.message);
    }

    // 7. Check table structure
    console.log("\n7️⃣ Checking TO_ORDER table columns...");
    try {
      const colsQuery = await connection.execute(
        `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TO_ORDER' ORDER BY COLUMN_ID`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if ((colsQuery.rows as any[]).length > 0) {
        console.log("   ✅ Columns found:", (colsQuery.rows as any[]).map(c => `${c.COLUMN_NAME} (${c.DATA_TYPE}, ${c.NULLABLE})`));
      } else {
        console.log("   ⚠️  No columns found - table may not exist");
      }
    } catch (error: any) {
      console.log("   ❌ Could not retrieve columns:", error.message);
    }

    // 8. Suggest solutions
    console.log("\n\n📋 === RECOMMENDED SOLUTIONS ===\n");
    
    if (synonymResult.rows && (synonymResult.rows as any[]).length > 0) {
      const syn = (synonymResult.rows as any[])[0];
      console.log("✅ Synonym exists. Try these steps:\n");
      console.log("Option 1: Recreate the synonym");
      console.log(`   DROP SYNONYM TO_ORDER;`);
      console.log(`   CREATE SYNONYM TO_ORDER FOR ${syn.TABLE_OWNER}.${syn.TABLE_NAME};\n`);
      
      console.log("Option 2: Check permissions on target table");
      console.log(`   GRANT SELECT, INSERT, UPDATE, DELETE ON ${syn.TABLE_OWNER}.${syn.TABLE_NAME} TO ${currentSchema};\n`);
    } else {
      console.log("❌ Synonym does not exist. Try these steps:\n");
      console.log("Option 1: Create the synonym if you know the actual table owner");
      console.log(`   CREATE SYNONYM TO_ORDER FOR <OWNER>.TO_ORDER;\n`);
      
      console.log("Option 2: Check if table exists in other schemas");
      console.log(`   SELECT * FROM ALL_TABLES WHERE TABLE_NAME = 'TO_ORDER';\n`);
    }

  } catch (error: any) {
    console.error("❌ Error during diagnosis:", error.message);
    console.error("Full error:", error);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr: any) {
        console.error("Error closing connection:", closeErr.message);
      }
    }
  }
}

// Run the diagnostic
diagnoseToOrder().catch(console.error);
