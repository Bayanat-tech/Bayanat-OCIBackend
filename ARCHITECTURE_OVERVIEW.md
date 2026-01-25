# 🏗️ Multi-Tenant Architecture Overview

## Complete System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT / FRONTEND                         │
│                                                                  │
│  Browser/Mobile App                                             │
│  - Stores JWT token                                             │
│  - Sends JWT in Authorization header on every request           │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                      Authorization: Bearer eyJh...
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                         EXPRESS SERVER                            │
│                         (index.ts)                               │
│                                                                  │
│  - CORS enabled                                                 │
│  - JSON body parser                                             │
│  - passport.initialize()                                        │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                           All routes pass through
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│               PASSPORT JWT STRATEGY                              │
│               (src/utils/passport.ts)                            │
│                                                                  │
│  1. Extract JWT from header                                     │
│  2. Verify JWT signature                                        │
│  3. Decode payload:                                             │
│     - loginid: "PRAKASH"                                        │
│     - tenantId: "WMSTST_TENANT"  ← KEY!                         │
│     - email: "prakash@company.com"                              │
│  4. Set req.user with all payload data                          │
│                                                                  │
│  Output: req.user = {                                           │
│    loginid: "PRAKASH",                                          │
│    tenantId: "WMSTST_TENANT",                                   │
│    email: "prakash@company.com"                                 │
│  }                                                              │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                   req.user now has tenantId
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│        🌟 TENANT CONTEXT MIDDLEWARE 🌟                           │
│        (src/middleware/tenantContext.middleware.ts)              │
│                                                                  │
│  STEP 1: Extract tenantId from req.user                         │
│          tenantId = "WMSTST_TENANT"                             │
│                                                                  │
│  STEP 2: Get tenant config from TENANT_REGISTRY                │
│          SELECT * FROM CUSTOMERS.TENANT_REGISTRY                │
│          WHERE TENANT_ID = 'WMSTST_TENANT'                      │
│          Result: { SCHEMA_NAME: "WMSTST", ... }                 │
│                                                                  │
│  STEP 3: 🔑 SWITCH TYPEORM SCHEMA                               │
│          Execute: ALTER SESSION SET CURRENT_SCHEMA = WMSTST     │
│          ↓                                                      │
│          All subsequent queries use WMSTST schema!              │
│                                                                  │
│  STEP 4: Store context in AsyncLocalStorage                     │
│          tenantContextStorage = {                               │
│            loginid: "PRAKASH",                                  │
│            tenantId: "WMSTST_TENANT"                            │
│          }                                                      │
│                                                                  │
│  STEP 5: Continue to next middleware/handler                    │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
              Schema now set to WMSTST for this request
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                       ROUTE HANDLER                              │
│                  (src/controllers/...)                           │
│                                                                  │
│  Example: GET /api/security/company/ABC                         │
│                                                                  │
│  async function getCompany(req, res) {                          │
│    const company = await CompanyService.findByCode("ABC");      │
│    res.json(company);                                           │
│  }                                                              │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                        Calls service layer
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                      SERVICE LAYER                               │
│                  (src/services/Security/                         │
│                   company.service.ts)                            │
│                                                                  │
│  static async findByCode(code: string) {                        │
│    const repository = getRepository(Company);                   │
│    return await repository.findOne({                            │
│      where: { company_code: code }                              │
│    });                                                          │
│  }                                                              │
│                                                                  │
│  ✨ NOTE: Service code is UNCHANGED!                            │
│     TypeORM now uses WMSTST schema automatically                │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                        TypeORM repository
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                        TYPEORM                                   │
│                  (src/database/connection.ts)                    │
│                   AppDataSource pool                            │
│                                                                  │
│  getRepository(Company)                                         │
│    .findOne({ where: { company_code: "ABC" } })                │
│                                                                  │
│  Generates SQL:                                                 │
│  SELECT * FROM MS_COMPANY WHERE COMPANY_CODE = 'ABC'           │
│                                                                  │
│  ⚠️  Key: This query runs in current session schema             │
│      which was switched to WMSTST by middleware!                │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                        SQL Query to Oracle
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                   ORACLE DATABASE                                │
│                   (multi-tenant)                                │
│                                                                  │
│  CUSTOMERS Schema (Central, shared)                             │
│  ├─ SEC_LOGIN (user credentials)                               │
│  ├─ USER_TENANT_MAPPING (user → tenant)                        │
│  └─ TENANT_REGISTRY (tenant config)                            │
│                                                                  │
│  WMSTST Schema (Tenant specific)                                │
│  ├─ MS_COMPANY ← Query executes here! ✅                        │
│  ├─ EMPLOYEE_EVENTS                                            │
│  ├─ EMPLOYEES                                                  │
│  └─ ... other tables                                           │
│                                                                  │
│  WMSDEV Schema (Another tenant)                                 │
│  ├─ MS_COMPANY (different data)                                │
│  ├─ EMPLOYEE_EVENTS                                            │
│  └─ ... other tables                                           │
│                                                                  │
│  Current session:                                              │
│  Session 1 (WMSTST user): ALTER SESSION SET CURRENT_SCHEMA=WMSTST
│  Session 2 (WMSDEV user): ALTER SESSION SET CURRENT_SCHEMA=WMSDEV
│                                                                  │
│  Query Result:                                                  │
│  SELECT * FROM WMSTST.MS_COMPANY                                │
│  WHERE COMPANY_CODE = 'ABC'                                     │
│  Returns: Company data from WMSTST only! ✅                      │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                        Data returned to service
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                    SERVICE RETURNS DATA                          │
│                    (company.service.ts)                          │
│                                                                  │
│  Company object with data from WMSTST schema                    │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                        Back to controller
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                    CONTROLLER RESPONDS                           │
│                                                                  │
│  res.json({                                                     │
│    success: true,                                               │
│    data: company_from_wmstst_schema                             │
│  })                                                             │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                      JSON response to frontend
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                    CLIENT / FRONTEND                             │
│                                                                  │
│  {                                                              │
│    "success": true,                                             │
│    "data": {                                                    │
│      "company_code": "ABC",                                     │
│      "company_name": "WMSTST Company",                          │
│      "from": "WMSTST tenant"                                    │
│    }                                                            │
│  }                                                              │
│                                                                  │
│  ✅ Correct tenant data returned!                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Comparison

