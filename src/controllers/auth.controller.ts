import { Request, Response, RequestHandler } from "express";
import constants from "../helpers/constants";
import {
  buildTree,
  formatRolePermissions,
  notifyUser,
  buildModuleAccessFromStructure,
} from "../helpers/functions";
import { loginSchema } from "../validation/auth.validation";
import { StructuredResult } from "../interfaces/auth.interface";
import { RequestWithUser } from "../interfaces/common.interface";
import { AuthService, EMAIL_NOT_FOUND_MESSAGE, OUTDATED_EMAIL_MESSAGE } from "../services/auth.service";
import { VendorService } from "../services/vendor.service";
import { TenantManager } from "../database/TenantManager";
import { permissionsListQuery, userPermissionQuery } from "../utils/query";


// Update generateToken to include tenant
export async function generateToken(userData: any): Promise<string> {
  const jwt = require('jsonwebtoken');
  
  const payload = {
    username: userData.username,
    email_id: userData.email_id,
    loginid: userData.loginid,
    tenantId: userData.tenantId,
    tenant_name: userData.tenant_name,
    company_code: userData.company_code,
    company_name: userData.company_name,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
  };
  
  return jwt.sign(payload, process.env.APP_SECRET || 'BAYANAT');
}

function isUsableEmail(email: string): boolean {
  const value = String(email || "").trim();
  return Boolean(value && value.includes("@") && !/^\d/.test(value));
}

function getFrontendOrigin(req: Request): string {
  const origin = req.get("origin");
  if (origin) return origin.replace(/\/$/, "");

  const referer = req.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore malformed referer and fall through to configured fallback.
    }
  }

  const forwardedHost = req.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = req.get("x-forwarded-proto") || req.protocol || "http";
    return `${forwardedProto.split(",")[0]}://${forwardedHost.split(",")[0]}`.replace(/\/$/, "");
  }

  return (process.env.FRONTEND_URL || "http://localhost:3101").replace(/\/$/, "");
}

function buildResetPasswordUrl(req: Request, token: string): string {
  return `${getFrontendOrigin(req)}/reset-password?token=${encodeURIComponent(token)}`;
}

async function resolveTenantCompanyName(tenantId: string, companyCode: string): Promise<string | undefined> {
  if (!tenantId || !companyCode) {
    return undefined;
  }

  try {
    const rows = await TenantManager.executeInTenant(
      tenantId,
      `SELECT COMPANY_NAME FROM MS_COMPANY WHERE COMPANY_CODE = :company_code`,
      { company_code: companyCode },
    );

    const companyRow = Array.isArray(rows) ? rows[0] : null;
    return companyRow?.COMPANY_NAME || companyRow?.company_name || undefined;
  } catch (error) {
    console.warn(`[auth.controller] Failed to resolve company name for tenant=${tenantId}, company_code=${companyCode}:`, error);
    return undefined;
  }
}

function generatePasswordResetToken(email: string): string {
  const jwt = require("jsonwebtoken");
  return jwt.sign({ email, purpose: "PASSWORD_RESET" }, process.env.APP_SECRET || "BAYANAT", { expiresIn: "10m" });
}

