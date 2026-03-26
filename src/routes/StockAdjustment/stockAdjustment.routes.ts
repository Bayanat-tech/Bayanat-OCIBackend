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
  createAdjHeader,
  createAdjustmentDetail,
  confirmAdjDetail
} from "../../controllers/StockAdjustment/createStockAdjustment.controller";

const router = express.Router();

// POST - Create new stock adjustment
router.post("/", createStockAdjustment as express.RequestHandler);

// POST - Create stock adjustment header only
router.post("/createAdjHeader", async (req: Request, res: Response) => {
  await createAdjHeader(req, res);
});

// POST - Create stock adjustment detail only
router.post("/createAdjDetail", async (req: Request, res: Response) => {
  await createAdjustmentDetail(req, res);
});

// POST - Process stock adjustment
router.post("/process-adjustment", processAdjustment);

// POST - Confirm adjustment detail
router.post("/confirm-adj-detail", confirmAdjDetail as express.RequestHandler);

// GET - Get all stock adjustments for the company
router.get("/", getStockAdjustments);

// GET - Get stock adjustment by job number
// router.get("/:JOB_NO", getStockAdjustmentByJobNo);

// PUT - Update stock adjustment
router.put("/:ADJ_CODE", updateStockAdjustment);

// DELETE - Delete stock adjustment
router.delete("/:ADJ_CODE", deleteStockAdjustment);

export default router;
