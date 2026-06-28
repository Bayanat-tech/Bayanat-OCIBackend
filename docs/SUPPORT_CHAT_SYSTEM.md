# Support Chat System

## Purpose

The support chat system lets application users raise help requests from inside any module. Admin/support users can see incoming requests, reply, and track active users. Users can attach screenshots or files when they create or reply to a ticket.

## Socket Or Polling?

This version uses Socket.IO for real-time synchronization.

REST APIs are still used for loading and saving data, but Socket.IO notifies clients immediately when something changes.

- The frontend sends a heartbeat every 45 seconds to mark the logged-in user online.
- When a ticket/message/status changes, backend emits a Socket.IO event.
- The frontend receives the event and reloads tickets/messages immediately.
- A 30 second fallback refresh remains while the chat drawer is open.

Socket path:

`/socket.io`

Socket authentication:

- Frontend sends the same JWT used for REST APIs.
- Backend verifies the JWT before allowing the socket connection.
- Each user joins a private room: `support:user:<LOGINID>`.
- Support admins also join: `support:admins`.

Socket events:

- `support:ready`: sent after JWT validation. Includes whether the user is admin.
- `support:presence-changed`: sent when heartbeat updates online status.
- `support:tickets-changed`: sent when a ticket is created, replied to, assigned, or closed.

## Frontend Files

Frontend repo: `D:\Frontend-Evolution`

- `src/components/SupportChatWidget.tsx`
  Main chat UI, ticket list, messages, compose box, attachments, role switch.

- `src/api/support.ts`
  API wrapper for all support endpoints.

- `src/pages/WorkspacePage.tsx`
  Adds the support chat button to the workspace header.

- `src/styles.css`
  Support chat drawer and message styling.

## Backend Files

Backend repo: `D:\Bayanat-OCIBackend`

- `src/routes/support.routes.ts`
  Defines support API routes under `/api/support`.

- `src/controllers/supportChat.controller.ts`
  Receives requests and calls the service.

- `src/services/supportChat.service.ts`
  Business logic, root-schema table creation, ticket/message/presence queries.

- `src/services/supportRealtime.service.ts`
  Socket.IO setup, JWT socket authentication, room joining, realtime events, admin-role decision.

- `index.ts`
  Mounts support routes:

```ts
app.use("/api/support", supportRoutes);
```

Socket.IO is attached to the same HTTP server in `index.ts`.

## Admin/User Role Decision

The frontend does not decide who is admin for security.

The backend decides admin role from the authenticated JWT user.

Current simple rule:

- `loginid` is `ADMIN`, `BTADMIN`, or `SUPERADMIN`
- or `username` is `ADMIN`
- or `loginid` contains `ADMIN`

If the user is not admin, backend forces `role=user` even if the browser sends `role=admin`.

This means normal users cannot read other users' tickets by changing the request URL.

Future better rule:

- Add a support-admin permission in Security module.
- Check that permission in backend instead of checking login name.

## Database Schema

All support tables are in root schema:

`CUSTOMERS`

The support service creates tables automatically if missing.

### CUSTOMERS.SUPPORT_PRESENCE

Stores who is online or recently active.

Important columns:

- `LOGINID`: user login id, primary key
- `USERNAME`: display name
- `COMPANY_CODE`: user company
- `TENANT_ID`: tenant code
- `LAST_SEEN_AT`: last heartbeat time

Used for:

- Green online indicator
- Active users list
- Requester online status

Online rule:

```sql
LAST_SEEN_AT >= SYSDATE - (5 / 1440)
```

That means online if seen within the last 5 minutes.

### CUSTOMERS.SUPPORT_TICKET

Stores one support request.

Important columns:

- `TICKET_ID`: ticket id
- `COMPANY_CODE`: company
- `TENANT_ID`: tenant
- `REQUESTER_LOGINID`: user who created the request
- `REQUESTER_NAME`: requester display name
- `ASSIGNED_TO`: support/admin login assigned to the ticket
- `SUBJECT`: request subject
- `MODULE_NAME`: module where request was created
- `PAGE_URL`: application path where user was working
- `STATUS`: `OPEN`, `CLOSED`, etc.
- `PRIORITY`: `NORMAL`, etc.
- `LAST_MESSAGE`: latest message text
- `LAST_MESSAGE_AT`: latest message time
- `CREATED_AT`: created time
- `UPDATED_AT`: updated time
- `CLOSED_AT`: closed time

### CUSTOMERS.SUPPORT_MESSAGE

Stores messages inside a ticket.

Important columns:

