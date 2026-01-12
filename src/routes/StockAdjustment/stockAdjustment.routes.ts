import * as express from "express";
import { Request, Response } from "express";
import {
  createStockAdjustment,
  updateStockAdjustment,
  getStockAdjustments,
  // getStockAdjustmentByJobNo,
  deleteStockAdjustment,
  processAdjustment,
  // createStockAdjustmentHeader,
  createAdjHeader
} from "../../controllers/StockAdjustment/createStockAdjustment.controller";

const router = express.Router();

// POST - Create new stock adjustment
router.post("/", createStockAdjustment as express.RequestHandler);

// POST - Create stock adjustment header only
router.post("/createAdjHeader", async (req: Request, res: Response) => {
  await createAdjHeader(req, res);
});

// POST - Process stock adjustment
router.post("/process-adjustment", processAdjustment);

// GET - Get all stock adjustments for the company
router.get("/", getStockAdjustments);

// GET - Get stock adjustment by job number
// router.get("/:JOB_NO", getStockAdjustmentByJobNo);

// PUT - Update stock adjustment
router.put("/:JOB_NO", updateStockAdjustment);

// DELETE - Delete stock adjustment
router.delete("/:JOB_NO", deleteStockAdjustment);

export default router;
