import { Response } from "express";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import {
  deleteSmsRows,
  getSmsConfig,
  selectAllSmsMasterData,
  selectSmsRows,
} from "../../services/smsTenant.service";

export const getSMSMaster = async (req: RequestWithUser, res: Response) => {
  try {
    const { master } = req.params;
    const config = getSmsConfig(master);
    if (!config) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "Invalid SMS master" });
      return;
    }

    const data = await selectSmsRows(config, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      salesName: req.user?.username,
    });

    res.status(constants.STATUS_CODES.OK).json({ success: true, data });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Error occurred while fetching data",
    });
  }
};

export const deleteSMSMaster = async (req: RequestWithUser, res: Response) => {
  try {
    const { master } = req.params;
    const config = getSmsConfig(master);
    if (!config) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: "Invalid SMS master" });
      return;
    }

    await deleteSmsRows(config, req.body.ids || []);
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Record is successfully deleted.",
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: error.message });
  }
};

export const getAllMasterData = async (_req: RequestWithUser, res: Response) => {
  try {
    const data = await selectAllSmsMasterData();
    res.status(constants.STATUS_CODES.OK).json({ success: true, data });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};
