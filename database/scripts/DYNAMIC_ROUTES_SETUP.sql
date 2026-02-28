-- ============================================================================
-- COMPLETE SETUP GUIDE: Dynamic Routes Implementation
-- Date: 2026-02-28
-- ============================================================================

-- ============================================================================
-- PART 1: DATABASE SCHEMA UPDATES
-- ============================================================================

-- Copy and run this section in your Oracle database client (SQL*Plus, SQLDeveloper, etc.)

-- Step 1: Verify SEC_MODULE_DATA table exists
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME = 'SEC_MODULE_DATA';

-- Step 2: Check current columns
DESC SEC_MODULE_DATA;

-- Step 3: Add new columns (from SEC_MODULE_DATA_MIGRATION.sql)
ALTER TABLE SEC_MODULE_DATA ADD (
    COMPONENT_NAME VARCHAR2(100) NULL,
    IS_ACTIVE CHAR(1) DEFAULT 'Y' NOT NULL,
    ROUTE_TYPE VARCHAR2(20) DEFAULT 'INTERNAL' NOT NULL,
    DESCRIPTION VARCHAR2(500) NULL,
    SORT_ORDER NUMBER(3) DEFAULT 999 NULL,
    ICON_NAME VARCHAR2(100) NULL
);

-- Step 4: Verify columns were added
DESC SEC_MODULE_DATA;

-- You should see these new columns:
-- COMPONENT_NAME       VARCHAR2(100)
-- IS_ACTIVE            CHAR(1)
-- ROUTE_TYPE           VARCHAR2(20)
-- DESCRIPTION          VARCHAR2(500)
-- SORT_ORDER           NUMBER(3)
-- ICON_NAME            VARCHAR2(100)

-- ============================================================================
-- PART 2: CREATE INDEX FOR BETTER PERFORMANCE
-- ============================================================================

-- These indexes will speed up queries on frequently used columns
CREATE INDEX IDX_SEC_MODULE_ACTIVE ON SEC_MODULE_DATA(IS_ACTIVE);
CREATE INDEX IDX_SEC_MODULE_URL_PATH ON SEC_MODULE_DATA(URL_PATH);
CREATE INDEX IDX_SEC_MODULE_APP_CODE ON SEC_MODULE_DATA(APP_CODE);
CREATE INDEX IDX_SEC_MODULE_ROUTE_TYPE ON SEC_MODULE_DATA(ROUTE_TYPE);

-- ============================================================================
-- PART 3: SAMPLE DATA - INSERT TEST ROUTES
-- ============================================================================

-- Before inserting, find the next SERIAL_NO
SELECT MAX(SERIAL_NO) FROM SEC_MODULE_DATA;
-- Let's assume it returns 1000, so next will be 1001

-- Insert sample routes (update SERIAL_NO if needed)
BEGIN
  INSERT INTO SEC_MODULE_DATA (
    SERIAL_NO, COMPANY_CODE, APP_CODE, LEVEL1, LEVEL2, LEVEL3,
    POSITION, URL_PATH, ICON, COMPONENT_NAME, IS_ACTIVE,
    ROUTE_TYPE, DESCRIPTION, SORT_ORDER, ICON_NAME,
    CREATED_BY, UPDATED_BY, CREATE_DATE, CREATED_AT
  ) VALUES (
    1001, 'DEFAULT', 'ACCOUNTS', 'Reports', 'Customer Reports', NULL,
    1, 'customers', NULL, 'CustomersReport', 'Y',
    'INTERNAL', 'View customer reports and details', 1, 'PeopleIcon',
    'ADMIN', 'ADMIN', SYSDATE, SYSTIMESTAMP
  );

  INSERT INTO SEC_MODULE_DATA (
    SERIAL_NO, COMPANY_CODE, APP_CODE, LEVEL1, LEVEL2, LEVEL3,
    POSITION, URL_PATH, ICON, COMPONENT_NAME, IS_ACTIVE,
    ROUTE_TYPE, DESCRIPTION, SORT_ORDER, ICON_NAME,
    CREATED_BY, UPDATED_BY, CREATE_DATE, CREATED_AT
  ) VALUES (
    1002, 'DEFAULT', 'ACCOUNTS', 'Reports', 'Supplier Reports', NULL,
    2, 'suppliers', NULL, 'SuppliersReport', 'Y',
    'INTERNAL', 'View supplier reports and details', 2, 'StorageIcon',
    'ADMIN', 'ADMIN', SYSDATE, SYSTIMESTAMP
  );

  INSERT INTO SEC_MODULE_DATA (
    SERIAL_NO, COMPANY_CODE, APP_CODE, LEVEL1, LEVEL2, LEVEL3,
    POSITION, URL_PATH, ICON, COMPONENT_NAME, IS_ACTIVE,
    ROUTE_TYPE, DESCRIPTION, SORT_ORDER, ICON_NAME,
    CREATED_BY, UPDATED_BY, CREATE_DATE, CREATED_AT
  ) VALUES (
    1003, 'DEFAULT', 'ACCOUNTS', 'Reports', 'Division Reports', NULL,
    3, 'divisions', NULL, 'DivisionsReport', 'Y',
    'INTERNAL', 'View division reports and details', 3, 'BusinessIcon',
    'ADMIN', 'ADMIN', SYSDATE, SYSTIMESTAMP
  );

  -- Mark some routes as coming soon
  INSERT INTO SEC_MODULE_DATA (
    SERIAL_NO, COMPANY_CODE, APP_CODE, LEVEL1, LEVEL2, LEVEL3,
    POSITION, URL_PATH, ICON, COMPONENT_NAME, IS_ACTIVE,
    ROUTE_TYPE, DESCRIPTION, SORT_ORDER, ICON_NAME,
    CREATED_BY, UPDATED_BY, CREATE_DATE, CREATED_AT
  ) VALUES (
    1004, 'DEFAULT', 'ACCOUNTS', 'Reports', 'Advanced Analytics', NULL,
    4, 'advanced-analytics', NULL, NULL, 'Y',
    'COMING_SOON', 'Advanced analytics on the way', 4, 'AnalyticsIcon',
    'ADMIN', 'ADMIN', SYSDATE, SYSTIMESTAMP
  );

  COMMIT;
