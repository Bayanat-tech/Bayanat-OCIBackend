import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import constants from "../helpers/constants";

type SocketUser = {
  loginid: string;
  username?: string;
  company_code?: string;
  tenantId?: string;
  isSupportAdmin: boolean;
};

let ioServer: Server | null = null;
const connectedUsers = new Map<string, SocketUser & { socketCount: number; lastSeenAt: Date }>();
const SUPPORT_ADMIN_LOGINIDS = new Set(["ADMIN", "BTADMIN", "SUPERADMIN", "2012020136"]);

export function isSupportAdminUser(user: any) {
  const loginid = String(user?.loginid || user?.LOGINID || "").toUpperCase();
  const username = String(user?.username || user?.USERNAME || "").toUpperCase();
  return SUPPORT_ADMIN_LOGINIDS.has(loginid) || SUPPORT_ADMIN_LOGINIDS.has(username) || loginid.includes("ADMIN");
}

export function resolveSupportRole(user: any, requestedRole: string) {
  return requestedRole.toLowerCase() === "admin" && isSupportAdminUser(user) ? "admin" : "user";
}

export function initSupportRealtime(server: http.Server) {
  ioServer = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    path: "/socket.io",
  });

  ioServer.use((socket, next) => {
    try {
      const token =
        String(socket.handshake.auth?.token || "") ||
        String(socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return next(new Error("Missing token"));

      const payload: any = jwt.verify(token, constants.AUTHENTICATION.APP_SECRET || process.env.APP_SECRET || "BAYANAT");
      const user: SocketUser = {
        loginid: String(payload.loginid || ""),
        username: payload.username,
        company_code: payload.company_code,
        tenantId: payload.tenantId,
        isSupportAdmin: isSupportAdminUser(payload),
      };
      if (!user.loginid) return next(new Error("Invalid token"));
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  ioServer.on("connection", (socket) => {
    const user = socket.data.user as SocketUser;
    socket.join(userRoom(user.loginid));
    if (user.isSupportAdmin) socket.join(adminRoom());
    markConnected(user);

    socket.emit("support:ready", {
      loginid: user.loginid,
      role: user.isSupportAdmin ? "admin" : "user",
    });

    socket.on("support:typing", (payload: { ticketId?: number; requesterLoginid?: string; assignedTo?: string | null; typing?: boolean }) => {
      const eventPayload = {
        ticketId: payload?.ticketId,
        loginid: user.loginid,
        username: user.username || user.loginid,
        role: user.isSupportAdmin ? "admin" : "user",
        typing: Boolean(payload?.typing),
      };
      ioServer?.to(adminRoom()).emit("support:typing", eventPayload);
      if (payload?.requesterLoginid) {
        ioServer?.to(userRoom(payload.requesterLoginid)).emit("support:typing", eventPayload);
      }
      if (payload?.assignedTo) {
        ioServer?.to(userRoom(payload.assignedTo)).emit("support:typing", eventPayload);
      }
    });

    emitSupportPresenceChanged();

    socket.on("disconnect", () => {
      markDisconnected(user);
      emitSupportPresenceChanged();
    });
  });

  return ioServer;
}

export function emitSupportPresenceChanged() {
  ioServer?.to(adminRoom()).emit("support:presence-changed");
}

export function emitSupportTicketChanged(ticket: { requesterLoginid?: string; assignedTo?: string | null; ticketId?: number; actorLoginid?: string }) {
  ioServer?.to(adminRoom()).emit("support:tickets-changed", { ticketId: ticket.ticketId, actorLoginid: ticket.actorLoginid });
  if (ticket.requesterLoginid) {
    ioServer?.to(userRoom(ticket.requesterLoginid)).emit("support:tickets-changed", { ticketId: ticket.ticketId, actorLoginid: ticket.actorLoginid });
  }
  if (ticket.assignedTo) {
    ioServer?.to(userRoom(ticket.assignedTo)).emit("support:tickets-changed", { ticketId: ticket.ticketId, actorLoginid: ticket.actorLoginid });
  }
}

export function getConnectedSupportUsers() {
  return Array.from(connectedUsers.values()).map((user) => ({
    LOGINID: user.loginid,
    USERNAME: user.username,
    COMPANY_CODE: user.company_code,
    TENANT_ID: user.tenantId,
    LAST_SEEN_AT: user.lastSeenAt.toISOString(),
    IS_ONLINE: "Y",
  }));
}

function markConnected(user: SocketUser) {
  const key = String(user.loginid || "").toUpperCase();
  const existing = connectedUsers.get(key);
  connectedUsers.set(key, {
    ...user,
    socketCount: (existing?.socketCount || 0) + 1,
    lastSeenAt: new Date(),
  });
}

function markDisconnected(user: SocketUser) {
  const key = String(user.loginid || "").toUpperCase();
  const existing = connectedUsers.get(key);
  if (!existing) return;
  const nextCount = existing.socketCount - 1;
  if (nextCount <= 0) {
    connectedUsers.delete(key);
    return;
  }
  connectedUsers.set(key, { ...existing, socketCount: nextCount, lastSeenAt: new Date() });
}

function adminRoom() {
  return "support:admins";
}

function userRoom(loginid: string) {
  return `support:user:${String(loginid || "").toUpperCase()}`;
}
