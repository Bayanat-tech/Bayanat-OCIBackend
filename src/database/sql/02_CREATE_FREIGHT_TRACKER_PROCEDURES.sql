-- =============================================================================
-- SCRIPT: 02_CREATE_FREIGHT_TRACKER_PROCEDURES.sql
-- PURPOSE: Core Stored Procedures for Freight Tracker driven by MS_APPROVER_LEVELS
-- SCHEMA: WMSTST
-- =============================================================================

SET DEFINE OFF;

-- -----------------------------------------------------------------------------
-- 1. PROC_TRK_SHIPMENT_INIT
-- Initializes tracking record & spawns only tasks defined in MS_APPROVER_LEVELS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE WMSTST.PROC_TRK_SHIPMENT_INIT (
    p_company_code IN VARCHAR2,
    p_prin_code    IN VARCHAR2,
    p_job_no       IN VARCHAR2,
    p_user_id      IN VARCHAR2
) AS
    v_bl_number       VARCHAR2(100);
    v_invoice_number  VARCHAR2(100);
    v_eta             DATE;
    v_job_type        VARCHAR2(20);
    v_job_flag        VARCHAR2(10);
    v_shipment_type   VARCHAR2(20) := 'IMPORT';
    v_is_cfs          CHAR(1)      := 'N';
    v_start_stage     VARCHAR2(30) := 'FFD_REVIEW';
    v_flow_code       VARCHAR2(30) := 'NORMAL_IMPORT';
    v_last_level      NUMBER := 4;
    v_l1_role         VARCHAR2(50);
    v_l2_role         VARCHAR2(50);
    v_l3_role         VARCHAR2(50);
    v_l4_role         VARCHAR2(50);
    v_l5_role         VARCHAR2(50);
    v_l6_role         VARCHAR2(50);
    v_l7_role         VARCHAR2(50);
