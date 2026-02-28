# Dynamic Routes Implementation Guide

## Overview

This implementation allows you to manage all application routes and navigation menus from your database (`SEC_MODULE_DATA` table) instead of hard-coding them in React components.

**Benefits:**
- ✅ Add/modify/delete routes without code changes
- ✅ Control route visibility per user (via permissions)
- ✅ Mark routes as "Coming Soon" as placeholders
- ✅ Organize navigation hierarchically (Level 1, 2, 3)
- ✅ Map routes to React components dynamically
- ✅ Lazy-load components for better performance

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Security Admin UI                            │
│              (Create/Edit Routes in sec_module_data)             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Oracle Database                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ SEC_MODULE_DATA (newly extended)                          │  │
│  │ - APP_CODE, LEVEL1, LEVEL2, LEVEL3                        │  │
│  │ - URL_PATH, COMPONENT_NAME, IS_ACTIVE, ROUTE_TYPE        │  │
│  │ - DESCRIPTION, SORT_ORDER, ICON_NAME                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ SEC_ROLE_FUNCTION_ACCESS_USER (permission control)        │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Backend API                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ GET /api/routes                                           │  │
│  │ GET /api/routes/tree (hierarchical)                       │  │
│  │ GET /api/routes/app/{appCode}                             │  │
│  │ POST/PUT/DELETE /api/routes/{serialNo}                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ RoutesService (logic)                                     │  │
│  │ RoutesController (endpoints)                              │  │
│  │ RoutePermissionMiddleware (permission check)              │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ useAuth() hook → permissionBasedMenuTree                  │  │
│  │ (fetched from /api/auth/me)                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ dynamicRouteGenerator.ts                                  │  │
│  │ - flattenRoutes(): Converts tree to flat array            │  │
│  │ - buildRouteElements(): Creates React Route components    │  │
│  │ - DynamicRoutesComponent: Renders all routes              │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ componentRegistry.ts                                      │  │
│  │ Maps component names to actual React components           │  │
│  │ Example: 'CustomersReport' → <CustomersReport/>           │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ MainRoutes.tsx (updated to use dynamic routes)            │  │
│  │ Renders Routes using dynamic route generator              │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## Installation Steps

### Step 1: Database Setup

Run the migration scripts on your Oracle database:

```bash
# Option A: Using SQL*Plus
sqlplus username/password@database @database/scripts/SEC_MODULE_DATA_MIGRATION.sql
sqlplus username/password@database @database/scripts/DYNAMIC_ROUTES_SETUP.sql

# Option B: Using SQL Developer
# Open both files and execute them
```

**Files:**
- `database/scripts/SEC_MODULE_DATA_MIGRATION.sql` - Adds new columns
- `database/scripts/DYNAMIC_ROUTES_SETUP.sql` - Complete setup with examples

### Step 2: Backend Code (Already Implemented ✓)

The following files have been created/updated:

**Entity:**
- `src/entity/Security/secmodule.entity.ts` - Updated with new columns

**Interfaces & Validation:**
- `src/interfaces/Security/Security.interfae.ts` - Updated ISecmodule
- `src/validation/Security/Security.validation.ts` - Updated schema

**Services & Controllers:**
- `src/services/Security/routes.service.ts` - **NEW** Route data access
- `src/controllers/Security/routes.controller.ts` - **NEW** API endpoints
- `src/routes/Security/routes.routes.ts` - **NEW** Route definitions

**Middleware:**
- `src/middleware/routePermission.middleware.ts` - **NEW** Permission checks

**Main app:**
- `index.ts` - Updated to register routes endpoint

### Step 3: Frontend Code (Already Implemented ✓)

**New utility files:**
- `src/utils/componentRegistry.ts` - **NEW** Component mapping
- `src/utils/dynamicRouteGenerator.ts` - **NEW** Route generation logic

**New components:**
- `src/pages/extra-pages/ComingSoon.tsx` - **NEW** Placeholder for unavailable routes

**Integration Guide:**
- `src/routes/INTEGRATION_GUIDE.md` - **NEW** How to integrate into MainRoutes

### Step 4: Update MainRoutes.tsx (Manual)

This is the only file you need to manually modify. See the integration guide:

```bash
open/edit: src/routes/MainRoutes.tsx
reference: src/routes/INTEGRATION_GUIDE.md
```

