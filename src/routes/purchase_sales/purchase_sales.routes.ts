import * as express from "express";
import passport from "passport";
import { Router } from "express";

import { tenantContextMiddleware } from "../../../src/middleware/tenantContext.middleware";
import { tenantMiddleware } from "../../../src/middleware/tenant.middleware";
import { insUpdTtePOrderBulk } from "../../controllers/purchase_sales/insUpdTtePOrderBulk";
import { insUpdTtePQuotationBulk } from "../../controllers/purchase_sales/insUpdTtePQuotationBulk";

const router = express.Router();
router.use(tenantMiddleware);
router.use(tenantContextMiddleware);

router.post(
  "/insUpdTtePOrderBulk",
  insUpdTtePOrderBulk
);

router.post(
  "/insUpdTtePQuotationBulk",
  insUpdTtePQuotationBulk
);

export default router;



