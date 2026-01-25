import { Request, Response, RequestHandler } from "express";
import constants from "../helpers/constants";
import {
  buildTree,
  formatRolePermissions,
  notifyUser,
} from "../helpers/functions";
import { loginSchema } from "../validation/auth.validation";
import { StructuredResult } from "../interfaces/auth.interface";
import { RequestWithUser } from "../interfaces/common.interface";
import { AuthService } from "../services/auth.service";
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
    company_code: userData.company_code,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) 
  };
  
  return jwt.sign(payload, process.env.APP_SECRET || 'BAYANAT');
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

    // Generate token with tenant info
    console.log(`[login] STEP 4: Generating JWT token...`);
    const token = await generateToken({
      username: user.USERNAME,
      email_id: user.EMAIL_ID,
      loginid: user.LOGINID,
      tenantId: tenantId,
      company_code: user.COMPANY_CODE,
      schemaName: tenantConfig.SCHEMA_NAME
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
          company_code: user.COMPANY_CODE
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

    const tenantId = requestUser.tenantId || 'WMSDEV_TENANT';
    const loginid = requestUser.loginid;

    console.log(`[me] Getting user info for ${loginid}...`);

    // Get user from central SEC_LOGIN
    const userResult = await AuthService.getUserWithTenant(requestUser.email_id);
    
    if (!userResult || !userResult.user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.USER.USER_NOT_FOUND,
      });
      return;
    }

    const user = userResult.user;

    // Remove sensitive data
    const userWithoutPassword: any = { ...user };
    delete userWithoutPassword.USERPASS;
    delete userWithoutPassword.SEC_PASSWD;

    // Get permissions from user's tenant
    let userPermissions: any[] = [];
    let allPermissions: any[] = [];
    let formattedPermissions = {};
    let permissionBasedMenuTree = {};

    // Get user permissions from tenant (with error handling)
    try {
      userPermissions = await AuthService.executeInUserTenant(
        loginid,
        userPermissionQuery,
        { loginid }
      );
    } catch (userPermError) {
      console.warn(`⚠️ Failed to get user permissions for ${loginid}:`, userPermError instanceof Error ? userPermError.message : String(userPermError));
      userPermissions = [];
    }

    // Get all permissions from tenant (with error handling)
    try {
      const permissionsArray = await AuthService.executeInUserTenant(
        loginid,
        permissionsListQuery,
        {}
      );
      
      // Convert permissions array to object for buildTree
      allPermissions = permissionsArray;
      const allPermissionsObj: StructuredResult = {};
      if (Array.isArray(permissionsArray)) {
        permissionsArray.forEach((perm: any, idx: number) => {
          allPermissionsObj[idx.toString()] = perm;
        });
      }

      // Build menu tree
      if (userPermissions.length > 0) {
        formattedPermissions = formatRolePermissions(userPermissions);
        
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
            ORDER BY SERIAL_NO
          `;

          const bindParams: any = {};
          serialNumbersNumeric.forEach((sn, idx) => {
            bindParams[`param${idx}`] = sn;
          });

          try {
            const menuTreeData = await AuthService.executeInUserTenant(
              loginid,
              menuTreeQuery,
              bindParams
            );

            if (menuTreeData && menuTreeData.length > 0) {
              permissionBasedMenuTree = buildTree(menuTreeData, allPermissionsObj);
            }
          } catch (menuError) {
            console.warn(`⚠️ Failed to get menu tree for ${loginid}:`, menuError instanceof Error ? menuError.message : String(menuError));
            permissionBasedMenuTree = {};
          }
        }
      }
    } catch (permError) {
      console.warn(`⚠️ Failed to get all permissions for ${loginid}:`, permError instanceof Error ? permError.message : String(permError));
      allPermissions = [];
      permissionBasedMenuTree = {};
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        user: userWithoutPassword,
        tenantId,
        permissionBasedMenuTree,
        permissions: allPermissions,
        user_permission: formattedPermissions,
      },
    });
  } catch (error: any) {
    console.error("Error in /api/auth/me:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "An error occurred",
    });
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
    const userResult = await AuthService.getUserWithTenant(email);

    if (!userResult || !userResult.user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    const user = userResult.user;

    // Send password reset email
    await notifyUser({
      event: constants.EVENTS.FORGOT_PASSWORD,
      request_users: user.EMAIL_ID,
      subject: "Password Reset Instructions",
      htmlMessage: `
        <p>Dear User,</p>
        <p>Please click on the following link to reset your password:</p>
        <p><a href="${process.env.FRONTEND_URL}/reset-password?email=${user.EMAIL_ID}">Reset Password</a></p>
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
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Email and password are required",
      });
      return;
    }

    // Find user by email
    const userResult = await AuthService.getUserWithTenant(email);

    if (!userResult || !userResult.user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    const user = userResult.user;

    // Hash the new password
    const hashedPassword = await AuthService.hashPassword(password);

    // Update user's password
    await AuthService.updateUserPassword(email, hashedPassword);

    // Send confirmation email
    await notifyUser({
      event: constants.EVENTS.RESET_PASSWORD,
      request_users: user.EMAIL_ID,
      subject: "Password Reset Successful",
      htmlMessage: `
        <p>Dear User,</p>
        <p>Your password has been successfully reset.</p>
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
    const userResult = await AuthService.getUserWithTenant(loginId);

    if (!userResult || !userResult.user) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "User not found with the provided login ID",
      });
      return;
    }

    const user = userResult.user;

    // Hash the new password
    const hashedPassword = await AuthService.hashPassword(newPassword);

    // Update user's password using email
    await AuthService.updateUserPassword(user.EMAIL_ID, hashedPassword);

    // Check if company_code contains JASRA (case-insensitive)
    const isJasraCompany = user.COMPANY_CODE && 
                           user.COMPANY_CODE.toUpperCase().includes("JASRA");
    
    if (isJasraCompany) {
      // For JASRA users: Send password reset link via email
      await notifyUser({
        event: constants.EVENTS.RESET_PASSWORD,
        request_users: user.EMAIL_ID,
        subject: "Password Reset Link",
        htmlMessage: `
          <p>Dear ${user.USERNAME || 'User'},</p>
          <p>Please click on the following link to reset your password:</p>
          <p><a href="${process.env.FRONTEND_URL}/reset-password?email=${user.EMAIL_ID}">Reset Password</a></p>
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
        request_users: user.EMAIL_ID,
        subject: "Password Reset Successful",
        htmlMessage: `
          <p>Dear ${user.USERNAME || 'User'},</p>
          <p>Your password has been successfully reset for login ID: ${loginId}</p>
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