BEGIN
    -- 1. Read master job metadata from TI_JOB
    BEGIN
        SELECT DOC_REF, DOC_REF2, ETA, NVL(JOB_TYPE, 'IMP'), NVL(JOB_FLAG, 'M')
          INTO v_bl_number, v_invoice_number, v_eta, v_job_type, v_job_flag
          FROM WMSTST.TI_JOB
         WHERE COMPANY_CODE = p_company_code
           AND PRIN_CODE    = p_prin_code
           AND JOB_NO       = p_job_no;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20001, 'Job not found in TI_JOB: ' || p_job_no);
    END;

    -- Check if this is a CFS Transfer Job
    IF v_job_flag = 'C' OR UPPER(v_job_type) = 'CFS' THEN
        v_is_cfs      := 'Y';
        v_flow_code   := 'CFS_TRANSFER';
        v_start_stage := 'IN_PROGRESS'; -- CFS skips CUSTOMER and FFD_REVIEW
    END IF;

    IF v_job_type IN ('EXP', 'REX') THEN
        v_shipment_type := 'EXPORT';
    ELSIF v_job_type IN ('RIMP', 'REXP') THEN
        v_shipment_type := 'LAND_IMPORT';
    ELSIF v_job_type IN ('AIMP', 'AEXP') THEN
        v_shipment_type := 'AIR_IMPORT';
    ELSE
        v_shipment_type := 'IMPORT';
    END IF;

    -- 2. Upsert TRK_SHIPMENT Header
    MERGE INTO WMSTST.TRK_SHIPMENT t
    USING (
        SELECT p_company_code   AS COMPANY_CODE,
               p_prin_code      AS PRIN_CODE,
               p_job_no         AS JOB_NO,
               v_bl_number      AS BL_NUMBER,
               v_invoice_number AS INVOICE_NUMBER,
               v_shipment_type  AS SHIPMENT_TYPE,
               v_start_stage    AS CURRENT_STAGE,
               v_eta            AS ETA_AT_PORT,
               p_user_id        AS USER_ID
          FROM DUAL
    ) s
    ON (t.COMPANY_CODE = s.COMPANY_CODE AND t.PRIN_CODE = s.PRIN_CODE AND t.JOB_NO = s.JOB_NO)
    WHEN MATCHED THEN
        UPDATE SET t.BL_NUMBER      = NVL(s.BL_NUMBER, t.BL_NUMBER),
                   t.INVOICE_NUMBER = NVL(s.INVOICE_NUMBER, t.INVOICE_NUMBER),
                   t.ETA_AT_PORT    = NVL(s.ETA_AT_PORT, t.ETA_AT_PORT),
                   t.UPDATED_BY     = s.USER_ID,
                   t.UPDATED_DT     = SYSDATE
    WHEN NOT MATCHED THEN
        INSERT (COMPANY_CODE, PRIN_CODE, JOB_NO, BL_NUMBER, INVOICE_NUMBER, SHIPMENT_TYPE, CURRENT_STAGE, ETA_AT_PORT, CREATED_BY, CREATED_DT, UPDATED_BY, UPDATED_DT)
        VALUES (s.COMPANY_CODE, s.PRIN_CODE, s.JOB_NO, s.BL_NUMBER, s.INVOICE_NUMBER, s.SHIPMENT_TYPE, s.CURRENT_STAGE, s.ETA_AT_PORT, s.USER_ID, SYSDATE, s.USER_ID, SYSDATE);

    -- 3. Read configured roles from MS_APPROVER_LEVELS
    BEGIN
        SELECT NVL(LAST_LEVEL, 4),
               LEVEL1_ROLE, LEVEL2_ROLE, LEVEL3_ROLE, LEVEL4_ROLE, LEVEL5_ROLE, LEVEL6_ROLE, LEVEL7_ROLE
          INTO v_last_level,
               v_l1_role, v_l2_role, v_l3_role, v_l4_role, v_l5_role, v_l6_role, v_l7_role
          FROM WMSTST.MS_APPROVER_LEVELS
         WHERE COMPANY_CODE = p_company_code
           AND PROCESS      = 'FREIGHT_TRACKER'
           AND FLOW_CODE    = v_flow_code;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_last_level := 4;
            v_l1_role := 'FFD_TEAM'; v_l2_role := 'PRO_TEAM'; v_l3_role := 'BAYAN_TEAM'; v_l4_role := 'SHIPPING_LINE';
    END;

    -- 4. Spawn Dynamic Operational Tasks based on Flow Type
    IF v_is_cfs = 'Y' THEN
        -- -------------------------------------------------------------------------
        -- CFS FLOW:
        -- Pre-seed PERMIT, BAYAN, DO as COMPLETED silently.
        -- Open CCRO immediately — the only task CFS works.
        -- -------------------------------------------------------------------------
        FOR cfs_pre IN (
            SELECT 1 AS LVL, 'PERMIT' AS TASK_TYPE, 'PRO_TEAM' AS ASSIGNED_TEAM FROM DUAL UNION ALL
            SELECT 2,        'BAYAN',               'BAYAN_TEAM'                FROM DUAL UNION ALL
            SELECT 3,        'DO',                  'SHIPPING_LINE'             FROM DUAL
        ) LOOP
            MERGE INTO WMSTST.TRK_SHIPMENT_TASKS dst
            USING (
                SELECT p_company_code AS COMPANY_CODE, p_prin_code AS PRIN_CODE, p_job_no AS JOB_NO, cfs_pre.LVL AS FLOW_LEVEL, cfs_pre.TASK_TYPE AS TASK_TYPE, cfs_pre.ASSIGNED_TEAM AS ASSIGNED_TEAM FROM DUAL
            ) src
            ON (dst.COMPANY_CODE = src.COMPANY_CODE AND dst.PRIN_CODE = src.PRIN_CODE AND dst.JOB_NO = src.JOB_NO AND dst.TASK_TYPE = src.TASK_TYPE)
            WHEN NOT MATCHED THEN
                INSERT (TASK_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, FLOW_LEVEL, TASK_TYPE, ASSIGNED_TEAM, STATUS, COMPLETED_BY, COMPLETED_DT, CREATED_BY, CREATED_DT)
                VALUES (RAWTOHEX(SYS_GUID()), src.COMPANY_CODE, src.PRIN_CODE, src.JOB_NO, src.FLOW_LEVEL, src.TASK_TYPE, src.ASSIGNED_TEAM, 'COMPLETED', 'SYSTEM_CFS', SYSDATE, p_user_id, SYSDATE);
        END LOOP;

        -- Open CCRO Task immediately
        MERGE INTO WMSTST.TRK_SHIPMENT_TASKS dst
        USING (
            SELECT p_company_code AS COMPANY_CODE, p_prin_code AS PRIN_CODE, p_job_no AS JOB_NO, 1 AS FLOW_LEVEL, 'CCRO' AS TASK_TYPE, NVL(v_l1_role, 'ROP_TEAM') AS ASSIGNED_TEAM FROM DUAL
        ) src
        ON (dst.COMPANY_CODE = src.COMPANY_CODE AND dst.PRIN_CODE = src.PRIN_CODE AND dst.JOB_NO = src.JOB_NO AND dst.TASK_TYPE = src.TASK_TYPE)
        WHEN NOT MATCHED THEN
            INSERT (TASK_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, FLOW_LEVEL, TASK_TYPE, ASSIGNED_TEAM, STATUS, DUE_AT, CREATED_BY, CREATED_DT)
            VALUES (RAWTOHEX(SYS_GUID()), src.COMPANY_CODE, src.PRIN_CODE, src.JOB_NO, src.FLOW_LEVEL, src.TASK_TYPE, src.ASSIGNED_TEAM, 'IN_PROGRESS', SYSDATE + 1, p_user_id, SYSDATE);

    ELSE
        -- -------------------------------------------------------------------------
        -- NORMAL FLOW (Import / Export / Land / Air):
        -- Spawn only up to v_last_level defined in MS_APPROVER_LEVELS
        -- -------------------------------------------------------------------------
        FOR task_cfg IN (
            SELECT 1 AS LVL, 'FFD_REVIEW' AS TASK_TYPE, v_l1_role AS ROLE_DESC FROM DUAL WHERE v_last_level >= 1 AND v_l1_role IS NOT NULL UNION ALL
            SELECT 2,        'PERMIT',                  v_l2_role               FROM DUAL WHERE v_last_level >= 2 AND v_l2_role IS NOT NULL UNION ALL
            SELECT 3,        'BAYAN',                   v_l3_role               FROM DUAL WHERE v_last_level >= 3 AND v_l3_role IS NOT NULL UNION ALL
            SELECT 4,        'DO',                      v_l4_role               FROM DUAL WHERE v_last_level >= 4 AND v_l4_role IS NOT NULL UNION ALL
            SELECT 5,        'CCRO',                    v_l5_role               FROM DUAL WHERE v_last_level >= 5 AND v_l5_role IS NOT NULL UNION ALL
            SELECT 6,        'TRANSPORT',               v_l6_role               FROM DUAL WHERE v_last_level >= 6 AND v_l6_role IS NOT NULL UNION ALL
            SELECT 7,        'DC_OFFLOAD',              v_l7_role               FROM DUAL WHERE v_last_level >= 7 AND v_l7_role IS NOT NULL
        ) LOOP
            MERGE INTO WMSTST.TRK_SHIPMENT_TASKS dst
            USING (
                SELECT p_company_code AS COMPANY_CODE,
                       p_prin_code    AS PRIN_CODE,
                       p_job_no       AS JOB_NO,
                       task_cfg.LVL   AS FLOW_LEVEL,
                       task_cfg.TASK_TYPE AS TASK_TYPE,
                       task_cfg.ROLE_DESC AS ASSIGNED_TEAM,
                       SYSDATE + (task_cfg.LVL * 0.5) AS DUE_AT,
                       p_user_id      AS CREATED_BY
                  FROM DUAL
            ) src
            ON (dst.COMPANY_CODE = src.COMPANY_CODE AND dst.PRIN_CODE = src.PRIN_CODE AND dst.JOB_NO = src.JOB_NO AND dst.TASK_TYPE = src.TASK_TYPE)
            WHEN NOT MATCHED THEN
                INSERT (TASK_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, FLOW_LEVEL, TASK_TYPE, ASSIGNED_TEAM, STATUS, DUE_AT, CREATED_BY, CREATED_DT)
                VALUES (RAWTOHEX(SYS_GUID()), src.COMPANY_CODE, src.PRIN_CODE, src.JOB_NO, src.FLOW_LEVEL, src.TASK_TYPE, src.ASSIGNED_TEAM, 'IN_PROGRESS', src.DUE_AT, src.CREATED_BY, SYSDATE);
        END LOOP;
    END IF;

    -- 5. Sync Containers from TF_CONTAINER_DET into TRK_CONTAINERS
    FOR cntr IN (
        SELECT CONTAINER_NO, SEAL_NO
          FROM WMSTST.TF_CONTAINER_DET
         WHERE COMPANY_CODE = p_company_code
           AND PRIN_CODE    = p_prin_code
           AND JOB_NO       = p_job_no
           AND CONTAINER_NO IS NOT NULL
    ) LOOP
        MERGE INTO WMSTST.TRK_CONTAINERS dst
        USING (
            SELECT p_company_code     AS COMPANY_CODE,
                   p_prin_code        AS PRIN_CODE,
                   p_job_no           AS JOB_NO,
                   cntr.CONTAINER_NO  AS CONTAINER_NUMBER,
                   cntr.SEAL_NO       AS SEAL_NO
              FROM DUAL
        ) src
        ON (dst.COMPANY_CODE = src.COMPANY_CODE AND dst.PRIN_CODE = src.PRIN_CODE AND dst.JOB_NO = src.JOB_NO AND dst.CONTAINER_NUMBER = src.CONTAINER_NUMBER)
        WHEN MATCHED THEN
            UPDATE SET dst.SEAL_NO = NVL(src.SEAL_NO, dst.SEAL_NO), dst.UPDATED_DT = SYSDATE
        WHEN NOT MATCHED THEN
            INSERT (CONTAINER_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, CONTAINER_NUMBER, SEAL_NO, STATUS, CREATED_DT, UPDATED_DT)
            VALUES (RAWTOHEX(SYS_GUID()), src.COMPANY_CODE, src.PRIN_CODE, src.JOB_NO, src.CONTAINER_NUMBER, src.SEAL_NO, 'PENDING', SYSDATE, SYSDATE);
    END LOOP;

    -- Audit Event
    INSERT INTO WMSTST.TRK_SHIPMENT_EVENTS (EVENT_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, EVENT_TYPE, STAGE_FROM, STAGE_TO, ACTOR_ID, REMARK, CREATED_DT)
    VALUES (RAWTOHEX(SYS_GUID()), p_company_code, p_prin_code, p_job_no, 'SHIPMENT_INIT', NULL, v_start_stage, p_user_id, 'Shipment Tracking initialized (Flow: ' || v_flow_code || ', Levels: ' || v_last_level || ')', SYSDATE);

    COMMIT;
