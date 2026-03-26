export const userPermissionQuery = `
  SELECT 
    a.COMPANY_CODE,
    a.ROLE_ID,
    a.SERIAL_NO,
    a.SNEW, a.SMODIFY, a.SDELETE, a.SSAVE, a.SSEARCH, a.SSAVEAS, 
    a.SUPLOAD, a.SUNDO, a.SPRINT, a.SPRINTSETUP, a.SHELP, 
    a.USER_DT, a.USERID, a.CREATE_USER, a.CREATE_DATE,
    b.LOGINID
FROM SEC_ROLE_APP_ACCESS a
JOIN SEC_ROLE_FUNCTION_ACCESS_USER b ON a.ROLE_ID = b.SERIAL_NO_OR_ROLE_ID
WHERE b.LOGINID = :loginid

UNION

SELECT 
    COMPANY_CODE,
    SERIAL_NO_OR_ROLE_ID AS ROLE_ID,
    SERIAL_NO_OR_ROLE_ID AS SERIAL_NO, 
    SNEW, SMODIFY, SDELETE, SSAVE, SSEARCH, SSAVEAS, 
    SUPLOAD, SUNDO, SPRINT, SPRINTSETUP, SHELP, 
    USER_DT, USERID, CREATE_USER, CREATE_DATE,
    LOGINID
FROM SEC_ROLE_FUNCTION_ACCESS_USER 
WHERE LOGINID = :loginid
  AND SERIAL_NO_OR_ROLE_ID < 90001
`;
export const permissionsListQuery = `
SELECT 
  app_code AS menu, 
  '0' AS "level", 
  0 AS serial_no, 
  app_code 
FROM SEC_MODULE_DATA 
WHERE (LTRIM(RTRIM(level1)) IS NULL OR LTRIM(RTRIM(level1)) = ' ' OR LENGTH(LTRIM(RTRIM(level1))) = 0)

UNION ALL

SELECT 
  level1 AS menu, 
  app_code AS "level", 
  serial_no, 
  app_code 
FROM SEC_MODULE_DATA 
WHERE (LTRIM(RTRIM(level1)) IS NOT NULL AND LTRIM(RTRIM(level1)) != ' ')
  AND (LTRIM(RTRIM(level2)) IS NULL OR LTRIM(RTRIM(level2)) = ' ' OR LENGTH(LTRIM(RTRIM(level2))) = 0)

UNION ALL

SELECT 
  level2 AS menu, 
  level1 AS "level", 
  serial_no, 
  app_code 
FROM SEC_MODULE_DATA 
WHERE (LTRIM(RTRIM(level2)) IS NOT NULL AND LTRIM(RTRIM(level2)) != ' ')
  AND (LTRIM(RTRIM(level3)) IS NULL OR LTRIM(RTRIM(level3)) = ' ' OR LENGTH(LTRIM(RTRIM(level3))) = 0)

UNION ALL

SELECT 
  level3 AS menu, 
  level2 AS "level", 
  serial_no, 
  app_code 
FROM SEC_MODULE_DATA 
WHERE (LTRIM(RTRIM(level3)) IS NOT NULL AND LTRIM(RTRIM(level3)) != ' ')
`;

export const getChequePaymentInvoiceDetail = `
SELECT
  inv.inv_no,
  inv.dtl_sr_no,
  inv.doc_no,
  MAX(inv.inv_date) AS inv_date,
  SUM(CASE WHEN NVL(inv.indicator_origin, 'N') IN ('N', NULL) THEN ABS(inv.lcur_amount) ELSE 0 END) AS amount,
  1 AS sign_ind,
  inv.ac_code,
  inv.company_code,
  SUM(CASE WHEN inv.indicator_origin = 'Y' THEN ABS(inv.lcur_amount) ELSE 0 END) AS inv_amt,
  ' ' AS c_curr_code,
  0.0 AS c_curr_amt,
  'N' AS c_indicator_origin,
  MAX(CASE WHEN inv.indicator_origin = 'Y' THEN inv.curr_code END) AS c_curr_code_origin,
  MAX(CASE WHEN inv.indicator_origin = 'Y' THEN inv.ex_rate END) AS c_ex_rate_origin,
  (SUM(CASE WHEN inv.indicator_origin = 'Y' THEN ABS(inv.lcur_amount) ELSE 0 END) - SUM(CASE WHEN NVL(inv.indicator_origin, 'N') IN ('N', NULL) THEN ABS(inv.lcur_amount) ELSE 0 END)) AS c_bal_amt_org,
  MAX(inv.job_no) AS job_no,
  MAX(inv.bl_no) AS bl_no,
  MAX(inv.doc_ref) AS doc_ref,
  inv.div_code
FROM TR_AC_INVDETAIL inv
WHERE inv.company_code = :company_code
  AND inv.ac_code = :ac_code
  AND inv.div_code = :div_code
  AND (TRIM(inv.doc_type) || TRIM(TO_CHAR(inv.doc_no)) || TRIM(TO_CHAR(inv.serial_no)) <> :invrsno)
GROUP BY inv.company_code, inv.ac_code, inv.inv_no, inv.div_code, inv.doc_no, inv.dtl_sr_no
HAVING (SUM(CASE WHEN inv.indicator_origin = 'Y' THEN ABS(inv.lcur_amount) ELSE 0 END) - SUM(CASE WHEN NVL(inv.indicator_origin, 'N') IN ('N', NULL) THEN ABS(inv.lcur_amount) ELSE 0 END)) > 0
`;

export const getWareHouseUtilization = `SELECT 
    C.TXN_DATE, 
    C.SITE_CODE, 
    SUM(U.PLT_NOS) AS PLT_CNT, 
    AVG(C.PLT_CAPACITY) AS CAPACITY,
    (SELECT SITE_NAME FROM MS_SITE WHERE SITE_CODE = C.SITE_CODE) AS SITE_name
FROM 
    PLT_UTIL_MAIN_CAPACITY C
LEFT JOIN 
    PLT_UTIL_MAIN U 
ON 
    C.TXN_DATE = U.TXN_DATE AND C.SITE_CODE = U.SITE_CODE
WHERE 
    C.SITE_CODE IN (:site_code)
     AND C.txn_date >= STR_TO_DATE(:start_date, '%d %b %Y')
  AND C.txn_date <= STR_TO_DATE(:end_date, '%d %b %Y')
GROUP BY 
    C.TXN_DATE, C.SITE_CODE;`;

export const getTallyProductDataQ = `
SELECT A.P_UOM,A.L_UOM,A.UPPP,B.UOM_COUNT,A.QTY_PUOM,A.QTY_LUOM,A.QUANTITY,A.PACKDET_NO
 FROM TI_PACKDET A,
 MS_PRODUCT B WHERE 
 A.PRIN_CODE =:prin_code  AND
 A.JOB_NO = :job_no AND
 A.CONTAINER_NO = :container_no AND 
 A.CLEARANCE = 'Y' AND
 A.PDA_QUANTITY = 0 AND
 A.COMPANY_CODE = B.COMPANY_CODE AND
 A.PRIN_CODE = B.PRIN_CODE AND
 A.PROD_CODE = B.PROD_CODE;`;
