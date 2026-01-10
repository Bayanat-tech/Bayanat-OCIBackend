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
import { updateAppraisalRatings } from "../../controllers/PAMS/ems_appraisal_task_dtl_update";

const router = express.Router();

// FETCH (SELECT)
router.post(
  "/proc_build_dynamic_sql_pams",
  proc_build_dynamic_sql_PAMS
);

// INSERT / UPDATE  ✅ REQUIRED
router.post(
  "/proc_build_dynamic_ins_upd_pams",
  proc_build_dynamic_ins_upd_PAMS
);

router.post("/update-ratings", updateAppraisalRatings);
// DELETE
router.post(
  "/proc_build_dynamic_del_pams",
  proc_build_dynamic_del_PAMS
);

export default router;
