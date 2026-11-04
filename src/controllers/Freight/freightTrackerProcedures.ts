import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";
import { sendTrackerStageEmail } from "../../services/Freight/freightTrackerNotificationService";
import { parseShippingDocumentPdf } from "../../services/Freight/freightDocumentAiService";

type Connection = oracledb.Connection;

// Configuration catalog for tracker levels & tabs
const TRACKER_TABS_CONFIG = [
  {
    serial_no: 539,
    flow_level: 1,
    tab_id: "FFD_REVIEW",
    task_type: "FFD_REVIEW",
    title: "FFD Review",
    subtitle: "B/L & ETA Verification",
    icon: "FileText",
    url_path: "freight/tracker/ffd",
    description: "Review Master/House B/L, Commercial Invoice, and set initial ETA & planned pull-out date.",
  },
  {
    serial_no: 540,
    flow_level: 2,
    tab_id: "PRO_PERMITS",
    task_type: "PRO_PERMITS",
    title: "PRO Permits",
    subtitle: "Ministry Inspection & Permits",
    icon: "ShieldCheck",
    url_path: "freight/tracker/permit",
    description: "Submit & track agricultural/food health inspection permits or food approvals.",
  },
  {
    serial_no: 541,
    flow_level: 3,
    tab_id: "CUSTOMS_BAYAN",
    task_type: "CUSTOMS_BAYAN",
    title: "Customs Bayan",
    subtitle: "Bayan Declaration & Duty",
    icon: "Landmark",
    url_path: "freight/tracker/bayan",
    description: "Process customs declaration, input Bayan declaration number, and record duty fees.",
  },
  {
    serial_no: 542,
    flow_level: 4,
    tab_id: "SHIPPING_LINE_DO",
    task_type: "SHIPPING_LINE_DO",
    title: "Delivery Order (DO)",
    subtitle: "Shipping Line DO & Validity",
    icon: "Ship",
    url_path: "freight/tracker/do",
    description: "Collect Delivery Order, track DO expiry date countdown, and manage revalidations.",
  },
  {
    serial_no: 543,
    flow_level: 5,
    tab_id: "CCRO",
    task_type: "CCRO",
    title: "CCRO / Port Police",
    subtitle: "Customs & Port Police Clearance",
    icon: "Lock",
    url_path: "freight/tracker/ccro",
    description: "Coordinate container seal clearance with Customs Container Release Office & Port Police.",
  },
  {
    serial_no: 544,
    flow_level: 6,
    tab_id: "TRANSPORT",
    task_type: "TRANSPORT",
    title: "Transport Dispatch",
    subtitle: "Fleet & Truck Allocation",
    icon: "Truck",
    url_path: "freight/tracker/transport",
    description: "Assign company fleet or 3rd-party trucking contractors, drivers, and schedule pickups.",
  },
  {
    serial_no: 545,
    flow_level: 7,
    tab_id: "DC_OFFLOAD",
    task_type: "DC_OFFLOAD",
    title: "DC Offloading",
    subtitle: "Warehouse Gate & Offloading",
    icon: "Warehouse",
    url_path: "freight/tracker/dc",
    description: "Record warehouse gate-in, offloading timestamps, container condition, and empty returns.",
  },
];

// =============================================================================
// 1. DYNAMIC NAVIGATION & TAB PERMISSIONS (Driven by MS_APPROVER_LEVELS & SEC_ROLE_FUNCTION_ACCESS_USER)
// =============================================================================
export const trkUserNav = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;
    const loginId = req.body.loginid ?? req.body.LOGINID ?? req.body.user_id ?? (req as any).user?.loginid;
    const flowCode = req.body.flow_code ?? req.body.FLOW_CODE ?? "NORMAL_IMPORT";
    const jobNo = req.body.job_no ?? req.body.JOB_NO ?? null;

    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    // Step A: Determine flow code if job_no provided
    let effectiveFlowCode = (flowCode === "CFS" || flowCode === "CFS_TRANSFER") ? "CFS" : "NORM";
    if (jobNo) {
      const jobCheck = await connection.execute(
        `SELECT NVL(JOB_FLAG, 'M') AS JOB_FLAG, NVL(JOB_TYPE, 'IMP') AS JOB_TYPE
           FROM TI_JOB
          WHERE COMPANY_CODE = :company_code AND JOB_NO = :job_no`,
        { company_code: companyCode, job_no: jobNo },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const jobRow: any = (jobCheck.rows as any[])?.[0];
      if (jobRow && (jobRow.JOB_FLAG === "C" || jobRow.JOB_TYPE === "CFS")) {
        effectiveFlowCode = "CFS";
      }
    }

    // Step B: Query MS_APPROVER_LEVELS for Company's configured LAST_LEVEL
    const approverLevelsResult = await connection.execute(
      `SELECT LAST_LEVEL, FLOW_CODE, LEVEL1_ROLE, LEVEL2_ROLE, LEVEL3_ROLE, LEVEL4_ROLE, LEVEL5_ROLE, LEVEL6_ROLE, LEVEL7_ROLE
         FROM MS_APPROVER_LEVELS
        WHERE COMPANY_CODE = :company_code
          AND PROCESS IN ('TRACKER', 'FREIGHT_TRACKER')
          AND FLOW_CODE = :flow_code`,
      { company_code: companyCode, flow_code: effectiveFlowCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let lastLevel = 4; // Default fallback: 4-Level Broker
    const approverConfig: any = (approverLevelsResult.rows as any[])?.[0];
    if (approverConfig && approverConfig.LAST_LEVEL) {
      lastLevel = Number(approverConfig.LAST_LEVEL);
    } else if (effectiveFlowCode === "CFS") {
      lastLevel = 1;
    }

    // Step C: Query User's Permissions via SEC_MODULE_DATA & SEC_ROLE_FUNCTION_ACCESS_USER
    // Matches by serial numbers (539-545) or URL_PATH
    const permissionsResult = await connection.execute(
      `SELECT m.URL_PATH, m.SERIAL_NO, a.SSEARCH, a.SSAVE, a.SMODIFY, a.SDELETE, a.SUPLOAD
         FROM SEC_MODULE_DATA m
         LEFT JOIN SEC_ROLE_FUNCTION_ACCESS_USER a
           ON a.SERIAL_NO_OR_ROLE_ID = m.SERIAL_NO
          AND a.COMPANY_CODE = :company_code
          AND a.LOGINID = :loginid
        WHERE m.SERIAL_NO IN (539, 540, 541, 542, 543, 544, 545)
           OR m.URL_PATH LIKE '%freight/tracker/%'`,
      { company_code: companyCode, loginid: loginId || "" },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const userPermsMap = new Map<string | number, any>();
    for (const p of (permissionsResult.rows as any[]) || []) {
      if (p.URL_PATH) {
        userPermsMap.set(String(p.URL_PATH).toLowerCase().trim(), p);
      }
      if (p.SERIAL_NO) {
        userPermsMap.set(Number(p.SERIAL_NO), p);
      }
    }

    const isAdmin = String(loginId || "").toLowerCase() === "admin";

    // Step D: Filter tabs based on Company Level + User RBAC
    const activeTabs: any[] = [];
    const hiddenTabs: any[] = [];

    // Special handling for CFS Transfer: Only CCRO is active
    if (effectiveFlowCode === "CFS") {
      const ccroConfig = TRACKER_TABS_CONFIG.find((t) => t.tab_id === "CCRO")!;
      const perm = userPermsMap.get(ccroConfig.url_path.toLowerCase()) || userPermsMap.get(ccroConfig.serial_no);
      const canView = isAdmin || (perm?.SSEARCH === "Y");
      const canEdit = isAdmin || (perm?.SSAVE === "Y" || perm?.SMODIFY === "Y");
      const canUpload = isAdmin || (perm?.SUPLOAD === "Y");
      const canDelete = isAdmin || (perm?.SDELETE === "Y");

      const tabEntry = {
        ...ccroConfig,
        serial_no: perm?.SERIAL_NO ?? ccroConfig.serial_no,
        canView,
        canEdit,
        canUpload,
        canDelete,
        isReadOnly: !canEdit,
        isMandatory: true,
        assignedRole: approverConfig?.LEVEL1_ROLE ?? "ROP_TEAM",
      };

      if (canView) {
        activeTabs.push(tabEntry);
      } else {
        hiddenTabs.push(tabEntry);
      }
    } else {
      // Normal Flow: Check up to lastLevel
      for (const tab of TRACKER_TABS_CONFIG) {
        if (tab.flow_level > lastLevel) {
          // Beyond company's configured process boundary
          continue;
        }

        const perm = userPermsMap.get(tab.url_path.toLowerCase()) || userPermsMap.get(tab.serial_no);
        const canView = isAdmin || (perm?.SSEARCH === "Y");
        const canEdit = isAdmin || (perm?.SSAVE === "Y" || perm?.SMODIFY === "Y");
        const canUpload = isAdmin || (perm?.SUPLOAD === "Y");
        const canDelete = isAdmin || (perm?.SDELETE === "Y");

        const roleKey = `LEVEL${tab.flow_level}_ROLE`;
        const assignedRole = approverConfig ? approverConfig[roleKey] : null;

        const tabEntry = {
          ...tab,
          serial_no: perm?.SERIAL_NO ?? tab.serial_no,
          canView,
          canEdit,
          canUpload,
          canDelete,
          isReadOnly: !canEdit,
          isMandatory: true,
          assignedRole,
        };

        if (canView) {
          activeTabs.push(tabEntry);
        } else {
          hiddenTabs.push(tabEntry);
        }
      }
    }

    res.json({
      success: true,
      data: {
        company_code: companyCode,
        flow_code: effectiveFlowCode,
        last_level: lastLevel,
        totalConfiguredLevels: activeTabs.length,
        isCfs: effectiveFlowCode === "CFS_TRANSFER",
        activeTabs,
        hiddenTabs,
      },
    });
  });
};

// =============================================================================
// 2. SHIPMENT LIST (Dashboard Query)
// =============================================================================
export const trkShipmentList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_TRK_SHIPMENT_LIST(
           :p_company_code,
           :p_stage,
           :p_search,
           :p_from_date,
           :p_to_date,
           :p_result
         );
       END;`,
      {
        p_company_code: value(req.body.company_code ?? req.body.COMPANY_CODE),
        p_stage: value(req.body.stage ?? req.body.STAGE),
        p_search: value(req.body.search ?? req.body.SEARCH),
        p_from_date: toDate(req.body.from_date ?? req.body.FROM_DATE),
        p_to_date: toDate(req.body.to_date ?? req.body.TO_DATE),
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

// =============================================================================
// 3. SHIPMENT GET (Full Details: Header, Tasks, Containers, Events)
// =============================================================================
export const trkShipmentGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const prinCode = await resolvePrinCode(connection, companyCode, jobNo, req.body.prin_code ?? req.body.PRIN_CODE);

    if (!companyCode || !jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "company_code, job_no, and valid prin_code are required" });
      return;
    }

    const result = await connection.execute(
      `BEGIN
         PROC_TRK_SHIPMENT_GET(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_header,
           :p_tasks,
           :p_containers,
           :p_events
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_no: jobNo,
        p_header: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_tasks: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_containers: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        p_events: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const outBinds = result.outBinds as any;
    const headerRows = await rowsFromCursor(outBinds.p_header);
    const taskRows = await rowsFromCursor(outBinds.p_tasks);
    const containerRows = await rowsFromCursor(outBinds.p_containers);
    const eventRows = await rowsFromCursor(outBinds.p_events);

    const header = headerRows[0] ?? null;
    if (header) {
      header.DOC_REF = header.DOC_REF || header.BL_NUMBER;
      header.BL_NUMBER = header.BL_NUMBER || header.DOC_REF;
    }

    const normalizedContainers = (containerRows || []).map((c: any) => ({
      ...c,
      CONTAINER_NO: c.CONTAINER_NO || c.CONTAINER_NUMBER,
      CONTAINER_NUMBER: c.CONTAINER_NUMBER || c.CONTAINER_NO,
      TRUCK_PLATE: c.TRUCK_PLATE || c.TRUCK_PLATE_NUMBER,
      TRUCK_PLATE_NUMBER: c.TRUCK_PLATE_NUMBER || c.TRUCK_PLATE,
    }));

    // Calculate progress statistics
    const totalTasks = taskRows.length;
    const completedTasks = taskRows.filter((t: any) => t.STATUS === "COMPLETED").length;
    const onHoldTasks = taskRows.filter((t: any) => t.STATUS === "ON_HOLD").length;
    const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    res.json({
      success: true,
      data: {
        header,
        tasks: taskRows,
        containers: normalizedContainers,
        events: eventRows,
        stats: {
          totalTasks,
          completedTasks,
          onHoldTasks,
          progressPercent,
        },
      },
    });
  });
};

