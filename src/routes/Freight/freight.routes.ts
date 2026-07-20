import * as express from "express";
import passport from "passport";
import { Router } from "express";

import { tenantContextMiddleware } from "../../../src/middleware/tenantContext.middleware";
import { tenantMiddleware } from "../../../src/middleware/tenant.middleware";
import {
  proc_build_dynamic_del_FREIGHT,
  proc_build_dynamic_ins_upd_FREIGHT,
  proc_build_dynamic_sql_FREIGHT,
} from "../../controllers/Freight/freightDynamicProcedures";
import { insUpdTfEnquiryBulk } from "../../controllers/Freight/insUpdTfEnquiryBulk";

const router = express.Router();
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);


router.post(
  "/insUpdTfEnquiryBulk",
  insUpdTfEnquiryBulk 
);

router.post(
  "/gm/proc_build_dynamic_sql_freight",
  proc_build_dynamic_sql_FREIGHT
);

router.post(
  "/gm/proc_build_dynamic_ins_upd_freight",
  proc_build_dynamic_ins_upd_FREIGHT
);

router.post(
  "/gm/proc_build_dynamic_del_freight",
  proc_build_dynamic_del_FREIGHT
);


 export default router;



