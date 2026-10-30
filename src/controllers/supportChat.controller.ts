import { Request, Response } from 'express';
import { SupportChatService as S } from '../services/supportChat.service';
import { SupportAssistantService } from '../services/supportAssistant.service';
import { supportError } from '../services/supportDb';

type Req = Request & {
    user?: any;
};

export const action = (fn: (req: Req) => Promise<any> | any, created = false) => async (req: Req, res: Response) => {
    try {
        res.status(created ? 201 : 200).json({ success: true, data: await fn(req) });
    }
    catch (e: any) {
        const status = e.status || 500;
        if (status === 500)
            console.error('Support operation failed', e);
        res.status(status).json({ success: false, message: status === 500 ? 'Support is temporarily unavailable. Please retry.' : e.message });
    }
};

const id = (r: Req) => {
    const n = Number(r.params.ticketId);
    if (!Number.isSafeInteger(n) || n <= 0)
        supportError('Invalid ticket number');
    return n;
};

export const supportHeartbeat = action(r => S.heartbeat(r.user));
export const getSupportContext = action(r => S.context(r.user));
export const getSupportActiveUsers = action(r => S.getActiveUsers(r.user));
export const getSupportTickets = action(r => S.getTickets(r.user, String(r.query.role || 'user')));
export const getSupportMessages = action(r => S.getMessages(id(r), r.user));
export const createSupportTicket = action(r => S.createTicket(r.body, r.user), true);
export const addSupportMessage = action(r => S.addMessage(id(r), r.body, r.user), true);
export const updateSupportTicket = action(r => S.updateTicket(id(r), r.body, r.user));
export const markSupportRead = action(r => S.markRead(id(r), r.user, r.body));
export const deleteSupportMessage = action(r => S.deleteMessage(id(r), Number(r.params.messageId), r.user));
export const getSupportDevelopers = action(r => S.getDevelopers(r.user));
export const getCandidateDevelopers = action(r => S.getCandidateDevelopers(r.user));
export const saveSupportDeveloper = action(r => S.upsertDeveloper(r.body, r.user));
export const assignSupportDeveloper = action(r => S.assignDeveloper(id(r), r.body, r.user));
export const sendSupportReminder = action(r => S.sendReminder(id(r), r.user));
export const getDeveloperSupportTickets = action(r => S.getDeveloperTickets(r.user));
export const updateDeveloperSupportStatus = action(r => S.updateDeveloperStatus(id(r), r.body, r.user));
export const getSupportAssistantSuggestion = action(r => SupportAssistantService.suggest(r.body));
export const getSupportEvents = action(r => S.events(id(r), r.user));
export const getSupportSettings = action(r => S.settings(r.user));
export const saveSupportContact = action(r => S.saveContact(r.body, r.user));
export const getLiveChatMessages = action(r => S.getLiveChat(String(r.query.sessionKey || 'default'), r.user));
export const sendLiveChatMessage = action(r => S.sendLiveChat(String(r.body.sessionKey || 'default'), r.body.message, r.body.pageUrl, r.user), true);

export const getSupportAttachment = async (r: Req, res: Response) => {
    try {
        const a = await S.attachment(id(r), Number(r.params.attachmentId), r.user);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', a.type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.name || 'Attachment')}`);
        res.send(a.buffer);
    }
    catch (e: any) {
        res.status(e.status || 500).json({ success: false, message: e.status ? e.message : 'Unable to load attachment' });
    }
};