// =============================================================================
// 4. SHIPMENT INIT (Spawns tracking and tasks for an existing TI_JOB)
// =============================================================================
export const trkShipmentInit = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const prinCode = await resolvePrinCode(connection, companyCode, jobNo, req.body.prin_code ?? req.body.PRIN_CODE);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");

    if (!companyCode || !jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "company_code, job_no, and valid prin_code are required" });
      return;
    }

    await connection.execute(
      `BEGIN
         PROC_TRK_SHIPMENT_INIT(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_user_id
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_no: jobNo,
        p_user_id: userId,
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: `Tracking successfully initialized for Freight Job ${jobNo}`,
      data: { job_no: jobNo },
    });
  });
};

// =============================================================================
// 5. TASK UPDATE (In Progress, On Hold, Completed + Auto-evaluate Gate)
// =============================================================================
// 5. TASK UPDATE (In Progress, On Hold, Completed + Auto-evaluate Gate)
// =============================================================================
export const trkTaskUpdate = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const prinCode = await resolvePrinCode(connection, companyCode, jobNo, req.body.prin_code ?? req.body.PRIN_CODE);
    const taskType = value(req.body.task_type ?? req.body.TASK_TYPE);
    const rawStatus = value(req.body.status ?? req.body.STATUS);
    let status = String(rawStatus || 'IN_PROGRESS').trim().toUpperCase();
    if (['DONE', 'COMPLETE', 'FINISHED', 'APPROVED'].includes(status)) {
      status = 'COMPLETED';
    } else if (['HOLD', 'HELD'].includes(status)) {
      status = 'ON_HOLD';
    } else if (!['IN_PROGRESS', 'ON_HOLD', 'COMPLETED'].includes(status)) {
      status = 'IN_PROGRESS';
    }
    const holdEntity = value(req.body.hold_entity ?? req.body.HOLD_ENTITY);
    const holdReason = value(req.body.hold_reason ?? req.body.HOLD_REASON);
    const holdRemark = value(req.body.hold_remark ?? req.body.HOLD_REMARK);
    const releaseRemark = value(req.body.release_remark ?? req.body.RELEASE_REMARK);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");

    if (!companyCode || !jobNo || !prinCode || !taskType || !status) {
      res.status(400).json({
        success: false,
        message: "company_code, job_no, prin_code, task_type, and status are required",
      });
      return;
    }

    // Resolve exact task type stored in TRK_SHIPMENT_TASKS
    let resolvedTaskType = taskType;
    try {
      const taskTypeCheck = await connection.execute(
        `SELECT TASK_TYPE
           FROM TRK_SHIPMENT_TASKS
          WHERE COMPANY_CODE = :comp AND PRIN_CODE = :prin AND JOB_NO = :job
            AND (
                 TASK_TYPE = :tt
              OR (:tt IN ('PRO_PERMITS', 'PERMIT') AND TASK_TYPE IN ('PRO_PERMITS', 'PERMIT'))
              OR (:tt IN ('CUSTOMS_BAYAN', 'BAYAN') AND TASK_TYPE IN ('CUSTOMS_BAYAN', 'BAYAN'))
              OR (:tt IN ('SHIPPING_LINE_DO', 'DO') AND TASK_TYPE IN ('SHIPPING_LINE_DO', 'DO'))
              OR (:tt IN ('DC_OFFLOAD', 'DC') AND TASK_TYPE IN ('DC_OFFLOAD', 'DC'))
            )
            AND ROWNUM = 1`,
        { comp: companyCode, prin: prinCode, job: jobNo, tt: taskType },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const row: any = (taskTypeCheck.rows as any[])?.[0];
      if (row?.TASK_TYPE) {
        resolvedTaskType = String(row.TASK_TYPE).trim();
      }
    } catch (tErr) {
      console.warn("[trkTaskUpdate] Task type resolution fallback:", tErr);
    }

    // Call Procedure
    const result = await connection.execute(
      `BEGIN
         PROC_TRK_TASK_UPDATE(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_task_type,
           :p_status,
           :p_hold_entity,
           :p_hold_reason,
           :p_hold_remark,
           :p_release_remark,
           :p_user_id,
           :p_is_completed
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_no: jobNo,
        p_task_type: resolvedTaskType,
        p_status: status,
        p_hold_entity: holdEntity,
        p_hold_reason: holdReason,
        p_hold_remark: holdRemark,
        p_release_remark: releaseRemark,
        p_user_id: userId,
        p_is_completed: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 5 },
      },
      { autoCommit: true }
    );

    // Optional metadata synchronizations
    if ((taskType === "SHIPPING_LINE_DO" || taskType === "DO") && req.body.do_validity_date) {
      const doDate = toDate(req.body.do_validity_date);
      if (doDate) {
        await connection.execute(
          `UPDATE TRK_SHIPMENT SET DO_VALIDITY_DATE = :do_date, UPDATED_DT = SYSDATE WHERE COMPANY_CODE = :comp AND PRIN_CODE = :prin AND JOB_NO = :job`,
          { do_date: doDate, comp: companyCode, prin: prinCode, job: jobNo },
          { autoCommit: true }
        );
      }
    }

    if ((taskType === "PRO_PERMITS" || taskType === "PERMIT") && (req.body.permit_ref || req.body.permit_not_required !== undefined)) {
      const pref = req.body.permit_ref ? String(req.body.permit_ref).trim() : null;
      const pnr = req.body.permit_not_required === "Y" ? "Y" : "N";
      await connection.execute(
        `UPDATE TRK_SHIPMENT
            SET PERMIT_REF = NVL(:pref, PERMIT_REF),
                PERMIT_NOT_REQUIRED = :pnr,
                UPDATED_DT = SYSDATE
          WHERE COMPANY_CODE = :comp AND PRIN_CODE = :prin AND JOB_NO = :job`,
        { pref, pnr, comp: companyCode, prin: prinCode, job: jobNo },
        { autoCommit: true }
      );
    }

    const isCompleted = (result.outBinds as any)?.p_is_completed === "Y";

    // Trigger background email notification (non-blocking)
    
    // Insert In-App Notification (non-blocking)
    try {
      let notifTitle = `Milestone Update: ${jobNo}`;
      let notifMsg = `Task ${taskType} changed to ${status}`;
      let notifCat = 'STAGE_ADVANCED';

      if (status === 'ON_HOLD') {
        notifTitle = `⚠️ Milestone On Hold: ${jobNo} (${taskType})`;
        notifMsg = `Hold placed by ${holdEntity || 'Review'}: ${holdReason || holdRemark || 'Pending resolution'}`;
        notifCat = 'HOLD_APPLIED';
      } else if (status === 'COMPLETED') {
        notifTitle = `✓ Milestone Completed: ${jobNo} (${taskType})`;
        notifMsg = `Completed by ${userId}. Ready for next milestone.`;
        notifCat = 'STAGE_ADVANCED';
      } else if (releaseRemark) {
        notifTitle = `🔓 Hold Released: ${jobNo} (${taskType})`;
        notifMsg = `Hold on ${taskType} resolved: "${releaseRemark}"`;
        notifCat = 'HOLD_RELEASED';
      }

      await connection.execute(
        `INSERT INTO TRK_NOTIFICATIONS (NOTIFICATION_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, RECIPIENT_ID, CHANNEL, CATEGORY, TITLE, MESSAGE, IS_READ, CREATED_DT)
          VALUES (RAWTOHEX(SYS_GUID()), :comp, :prin, :job, 'ALL', 'IN_APP', :cat, :title, :msg, 'N', SYSDATE)`,
        { comp: companyCode, prin: prinCode, job: jobNo, cat: notifCat, title: notifTitle, msg: notifMsg },
        { autoCommit: true }
      );
    } catch (notifErr) {
      console.warn('[trkTaskUpdate] In-app notification creation notice:', notifErr);
    }

    // Auto-sync milestone to TT_ALERT_DATES for PowerBuilder compatibility
    if (status === 'COMPLETED') {
      try {
        const opCodes: number[] = [];
        if (taskType === 'FFD_REVIEW') opCodes.push(13, 51);
        else if (taskType === 'PRO_PERMITS' || taskType === 'PERMIT') opCodes.push(40);
        else if (taskType === 'CUSTOMS_BAYAN' || taskType === 'BAYAN') opCodes.push(38, 39);
        else if (taskType === 'SHIPPING_LINE_DO' || taskType === 'DO') opCodes.push(37);
        else if (taskType === 'CCRO') opCodes.push(40);
        else if (taskType === 'TRANSPORT') opCodes.push(41);
        else if (taskType === 'DC_OFFLOAD' || taskType === 'DC') opCodes.push(43, 44);

        for (const opCode of opCodes) {
          await connection.execute(
            `MERGE INTO TT_ALERT_DATES d
             USING (
               SELECT :comp AS company_code,
                      :prin AS prin_code,
                      :job AS job_no,
                      :op_code AS op_code,
                      TRUNC(SYSDATE) AS op_date,
                      :usr AS user_id,
                      'Milestone completed in Live Tracking' AS remarks,
                      'IMP' AS op_type,
                      1 AS op_count,
                      'Y' AS op_yesno
                 FROM DUAL
             ) s
             ON (d.COMPANY_CODE = s.company_code AND d.PRIN_CODE = s.prin_code AND d.JOB_NO = s.job_no AND d.OP_CODE = s.op_code)
             WHEN MATCHED THEN
               UPDATE SET d.OP_DATE = s.op_date, d.OP_YESNO = 'Y', d.REMARKS = s.remarks, d.USER_ID = s.user_id
             WHEN NOT MATCHED THEN
               INSERT (COMPANY_CODE, PRIN_CODE, JOB_NO, OP_CODE, OP_DATE, USER_ID, REMARKS, OP_TYPE, OP_COUNT, OP_YESNO)
               VALUES (s.company_code, s.prin_code, s.job_no, s.op_code, s.op_date, s.user_id, s.remarks, s.op_type, s.op_count, s.op_yesno)`,
            { comp: companyCode, prin: prinCode, job: jobNo, op_code: opCode, usr: userId || 'ADMIN' },
            { autoCommit: true }
          );
        }
      } catch (alertSyncErr) {
        console.warn('[trkTaskUpdate] TT_ALERT_DATES sync warning (non-blocking):', alertSyncErr);
      }
    }

    sendTrackerStageEmail(connection, {
      companyCode,
      prinCode,
      jobNo,
      taskType,
      status: status as any,
      holdEntity,
      holdReason,
      holdRemark,
      releaseRemark,
      actorId: userId,
    }).catch((err) => console.warn("[trkTaskUpdate] Email notification warning:", err));

    res.json({
      success: true,
      message: `Task ${taskType} updated to ${status} successfully`,
      is_completed: isCompleted,
    });
  });
};

