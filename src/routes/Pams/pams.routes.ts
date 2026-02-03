
import express from "express";

import { proc_build_dynamic_sql_PAMS } from "../../controllers/PAMS/proc_build_dynamic_sql_PAMS";
import { proc_build_dynamic_del_PAMS } from "../../controllers/PAMS/proc_build_dynamic_del_PAMS";
import { proc_build_dynamic_ins_upd_PAMS } from "../../controllers/PAMS/proc_build_dynamic_ins_upd_PAMS";
import { proc_populate_ms_eam_dept_kpi } from "../../controllers/PAMS/proc_populate_ms_eam_dept_kpi";
import { updateAppraisalRatings } from "../../controllers/PAMS/ems_appraisal_task_dtl_update";


const router = express.Router();

// ================= SELECT =================
router.post(
  "/proc_build_dynamic_sql_pams",
  proc_build_dynamic_sql_PAMS
);

// ================= INSERT / UPDATE =================
router.post(
  "/proc_build_dynamic_ins_upd_pams",
  proc_build_dynamic_ins_upd_PAMS
);

// ================= DELETE =================
router.post(
  "/proc_build_dynamic_del_pams",
  proc_build_dynamic_del_PAMS
);

// ================= NEW – POPULATE EMPLOYEE KPI =================
router.post(
  '/proc_populate_ms_eam_dept_kpi',
  proc_populate_ms_eam_dept_kpi
);

router.post(
  "/update-ratings",
  updateAppraisalRatings
);

export default router;
