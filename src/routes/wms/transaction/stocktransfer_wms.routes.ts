/**
 * Express router for outbound WMS operations
 * @module stocktransfer_wms.routes
 */

import express from "express";
import passport from "passport";
import { checkUserAuthorization } from "../../../middleware/checkUserAthorization";

// Controller imports
// import { createOrUpdateTSSTNSequential } from "../../../controllers/StockTransfer/strocktransferdbupdate.controller";
import { getAllStockTransfers, createSTN, getTSSTNWithDetails, createSTNDetail, editSTN } from "../../../controllers/StockTransfer/stocktransferget.controller";
import { processStockTransfer, updateStockTransfer, deleteStockTransfer } from "../../../controllers/StockTransfer/processStockTransfer.controller";
import { confirmStockTransfer } from "../../../controllers/StockTransfer/confirmStockTransfer.controller";
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

// Process Stock Transfer - Calls SP_WM_TRANSFER_PROCESS
router.post("/processStockTransfer", async (req, res) => {
  await processStockTransfer(req, res);
});

router.post("/confirmStockTransfer", async (req, res) => {
  await confirmStockTransfer(req, res);
});

router.patch("/editstocktransfer", async (req,res) => {
  await updateStockTransfer(req, res)
})

router.delete("/deletestocktransfer", async(req, res) => {
  await deleteStockTransfer(req,res)
})

router.put('/stn/:stn_no/:company_code', async(req, res) => {
  await editSTN(req,res)
})

// ✅ New GET API for product availability
// router.get("/getProductAvailability", async (req, res) => {
//   await getProductAvailability(req, res);
// });

export default router;