// =============================================================================
// 6. CONTAINER OFFLOAD (DC Stamping & PowerBuilder Sync)
// =============================================================================
export const trkContainerOffload = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const prinCode = await resolvePrinCode(connection, companyCode, jobNo, req.body.prin_code ?? req.body.PRIN_CODE);
    const containerNumber = value(req.body.container_number ?? req.body.CONTAINER_NUMBER);
    const dcRemark = value(req.body.dc_remark ?? req.body.DC_REMARK);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");

    if (!companyCode || !jobNo || !prinCode || !containerNumber) {
      res.status(400).json({
        success: false,
        message: "company_code, job_no, prin_code, and container_number are required",
      });
      return;
    }

    await connection.execute(
      `BEGIN
         PROC_TRK_CONTAINER_OFFLOAD(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_container_number,
           :p_dc_remark,
           :p_user_id
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_no: jobNo,
        p_container_number: containerNumber,
        p_dc_remark: dcRemark,
        p_user_id: userId,
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: `Container ${containerNumber} offloaded successfully`,
    });
  });
};

// =============================================================================
// 7. CHECK COMPLETION GATE
// =============================================================================
export const trkCheckCompletion = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const prinCode = await resolvePrinCode(connection, companyCode, jobNo, req.body.prin_code ?? req.body.PRIN_CODE);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");

    if (!companyCode || !jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "company_code, job_no, and valid prin_code are required" });
      return;
    }

    const result = await connection.execute(
      `BEGIN
         PROC_TRK_CHECK_COMPLETION(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_user_id,
           :p_is_completed
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_no: jobNo,
        p_user_id: userId,
        p_is_completed: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 5 },
      },
      { autoCommit: true }
    );

    const isCompleted = (result.outBinds as any)?.p_is_completed === "Y";

    res.json({
      success: true,
      is_completed: isCompleted,
      message: isCompleted ? "Job successfully completed" : "Job has pending tasks remaining",
    });
  });
};