**Key changes:**
1. Import `useDynamicRoutes` and `DynamicRoutesComponent`
2. Call `useDynamicRoutes(permissionBasedMenuTree)` to get all routes
3. Replace static route definitions with dynamic routes
4. Keep static fallback routes or use 404 error boundary

---

## Usage & Configuration

### Adding a New Page/Route

#### Step 1: Create the React Component

```tsx
// src/pages/reports/IncomeStatementReport.tsx
import React from 'react';

export default function IncomeStatementReport() {
  return (
    <div>
      <h1>Income Statement Report</h1>
      {/* Your component content */}
    </div>
  );
}
```

#### Step 2: Register in Frontend

Edit `src/utils/componentRegistry.ts`:

```typescript
// Add import
const IncomeStatementReport = lazy(() => import('../pages/reports/IncomeStatementReport'));

// Add to registry
const componentRegistry: ComponentRegistry = {
  // ... existing entries ...
  'IncomeStatementReport': IncomeStatementReport,
};
```

#### Step 3: Add to Database

Run the following SQL:

```sql
INSERT INTO SEC_MODULE_DATA (
  SERIAL_NO,
  COMPANY_CODE,
  APP_CODE,
  LEVEL1,
  LEVEL2,
  LEVEL3,
  URL_PATH,
  COMPONENT_NAME,
  IS_ACTIVE,
  ROUTE_TYPE,
  DESCRIPTION,
  SORT_ORDER,
  ICON_NAME,
  CREATED_BY,
  UPDATED_BY,
  CREATE_DATE,
  CREATED_AT
) VALUES (
  SEC_MODULE_DATA_SEQ.NEXTVAL,  -- Auto-generate serial number
  'DEFAULT',
  'ACCOUNTS',
  'Reports',
  'Financial',
  'Income Statement',
  'income-statement',  -- URL path
  'IncomeStatementReport',  -- Must match componentRegistry key
  'Y',  -- Is active
  'INTERNAL',  -- Route type
  'View income statement reports',
  1,  -- Sort order (1 = first)
  'ReceiptIcon',
  'ADMIN',
  'ADMIN',
  SYSDATE,
  SYSTIMESTAMP
);
COMMIT;
```

#### Step 4: Add User Permissions

```sql
-- Find the SERIAL_NO you just inserted
SELECT SERIAL_NO FROM SEC_MODULE_DATA
WHERE URL_PATH = 'income-statement';

-- Add permission for a user (example: SERIAL_NO = 1005)
INSERT INTO SEC_ROLE_FUNCTION_ACCESS_USER (
  SERIAL_NO_OR_ROLE_ID,
  LOGINID,
  COMPANY_CODE,
  SNEW, SMODIFY, SDELETE, SSAVE, SSEARCH,
  SSAVEAS, SUPLOAD, SUNDO, SPRINT, SPRINTSETUP, SHELP
) VALUES (
  1005,
  'ADMIN',
  'DEFAULT',
  'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y'
);
COMMIT;
```

#### Step 5: Done! 🎉

The route will appear automatically next time the user logs in. No code deployment needed!

---

## Database Field Reference

### SEC_MODULE_DATA Columns

| Column | Type | Required | Purpose |
|--------|------|----------|---------|
| SERIAL_NO | NUMBER | Yes | Unique identifier |
| COMPANY_CODE | VARCHAR2(20) | Yes | Customer/tenant identifier |
| APP_CODE | VARCHAR2(30) | Yes | Application code (e.g., 'ACCOUNTS', 'WMS') |
| LEVEL1 | VARCHAR2(50) | No | First menu level (e.g., 'Reports') |
| LEVEL2 | VARCHAR2(50) | No | Second menu level (e.g., 'Financial') |
| LEVEL3 | VARCHAR2(50) | No | Third menu level (e.g., 'Income Statement') |
| URL_PATH | VARCHAR2(1000) | Yes | URL fragment (e.g., 'income-statement') |
| COMPONENT_NAME | VARCHAR2(100) | No | React component key from componentRegistry |
| IS_ACTIVE | CHAR(1) | Yes (Y/N) | Controls visibility ('Y' or 'N') |
| ROUTE_TYPE | VARCHAR2(20) | Yes | 'INTERNAL', 'EXTERNAL', or 'COMING_SOON' |
| DESCRIPTION | VARCHAR2(500) | No | Help text/tooltip |
| SORT_ORDER | NUMBER(3) | No | Display order within level (lower = first) |
| ICON_NAME | VARCHAR2(100) | No | Icon identifier (for future use) |
| CREATED_BY, CREATED_AT | ... | Auto | Audit fields |
| UPDATED_BY, UPDATED_AT | ... | Auto | Audit fields |

