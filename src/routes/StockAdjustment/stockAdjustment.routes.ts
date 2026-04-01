import * as express from "express";
import { Request, Response } from "express";
import {
  createStockAdjustment,
  // updateStockAdjustment,
  getStockAdjustments,
  // getStockAdjustmentByJobNo,
  deleteStockAdjustment,
  processAdjustment,
  // createStockAdjustmentHeader,
  createAdjHeader,
  createAdjustmentDetail,
  confirmAdjDetail,
  // editStockAdjustmentDetail,
  deleteStockAdjustmentDetail,
  editAdjDetail,
  deleteAdjDetail
} from "../../controllers/StockAdjustment/createStockAdjustment.controller";

const router = express.Router();

router.post("/", createStockAdjustment as express.RequestHandler);
router.post("/createAdjHeader", createAdjHeader as express.RequestHandler);
router.post("/createAdjDetail", createAdjustmentDetail as express.RequestHandler);
router.post("/process-adjustment", processAdjustment as express.RequestHandler);
router.post("/confirm-adj-detail", confirmAdjDetail as express.RequestHandler);

// GET
router.get("/", getStockAdjustments as express.RequestHandler);

// PUT
// router.put("/updateStockAdjustment/:ADJ_CODE", updateStockAdjustment as express.RequestHandler);
router.put("/edit-detail", editAdjDetail as unknown as express.RequestHandler);   // ← body-based, no URL params

// DELETE
router.delete("/deleteAdjustment/:ADJ_CODE", deleteStockAdjustment as express.RequestHandler);
router.delete("/delete-detail/:ADJ_CODE/:JOB_NO", deleteAdjDetail as unknown as express.RequestHandler);


export default router;
