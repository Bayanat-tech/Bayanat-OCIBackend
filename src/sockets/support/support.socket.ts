// src/sockets/support/support.socket.ts
import { Server, Socket } from 'socket.io';

/**
 * Initialise the Support namespace.
 * Each tenant/company/login gets a private room identified by
 *   `${tenantId}:${companyCode}:${loginId}`
 * The client joins that room after authentication.
 */
export function initSupportSocket(io: Server) {
  const ns = io.of('/support');

  ns.on('connection', (socket: Socket) => {
    const { tenantId, companyCode, loginId } = socket.handshake.auth as any;
    if (!tenantId || !companyCode || !loginId) {
      socket.disconnect(true);
      return;
    }

    const room = `${tenantId}:${companyCode}:${loginId}`;
    socket.join(room);

    // Presence heartbeat – locally track who is online until persistence is implemented.
    ns.emit('presence:update', { loginId, status: 'online' });

    socket.on('typing', (data: { ticketId: number }) => {
      const ticketRoom = `ticket:${data.ticketId}`;
      socket.to(ticketRoom).emit('typing', { loginId, ticketId: data.ticketId });
    });

    socket.on('joinTicket', (data: { ticketId: number }) => {
      const ticketRoom = `ticket:${data.ticketId}`;
      socket.join(ticketRoom);
    });

    socket.on('disconnect', () => {
      ns.emit('presence:update', { loginId, status: 'offline' });
    });
  });
}

