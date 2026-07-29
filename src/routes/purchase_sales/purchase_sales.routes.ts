import * as express from "express";
import passport from "passport";
import { Router } from "express";

import { tenantContextMiddleware } from "../../../src/middleware/tenantContext.middleware";
import { tenantMiddleware } from "../../../src/middleware/tenant.middleware";
import { insUpdTtePOrderBulk } from "../../controllers/purchase_sales/insUpdTtePOrderBulk";
import { insUpdTtePQuotationBulk } from "../../controllers/purchase_sales/insUpdTtePQuotationBulk";
import { insUpdTtePGrnBulk } from "../../controllers/purchase_sales/insUpdTtePGrnBulk";
import { insUpdTteJOrderBulk } from "../../controllers/purchase_sales/insUpdTteJOrderBulk";
import { insUpdTteSOrderBulk } from "../../controllers/purchase_sales/insUpdTteSOrderBulk";
import { insUpdTteSdnBulk } from "../../controllers/purchase_sales/insUpdTteSdnBulk";
import { insUpdTteTransferBulk } from "../../controllers/purchase_sales/insUpdTteTransferBulk";
import { insUpdTteAdjustmentBulk } from "../../controllers/purchase_sales/insUpdTteAdjustmentBulk";
import {insUpdJobProduction} from "../../controllers/purchase_sales/insUpdJobProduction"

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

router.post(
  "/insUpdTtePGrnBulk",
  insUpdTtePGrnBulk
);
router.post(
  "/insUpdTteJOrderBulk",
  insUpdTteJOrderBulk
);

router.post(
  "/insUpdTteSOrderBulk",
  insUpdTteSOrderBulk 
);

router.post(
  "/insUpdTteSdnBulk",
  insUpdTteSdnBulk  
);


router.post(
  "/insUpdTteTransferBulk",
  insUpdTteTransferBulk   
);


router.post(
  "/insUpdTteAdjustmentBulk",
  insUpdTteAdjustmentBulk    
);

router.post(
  "/insUpdJobProduction",
  insUpdJobProduction    
);
export default router;



