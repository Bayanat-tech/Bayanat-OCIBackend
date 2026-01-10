import cors from "cors";
import express, { Request, Response } from "express";
import { initializeAllConnections } from "./src/database/connection";
import "./src/utils/passport";

const app = express();

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

//routes

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
import cfsRoutes from "./src/routes/SMS/sms.routes";

import attendanceRoutes from "./src/routes/Attendance/attendance.routes";
import { AttendanceEventScheduler } from "./src/services/Attendance/attendanceEventScheduler.service";
import { FaceRecognitionService } from "./src/services/Attendance/face_recognition.service"; 
import { AttendanceService } from "./src/services/Attendance/Attendance.service"; 

//----------------routes-------------

app.use("/api/files", fileRoutes);

app.use("/api/auth", authRoutes);

app.use("/api/reports", boldReportsRoutes);

app.use("/api/security", secRoutes);

app.use("/api/hr", hrRoutes);

app.use("/api/pf",pfRoutes);

app.use("/api/notification", logRoutes);

app.use("/api/vendor", VendorRouter);

app.use("/api/attendance", attendanceRoutes);
app.use("/api/wms", wmsRoutes);

app.get("/health", (req: Request, res: Response) => {
  res.status(constants.STATUS_CODES.OK).send("Server is up and running.");
  return;
});

const PORT = process.env.PORT || 3500;

async function startServerWithTypeORM() {
  try {
    console.log("Initializing TypeORM and Oracle connections...");

    const connectionPromise = initializeAllConnections();
    
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Database connection timeout (30s)")), 30000)
    );

    await Promise.race([connectionPromise, timeoutPromise]);
    await initializeAllConnections();
    await AttendanceEventScheduler.initializeScheduler();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`TypeORM is ready for model conversion`);
    });
  
  } catch (err) {
    console.error("Error in database connection:", err);
    console.error("Full error:", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServerWithTypeORM();