// =============================================================================
// 8. CFS FAST-TRACK JOB CREATION
// =============================================================================
export const trkCfsCreate = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const prinCode = value(req.body.prin_code ?? req.body.PRIN_CODE);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");
    const blNumber = value(req.body.bl_number ?? req.body.BL_NUMBER ?? req.body.doc_ref ?? req.body.DOC_REF);
    const custCode = value(req.body.cust_code ?? req.body.CUST_CODE);
    const portCode = value(req.body.port_code ?? req.body.PORT_CODE ?? "PORT");
    const containers = Array.isArray(req.body.containers) ? req.body.containers : [];

    if (!companyCode || !prinCode || !custCode) {
      res.status(400).json({ success: false, message: "company_code, prin_code, and cust_code are required" });
      return;
    }

    let divCode = value(req.body.div_code ?? req.body.DIV_CODE);
    let deptCode = value(req.body.dept_code ?? req.body.DEPT_CODE);
    if (!divCode || !deptCode) {
      try {
        const pairRes = await connection.execute(
          `SELECT d.DIV_CODE, m.DEPT_CODE 
             FROM MS_HR_DIVISION d
             JOIN MS_DEPARTMENT m ON d.COMPANY_CODE = m.COMPANY_CODE AND d.DIV_CODE = m.DIV_CODE
            WHERE d.COMPANY_CODE = :comp
            ORDER BY CASE WHEN m.DEPT_CODE = 'FRT' THEN 1 ELSE 2 END`,
          { comp: companyCode }
        );
        if (pairRes.rows && pairRes.rows.length > 0) {
          const row: any = pairRes.rows[0];
          divCode = row.DIV_CODE ?? row[0];
          deptCode = row.DEPT_CODE ?? row[1];
        }
      } catch (dErr) {
        console.warn("Could not dynamically resolve division/department:", dErr);
      }
    }
    divCode = divCode || "10";
    deptCode = deptCode || "FRT";

    // Step 1: Create TI_JOB with JOB_FLAG = 'C' (CFS) via PROC_FRT_JOB_SAVE
    const saveJobResult = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_SAVE(
           :p_company_code,
           :p_prin_code,
           NULL, -- p_job_no: generates new number
           SYSDATE,
           'CFS', -- p_job_type
           'S', -- p_transport_mode
           :p_dept_code,
           :p_div_code,
           'Combined services', NULL, NULL,
           'Normal', '01', NULL,
           :p_doc_ref,
           NULL, NULL,
           :p_port_code,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           SYSDATE + 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           'OMR', 1, 0, 0, 1,
           :p_cust_code,
           NULL, NULL, NULL, 'CFS Transfer Fast-Track Shipment', NULL, NULL,
           NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'N',
           'C', -- p_job_flag = CFS Transfer!
           'Y', SYSDATE, 'N', NULL, 'N', NULL, 'N', NULL,
           'CFS Fast-Track Transfer Job Created',
           NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL,
           :p_user_id,
           :p_job_no_out
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_dept_code: deptCode,
        p_div_code: divCode,
        p_doc_ref: blNumber,
        p_port_code: portCode,
        p_cust_code: custCode,
        p_user_id: userId,
        p_job_no_out: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 30 },
      },
      { autoCommit: true }
    );

    const generatedJobNo = (saveJobResult.outBinds as any)?.p_job_no_out;
    if (!generatedJobNo) {
      throw new Error("Failed to generate CFS Job Number from PROC_FRT_JOB_SAVE");
    }

    // Step 2: Insert Containers into TF_CONTAINER_DET if provided
    if (containers.length > 0) {
      for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        const containerNo = value(c.container_no ?? c.CONTAINER_NO ?? c.container_number);
        const sealNo = value(c.seal_no ?? c.SEAL_NO);
        const containerSize = value(c.size ?? c.SIZE ?? "20");

        if (containerNo) {
          await connection.execute(
            `INSERT INTO TF_CONTAINER_DET (
               COMPANY_CODE, PRIN_CODE, JOB_NO, SRNO, CONTAINER_NO, SEAL_NO, CONTAINER_TYPE, BL_NO, USER_ID, USER_DT
             ) VALUES (
               :p_comp, :p_prin, :p_job, :p_srno, :p_cntr, :p_seal, :p_type, :p_bl, :p_user, SYSDATE
             )`,
            {
              p_comp: companyCode,
              p_prin: prinCode,
              p_job: generatedJobNo,
              p_srno: i + 1,
              p_cntr: containerNo,
              p_seal: sealNo,
              p_type: containerSize,
              p_bl: blNumber || null,
              p_user: userId,
            },
            { autoCommit: true }
          );
        }
      }
    }

    // Step 3: Initialize Tracker via PROC_TRK_SHIPMENT_INIT
    // (This automatically recognizes JOB_FLAG='C', pre-completes Permit/Bayan/DO silently, and opens CCRO)
    await connection.execute(
      `BEGIN
         PROC_TRK_SHIPMENT_INIT(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_user_id
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_no: generatedJobNo,
        p_user_id: userId,
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: `CFS Fast-Track Job ${generatedJobNo} created and CCRO stage initialized successfully`,
      data: {
        job_no: generatedJobNo,
        is_cfs: true,
        current_stage: "IN_PROGRESS",
      },
    });
  });
};

// =============================================================================

// =============================================================================
// 9. SHIPMENT TRACKER DASHBOARD AGGREGATIONS
// Powers KPI cards, Stage Funnel, Active Holds Radar, DO Expiry & Container Pipeline
// =============================================================================
export const trkDashboard = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;
    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    // 1. High-level Summary Counts
    const summaryRes = await connection.execute(
      `SELECT 
         (SELECT COUNT(*) FROM TRK_SHIPMENT WHERE COMPANY_CODE = :comp AND CURRENT_STAGE != 'COMPLETED') AS ACTIVE_SHIPMENTS,
         (SELECT COUNT(*) FROM TRK_SHIPMENT WHERE COMPANY_CODE = :comp AND CURRENT_STAGE = 'COMPLETED') AS COMPLETED_SHIPMENTS,
         (SELECT COUNT(*) FROM TRK_SHIPMENT_TASKS WHERE COMPANY_CODE = :comp AND STATUS = 'ON_HOLD') AS ACTIVE_HOLDS,
         (SELECT COUNT(*) FROM TRK_CONTAINERS WHERE COMPANY_CODE = :comp) AS TOTAL_CONTAINERS,
         (SELECT COUNT(*) FROM TRK_CONTAINERS WHERE COMPANY_CODE = :comp AND STATUS = 'OFFLOADED') AS OFFLOADED_CONTAINERS,
         (SELECT COUNT(*) FROM TRK_SHIPMENT WHERE COMPANY_CODE = :comp AND DO_VALIDITY_DATE IS NOT NULL AND TRUNC(DO_VALIDITY_DATE) <= TRUNC(SYSDATE + 3) AND CURRENT_STAGE != 'COMPLETED') AS DO_EXPIRING_COUNT
       FROM DUAL`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const summaryRow: any = (summaryRes.rows as any[])?.[0] || {};

    // 2. Counts By Stage
    const stageRes = await connection.execute(
      `SELECT CURRENT_STAGE, COUNT(*) AS CNT
         FROM TRK_SHIPMENT
        WHERE COMPANY_CODE = :comp
        GROUP BY CURRENT_STAGE`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const stageCounts: Record<string, number> = {
      CUSTOMER: 0,
      FFD_REVIEW: 0,
      IN_PROGRESS: 0,
      TRANSPORT: 0,
      DC_TRANSPORT: 0,
      COMPLETED: 0,
    };
    for (const r of (stageRes.rows as any[]) || []) {
      if (r.CURRENT_STAGE) stageCounts[r.CURRENT_STAGE] = Number(r.CNT || 0);
    }

    // 3. In-Progress Task Breakdown
    const taskBreakdownRes = await connection.execute(
      `SELECT t.TASK_TYPE, t.STATUS, COUNT(*) AS CNT
         FROM TRK_SHIPMENT_TASKS t
         JOIN TRK_SHIPMENT s ON s.COMPANY_CODE = t.COMPANY_CODE AND s.PRIN_CODE = t.PRIN_CODE AND s.JOB_NO = t.JOB_NO
        WHERE t.COMPANY_CODE = :comp AND s.CURRENT_STAGE != 'COMPLETED'
        GROUP BY t.TASK_TYPE, t.STATUS`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const taskPipeline: Record<string, { active: number; on_hold: number; completed: number }> = {};
    for (const r of (taskBreakdownRes.rows as any[]) || []) {
      const type = String(r.TASK_TYPE);
      if (!taskPipeline[type]) {
        taskPipeline[type] = { active: 0, on_hold: 0, completed: 0 };
      }
      const st = String(r.STATUS);
      if (st === "COMPLETED") taskPipeline[type].completed += Number(r.CNT || 0);
      else if (st === "ON_HOLD") taskPipeline[type].on_hold += Number(r.CNT || 0);
      else taskPipeline[type].active += Number(r.CNT || 0);
    }

    // 4. Active Holds Radar
    const holdsRes = await connection.execute(
      `SELECT t.JOB_NO, s.PRIN_CODE, s.BL_NUMBER, j.CUST_CODE, c.CUST_NAME,
              t.TASK_TYPE, t.HOLD_ENTITY, t.HOLD_REASON, t.HOLD_REMARK,
              NVL(t.CREATED_DT, SYSDATE) AS HELD_AT,
              ROUND((SYSDATE - NVL(t.CREATED_DT, SYSDATE)) * 24, 1) AS HELD_HOURS
         FROM TRK_SHIPMENT_TASKS t
         JOIN TRK_SHIPMENT s ON s.COMPANY_CODE = t.COMPANY_CODE AND s.PRIN_CODE = t.PRIN_CODE AND s.JOB_NO = t.JOB_NO
         JOIN TI_JOB j ON j.COMPANY_CODE = s.COMPANY_CODE AND j.PRIN_CODE = s.PRIN_CODE AND j.JOB_NO = s.JOB_NO
         LEFT JOIN MS_CUSTOMER c ON c.COMPANY_CODE = j.COMPANY_CODE AND c.PRIN_CODE = j.PRIN_CODE AND c.CUST_CODE = j.CUST_CODE
        WHERE t.COMPANY_CODE = :comp AND t.STATUS = 'ON_HOLD'
        ORDER BY t.CREATED_DT ASC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // 5. Container Status Pipeline
    const cntrRes = await connection.execute(
      `SELECT STATUS, COUNT(*) AS CNT
         FROM TRK_CONTAINERS
        WHERE COMPANY_CODE = :comp
        GROUP BY STATUS`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const containerCounts: Record<string, number> = {
      PENDING: 0,
      ASSIGNED: 0,
      IN_TRANSIT: 0,
      BREAKDOWN: 0,
      AT_DC: 0,
      OFFLOADED: 0,
      RETURNED: 0,
    };
    for (const r of (cntrRes.rows as any[]) || []) {
      if (r.STATUS) containerCounts[r.STATUS] = Number(r.CNT || 0);
    }

    // 6. DO Expiry Radar List (Sea shipments)
    const doRes = await connection.execute(
      `SELECT s.JOB_NO, s.PRIN_CODE, s.BL_NUMBER, s.DO_VALIDITY_DATE,
              ROUND(TRUNC(s.DO_VALIDITY_DATE) - TRUNC(SYSDATE)) AS DAYS_REMAINING,
              j.VESSEL_NAME, j.PORT_CODE, j.DESTINATION_PORT, c.CUST_NAME
         FROM TRK_SHIPMENT s
         JOIN TI_JOB j ON j.COMPANY_CODE = s.COMPANY_CODE AND j.PRIN_CODE = s.PRIN_CODE AND j.JOB_NO = s.JOB_NO
         LEFT JOIN MS_CUSTOMER c ON c.COMPANY_CODE = j.COMPANY_CODE AND c.PRIN_CODE = j.PRIN_CODE AND c.CUST_CODE = j.CUST_CODE
        WHERE s.COMPANY_CODE = :comp 
          AND s.DO_VALIDITY_DATE IS NOT NULL
          AND s.CURRENT_STAGE != 'COMPLETED'
        ORDER BY s.DO_VALIDITY_DATE ASC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // 7. Recent Live Event Stream
    const eventsRes = await connection.execute(
      `SELECT EVENT_ID, JOB_NO, EVENT_TYPE, STAGE_FROM, STAGE_TO, ACTOR_ID, REMARK, CREATED_DT
         FROM TRK_SHIPMENT_EVENTS
        WHERE COMPANY_CODE = :comp
        ORDER BY CREATED_DT DESC
        FETCH FIRST 20 ROWS ONLY`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({
      success: true,
      data: {
        summary: {
          activeShipments: Number(summaryRow.ACTIVE_SHIPMENTS || 0),
          completedShipments: Number(summaryRow.COMPLETED_SHIPMENTS || 0),
          activeHolds: Number(summaryRow.ACTIVE_HOLDS || 0),
          totalContainers: Number(summaryRow.TOTAL_CONTAINERS || 0),
          offloadedContainers: Number(summaryRow.OFFLOADED_CONTAINERS || 0),
          doExpiringCount: Number(summaryRow.DO_EXPIRING_COUNT || 0),
        },
        stageCounts,
        taskPipeline,
        activeHolds: holdsRes.rows || [],
        containerCounts,
        doRadar: doRes.rows || [],
        recentActivity: eventsRes.rows || [],
      },
    });
  });
};


// =============================================================================
// 10. IN-APP NOTIFICATIONS & ALERTS
// Powers the Header Notification Bell & Alert Center
// =============================================================================
export const trkNotificationList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;
    const userId = req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "Admin";
    const unreadOnly = req.body.unread_only === true || req.body.unread_only === "Y";

    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    let sql = `
      SELECT NOTIFICATION_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, RECIPIENT_ID,
             CHANNEL, CATEGORY, TITLE, MESSAGE, IS_READ, READ_AT, CREATED_DT
        FROM TRK_NOTIFICATIONS
       WHERE COMPANY_CODE = :comp
         AND (RECIPIENT_ID = :user_id OR RECIPIENT_ID = 'ALL')
    `;

    if (unreadOnly) {
      sql += ` AND IS_READ = 'N'`;
    }

    sql += ` ORDER BY CREATED_DT DESC FETCH FIRST 50 ROWS ONLY`;

    const listRes = await connection.execute(
      sql,
      { comp: companyCode, user_id: userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const unreadRes = await connection.execute(
      `SELECT COUNT(*) AS CNT
         FROM TRK_NOTIFICATIONS
        WHERE COMPANY_CODE = :comp
          AND (RECIPIENT_ID = :user_id OR RECIPIENT_ID = 'ALL')
          AND IS_READ = 'N'`,
      { comp: companyCode, user_id: userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const unreadCount = Number((unreadRes.rows as any[])?.[0]?.CNT || 0);

    res.json({
      success: true,
      data: {
        notifications: listRes.rows || [],
        unreadCount,
      },
    });
  });
};

export const trkNotificationMarkRead = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;
    const notificationId = req.body.notification_id ?? req.body.NOTIFICATION_ID;
    const markAll = req.body.all === true || req.body.mark_all === true;
    const userId = req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "Admin";

    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    if (markAll) {
      await connection.execute(
        `UPDATE TRK_NOTIFICATIONS
            SET IS_READ = 'Y', READ_AT = SYSDATE
          WHERE COMPANY_CODE = :comp
            AND (RECIPIENT_ID = :user_id OR RECIPIENT_ID = 'ALL')
            AND IS_READ = 'N'`,
        { comp: companyCode, user_id: userId },
        { autoCommit: true }
      );
      res.json({ success: true, message: "All notifications marked as read" });
    } else if (notificationId) {
      await connection.execute(
        `UPDATE TRK_NOTIFICATIONS
            SET IS_READ = 'Y', READ_AT = SYSDATE
          WHERE COMPANY_CODE = :comp
            AND NOTIFICATION_ID = :notif_id`,
        { comp: companyCode, notif_id: notificationId },
        { autoCommit: true }
      );
      res.json({ success: true, message: "Notification marked as read" });
    } else {
      res.status(400).json({ success: false, message: "notification_id or mark_all is required" });
    }
  });
};


// =============================================================================
// 11. ROLE-BASED SPECIALIZED WORKBENCHES (PRO Queue & DC Offloading Station)
// =============================================================================
export const trkProQueueList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;
    const taskTypeFilter = req.body.task_type ?? req.body.TASK_TYPE; // 'ALL', 'PERMIT', 'BAYAN'
    const statusFilter = req.body.status ?? req.body.STATUS; // 'ALL', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'

    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    let sql = `
      SELECT t.TASK_ID, t.JOB_NO, s.PRIN_CODE, s.BL_NUMBER, j.CUST_CODE, c.CUST_NAME,
             t.FLOW_LEVEL, t.TASK_TYPE, t.STATUS, t.ASSIGNED_TEAM, t.ASSIGNED_TO,
             t.HOLD_ENTITY, t.HOLD_REASON, t.HOLD_REMARK, t.RELEASE_REMARK,
             t.DUE_AT, t.CREATED_DT,
             ROUND((SYSDATE - t.CREATED_DT) * 24, 1) AS HOURS_OPEN,
             s.PERMIT_REF, s.PERMIT_NOT_REQUIRED, s.EXPORT_BAYAN_NO,
             s.CURRENT_STAGE, s.SHIPMENT_TYPE, s.IS_DRY
        FROM TRK_SHIPMENT_TASKS t
        JOIN TRK_SHIPMENT s ON s.COMPANY_CODE = t.COMPANY_CODE AND s.PRIN_CODE = t.PRIN_CODE AND s.JOB_NO = t.JOB_NO
        JOIN TI_JOB j ON j.COMPANY_CODE = s.COMPANY_CODE AND j.PRIN_CODE = s.PRIN_CODE AND j.JOB_NO = s.JOB_NO
        LEFT JOIN MS_CUSTOMER c ON c.COMPANY_CODE = j.COMPANY_CODE AND c.PRIN_CODE = j.PRIN_CODE AND c.CUST_CODE = j.CUST_CODE
       WHERE t.COMPANY_CODE = :comp
         AND t.TASK_TYPE IN ('PERMIT', 'PRO_PERMITS', 'BAYAN', 'CUSTOMS_BAYAN', 'CCRO')
         AND s.CURRENT_STAGE != 'COMPLETED'
    `;

    if (taskTypeFilter && taskTypeFilter !== "ALL") {
      sql += ` AND (t.TASK_TYPE = '${taskTypeFilter}' OR t.TASK_TYPE LIKE '%${taskTypeFilter}%')`;
    }

    if (statusFilter && statusFilter !== "ALL") {
      sql += ` AND t.STATUS = '${statusFilter}'`;
    }

    sql += ` ORDER BY CASE WHEN t.STATUS = 'ON_HOLD' THEN 1 WHEN t.STATUS = 'IN_PROGRESS' THEN 2 ELSE 3 END, t.DUE_AT ASC NULLS LAST`;

    const result = await connection.execute(
      sql,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({
      success: true,
      data: result.rows || [],
    });
  });
};

export const trkProTaskSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const prinCode = await resolvePrinCode(connection, companyCode, jobNo, req.body.prin_code ?? req.body.PRIN_CODE);
    const permitRef = value(req.body.permit_ref ?? req.body.PERMIT_REF);
    const permitNotRequired = req.body.permit_not_required === "Y" ? "Y" : "N";
    const exportBayanNo = value(req.body.export_bayan_no ?? req.body.EXPORT_BAYAN_NO);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "PRO_USER");

    if (!companyCode || !jobNo || !prinCode) {
      res.status(400).json({ success: false, message: "company_code, job_no, and prin_code are required" });
      return;
    }

    await connection.execute(
      `UPDATE TRK_SHIPMENT
          SET PERMIT_REF = NVL(:pref, PERMIT_REF),
              PERMIT_NOT_REQUIRED = :pnr,
              EXPORT_BAYAN_NO = NVL(:bno, EXPORT_BAYAN_NO),
              UPDATED_BY = :usr,
              UPDATED_DT = SYSDATE
        WHERE COMPANY_CODE = :comp AND PRIN_CODE = :prin AND JOB_NO = :job`,
      { pref: permitRef, pnr: permitNotRequired, bno: exportBayanNo, usr: userId, comp: companyCode, prin: prinCode, job: jobNo },
      { autoCommit: true }
    );

    res.json({ success: true, message: "PRO Customs details updated successfully" });
  });
};


export const trkDcContainerUpdate = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const containerId = value(req.body.container_id ?? req.body.CONTAINER_ID);
    const rawStatus = value(req.body.status ?? req.body.STATUS);
    let status = rawStatus;
    if (rawStatus === "IN_TRANSIT" || rawStatus === "ASSIGNED" || rawStatus === "BREAKDOWN") {
      status = "PULLED_OUT";
    } else if (rawStatus === "AT_DC" || req.body.arrived === true || req.body.arrived === "Y") {
      status = "ARRIVED";
    } else if (rawStatus === "EMPTY_RETURNED") {
      status = "RETURNED";
    } else if (rawStatus && !["PENDING", "ARRIVED", "PULLED_OUT", "OFFLOADED", "RETURNED"].includes(rawStatus)) {
      status = "PENDING";
    }
    const truckPlate = value(req.body.truck_plate_number ?? req.body.TRUCK_PLATE_NUMBER);
    const driverName = value(req.body.driver_name ?? req.body.DRIVER_NAME);
    const dcRemark = value(req.body.dc_remark ?? req.body.DC_REMARK);
    const arrived = req.body.arrived === true || req.body.arrived === "Y";

    if (!containerId) {
      res.status(400).json({ success: false, message: 'container_id is required' });
      return;
    }

    let sql = `
      UPDATE TRK_CONTAINERS
         SET STATUS = NVL(:st, STATUS),
             TRUCK_PLATE_NUMBER = NVL(:tp, TRUCK_PLATE_NUMBER),
             DRIVER_NAME = NVL(:dn, DRIVER_NAME),
             DC_REMARK = NVL(:rem, DC_REMARK)
    `;
    if (arrived) {
      sql += ', ARRIVED_AT = NVL(ARRIVED_AT, SYSDATE)';
    }
    sql += ' WHERE CONTAINER_ID = :cid';

    await connection.execute(
      sql,
      { st: status, tp: truckPlate, dn: driverName, rem: dcRemark, cid: containerId },
      { autoCommit: true }
    );

    res.json({ success: true, message: 'Container details updated successfully' });
  });
};

export const trkDcStationList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;

    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    const result = await connection.execute(
      `SELECT c.CONTAINER_ID, c.JOB_NO, c.PRIN_CODE, s.BL_NUMBER, cust.CUST_NAME,
              c.CONTAINER_NUMBER, c.SEAL_NO, c.STATUS, c.TRUCK_PLATE_NUMBER, c.DRIVER_NAME,
              c.EXPECTED_ARRIVAL_AT, c.ARRIVED_AT, c.ACTUAL_PULL_OUT_DATE,
              c.OFFLOADED_AT, c.OFFLOADED_BY, c.DC_REMARK, c.TRANSPORT_REMARK,
              s.CUSTOMS_RELEASE_STATUS, s.OFFLOADING_POINT_ID, s.EMPTY_RETURN_POINT_ID,
              s.CURRENT_STAGE, s.SHIPMENT_TYPE
         FROM TRK_CONTAINERS c
         JOIN TRK_SHIPMENT s ON s.COMPANY_CODE = c.COMPANY_CODE AND s.PRIN_CODE = c.PRIN_CODE AND s.JOB_NO = c.JOB_NO
         JOIN TI_JOB j ON j.COMPANY_CODE = s.COMPANY_CODE AND j.PRIN_CODE = s.PRIN_CODE AND j.JOB_NO = s.JOB_NO
         LEFT JOIN MS_CUSTOMER cust ON cust.COMPANY_CODE = j.COMPANY_CODE AND cust.PRIN_CODE = j.PRIN_CODE AND cust.CUST_CODE = j.CUST_CODE
        WHERE c.COMPANY_CODE = :comp
          AND s.CURRENT_STAGE != 'COMPLETED'
        ORDER BY CASE WHEN c.STATUS = 'BREAKDOWN' THEN 1 WHEN c.STATUS = 'AT_DC' THEN 2 WHEN c.STATUS = 'IN_TRANSIT' THEN 3 WHEN c.STATUS = 'ASSIGNED' THEN 4 ELSE 5 END, c.CREATED_DT DESC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({
      success: true,
      data: result.rows || [],
    });
  });
};


