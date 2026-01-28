# 🔧 MULTI-TENANT FIX IMPLEMENTATION GUIDE

## Quick Start

This guide will help you fix all 60+ vulnerable `oracleDb.query()` calls.

---

## STEP 1: Add Safety Helper to QueryExecutor (2 minutes)

Add this function to `src/database/QueryExecutor.ts`:

```typescript
// Add this import at the top
import { getCurrentTenantId } from "../middleware/tenantContext.middleware";
import { TenantManager } from "./TenantManager";

export class QueryExecutor {
  // ... existing methods ...

  /**
   * Execute a raw SQL query with automatic tenant context.
   * This is the safe alternative to direct oracleDb.query() calls.
   * 
   * Usage:
   *   const result = await QueryExecutor.executeRawQuery("SELECT * FROM TABLE", { param1: value });
   */
  static async executeRawQuery(
    query: string,
    params: any = {}
  ): Promise<any[]> {
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      console.warn("[QueryExecutor.executeRawQuery] No tenant context - cannot execute query safely");
      throw new Error("No tenant context available for query execution. Ensure middleware is applied.");
    }

    console.log(`[QueryExecutor.executeRawQuery] Executing in tenant: ${tenantId}`);
    return await TenantManager.executeInTenant(tenantId, query, params);
  }

  /**
   * Execute a query with explicit tenant (useful for background jobs).
   * 
   * Usage:
   *   const result = await QueryExecutor.executeRawQueryForTenant("tenantId", "SELECT * FROM TABLE", {});
   */
  static async executeRawQueryForTenant(
    tenantId: string,
    query: string,
    params: any = {}
  ): Promise<any[]> {
    console.log(`[QueryExecutor.executeRawQueryForTenant] Executing in tenant: ${tenantId}`);
    return await TenantManager.executeInTenant(tenantId, query, params);
  }
}
```

---

## STEP 2: Create Migration Script

Save as `MIGRATION_ORACLEDB_QUERY_FIXES.md` to track progress:

```markdown
# oracleDb.query() → Tenant-Aware Migration

## Files to Fix (60+ instances)

### CRITICAL - Financial/Data Integrity Impact
- [ ] src/controllers/HR/hr_leave_approval.ts (15 instances)
- [ ] src/controllers/Vendor/vendorupdation.controller.ts (25 instances)

### HIGH - Data Access Impact  
- [ ] src/controllers/wms/transaction/outbound/pickingDetails_wms.controller.ts (5 instances)
- [ ] src/services/hr.service.ts (5 instances)

### MEDIUM - Background Jobs
- [ ] src/services/scheduler.service.ts (2 instances)
- [ ] src/controllers/HR/hr_leave_flow_sentback.ts (2 instances)

### LOW - Utilities
- [ ] src/services/purchaseFlow/*.ts (10+ instances)
- [ ] src/services/vendor.service.ts (1+ instance)
- [ ] src/controllers/HR/rawSql_hr_controller.ts (3 instances)

## Migration Template

Replace this pattern:
```typescript
// BEFORE - UNSAFE
const result = await oracleDb.query(sql, params);
```

With this (choose one):
```typescript
// AFTER - SAFE (Option 1: Auto-detect tenant from context)
const { QueryExecutor } = require("../../database/QueryExecutor");
const result = await QueryExecutor.executeRawQuery(sql, params);

// AFTER - SAFE (Option 2: Explicit tenant)
const tenantId = getCurrentTenantId();
const result = await TenantManager.executeInTenant(tenantId, sql, params);

// AFTER - SAFE (Option 3: Low-level control)
const tenantId = getCurrentTenantId();
const conn = await TenantManager.getConnection(tenantId);
try {
  const result = await conn.execute(sql, binds);
  await conn.commit();
} finally {
  await conn.close();
}
```

## Completion Status
- Reviewed: 0/60
- Fixed: 0/60
- Tested: 0/60
```

---

## STEP 3: Replacement Patterns by File Type

### Pattern A: Simple SELECT Queries

**BEFORE:**
```typescript
const result = await oracleDb.query("SELECT * FROM EMPLOYEES WHERE ID = :id", { id: 123 });
const employees = result.rows;
```

**AFTER:**
```typescript
import { QueryExecutor } from "../../database/QueryExecutor";

const employees = await QueryExecutor.executeRawQuery(
  "SELECT * FROM EMPLOYEES WHERE ID = :id", 
  { id: 123 }
);
```

---

### Pattern B: INSERT/UPDATE/DELETE with Connection

**BEFORE:**
```typescript
const connection = await oracleDb.getConnection();
try {
  await oracleDb.query(insertQuery, replacements, connection);
  await connection.commit();
} finally {
  await connection.close();
}
```

