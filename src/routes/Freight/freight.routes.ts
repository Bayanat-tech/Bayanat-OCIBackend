import * as express from "express";
import passport from "passport";
import { Router } from "express";

import { tenantContextMiddleware } from "../../../src/middleware/tenantContext.middleware";
import { tenantMiddleware } from "../../../src/middleware/tenant.middleware";
import { insUpdTfEnquiryBulk } from "../../controllers/Freight/insUpdTfEnquiryBulk";

const router = express.Router();
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);


router.post(
  "/insUpdTfEnquiryBulk",
  insUpdTfEnquiryBulk 
);


 export default router;



