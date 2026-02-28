import { Request, Response, NextFunction } from 'express';
import { RoutesService } from '../services/Security/routes.service';
import { AuthService } from '../services/auth.service';
import constants from '../helpers/constants';
import { RequestWithUser } from '../interfaces/common.interface';

/**
 * Route Permission Middleware
 * Validates that the user has access to the requested route
 * based on SEC_MODULE_DATA and SEC_ROLE_FUNCTION_ACCESS_USER tables
 */

export const routePermissionMiddleware = async (
  req: RequestWithUser,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = req.user;
    
    if (!user) {
      res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }

    // Extract the route path from the request
    const { route_path } = req.body || req.query;
    
    if (!route_path) {
      // No route path specified - allow access
      next();
      return;
    }

    // Lookup the route in SEC_MODULE_DATA
    const route = await RoutesService.getRouteByPath(route_path);
    
    if (!route) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: `Route not found: ${route_path}`,
      });
      return;
    }

    // Check user permissions for this route
    const hasPermission = await checkUserRoutePermission(
      user.loginid,
      route.serial_no
    );

    if (!hasPermission) {
      res.status(constants.STATUS_CODES.FORBIDDEN).json({
        success: false,
        message: 'You do not have permission to access this route',
      });
      return;
    }

    // Attach route info to request
    req.route_info = route;

    next();
  } catch (error: any) {
    console.error('[routePermissionMiddleware] Error:', error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Permission check failed',
    });
  }
};

/**
 * Check if user has permission to access a specific route/module
 * @param loginid - User login ID
 * @param serialNo - Route serial number from SEC_MODULE_DATA
 * @returns boolean - true if user has access
 */
async function checkUserRoutePermission(
  loginid: string,
  serialNo: number
): Promise<boolean> {
  try {
    // Query to check if user has permission for this route
    const query = `
      SELECT COUNT(*) as count
      FROM SEC_ROLE_FUNCTION_ACCESS_USER srfau
      WHERE srfau.LOGINID = :loginid
        AND (
          srfau.SERIAL_NO_OR_ROLE_ID = :serialNo
          OR EXISTS (
            SELECT 1
            FROM SEC_ROLE_APP_ACCESS sraa
            WHERE sraa.ROLE_ID = srfau.SERIAL_NO_OR_ROLE_ID
              AND sraa.SERIAL_NO = :serialNo
          )
        )
    `;

    const result = await AuthService.executeInUserTenant(
      loginid,
      query,
      { loginid, serialNo }
    );

    return result && result.length > 0 && result[0].count > 0;
  } catch (error) {
    console.error('[checkUserRoutePermission] Error:', error);
    return false;
  }
}

/**
 * Alternative: Middleware that validates routes based on JWT payload
 * Assumes the JWT contains a list of accessible route paths
 */
export const jwtRoutePermissionMiddleware = async (
  req: RequestWithUser,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = req.user;
    
    if (!user) {
      res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }

    // Extract route path from request
    const { route_path } = req.body || req.query;
    
    if (!route_path) {
      next();
      return;
    }

    // If JWT had accessible_routes, check against it
    if (user.accessible_routes && Array.isArray(user.accessible_routes)) {
      const hasAccess = user.accessible_routes.includes(route_path);
      
      if (!hasAccess) {
        res.status(constants.STATUS_CODES.FORBIDDEN).json({
          success: false,
          message: 'You do not have permission to access this route',
        });
        return;
      }
    }

    next();
  } catch (error: any) {
    console.error('[jwtRoutePermissionMiddleware] Error:', error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Permission check failed',
    });
  }
};

/**
 * Middleware to check route availability by status
 * Prevents access to COMING_SOON routes
 */
export const routeAvailabilityMiddleware = async (
  req: RequestWithUser,
  res: Response,
  next: NextFunction
) => {
  try {
    const { route_path } = req.body || req.query;
    
    if (!route_path) {
      next();
      return;
    }

    const route = await RoutesService.getRouteByPath(route_path);
    
    if (!route) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Route not found',
      });
      return;
    }

    // Check if route is coming soon or inactive
    if (route.route_type === 'COMING_SOON' || route.is_active === 'N') {
      res.status(503).json({
        success: false,
        message: 'This route is not currently available',
      });
      return;
    }

    req.route_info = route;
    next();
  } catch (error: any) {
    console.error('[routeAvailabilityMiddleware] Error:', error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Route availability check failed',
    });
  }
};

// Extend Express Request to include route_info
declare global {
  namespace Express {
    interface Request {
      route_info?: any;
    }
  }
}
