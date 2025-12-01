// Add these at the very top of the file, before any imports
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

import cors from "cors";
import express, { Request, Response } from "express";
import { databaseConnection } from "./src/database/connection";
import "./src/utils/passport";

//import { AttendanceEventScheduler } from "./src/services/Attendance/attendanceEventScheduler.service";
//import { FaceRecognitionService } from "./src/services/Attendance/face_recognition.service"; 
// import { AttendanceService } from "./src/services/Attendance/Attendance.service"; 


const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



import constants from "./src/helpers/constants";
// import accountsRoutes from "./src/routes/accounts/reports/ageing/ageing_accounts.routes";
import authRoutes from "./src/routes/auth.routes";
import fileRoutes from "./src/routes/files.routes";
// import financeRoutes from "./src/routes/finance/finance.routes";
// import hrRoutes from "./src/routes/hr.routes";
import logRoutes from "./src/routes/notification.routes";
// import pfRoutes from "./src/routes/pf.routes";
// import pfbtflowRoutes from "./src/routes/BT-FLOW.routes";
import secRoutes from "./src/routes/secuity.routes";
import editLangrouter from "./src/routes/user/user.routes";
import { initializeAssociations } from "./src/models/Attendance/associations";
// import VendorRouter from "./src/routes/vendor.routes";
// import wmsRoutes from "./src/routes/wms.routes";
// import boldReportsRoutes from "./src/routes/boldreports.routes";
import attendanceRoutes from "./src/routes/Attendance/attendance.routes";
// import cfsRoutes from "./src/routes/SMS/sms.routes";


// async function initializeFaceRecognitionService() {
//   try {
//     console.log('🔄 Preloading Face Recognition Model...');
//     const startTime = Date.now();
    
//     await FaceRecognitionService.getInstance();
    
//     const loadTime = Date.now() - startTime;
//     console.log(`✅ Face Recognition Model loaded successfully in ${loadTime}ms`);
    
//     console.log('🔄 Warming up face recognition service...');
//     await FaceRecognitionService.warmUp();
//     console.log('✅ Face recognition service warmed up and ready');
    
//   } catch (error) {
//     console.error('❌ Failed to preload Face Recognition Model:', error);
    
//     console.log('⚠️  Face recognition will be lazy-loaded on first request');
//   }
// }

// 🚀 PRELOAD ATTENDANCE SERVICE CACHE
// async function initializeAttendanceService() {
//   try {
//     console.log('🔄 Preloading Attendance Service...');
    
//     await AttendanceService.initializeFaceService();

//     console.log('🔄 Preloading employee cache...');
  
//     console.log('✅ Attendance Service initialized successfully');
    
//   } catch (error) {
//     console.error('❌ Failed to preload Attendance Service:', error);
//   }
// }

//----------------routes-------------
// Route for handling file-related requests
app.use("/api/files", fileRoutes);
// Route for handling authentication-related requests
app.use("/api/auth", authRoutes);

// Route for handling Bold Reports-related requests
// app.use("/api/reports", boldReportsRoutes);

// Route for handling Warehouse Management System (WMS)-related requests
// app.use("/api/wms", wmsRoutes);
// // Route for handling Provident Fund (PF)-related requests
// app.use("/api/pf", pfRoutes);
// // Route for handling security-related requests
// app.use("/api/BT-WF-AL", pfbtflowRoutes);
// // Route for handling security-related requests
app.use("/api/security", secRoutes);
// // Route for handling Human Resources (HR)-related requests
// app.use("/api/hr", hrRoutes);
// // Route for handling finance-related requests
// app.use("/api/finance", financeRoutes);
// // Route for handling accounts-related requests
// app.use("/api/accounts", accountsRoutes);
// // Route for handling notification-related requests
app.use("/api/notification", logRoutes);
// // Route for handling SMS - related requests
// app.use("/api/sms", cfsRoutes);

// app.use("/api/vendor", VendorRouter);
// // Health check endpoint to verify server status
app.use("/api/attendance", attendanceRoutes);

// 🆕 ADD HEALTH CHECK FOR FACE RECOGNITION SERVICE
// app.get("/health/face-recognition", async (req: Request, res: Response) => {
//   try {
//     const faceService = await FaceRecognitionService.getInstance();
//     const isReady = faceService !== null;
    
//     res.status(constants.STATUS_CODES.OK).json({
//       status: "success",
//       faceRecognitionReady: isReady,
//       message: isReady ? "Face recognition service is ready" : "Face recognition service is not available"
//     });
//     return;
//   } catch (error) {
//     res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
//       status: "error",
//       faceRecognitionReady: false,
//       message: "Face recognition service failed to load"
//     });
//   }
// });

app.get("/health", (req: Request, res: Response) => {
  res.status(constants.STATUS_CODES.OK).send("Server is up and running.");
  return;
});

// Route for handling user-related requests
app.use("/api/user", editLangrouter);

const PORT = process.env.PORT || 3500;

// 🚀 INITIALIZE ALL SERVICES
// async function initializeAllServices() {
//   try {
//     console.log('🚀 Initializing all services...');
    
//     // 1. Initialize database associations first
//     console.log('🔄 Initializing database associations...');
//     initializeAssociations();
    
//     console.log('🔄 Establishing database connection...');
//     await databaseConnection();
    
//     try {
//       require("./src/utils/passport");
//       console.log("✅ Passport initialized after DB connection");
//     } catch (passportErr) {
//       console.error("❌ Failed to initialize passport after DB connection:", passportErr);
//       // continue startup; passport failures will be logged and can be retried on demand
//     }
    
//     // 3. Preload face recognition model (in parallel with other services)
//     console.log('🔄 Starting service preloading...');
//     await Promise.all([
//       initializeFaceRecognitionService(),
//       initializeAttendanceService()
//     ]);
    
//     // 4. Initialize scheduler
//     console.log('🔄 Initializing attendance scheduler...');
//     //AttendanceEventScheduler.initializeScheduler();
    
//     console.log('✅ All services initialized successfully');
    
//   } catch (error) {
//     console.error('❌ Failed to initialize services:', error);
//     throw error;
//   }
// }

// initializeAllServices()
//   .then(() => {
//     app.listen(PORT, () => {
//       console.log(`✅ Server is running on port ${PORT}`);
//       console.log(`🎯 Face Recognition: Preloaded and Ready`);
//       console.log(`⚡ Attendance System: Optimized for Speed`);
//     });
//   })
//   .catch((err) => {
//     console.log("Error initializing services:", err);
//     process.exit(1);
//   });