import cors from "cors";
import express, { Request, Response } from "express";
import { RequestWithTenant } from "./src/middleware/tenant.middleware";
import { initializeAllConnections } from "./src/database/connection";
import { tenantMiddleware } from "./src/middleware/tenant.middleware";
import "./src/utils/passport";

console.log("INDEX.TS LOADED - starting imports...");

// Import routes
console.log("Loading authRoutes...");
import authRoutes from "./src/routes/auth.routes";
console.log("✓ authRoutes loaded");

import wmsRoutes from "./src/routes/wms.routes";
import financeRoutes from "./src/routes/finance/finance.routes";
import hrRoutes from "./src/routes/hr.routes";
import pfRoutes from "./src/routes/pf.routes";
import pamsRoutes from "./src/routes/pams.routes";
import secRoutes from "./src/routes/secuity.routes";
import vendorRoutes from "./src/routes/vendor.routes";
import filesRoutes from "./src/routes/files.routes";
import userRoutes from "./src/routes/user/user.routes";
import attendanceRoutes from "./src/routes/Attendance/attendance.routes";
import smsRoutes from "./src/routes/SMS/sms.routes";
import smsGmRoutes from "./src/routes/SMS/sms.gmroutes";
import securityGmRoutes from "./src/routes/Security/gm_Security.routes";
import stockAdjustmentRoutes from "./src/routes/StockAdjustment/stockAdjustment.routes";
import notificationRoutes from "./src/routes/notification.routes";

console.log("All route files imported successfully");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply tenant middleware to API routes
app.use("/api", tenantMiddleware);

// Routes
// app.use("/api/auth", authRoutes);
// app.use("/api/wms", wmsRoutes);
// app.use("/api/finance", financeRoutes);
// app.use("/api/hr", hrRoutes);
// app.use("/api/pf", pfRoutes);
// app.use("/api/pams", pamsRoutes);
// app.use("/api/security", secRoutes);
// app.use("/api/vendor", vendorRoutes);
// app.use("/api/files", filesRoutes);
// app.use("/api/user", userRoutes);
// app.use("/api/attendance", attendanceRoutes);
// app.use("/api/sms", smsRoutes);
// app.use("/api/sms-gm", smsGmRoutes);
// app.use("/api/security-gm", securityGmRoutes);
// app.use("/api/stock-adjustment", stockAdjustmentRoutes);
// app.use("/api/notification", notificationRoutes);
console.log("Routes registered, about to setup health check...");
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
    mode: "multi-tenant"
  });
});

// Test endpoint
const testTenantHandler: express.RequestHandler = async (req: any, res: Response) => {
  try {
    if (!req.tenantId) {
      res.status(400).json({
        success: false,
        message: "No tenant context"
      });
      return;
    }

    const { TenantManager } = require("./src/database/TenantManager");
    const conn = await TenantManager.getConnection(req.tenantId);
    const result = await conn.execute("SELECT USER FROM DUAL");
    await conn.close();

    res.json({
      success: true,
      tenantId: req.tenantId,
      databaseUser: result.rows[0]?.USER,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

app.get("/api/test-tenant", testTenantHandler);

const PORT = process.env.PORT || 3500;

async function startServer() {
  try {
    console.log("🚀 Starting multi-tenant server...");
    
    // Initialize all connections
    console.log("Initializing database connections...");
    await initializeAllConnections();
    console.log("✅ All database connections initialized");
    
    // Start server
    console.log(`Listening on port ${PORT}...`);
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log("🌐 Multi-tenant mode: ACTIVE");
      console.log("🔗 Health check: http://localhost:" + PORT + "/health");
      console.log("🔗 Test tenant: http://localhost:" + PORT + "/api/test-tenant");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  const { closeAllConnections } = require("./src/database/connection");
  await closeAllConnections();
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
console.log("About to call startServer()...");
startServer().catch(err => {
  console.error("Uncaught error in startServer:", err);
  process.exit(1);
});

startServer();