### ROUTE_TYPE Values

- **INTERNAL**: Standard app route (renders component from registry)
- **COMING_SOON**: Placeholder (shows "Coming Soon" page)
- **EXTERNAL**: External link (uses URL_PATH as target URL)

### Permission in SEC_ROLE_FUNCTION_ACCESS_USER

The SERIAL_NO from SEC_MODULE_DATA becomes the permission identifier:

```sql
-- User has access to route with SERIAL_NO = 1005
INSERT INTO SEC_ROLE_FUNCTION_ACCESS_USER (
  SERIAL_NO_OR_ROLE_ID,  -- Reference to SEC_MODULE_DATA.SERIAL_NO
  LOGINID,               -- User login ID
  COMPANY_CODE,
  -- Permission columns (SNEW, SMODIFY, etc.)
  ...
);
```

---

## API Endpoints

### GET /api/routes
Fetch all active routes.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "serial_no": 1001,
      "app_code": "ACCOUNTS",
      "level1": "Reports",
      "level2": "Customer Reports",
      "url_path": "customers",
      "component_name": "CustomersReport",
      "route_type": "INTERNAL",
      "is_active": "Y",
      "description": "View customer reports",
      "sort_order": 1
    },
    ...
  ]
}
```

### GET /api/routes/tree
Fetch routes in hierarchical structure (for menu building).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "ACCOUNTS",
      "title": "ACCOUNTS",
      "type": "collapse",
      "children": [
        {
          "id": "ACCOUNTS_Reports",
          "title": "Reports",
          "type": "group",
          "children": [...]
        }
      ]
    }
  ]
}
```

### GET /api/routes/app/:appCode
Fetch routes for specific application.

```
GET /api/routes/app/ACCOUNTS
```

### GET /api/routes/path/:urlPath
Fetch specific route by URL path.

```
GET /api/routes/path/customers
```

### POST /api/routes
Create new route (requires admin).

```json
{
  "app_code": "ACCOUNTS",
  "level1": "Reports",
  "level2": "Financial",
  "url_path": "income-statement",
  "component_name": "IncomeStatementReport",
  "is_active": "Y",
  "route_type": "INTERNAL",
  "description": "Income statement report"
}
```

### PUT /api/routes/:serialNo
Update existing route.

### DELETE /api/routes/:serialNo
Deactivate route (soft delete).

---

## Frontend Implementation

### Using in Components

```tsx
import { useAuth } from '../hooks/useAuth';
import { useDynamicRoutes, flattenRoutes } from '../utils/dynamicRouteGenerator';

export function MyComponent() {
  const { permissionBasedMenuTree } = useAuth();
  const flatRoutes = useDynamicRoutes(permissionBasedMenuTree);
  
  // flatRoutes contains all accessible routes
  console.log(flatRoutes);
  
  return <div>{/* ... */}</div>;
}
```

### Component Registry Key Points

1. **Key must be unique** - Used to match COMPONENT_NAME in database
2. **Lazy loading** - Components are lazy-loaded for performance
3. **Fallback** - If component not found, "Coming Soon" is shown
4. **Suspense** - Automatically wrapped with loading state

### Dynamic Navigation Menu

The existing navigation component (`src/layout/MainLayout/Navigation/index.tsx`) already uses `permissionBasedMenuTree`, which is built from `SEC_MODULE_DATA`. No changes needed there!

---

## Testing Checklist

Before deploying:

