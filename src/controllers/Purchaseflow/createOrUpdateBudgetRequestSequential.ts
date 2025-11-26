import { Request, Response } from "express";
import { upsertBudgetRequest } from "./budgetRequestdbupdate_pf.Controller";
import { TBasicBrequest } from "../../interfaces/Purchaseflow/Budgetflow.interface";

export const createOrUpdateBudgetRequestSequential = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const budgetRequest: TBasicBrequest = req.body;

    // Call your function
    const { requestNumber } = await upsertBudgetRequest(budgetRequest);

    res.status(200).json({
      success: true,
      message: "Budget request processed successfully.",
      requestNumber,
    });
  } catch (error) {
    console.error("Error saving/updating budget request:", error);
    res.status(500).json({
      success: false,
      message: "Error saving/updating budget request.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
