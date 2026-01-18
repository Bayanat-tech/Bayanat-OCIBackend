

/**
 * @fileoverview Inbound WMS Routes - Handles all inbound warehouse management system routes
 * @requires express
 * @requires passport
 */

import * as express from "express";
import passport from "passport";
import { updateBilling } from "../../../controllers/billing/updatebilling";

const router = express.Router();

router.post("/updateBilling", updateBilling);

export default router;