- [ ] Database migration applied successfully
- [ ] New columns in SEC_MODULE_DATA verified
- [ ] Test routes inserted into database
- [ ] Backend API `/api/routes` returns data
- [ ] Backend API `/api/routes/tree` returns hierarchy
- [ ] Components registered in `componentRegistry.ts`
- [ ] User can see routes in navigation menu
- [ ] User can navigate to new routes
- [ ] Coming Soon routes show placeholder page
- [ ] Inactive routes hidden from menu
- [ ] Permissions enforced (unauthorized users can't see routes)
- [ ] Component lazy-loading works (check Network tab)
- [ ] No console errors

---

## Troubleshooting

### Routes not showing in menu
1. Check `IS_ACTIVE = 'Y'` in SEC_MODULE_DATA
2. Verify user has permission in SEC_ROLE_FUNCTION_ACCESS_USER
3. Clear browser cache and login again
4. Check backend logs: `GET /api/routes`

### Component not rendering ("Coming Soon" showing)
1. Check `COMPONENT_NAME` in database matches componentRegistry.ts exactly
2. Verify imports in componentRegistry.ts are correct
3. Run `console.log(Object.keys(componentRegistry))` in browser console
4. Check Network tab for lazy-loading errors

### Route permission denied
1. Verify SERIAL_NO match between SEC_MODULE_DATA and permission table
2. Check SEC_ROLE_FUNCTION_ACCESS_USER has the user's LOGINID
3. Ensure SNEW=Y or appropriate permissions are set
4. Run permission diagnostic: `GET /api/auth/diagnostic-permissions`

### Database columns not added
1. Run: `DESC SEC_MODULE_DATA` to check columns
2. Rerun migration script if columns missing
3. Check for SQL errors in execution logs

---

## Performance Optimization

### Database Indices
Already created during setup:
- `IDX_SEC_MODULE_ACTIVE` - For active route filtering
- `IDX_SEC_MODULE_URL_PATH` - For path lookups
- `IDX_SEC_MODULE_APP_CODE` - For app-based filtering
- `IDX_SEC_MODULE_ROUTE_TYPE` - For type filtering

### Frontend Caching
Routes are fetched via `/api/auth/me` at login and cached in Redux:
- Routes persist across page refreshes
- No need to refetch on every route change
- Clear cache manually: `localStorage.clear()` if needed

### Lazy Loading
All components are lazy-loaded to reduce initial bundle:
```typescript
const CustomersReport = lazy(() => import('../pages/reports/CustomersReport'));
```

---

## Security Considerations

1. **Permission Checks**: Backend validates user permissions before serving data
2. **JWT Authentication**: All `/api/routes` endpoints require valid JWT
3. **Tenant Isolation**: Routes filtered by tenant context
4. **Soft Deletes**: Routes marked `IS_ACTIVE='N'` instead of hard deletes
5. **Audit Trail**: CREATED_BY/UPDATED_BY track changes

---

## Future Enhancements

Possible improvements:

- [ ] Route versioning/rollback capability
- [ ] A/B testing support (show different routes to different users)
- [ ] Route performance analytics
- [ ] Bulk route import/export
- [ ] Route template library
- [ ] Visual route builder UI
- [ ] Route dependency management
- [ ] Automatic component discovery

---

## Support & Questions

For issues or questions:

1. Check the troubleshooting section above
2. Review integration guide: `src/routes/INTEGRATION_GUIDE.md`
3. Check backend logs for errors
4. Run diagnostic queries in `DYNAMIC_ROUTES_SETUP.sql`
5. Check browser console for React/frontend errors

---

## Summary of Changes

**Backend Files Created:**
- ✅ `src/services/Security/routes.service.ts`
- ✅ `src/controllers/Security/routes.controller.ts`
- ✅ `src/routes/Security/routes.routes.ts`
- ✅ `src/middleware/routePermission.middleware.ts`

**Backend Files Modified:**
- ✅ `src/entity/Security/secmodule.entity.ts`
- ✅ `src/interfaces/Security/Security.interfae.ts`
- ✅ `src/validation/Security/Security.validation.ts`
- ✅ `index.ts`

**Frontend Files Created:**
- ✅ `src/utils/componentRegistry.ts`
- ✅ `src/utils/dynamicRouteGenerator.ts`
- ✅ `src/pages/extra-pages/ComingSoon.tsx`
- ✅ `src/routes/INTEGRATION_GUIDE.md`

**Database Files Created:**
- ✅ `database/scripts/SEC_MODULE_DATA_MIGRATION.sql`
- ✅ `database/scripts/DYNAMIC_ROUTES_SETUP.sql`

**To Complete:**
- 📝 Manually update `src/routes/MainRoutes.tsx` (see Integration Guide)

---

**Implementation Date:** February 28, 2026  
**Version:** 1.0
