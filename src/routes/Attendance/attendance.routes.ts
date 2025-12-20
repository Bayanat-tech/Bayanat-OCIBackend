// attendance.routes.ts
import express from "express";
import multer from "multer";
import passport from "passport";
//import { AttendanceController } from "../../controllers/Attendance/attendance.controller";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Lazy load controllers
const getControllers = async () => {
  // const { AttendanceController } = await import(
  //   "../../controllers/Attendance/attendance.controller"
  // );
  const { EmployeeController } = await import(
    "../../controllers/Attendance/Employee.controller"
  );
  // const { DashboardController } = await import(
  //   "../../controllers/Attendance/dashboard.controller"
  // );
  const { checkUserAuthorization } = await import(
    "../../middleware/checkUserAthorization"
  );
  const { EmployeeService } = await import("../../services/Attendance/employee.service");

  return {
    //AttendanceController,
    EmployeeController,
    //DashboardController,
    checkUserAuthorization,
    EmployeeService,
  };
};
console;
// Dashboard routes
// router.get(
//   "/dashboard/daily",
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { DashboardController } = await getControllers();
//     return DashboardController.getDailySummary(req, res);
//   }
// );

// router.get(
//   "/dashboard/departments",
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { DashboardController } = await getControllers();
//     return DashboardController.getDepartmentStats(req, res);
//   }
// );

// router.get(
//   "/dashboard/monthly",
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { DashboardController } = await getControllers();
//     return DashboardController.getMonthlyStats(req, res);
//   }
// );

// router.get(
//   "/dashboard/employee/:employee_id/history",
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { DashboardController } = await getControllers();
//     return DashboardController.getEmployeeHistory(req, res);
//   }
// );

// router.get(
//   "/dashboard/trends/late",
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { DashboardController } = await getControllers();
//     return DashboardController.getLateArrivalTrends(req, res);
//   }
// );
/*--dashboard routes end--*/

// Public route
// router.post(
//   "/mark",
//   upload.single("file"),
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { AttendanceController } = await getControllers();
//     return AttendanceController.markAttendance(req, res);
//   }
// );

// router.post('/confirm', 
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   }, 
//   async (req, res) => {
//     const { AttendanceController } = await getControllers();
//     return AttendanceController.confirmAttendance(req, res);
//   }
// );

// router.post('/cancel',
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { AttendanceController } = await getControllers();
//     return AttendanceController.cancelAttendance(req, res);
//   }
// );

// router.get('/proxy-logs', 
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { AttendanceController } = await getControllers();
//     return AttendanceController.getProxyLogs(req, res);
//   }
// );

// Protected routes
// router.get(
//   "/report",
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   async (req, res) => {
//     const { AttendanceController } = await getControllers();
//     return AttendanceController.getAttendanceReport(req, res);
//   }
// );

// router.post('/stop-auto-confirm',
//   passport.authenticate("jwt", { session: false }),
//     async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },async (req, res) => {
//     const { AttendanceController } = await getControllers(); return AttendanceController.stopAutoConfirm(req, res);
//   }
// );

// router.post(
//   "/employees",
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   upload.array("images", 5),
//   async (req, res) => {
//     const { EmployeeController } = await getControllers();
//     return EmployeeController.registerEmployee(req, res);
//   }
// );

router.get(
  "/employees",
  passport.authenticate("jwt", { session: false }),
  async (req, res, next) => {
    const { checkUserAuthorization } = await getControllers();
    return checkUserAuthorization(req, res, next);
  },
  async (req, res) => {
    const { EmployeeController } = await getControllers();
    //return EmployeeController.getEmployees(req, res);
    return EmployeeController.getEmployees(req, res);
  }
);

// router.put(
//   "/employees/:employee_id",
//   passport.authenticate("jwt", { session: false }),
//   async (req, res, next) => {
//     const { checkUserAuthorization } = await getControllers();
//     return checkUserAuthorization(req, res, next);
//   },
//   upload.array("images", 5),
//   async (req, res, data) => {
//     const { EmployeeController } = await getControllers();
//     return EmployeeController.modifyEmployee(req, res, data);
//   }
// );

// Add route for employee info lookup
router.get(
  "/employeeinfo",
  passport.authenticate("jwt", { session: false }),
  async (req, res, next) => {
    const { checkUserAuthorization } = await getControllers();
    return checkUserAuthorization(req, res, next);
  },
  async (req, res) => {
    const { EmployeeController } = await getControllers();
    return EmployeeController.getEmployeeInfo(req, res);
  }
);

export default router;
