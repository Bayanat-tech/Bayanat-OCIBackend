// import express, {
//   Request,
//   Response,
//   RequestHandler,
//   NextFunction,
// } from "express";

// import {proc_build_dynamic_sql_PAMS} from "../../controllers/PAMS/proc_build_dynamic_sql_PAMS"
// import { proc_build_dynamic_del_PAMS } from "../../controllers/PAMS/proc_build_dynamic_del_PAMS";
// import { proc_build_dynamic_ins_upd_PAMS } from "../../controllers/PAMS/proc_build_dynamic_ins_upd_PAMS";

// const router = express.Router();
// router.post("/proc_build_dynamic_sql_pams", proc_build_dynamic_sql_PAMS);
// router.post("/proc_build_dynamic_del_pams", proc_build_dynamic_del_PAMS);
// router.post("/proc_build_dynamic_ins_upd_pams",proc_build_dynamic_ins_upd_PAMS);
// export default router;
import express from "express";

import { proc_build_dynamic_sql_PAMS } from "../../controllers/PAMS/proc_build_dynamic_sql_PAMS";
import { proc_build_dynamic_del_PAMS } from "../../controllers/PAMS/proc_build_dynamic_del_PAMS";
import { proc_build_dynamic_ins_upd_PAMS } from "../../controllers/PAMS/proc_build_dynamic_ins_upd_PAMS";
import { proc_populate_ms_eam_dept_kpi } from "../../controllers/PAMS/proc_populate_ms_eam_dept_kpi";


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

export default router;
