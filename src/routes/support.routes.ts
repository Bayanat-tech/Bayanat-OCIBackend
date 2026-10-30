import express from 'express';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import * as C from '../controllers/supportChat.controller';

const router = express.Router();
// Central support module router
router.use(passport.authenticate('jwt', { session: false }));
const writeLimit = rateLimit({
    windowMs: 60000,
    limit: 60,
    keyGenerator: (req: any) => `${req.user?.tenantId}:${req.user?.loginid}`,
    validate: { ip: false },
    message: { success: false, message: 'Too many support updates. Please wait a minute.' }
});

router.get('/context', C.getSupportContext);
router.post('/heartbeat', C.supportHeartbeat);
router.get('/active-users', C.getSupportActiveUsers);
router.post('/assist/suggest', C.getSupportAssistantSuggestion);
router.get('/developers', C.getSupportDevelopers);
router.post('/developers', writeLimit, C.saveSupportDeveloper);
router.get('/developer/tickets', C.getDeveloperSupportTickets);
router.get('/tickets', C.getSupportTickets);
router.post('/tickets', writeLimit, C.createSupportTicket);
router.get('/tickets/:ticketId/messages', C.getSupportMessages);
router.post('/tickets/:ticketId/messages', writeLimit, C.addSupportMessage);
router.delete('/tickets/:ticketId/messages/:messageId', writeLimit, C.deleteSupportMessage);
router.post('/tickets/:ticketId/assign-developer', writeLimit, C.assignSupportDeveloper);
router.patch('/tickets/:ticketId/developer-status', writeLimit, C.updateDeveloperSupportStatus);
router.patch('/tickets/:ticketId', writeLimit, C.updateSupportTicket);
router.post('/tickets/:ticketId/read', C.markSupportRead);
router.get('/tickets/:ticketId/events', C.getSupportEvents);
router.get('/tickets/:ticketId/attachments/:attachmentId', C.getSupportAttachment);
router.get('/settings', C.getSupportSettings);
router.post('/settings/contacts', writeLimit, C.saveSupportContact);
router.get('/live-chat', C.getLiveChatMessages);
router.post('/live-chat', writeLimit, C.sendLiveChatMessage);

export default router;
