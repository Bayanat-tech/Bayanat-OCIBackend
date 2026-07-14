import * as express from "express";
import passport from "passport";
import { checkUserAuthorization } from "../middleware/checkUserAthorization";
import { inspectionReportExcel, inspectionReportHtml } from "../controllers/mms/report/mms_report_controller";

const router = express.Router();

router.get(
  "/inspection_report/html",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  inspectionReportHtml
);

router.get(
  "/inspection_report/excel",
  passport.authenticate("jwt", { session: false }),
  checkUserAuthorization,
  inspectionReportExcel
);

export default router;