import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface RequestWithTenant extends Request {
  tenantId?: string;
  user?: any;
}

export const tenantMiddleware = async (
  req: RequestWithTenant,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.path.startsWith('/api/auth/login') || 
        req.path.startsWith('/api/auth/forgot-password') ||
        req.path === '/health') {
      return next();
    }

    // Get token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: "Authorization token required"
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.APP_SECRET || 'BAYANAT') as any;
    
    // Attach tenant and user to request
    req.tenantId = decoded.tenantId;
    req.user = {
      loginid: decoded.loginid,
      email_id: decoded.email_id,
      username: decoded.username,
      company_code: decoded.company_code
    };
    // Also set tenantId on req.user for compatibility with tenantContextMiddleware
    try {
      (req.user as any).tenantId = req.tenantId;
    } catch (_) {}
    
    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({
        success: false,
        message: "Invalid authentication token"
      });
      return;
    }
    
    console.error("Tenant middleware error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};