function verifyPasswordResetToken(token: string): string {
  const jwt = require("jsonwebtoken");
  try {
    const payload = jwt.verify(token, process.env.APP_SECRET || "BAYANAT") as { email?: string; purpose?: string };
    if (payload.purpose !== "PASSWORD_RESET" || !payload.email) {
      throw new Error("Invalid password reset token");
    }
    return payload.email;
  } catch (error: any) {
    if (error?.name === "TokenExpiredError") {
      throw new Error("Password reset link has expired. Please request a new link.");
    }
    throw new Error("Invalid password reset link. Please request a new link.");
  }
}
export const login: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { error } = loginSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
      return;
    }

    const { email, password } = req.body;

    console.log(`[login] STEP 1: Authenticating user '${email}'...`);

    // Get user with tenant info
    let userTenant = await AuthService.getUserWithTenant(email);

    if (!userTenant) {
      console.log(`[login] User not found in SEC_LOGINTEST, checking external API...`);
      // Try external user creation
      try {
        const apiResponse = await VendorService.checkAccountEmployee(email);

        if (Array.isArray(apiResponse) && apiResponse.length > 0) {
          const apiUser = apiResponse[0];
          const isExternalPassValid = password === apiUser.PASSWORD;

          if (!isExternalPassValid) {
            res.status(constants.STATUS_CODES.BAD_REQUEST).json({
              success: false,
              message: constants.MESSAGES.USER.INVALID_PASSWORD,
            });
            return;
          }

          const hashedPassword = await AuthService.hashPassword(password);
          const newUser = await AuthService.createUserFromExternal(
            apiUser,
            password,
            hashedPassword
          );
          
          console.log(`[login] ✅ External user created: ${newUser.LOGINID}`);
          
          // For external users, use default tenant
          userTenant = {
            user: newUser,
            tenantId: 'WMSTST_TENANT'
          };
        } else {
          res.status(constants.STATUS_CODES.NOT_FOUND).json({
            success: false,
            message: "User not found",
          });
          return;
        }
      } catch (apiError: any) {
        console.error(`[login] External API error:`, apiError.message);
        res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Error validating user",
        });
        return;
      }
    }

    if (!userTenant) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    const { user, tenantId } = userTenant;
    
    console.log(`[login] ✅ User found: ${user?.LOGINID}, Tenant: ${tenantId}`);

    // Verify password - handle both USERPASS and SEC_PASSWD fields
    let isPasswordValid = false;
    
    if (user.USERPASS) {
      console.log(`[login] STEP 2: Verifying password (USERPASS)...`);
      isPasswordValid = await AuthService.comparePassword(password, user.USERPASS);
    }
    
    if (!isPasswordValid && user.SEC_PASSWD) {
      console.log(`[login] STEP 2: Verifying password (SEC_PASSWD)...`);
      isPasswordValid = await AuthService.comparePassword(password, user.SEC_PASSWD);
    }

    if (!isPasswordValid) {
      console.log(`[login] ❌ Invalid password`);
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: constants.MESSAGES.USER.INVALID_PASSWORD,
      });
      return;
    }

    console.log(`[login] ✅ STEP 2 SUCCESS: Password verified`);

    // Get tenant config for additional info
    console.log(`[login] STEP 3: Getting tenant config...`);
    const tenantConfig = await TenantManager.getTenantConfig(tenantId);
    
    console.log(`[login] ✅ STEP 3 SUCCESS: Tenant config loaded`);

    const companyName = await resolveTenantCompanyName(tenantId, user.COMPANY_CODE);
    const tenantName = tenantConfig?.TENANT_NAME || tenantId;

    // Generate token with tenant info
    console.log(`[login] STEP 4: Generating JWT token...`);
    const token = await generateToken({
      username: user.USERNAME,
      email_id: user.EMAIL_ID,
      loginid: user.LOGINID,
      tenantId,
      tenant_name: tenantName,
      company_code: user.COMPANY_CODE,
      company_name: companyName,
      schemaName: tenantConfig.SCHEMA_NAME,
    });
    
    console.log(`[login] ✅ STEP 4 SUCCESS: Token generated`);
    console.log(`[login] ✅ LOGIN SUCCESSFUL for ${user.LOGINID}`);

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: { 
        token,
        tenantId,
        user: {
          username: user.USERNAME,
          email_id: user.EMAIL_ID,
          loginid: user.LOGINID,
          company_code: user.COMPANY_CODE,
          company_name: companyName,
          tenant_name: tenantName,
        }
      },
    });
  } catch (err: any) {
    console.error(`[login] ❌ ERROR:`, err.message);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "An error occurred",
      error: err.message || err,
    });
  }
};

