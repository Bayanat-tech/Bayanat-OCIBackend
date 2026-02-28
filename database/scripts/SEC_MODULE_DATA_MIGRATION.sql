-- ============================================================================
-- SEC_MODULE_DATA Migration Script
-- Purpose: Add new columns to support dynamic routes and component mapping
-- Date: 2026-02-28
-- ============================================================================

-- 1. Add COMPONENT_NAME column
-- This column maps to React component identifiers for dynamic route rendering
ALTER TABLE SEC_MODULE_DATA ADD (
    COMPONENT_NAME VARCHAR2(100) NULL
);

COMMENT ON COLUMN SEC_MODULE_DATA.COMPONENT_NAME IS 'React component identifier for dynamic rendering (e.g., CustomersReport, SuppliersReport)';

-- 2. Add IS_ACTIVE column
-- Controls whether a route is visible and accessible
ALTER TABLE SEC_MODULE_DATA ADD (
    IS_ACTIVE CHAR(1) DEFAULT 'Y' NOT NULL
);

COMMENT ON COLUMN SEC_MODULE_DATA.IS_ACTIVE IS 'Y/N: Controls if this module/route is visible and accessible to users';

-- 3. Add ROUTE_TYPE column
-- Distinguishes between menu items, direct routes, and external links
ALTER TABLE SEC_MODULE_DATA ADD (
    ROUTE_TYPE VARCHAR2(20) DEFAULT 'INTERNAL' NOT NULL
);

COMMENT ON COLUMN SEC_MODULE_DATA.ROUTE_TYPE IS 'INTERNAL, EXTERNAL, or COMING_SOON';

-- 4. Add DESCRIPTION column
-- For UI labels and help text
ALTER TABLE SEC_MODULE_DATA ADD (
    DESCRIPTION VARCHAR2(500) NULL
);

COMMENT ON COLUMN SEC_MODULE_DATA.DESCRIPTION IS 'Description or help text for this module';

-- 5. Add SORT_ORDER column
-- For controlling display order within a level
ALTER TABLE SEC_MODULE_DATA ADD (
    SORT_ORDER NUMBER(3) DEFAULT 999 NULL
);

COMMENT ON COLUMN SEC_MODULE_DATA.SORT_ORDER IS 'Sorting order for display (lower numbers first)';

-- 6. Add ICON_NAME column
-- For custom icons per module (optional, for future use)
ALTER TABLE SEC_MODULE_DATA ADD (
    ICON_NAME VARCHAR2(100) NULL
);

COMMENT ON COLUMN SEC_MODULE_DATA.ICON_NAME IS 'Icon identifier for frontend (e.g., DashboardIcon, ReportIcon)';

-- ============================================================================
-- Example Data: How to set COMPONENT_NAME for existing modules
-- ============================================================================

-- Update existing modules with component mappings (example)
-- Uncomment and adjust based on your actual component names

/*
UPDATE SEC_MODULE_DATA 
SET COMPONENT_NAME = 'CustomersReport'
WHERE APP_CODE = 'ACCOUNTS' AND LEVEL2 = 'CUSTOMERS';

UPDATE SEC_MODULE_DATA 
SET COMPONENT_NAME = 'SuppliersReport'
WHERE APP_CODE = 'ACCOUNTS' AND LEVEL2 = 'SUPPLIERS';

UPDATE SEC_MODULE_DATA 
SET COMPONENT_NAME = 'DivisionsReport'
WHERE APP_CODE = 'ACCOUNTS' AND LEVEL2 = 'DIVISIONS';

-- Mark coming soon items
UPDATE SEC_MODULE_DATA 
SET ROUTE_TYPE = 'COMING_SOON'
WHERE COMPONENT_NAME IS NULL AND URL_PATH IS NOT NULL;

COMMIT;
*/

-- ============================================================================
-- How to use the new columns in the security UI
-- ============================================================================
/*

1. COMPONENT_NAME:
   - User enters: 'CustomersReport', 'SuppliersReport', etc.
   - Frontend uses this key to import the component
   - If not found in registry, renders "Coming Soon"

2. IS_ACTIVE:
   - User toggles Y/N in the form
   - Backend filters out 'N' records when fetching routes
   - Allows hiding routes without deleting data

3. ROUTE_TYPE:
   - INTERNAL: Standard app routes (rendered from componentMap)
   - EXTERNAL: Links to external URLs (uses URL_PATH as target)
   - COMING_SOON: Placeholder routes (shows "Coming Soon" page)

4. SORT_ORDER:
   - Controls menu order within the same level
   - Lower numbers appear first
   - Default 999 puts unsorted items at the end

5. DESCRIPTION:
   - Help text shown on hover or in admin UI
   - Optional, for UX enhancement

6. ICON_NAME:
   - Icons to display next to menu items
   - Frontend icon registry maps names to actual icons
*/

-- ============================================================================
-- Sample INSERT statement for new navigation items
-- ============================================================================

/*
INSERT INTO SEC_MODULE_DATA (
    SERIAL_NO,
    COMPANY_CODE,
    APP_CODE,
    LEVEL1,
    LEVEL2,
    LEVEL3,
    POSITION,
    URL_PATH,
    ICON,
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
    SEC_MODULE_DATA_SEQ.NEXTVAL,
    'DEFAULT',
    'ACCOUNTS',
    'Reports',
    'Financial',
    'Income Statement',
    1,
    'income-statement',
    NULL,
    'IncomeStatementReport',
    'Y',
    'INTERNAL',
    'View income statement reports',
    1,
    'ReceiptIcon',
    'ADMIN',
    'ADMIN',
    SYSDATE,
    SYSTIMESTAMP
);

COMMIT;
*/