### Single Tenant (Old)
```
Service → Repository → TypeORM → Oracle (CUSTOMERS)
```

### Multi-Tenant (New)
```
Service → Repository → TypeORM → Oracle (WMSTST/WMSDEV/etc)
                        ↑
                    Schema switched by middleware
                    based on JWT tenantId
```

---

## Key Components

### 1. Authentication (Passport)
- **File**: `src/utils/passport.ts`
- **Role**: Extract JWT, validate, set req.user
- **Output**: req.user with tenantId

### 2. Tenant Context Middleware
- **File**: `src/middleware/tenantContext.middleware.ts`
- **Role**: Read tenantId, switch schema, store context
- **Key Line**: `ALTER SESSION SET CURRENT_SCHEMA = WMSTST`

### 3. TenantManager
- **File**: `src/database/TenantManager.ts`
- **Role**: Manage tenant connections, get configs
- **Methods**: 
  - `getTenantForUser(loginid)` → Find tenant
  - `getTenantConfig(tenantId)` → Get schema name
  - `getConnection(tenantId)` → Get tenant connection

### 4. TypeORM
- **File**: `src/database/connection.ts`
- **Role**: Execute queries in current schema
- **Why**: Schema already switched by middleware

### 5. Services
- **Files**: `src/services/**/*.ts`
- **Role**: Use TypeORM normally
- **Change**: NONE! ✅

---

## Isolation & Security

### Tenant Isolation
```
User A (WMSTST):
  1. Login → JWT with tenantId: WMSTST_TENANT
  2. Request with JWT
  3. Middleware switches to WMSTST schema
  4. All queries in WMSTST only

User B (WMSDEV):
  1. Login → JWT with tenantId: WMSDEV_TENANT
  2. Request with JWT
  3. Middleware switches to WMSDEV schema
  4. All queries in WMSDEV only

User A cannot see User B's data ✅
```

### Authentication
```
JWT Contains:
- loginid: "PRAKASH"
- tenantId: "WMSTST_TENANT"  ← Identifies tenant
- email: "prakash@company.com"
- signature: verified server-side

If JWT is invalid/expired: Passport rejects → 401 Unauthorized
If tenantId missing: Middleware returns 403 Forbidden
```

---

## Scalability

