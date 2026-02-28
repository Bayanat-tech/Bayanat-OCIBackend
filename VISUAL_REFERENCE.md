# Dynamic Routes - Visual Reference & Quick Commands

## 🏗️ Architecture Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER (Browser)                            │
└────────────────────────┬────────────────────────────────────┘
                         │ Login
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                   Backend /api/auth/me                       │
│  • Validates credentials                                     │
│  • Queries SEC_MODULE_DATA (all routes)                      │
│  • Queries SEC_ROLE_FUNCTION_ACCESS_USER (permissions)       │
│  • Builds permissionBasedMenuTree                           │
│  • Returns in JWT                                           │
└────────────────────────┬────────────────────────────────────┘
                         │ Response with permissionBasedMenuTree
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              Frontend Redux Store                            │
│  • Store permissionBasedMenuTree                            │
│  • Persist until logout                                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌──────────────────────────────────────────────────────────────┐
│           useDynamicRoutes Hook                              │
│  • flattenRoutes(permissionBasedMenuTree)                   │
│  • Converts hierarchy → flat array                          │
│  └→ [{path, component_name, serial_no, ...}, ...]          │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ↓
┌──────────────────────────────────────────────────────────────┐
│           DynamicRoutesComponent                             │
│  • Maps flatRoutes to <Route /> elements                    │
│  • Looks up components in componentRegistry                 │
│  • Suspense + lazy loading                                  │
│  └→ <Route path={path} element={<Component />} />           │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ↓
            ┌────────────┴────────────┐
            ↓                         ↓
┌───────────────────────┐  ┌──────────────────────┐
│ Component Found       │  │ Component NOT Found  │
│ ✓ Render Component    │  │ ⚠ Show ComingSoon    │
│   (lazy loaded)       │  │                      │
└───────────────────────┘  └──────────────────────┘
            │                         │
            └────────────┬────────────┘
                         ↓
            ┌─────────────────────────┐
            │   User Sees Route       │
            │   & Can Navigate        │
            └─────────────────────────┘
```

---

## 📊 Database Schema - SEC_MODULE_DATA

```
┌────────────────────────────────────────────────────────────┐
│ SEC_MODULE_DATA                                            │
├────────────────────────────────────────────────────────────┤
│ SERIAL_NO (PK, NUMBER)                                     │
│ COMPANY_CODE (VARCHAR2) - Tenant ID                        │
│ APP_CODE (VARCHAR2) - Application (WMS, ACCOUNTS, etc.)    │
│ LEVEL1 (VARCHAR2) - Menu Level 1 (Reports, Masters)        │
│ LEVEL2 (VARCHAR2) - Menu Level 2 (Financial Reports)       │
│ LEVEL3 (VARCHAR2) - Menu Level 3 (Income Statement)        │
│ URL_PATH (VARCHAR2) - Route path (income-statement)        │
├── NEW COLUMNS ───────────────────────────────────────────┤
│ COMPONENT_NAME (VARCHAR2) - React component key            │
│ IS_ACTIVE (CHAR) - Y/N, visibility control                 │
│ ROUTE_TYPE (VARCHAR2) - INTERNAL/EXTERNAL/COMING_SOON      │
│ DESCRIPTION (VARCHAR2) - Help text                         │
│ SORT_ORDER (NUMBER) - Display order                        │
│ ICON_NAME (VARCHAR2) - Icon identifier                     │
├────────────────────────────────────────────────────────────┤
│ CREATED_BY, CREATED_AT                                     │
│ UPDATED_BY, UPDATED_AT                                     │
└────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow Examples

### Example 1: User Logs In

