# Backend API Reference

## Authentication

API endpoints require a valid session token sent as a `Bearer` token in the `Authorization` header, except the auth endpoints, public health check, and ssMusic streaming endpoint (which requires a file-scoped playback ticket).

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

Queue entries retain the existing `video_id`, `video_title`, and `video_thumbnail` fields. `source` defaults to `youtube` for existing clients and rows. ssMusic search results additionally supply `source: "ssmusic"`, `media_path` (the opaque `jobId/filename` identity), and `media_type` (`audio` or `video`). Send these fields unchanged when adding a result through either `POST /api/queue/:partyId` or `POST /api/queue/:partyId/play-next`. The backend validates the path and derives its media ID/type; playback tickets are never persisted in the queue.

### YouTube

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/youtube/search?q=` | member | Search YouTube (add `&karaoke=true` to filter karaoke versions) |
| `GET` | `/api/youtube/video?url=` | member | Fetch video metadata by YouTube URL |

### ssMusic

Configure `SSMUSIC_SERVER_URL` and `SSMUSIC_API_KEY` on the backend. The latter must match the upstream server's read-only `SEARCH_API_KEY`. All upstream requests use `X-API-Key`; browser requests use this app's normal session authentication.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/ssmusic/search?q=&offset=0` | member | Paginated library search; returns `{ items, total, offset, limit }`, 20 results per page |
| `GET` | `/api/ssmusic/playback?path=` | member | Checks file access and returns `{ stream_path, media_type, lyrics }` |
| `GET`, `HEAD` | `/api/ssmusic/media?ticket=` | signed playback ticket | Streams only the ticket's file, with byte-range seeking support |

Search adapts ssMusic's `/api/songs/search` page-based API, which currently indexes **audio only**. Each result contains `video_id`, `title`, `channel`, `thumbnail`, `source`, `media_path`, and `media_type`. Missing configuration returns 503; malformed queries/paths return 400. Upstream access restrictions still apply.

URL-encode the opaque `media_path` when requesting playback. Append `stream_path` to the configured API base URL, including its `/api` prefix, for the native media element's `src`. The stream route needs no session header because the browser cannot attach one to native media requests; it verifies a four-hour, resource-scoped ticket instead. Tickets also expire on backend restart; reload the player to obtain a new one. Do not log or share these temporary playback URLs.

`lyrics` contains `{ lines: [{ time, text }], text }`. Cue times are normalized to **milliseconds** from ssMusic's seconds-based `sylt` array; `text` is its plain `uslt` fallback. MP3 files may have embedded lyrics; other formats can play without them. No lyric generation or editing is exposed. Streaming never forwards the upstream key or redirects to the browser, and responses are private/non-cacheable.

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
