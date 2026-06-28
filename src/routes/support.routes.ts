import express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import {
  addSupportMessage,
  createSupportTicket,
  getSupportActiveUsers,
  getSupportDirectory,
  getSupportMessages,
  getSupportTickets,
  markSupportRead,
  supportHeartbeat,
  updateSupportTicket,
} from "../controllers/supportChat.controller";

const router = express.Router();

router.use(passport.authenticate("jwt", { session: false }), tenantContextMiddleware);

router.post("/heartbeat", supportHeartbeat);
router.get("/active-users", getSupportActiveUsers);
router.get("/directory", getSupportDirectory);
router.get("/tickets", getSupportTickets);
router.post("/tickets", createSupportTicket);
router.get("/tickets/:ticketId/messages", getSupportMessages);
router.post("/tickets/:ticketId/messages", addSupportMessage);
router.patch("/tickets/:ticketId", updateSupportTicket);
router.post("/tickets/:ticketId/read", markSupportRead);

export default router;
