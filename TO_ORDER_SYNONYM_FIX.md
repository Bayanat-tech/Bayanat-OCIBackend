# TO_ORDER Synonym Fix - Summary

## Problem
The application was failing with the error:
```
ORA-00980: synonym translation is no longer valid
```

This occurred when calling the `createToOrder` endpoint.

## Root Cause Analysis
The Oracle database had a PUBLIC synonym `TO_ORDER` that was pointing to `AWARE.TO_ORDER`, but the `AWARE` schema no longer exists or is inaccessible. This caused all queries using `TO_ORDER` to fail.

### Diagnosis Results:
- **Current user schema**: CUSTOMERS
- **PUBLIC synonym target**: AWARE.TO_ORDER (BROKEN)
- **No private synonym**: CUSTOMERS schema doesn't have its own TO_ORDER synonym
- **TO_ORDER tables exist in**: ABHA, ATAJ, BTSCM, DEMO, DHLOM, ELEOM, FROZEN, KSA_DEMO, OM_DEMO, QACAN, QAJAS, RAWIND, TECHNO, TID001, TID004, TOPMOST, WMSDEV, WMSTST (each in their own schema)

The application uses a **multi-tenant architecture** where each company/tenant has its own schema, and the TO_ORDER table is schema-specific, not global.

## Solution Implemented

Modified [src/controllers/wms/transaction/outbound/createToOrder.ts](src/controllers/wms/transaction/outbound/createToOrder.ts) to:

1. **Added `getTableNameForCompany()` function** that dynamically determines the correct schema for a given company_code by:
   - Querying the TENANT_CONFIG table to find the schema mapped to the company_code
   - Falling back to using the company_code as the schema name if TENANT_CONFIG lookup fails
   - Returning the fully qualified table name (e.g., `SCHEMA_NAME.TO_ORDER`)

2. **Updated all database operations** to use the dynamic table name instead of relying on the broken public synonym:
   - `orderExists()` - SELECT queries
   - `deleteOrder()` - DELETE queries
   - `upsertOrderDetail()` - INSERT/UPDATE queries

## How It Works

When a request comes in with a `company_code`:
```javascript
{
  "company_code": "BTSCM",
  "prin_code": "...",
  "order_no": "..."
}
```

The code will:
1. Call `getTableNameForCompany("BTSCM", connection)`
2. Either:
   - Look up BTSCM in TENANT_CONFIG to get its SCHEMA_NAME
   - Or fallback to using "BTSCM" as the schema name
3. Return the fully qualified table name (e.g., `BTSCM.TO_ORDER`)
4. Use this name in all SQL queries instead of the broken `TO_ORDER` synonym

## Benefits
- ✅ Eliminates dependency on broken PUBLIC synonym
- ✅ Properly routes to the correct tenant schema based on company_code
- ✅ Works with multi-tenant architecture
- ✅ Maintains backward compatibility with existing code
- ✅ Includes proper logging for debugging

## Testing
To verify the fix is working:
1. Send a request to the createToOrder endpoint with valid company_code and order data
2. Check console logs for `[getTableNameForCompany]` entries confirming the correct schema is being used
3. The endpoint should now successfully insert/update orders without the ORA-00980 error

## Related Diagnostic Tools
Two diagnostic scripts were created to help debug similar issues:
- `diagnose-to-order.ts` - Checks TO_ORDER synonym/table status
- `fix-to-order-synonym.ts` - Attempts to recreate the synonym (alternative approach)

These can be run with:
```bash
npx ts-node diagnose-to-order.ts
npx ts-node fix-to-order-synonym.ts
```
