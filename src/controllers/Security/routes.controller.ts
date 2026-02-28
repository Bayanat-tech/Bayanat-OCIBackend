import { Request, Response, RequestHandler } from "express";
import { RoutesService } from "../../services/Security/routes.service";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";

/**
 * Routes Controller
 * API endpoints for dynamic route management
 */

/**
 * GET /api/routes
 * Fetch all active routes for the current tenant and user
 */
export const getAllRoutes: RequestHandler = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const routes = await RoutesService.getAllRoutes();
    
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: routes,
    });
  } catch (error: any) {
    console.error("Error fetching routes:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to fetch routes",
    });
  }
};

/**
 * GET /api/routes/tree
 * Fetch routes in hierarchical tree structure (for navigation)
 */
export const getRouteTree: RequestHandler = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const routes = await RoutesService.getAllRoutes();
    const tree = RoutesService.buildRouteTree(routes);
    
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: tree,
    });
  } catch (error: any) {
    console.error("Error building route tree:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to build route tree",
    });
  }
};

/**
 * GET /api/routes/app/:appCode
 * Fetch routes for a specific application
 */
export const getRoutesByApp: RequestHandler = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { appCode } = req.params;

    if (!appCode) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "App code is required",
      });
      return;
    }

    const routes = await RoutesService.getRoutesByAppCode(appCode);
    
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: routes,
    });
  } catch (error: any) {
    console.error("Error fetching routes by app:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to fetch routes",
    });
  }
};

/**
 * GET /api/routes/path/:urlPath
 * Fetch a specific route by URL path
 */
export const getRouteByPath: RequestHandler = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { urlPath } = req.params;

    if (!urlPath) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "URL path is required",
      });
      return;
    }

    const route = await RoutesService.getRouteByPath(decodeURIComponent(urlPath));
    
    if (!route) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Route not found",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: route,
    });
  } catch (error: any) {
    console.error("Error fetching route by path:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to fetch route",
    });
  }
};

/**
 * GET /api/routes/:serialNo
 * Fetch a specific route by serial number
 */
export const getRouteById: RequestHandler = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { serialNo } = req.params;

    if (!serialNo) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Serial number is required",
      });
      return;
    }

    const route = await RoutesService.getRouteBySerialNo(parseInt(serialNo));
    
    if (!route) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Route not found",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: route,
    });
  } catch (error: any) {
    console.error("Error fetching route by ID:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to fetch route",
    });
  }
};

/**
 * POST /api/routes
 * Create a new route
 */
export const createRoute: RequestHandler = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const routeData = req.body;

    // Validate required fields
    if (!routeData.app_code || !routeData.url_path) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "app_code and url_path are required",
      });
      return;
    }

    // Add user context
    routeData.created_by = req.user?.username || "SYSTEM";
    routeData.updated_by = req.user?.username || "SYSTEM";
    routeData.company_code = routeData.company_code || req.user?.company_code;

    const route = await RoutesService.saveRoute(routeData);

    res.status(constants.STATUS_CODES.CREATED).json({
      success: true,
      message: "Route created successfully",
      data: route,
    });
  } catch (error: any) {
    console.error("Error creating route:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to create route",
    });
  }
};

/**
 * PUT /api/routes/:serialNo
 * Update an existing route
 */
export const updateRoute: RequestHandler = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { serialNo } = req.params;
    const routeData = req.body;

    if (!serialNo) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Serial number is required",
      });
      return;
    }

    // Note: Add serial_no to the update payload
    routeData.serial_no = parseInt(serialNo);
    routeData.updated_by = req.user?.username || "SYSTEM";

    const route = await RoutesService.saveRoute(routeData);

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Route updated successfully",
      data: route,
    });
  } catch (error: any) {
    console.error("Error updating route:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to update route",
    });
  }
};

/**
 * DELETE /api/routes/:serialNo
 * Soft delete a route (deactivate)
 */
export const deleteRoute: RequestHandler = async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const { serialNo } = req.params;

    if (!serialNo) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Serial number is required",
      });
      return;
    }

    const deleted = await RoutesService.deactivateRoute(parseInt(serialNo));

    if (!deleted) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Route not found",
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: "Route deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting route:", error);
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to delete route",
    });
  }
};
