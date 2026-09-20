import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

// Configuration catalog for tracker levels & tabs
const TRACKER_TABS_CONFIG = [
  {
    serial_no: 7001,
    flow_level: 1,
    tab_id: "FFD_REVIEW",
    task_type: "FFD_REVIEW",
    title: "FFD Review",
    subtitle: "B/L & ETA Verification",
    icon: "FileText",
    url_path: "/freight/tracker/ffd",
    description: "Review Master/House B/L, Commercial Invoice, and set initial ETA & planned pull-out date.",
  },
  {
    serial_no: 7002,
    flow_level: 2,
    tab_id: "PRO_PERMITS",
    task_type: "PRO_PERMITS",
    title: "PRO Permits",
    subtitle: "Ministry Inspection & Permits",
    icon: "ShieldCheck",
    url_path: "/freight/tracker/permit",
    description: "Submit & track agricultural/food health inspection permits or food approvals.",
  },
  {
    serial_no: 7003,
    flow_level: 3,
    tab_id: "CUSTOMS_BAYAN",
    task_type: "CUSTOMS_BAYAN",
    title: "Customs Bayan",
    subtitle: "Bayan Declaration & Duty",
    icon: "Landmark",
    url_path: "/freight/tracker/bayan",
    description: "Process customs declaration, input Bayan declaration number, and record duty fees.",
  },
  {
    serial_no: 7004,
    flow_level: 4,
    tab_id: "SHIPPING_LINE_DO",
    task_type: "SHIPPING_LINE_DO",
    title: "Delivery Order (DO)",
    subtitle: "Shipping Line DO & Validity",
    icon: "Ship",
    url_path: "/freight/tracker/do",
    description: "Collect Delivery Order, track DO expiry date countdown, and manage revalidations.",
  },
  {
    serial_no: 7005,
    flow_level: 5,
    tab_id: "CCRO",
    task_type: "CCRO",
    title: "CCRO / Port Police",
    subtitle: "Customs & Port Police Clearance",
    icon: "Lock",
    url_path: "/freight/tracker/ccro",
    description: "Coordinate container seal clearance with Customs Container Release Office & Port Police.",
  },
  {
    serial_no: 7006,
    flow_level: 6,
    tab_id: "TRANSPORT",
    task_type: "TRANSPORT",
    title: "Transport Dispatch",
    subtitle: "Fleet & Truck Allocation",
    icon: "Truck",
    url_path: "/freight/tracker/transport",
    description: "Assign company fleet or 3rd-party trucking contractors, drivers, and schedule pickups.",
  },
  {
    serial_no: 7007,
    flow_level: 7,
    tab_id: "DC_OFFLOAD",
    task_type: "DC_OFFLOAD",
    title: "DC Offloading",
    subtitle: "Warehouse Gate & Offloading",
    icon: "Warehouse",
    url_path: "/freight/tracker/dc",
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
    let effectiveFlowCode = flowCode;
    if (jobNo) {
      const jobCheck = await connection.execute(
        `SELECT NVL(JOB_FLAG, 'M') AS JOB_FLAG, NVL(JOB_TYPE, 'IMP') AS JOB_TYPE
           FROM WMSTST.TI_JOB
          WHERE COMPANY_CODE = :company_code AND JOB_NO = :job_no`,
        { company_code: companyCode, job_no: jobNo },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const jobRow: any = (jobCheck.rows as any[])?.[0];
      if (jobRow && (jobRow.JOB_FLAG === "C" || jobRow.JOB_TYPE === "CFS")) {
        effectiveFlowCode = "CFS_TRANSFER";
      }
    }

    // Step B: Query MS_APPROVER_LEVELS for Company's configured LAST_LEVEL
    const approverLevelsResult = await connection.execute(
      `SELECT LAST_LEVEL, FLOW_CODE, LEVEL1_ROLE, LEVEL2_ROLE, LEVEL3_ROLE, LEVEL4_ROLE, LEVEL5_ROLE, LEVEL6_ROLE, LEVEL7_ROLE
         FROM WMSTST.MS_APPROVER_LEVELS
        WHERE COMPANY_CODE = :company_code
          AND PROCESS = 'FREIGHT_TRACKER'
          AND FLOW_CODE = :flow_code`,
      { company_code: companyCode, flow_code: effectiveFlowCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let lastLevel = 4; // Default fallback: 4-Level Broker
    const approverConfig: any = (approverLevelsResult.rows as any[])?.[0];
    if (approverConfig && approverConfig.LAST_LEVEL) {
      lastLevel = Number(approverConfig.LAST_LEVEL);
    } else if (effectiveFlowCode === "CFS_TRANSFER") {
      lastLevel = 1;
    }

    // Step C: Query User's Permissions in SEC_ROLE_FUNCTION_ACCESS_USER
    const permissionsResult = await connection.execute(
      `SELECT SERIAL_NO_OR_ROLE_ID, SSEARCH, SSAVE, SMODIFY, SDELETE, SUPLOAD
         FROM WMSTST.SEC_ROLE_FUNCTION_ACCESS_USER
        WHERE COMPANY_CODE = :company_code
          AND LOGINID = :loginid
          AND SERIAL_NO_OR_ROLE_ID BETWEEN 7001 AND 7007`,
      { company_code: companyCode, loginid: loginId || "" },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const userPermsMap = new Map<number, any>();
    for (const p of (permissionsResult.rows as any[]) || []) {
      userPermsMap.set(Number(p.SERIAL_NO_OR_ROLE_ID), p);
    }

    // Step D: Filter tabs based on Company Level + User RBAC
    const activeTabs: any[] = [];
    const hiddenTabs: any[] = [];

    // Special handling for CFS_TRANSFER: Only CCRO is active
    if (effectiveFlowCode === "CFS_TRANSFER") {
      const ccroConfig = TRACKER_TABS_CONFIG.find((t) => t.serial_no === 7005)!;
      const perm = userPermsMap.get(7005);
      const canView = perm ? perm.SSEARCH !== "N" : true;
      const canEdit = perm ? perm.SSAVE === "Y" || perm.SMODIFY === "Y" : true;
      const canUpload = perm ? perm.SUPLOAD === "Y" : true;
      const canDelete = perm ? perm.SDELETE === "Y" : true;

      const tabEntry = {
        ...ccroConfig,
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

        const perm = userPermsMap.get(tab.serial_no);
        const canView = perm ? perm.SSEARCH !== "N" : true;
        const canEdit = perm ? perm.SSAVE === "Y" || perm.SMODIFY === "Y" : true;
        const canUpload = perm ? perm.SUPLOAD === "Y" : true;
        const canDelete = perm ? perm.SDELETE === "Y" : true;

        const roleKey = `LEVEL${tab.flow_level}_ROLE`;
        const assignedRole = approverConfig ? approverConfig[roleKey] : null;

        const tabEntry = {
          ...tab,
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
    const prinCode = value(req.body.prin_code ?? req.body.PRIN_CODE ?? "01");
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);

    if (!companyCode || !jobNo) {
      res.status(400).json({ success: false, message: "company_code and job_no are required" });
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
        containers: containerRows,
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
    const prinCode = value(req.body.prin_code ?? req.body.PRIN_CODE ?? "01");
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");

    if (!companyCode || !jobNo) {
      res.status(400).json({ success: false, message: "company_code and job_no are required" });
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
export const trkTaskUpdate = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const companyCode = value(req.body.company_code ?? req.body.COMPANY_CODE);
    const prinCode = value(req.body.prin_code ?? req.body.PRIN_CODE ?? "01");
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const taskType = value(req.body.task_type ?? req.body.TASK_TYPE);
    const status = value(req.body.status ?? req.body.STATUS); // IN_PROGRESS, ON_HOLD, COMPLETED
    const holdEntity = value(req.body.hold_entity ?? req.body.HOLD_ENTITY);
    const holdReason = value(req.body.hold_reason ?? req.body.HOLD_REASON);
    const holdRemark = value(req.body.hold_remark ?? req.body.HOLD_REMARK);
    const releaseRemark = value(req.body.release_remark ?? req.body.RELEASE_REMARK);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");

    if (!companyCode || !jobNo || !taskType || !status) {
      res.status(400).json({
        success: false,
        message: "company_code, job_no, task_type, and status are required",
      });
      return;
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
        p_task_type: taskType,
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
    if (taskType === "SHIPPING_LINE_DO" && req.body.do_validity_date) {
      const doDate = toDate(req.body.do_validity_date);
      if (doDate) {
        await connection.execute(
          `UPDATE WMSTST.TRK_SHIPMENT SET DO_VALIDITY_DATE = :do_date, UPDATED_DT = SYSDATE WHERE COMPANY_CODE = :comp AND PRIN_CODE = :prin AND JOB_NO = :job`,
          { do_date: doDate, comp: companyCode, prin: prinCode, job: jobNo },
          { autoCommit: true }
        );
      }
    }

    if (taskType === "PRO_PERMITS" && req.body.permit_ref) {
      await connection.execute(
        `UPDATE WMSTST.TRK_SHIPMENT SET PERMIT_REF = :pref, UPDATED_DT = SYSDATE WHERE COMPANY_CODE = :comp AND PRIN_CODE = :prin AND JOB_NO = :job`,
        { pref: String(req.body.permit_ref).trim(), comp: companyCode, prin: prinCode, job: jobNo },
        { autoCommit: true }
      );
    }

    const isCompleted = (result.outBinds as any)?.p_is_completed === "Y";

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
    const prinCode = value(req.body.prin_code ?? req.body.PRIN_CODE ?? "01");
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const containerNumber = value(req.body.container_number ?? req.body.CONTAINER_NUMBER);
    const dcRemark = value(req.body.dc_remark ?? req.body.DC_REMARK);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");

    if (!companyCode || !jobNo || !containerNumber) {
      res.status(400).json({
        success: false,
        message: "company_code, job_no, and container_number are required",
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
    const prinCode = value(req.body.prin_code ?? req.body.PRIN_CODE ?? "01");
    const jobNo = value(req.body.job_no ?? req.body.JOB_NO);
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");

    if (!companyCode || !jobNo) {
      res.status(400).json({ success: false, message: "company_code and job_no are required" });
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
    const prinCode = value(req.body.prin_code ?? req.body.PRIN_CODE ?? "01");
    const userId = value(req.body.user_id ?? req.body.USER_ID ?? (req as any).user?.loginid ?? "SYSTEM");
    const blNumber = value(req.body.bl_number ?? req.body.BL_NUMBER ?? req.body.doc_ref ?? req.body.DOC_REF);
    const custCode = value(req.body.cust_code ?? req.body.CUST_CODE);
    const portCode = value(req.body.port_code ?? req.body.PORT_CODE ?? "PORT");
    const containers = Array.isArray(req.body.containers) ? req.body.containers : [];

    if (!companyCode || !custCode) {
      res.status(400).json({ success: false, message: "company_code and cust_code are required" });
      return;
    }

    // Step 1: Create TI_JOB with JOB_FLAG = 'C' (CFS) via PROC_FRT_JOB_SAVE
    const saveJobResult = await connection.execute(
      `BEGIN
         PROC_FRT_JOB_SAVE(
           :p_company_code,
           :p_prin_code,
           NULL, -- p_job_no: generates new number
           SYSDATE,
           'CFS', -- p_job_type
           'SEA', -- p_transport_mode
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
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
            `INSERT INTO WMSTST.TF_CONTAINER_DET (
               COMPANY_CODE, PRIN_CODE, JOB_NO, SRNO, CONTAINER_NO, SEAL_NO, CONTN_SIZE, CREATED_BY, CREATED_DATE
             ) VALUES (
               :p_comp, :p_prin, :p_job, :p_srno, :p_cntr, :p_seal, :p_size, :p_user, SYSDATE
             )`,
            {
              p_comp: companyCode,
              p_prin: prinCode,
              p_job: generatedJobNo,
              p_srno: i + 1,
              p_cntr: containerNo,
              p_seal: sealNo,
              p_size: containerSize,
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

