
import express from "express";

import { updateAppraisalRatings } from "../../controllers/PAMS/ems_appraisal_task_dtl_update";


const router = express.Router();


router.post(
  "/update-ratings",
  updateAppraisalRatings
);

export default router;