export const me = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const requestUser = req.user;

    if (!requestUser) {
      res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: constants.MESSAGES.USER.USER_NOT_FOUND,
      });
      return;
    }

    let tenantId = requestUser.tenantId;
    let loginid = requestUser.loginid;

    console.log(`[me] INIT: User context = { loginid: ${loginid}, tenantId: ${tenantId} }`);

    // Get user info (this should come from the main database, not tenant-specific)
    const userResult = await AuthService.getUserWithTenant(requestUser.email_id);
    
    if (!userResult || !userResult.user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.USER.USER_NOT_FOUND,
      });
      return;
    }

    const user = userResult.user;

    // If tenantId not in JWT, use from user result
    if (!tenantId) {
      tenantId = userResult.tenantId || 'WMSDEV_TENANT';
      console.log(`[me] Using tenantId: ${tenantId}`);
    }

    // Remove sensitive data
    const userWithoutPassword: any = { ...user };
    delete userWithoutPassword.USERPASS;
    delete userWithoutPassword.SEC_PASSWD;

    const tenantConfig = await TenantManager.getTenantConfig(tenantId);
    const companyName = await resolveTenantCompanyName(tenantId, user.COMPANY_CODE);
    const tenantName = tenantConfig?.TENANT_NAME || tenantId;
    const enrichedUser = {
      ...userWithoutPassword,
      company_name: companyName,
      tenant_name: tenantName,
    };

    // Get permissions from user's tenant
    let userPermissions: any[] = [];
    let allPermissions: any[] = [];
    let formattedPermissions = {};
    let permissionBasedMenuTree = {};

    // CRITICAL: Get user permissions from tenant
    try {
      console.log(`[me] 🔍 STEP 1: Fetching user permissions...`);
      console.log(`[me]   - User: ${loginid}`);
      console.log(`[me]   - Tenant: ${tenantId}`);
      
      userPermissions = await AuthService.executeInUserTenant(
        loginid,
        userPermissionQuery,
        { loginid }
      );
      
      console.log(`[me] ✅ STEP 1 RESULT: Found ${userPermissions.length} permission records`);
      
      if (userPermissions.length === 0) {
        console.warn(`[me] CRITICAL WARNING: User '${loginid}' has NO permissions!`);
      }
    } catch (userPermError) {
      console.error(`[me] ❌ FAILED to get user permissions:`, userPermError);
      userPermissions = [];
    }

    // Get all available permissions from tenant
    try {
      console.log(`[me] 🔍 STEP 2: Fetching all available permissions...`);
      
      allPermissions = await AuthService.executeInUserTenant(
        loginid,
        permissionsListQuery,
        {}
      );
      
      console.log(`[me] ✅ Found ${allPermissions.length} total permissions available`);

      // Format user permissions
      if (userPermissions.length > 0) {
        console.log(`[me] 🔍 STEP 3: Formatting user permissions...`);
        formattedPermissions = formatRolePermissions(userPermissions);
        console.log(`[me] ✅ Formatted permissions keys: ${Object.keys(formattedPermissions).length}`);
        
        const validKeys = Object.keys(formattedPermissions).filter((key) => {
          const num = Number(key);
          return !isNaN(num) && num > 0;
        });

        if (validKeys.length > 0) {
          const serialNumbersNumeric = validKeys.map((sn) => Number(sn));
          const placeholders = serialNumbersNumeric
            .map((_, idx) => `:param${idx}`)
            .join(',');
          
          const menuTreeQuery = `
            SELECT * FROM SEC_MODULE_DATA 
            WHERE SERIAL_NO IN (${placeholders})
            ORDER BY APP_CODE, NVL(POSITION, 999999), SERIAL_NO
          `;

          const bindParams: any = {};
          serialNumbersNumeric.forEach((sn, idx) => {
            bindParams[`param${idx}`] = sn;
          });

          try {
            console.log(`[me] 🔍 STEP 4: Building menu tree...`);
            const menuTreeData = await AuthService.executeInUserTenant(
              loginid,
              menuTreeQuery,
              bindParams
            );

            if (menuTreeData && menuTreeData.length > 0) {
              // Build structured permissions object from allPermissions
              const structuredPermissions: StructuredResult = {};
              
              allPermissions.forEach((perm: any) => {
                const appCode = (perm.app_code || '').toString().trim();
                const menu = (perm.menu || '').toString().trim();
                const serialNo = Number(perm.serial_no || 0);
                
                if (serialNo > 0 && menu && appCode) {
                  if (!structuredPermissions[appCode]) {
                    structuredPermissions[appCode] = {
                      serial_number: serialNo,
                      app_code: appCode,
                      children: {},
                    };
                  }
                  
                  if (menu !== appCode) {
                    structuredPermissions[appCode].children[menu] = {
                      serial_number: serialNo,
                      app_code: appCode,
                    };
                  }
                }
              });
              
              permissionBasedMenuTree = buildTree(menuTreeData, structuredPermissions);
              console.log(`[me] ✅ Menu tree built with ${menuTreeData.length} items`);
            } else {
              console.warn(`[me] ⚠️ No menu tree data found`);
              permissionBasedMenuTree = {};
            }
          } catch (menuError) {
            console.warn(`[me] ⚠️ Failed to get menu tree:`, menuError);
            permissionBasedMenuTree = {};
          }
        } else {
          console.warn(`[me] ⚠️ No valid permission keys to build menu tree`);
          permissionBasedMenuTree = {};
        }
      } else {
        console.warn(`[me] ⚠️ User has no permissions, skipping menu tree build`);
        formattedPermissions = {};
        permissionBasedMenuTree = {};
      }
    } catch (permError) {
      console.error(`[me] ❌ Failed to get all permissions:`, permError);
      allPermissions = [];
      permissionBasedMenuTree = {};
    }

    // Build structured permissions for frontend
    const permissionsStructured: StructuredResult = {};
    
    if (Array.isArray(allPermissions) && allPermissions.length > 0) {
      console.log(`[me] 🔍 Building permissions structure from ${allPermissions.length} records`);
      console.log(`[me] 🔍 First 3 permission records:`, allPermissions.slice(0, 3));

      if (allPermissions.length > 0) {
        console.log(`[me] 🔍 Available fields in first record:`, Object.keys(allPermissions[0]));
        console.log(`[me] 🔍 Sample record values:`, {
          menu: allPermissions[0].menu,
          level: allPermissions[0].level,
          serial_no: allPermissions[0].serial_no,
          app_code: allPermissions[0].app_code,
          allFields: allPermissions[0]
        });
      }

      // Build a map of serial_no → app_code
      const serialToAppCodeMap: Record<number, string> = {};
      allPermissions.forEach((perm: any) => {
        const serialNo = Number(perm.serial_no || perm.SERIAL_NO || 0);
        const appCode = (perm.app_code || perm.APP_CODE || '').toString().trim();
        if (serialNo > 0 && appCode) serialToAppCodeMap[serialNo] = appCode;
      });
      console.log(`[me] 🔍 Built serial to app_code map with ${Object.keys(serialToAppCodeMap).length} entries`);

      // Build structured permissions
      allPermissions.forEach((perm: any) => {
        const menu = (perm.menu || perm.MENU || '').toString().trim();
        const serialNo = Number(perm.serial_no || perm.SERIAL_NO || 0);
        const appCode = (perm.app_code || perm.APP_CODE || '').toString().trim();

        if (!serialNo || !menu) return;

        const actualAppCode = appCode || serialToAppCodeMap[serialNo] || 'UNKNOWN';
        if (!actualAppCode || actualAppCode === 'UNKNOWN') return;

        if (!permissionsStructured[actualAppCode]) {
          permissionsStructured[actualAppCode] = {
            serial_number: serialNo,
            app_code: actualAppCode,
            children: {},
          };
        }

        if (menu !== actualAppCode && menu !== '0') {
          permissionsStructured[actualAppCode].children[menu] = {
            serial_number: serialNo,
            app_code: actualAppCode,
          };
        }
      });

      console.log(`[me] Permissions structure built for ${Object.keys(permissionsStructured).length} apps`);
      Object.entries(permissionsStructured).forEach(([appCode, appData]: [string, any]) => {
        console.log(`[me] 📊 ${appCode}:`, {
          serial_number: appData.serial_number,
          children_count: Object.keys(appData.children).length,
          children_sample: Object.keys(appData.children).slice(0, 5)
        });
      });
    } else {
      console.warn(`[me] No permissions data available`);
    }

    // Build module access
    const userAccessibleModules = buildModuleAccessFromStructure(
      allPermissions,
      formattedPermissions as StructuredResult
    );

    console.log(`[me] 📤 FINAL RESPONSE SUMMARY:`, {
      tenantId,
      user_permission_keys: Object.keys(formattedPermissions),
      permissions_count: allPermissions.length,
      accessible_modules: Object.keys(userAccessibleModules).length,
      has_permissions: Object.keys(formattedPermissions).length > 0
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        user: enrichedUser,
        tenantId,
        permissionBasedMenuTree,
        permissions: permissionsStructured,
        user_permission: formattedPermissions,
        userAccessibleModules,
      },
    });
  } catch (error: any) {
    console.error("Error in /api/auth/me:", error);
    console.error("Stack trace:", error.stack);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An error occurred",
    });
  }
};

