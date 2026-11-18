import cors from "cors";
import express, { Request, Response } from "express";
import { initializeAllConnections, TypeORMService } from "./src/database/connection";
import startSchedulers from "./src/scheduler/startSchedulers";
import { tenantContextMiddleware } from "./src/middleware/tenantContext.middleware";
import passport from "passport";

const app = express();
console.log("index.ts loaded");

app.use(cors());

app.use(express.json({ limit: '50mb' }));

app.use(express.urlencoded({limit: '50mb', extended: true }));

// passport strategies will be initialized after TypeORM is ready (see startServer)
export const withTenantContext = () => [
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
];

import freight from "./src/routes/Freight/freight.routes"
import purchaseSalesRoutes from "./src/routes/purchase_sales/purchase_sales.routes";
import constants from "./src/helpers/constants";
import accountsRoutes from "./src/routes/accounts/reports/ageing/ageing_accounts.routes";
import authRoutes from "./src/routes/auth.routes";
import fileRoutes from "./src/routes/files.routes";
import financeRoutes from "./src/routes/finance/finance.routes";
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

import almsRoutes from "./src/routes/alms.routes";
import mmsRoutes from "./src/routes/mms_routes";
import gmHrRoutes from "./src/routes/HR/gmHr.routes";
//----------------routes-------------
console.log("R1");
app.use("/api/files", fileRoutes);
console.log("R2");
app.use("/api/auth", authRoutes);
console.log("R3");
app.use("/api/reports", boldReportsRoutes);
console.log("R4");
app.use("/api/security", secRoutes);
console.log("R5");
app.use("/api/hr", hrRoutes);
console.log("R6");
app.use("/api/gm/hr", gmHrRoutes);
console.log("R7");
app.use("/api/ems", hrRoutes);
console.log("R8");
app.use("/api/pf", pfRoutes);
console.log("R9");
// Mount BT-FLOW routes
app.use("/api/bt-flow", pfbtflowRoutes);
console.log("R10");
app.use("/api/notification", logRoutes);
console.log("R11");
app.use("/api/vendor", VendorRouter);
console.log("R12");
// app.use("/api/finance",financeRoutes );

// app.use("/api/attendance", attendanceRoutes);

app.use("/api/pams/", pamsRoutes);
console.log("R13");
app.use("/api/wms", wmsRoutes);
console.log("R14");
app.use("/api/finance", financeRoutes);
console.log("R15");
app.use("/api/freight", freight);
console.log("R16");
app.use("/api/purchase-sales", purchaseSalesRoutes);
console.log("R17");
app.use("/api/alms/", almsRoutes);
console.log("R18");
app.use("/api/user", editLangrouter);
console.log("R19");
app.use("/api/mms", mmsRoutes); 
console.log("R20"); 

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
  });
});

// Tenant Status Diagnostic Endpoint
app.get("/api/diagnostics/tenants", async (req: Request, res: Response) => {
  try {
    const { TenantManager } = require("./src/database/TenantManager");
    const registeredTenants = typeof TenantManager.listActiveTenants === "function"
      ? await TenantManager.listActiveTenants()
      : [];
    
    res.status(200).json({
      success: true,
      message: "Tenant Status",
      registered_tenants: registeredTenants,
      total_registered: registeredTenants.length,
      note: "Check server logs for connection attempts and failures",
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(200).json({
      success: false,
      message: "Failed to retrieve active tenants",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
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
    // await AttendanceEventScheduler.initializeScheduler();
    console.log(" All database connections initialized");

    try {
      console.log("Initializing TypeORM service...");
      await TypeORMService.initialize();
      console.log("TypeORM initialized successfully");
    } catch (typeormErr) {
      console.warn("TypeORM service initialization warning (continuing):", typeormErr);
    }

    try {
      console.log("Initializing passport strategies...");
      require("./src/utils/passport");
      app.use(passport.initialize());
      console.log("Passport initialized");
    } catch (err) {
      console.error("Failed to initialize passport strategies:", err);
      throw err;
    }
    try {
      // Start background schedulers (email sender, attendance, etc.)
      await startSchedulers();
    } catch (schedErr) {
      console.error("Failed to start schedulers:", schedErr);
      // Non-fatal: continue running server even if schedulers fail
    }
    console.log(`Listening on port ${PORT}...`);
    app.listen(Number(PORT), process.env.HOST || '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      console.log("Health check: http://localhost:" + PORT + "/health");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log("DEBUG: Calling startServer now...");
// Start the server
startServer().catch(err => {
  console.error("Uncaught error in startServer:", err);
  process.exit(1);
});