### Single Request
- **Schema Switch**: 1 SQL statement
- **Overhead**: ~1-2ms per request
- **Impact**: Negligible

### Multiple Requests
```
Request 1 (WMSTST user): ALTER SESSION SET CURRENT_SCHEMA = WMSTST
Request 2 (WMSDEV user): ALTER SESSION SET CURRENT_SCHEMA = WMSDEV
Request 3 (WMSTST user): ALTER SESSION SET CURRENT_SCHEMA = WMSTST
...

Each request independently routed ✅
```

### Connection Pooling
```
Pool (5-20 connections):
- Connection 1: User A query (WMSTST)
- Connection 2: User B query (WMSDEV)
- Connection 3: User A query (WMSTST)
- Connection 4: Public route (CUSTOMERS)
- Connection 5: Background job (all tenants)

Each connection manages its own session ✅
```

---

## Error Handling

### Missing Tenant
```
User: No tenant mapping in database
Middleware: Looks up USER_TENANT_MAPPING
Result: Not found
Action: Return 403 Forbidden
```

### Invalid JWT
```
JWT: Invalid signature or expired
Passport: Verify fails
Action: Return 401 Unauthorized
```

### Schema Switch Fails
```
ALTER SESSION SET CURRENT_SCHEMA = WMSTST
Error: User doesn't have permissions
Middleware: Log warning, continue anyway
Result: Queries use default schema (may fail)
```

---

## Testing Multi-Tenancy

### Test 1: Tenant Isolation
```bash
# Login as WMSTST user
TOKEN1=$(curl ... login WMSTST_USER)

# Login as WMSDEV user
TOKEN2=$(curl ... login WMSDEV_USER)

# Query with TOKEN1 (should get WMSTST data)
curl -H "Authorization: Bearer $TOKEN1" /api/data

# Query with TOKEN2 (should get WMSDEV data)
curl -H "Authorization: Bearer $TOKEN2" /api/data

# Verify: Different data returned ✅
```

### Test 2: No Cross-Tenant Data
```bash
# Create company in WMSTST
curl -H "Authorization: Bearer WMSTST_TOKEN" \
  -X POST /api/company \
  -d '{"code":"ABC", "name":"WMSTST Corp"}'

# Query from WMSDEV
curl -H "Authorization: Bearer WMSDEV_TOKEN" \
  -X GET /api/company/ABC

# Verify: 404 Not Found (data doesn't exist in WMSDEV) ✅
```

### Test 3: Schema Switch Logs
```
Logs from server:
[tenantContextMiddleware] STEP 1: User: PRAKASH
[tenantContextMiddleware] STEP 2: Tenant: WMSTST_TENANT
[tenantContextMiddleware] STEP 3: Switching TypeORM schema...
[tenantContextMiddleware] ✅ TypeORM schema switched to WMSTST
[tenantContextMiddleware] ✅ CONTEXT SET: loginid=PRAKASH, tenant=WMSTST_TENANT

Verify: Correct schema name ✅
```

---

## Production Checklist

- [ ] All services tested with multi-tenant users
- [ ] Schema isolation verified
- [ ] Performance acceptable
- [ ] Logs show correct schema switches
- [ ] JWT includes tenantId
- [ ] Error handling works
- [ ] Backup/recovery tested
- [ ] Monitoring configured

---

## Files & Responsibilities

```
src/
├── middleware/
│   └── tenantContext.middleware.ts         ← 🌟 SCHEMA SWITCHING
├── utils/
│   └── passport.ts                         ← JWT extraction
├── database/
│   ├── TenantManager.ts                    ← Tenant config & connection
│   ├── connection.ts                       ← TypeORM & Oracle pools
│   ├── TypeORMTenantInterceptor.ts         ← Optional helpers
│   └── AutoTenantRouter.ts                 ← Optional wrappers
├── services/
│   └── **/*.service.ts                     ← UNCHANGED ✅
├── controllers/
│   └── **/*.controller.ts                  ← UNCHANGED ✅
└── routes/
    └── **.routes.ts                        ← UNCHANGED ✅
```

---

## Summary

The multi-tenant system works by:

1. **JWT** carries tenantId
2. **Passport** extracts it
3. **Middleware** switches schema
4. **TypeORM** queries use switched schema
5. **Services** work unchanged
6. **Data** isolated by tenant

**Result:** Transparent multi-tenancy without code changes!

