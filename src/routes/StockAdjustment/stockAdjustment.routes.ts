import * as express from "express";
import {
  createStockAdjustment,
  updateStockAdjustment,
  getStockAdjustments,
  getStockAdjustmentByJobNo,
  deleteStockAdjustment,
} from "../../controllers/StockAdjustment/createStockAdjustment.controller";

const router = express.Router();

// POST - Create new stock adjustment
router.post("/", createStockAdjustment);

// GET - Get all stock adjustments for the company
router.get("/", getStockAdjustments);

// GET - Get stock adjustment by job number
router.get("/:JOB_NO", getStockAdjustmentByJobNo);

// PUT - Update stock adjustment
router.put("/:JOB_NO", updateStockAdjustment);

// DELETE - Delete stock adjustment
router.delete("/:JOB_NO", deleteStockAdjustment);

export default router;
