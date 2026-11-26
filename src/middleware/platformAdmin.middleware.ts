import { Response, NextFunction } from "express";
import { RequestWithUser } from "../interfaces/common.interface";
import { PlatformAdminService } from "../services/Security/platformAdmin.service";

// Recheck central membership on every privileged request: token claims alone grant nothing.
export async function requirePlatformAdmin(
  req: RequestWithUser,
  res: Response,
  next: NextFunction,
) {
  try {
    const access = req.user?.loginid
      ? await PlatformAdminService.getAccess(req.user.loginid)
      : null;
    if (!access) {
      res.status(403).json({
        success: false,
        message: "Platform Super Admin access is required",
      });
      return;
    }
    (req as any).platformAccess = access;
    next();
  } catch {
    res
      .status(503)
      .json({ success: false, message: "Unable to verify platform access" });
  }
}

export async function protectRootSecurity(
  req: RequestWithUser,
  res: Response,
  next: NextFunction,
) {
  try {
    const name = String(req.path.split("/").filter(Boolean).pop() || "");
    if ((req.user as any)?.isPlatformAdmin || !(req.user as any)?.tenantId) {
      const access = await PlatformAdminService.getAccess(req.user.loginid);
      if (access?.scope === "SCOPED") {
        res.status(403).json({
          success: false,
          message:
            "Use the scoped administration console to manage your allowed tenants",
        });
        return;
      }
    }
    if (/^tenant[_-](user|registry|mapping)$/.test(name))
      return requirePlatformAdmin(req, res, next);
    next();
  } catch {
    res
      .status(503)
      .json({ success: false, message: "Unable to verify platform access" });
  }
}