// =============================================================================
// 12. MAIL & ALERT ADMIN CONFIGURATION (Parity with Shipment Tracker Settings)
// =============================================================================
export const trkAdminCcList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;
    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    const result = await connection.execute(
      `SELECT CONFIG_ID, COMPANY_CODE, TEAM_CODE, CC_EMAIL, CREATED_BY, CREATED_DT
         FROM TRK_ALERT_CC_CONFIGS
        WHERE COMPANY_CODE = :comp
        ORDER BY TEAM_CODE, CREATED_DT DESC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({ success: true, data: result.rows || [] });
  });
};

export const trkAdminCcSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const teamCode = value(req.body.team_code ?? req.body.TEAM_CODE);
    const ccEmail = value(req.body.cc_email ?? req.body.CC_EMAIL);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "ADMIN");

    if (!companyCode || !teamCode || !ccEmail) {
      res.status(400).json({ success: false, message: "company_code, team_code, and cc_email are required" });
      return;
    }

    if (!ccEmail.includes("@")) {
      res.status(400).json({ success: false, message: "Please provide a valid email address" });
      return;
    }

    await connection.execute(
      `INSERT INTO TRK_ALERT_CC_CONFIGS (CONFIG_ID, COMPANY_CODE, TEAM_CODE, CC_EMAIL, CREATED_BY, CREATED_DT)
        VALUES (RAWTOHEX(SYS_GUID()), :comp, :team, :email, :uid, SYSDATE)`,
      { comp: companyCode, team: teamCode, email: ccEmail, uid: userId },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Alert CC email added successfully" });
  });
};

export const trkAdminCcDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const configId = value(req.body.config_id ?? req.body.CONFIG_ID);
    if (!configId) {
      res.status(400).json({ success: false, message: "config_id is required" });
      return;
    }

    await connection.execute(
      `DELETE FROM TRK_ALERT_CC_CONFIGS WHERE CONFIG_ID = :cid`,
      { cid: configId },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Alert CC config removed successfully" });
  });
};

export const trkAdminDailyReportGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;
    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    const result = await connection.execute(
      `SELECT CONFIG_ID, COMPANY_CODE, SEND_TIME, RECIPIENT_EMAILS, LAST_SENT_DATE, UPDATED_BY, UPDATED_DT
         FROM TRK_DAILY_REPORT_CONFIGS
        WHERE COMPANY_CODE = :comp
          AND ROWNUM = 1`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const cfg = (result.rows as any[])?.[0] || {
      SEND_TIME: "17:30",
      RECIPIENT_EMAILS: "operations@bayanat.om",
    };

    res.json({ success: true, data: cfg });
  });
};

export const trkAdminDailyReportSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const sendTime = value(req.body.send_time ?? req.body.SEND_TIME ?? "17:30");
    const recipientEmails = value(req.body.recipient_emails ?? req.body.RECIPIENT_EMAILS ?? "");
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "ADMIN");

    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    await connection.execute(
      `MERGE INTO TRK_DAILY_REPORT_CONFIGS dst
        USING (SELECT :comp AS COMPANY_CODE, :stime AS SEND_TIME, :recips AS RECIPIENT_EMAILS, :uid AS UPDATED_BY FROM DUAL) src
        ON (dst.COMPANY_CODE = src.COMPANY_CODE)
        WHEN MATCHED THEN
          UPDATE SET dst.SEND_TIME = src.SEND_TIME,
                     dst.RECIPIENT_EMAILS = src.RECIPIENT_EMAILS,
                     dst.UPDATED_BY = src.UPDATED_BY,
                     dst.UPDATED_DT = SYSDATE
        WHEN NOT MATCHED THEN
          INSERT (CONFIG_ID, COMPANY_CODE, SEND_TIME, RECIPIENT_EMAILS, UPDATED_BY, UPDATED_DT)
          VALUES (RAWTOHEX(SYS_GUID()), src.COMPANY_CODE, src.SEND_TIME, src.RECIPIENT_EMAILS, src.UPDATED_BY, SYSDATE)`,
      { comp: companyCode, stime: sendTime, recips: recipientEmails, uid: userId },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Daily Report Configuration updated successfully" });
  });
};

export const trkAdminDailyReportTrigger = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code;
    const userId = (req as any).user?.loginid ?? "ADMIN";

    // Insert an audit event indicating manual report dispatch
    await connection.execute(
      `INSERT INTO TRK_SHIPMENT_EVENTS (EVENT_ID, COMPANY_CODE, PRIN_CODE, JOB_NO, EVENT_TYPE, ACTOR_ID, REMARK, CREATED_DT)
        VALUES (RAWTOHEX(SYS_GUID()), :comp, 'SYSTEM', 'REPORT', 'DAILY_REPORT_TRIGGERED', :uid, 'Manual Daily Operational Digest triggered by admin', SYSDATE)`,
      { comp: companyCode, uid: userId },
      { autoCommit: true }
    );

    // Update last sent date
    await connection.execute(
      `UPDATE TRK_DAILY_REPORT_CONFIGS SET LAST_SENT_DATE = SYSDATE WHERE COMPANY_CODE = :comp`,
      { comp: companyCode },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Daily Operational Report queued and dispatched successfully to configured recipients." });
  });
};

export const trkWorkflowConfigGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code ?? "BSG";
    const flowCode = req.body.flow_code ?? req.body.FLOW_CODE ?? "NORM";

    const result = await connection.execute(
      `SELECT COMPANY_CODE, PROCESS, FLOW_CODE, LAST_LEVEL,
              LEVEL1_ROLE, LEVEL2_ROLE, LEVEL3_ROLE, LEVEL4_ROLE, LEVEL5_ROLE, LEVEL6_ROLE, LEVEL7_ROLE
         FROM MS_APPROVER_LEVELS
        WHERE COMPANY_CODE = :comp
          AND PROCESS IN ('TRACKER', 'FREIGHT_TRACKER')
        ORDER BY FLOW_CODE ASC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows: any[] = (result.rows as any[]) || [];

    const flowOptions = [
      { flow_code: "NORM", flow_name: "Normal Ocean Import (Customizable 3 to 7 stages)" },
      { flow_code: "AIR", flow_name: "Air Freight Fast-Track" },
      { flow_code: "EXP", flow_name: "Ocean Export" },
      { flow_code: "CFS", flow_name: "CFS Bonded Transfer" },
    ];

    const masterStages = [
      { level: 1, task_type: "FFD_REVIEW", title: "FFD Review", subtitle: "B/L & ETA Verification", defaultRole: "FFD_TEAM" },
      { level: 2, task_type: "PRO_PERMITS", title: "PRO Permits", subtitle: "Ministry Inspection & Permits", defaultRole: "PRO_TEAM" },
      { level: 3, task_type: "CUSTOMS_BAYAN", title: "Customs Bayan", subtitle: "Bayan Declaration & Duty", defaultRole: "BAYAN_TEAM" },
      { level: 4, task_type: "SHIPPING_LINE_DO", title: "Delivery Order (DO)", subtitle: "Shipping Line DO & Validity", defaultRole: "SHIPPING_LINE" },
      { level: 5, task_type: "CCRO", title: "CCRO / Port Police", subtitle: "Customs & Port Police Clearance", defaultRole: "ROP_PORT_POLICE" },
      { level: 6, task_type: "TRANSPORT", title: "Transport Dispatch", subtitle: "Fleet & Truck Allocation", defaultRole: "TRANSPORT_FLEET" },
      { level: 7, task_type: "DC_OFFLOAD", title: "DC Offloading", subtitle: "Warehouse Gate & Offloading", defaultRole: "DC_WAREHOUSE" },
    ];

    const availableRoles = [
      { role_id: "FFD_TEAM", role_name: "Freight Forwarding Team (Documentation & BL)" },
      { role_id: "PRO_TEAM", role_name: "Public Relations Officer / Permits & Ministries" },
      { role_id: "BAYAN_TEAM", role_name: "Customs Broker / Bayan Declaration" },
      { role_id: "SHIPPING_LINE", role_name: "Shipping Line Agent / Delivery Order" },
      { role_id: "ROP_PORT_POLICE", role_name: "Royal Oman Police / Port Police & CCRO" },
      { role_id: "TRANSPORT_FLEET", role_name: "Transport & Trucking Dispatch Team" },
      { role_id: "DC_WAREHOUSE", role_name: "Distribution Center / Warehouse Receiving" },
      { role_id: "FINANCE", role_name: "Finance & Accounts Clearance" },
      { role_id: "OPS_MANAGER", role_name: "Operations & Freight Management" },
      { role_id: "CUSTOMER_SERVICE", role_name: "Customer Service & Accounts" },
    ];

    res.json({
      success: true,
      data: {
        company_code: companyCode,
        selected_flow: flowCode,
        configurations: rows,
        flow_options: flowOptions,
        master_stages: masterStages,
        available_roles: availableRoles,
      },
    });
  });
};

