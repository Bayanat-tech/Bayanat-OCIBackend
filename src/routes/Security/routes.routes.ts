import { Router } from 'express';
import passport from 'passport';
import { tenantContextMiddleware } from '../../middleware/tenantContext.middleware';
import {
  getAllRoutes,
  getRouteTree,
  getRoutesByApp,
  getRouteByPath,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
} from '../../controllers/Security/routes.controller';

const router = Router();

// Middleware: Require JWT authentication and tenant context for all routes
const authMiddleware = [
  passport.authenticate('jwt', { session: false }),
  tenantContextMiddleware,
];

/**
 * Routes Endpoints
 * Base path: /api/routes
 */

// GET /api/routes - Fetch all active routes
router.get('/', authMiddleware, getAllRoutes);

// GET /api/routes/tree - Fetch routes in hierarchical tree structure
router.get('/tree', authMiddleware, getRouteTree);

// GET /api/routes/app/:appCode - Fetch routes for specific app
router.get('/app/:appCode', authMiddleware, getRoutesByApp);

// GET /api/routes/path/:urlPath - Fetch route by URL path
router.get('/path/:urlPath', authMiddleware, getRouteByPath);

// GET /api/routes/:serialNo - Fetch route by serial number
router.get('/:serialNo', authMiddleware, getRouteById);

// POST /api/routes - Create new route (requires admin)
router.post('/', authMiddleware, createRoute);

// PUT /api/routes/:serialNo - Update route (requires admin)
router.put('/:serialNo', authMiddleware, updateRoute);

// DELETE /api/routes/:serialNo - Delete/deactivate route (requires admin)
router.delete('/:serialNo', authMiddleware, deleteRoute);

export default router;
