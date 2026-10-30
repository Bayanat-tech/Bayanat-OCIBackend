// src/controllers/support/readReceipt.controller.ts
import { Request, Response } from 'express';

/**
 * POST /api/support/tickets/:id/read
 * Marks the current user as having read the ticket (creates a row in SUPPORT_READ_RECEIPT).
 */
export class ReadReceiptController {
  async markRead(req: Request, res: Response) {
    // Placeholder – implementation will insert a row with ticketId and req.user.loginId
    res.status(501).json({ message: 'Not implemented' });
  }
}