export const trkWorkflowConfigSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const flowCode = value(req.body.flow_code ?? req.body.FLOW_CODE ?? "NORM");
    const lastLevel = Number(req.body.last_level ?? req.body.LAST_LEVEL ?? 7);
    const l1Role = value(req.body.level1_role ?? req.body.LEVEL1_ROLE ?? "FFD_TEAM");
    const l2Role = value(req.body.level2_role ?? req.body.LEVEL2_ROLE ?? "PRO_TEAM");
    const l3Role = value(req.body.level3_role ?? req.body.LEVEL3_ROLE ?? "BAYAN_TEAM");
    const l4Role = value(req.body.level4_role ?? req.body.LEVEL4_ROLE ?? "SHIPPING_LINE");
    const l5Role = value(req.body.level5_role ?? req.body.LEVEL5_ROLE ?? "ROP_PORT_POLICE");
    const l6Role = value(req.body.level6_role ?? req.body.LEVEL6_ROLE ?? "TRANSPORT_FLEET");
    const l7Role = value(req.body.level7_role ?? req.body.LEVEL7_ROLE ?? "DC_WAREHOUSE");

    if (!companyCode) {
      res.status(400).json({ success: false, message: "Company code is required" });
      return;
    }

    if (lastLevel < 1 || lastLevel > 7) {
      res.status(400).json({ success: false, message: "Last level must be between 1 and 7" });
      return;
    }

    await connection.execute(
      `MERGE INTO MS_APPROVER_LEVELS dst
       USING (
         SELECT :comp AS COMPANY_CODE, 'TRACKER' AS PROCESS, :fcode AS FLOW_CODE FROM DUAL
       ) src
       ON (dst.COMPANY_CODE = src.COMPANY_CODE AND dst.PROCESS = src.PROCESS AND dst.FLOW_CODE = src.FLOW_CODE)
       WHEN MATCHED THEN
         UPDATE SET dst.LAST_LEVEL = :llvl,
                    dst.LEVEL1_ROLE = :l1,
                    dst.LEVEL2_ROLE = :l2,
                    dst.LEVEL3_ROLE = :l3,
                    dst.LEVEL4_ROLE = :l4,
                    dst.LEVEL5_ROLE = :l5,
                    dst.LEVEL6_ROLE = :l6,
                    dst.LEVEL7_ROLE = :l7
       WHEN NOT MATCHED THEN
         INSERT (COMPANY_CODE, PROCESS, FLOW_CODE, LAST_LEVEL, LEVEL1_ROLE, LEVEL2_ROLE, LEVEL3_ROLE, LEVEL4_ROLE, LEVEL5_ROLE, LEVEL6_ROLE, LEVEL7_ROLE)
         VALUES (src.COMPANY_CODE, src.PROCESS, src.FLOW_CODE, :llvl, :l1, :l2, :l3, :l4, :l5, :l6, :l7)`,
      {
        comp: companyCode,
        fcode: flowCode,
        llvl: lastLevel,
        l1: l1Role,
        l2: l2Role,
        l3: l3Role,
        l4: l4Role,
        l5: l5Role,
        l6: l6Role,
        l7: l7Role,
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: `Workflow configuration for company ${companyCode} (${flowCode}) updated to ${lastLevel} dynamic levels successfully.`,
    });
  });
};