```
1. Frontend: POST /api/auth/login
   ↓
2. Backend: Query SEC_MODULE_DATA (all routes)
   SELECT * FROM SEC_MODULE_DATA 
   WHERE IS_ACTIVE = 'Y'
   ↓
3. Backend: Query SEC_ROLE_FUNCTION_ACCESS_USER (permissions)
   SELECT * FROM SEC_ROLE_FUNCTION_ACCESS_USER 
   WHERE LOGINID = 'JOHN'
   ↓
4. Backend: Build permissionBasedMenuTree
   Combine routes + permissions
   ↓
5. Backend: Return in response with JWT
   {
     user: {...},
     permissionBasedMenuTree: [
       {
         id: "WMS",
         title: "WMS",
         children: [
           { title: "Reports", children: [...] }
         ]
       }
     ]
   }
   ↓
6. Frontend: Store in Redux
   dispatch(setLogin(response.data))
   ↓
7. Frontend: useAuth() hook returns tree
   const { permissionBasedMenuTree } = useAuth()
   ↓
8. Frontend: Build routes
   const flatRoutes = useDynamicRoutes(permissionBasedMenuTree)
```

### Example 2: Admin Adds New Route

```
1. Admin: Opens security screen
   ↓
2. Admin: Fills form:
   - APP_CODE: ACCOUNTS
   - LEVEL1: Reports
   - LEVEL2: Financial
   - URL_PATH: income-statement
   - COMPONENT_NAME: IncomeStatementReport
   - IS_ACTIVE: Y
   ↓
3. Frontend: POST /api/routes
   ↓
4. Backend: Validate input
   Check COMPONENT_NAME format, required fields
   ↓
5. Backend: INSERT into SEC_MODULE_DATA
   ↓
6. Backend: Return success
   ↓
7. Next time user logs in:
   Step 1-8 from "User Logs In" example
   New route appears in menu!
```

### Example 3: User Navigates to Route

```
User clicks: "Income Statement" in menu
   ↓
Frontend: JavaScript routing
   Router sees path: /app/accounts/income-statement
   ↓
Frontend: Matches against flatRoutes
   flatRoutes = [
     { path: '/app/accounts/income-statement', 
       component_name: 'IncomeStatementReport' },
     ...
   ]
   ↓
Frontend: Look up component in componentRegistry
   componentRegistry['IncomeStatementReport']
   ↓
Frontend: Found! Return component
   lazy(() => import('../pages/reports/IncomeStatementReport'))
   ↓
Frontend: Render with Suspense
   <Suspense fallback={<Loader />}>
     <IncomeStatementReport />
   </Suspense>
   ↓
User sees: Income Statement Report page!
```

---

## ⚡ Quick Commands Reference

### SQL Commands

```sql
-- Add new route (no code changes!)
INSERT INTO SEC_MODULE_DATA (
  SERIAL_NO, COMPANY_CODE, APP_CODE, LEVEL1, LEVEL2,
  URL_PATH, COMPONENT_NAME, IS_ACTIVE, ROUTE_TYPE,
  CREATED_BY, UPDATED_BY, CREATE_DATE, CREATED_AT
) VALUES (
  SEC_MODULE_DATA_SEQ.NEXTVAL, 'DEFAULT', 'APP_CODE',
  'Level1', 'Level2', 'url-path', 'ComponentName', 'Y', 'INTERNAL',
  'ADMIN', 'ADMIN', SYSDATE, SYSTIMESTAMP
);
COMMIT;

-- Grant user access to route
INSERT INTO SEC_ROLE_FUNCTION_ACCESS_USER (
  SERIAL_NO_OR_ROLE_ID, LOGINID, COMPANY_CODE,
  SNEW, SMODIFY, SDELETE, SSAVE, SSEARCH,
  SSAVEAS, SUPLOAD, SUNDO, SPRINT, SPRINTSETUP, SHELP
) VALUES (
  1001, 'USERNAME', 'DEFAULT',
  'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y'
);
COMMIT;

-- Hide route
UPDATE SEC_MODULE_DATA SET IS_ACTIVE = 'N' WHERE SERIAL_NO = 1001;
COMMIT;

-- Mark as coming soon
UPDATE SEC_MODULE_DATA SET ROUTE_TYPE = 'COMING_SOON' WHERE SERIAL_NO = 1001;
COMMIT;

-- View all active routes
SELECT * FROM V_SEC_ACTIVE_ROUTES ORDER BY APP_CODE, LEVEL1, LEVEL2;

-- Check user permissions
SELECT * FROM SEC_ROLE_FUNCTION_ACCESS_USER WHERE LOGINID = 'USERNAME';

-- Find route by path
SELECT * FROM SEC_MODULE_DATA WHERE URL_PATH = 'income-statement';
```

