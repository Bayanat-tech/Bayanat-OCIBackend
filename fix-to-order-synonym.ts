/**
 * Fix script to recreate the TO_ORDER synonym
 * Run with: npx ts-node fix-to-order-synonym.ts
 */
import { oracleDb } from "./src/database/connection";
import oracledb from "oracledb";

async function fixToOrderSynonym() {
  let connection: oracledb.Connection | null = null;

  try {
    console.log("\n🔧 === FIXING TO_ORDER SYNONYM ===\n");
    
    // Initialize Oracle connection pool
    console.log("Initializing Oracle connection pool...");
    await oracleDb.authenticate();
    
    connection = await oracleDb.getConnection();

    // Get current schema
    const schemaResult = await connection.execute(
      "SELECT USER as CURRENT_SCHEMA FROM DUAL",
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const currentSchema = (schemaResult.rows?.[0] as any)?.CURRENT_SCHEMA;
    console.log("Current Schema:", currentSchema);

    // Check current PUBLIC synonym
    console.log("\n📋 Checking current PUBLIC synonym definition...");
    try {
      const synCheck = await connection.execute(
        `SELECT OWNER, SYNONYM_NAME, TABLE_OWNER, TABLE_NAME, DB_LINK
         FROM ALL_SYNONYMS 
         WHERE OWNER = 'PUBLIC' AND SYNONYM_NAME = 'TO_ORDER'`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if ((synCheck.rows as any[]).length > 0) {
        const syn = (synCheck.rows as any[])[0];
        console.log(`Current target: ${syn.TABLE_OWNER}.${syn.TABLE_NAME}${syn.DB_LINK ? '@' + syn.DB_LINK : ''}`);
      }
    } catch (error: any) {
      console.log("Could not check public synonym:", error.message);
    }

    // Step 1: Drop the broken PUBLIC synonym
    console.log("\n1️⃣ Dropping broken PUBLIC synonym...");
    try {
      await connection.execute("DROP PUBLIC SYNONYM TO_ORDER", {}, { autoCommit: true });
      console.log("   ✅ PUBLIC synonym dropped");
    } catch (error: any) {
      if (error.message.includes("does not exist")) {
        console.log("   ℹ️  Public synonym doesn't exist (this is fine)");
      } else {
        console.log("   ⚠️  Could not drop:", error.message);
      }
    }

    // Step 2: Get the correct target schema for current user
    // Assuming company_code drives the schema selection
    console.log("\n2️⃣ Finding correct table owner...");
    
    // For now, create a private synonym in CUSTOMERS schema
    // pointing to CUSTOMERS.TO_ORDER table (since CUSTOMERS owns the table)
    const targetOwner = currentSchema; // Use current schema's TO_ORDER table
    
    console.log(`   Target: ${targetOwner}.TO_ORDER`);

    // Step 3: Verify target table exists and is accessible
    console.log("\n3️⃣ Verifying target table exists...");
    try {
      const checkResult = await connection.execute(
        `SELECT COUNT(*) as CNT FROM ${targetOwner}.TO_ORDER WHERE ROWNUM <= 1`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log("   ✅ Target table is accessible");
    } catch (error: any) {
      console.log("   ❌ Target table not accessible:", error.message);
      console.log("\n   Alternative: Check which schema has the TO_ORDER table with data...");
      const altCheck = await connection.execute(
        `SELECT OWNER FROM ALL_TABLES 
         WHERE TABLE_NAME = 'TO_ORDER' 
         ORDER BY OWNER`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log("   Available schemas:", (altCheck.rows as any[]).map((r: any) => r.OWNER).join(", "));
      throw new Error("Cannot verify target table");
    }

    // Step 4: Create private synonym for CUSTOMERS schema
    console.log("\n4️⃣ Creating private synonym in CUSTOMERS schema...");
    try {
      const createSynonymSQL = `CREATE SYNONYM TO_ORDER FOR ${targetOwner}.TO_ORDER`;
      await connection.execute(createSynonymSQL, {}, { autoCommit: true });
      console.log(`   ✅ Created: CREATE SYNONYM TO_ORDER FOR ${targetOwner}.TO_ORDER`);
    } catch (error: any) {
      if (error.message.includes("already exists")) {
        console.log("   ℹ️  Synonym already exists");
      } else {
        throw error;
      }
    }

    // Step 5: Test the fix
    console.log("\n5️⃣ Testing the fix...");
    try {
      const testQuery = await connection.execute(
        "SELECT COUNT(*) as CNT FROM TO_ORDER WHERE ROWNUM <= 1",
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log("   ✅ Query successful! Fix is working.");
      console.log(`   Rows found: ${(testQuery.rows as any[])[0]?.CNT || 0}`);
    } catch (error: any) {
      console.log("   ❌ Query still failing:", error.message);
      throw error;
    }

    console.log("\n✅ === FIX COMPLETE ===\n");

  } catch (error: any) {
    console.error("\n❌ Error during fix:", error.message);
    console.error("Full error:", error);
    process.exit(1);
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

// Run the fix
fixToOrderSynonym().catch(console.error);
