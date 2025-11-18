import { Response } from "express";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { MessageBoxService } from "../../services/Purchaseflow/purchaseRequest.service";

export const fetchMessageBox = async (
     req: RequestWithUser, res: Response
     ): Promise<void> => {
  try {
    const { userId, companyCode } = req.query;

    if (!userId || !companyCode) {
       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Missing userId or companyCode"
      });
      return;
    }

    const data = await MessageBoxService.fetchMessageBox(
      String(userId),
      String(companyCode)
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data
    });
  } catch (err) {
    console.error("MessageBox error:", err);

    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error"
    });
  }
};
