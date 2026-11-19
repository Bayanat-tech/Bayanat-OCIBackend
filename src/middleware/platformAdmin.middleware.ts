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
    if (
      !req.user?.loginid ||
      !(await PlatformAdminService.isAdmin(req.user.loginid))
    ) {
      res
        .status(403)
        .json({
          success: false,
          message: "Platform Super Admin access is required",
        });
      return;
    }
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
  const name = String(req.path.split("/").filter(Boolean).pop() || "");
  if (/^tenant[_-](user|registry|mapping)$/.test(name))
    return requirePlatformAdmin(req, res, next);
  next();
}