### Frontend Commands (Browser Console)

```javascript
// Check loaded routes
import componentRegistry from './utils/componentRegistry';
console.log(Object.keys(componentRegistry));

// Test flattening
import { flattenRoutes } from './utils/dynamicRouteGenerator';
const menuTree = useAuth().permissionBasedMenuTree;
const flat = flattenRoutes(menuTree);
console.log(flat);

// Get route stats
import { getRouteStats } from './utils/dynamicRouteGenerator';
console.log(getRouteStats(flat));

// Find route
import { findRouteByPath } from './utils/dynamicRouteGenerator';
const route = findRouteByPath(flat, '/app/accounts/income-statement');
console.log(route);

// Check Redux state
import store from './store';
console.log(store.getState().auth);
```

### Backend Commands (CURL)

```bash
# Get all routes
curl -H "Authorization: Bearer YOUR_JWT" \
  http://localhost:3500/api/routes

# Get hierarchical tree
curl -H "Authorization: Bearer YOUR_JWT" \
  http://localhost:3500/api/routes/tree

# Get routes by app
curl -H "Authorization: Bearer YOUR_JWT" \
  http://localhost:3500/api/routes/app/ACCOUNTS

# Get route by path
curl -H "Authorization: Bearer YOUR_JWT" \
  "http://localhost:3500/api/routes/path/income-statement"

# Create new route
curl -X POST -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "app_code": "ACCOUNTS",
    "level1": "Reports",
    "level2": "Financial",
    "url_path": "income-statement",
    "component_name": "IncomeStatementReport",
    "is_active": "Y",
    "route_type": "INTERNAL"
  }' \
  http://localhost:3500/api/routes

# Delete/deactivate route
curl -X DELETE -H "Authorization: Bearer YOUR_JWT" \
  http://localhost:3500/api/routes/1001
```

---

## 🔍 Debugging Checklist

### Route Not Showing in Menu?

```
Check 1: Database - Is route active?
  SELECT IS_ACTIVE, ROUTE_TYPE FROM SEC_MODULE_DATA 
  WHERE URL_PATH = 'your-path';
  ↓ Should return IS_ACTIVE='Y' and ROUTE_TYPE='INTERNAL'

Check 2: Permissions - Does user have access?
  SELECT * FROM SEC_ROLE_FUNCTION_ACCESS_USER 
  WHERE SERIAL_NO_OR_ROLE_ID = (
    SELECT SERIAL_NO FROM SEC_MODULE_DATA WHERE URL_PATH = 'your-path'
  ) AND LOGINID = 'YOUR_USER';
  ↓ Should return at least one row

Check 3: API Response - Is route in /api/routes?
  curl /api/routes (with JWT)
  ↓ Should include your route

Check 4: Menu Tree - Did frontend get the tree?
  Browser console: useAuth().permissionBasedMenuTree
  ↓ Should include your route in the tree

Check 5: Frontend - Is component registered?
  Browser console: Object.keys(componentRegistry)
  ↓ Should list 'IncomeStatementReport' or whatever COMPONENT_NAME is
```

### Type Error: Component Not in Registry?

```
Show: "Coming Soon" instead of actual component

Cause 1: COMPONENT_NAME has typo
  Database:  COMPONENT_NAME = 'IncomeStatementReport'
  Registry:  'IncomeStatementReportsss'  ← TYPO!
  ↓ Fix: Make them match exactly (case-sensitive)

Cause 2: Component not imported/registered
  componentRegistry = { 'IncomeStatementReport': ??? }
  But component never imported
  ↓ Fix: Add lazy import

Cause 3: Import path wrong
  lazy(() => import('../reports/IncomeStatementReport'))
  But file at: '../pages/reports/IncomeStatementReport'
  ↓ Fix: Correct the path

Solution:
  Browser > DevTools > Console:
  console.log(componentRegistry['IncomeStatementReport'])
  ↓ Should return component function, not undefined
```