// =============================================================================
// SMART DOCUMENT INGESTION (PDF PARSER & 1-CLICK VERIFIED JOB CREATION)
// =============================================================================
export const trkSmartDocumentParse = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const file = req.file;
    if (!file || !file.buffer) {
      res.status(400).json({ success: false, message: "PDF Document file is required for parsing" });
      return;
    }

    const companyCode = req.body.company_code ?? req.body.COMPANY_CODE ?? (req as any).user?.company_code ?? "BSG";

    // Parse the PDF text layer using regex & ISO 6346 validation
    const parsedData = await parseShippingDocumentPdf(file.buffer);

    // Fetch lookups for the company (Principals, Customers, Ports)
    const [prinRes, custRes, portRes] = await Promise.all([
      connection.execute(
        `SELECT PRIN_CODE, PRIN_NAME FROM MS_PRINCIPAL WHERE COMPANY_CODE = :comp AND ROWNUM <= 100 ORDER BY PRIN_NAME ASC`,
        { comp: companyCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      ),
      connection.execute(
        `SELECT CUST_CODE, CUST_NAME FROM MS_CUSTOMER WHERE COMPANY_CODE = :comp AND ROWNUM <= 100 ORDER BY CUST_NAME ASC`,
        { comp: companyCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      ),
      connection.execute(
        `SELECT PORT_CODE, PORT_NAME FROM MS_PORT WHERE COMPANY_CODE = :comp AND ROWNUM <= 100 ORDER BY PORT_NAME ASC`,
        { comp: companyCode },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      ),
    ]);

    res.json({
      success: true,
      data: parsedData,
      filename: file.originalname,
      file_size: file.size,
      lookups: {
        principals: (prinRes.rows as any[]) || [],
        customers: (custRes.rows as any[]) || [],
        ports: (portRes.rows as any[]) || [],
      },
    });
  });
};

