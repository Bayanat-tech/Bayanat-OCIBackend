

/**
 * @fileoverview Inbound WMS Routes - Handles all inbound warehouse management system routes
 * @requires express
 * @requires passport
 */

import * as express from "express";
import passport from "passport";
import { updateBilling } from "../../../controllers/billing/updatebilling";
import { updatejobbillingdata } from "../../../controllers/billing/updatejobbillingdata";





const router = express.Router();

router.post("/updateBilling", updateBilling);
router.post("/updateBilling", updateBilling);

// This is for updating Job related billing for inbound and outbound
// Parse JSON **per route** instead of globally
router.post(
  "/updatejobbillingdata",
 // express.json(), // parse JSON only for this route
  updatejobbillingdata
);


export default router;