/**
 * Diagnostic script to check TT_BATCH synonym/table status
 * Run with: npx ts-node diagnose-synonym.ts
 */
import { oracleDb } from "./src/database/connection";
import oracledb from "oracledb";

async function diagnoseSynonym() {
  let connection: oracledb.Connection | null = null;

  try {
    console.log("\n🔍 === ORACLE SYNONYM DIAGNOSTIC ===\n");
    
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
    console.log("1️⃣ Current Schema:", schemaResult.rows?.[0]);

    // 2. Check if TT_BATCH is a synonym
    const synonymResult = await connection.execute(
      `SELECT SYNONYM_NAME, TABLE_OWNER, TABLE_NAME, DB_LINK
       FROM USER_SYNONYMS
       WHERE SYNONYM_NAME = 'TT_BATCH'`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("\n2️⃣ TT_BATCH Synonym Info:", synonymResult.rows);

    // 3. Check if TT_BATCH exists as a table in current schema
    const tableResult = await connection.execute(
      `SELECT TABLE_NAME
       FROM USER_TABLES
       WHERE TABLE_NAME = 'TT_BATCH'`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("\n3️⃣ TT_BATCH Table (current schema):", tableResult.rows);

    // 4. Check all accessible TT_BATCH tables/synonyms
    const allAccessibleResult = await connection.execute(
      `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE, STATUS
       FROM ALL_OBJECTS
       WHERE OBJECT_NAME = 'TT_BATCH'
       ORDER BY OWNER, OBJECT_TYPE`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("\n4️⃣ All Accessible TT_BATCH Objects:", allAccessibleResult.rows);

    // 5. If synonym exists, check if target table is accessible
    if (synonymResult.rows && synonymResult.rows.length > 0) {
      const syn = synonymResult.rows[0] as any;
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

    // 6. Try to query TT_BATCH directly
    console.log("\n6️⃣ Testing direct query on TT_BATCH...");
    try {
      const testQuery = await connection.execute(
        "SELECT COUNT(*) as CNT FROM TT_BATCH WHERE ROWNUM <= 1",
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log("   ✅ Query successful:", testQuery.rows);
    } catch (error: any) {
      console.log("   ❌ Query failed:", error.message);
    }

    // 7. Suggest solutions
    console.log("\n\n📋 === RECOMMENDED SOLUTIONS ===\n");
    
    if (synonymResult.rows && synonymResult.rows.length > 0) {
      const syn = synonymResult.rows[0] as any;
      console.log("Option 1: Recreate the synonym");
      console.log(`   DROP SYNONYM TT_BATCH;`);
      console.log(`   CREATE SYNONYM TT_BATCH FOR ${syn.TABLE_OWNER}.${syn.TABLE_NAME};`);
      
      console.log("\nOption 2: Use fully qualified table name");
      console.log(`   Change all queries from 'TT_BATCH' to '${syn.TABLE_OWNER}.TT_BATCH'`);
    } else if (tableResult.rows && tableResult.rows.length > 0) {
      console.log("✅ TT_BATCH exists as a table in your schema - no synonym needed");
    } else {
      console.log("⚠️ TT_BATCH not found. Please verify:");
      console.log("   1. Table exists in the database");
      console.log("   2. Current user has SELECT privilege");
      console.log("   3. Schema name is correct");
    }

    console.log("\n");

  } catch (error: any) {
    console.error("\n❌ Diagnostic Error:", error.message);
    console.error("Stack:", error.stack);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error("Error closing connection:", e);
      }
    }
    process.exit(0);
  }
}

diagnoseSynonym();
