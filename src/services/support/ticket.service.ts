// src/services/support/ticket.service.ts
import { getConnection } from 'typeorm';

export interface CreateTicketDto {
  subject: string;
  description: string;
  tenantId: string;
  companyCode: string;
  requesterLoginId: string;
  attachments?: Array<{ name: string; mime: string; data: Buffer }>;
}

/**
 * Service responsible for creating support tickets atomically.
 * It inserts ticket, initial message, event log, optional attachments
 * and queues an email in SUPPORT_EMAIL_OUTBOX.
 */
export class TicketService {
  async createTicket(dto: CreateTicketDto): Promise<number> {
    const connection = getConnection();
    return await connection.transaction(async (manager) => {
      // 1️⃣ Insert ticket
      const ticketResult = await manager.query(
        `INSERT INTO SUPPORT_TICKET
          (SUBJECT, STATUS, TENANT_ID, COMPANY_CODE, REQUESTER_LOGINID, CREATED_AT)
         VALUES (:subject, 'OPEN', :tenantId, :companyCode, :requesterLoginId, SYSTIMESTAMP)
         RETURNING ID INTO :ticketId`,
        {
          subject: dto.subject,
          tenantId: dto.tenantId,
          companyCode: dto.companyCode,
          requesterLoginId: dto.requesterLoginId,
          ticketId: { dir: 2, type: 4, val: null }, // OUT param for Oracle
        }
      );
      const ticketId: number = (ticketResult.outBinds?.ticketId?.[0] as number) ?? 0;

      // 2️⃣ First message (description)
      await manager.query(
        `INSERT INTO SUPPORT_MESSAGE
            (TICKET_ID, MESSAGE_TEXT, CREATED_BY, CREATED_AT)
         VALUES (:ticketId, :msg, :createdBy, SYSTIMESTAMP)`,
        { ticketId, msg: dto.description, createdBy: dto.requesterLoginId }
      );

      // 3️⃣ Event log
      await manager.query(
        `INSERT INTO SUPPORT_EVENT
          (TICKET_ID, EVENT_TYPE, EVENT_DESC, EVENT_TIME)
         VALUES (:ticketId, 'CREATE', 'Ticket created via UI help drawer', SYSTIMESTAMP)`,
        { ticketId }
      );

      // 4️⃣ Optional attachments
      if (dto.attachments && dto.attachments.length) {
        for (const att of dto.attachments) {
          await manager.query(
            `INSERT INTO SUPPORT_ATTACHMENT
                (TICKET_ID, FILE_NAME, MIME_TYPE, BLOB_DATA, CREATED_AT)
             VALUES (:ticketId, :name, :mime, :blob, SYSTIMESTAMP)`,
            { ticketId, name: att.name, mime: att.mime, blob: att.data }
          );
        }
      }

      // 5️⃣ Queue email outbox
      await manager.query(
        `INSERT INTO SUPPORT_EMAIL_OUTBOX
            (TICKET_ID, RECIPIENT_EMAIL, SUBJECT, BODY, STATUS, CREATED_AT)
         VALUES (:ticketId, :recipient, :mailSubject, :mailBody, 'PENDING', SYSTIMESTAMP)`,
        {
          ticketId,
          recipient: process.env.EMAIL_USER,
          mailSubject: `[Support] Ticket #${ticketId} – ${dto.subject}`,
          mailBody: `A new support ticket has been created.\n\nSubject: ${dto.subject}\nDescription: ${dto.description}\nTenant: ${dto.tenantId}\nCompany: ${dto.companyCode}\nRequester: ${dto.requesterLoginId}`,
        }
      );

      return ticketId;
    });
  }
}