END;
/

-- Verify inserted data
SELECT SERIAL_NO, APP_CODE, LEVEL1, LEVEL2, COMPONENT_NAME, IS_ACTIVE, ROUTE_TYPE
FROM SEC_MODULE_DATA
WHERE SERIAL_NO BETWEEN 1001 AND 1004
ORDER BY SERIAL_NO;

-- ============================================================================
-- PART 4: CREATE VIEW FOR MONITORING ROUTES
-- ============================================================================

-- This view makes it easy to see route configuration
CREATE OR REPLACE VIEW V_SEC_ACTIVE_ROUTES AS
SELECT
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
  CREATED_AT,
  UPDATED_AT
FROM SEC_MODULE_DATA
WHERE IS_ACTIVE = 'Y'
ORDER BY APP_CODE, LEVEL1, LEVEL2, LEVEL3, SORT_ORDER;

-- Query the view
SELECT * FROM V_SEC_ACTIVE_ROUTES;

-- ============================================================================
-- PART 5: ASSIGN PERMISSIONS FOR NEW ROUTES
-- ============================================================================

-- Users need permission to access new routes
-- Add entries to SEC_ROLE_FUNCTION_ACCESS_USER for your routes

-- Example: Give admin user access to new routes
INSERT INTO SEC_ROLE_FUNCTION_ACCESS_USER (
  SERIAL_NO_OR_ROLE_ID,
  LOGINID,
  COMPANY_CODE,
  SNEW, SMODIFY, SDELETE, SSAVE, SSEARCH,
  SSAVEAS, SUPLOAD, SUNDO, SPRINT, SPRINTSETUP, SHELP
) VALUES (
  1001,  -- SERIAL_NO from SEC_MODULE_DATA for CustomersReport
  'ADMIN',  -- Your admin user login ID
  'DEFAULT',
  'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y'
);

COMMIT;

-- ============================================================================
-- PART 6: UPDATE EXISTING ROUTES (OPTIONAL)
-- ============================================================================

-- Add component names to existing routes
-- Example: Update routes that already exist but don't have component names

UPDATE SEC_MODULE_DATA
SET COMPONENT_NAME = 'SecmodulemasterWmsPage'
WHERE APP_CODE = 'SECURITY'
  AND LEVEL1 = 'Request'
  AND LEVEL2 = 'sec_module_data'
  AND COMPONENT_NAME IS NULL;

UPDATE SEC_MODULE_DATA
SET COMPONENT_NAME = 'SecrollmasterWmsPage'
WHERE APP_CODE = 'SECURITY'
  AND LEVEL1 = 'Request'
  AND LEVEL2 = 'role_master'
  AND COMPONENT_NAME IS NULL;

COMMIT;

-- ============================================================================
-- PART 7: BULK UPDATE - ACTIVATE ALL ROUTES
-- ============================================================================

-- If you inherited routes without IS_ACTIVE set:
UPDATE SEC_MODULE_DATA
SET IS_ACTIVE = 'Y'
WHERE IS_ACTIVE IS NULL;

COMMIT;

-- ============================================================================
-- PART 8: VALIDATION QUERIES
-- ============================================================================

-- Check for routes without components
SELECT SERIAL_NO, APP_CODE, LEVEL1, LEVEL2, URL_PATH
FROM SEC_MODULE_DATA
WHERE COMPONENT_NAME IS NULL
  AND IS_ACTIVE = 'Y'
  AND ROUTE_TYPE = 'INTERNAL';