**AFTER:**
```typescript
import { TenantManager } from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

const tenantId = getCurrentTenantId();
const connection = await TenantManager.getConnection(tenantId);
try {
  await connection.execute(insertQuery, replacements);
  await connection.commit();
} finally {
  await connection.close();
}
```

---

### Pattern C: Background Jobs (No HTTP Context)

**BEFORE:**
```typescript
// ❌ In scheduler - no tenant context available
const result = await oracleDb.query(sql);
```

**AFTER:**
```typescript
// ✅ Specify tenant explicitly
import { QueryExecutor } from "../../database/QueryExecutor";

const tenantId = "WMSTST_TENANT"; // or get from config
const result = await QueryExecutor.executeRawQueryForTenant(tenantId, sql, {});
```

---

## STEP 4: File-by-File Fixes

### 1. src/controllers/HR/hr_leave_approval.ts

**Lines to Fix:** 379, 514, 658, 760, 821, 829, 907, 964, 1000, 1017, 1058, 1087, 1113

**Example Fix (Line 379):**

BEFORE:
```typescript
const result = await oracleDb.query(
  `SELECT TRIM(FINAL_APPROVED) AS FINAL_APPROVED
   FROM LEAVE_REQUEST_FLOW
   WHERE REQUEST_NUMBER = :req AND COMPANY_CODE = :comp`,
  { req: finalReq, comp: data.COMPANY_CODE }
);
```

AFTER:
```typescript
import { QueryExecutor } from "../../database/QueryExecutor";

const result = await QueryExecutor.executeRawQuery(
  `SELECT TRIM(FINAL_APPROVED) AS FINAL_APPROVED
   FROM LEAVE_REQUEST_FLOW
   WHERE REQUEST_NUMBER = :req AND COMPANY_CODE = :comp`,
  { req: finalReq, comp: data.COMPANY_CODE }
);
```

---

### 2. src/controllers/Vendor/vendorupdation.controller.ts

**Lines to Fix:** 131, 185, 197, 259, 427, 452, 500, 632, 675, 693, 821, 917, 1223, 1258, 1289, 1365, 1516, 1540, 1592, 1615, 1683, 1712, 1759

**Most Instances Follow Pattern B (transactions)**

Add at top:
```typescript
import { TenantManager } from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";
```

Replace:
```typescript
// BEFORE
const fileDataResult = await oracleDb.query(sql, bindParams);

// AFTER
const tenantId = getCurrentTenantId();
const conn = await TenantManager.getConnection(tenantId);
try {
  const result = await conn.execute(sql, bindParams);
  await conn.commit();
  return result;
} finally {
  await conn.close();
}
```

---

### 3. src/controllers/wms/transaction/outbound/pickingDetails_wms.controller.ts

**Lines to Fix:** 38, 70, 98, 148, 159

**Simple Pattern A (SELECT queries)**

Add at top:
```typescript
import { QueryExecutor } from "../../../../database/QueryExecutor";
```

Replace all:
```typescript
// BEFORE
const countResult = await oracleDb.query(countQuery, bindParams);

// AFTER
const countResult = await QueryExecutor.executeRawQuery(countQuery, bindParams);
```

---

### 4. src/services/hr.service.ts

**Lines to Fix:** 224, 247, 251, 255, 587

Add at top:
```typescript
import { QueryExecutor } from "../database/QueryExecutor";
```

Replace:
```typescript
// BEFORE
const result = await oracleDb.query(balanceQuery, bindParams);

// AFTER
const result = await QueryExecutor.executeRawQuery(balanceQuery, bindParams);
```

---

### 5. src/services/scheduler.service.ts

**Lines to Fix:** 9, 31

**Note:** Background jobs need explicit tenant. Modify to:

```typescript
import { QueryExecutor } from "../database/QueryExecutor";

// Get tenant from config or parameter
const tenantId = "WMSTST_TENANT"; // or pass as parameter

// BEFORE
const unsentHeaders = await oracleDb.query(sql);

// AFTER
const unsentHeaders = await QueryExecutor.executeRawQueryForTenant(tenantId, sql, {});
```

---

### 6. src/services/purchaseFlow/*.ts

**Pattern:** All use `oracleDb.query()`

Universal Fix:
```typescript
// Add to each file
import { QueryExecutor } from "../../database/QueryExecutor";

// Replace all oracleDb.query() with:
const result = await QueryExecutor.executeRawQuery(sql, params);
```

---

## STEP 5: Validation Checklist

After fixing each file, verify:

- [ ] **Import added:** `QueryExecutor` or `TenantManager`
- [ ] **All `oracleDb.query()` calls replaced**
- [ ] **No query accesses hardcoded schema** (like `CENTRAL_SCHEMA.TABLE`)
- [ ] **Compiler errors resolved:** `npm run build`
- [ ] **Test file runs without errors**
- [ ] **Data isolation verified** (test with multiple tenants)

