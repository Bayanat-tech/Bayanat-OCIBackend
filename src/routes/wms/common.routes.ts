// import express, {
//   Request,
//   Response,
//   RequestHandler,
//   NextFunction,
// } from "express";

// import {proc_build_dynamic_sql_common} from "../../controllers/common/proc_build_dynamic_sql_common"
// import { proc_build_dynamic_del_common } from "../../controllers/common/proc_build_dynamic_del_common";
// import { proc_build_dynamic_ins_upd_common } from "../../controllers/common/proc_build_dynamic_ins_upd_common";

// const router = express.Router();
// router.post("/proc_build_dynamic_sql_common", proc_build_dynamic_sql_common);
// router.post("/proc_build_dynamic_del_common", proc_build_dynamic_del_common);
// router.post("/proc_build_dynamic_ins_upd_common",proc_build_dynamic_ins_upd_common);
// export default router;

import express from "express";

import { proc_build_dynamic_ins_upd_common ,proc_build_dynamic_ins_upd_column90} from "../../controllers/common/common_contoller";
import { proc_build_dynamic_sql_common ,proc_build_dynamic_del_common} from "../../controllers/common/common_contoller";


const router = express.Router();

// FETCH (SELECT)
router.post(
  "/proc_build_dynamic_sql_common",
  proc_build_dynamic_sql_common
);

// INSERT / UPDATE  ✅ REQUIRED
router.post(
  "/proc_build_dynamic_ins_upd_column90",
  proc_build_dynamic_ins_upd_column90
);

router.post(
  "/proc_build_dynamic_ins_upd_common",
  proc_build_dynamic_ins_upd_common
);

// DELETE
router.post(
  "/proc_build_dynamic_del_common",
  proc_build_dynamic_del_common
);

export default router;