END;
/

-- -----------------------------------------------------------------------------
-- 2. PROC_TRK_CHECK_COMPLETION
-- Customizable Completion Gate: checks MS_APPROVER_LEVELS.LAST_LEVEL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE WMSTST.PROC_TRK_CHECK_COMPLETION (
    p_company_code IN VARCHAR2,
    p_prin_code    IN VARCHAR2,
    p_job_no       IN VARCHAR2,
    p_user_id      IN VARCHAR2,
    p_is_completed OUT CHAR
) AS
    v_last_level    NUMBER := 0;
    v_pending_count NUMBER := 0;
    v_flow_code     VARCHAR2(30) := 'NORMAL_IMPORT';
    v_is_cfs        CHAR(1) := 'N';
BEGIN
    SELECT CASE WHEN NVL(JOB_FLAG, 'M') = 'C' THEN 'Y' ELSE 'N' END
      INTO v_is_cfs
      FROM WMSTST.TI_JOB
     WHERE COMPANY_CODE = p_company_code
       AND PRIN_CODE    = p_prin_code
       AND JOB_NO       = p_job_no;

    IF v_is_cfs = 'Y' THEN
        v_flow_code := 'CFS_TRANSFER';
    END IF;

    -- Read LAST_LEVEL for this company from MS_APPROVER_LEVELS
    SELECT NVL(MAX(LAST_LEVEL), 4)
      INTO v_last_level
      FROM WMSTST.MS_APPROVER_LEVELS
     WHERE COMPANY_CODE = p_company_code
       AND PROCESS      = 'FREIGHT_TRACKER'
       AND FLOW_CODE    = v_flow_code;

    -- Count pending tasks within the active level range
    SELECT COUNT(*)
      INTO v_pending_count
      FROM WMSTST.TRK_SHIPMENT_TASKS
     WHERE COMPANY_CODE = p_company_code
       AND PRIN_CODE    = p_prin_code
       AND JOB_NO       = p_job_no
       AND FLOW_LEVEL   <= v_last_level
       AND STATUS       != 'COMPLETED';

    IF v_pending_count = 0 THEN
        -- Mark TRK_SHIPMENT as COMPLETED
        UPDATE WMSTST.TRK_SHIPMENT
           SET CURRENT_STAGE = 'COMPLETED',
               COMPLETED_AT  = SYSDATE,
               UPDATED_BY    = p_user_id,
               UPDATED_DT    = SYSDATE
         WHERE COMPANY_CODE  = p_company_code
           AND PRIN_CODE     = p_prin_code
           AND JOB_NO        = p_job_no;

        -- Mark TI_JOB ERP core status as COMPLETED
        UPDATE WMSTST.TI_JOB
           SET COMPLETED     = 'Y',
               COMPLETE_DATE = SYSDATE
         WHERE COMPANY_CODE  = p_company_code
           AND PRIN_CODE     = p_prin_code
           AND JOB_NO        = p_job_no;

        INSERT INTO WMSTST.TRK_SHIPMENT_EVENTS (EVENT_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, EVENT_TYPE, STAGE_FROM, STAGE_TO, ACTOR_ID, REMARK, CREATED_DT)
        VALUES (RAWTOHEX(SYS_GUID()), p_company_code, p_prin_code, p_job_no, 'STAGE_CHANGED', 'IN_PROGRESS', 'COMPLETED', p_user_id, 'All milestones up to level ' || v_last_level || ' completed', SYSDATE);

        p_is_completed := 'Y';
    ELSE
        p_is_completed := 'N';
    END IF;