- `MESSAGE_ID`: message id
- `TICKET_ID`: parent ticket
- `SENDER_LOGINID`: sender login
- `SENDER_NAME`: sender display name
- `SENDER_ROLE`: `USER` or `ADMIN`
- `MESSAGE_TEXT`: message body
- `HAS_ATTACHMENTS`: `Y` or `N`
- `READ_AT`: read timestamp
- `CREATED_AT`: message time

### CUSTOMERS.SUPPORT_ATTACHMENT

Stores attached screenshots/files as data URLs.

Important columns:

- `ATTACHMENT_ID`: attachment id
- `TICKET_ID`: parent ticket
- `MESSAGE_ID`: parent message
- `FILE_NAME`: file name
- `FILE_TYPE`: MIME type
- `FILE_SIZE`: file size
- `DATA_URL`: file content as data URL
- `CREATED_AT`: upload time

Current attachment storage is database CLOB. For very large files, we should later move to Object Storage/S3 and store only the file URL in DB.

## API Endpoints

All endpoints require JWT and tenant context middleware.

Base URL:

`/api/support`

### POST /heartbeat

Marks current user online.

Frontend calls:

- immediately after login/workspace load
- every 45 seconds

### GET /active-users

Returns support presence list with online flag.

Used by admin/helpdesk active-user display.

### GET /directory

Returns active login users from `CUSTOMERS.SEC_LOGINTEST` joined with support presence.

Currently available for future assignment/member listing.

### GET /tickets?role=user

Returns tickets visible to current user.

For `role=user`, backend returns only tickets where:

- `REQUESTER_LOGINID = current loginid`
- or `ASSIGNED_TO = current loginid`

### GET /tickets?role=admin

Returns all tickets.

Used for support/admin users.

### POST /tickets

Creates a new support ticket and inserts the first message.

Payload example:

```json
{
  "subject": "Invoice page issue",
  "message": "Invoice save is failing",
  "module": "finance",
  "page_url": "/workspace/finance/accounts/transactions/purchase",
  "priority": "NORMAL",
  "attachments": []
}
```

### GET /tickets/:ticketId/messages?role=user

Loads messages for a ticket.

Access check:

- Admin role can read all tickets.
- User role can read only their own or assigned tickets.

If the selected ticket belongs to another user, backend returns:

`Support ticket not found or not accessible`

Frontend now handles this by clearing the stale selection and showing a friendly message.

### POST /tickets/:ticketId/messages

Adds a reply message to a ticket.

Payload example:

```json
{
  "message": "Please check the attached screenshot.",
  "attachments": []
}
```

### PATCH /tickets/:ticketId

Updates ticket status, priority, or assignment.

Used for closing tickets.

### POST /tickets/:ticketId/read

Marks messages as read for the current user.

## User Flow

### Normal User

1. User opens chat from workspace header.
2. Frontend calls heartbeat and loads the user ticket list.
3. User clicks `New request`.
4. User enters subject/message and optionally attaches a screenshot.
5. Backend creates:
   - one row in `SUPPORT_TICKET`
   - one row in `SUPPORT_MESSAGE`
   - attachment rows if files exist
6. User sees replies in the same ticket.

### Admin / Support User

1. Admin opens chat.
2. If admin mode is available, the role switch shows `Mine` and `Admin`.
3. In `Admin` mode, admin can see all support tickets.
4. Admin selects a ticket, reads messages, replies, and can close the ticket.

## Why Stale Ticket Error Happens

Example failed call:

`GET /api/support/tickets/2/messages?role=user`

If ticket `2` was created by another login, and current user is in `role=user`, backend blocks it.

This is correct security behavior.

Frontend now handles this more nicely:

- Clears selected ticket
- Clears old messages
- Shows: “This support ticket is no longer available for your login. Please select another ticket or start a new request.”

## Troubleshooting

### 404 on /api/support

Cause:

Backend running process does not have support routes loaded.

Fix:

Restart backend after pulling/deploying support route code.

### ORA-01861 on SUPPORT_PRESENCE

Cause:

Existing `LAST_SEEN_AT` data or column type can differ by Oracle date/string format.

Fix already implemented:

Support service now safely normalizes `LAST_SEEN_AT` before comparing online status.

### Ticket Not Accessible

Cause:

Current user is trying to read a ticket that is neither created by them nor assigned to them.

Fix:

Use admin mode for support team, or select/create a ticket visible to that user.

## Future Improvements

- Add Socket.IO/WebSocket for real-time message push.
- Store attachments in Object Storage instead of DB CLOB.
- Add ticket assignment UI.
- Add unread notification badge by module.
- Add ticket categories and priority colors.
- Add admin user directory panel.
