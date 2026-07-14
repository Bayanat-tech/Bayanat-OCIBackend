import express from "express";
import passport from "passport";
import { tenantContextMiddleware } from "../middleware/tenantContext.middleware";
import {
  addSupportMessage,
  assignSupportDeveloper,
  createSupportTicket,
  deleteSupportMessage,
  getSupportAssistantSuggestion,
  getDeveloperSupportTickets,
  getSupportActiveUsers,
  getSupportDevelopers,
  getSupportMessages,
  getSupportTickets,
  markSupportRead,
  saveSupportDeveloper,
  updateDeveloperSupportStatus,
  supportHeartbeat,
  updateSupportTicket,
} from "../controllers/supportChat.controller";

const router = express.Router();

router.use(passport.authenticate("jwt", { session: false }), tenantContextMiddleware);

router.post("/heartbeat", supportHeartbeat);
router.post("/assist/suggest", getSupportAssistantSuggestion);
router.get("/active-users", getSupportActiveUsers);
router.get("/developers", getSupportDevelopers);
router.post("/developers", saveSupportDeveloper);
router.get("/developer/tickets", getDeveloperSupportTickets);
router.get("/tickets", getSupportTickets);
router.post("/tickets", createSupportTicket);
router.get("/tickets/:ticketId/messages", getSupportMessages);
router.post("/tickets/:ticketId/messages", addSupportMessage);
router.delete("/tickets/:ticketId/messages/:messageId", deleteSupportMessage);
router.post("/tickets/:ticketId/assign-developer", assignSupportDeveloper);
router.patch("/tickets/:ticketId/developer-status", updateDeveloperSupportStatus);
router.patch("/tickets/:ticketId", updateSupportTicket);
router.post("/tickets/:ticketId/read", markSupportRead);

export default router;
