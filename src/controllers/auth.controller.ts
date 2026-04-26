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
            ORDER BY SERIAL_NO
          `;

          const bindParams: any = {};
          serialNumbersNumeric.forEach((sn, idx) => {
            bindParams[`param${idx}`] = sn;
          });

          try {
            console.log(`[me] 🔍 STEP 4: Building menu tree...`);
            const menuTreeDataRaw = await AuthService.executeInUserTenant(
              loginid,
              menuTreeQuery,
              bindParams
            );

            // Enrich rows with `api_endpoint` fallback when DB column is absent
            const menuTreeData = (menuTreeDataRaw || []).map((row: any) => {
              const urlPath = (row.url_path || row.URL_PATH || '').toString().trim();
              let api_endpoint = row.api_endpoint || row.API_ENDPOINT || null;
              if (!api_endpoint && urlPath) {
                const parts = urlPath.split('/').filter(Boolean);
                const last = parts.length ? parts[parts.length - 1] : null;
                api_endpoint = last ? last.toLowerCase() : null;
              }
              return { ...row, api_endpoint };
            });

            console.log(`[me] 🔍 Enriched menuTreeData with api_endpoint: ${menuTreeData.filter((m: any) => m.api_endpoint).length}/${menuTreeData.length}`);

            if (menuTreeData && menuTreeData.length > 0) {
              // Build structured permissions object from allPermissions
              const structuredPermissions: StructuredResult = {};
              
              allPermissions.forEach((perm: any) => {
                const appCode = (perm.app_code || '').toString().trim();
                const menu = (perm.menu || '').toString().trim();
                const urlPath = (perm.url_path || perm.URL_PATH || '').toString().trim();
                const serialNo = Number(perm.serial_no || 0);

                if (serialNo > 0 && menu && appCode) {
                  if (!structuredPermissions[appCode]) {
                    structuredPermissions[appCode] = {
                      serial_number: serialNo,
                      app_code: appCode,
                      children: {},
                    };
                  }

                  const urlLastRaw = urlPath ? urlPath.split('/').pop() : null;
                  const urlKeyLower = urlLastRaw ? urlLastRaw.toLowerCase() : null;
                  const urlKeyUpper = urlLastRaw ? urlLastRaw.toUpperCase() : null;

                  if (menu !== appCode) {
                    // keep title-based key for backward compatibility
                    structuredPermissions[appCode].children[menu] = {
                      serial_number: serialNo,
                      app_code: appCode,
                    };

                    // deterministically add url-based keys so frontend lookups by path segment succeed
                    if (urlKeyLower) {
                      structuredPermissions[appCode].children[urlKeyLower] = {
                        serial_number: serialNo,
                        app_code: appCode,
                      };
                    }
                    if (urlKeyUpper && urlKeyUpper !== menu) {
                      structuredPermissions[appCode].children[urlKeyUpper] = {
                        serial_number: serialNo,
                        app_code: appCode,
                      };
                    }
                    if (urlLastRaw && urlLastRaw !== menu && urlLastRaw !== urlKeyLower && urlLastRaw !== urlKeyUpper) {
                      structuredPermissions[appCode].children[urlLastRaw] = {
                        serial_number: serialNo,
                        app_code: appCode,
                      };
                    }
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
        const menu    = (perm.menu || perm.MENU || '').toString().trim();
        const urlPath = (perm.url_path || perm.URL_PATH || '').toString().trim();
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

        // Extract last segment of url_path e.g. "wms/masters/gm/principal" → "principal"
        const urlLastRaw = urlPath ? urlPath.split('/').pop() : null;
        const urlKeyLower = urlLastRaw ? urlLastRaw.toLowerCase() : null;
        const urlKeyUpper = urlLastRaw ? urlLastRaw.toUpperCase() : null;

        if (menu !== actualAppCode && menu !== '0') {
          // Keep existing title-based key
          permissionsStructured[actualAppCode].children[menu] = {
            serial_number: serialNo,
            app_code: actualAppCode,
          };

          // Deterministically add url-based keys so frontend lookup by path segment works
          if (urlKeyLower) {
            permissionsStructured[actualAppCode].children[urlKeyLower] = {
              serial_number: serialNo,
              app_code: actualAppCode,
            };
          }
          if (urlKeyUpper && urlKeyUpper !== menu) {
            permissionsStructured[actualAppCode].children[urlKeyUpper] = {
              serial_number: serialNo,
              app_code: actualAppCode,
            };
          }
          if (urlLastRaw && urlLastRaw !== menu && urlLastRaw !== urlKeyLower && urlLastRaw !== urlKeyUpper) {
            permissionsStructured[actualAppCode].children[urlLastRaw] = {
              serial_number: serialNo,
              app_code: actualAppCode,
            };
          }
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
          // Extra debug: print WMS child keys (helpful to confirm insertion of url-segment keys)
          if (permissionsStructured['WMS']) {
            console.log('[me] 🔎 WMS children keys sample (first 200):', Object.keys(permissionsStructured['WMS'].children).slice(0, 200));
          }
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

    // Debug: list routes missing component_name so we can map them
    try {
      const missingComponents: string[] = [];
      const findMissing = (node: any) => {
        if (!node) return;
        if (node.type === 'item' && !(node.component_name || node.COMPONENT_NAME)) {
          missingComponents.push(node.url_path || node.title || node.id || 'unknown');
        }
        if (Array.isArray(node.children)) node.children.forEach(findMissing);
      };
      if (Array.isArray(permissionBasedMenuTree)) permissionBasedMenuTree.forEach(findMissing);
      if (missingComponents.length > 0) {
        console.log('[me] 🔧 Missing component_name for routes (sample 50):', missingComponents.slice(0, 50));
      } else {
        console.log('[me] ✅ No missing component_name found in permissionBasedMenuTree');
      }
    } catch (dbgErr) {
      console.warn('[me] ⚠️ Error while checking missing component_name:', dbgErr);
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        user: userWithoutPassword,
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