import { Router } from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../../middleware/tenantContext.middleware";
import { tenantMiddleware } from "../../middleware/tenant.middleware";
import {
  getDrivers,
  saveDriver,
  deleteDriver,
  getVehicles,
  saveVehicle,
  deleteVehicle,
  getVehicleTypes,
  getRequests,
  saveRequest,
  deleteRequest,
  getTripTickets,
  saveTripTicket,
  confirmTripTicket,
  cancelTripTicket,
  getFuelFilling,
  saveFuelFilling,
  deleteFuelFilling,
  getMaintenance,
  saveMaintenance,
  deleteMaintenance,
  getAccidentsFines,
  saveAccidentFine,
  deleteAccidentFine,
  getTMSDashboardStats,
  getTMSReport
} from "../../controllers/tms/tms.controller";

const router = Router();

// Middleware chain
const authChain = [
  passport.authenticate("jwt", { session: false }),
  tenantContextMiddleware,
  tenantMiddleware
];

// Dashboard
router.get("/dashboard/stats", ...authChain, getTMSDashboardStats);

// Drivers
router.get("/drivers", ...authChain, getDrivers);
router.post("/drivers", ...authChain, saveDriver);
router.delete("/drivers/:emp_id", ...authChain, deleteDriver);

// Vehicles
router.get("/vehicles", ...authChain, getVehicles);
router.post("/vehicles", ...authChain, saveVehicle);
router.delete("/vehicles/:vehicle_no", ...authChain, deleteVehicle);
router.get("/vehicle-types", ...authChain, getVehicleTypes);

// Transport Requests
router.get("/requests", ...authChain, getRequests);
router.post("/requests", ...authChain, saveRequest);
router.delete("/requests/:doc_no", ...authChain, deleteRequest);

// Trip Tickets
router.get("/trip-tickets", ...authChain, getTripTickets);
router.post("/trip-tickets", ...authChain, saveTripTicket);
router.put("/trip-tickets/:doc_no/confirm", ...authChain, confirmTripTicket);
router.put("/trip-tickets/:doc_no/cancel", ...authChain, cancelTripTicket);

// Fuel Filling
router.get("/fuel-filling", ...authChain, getFuelFilling);
router.post("/fuel-filling", ...authChain, saveFuelFilling);
router.delete("/fuel-filling/:doc_no", ...authChain, deleteFuelFilling);

// Maintenance
router.get("/maintenance", ...authChain, getMaintenance);
router.post("/maintenance", ...authChain, saveMaintenance);
router.delete("/maintenance/:doc_no", ...authChain, deleteMaintenance);

// Accidents & Fines
router.get("/accidents-fines", ...authChain, getAccidentsFines);
router.post("/accidents-fines", ...authChain, saveAccidentFine);
router.delete("/accidents-fines/:doc_no", ...authChain, deleteAccidentFine);

// Reports
router.get("/reports/:reportType", ...authChain, getTMSReport);

export default router;