export const changePasswordByEmail: RequestHandler = async (req: Request, res: Response) => {
  try {
    const requestUser = (req as any).user;
    const { newPassword, email, loginid, identifier } = req.body;

    const resolvedIdentifier = (
      identifier ||
      loginid ||
      email ||
      requestUser?.email_id ||
      requestUser?.email ||
      requestUser?.EMAIL_ID
    )?.toString().trim();

    if (!resolvedIdentifier || !newPassword) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "User identifier and new password are required",
      });
      return;
    }

    const user = await AuthService.findRootUserByIdentifier(resolvedIdentifier);

    if (!user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: EMAIL_NOT_FOUND_MESSAGE,
      });
      return;
    }
    const emailId = (user.EMAIL_ID || "").toString().trim();

    if (!isUsableEmail(emailId)) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: OUTDATED_EMAIL_MESSAGE,
      });
      return;
    }

    const hashedPassword = await AuthService.hashPassword(newPassword);
    await AuthService.updateUserPassword(emailId, hashedPassword);

    try {
      await notifyUser({
        event: constants.EVENTS.RESET_PASSWORD,
        request_users: emailId,
        subject: "Password change successful",
        htmlMessage: `
          <p>Dear User,</p>
          <p>Your password was changed successfully.</p>
          <p>New password: ${newPassword}</p>
          <p>Please sign in with your new password.</p>
          <p>Best regards,</p>
          <p>Bayanat Technology</p>
        `,
      });
    } catch (notifyError) {
      console.warn("Password change email notification failed:", notifyError);
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Dear User, Your password was changed successfully. Please sign in with your new password.",
    });
    return;
  } catch (error: any) {
    console.error("Change Password Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An error occurred",
    });
    return;
  }
};