END;
/

-- -----------------------------------------------------------------------------
-- 3. PROC_TRK_TASK_UPDATE
-- Updates task status (In Progress, On Hold, Completed) and checks completion
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE WMSTST.PROC_TRK_TASK_UPDATE (
    p_company_code   IN VARCHAR2,
    p_prin_code      IN VARCHAR2,
    p_job_no         IN VARCHAR2,
    p_task_type      IN VARCHAR2,
    p_status         IN VARCHAR2, -- IN_PROGRESS, ON_HOLD, COMPLETED
    p_hold_entity    IN VARCHAR2 DEFAULT NULL,
    p_hold_reason    IN VARCHAR2 DEFAULT NULL,
    p_hold_remark    IN VARCHAR2 DEFAULT NULL,
    p_release_remark IN VARCHAR2 DEFAULT NULL,
    p_user_id        IN VARCHAR2,
    p_is_completed   OUT CHAR
) AS
    v_task_id VARCHAR2(36);
BEGIN
    SELECT TASK_ID
      INTO v_task_id
      FROM WMSTST.TRK_SHIPMENT_TASKS
     WHERE COMPANY_CODE = p_company_code
       AND PRIN_CODE    = p_prin_code
       AND JOB_NO       = p_job_no
       AND TASK_TYPE    = p_task_type;

    IF p_status = 'COMPLETED' THEN
        UPDATE WMSTST.TRK_SHIPMENT_TASKS
           SET STATUS         = 'COMPLETED',
               COMPLETED_BY   = p_user_id,
               COMPLETED_DT   = SYSDATE,
               RELEASE_REMARK = NVL(p_release_remark, RELEASE_REMARK)
         WHERE TASK_ID        = v_task_id;

        INSERT INTO WMSTST.TRK_SHIPMENT_EVENTS (EVENT_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, EVENT_TYPE, ACTOR_ID, REMARK, CREATED_DT)
        VALUES (RAWTOHEX(SYS_GUID()), p_company_code, p_prin_code, p_job_no, 'TASK_COMPLETED', p_user_id, 'Task completed: ' || p_task_type, SYSDATE);

        -- Evaluate completion gate
        WMSTST.PROC_TRK_CHECK_COMPLETION(p_company_code, p_prin_code, p_job_no, p_user_id, p_is_completed);

    ELSIF p_status = 'ON_HOLD' THEN
        UPDATE WMSTST.TRK_SHIPMENT_TASKS
           SET STATUS      = 'ON_HOLD',
               HOLD_ENTITY = p_hold_entity,
               HOLD_REASON = p_hold_reason,
               HOLD_REMARK = p_hold_remark
         WHERE TASK_ID     = v_task_id;

        INSERT INTO WMSTST.TRK_SHIPMENT_EVENTS (EVENT_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, EVENT_TYPE, ACTOR_ID, REMARK, CREATED_DT)
        VALUES (RAWTOHEX(SYS_GUID()), p_company_code, p_prin_code, p_job_no, 'HOLD_APPLIED', p_user_id, 'Task put on hold: ' || p_task_type || ' - ' || p_hold_reason, SYSDATE);

        p_is_completed := 'N';
    ELSE
        UPDATE WMSTST.TRK_SHIPMENT_TASKS
           SET STATUS         = 'IN_PROGRESS',
               RELEASE_REMARK = p_release_remark
         WHERE TASK_ID        = v_task_id;

        INSERT INTO WMSTST.TRK_SHIPMENT_EVENTS (EVENT_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, EVENT_TYPE, ACTOR_ID, REMARK, CREATED_DT)
        VALUES (RAWTOHEX(SYS_GUID()), p_company_code, p_prin_code, p_job_no, 'HOLD_RELEASED', p_user_id, 'Hold released on task: ' || p_task_type, SYSDATE);

        p_is_completed := 'N';
    END IF;

    COMMIT;
