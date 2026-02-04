import cors from "cors";
import express, { Request, Response } from "express";
import { initializeAllConnections } from "./src/database/connection";
import "./src/utils/passport";
import { tenantContextMiddleware } from "./src/middleware/tenantContext.middleware";
import passport from "passport";

const app = express();
console.log("🔥 index.ts loaded");

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(passport.initialize());

export const withTenantContext = [
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware
];


import constants from "./src/helpers/constants";
import accountsRoutes from "./src/routes/accounts/reports/ageing/ageing_accounts.routes";
import authRoutes from "./src/routes/auth.routes";
import fileRoutes from "./src/routes/files.routes";
// import financeRoutes from "./src/routes/finance/finance.routes";
import hrRoutes from "./src/routes/hr.routes";
import logRoutes from "./src/routes/notification.routes";
import pfRoutes from "./src/routes/pf.routes";
import pfbtflowRoutes from "./src/routes/BT-FLOW.routes";
import secRoutes from "./src/routes/secuity.routes";
import editLangrouter from "./src/routes/user/user.routes";

import VendorRouter from "./src/routes/vendor.routes";
import wmsRoutes from "./src/routes/wms.routes";
import boldReportsRoutes from "./src/routes/boldreports.routes";
// import cfsRoutes from "./src/routes/SMS/sms.routes";
import pamsRoutes from "./src/routes/pams.routes";


import attendanceRoutes from "./src/routes/Attendance/attendance.routes";
// import { AttendanceEventScheduler } from "./src/services/Attendance/attendanceEventScheduler.service";
// import { FaceRecognitionService } from "./src/services/Attendance/face_recognition.service"; 
// import { AttendanceService } from "./src/services/Attendance/Attendance.service"; 

//----------------routes-------------

app.use("/api/files", fileRoutes);

app.use("/api/auth", authRoutes);

app.use("/api/reports", boldReportsRoutes);

app.use("/api/security", secRoutes);

app.use("/api/hr", hrRoutes);

app.use("/api/pf", pfRoutes);

app.use("/api/notification", logRoutes);

app.use("/api/vendor", VendorRouter);

app.use("/api/attendance", attendanceRoutes);

app.use("/api/pams/", pamsRoutes);

app.use("/api/wms", wmsRoutes);

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
  });
});

// Tenant Status Diagnostic Endpoint
app.get("/api/diagnostics/tenants", (req: Request, res: Response) => {
  const { TenantManager } = require("./src/database/TenantManager");
  const registeredTenants = TenantManager.getTenants();
  
  res.status(200).json({
    success: true,
    message: "Tenant Status",
    registered_tenants: registeredTenants,
    total_registered: registeredTenants.length,
    note: "Check server logs for connection attempts and failures",
    timestamp: new Date().toISOString(),
  });
});

// Database Status Endpoint
app.get("/api/diagnostics/database", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Database Status",
    connections: {
      central: "CUSTOMERS schema (Active)",
      tenants: "Check /api/diagnostics/tenants"
    },
    connection_string: process.env.ORACLE_CONNECTION_STRING,
    note: "Tenant databases may fail if unreachable - check server logs",
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3500;

async function startServer() {
  try {
    console.log("Starting server...");
    console.log("Initializing database connections...");
    await initializeAllConnections();
    console.log(" All database connections initialized");

    // try {
    //   const { startSchedulers } = require("./src/scheduler/startSchedulers");
    //   await startSchedulers();
    //   console.log("✅ Schedulers initialized");
    // } catch (err) {
    //   console.warn("⚠️ Schedulers failed to initialize (continuing):", err);
    // }
    
    // Start server
    console.log(`Listening on port ${PORT}...`);
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log("🔗 Health check: http://localhost:" + PORT + "/health");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('SIGINT received, exiting immediately');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, exiting immediately');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer().catch(err => {
  console.error("Uncaught error in startServer:", err);
  process.exit(1);
});