export const forgotPassword: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Email is required",
      });
      return;
    }

    // Check if user exists
    const user = await AuthService.findRootUserByIdentifier(email);

    if (!user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: EMAIL_NOT_FOUND_MESSAGE,
      });
      return;
    }

    const emailId = (user.EMAIL_ID || "").toString().trim();
    if (!isUsableEmail(emailId)) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: OUTDATED_EMAIL_MESSAGE,
      });
      return;
    }

    const resetToken = generatePasswordResetToken(emailId);
    const resetPasswordUrl = buildResetPasswordUrl(req, resetToken);



    // Send password reset email


    await notifyUser({
      event: constants.EVENTS.FORGOT_PASSWORD,
      request_users: emailId,
      subject: "Password Reset Instructions",
      htmlMessage: `
        <p>Dear User,</p>
        <p>Please click on the following link to reset your password:</p>
        <p><a href="${resetPasswordUrl}" target="_blank" rel="noopener noreferrer">Reset Password</a></p>
        <p>This link will expire in 10 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
        <p>Best regards,</p>
        <p>Bayanat Technology</p>
      `,
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Password reset instructions have been sent to your email",
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An error occurred",
    });
    return;
  }
};

export const resetPassword: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { email, password, token } = req.body;

    if (!password || (!token && !email)) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Password reset link and new password are required",
      });
      return;
    }

    const resolvedEmail = token ? verifyPasswordResetToken(token) : email;

    // Find user by email
    const user = await AuthService.findRootUserByIdentifier(resolvedEmail);

    if (!user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: EMAIL_NOT_FOUND_MESSAGE,
      });
      return;
    }

    const emailId = (user.EMAIL_ID || "").toString().trim();
    if (!isUsableEmail(emailId)) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: OUTDATED_EMAIL_MESSAGE,
      });
      return;
    }

    // Hash the new password
    const hashedPassword = await AuthService.hashPassword(password);

    // Update user's password
    await AuthService.updateUserPassword(emailId, hashedPassword);

    // Send confirmation email
    await notifyUser({
      event: constants.EVENTS.RESET_PASSWORD,
      request_users: emailId,
      subject: "Password Reset Successful",
      htmlMessage: `
        <p>Dear User,</p>
        <p>Your password has been successfully reset.</p>
        <p>New password: ${password}</p>
        <p>If you did not make this change, please contact support immediately.</p>
        <p>Best regards,</p>
        <p>Bayanat Technology</p>
      `,
    });

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Password has been reset successfully",
    });
    return;
  } catch (error: any) {
    console.error("Reset Password Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An error occurred",
    });
    return;
  }
};
export const resetPasswordWithLoginId: RequestHandler = async (req: Request, res: Response) => {
  try {
    const { loginId, newPassword } = req.body;

    if (!loginId || !newPassword) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Login ID and new password are required",
      });
      return;
    }

    // Find user by login ID
    const user = await AuthService.findRootUserByIdentifier(loginId);

    if (!user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: EMAIL_NOT_FOUND_MESSAGE,
      });
      return;
    }

    const emailId = (user.EMAIL_ID || "").toString().trim();
    if (!isUsableEmail(emailId)) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: OUTDATED_EMAIL_MESSAGE,
      });
      return;
    }

    // Hash the new password
    const hashedPassword = await AuthService.hashPassword(newPassword);

    // Update user's password using email
    await AuthService.updateUserPassword(emailId, hashedPassword);

    const resetToken = generatePasswordResetToken(emailId);
    const resetPasswordUrl = buildResetPasswordUrl(req, resetToken);

    // Check if company_code contains JASRA (case-insensitive)
    const isJasraCompany = user.COMPANY_CODE && 
                           user.COMPANY_CODE.toUpperCase().includes("JASRA");
    
    if (isJasraCompany) {
      // For JASRA users: Send password reset link via email
      await notifyUser({
        event: constants.EVENTS.RESET_PASSWORD,
        request_users: emailId,
        subject: "Password Reset Link",
        htmlMessage: `
          <p>Dear ${user.USERNAME || 'User'},</p>
          <p>Please click on the following link to reset your password:</p>
          <p><a href="${resetPasswordUrl}" target="_blank" rel="noopener noreferrer">Reset Password</a></p>
          <p>If you did not request this, please ignore this email.</p>
          <p>Best regards,</p>
          <p>Bayanat Technology</p>
        `,
      });

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Password reset link has been sent to your email",
        emailSent: true,
      });
      return;
    } else {
      // For non-JASRA users: Reset password directly
      // Send confirmation email
      await notifyUser({
        event: constants.EVENTS.RESET_PASSWORD,
        request_users: emailId,
        subject: "Password Reset Successful",
        htmlMessage: `
          <p>Dear ${user.USERNAME || 'User'},</p>
          <p>Your password has been successfully reset for login ID: ${loginId}</p>
          <p>New password: ${newPassword}</p>
          <p>If you did not make this change, please contact support immediately.</p>
          <p>Best regards,</p>
          <p>Bayanat Technology</p>
        `,
      });

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Password has been reset successfully",
        emailSent: false,
      });
      return;
    }
  } catch (error: any) {
    console.error("Reset Password With Login ID Error:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An error occurred while resetting password",
    });
    return;
  }
};