END;
/

-- -----------------------------------------------------------------------------
-- 4. PROC_TRK_CONTAINER_OFFLOAD
-- Marks container offloaded and syncs TF_CONTAINER_DET.CONTN_PICK_DATE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE WMSTST.PROC_TRK_CONTAINER_OFFLOAD (
    p_company_code     IN VARCHAR2,
    p_prin_code        IN VARCHAR2,
    p_job_no           IN VARCHAR2,
    p_container_number IN VARCHAR2,
    p_dc_remark        IN VARCHAR2 DEFAULT NULL,
    p_user_id          IN VARCHAR2
) AS
BEGIN
    UPDATE WMSTST.TRK_CONTAINERS
       SET STATUS       = 'OFFLOADED',
           OFFLOADED_AT = SYSDATE,
           OFFLOADED_BY = p_user_id,
           DC_REMARK    = NVL(p_dc_remark, DC_REMARK),
           UPDATED_DT   = SYSDATE
     WHERE COMPANY_CODE     = p_company_code
       AND PRIN_CODE        = p_prin_code
       AND JOB_NO           = p_job_no
       AND CONTAINER_NUMBER = p_container_number;

    -- Sync back to TF_CONTAINER_DET for PB ERP backward compatibility
    UPDATE WMSTST.TF_CONTAINER_DET
       SET CONTN_PICK_DATE = NVL(CONTN_PICK_DATE, SYSDATE),
           CONTN_PICK_BY   = NVL(CONTN_PICK_BY, p_user_id)
     WHERE COMPANY_CODE     = p_company_code
       AND PRIN_CODE        = p_prin_code
       AND JOB_NO           = p_job_no
       AND CONTAINER_NO     = p_container_number;

    INSERT INTO WMSTST.TRK_SHIPMENT_EVENTS (EVENT_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, EVENT_TYPE, ACTOR_ID, REMARK, CREATED_DT)
    VALUES (RAWTOHEX(SYS_GUID()), p_company_code, p_prin_code, p_job_no, 'CONTAINER_OFFLOADED', p_user_id, 'Container offloaded: ' || p_container_number, SYSDATE);

    COMMIT;