-- Check for duplicate URL_PATH
SELECT URL_PATH, COUNT(*) as cnt
FROM SEC_MODULE_DATA
WHERE IS_ACTIVE = 'Y'
GROUP BY URL_PATH
HAVING COUNT(*) > 1;

-- Check routes by type
SELECT ROUTE_TYPE, IS_ACTIVE, COUNT(*) as cnt
FROM SEC_MODULE_DATA
GROUP BY ROUTE_TYPE, IS_ACTIVE
ORDER BY ROUTE_TYPE, IS_ACTIVE;

-- Check route statistics
SELECT
  (SELECT COUNT(*) FROM SEC_MODULE_DATA WHERE IS_ACTIVE = 'Y') as ACTIVE_ROUTES,
  (SELECT COUNT(*) FROM SEC_MODULE_DATA WHERE IS_ACTIVE = 'N') as INACTIVE_ROUTES,
  (SELECT COUNT(*) FROM SEC_MODULE_DATA WHERE ROUTE_TYPE = 'COMING_SOON') as COMING_SOON,
  (SELECT COUNT(*) FROM SEC_MODULE_DATA WHERE COMPONENT_NAME IS NULL) as NO_COMPONENT
FROM DUAL;

-- ============================================================================
-- PART 9: BACKUP & EXPORT
-- ============================================================================

-- Backup current configuration
CREATE TABLE SEC_MODULE_DATA_BACKUP AS
SELECT * FROM SEC_MODULE_DATA
WHERE CREATED_AT >= SYSDATE - 7;  -- Last 7 days

-- Export all routes for external storage
SELECT TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD HH24:MI:SS') as EXPORT_DATE,
       SERIAL_NO,
       APP_CODE,
       LEVEL1,
       LEVEL2,
       LEVEL3,
       URL_PATH,
       COMPONENT_NAME,
       IS_ACTIVE,
       ROUTE_TYPE,
       DESCRIPTION
FROM SEC_MODULE_DATA
ORDER BY APP_CODE, LEVEL1, LEVEL2, LEVEL3;

-- ============================================================================
-- PART 10: CLEANUP & MAINTENANCE
-- ============================================================================

-- Remove duplicate inactive routes (optional)
DELETE FROM SEC_MODULE_DATA
WHERE IS_ACTIVE = 'N'
  AND UPDATED_AT < SYSDATE - 90;  -- Older than 90 days

-- COMMIT;  -- Uncomment only if you're sure

-- Set default sort order
UPDATE SEC_MODULE_DATA
SET SORT_ORDER = ROWNUM
WHERE SORT_ORDER IS NULL;

COMMIT;

-- ============================================================================
-- TROUBLESHOOTING SQL QUERIES
-- ============================================================================

-- Find routes for a specific user
SELECT DISTINCT smd.SERIAL_NO, smd.URL_PATH, smd.COMPONENT_NAME
FROM SEC_MODULE_DATA smd
JOIN SEC_ROLE_FUNCTION_ACCESS_USER srfau
  ON smd.SERIAL_NO = srfau.SERIAL_NO_OR_ROLE_ID
WHERE srfau.LOGINID = 'YOUR_LOGIN_ID'
  AND smd.IS_ACTIVE = 'Y';

-- Find broken routes (component not in registry)
-- This requires frontend to tell you which components are available
SELECT SERIAL_NO, URL_PATH, COMPONENT_NAME, DESCRIPTION
FROM SEC_MODULE_DATA
WHERE COMPONENT_NAME IS NOT NULL
  AND ROUTE_TYPE = 'INTERNAL'
  AND IS_ACTIVE = 'Y'
  AND COMPONENT_NAME NOT IN (
    -- Add your actual component names here
    'CustomersReport',
    'SuppliersReport',
    'DivisionsReport'
  );

-- ============================================================================
-- AUTOMATION: TRIGGER TO AUTO-UPDATE TIMESTAMP (OPTIONAL)
-- ============================================================================

CREATE OR REPLACE TRIGGER TRG_SEC_MODULE_DATA_UPDATE
BEFORE UPDATE ON SEC_MODULE_DATA
FOR EACH ROW
BEGIN
  :NEW.UPDATED_AT := SYSTIMESTAMP;
END;
/

-- ============================================================================
-- NOTES
-- ============================================================================

/*
1. COMPONENT_NAME must match exactly what's in componentRegistry.ts frontend
2. URL_PATH should be unique and URL-safe (no spaces, use hyphens)
3. IS_ACTIVE controls visibility - set to 'N' to hide routes
4. ROUTE_TYPE: 'INTERNAL' = rendered component, 'COMING_SOON' = placeholder, 'EXTERNAL' = link
5. SORT_ORDER controls display order (lower = appears first)
6. Always backup before making mass updates
7. Test with a non-admin user to verify permissions
8. Monitor sec_module_data table with the V_SEC_ACTIVE_ROUTES view
9. Keep component names consistent across database and frontend
10. Document any custom routes for other developers
*/
