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

//----------------routes-------------

app.use("/api/files", fileRoutes);

app.use("/api/auth", authRoutes);

app.use("/api/reports", boldReportsRoutes);

app.use("/api/security", secRoutes);

app.use("/api/hr", hrRoutes);

app.use("/api/notification", logRoutes);

app.use("/api/vendor", VendorRouter);

app.use("/api/attendance", attendanceRoutes);

app.get("/health", (req: Request, res: Response) => {
  res.status(constants.STATUS_CODES.OK).send("Server is up and running.");
  return;
});

const PORT = process.env.PORT || 3500;

async function startServerWithTypeORM() {
  try {
    console.log("Initializing TypeORM and Oracle connections...");

    await initializeAllConnections();

    console.log("All database connections established");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`TypeORM is ready for model conversion`);
    });
  } catch (err) {
    console.log("Error in database connection:", err);
    process.exit(1);
  }
}
startServerWithTypeORM();
