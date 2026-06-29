import { Response } from "express";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { TenantAdminService } from "../../services/Security/tenantAdmin.service";

async function handleSave(
  req: RequestWithUser,
  res: Response,
  save: (payload: any, updatedBy: string) => Promise<any>
) {
  try {
    const requestUser: IUser = req.user;
    const result = await save(req.body, requestUser?.loginid || "system");
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `Tenant admin record ${result.mode} successfully`,
      data: result,
    });
  } catch (error: any) {
    console.error("Tenant admin save error:", error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message || "Unable to save tenant admin record",
    });
  }
}

export const upsertTenantUser = async (req: RequestWithUser, res: Response) => {
  await handleSave(req, res, TenantAdminService.upsertTenantUser);
};

export const upsertTenantRegistry = async (req: RequestWithUser, res: Response) => {
  await handleSave(req, res, async (payload) => TenantAdminService.upsertTenantRegistry(payload));
};

export const upsertTenantMapping = async (req: RequestWithUser, res: Response) => {
  await handleSave(req, res, async (payload) => TenantAdminService.upsertTenantMapping(payload));
};
