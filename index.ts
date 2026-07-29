import cors from "cors";
import express, { Request, Response } from "express";
import http from "http";
import { initializeAllConnections, TypeORMService } from "./src/database/connection";
//import startSchedulers from "./src/scheduler/startSchedulers";
import { tenantContextMiddleware } from "./src/middleware/tenantContext.middleware";
import passport from "passport";
import { initSupportRealtime } from "./src/services/supportRealtime.service";

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
import supportRoutes from "./src/routes/support.routes";

import almsRoutes from "./src/routes/alms.routes";
import mmsRoutes from "./src/routes/mms_routes";

//----------------routes-------------

app.use("/api/files", fileRoutes);

app.use("/api/auth", authRoutes);

app.use("/api/reports", boldReportsRoutes);

app.use("/api/security", secRoutes);

app.use("/api/hr", hrRoutes);
app.use("/api/ems", hrRoutes);

app.use("/api/pf", pfRoutes);

// Mount BT-FLOW routes
app.use("/api/bt-flow", pfbtflowRoutes);

app.use("/api/notification", logRoutes);

app.use("/api/vendor", VendorRouter);

// app.use("/api/finance",financeRoutes );

// app.use("/api/attendance", attendanceRoutes);

app.use("/api/pams/", pamsRoutes);

app.use("/api/wms", wmsRoutes);

app.use("/api/finance", financeRoutes);

app.use("/api/freight", freight);

app.use("/api/purchase-sales", purchaseSalesRoutes);

app.use("/api/alms/", almsRoutes);

app.use("/api/wms", wmsRoutes);

app.use("/api/user", editLangrouter);

app.use("/api/support", supportRoutes);

app.use("/api/mms", mmsRoutes); 

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
const server = http.createServer(app);

async function startServer() {
  try {
    console.log("Starting server...");
    console.log("Initializing database connections...");
    await initializeAllConnections();
    // await AttendanceEventScheduler.initializeScheduler();
    console.log(" All database connections initialized");

    console.log("Initializing TypeORM service...");
    await TypeORMService.initialize();
    console.log("TypeORM initialized successfully");

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
      //await startSchedulers();
    } catch (schedErr) {
      console.error("Failed to start schedulers:", schedErr);
      // Non-fatal: continue running server even if schedulers fail
    }
    console.log(`Listening on port ${PORT}...`);
    initSupportRealtime(server);
    server.listen(PORT, () => {
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

// Start the server
startServer().catch(err => {
  console.error("Uncaught error in startServer:", err);
  process.exit(1);
});
