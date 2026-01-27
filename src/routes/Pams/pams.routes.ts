
import express from "express";

import { proc_build_dynamic_sql_PAMS } from "../../controllers/PAMS/proc_build_dynamic_sql_PAMS";
import { proc_build_dynamic_del_PAMS } from "../../controllers/PAMS/proc_build_dynamic_del_PAMS";
import { proc_build_dynamic_ins_upd_PAMS } from "../../controllers/PAMS/proc_build_dynamic_ins_upd_PAMS";

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

// DELETE
router.post(
  "/proc_build_dynamic_del_pams",
  proc_build_dynamic_del_PAMS
);

export default router;