---

## 📈 Performance Tips

```javascript
// 1. Lazy Load Components (Already Done ✓)
const CustomersReport = lazy(() => import('../pages/reports/CustomersReport'));

// 2. Memoize useDynamicRoutes Result
const flatRoutes = useMemo(
  () => useDynamicRoutes(permissionBasedMenuTree),
  [permissionBasedMenuTree]
);

// 3. Avoid Re-rendering DynamicRoutesComponent
<DynamicRoutesComponent key="routes" routes={flatRoutes} />

// 4. Monitor Bundle Size
// Check Network tab in DevTools:
// - Initial load should load main.js (~100-200KB)
// - Each route chunk should be ~20-50KB
// - Lazy load should NOT load all chunks at once

// 5. Route caching in Redux
// Routes cached until logout, no refresh needed
```

---

## 🎨 Component Name Mapping Reference

Keep this mapping file as documentation:

```typescript
// COMPONENT MAPPING GUIDE
// Use these exact component names in SEC_MODULE_DATA.COMPONENT_NAME

const COMPONENTS = {
  // Accounts/Reports
  'CustomersReport': 'pages/reports/CustomersReport.tsx',
  'SuppliersReport': 'pages/reports/SuppliersReport.tsx',
  'DivisionsReport': 'pages/reports/DivisionsReport.tsx',
  'IncomeStatementReport': 'pages/reports/IncomeStatementReport.tsx',
  
  // WMS
  'OutboundJobWmsPage': 'pages/WMS/outbound/OutboundJobWmsPage.tsx',
  'StockAgeingQuantityReport': 'pages/WMS/reports/StockAgeingQuantityReport.tsx',
  'StockSummaryReport': 'pages/WMS/reports/StockSummaryReport.tsx',
  
  // Purchase Flow
  'PurchaserequestheaderPfPage': 'pages/Purchasefolder/PurchaserequestheaderPfPage.tsx',
  'ProjectmasterPfPage': 'pages/Purchasefolder/ProjectmasterPfPage.tsx',
  
  // Security/Admin
  'SecmodulemasterWmsPage': 'pages/Security/secmodulemasterWmsPage.tsx',
  'SecrollmasterWmsPage': 'pages/Security/SecrollmasterWmsPage.tsx',
};
```

---

## ✅ Validation Queries

Run these to verify everything is working:

```sql
-- Check all new columns exist and populated
SELECT SERIAL_NO, COMPONENT_NAME, IS_ACTIVE, ROUTE_TYPE 
FROM SEC_MODULE_DATA 
WHERE COMPONENT_NAME IS NOT NULL 
LIMIT 10;

-- Check for routes without components (should be empty)
SELECT SERIAL_NO, URL_PATH, ROUTE_TYPE 
FROM SEC_MODULE_DATA 
WHERE COMPONENT_NAME IS NULL 
AND ROUTE_TYPE = 'INTERNAL';
-- ^ If any results: Add COMPONENT_NAME or change ROUTE_TYPE

-- Check permissions match routes
SELECT smd.SERIAL_NO, smd.URL_PATH, COUNT(srfau.LOGINID) 
FROM SEC_MODULE_DATA smd
LEFT JOIN SEC_ROLE_FUNCTION_ACCESS_USER srfau 
  ON smd.SERIAL_NO = srfau.SERIAL_NO_OR_ROLE_ID
GROUP BY smd.SERIAL_NO, smd.URL_PATH;
-- ^ Shows which routes have permissions

-- Check for duplicate URLs
SELECT URL_PATH, COUNT(*) 
FROM SEC_MODULE_DATA 
WHERE IS_ACTIVE = 'Y' 
GROUP BY URL_PATH 
HAVING COUNT(*) > 1;
-- ^ Should return no results (URLs must be unique)
```

---

**Quick Reference Version**: 1.0  
**Last Updated**: February 28, 2026