// ============ DIAGNOSTIC ENDPOINT ============
export const diagnosticPermissions = async (req: RequestWithUser, res: Response): Promise<void> => {
  try {
    const requestUser = req.user;

    if (!requestUser) {
      res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "No user context",
      });
      return;
    }

    const tenantId = requestUser.tenantId || 'WMSDEV_TENANT';
    const loginid = requestUser.loginid;

    console.log(`[diagnostic] 🔍 Starting permission diagnostic for user: ${loginid}, tenant: ${tenantId}`);

    const diagnostics: any = {
      user: loginid,
      tenant: tenantId,
      timestamp: new Date().toISOString(),
      checks: {}
    };

    // CHECK 1: User exists
    try {
      const userResult = await AuthService.getUserWithTenant(requestUser.email_id);
      diagnostics.checks.user_exists = !!userResult?.user;
      console.log(`[diagnostic] CHECK 1: User exists = ${diagnostics.checks.user_exists}`);
    } catch (err) {
      diagnostics.checks.user_exists = false;
      diagnostics.checks.user_exists_error = err instanceof Error ? err.message : String(err);
    }

    // CHECK 2: User permissions query result
    try {
      const userPerms = await AuthService.executeInUserTenant(
        loginid,
        userPermissionQuery,
        { loginid }
      );
      diagnostics.checks.user_permissions_count = userPerms.length;
      if (userPerms.length > 0) {
        diagnostics.checks.first_permission = userPerms[0];
      }
      console.log(`[diagnostic] CHECK 2: User permissions found = ${userPerms.length}`);
    } catch (err) {
      diagnostics.checks.user_permissions_error = err instanceof Error ? err.message : String(err);
      console.log(`[diagnostic] CHECK 2: Error fetching permissions:`, err);
    }

    // CHECK 3: All permissions available
    try {
      const allPerms = await AuthService.executeInUserTenant(
        loginid,
        permissionsListQuery,
        {}
      );
      diagnostics.checks.all_permissions_count = allPerms.length;
      console.log(`[diagnostic] CHECK 3: Total permissions available = ${allPerms.length}`);
    } catch (err) {
      diagnostics.checks.all_permissions_error = err instanceof Error ? err.message : String(err);
      console.log(`[diagnostic] CHECK 3: Error fetching all permissions:`, err);
    }

    // CHECK 4: Call the actual /me endpoint logic
    try {
      const userResult = await AuthService.getUserWithTenant(requestUser.email_id);
      const userPermissions = await AuthService.executeInUserTenant(
        loginid,
        userPermissionQuery,
        { loginid }
      );
      const formattedPerms = formatRolePermissions(userPermissions);
      diagnostics.checks.formatted_permissions = formattedPerms;
      diagnostics.checks.formatted_permissions_count = Object.keys(formattedPerms).length;
      console.log(`[diagnostic] CHECK 4: Formatted permissions = ${diagnostics.checks.formatted_permissions_count} keys`);
    } catch (err) {
      diagnostics.checks.formatted_permissions_error = err instanceof Error ? err.message : String(err);
      console.log(`[diagnostic] CHECK 4: Error formatting permissions:`, err);
    }

    // SQL Queries to run manually
    diagnostics.manual_sql_checks = {
      check_user_permissions: `SELECT * FROM SEC_ROLE_FUNCTION_ACCESS_USER WHERE LOGINID = '${loginid}'`,
      check_role_app_access: `SELECT * FROM SEC_ROLE_APP_ACCESS`,
      check_tables_exist: `SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ('SEC_ROLE_FUNCTION_ACCESS_USER', 'SEC_ROLE_APP_ACCESS')`,
    };

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: diagnostics
    });
  } catch (error: any) {
    console.error("[diagnostic] Error in diagnostic endpoint:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Diagnostic failed",
      error: error.stack
    });
  }
};
