import { Request, Response } from "express";
import { SupportAssistantService } from "../services/supportAssistant.service";
import { SupportChatService } from "../services/supportChat.service";

type AuthedRequest = Request & {
  user?: any;
};

function roleFrom(req: Request) {
  return String(req.query.role || req.body?.role || "user").toLowerCase();
}

export const supportHeartbeat = async (req: AuthedRequest, res: Response) => {
  try {
    const data = await SupportChatService.heartbeat(req.user || {});
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Unable to update presence" });
  }
};

export const getSupportActiveUsers = async (_req: AuthedRequest, res: Response) => {
  try {
    const data = await SupportChatService.getActiveUsers();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Unable to load active users" });
  }
};

export const getSupportDevelopers = async (_req: AuthedRequest, res: Response) => {
  try {
    const data = await SupportChatService.getDevelopers();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Unable to load developers" });
  }
};

export const saveSupportDeveloper = async (req: AuthedRequest, res: Response) => {
  try {
    const data = await SupportChatService.upsertDeveloper(req.body || {}, req.user || {});
    res.json({ success: true, data, message: "Support developer saved" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to save developer" });
  }
};

export const getSupportTickets = async (req: AuthedRequest, res: Response) => {
  try {
    const data = await SupportChatService.getTickets(req.user || {}, roleFrom(req));
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Unable to load tickets" });
  }
};

export const getSupportMessages = async (req: AuthedRequest, res: Response) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const data = await SupportChatService.getMessages(ticketId, req.user || {}, roleFrom(req));
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Unable to load messages" });
  }
};

export const createSupportTicket = async (req: AuthedRequest, res: Response) => {
  try {
    const data = await SupportChatService.createTicket(req.body || {}, req.user || {});
    res.status(201).json({ success: true, data, message: "Support ticket created" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to create ticket" });
  }
};

export const addSupportMessage = async (req: AuthedRequest, res: Response) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const data = await SupportChatService.addMessage(ticketId, req.body || {}, req.user || {}, roleFrom(req));
    res.status(201).json({ success: true, data, message: "Message sent" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to send message" });
  }
};

export const updateSupportTicket = async (req: AuthedRequest, res: Response) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const data = await SupportChatService.updateTicket(ticketId, req.body || {}, req.user || {}, roleFrom(req));
    res.json({ success: true, data, message: "Ticket updated" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to update ticket" });
  }
};

export const assignSupportDeveloper = async (req: AuthedRequest, res: Response) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const data = await SupportChatService.assignDeveloper(ticketId, req.body || {}, req.user || {}, roleFrom(req));
    res.json({ success: true, data, message: "Developer assigned" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to assign developer" });
  }
};

export const getDeveloperSupportTickets = async (req: AuthedRequest, res: Response) => {
  try {
    const data = await SupportChatService.getDeveloperTickets(req.user || {});
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Unable to load assigned tickets" });
  }
};

export const updateDeveloperSupportStatus = async (req: AuthedRequest, res: Response) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const data = await SupportChatService.updateDeveloperStatus(ticketId, req.body || {}, req.user || {});
    res.json({ success: true, data, message: "Developer status updated" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to update developer status" });
  }
};

export const markSupportRead = async (req: AuthedRequest, res: Response) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const data = await SupportChatService.markRead(ticketId, req.user || {});
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to mark messages read" });
  }
};

export const deleteSupportMessage = async (req: AuthedRequest, res: Response) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const messageId = Number(req.params.messageId);
    const data = await SupportChatService.deleteMessage(ticketId, messageId, req.user || {}, roleFrom(req));
    res.json({ success: true, data, message: "Message deleted" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to delete message" });
  }
};

export const getSupportAssistantSuggestion = async (req: AuthedRequest, res: Response) => {
  try {
    const data = SupportAssistantService.suggest(req.body || {});
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || "Unable to prepare support suggestion" });
  }
};