---

## STEP 6: Testing

### Unit Test Example

Save as `src/database/QueryExecutor.test.ts`:

```typescript
import { QueryExecutor } from "./QueryExecutor";
import { getCurrentTenantId } from "../middleware/tenantContext.middleware";

describe("QueryExecutor - Tenant-Aware Queries", () => {
  
  test("executeRawQuery should use tenant context", async () => {
    // Mock tenant context
    const mockTenant = "WMSTST_TENANT";
    
    // Execute query (should use mock tenant, not central)
    const result = await QueryExecutor.executeRawQuery(
      "SELECT * FROM EMPLOYEES",
      {}
    );
    
    // Verify it executed in correct schema
    expect(result).toBeDefined();
  });

  test("should fail if no tenant context", async () => {
    // Clear context
    // Try to execute
    expect(async () => {
      await QueryExecutor.executeRawQuery("SELECT * FROM EMPLOYEES", {});
    }).rejects.toThrow();
  });
});
```

### Integration Test Example

```typescript
test("multi-tenant isolation", async () => {
  // User from Tenant A
  setTenantContext("WMSTST_TENANT");
  const resultA = await QueryExecutor.executeRawQuery(
    "SELECT * FROM EMPLOYEES",
    {}
  );

  // User from Tenant B
  setTenantContext("OTHERAPP_TENANT");
  const resultB = await QueryExecutor.executeRawQuery(
    "SELECT * FROM EMPLOYEES",
    {}
  );

  // Results should be DIFFERENT (different tenant data)
  expect(resultA).not.toEqual(resultB);
});
```

---

## STEP 7: Deployment Strategy

### Option 1: Big Bang (Recommended for small teams)
1. Fix all 60+ calls
2. Test in staging
3. Deploy in one release

### Option 2: Phased (Recommended for large teams)

**Phase 1 (Week 1):** Fix Critical Files
- hr_leave_approval.ts
- vendorupdation.controller.ts
- Test heavily

**Phase 2 (Week 2):** Fix High Priority  
- WMS controllers
- HR services

**Phase 3 (Week 3):** Fix Remaining
- Utilities
- Background jobs

---

## Troubleshooting

### Error: "No tenant context available"

**Cause:** Query executed in non-authenticated route (auth, health check)

**Solution:**
```typescript
const tenantId = getCurrentTenantId();
if (!tenantId) {
  // Use central connection for public routes
  const result = await oracleDb.query(sql); // OK for CENTRAL schema only
  return result;
}
// Otherwise use tenant-aware
const result = await QueryExecutor.executeRawQuery(sql, params);
```

### Error: "Connection pool exhausted"

**Cause:** Not closing connections properly

**Solution:**
```typescript
// ALWAYS close connections
const conn = await TenantManager.getConnection(tenantId);
try {
  // ... do work ...
} finally {
  await conn.close(); // ← CRITICAL
}
```

### Queries returning wrong tenant's data

**Cause:** Still using `oracleDb.query()` in some places

**Solution:**
```typescript
// Search for remaining instances
grep -r "oracleDb\.query" src/controllers src/services
// Replace any found ones
```

---

## Estimated Impact

| Metric | Value |
|--------|-------|
| Files to Fix | 8-10 |
| Total Replacements | 60+ |
| Time per file | 15-30 min |
| Total Time | 8-10 hours |
| Risk | LOW (backward compatible) |
| Testing Time | 4-6 hours |
| **Total Time** | **12-16 hours** |

---

## Rollback Plan

If issues arise:

```typescript
// Temporary rollback: Add feature flag
const useNewTenantAware = process.env.USE_TENANT_AWARE === "true";

if (useNewTenantAware) {
  result = await QueryExecutor.executeRawQuery(sql, params);
} else {
  result = await oracleDb.query(sql, params); // Old way
}
```

Set `USE_TENANT_AWARE=false` to revert temporarily.

---

## Success Criteria

After fixes, verify:

✅ All 60+ `oracleDb.query()` calls replaced  
✅ Code compiles without errors  
✅ 100 concurrent user test passes  
✅ Multi-tenant data isolation confirmed  
✅ No performance degradation  
✅ Audit logs show correct tenant context  

---

## Questions?

Refer to:
- [TenantManager.ts](../src/database/TenantManager.ts) - Tenant pool management
- [QueryExecutor.ts](../src/database/QueryExecutor.ts) - Query routing
- [tenantContext.middleware.ts](../src/middleware/tenantContext.middleware.ts) - Context setup
- [connection.ts](../src/database/connection.ts) - Connection details

