# Dynamic Routes Implementation - Quick Checklist

## ✅ Pre-Implementation Verification

- [ ] Read `DYNAMIC_ROUTES_README.md` - Understand the architecture
- [ ] Read `IMPLEMENTATION_SUMMARY.md` - Know what's been created
- [ ] Locate all database scripts in `database/scripts/`
- [ ] Backup current database

---

## 📋 Phase 1: Database Setup (SQL Client Required)

Run these scripts on your Oracle database:

### Step 1.1: Run Migration Script
```
File: database/scripts/SEC_MODULE_DATA_MIGRATION.sql
```
- [ ] Execute SEC_MODULE_DATA_MIGRATION.sql
- [ ] Check for errors (should see no errors)
- [ ] Verify all 6 columns added: `DESC SEC_MODULE_DATA;`

### Step 1.2: Run Setup Script
```
File: database/scripts/DYNAMIC_ROUTES_SETUP.sql
```
- [ ] Execute parts of DYNAMIC_ROUTES_SETUP.sql (it's commented and segmented)
- [ ] Create indices (Part 3)
- [ ] Insert sample data (Part 4) - OPTIONAL
- [ ] Create helper view (Part 5)
- [ ] Run validation queries (Part 8)

### Step 1.3: Verify Database Setup
```sql
DESC SEC_MODULE_DATA;  -- Should show 6 new columns
SELECT * FROM V_SEC_ACTIVE_ROUTES;  -- Should return routes
```
- [ ] All new columns present
- [ ] Sample routes visible
- [ ] Indices created successfully

---

## 🔧 Phase 2: Backend Verification (No Changes Needed)

All backend code is already in place. Just verify:

### Step 2.1: Verify Files Exist
- [ ] `src/services/Security/routes.service.ts` - EXISTS
- [ ] `src/controllers/Security/routes.controller.ts` - EXISTS
- [ ] `src/routes/Security/routes.routes.ts` - EXISTS
- [ ] `src/middleware/routePermission.middleware.ts` - EXISTS

### Step 2.2: Verify Files Modified
- [ ] `src/entity/Security/secmodule.entity.ts` - UPDATED ✓
- [ ] `src/interfaces/Security/Security.interfae.ts` - UPDATED ✓
- [ ] `src/validation/Security/Security.validation.ts` - UPDATED ✓
- [ ] `index.ts` - UPDATED ✓

### Step 2.3: Test Backend Endpoints
```bash
# After starting backend server:
curl http://localhost:3500/health
# Should return success

# Test routes endpoint (need valid JWT):
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3500/api/routes
# Should return array of routes
```
- [ ] Backend server starts without errors
- [ ] `/health` endpoint responds
- [ ] `/api/routes` endpoint accessible with JWT
- [ ] Server logs show no errors

---

## 🎨 Phase 3: Frontend Component Registration

### Step 3.1: Identify All Components
List all React components that will be menu items:
- [ ] List created (at least 3 test components)

### Step 3.2: Update Component Registry
```
File: src/utils/componentRegistry.ts
```
For each component:
1. [ ] Add lazy import: `const MyComponent = lazy(() => import('...'))`
2. [ ] Add to registry: `'MyComponent': MyComponent,`
3. [ ] Note the key (must match COMPONENT_NAME in database)

Example:
```typescript
const CustomersReport = lazy(() => import('../pages/reports/CustomersReport'));

const componentRegistry: ComponentRegistry = {
  'CustomersReport': CustomersReport,  // ← Key is important!
  // ... more components
};
```

### Step 3.3: Verify Component Registry
```javascript
// In browser console after login:
import componentRegistry from '../utils/componentRegistry';
console.log(Object.keys(componentRegistry));
// Should list all your components
```
- [ ] All components logged without errors
- [ ] At least 5 components registered
- [ ] No duplicate keys

---

## 🛣️ Phase 4: Update MainRoutes (Manual - Most Important!)

### Step 4.1: Read Integration Guide
```
File: src/routes/INTEGRATION_GUIDE.md
```
- [ ] Read entire guide
- [ ] Understand what "Before" vs "After" means
- [ ] Understand flattenRoutes concept

### Step 4.2: Update MainRoutes.tsx
```
File: src/routes/MainRoutes.tsx
```

**Option A: Gradual Migration (Recommended)**
1. [ ] Add imports for dynamic route utilities
2. [ ] Add `useDynamicRoutes` hook
3. [ ] Keep existing static routes
4. [ ] Add dynamic routes on top
5. [ ] Test both work together
6. [ ] Remove static routes later

**Option B: Full Replace (If You're Confident)**
1. [ ] Backup original MainRoutes.tsx
2. [ ] Replace entire file with dynamic approach
3. [ ] Thoroughly test all routes

**Key Changes:**
```typescript
// Add imports
import { useDynamicRoutes, DynamicRoutesComponent } from '../utils/dynamicRouteGenerator';
import { useAuth } from '../hooks/useAuth';

// In component
const { permissionBasedMenuTree } = useAuth();
const flatRoutes = useDynamicRoutes(permissionBasedMenuTree);

// In JSX
<DynamicRoutesComponent routes={flatRoutes} />
```

- [ ] Imports added
- [ ] useAuth hook called
- [ ] useDynamicRoutes hook called
- [ ] DynamicRoutesComponent rendered
- [ ] No console errors

---

## 🧪 Phase 5: Testing

### Step 5.1: Basic Route Tests
- [ ] Server starts without errors
- [ ] Login works
- [ ] Logout works
- [ ] Navigation menu appears

### Step 5.2: Dynamic Routes Tests
- [ ] New routes appear in menu
- [ ] Can click routes and navigate
- [ ] Components render correctly
- [ ] No "Coming Soon" unless expected

### Step 5.3: Permission Tests
- [ ] Admin sees all routes
- [ ] Regular user sees only permitted routes
- [ ] Hidden routes not visible
- [ ] Inactive routes (IS_ACTIVE='N') not shown

### Step 5.4: Component Tests
- [ ] All components lazy-load correctly
- [ ] Loading spinner shows briefly
- [ ] No console errors during load
- [ ] Unknown components show "Coming Soon"

### Step 5.5: Database Tests
- [ ] Add new route to SEC_MODULE_DATA
- [ ] Grant permission to test user
- [ ] User logs out and back in
- [ ] New route appears in menu ✓

### Step 5.6: Error Handling Tests
- [ ] Inactive route doesn't show
- [ ] Coming Soon route shows placeholder
- [ ] Unregistered component shows error
- [ ] Missing permission shows nothing

---

## 📊 Phase 6: Data Migration (Add Your Routes)

### Step 6.1: List Existing Routes
Get all routes from your current MainRoutes.tsx

### Step 6.2: Generate INSERT Statements
For each route, create SQL:
```sql
INSERT INTO SEC_MODULE_DATA (
  SERIAL_NO, COMPANY_CODE, APP_CODE, LEVEL1, LEVEL2, LEVEL3,
  URL_PATH, COMPONENT_NAME, IS_ACTIVE, ROUTE_TYPE,
  DESCRIPTION, SORT_ORDER,
  CREATED_BY, UPDATED_BY, CREATE_DATE, CREATED_AT
) VALUES (
  SEC_MODULE_DATA_SEQ.NEXTVAL,
  'DEFAULT',
  'APP_CODE',
  'Level1',
  'Level2',
  'Level3',
  'url-path',
  'ComponentName',  -- Must match componentRegistry key
  'Y',
  'INTERNAL',
  'Description of route',
  1,
  'ADMIN', 'ADMIN', SYSDATE, SYSTIMESTAMP
);
```

- [ ] Reviewed all existing routes
- [ ] Mapped routes to components
- [ ] Created INSERT statements
- [ ] Executed INSERTs successfully

### Step 6.3: Add Permissions
For each user/role that needs access:
```sql
INSERT INTO SEC_ROLE_FUNCTION_ACCESS_USER (
  SERIAL_NO_OR_ROLE_ID, LOGINID, COMPANY_CODE,
  SNEW, SMODIFY, SDELETE, SSAVE, SSEARCH,
  SSAVEAS, SUPLOAD, SUNDO, SPRINT, SPRINTSETUP, SHELP
) VALUES (
  SERIAL_NO_FROM_STEP_6_2,
  'USER_LOGIN',
  'DEFAULT',
  'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y'
);
```

- [ ] Created permission entries
- [ ] Covered all user roles
- [ ] Permission serial numbers match SEC_MODULE_DATA

---

## 🚀 Phase 7: Deployment Checklist

### Before Going Live
- [ ] All 3 SQL scripts executed successfully
- [ ] All 8 backend files in place
- [ ] All 4 frontend files in place
- [ ] Component registry has all components
- [ ] MainRoutes.tsx updated
- [ ] Local testing completed
- [ ] No console errors
- [ ] Permissions test passed

### Deployment Steps
1. [ ] Backup database
2. [ ] Deploy backend code
3. [ ] Deploy frontend code
4. [ ] Run database scripts
5. [ ] Clear backend cache/restart
6. [ ] Clear frontend cache (localStorage)
7. [ ] Test in production environment

### Post-Deployment
- [ ] Both web and API servers running
- [ ] Users can login
- [ ] Routes visible in menu
- [ ] Routes are clickable
- [ ] Components render
- [ ] No errors in logs

---

## 📞 Troubleshooting Checklist

### Routes Not Showing
- [ ] Check `IS_ACTIVE = 'Y'` in database
- [ ] Check user has permission entry
- [ ] Clear browser cache: `Ctrl+Shift+Delete`
- [ ] Logout and login again
- [ ] Check `/api/routes` API response
- [ ] Check browser console for errors

### Component Shows "Coming Soon"
- [ ] Check COMPONENT_NAME in database
- [ ] Check componentRegistry.ts for that key
- [ ] Fix spelling/capitalization
- [ ] Check browser console: `console.log(componentRegistry)`
- [ ] Verify import path in componentRegistry
- [ ] Check Network tab for import errors

### Backend Error on /api/routes
- [ ] Check JWT token is valid
- [ ] Check database connection working
- [ ] Check SEC_MODULE_DATA has correct columns
- [ ] Check backend logs for SQL errors
- [ ] Verify tenantContext middleware applied
- [ ] Test with `/health` endpoint first

### Database Issues
- [ ] Run: `DESC SEC_MODULE_DATA;` to verify columns
- [ ] Check no SQL errors in migration log
- [ ] Check SERIAL_NO not null for inserts
- [ ] Ensure AUTO_INCREMENT/SEQUENCE working
- [ ] Run diagnostic queries from SETUP.sql

---

## 📚 Documentation Reference

| Document | Purpose |
|----------|---------|
| DYNAMIC_ROUTES_README.md | Complete user guide |
| IMPLEMENTATION_SUMMARY.md | Overview of all changes |
| INTEGRATION_GUIDE.md | Frontend integration steps |
| SEC_MODULE_DATA_MIGRATION.sql | DB schema changes |
| DYNAMIC_ROUTES_SETUP.sql | SQL setup & examples |

---

## ✨ Success Checklist

You'll know it's working when:

- [ ] ✅ Routes appear in navigation menu
- [ ] ✅ Click route → component renders
- [ ] ✅ Add new route to DB → appears next login
- [ ] ✅ Inactive routes hidden
- [ ] ✅ Permissions enforced
- [ ] ✅ No "Coming Soon" unless expected
- [ ] ✅ No console errors
- [ ] ✅ Lazy loading works (Network tab shows chunks)

---

## 🎉 Next Steps After Completion

1. **Document Your Setup**
   - Document component names you used
   - Document app codes and hierarchies
   - Create runbook for adding new routes

2. **Train Users/Admins**
   - How to add new routes (database)
   - How to manage permissions
   - Security considerations

3. **Monitor**
   - Watch for errors in logs
   - Monitor performance
   - Collect user feedback

4. **Enhance**
   - Build admin UI for route management
   - Add analytics
   - Implement versioning

---

**Estimated Time**: 2-4 hours for complete setup  
**Difficulty Level**: Medium (requires database + backend + frontend work)  
**Support Level**: Fully documented with examples  

Good luck! 🚀
