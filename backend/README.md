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
| `POST` | `/api/queue/:partyId/:itemId/ssmusic` | member | Submit a YouTube queue item to ssMusic; returns the item (202 pending, 200 ready) |
| `DELETE` | `/api/queue/:partyId/:itemId` | member | Remove song, releasing its ssMusic reference first when marked `kpMedia` |
| `PUT` | `/api/queue/:partyId/reorder` | member | Reorder queue |
| `PATCH` | `/api/queue/:partyId/:itemId/status` | member | Update song status (`queued` / `playing` / `paused` / `played`) |
| `PATCH` | `/api/queue/:partyId/reset` | member | Reset all non-playing songs to `queued` |

Queue entries retain the existing `video_id`, `video_title`, and `video_thumbnail` fields. `source` defaults to `youtube` for existing clients and rows. ssMusic search results additionally supply `source: "ssmusic"`, `media_path` (the opaque `jobId/filename` identity), and `media_type` (`audio` or `video`). Send these fields unchanged when adding a result through either `POST /api/queue/:partyId` or `POST /api/queue/:partyId/play-next`. The backend validates the path and derives its media ID/type; playback tickets are never persisted in the queue.

The ssMusic submission route needs no request body: it derives `videoURL` from the stored YouTube ID and `playlistId` from the party ID. Locked parties return 423; non-YouTube items return 400. Job fields `ssmusic_job_id`, `ssmusic_status` (`submitting`, `queued`, `running`, `completed`, or `error`), and `ssmusic_error` are separate from playback `status` and are included in queue reads. The backend sets `kpMedia: true` and retains `youtube_video_id` before submitting, so cleanup remains possible after conversion or an ambiguous network failure. These are server-owned fields, not caller-supplied flags. Apply [V3__Queue_ssmusic_jobs.sql](db/migrations/V3__Queue_ssmusic_jobs.sql) and [V4__Queue_kp_media.sql](db/migrations/V4__Queue_kp_media.sql) before starting this backend.

Each item has an independent background worker; repeated submissions for a pending row share its worker. The backend polls every three seconds and resumes persisted pending jobs at startup. Changes are broadcast as `queue:update` with `action: "media"`. Conversion updates media fields only, preserving queue ID, singer, position, and playback status. Adds, polls, and removals for the same video in one party are serialized, while different videos continue concurrently. Pending jobs from before reference tracking register a named reference when resumed; ordinary existing ssMusic rows are not retroactively marked kpMedia.

Deleting a kpMedia row uses its retained YouTube ID and party ID for cleanup. Duplicate kpMedia rows in one party share the upstream reference, so only the last local copy sends a remove action. Successful or already-removed references allow local deletion; blocked/failed requests leave the row intact and return the sanitized upstream status and error. A busy final video returns 409; retry after the upstream job is idle. Ordinary unmarked rows never request upstream deletion.

### YouTube

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/youtube/search?q=` | member | Search YouTube (add `&karaoke=true` to filter karaoke versions) |
| `GET` | `/api/youtube/video?url=` | member | Fetch video metadata by YouTube URL |

### ssMusic

Configure `SSMUSIC_SERVER_URL` and `SSMUSIC_API_KEY` on the backend. The latter must match the upstream server's `SEARCH_API_KEY`, which permits catalog/media reads and KaraokeParty playlist add/remove actions. All upstream requests use `X-API-Key`; browser requests use this app's normal session authentication.

Playlist video actions require [ssMusic commit 06ea037](https://github.com/skystream006/ssMusic_Server/commit/06ea037343d9b312f8bd2684ac95b97a404dbf11) or later. The backend sends `POST /api/karaoke/jobs` with `{ "action": "add", "videoURL": "https://www.youtube.com/watch?v=cMoRYP8EDUk", "playlistId": "party-id" }`. New and pending duplicate jobs return 202 with `{ jobId, status, duplicate, action, playlistId, playlistCount, ready, statusUrl, playUrl, playerUrl }`; ready duplicates return 200. Status is fetched using `GET /api/karaoke/jobs/:jobId` with the same key. Only `ready: true` with a validated video `playUrl` triggers conversion. The direct stream path becomes `media_path`; `playerUrl` is not used because it requires a signed-in ssMusic browser session. Returned URLs are never followed to another origin.

Removal uses the same endpoint and key with `{ "action": "remove", "videoURL": "https://www.youtube.com/watch?v=cMoRYP8EDUk", "playlistId": "party-id" }`. HTTP 200 contains `{ action, playlistId, removed, videoDeleted, playlistCount }` and may include `jobId` and `retainedReason`. `removed: false` is an idempotent success; `videoDeleted: false` can mean other playlist references, another owner, library memberships, or protected legacy references retain the media. The backend never calls the general job-deletion endpoint or forces deletion of shared media.

Failed jobs, completed jobs without a playable file, access conflicts, and request failures leave the row as YouTube and expose a sanitized per-item error. A new menu submission retries the request; ssMusic deduplicates by video ID and does not automatically rerun failed jobs. An ssMusic administrator must rerun those jobs first. The upstream KaraokeParty account must remain an approved ExtServer account.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/ssmusic/search?q=&offset=0&NoVocalsOnly=true` | member | Paginated library search; returns `{ items, total, offset, limit }`, 20 results per page |
| `GET`, `HEAD` | `/api/ssmusic/artwork?path=` | member | Proxies a file's thumbnail, requesting the upstream fallback for audio without artwork |
| `GET` | `/api/ssmusic/playback?path=` | member | Checks file access and returns `{ stream_path, media_type, lyrics }` |
| `GET`, `HEAD` | `/api/ssmusic/media?ticket=` | signed playback ticket | Streams only the ticket's file, with byte-range seeking support |

Search adapts ssMusic's `/api/songs/search` page-based API for audio and video. Each result contains `video_id`, `title`, `channel`, `thumbnail`, `source`, `media_path`, and `media_type`. Missing configuration returns 503; malformed queries/paths return 400. Upstream access restrictions still apply.

The optional `NoVocalsOnly` parameter accepts `true` or `false` and is forwarded on every upstream page request. Omission defaults to `false` for existing API clients; the search UI enables this filter by default. Use an ssMusic Server version supporting `NoVocalsOnly` to apply the filter.

When upstream search provides `artworkUrl`, `thumbnail` contains a local `/ssmusic/artwork?path=...` reference relative to the API base. Fetch artwork with the normal bearer token and render the returned image blob; do not expose the upstream API key in an image URL. Artwork paths are constructed from the validated media identity, not upstream URLs. ssMusic queue entries store no `video_thumbnail` URL: the UI loads artwork from `media_path`, including for existing entries, without URL length limits or expiring links in the database. Unavailable artwork does not prevent adding or playing a song.

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
