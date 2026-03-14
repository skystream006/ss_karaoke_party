# Backend API Reference

## Authentication

All API endpoints (except `POST /api/auth` and `GET /api/auth/qr-session`) require a valid session token sent as a `Bearer` token in the `Authorization` header.

Two auth levels are supported:

| Level | Env var | Description |
|-------|---------|-------------|
| `member` | `API_MEMBER_PW` | Access to join, guest, and organizer pages and their APIs |
| `admin` | `API_ADMIN_PW` | Full access, including the settings page and all management APIs |

Session tokens are valid for **24 hours**. Endpoints marked **🔐 admin** require an admin-level token.

---

## API Reference

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth` | None | Validate password and receive a session token |
| `GET` | `/api/auth/qr-session` | None | Issue a short-lived member-level token for QR-code access |

`POST /api/auth` body: `{ "password": "..." }` → response: `{ "token": "...", "level": "member" | "admin" }`

### Parties

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/parties` | member | List active parties |
| `GET` | `/api/parties/all` | 🔐 admin | List all parties (active + ended) |
| `POST` | `/api/parties` | member | Create a party |
| `GET` | `/api/parties/members/search?name=` | member | Search members by name across all parties |
| `GET` | `/api/parties/:id` | member | Get party details |
| `GET` | `/api/parties/join/:code` | member | Look up party by join code |
| `POST` | `/api/parties/:id/join` | member | Join a party |
| `PATCH` | `/api/parties/:id` | 🔐 admin | Update party name |
| `PATCH` | `/api/parties/:id/reactivate` | member | Reactivate an ended party |
| `DELETE` | `/api/parties/:id` | member | End a party (marks inactive) |
| `DELETE` | `/api/parties/:id/remove` | member | Permanently delete a party and all its data |
| `GET` | `/api/parties/:id/members` | member | List party members |
| `PATCH` | `/api/parties/:id/members/:memberId` | 🔐 admin | Update member name / role |
| `DELETE` | `/api/parties/:id/members/:memberId` | 🔐 admin | Remove a member from the party |

### Queue

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/queue/:partyId` | member | Get party queue |
| `POST` | `/api/queue/:partyId` | member | Add song to queue |
| `DELETE` | `/api/queue/:partyId/:itemId` | member | Remove song from queue |
| `PUT` | `/api/queue/:partyId/reorder` | member | Reorder queue |
| `PATCH` | `/api/queue/:partyId/:itemId/status` | member | Update song status (`queued` / `playing` / `paused` / `played`) |
| `PATCH` | `/api/queue/:partyId/reset` | member | Reset all non-playing songs to `queued` |

### YouTube

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/youtube/search?q=` | member | Search YouTube (add `&karaoke=true` to filter karaoke versions) |
| `GET` | `/api/youtube/video?url=` | member | Fetch video metadata by YouTube URL |

### Utility

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | None | Health check |
| `GET` | `/api/server-info` | member | Get server's local IP address |

---

## Socket.IO Events

| Direction | Event | Payload / Description |
|-----------|-------|----------------------|
| Client → Server | `join:party` | Join a party's real-time room |
| Client → Server | `leave:party` | Leave a party's real-time room |
| Client → Server | `video:progress` | Organizer broadcasts current playback time & duration |
| Client → Server | `video:seek` | Guest requests a seek to a specific time |
| Server → Client | `queue:update` | Queue changed — `{ action, queue: [...] }` |
| Server → Client | `video:progress` | Forwarded playback progress to guests |
| Server → Client | `video:seek` | Forwarded seek request to organizer |