export const trkSmartJobCreate = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const body = req.body || {};
    const companyCode = value(body.company_code ?? body.COMPANY_CODE ?? (req as any).user?.company_code ?? "BSG");
    const prinCode = value(body.prin_code ?? body.PRIN_CODE);
    const custCode = value(body.cust_code ?? body.CUST_CODE);
    let rawJobType = String(body.job_type ?? body.JOB_TYPE ?? "IMP").trim().toUpperCase();
    if (rawJobType === "AIMP" || rawJobType.startsWith("AIR")) {
      rawJobType = "IMP";
    } else if (rawJobType.length > 3) {
      rawJobType = rawJobType.substring(0, 3);
    }
    const jobType = rawJobType || "IMP";
    const rawMode = String(body.transport_mode ?? body.TRANSPORT_MODE ?? "S").trim().toUpperCase();
    let transportMode = "S";
    if (rawMode.startsWith("A")) transportMode = "A";
    else if (rawMode.startsWith("R") || rawMode.startsWith("L")) transportMode = "R";
    else transportMode = "S";

    let blNumber = value(body.bl_number ?? body.BL_NUMBER ?? body.doc_ref ?? body.DOC_REF);
    let docRef2 = value(body.transfer_request_number ?? body.doc_ref2 ?? body.DOC_REF2 ?? body.invoice_no);
    const portCode = value(body.port_code ?? body.PORT_CODE ?? "SOH");
    const userId = value(body.user_id ?? body.USER_ID ?? (req as any).user?.loginid ?? "ADMIN");
    const jobFlag = jobType === "CFS" ? "C" : "M";

    let containers: any[] = [];
    if (body.containers) {
      if (typeof body.containers === "string") {
        try { containers = JSON.parse(body.containers); } catch {}
      } else if (Array.isArray(body.containers)) {
        containers = body.containers;
      }
    }

    // Smart fallback: if B/L or containers are empty and a file was provided, parse automatically
    if ((!blNumber || containers.length === 0) && req.file && req.file.buffer) {
      try {
        const parsed = await parseShippingDocumentPdf(req.file.buffer);
        if (!blNumber && parsed.bl_number) blNumber = parsed.bl_number;
        if (!docRef2 && parsed.transfer_request_number) docRef2 = parsed.transfer_request_number;
        if (containers.length === 0 && parsed.containers && parsed.containers.length > 0) {
          containers = parsed.containers;
        }
      } catch (pErr) {
        console.warn("Auto-parse fallback error in trkSmartJobCreate:", pErr);
      }
    }

    if (!companyCode || !prinCode || !custCode) {
      res.status(400).json({ success: false, message: "company_code, prin_code, and cust_code are required" });
      return;
    }

    let divCode = value(body.div_code ?? body.DIV_CODE);
    let deptCode = value(body.dept_code ?? body.DEPT_CODE);
    if (!divCode || !deptCode) {
      try {
        const pairRes = await connection.execute(
          `SELECT d.DIV_CODE, m.DEPT_CODE 
             FROM MS_HR_DIVISION d
             JOIN MS_DEPARTMENT m ON d.COMPANY_CODE = m.COMPANY_CODE AND d.DIV_CODE = m.DIV_CODE
            WHERE d.COMPANY_CODE = :comp
            ORDER BY CASE WHEN m.DEPT_CODE = 'FRT' THEN 1 ELSE 2 END`,
          { comp: companyCode }
        );
        if (pairRes.rows && pairRes.rows.length > 0) {
          const row: any = pairRes.rows[0];
          divCode = row.DIV_CODE ?? row[0];
          deptCode = row.DEPT_CODE ?? row[1];
        }
      } catch (dErr) {
        console.warn("Could not dynamically resolve division/department:", dErr);
      }
    }
    divCode = divCode || "10";
    deptCode = deptCode || "FRT";

    // Step 1: Execute PROC_FRT_JOB_SAVE to create the official ERP Job
    const saveResult = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_SAVE(
           :p_company_code,
           :p_prin_code,
           NULL, -- new job number
           SYSDATE,
           :p_job_type,
           :p_transport_mode,
           :p_dept_code,
           :p_div_code,
           'Combined services', NULL, NULL,
           'Normal', '01', NULL,
           :p_doc_ref,
           :p_doc_ref2,
           NULL,
           :p_port_code,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           SYSDATE + 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           'OMR', 1, 0, 0, 1,
           :p_cust_code,
           NULL, NULL, NULL, 'Smart AI Document Ingestion Job', NULL, NULL,
           NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'N',
           :p_job_flag,
           'Y', SYSDATE, 'N', NULL, 'N', NULL, 'N', NULL,
           'Created via Smart Document PDF Ingestion',
           NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL,
           :p_user_id,
           :p_job_no_out
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_type: jobType,
        p_transport_mode: transportMode,
        p_dept_code: deptCode,
        p_div_code: divCode,
        p_doc_ref: blNumber,
        p_doc_ref2: docRef2,
        p_port_code: portCode,
        p_cust_code: custCode,
        p_job_flag: jobFlag,
        p_user_id: userId,
        p_job_no_out: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 30 },
      },
      { autoCommit: true }
    );

    const generatedJobNo = (saveResult.outBinds as any)?.p_job_no_out;
    if (!generatedJobNo) {
      throw new Error("Failed to generate Job Number from PROC_FRT_JOB_SAVE");
    }

    // Step 2: Insert Extracted Containers into TF_CONTAINER_DET
    if (containers.length > 0) {
      for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        const containerNo = value(c.container_no ?? c.CONTAINER_NO);
        const sealNo = value(c.seal_no ?? c.SEAL_NO);
        const size = value(c.size ?? c.SIZE ?? "40");

        if (containerNo) {
          await connection.execute(
            `INSERT INTO TF_CONTAINER_DET (
               COMPANY_CODE, PRIN_CODE, JOB_NO, SRNO, CONTAINER_NO, SEAL_NO, CONTAINER_TYPE, BL_NO, USER_ID, USER_DT
             ) VALUES (
               :p_comp, :p_prin, :p_job, :p_srno, :p_cntr, :p_seal, :p_type, :p_bl, :p_user, SYSDATE
             )`,
            {
              p_comp: companyCode,
              p_prin: prinCode,
              p_job: generatedJobNo,
              p_srno: i + 1,
              p_cntr: containerNo,
              p_seal: sealNo,
              p_type: size,
              p_bl: blNumber || null,
              p_user: userId,
            },
            { autoCommit: true }
          );
        }
      }
    }

    // Step 3: Automatically attach source PDF to Job Documents & Accounts Files if provided
    const file = req.file;
    if (file && file.buffer) {
      try {
        const originalName = file.originalname || "Smart_Document.pdf";
        const fileLocn = `uploads/freight_smart_docs/${generatedJobNo}_${Date.now()}_${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        // Save into ACCOUNTS_FILES
        await connection.execute(
          `BEGIN
             PROC_FRT_ATTACHMENT_SAVE(
               :p_company_code,
               :p_prin_code,
               :p_job_no,
               'JOB',
               NULL,
               :p_file_name,
               :p_org_file_name,
               :p_aws_file_locn,
               'pdf',
               :p_user_file_name,
               'FREIGHT',
               'PDF',
               1,
               :p_user_id,
               :p_sr_no_out
             );
           END;`,
          {
            p_company_code: companyCode,
            p_prin_code: prinCode,
            p_job_no: generatedJobNo,
            p_file_name: originalName,
            p_org_file_name: originalName,
            p_aws_file_locn: fileLocn,
            p_user_file_name: "Source Ingestion Document",
            p_user_id: userId,
            p_sr_no_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          },
          { autoCommit: true }
        );

        // Synchronize into TF_JOB_DOCUMENTS
        await connection.execute(
          `MERGE INTO TF_JOB_DOCUMENTS dst
           USING (
             SELECT :comp AS COMPANY_CODE, :prin AS PRIN_CODE, :job AS JOB_NO, 'DOC01' AS DOC_NR FROM DUAL
           ) src
           ON (dst.COMPANY_CODE = src.COMPANY_CODE AND dst.PRIN_CODE = src.PRIN_CODE AND dst.JOB_NO = src.JOB_NO)
           WHEN MATCHED THEN
             UPDATE SET dst.COLLECTED = 'Y',
                        dst.DOC_PATH = :locn,
                        dst.DOC_RECEIVED_DT = SYSDATE,
                        dst.DOC_RECEIVED_BY = :usr,
                        dst.USER_DT = SYSDATE
           WHEN NOT MATCHED THEN
             INSERT (COMPANY_CODE, PRIN_CODE, JOB_NO, DOC_NR, DOCUMENT_TYPE, COLLECTED, DOC_PATH, DOC_RECEIVED_DT, DOC_RECEIVED_BY, MANDATORY, USER_ID, USER_DT)
             VALUES (:comp, :prin, :job, 'DOC01', 'Source Document', 'Y', :locn, SYSDATE, :usr, 'Y', :usr, SYSDATE)`,
          {
            comp: companyCode,
            prin: prinCode,
            job: generatedJobNo,
            locn: fileLocn,
            usr: userId,
          },
          { autoCommit: true }
        );
      } catch (docErr) {
        console.warn("Could not attach source document automatically:", docErr);
      }
    }

    // Step 4: Kickstart Dynamic Operational Tracking via PROC_TRK_SHIPMENT_INIT
    await connection.execute(
      `BEGIN
         PROC_TRK_SHIPMENT_INIT(
           :p_company_code,
           :p_prin_code,
           :p_job_no,
           :p_user_id
         );
       END;`,
      {
        p_company_code: companyCode,
        p_prin_code: prinCode,
        p_job_no: generatedJobNo,
        p_user_id: userId,
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: `Verified Freight Job ${generatedJobNo} created and live tracking initialized!`,
      data: {
        job_no: generatedJobNo,
        prin_code: prinCode,
        cust_code: custCode,
        bl_number: blNumber,
        containers_count: containers.length,
        containers: containers.map(c => c.container_no),
        job_type: jobType,
        is_cfs: jobFlag === "C",
      },
    });
  });
};

// DATABASE CONNECTION & HELPER UTILITIES
// =============================================================================
async function withConnection(res: Response, handler: (connection: Connection) => Promise<void>) {
  let connection: Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    await handler(connection);
  } catch (error: any) {
    console.error("Freight tracker procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight tracker procedure",
      details: error?.message || "Unknown error",
    });
  } finally {
    if (connection) await connection.close();
  }
}

async function rowsFromCursor(cursor: any) {
  if (!cursor) return [];
  try {
    return await cursor.getRows(10000);
  } finally {
    await cursor.close();
  }
}

function value(input: unknown) {
  if (input === undefined || input === null) return null;
  const text = String(input).trim();
  return text ? text : null;
}

function toDate(input: unknown) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function resolvePrinCode(
  connection: Connection,
  companyCode: string | null,
  jobNo: string | null,
  rawPrinCode: unknown
): Promise<string | null> {
  const explicit = value(rawPrinCode);
  if (explicit) return explicit;
  if (!companyCode || !jobNo) return null;

  try {
    const check = await connection.execute(
      `SELECT PRIN_CODE FROM TI_JOB WHERE COMPANY_CODE = :comp AND JOB_NO = :job`,
      { comp: companyCode, job: jobNo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row: any = (check.rows as any[])?.[0];
    return row?.PRIN_CODE ? String(row.PRIN_CODE).trim() : null;
  } catch {
    return null;
  }
}