END;
/

-- -----------------------------------------------------------------------------
-- 5. PROC_TRK_SHIPMENT_LIST
-- Powers the Tracker Dashboard with stage, search, and container counts
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE WMSTST.PROC_TRK_SHIPMENT_LIST (
    p_company_code IN VARCHAR2,
    p_stage        IN VARCHAR2 DEFAULT NULL,
    p_search       IN VARCHAR2 DEFAULT NULL,
    p_from_date    IN DATE     DEFAULT NULL,
    p_to_date      IN DATE     DEFAULT NULL,
    p_result       OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_result FOR
        SELECT s.COMPANY_CODE,
               s.PRIN_CODE,
               s.JOB_NO,
               s.BL_NUMBER,
               s.INVOICE_NUMBER,
               s.SHIPMENT_TYPE,
               s.CURRENT_STAGE,
               s.PULL_OUT_DATE,
               s.DO_VALIDITY_DATE,
               s.PERMIT_REF,
               s.IS_DRY,
               s.IS_IMPORTANT,
               s.ETA_AT_PORT,
               j.JOB_DATE,
               j.CUST_CODE,
               c.CUST_NAME,
               j.PORT_CODE,
               j.DESTINATION_PORT,
               (SELECT COUNT(*) FROM WMSTST.TRK_CONTAINERS cntr WHERE cntr.COMPANY_CODE = s.COMPANY_CODE AND cntr.PRIN_CODE = s.PRIN_CODE AND cntr.JOB_NO = s.JOB_NO) AS TOTAL_CONTAINERS,
               (SELECT COUNT(*) FROM WMSTST.TRK_CONTAINERS cntr WHERE cntr.COMPANY_CODE = s.COMPANY_CODE AND cntr.PRIN_CODE = s.PRIN_CODE AND cntr.JOB_NO = s.JOB_NO AND cntr.STATUS = 'OFFLOADED') AS OFFLOADED_CONTAINERS,
               (SELECT COUNT(*) FROM WMSTST.TRK_SHIPMENT_TASKS t WHERE t.COMPANY_CODE = s.COMPANY_CODE AND t.PRIN_CODE = s.PRIN_CODE AND t.JOB_NO = s.JOB_NO AND t.STATUS = 'ON_HOLD') AS HOLDS_COUNT
          FROM WMSTST.TRK_SHIPMENT s
          JOIN WMSTST.TI_JOB j
            ON j.COMPANY_CODE = s.COMPANY_CODE AND j.PRIN_CODE = s.PRIN_CODE AND j.JOB_NO = s.JOB_NO
          LEFT JOIN WMSTST.MS_CUSTOMER c
            ON c.COMPANY_CODE = j.COMPANY_CODE AND c.PRIN_CODE = j.PRIN_CODE AND c.CUST_CODE = j.CUST_CODE
         WHERE s.COMPANY_CODE = p_company_code
           AND (p_stage IS NULL OR s.CURRENT_STAGE = p_stage)
           AND (p_from_date IS NULL OR TRUNC(j.JOB_DATE) >= TRUNC(p_from_date))
           AND (p_to_date IS NULL OR TRUNC(j.JOB_DATE) <= TRUNC(p_to_date))
           AND (p_search IS NULL OR (
                UPPER(s.JOB_NO) LIKE '%' || UPPER(p_search) || '%' OR
                UPPER(s.BL_NUMBER) LIKE '%' || UPPER(p_search) || '%' OR
                UPPER(s.INVOICE_NUMBER) LIKE '%' || UPPER(p_search) || '%' OR
                UPPER(c.CUST_NAME) LIKE '%' || UPPER(p_search) || '%'
           ))
         ORDER BY s.IS_IMPORTANT DESC, j.JOB_DATE DESC;
END;
/

-- -----------------------------------------------------------------------------
-- 6. PROC_TRK_SHIPMENT_GET
-- Returns full details: Header, Dynamic Tasks, Containers, and Events
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE WMSTST.PROC_TRK_SHIPMENT_GET (
    p_company_code IN VARCHAR2,
    p_prin_code    IN VARCHAR2,
    p_job_no       IN VARCHAR2,
    p_header       OUT SYS_REFCURSOR,
    p_tasks        OUT SYS_REFCURSOR,
    p_containers   OUT SYS_REFCURSOR,
    p_events       OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_header FOR
        SELECT s.*,
               j.JOB_DATE,
               j.CUST_CODE,
               c.CUST_NAME,
               j.PORT_CODE,
               j.DESTINATION_PORT,
               j.VESSEL_NAME,
               j.VOYAGE_NO,
               j.JOB_FLAG
          FROM WMSTST.TRK_SHIPMENT s
          JOIN WMSTST.TI_JOB j
            ON j.COMPANY_CODE = s.COMPANY_CODE AND j.PRIN_CODE = s.PRIN_CODE AND j.JOB_NO = s.JOB_NO
          LEFT JOIN WMSTST.MS_CUSTOMER c
            ON c.COMPANY_CODE = j.COMPANY_CODE AND c.PRIN_CODE = j.PRIN_CODE AND c.CUST_CODE = j.CUST_CODE
         WHERE s.COMPANY_CODE = p_company_code
           AND s.PRIN_CODE    = p_prin_code
           AND s.JOB_NO       = p_job_no;

    OPEN p_tasks FOR
        SELECT t.*
          FROM WMSTST.TRK_SHIPMENT_TASKS t
         WHERE t.COMPANY_CODE = p_company_code
           AND t.PRIN_CODE    = p_prin_code
           AND t.JOB_NO       = p_job_no
         ORDER BY t.FLOW_LEVEL ASC;

    OPEN p_containers FOR
        SELECT *
          FROM WMSTST.TRK_CONTAINERS
         WHERE COMPANY_CODE = p_company_code
           AND PRIN_CODE    = p_prin_code
           AND JOB_NO       = p_job_no
         ORDER BY CONTAINER_NUMBER ASC;

    OPEN p_events FOR
        SELECT *
          FROM WMSTST.TRK_SHIPMENT_EVENTS
         WHERE COMPANY_CODE = p_company_code
           AND PRIN_CODE    = p_prin_code
           AND JOB_NO       = p_job_no
         ORDER BY CREATED_DT DESC;
END;
/

PROMPT '>>> 02_CREATE_FREIGHT_TRACKER_PROCEDURES.sql completed successfully!';

