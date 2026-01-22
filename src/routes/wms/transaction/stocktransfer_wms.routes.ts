/**
 * Express router for outbound WMS operations
 * @module stocktransfer_wms.routes
 */

import express from "express";
import passport from "passport";
import { checkUserAuthorization } from "../../../middleware/checkUserAthorization";

// Controller imports
// import { createOrUpdateTSSTNSequential } from "../../../controllers/StockTransfer/strocktransferdbupdate.controller";
import { getAllStockTransfers, createSTN, getTSSTNWithDetails, createSTNDetail } from "../../../controllers/StockTransfer/stocktransferget.controller";
// import { getProductAvailability } from "../../../controllers/StockTransfer/getProductAvailability";
 // ✅ new import

const router = express.Router();

// Routes
// router.put("/createOrUpdateTSSTNSequential", createOrUpdateTSSTNSequential);

router.get("/getAllStockTransfers", async (req, res) => {
  await getAllStockTransfers(req, res);
});

// Query params: stn_no, company_code (required), prin_code (optional)
router.get("/getTSSTNWithDetails", async (req, res) => {
  await getTSSTNWithDetails(req, res);
});

router.post("/createSTN", async (req, res) => {
  await createSTN(req, res);
});

router.post("/createSTNDetail", async (req, res) => {
  await createSTNDetail(req, res);
});

// ✅ New GET API for product availability
// router.get("/getProductAvailability", async (req, res) => {
//   await getProductAvailability(req, res);
// });

export default router;
