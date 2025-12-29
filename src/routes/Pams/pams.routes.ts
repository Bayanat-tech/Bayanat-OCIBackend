import express, {
  Request,
  Response,
  RequestHandler,
  NextFunction,
} from "express";

import {proc_build_dynamic_sql_PAMS} from "../../controllers/PAMS/proc_build_dynamic_sql_PAMS"

const router = express.Router();
router.post("/proc_build_dynamic_sql_pams", proc_build_dynamic_sql_PAMS);
export default router;