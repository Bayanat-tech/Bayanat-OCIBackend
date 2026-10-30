import http from 'http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import constants from '../helpers/constants';
import { identity, query, supportRole, withSupportDb } from './supportDb';
import { ticketAccess } from './supportAccess';
let ioServer: Server | undefined;
const connected = new Map<string, {
    user: any;
    count: number;
}>();
const room = (u: any) => { const i = identity(u); return `support:user:${i.tenantId}:${i.companyCode}:${i.loginid}`; };
export function initSupportRealtime(server: http.Server) {
    ioServer = new Server(server, { cors: { origin: process.env.SUPPORT_CORS_ORIGINS?.split(',') || true }, maxHttpBufferSize: 65536 });
    ioServer.use(async (socket, next) => {
        try {
            const token = String(socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '') || '');
            if (!token)
                throw Error('Authentication required');
            const u: any = jwt.verify(token, constants.AUTHENTICATION.APP_SECRET || process.env.APP_SECRET || 'BAYANAT', { algorithms: ['HS256'] });
            identity(u);
            socket.data.user = u;
            socket.data.role = await withSupportDb(c => supportRole(c, u));
            next();
        }
        catch {
            next(Error('Authentication required'));
        }
    });
    ioServer.on('connection', socket => {
        const u = socket.data.user, key = room(u);
        socket.join(key);
        if (socket.data.role === 'admin')
            socket.join('support:admins');
        connected.set(key, { user: u, count: (connected.get(key)?.count || 0) + 1 });
        socket.emit('support:ready', { role: socket.data.role, loginid: u.loginid });
        // Token expiry applies to long-lived connections, too.
        const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(2147483647, (Number(u.exp) * 1000) - Date.now())));
        let lastTyping = 0;
        socket.on('support:typing', async (payload: any) => {
            if (Date.now() - lastTyping < 500)
                return;
            lastTyping = Date.now();
            try {
                const ticketId = Number(payload?.ticketId);
                const a = await withSupportDb(c => ticketAccess(c, ticketId, u));
                await emitToTicket(a.ticket, 'support:typing', { ticketId, loginid: u.loginid, username: u.username || u.loginid, typing: Boolean(payload.typing) }, socket.id);
            }
            catch { /* Unauthorized ticket IDs are never broadcast. */ }
        });
        socket.on('disconnect', () => { clearTimeout(expiry); const n = (connected.get(key)?.count || 1) - 1; if (n <= 0)
            connected.delete(key);
        else
            connected.set(key, { user: u, count: n }); emitSupportPresenceChanged(); });
        emitSupportPresenceChanged();
    });
    return ioServer;
}
async function emitToTicket(t: any, event: string, payload: any, exclude?: string) {
    if (!ioServer)
        return;
    for (const socket of ioServer.sockets.sockets.values()) {
        if (socket.rooms.has('support:admins') && await withSupportDb(c => supportRole(c, socket.data.user)) !== 'admin')
            socket.leave('support:admins');
    }
    const rooms = ['support:admins', room({ loginid: t.REQUESTER_LOGINID, tenantId: t.TENANT_ID, company_code: t.COMPANY_CODE })];
    if (t.DEVELOPER_LOGINID) {
        const members = await withSupportDb(c => query(c, "SELECT UPPER(s.LOGINID) LOGINID,x.TENANT_ID,s.COMPANY_CODE FROM CUSTOMERS.SEC_LOGINTEST s JOIN CUSTOMERS.USER_TENANT_MAPPING x ON UPPER(x.LOGINID)=UPPER(s.LOGINID) AND x.IS_DEFAULT='Y' WHERE UPPER(s.LOGINID)=:id", { id: t.DEVELOPER_LOGINID }));
        for (const m of members) {
            const user={loginid:m.LOGINID,tenantId:m.TENANT_ID,company_code:m.COMPANY_CODE};
            if(await withSupportDb(c=>supportRole(c,user))!=='user') rooms.push(room(user));
        }
    }
    let op = ioServer.to(rooms);
    if (exclude)
        op = op.except(exclude);
    op.emit(event, payload);
}
export async function emitSupportTicketChanged(ticket: {
    ticketId: number;
    actorLoginid?: string;
}) {
    if (!ioServer)
        return;
    try {
        const [t] = await withSupportDb(c => query(c, 'SELECT * FROM CUSTOMERS.SUPPORT_TICKET WHERE TICKET_ID=:id', { id: ticket.ticketId }));
        if (t)
            await emitToTicket(t, 'support:tickets-changed', ticket);
    }
    catch (e) {
        console.error('Support realtime notification failed');
    }
}
export function emitSupportPresenceChanged() { ioServer?.to('support:admins').emit('support:presence-changed'); }
export function getConnectedSupportUsers() { return [...connected.values()].map(({ user: u }) => ({ LOGINID: u.loginid, TENANT_ID: u.tenantId, COMPANY_CODE: u.company_code, USERNAME: u.username, IS_ONLINE: 'Y' })); }
