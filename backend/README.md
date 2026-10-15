# Backend API Reference

## Authentication

API endpoints require `Authorization: Bearer <token>`, except passkey enrollment/login, HOST key login, PKCE app code exchange, invitation resolution/redemption, the public health check, and ticket-authenticated media streaming. Legacy password login and anonymous QR session issuance have been removed (legacy auth endpoints return 410).

`admin` and `member` are approved passkey accounts; `member` accounts can host parties. `guest` sessions come only from valid host invitations and are restricted to their assigned party and member. Account sessions last 24 hours and are stored as hashes in PostgreSQL. Guest access ends no later than the invitation or host session. Every protected request rechecks account approval, membership and invitation validity. Auth/API responses are non-cacheable.

Apply all Flyway migrations, including [V5__Passkeys_and_party_invitations.sql](db/migrations/V5__Passkeys_and_party_invitations.sql) and [V6__App_login_codes.sql](db/migrations/V6__App_login_codes.sql), before starting. Set `PASSKEY_RP_ID` and the exact `PASSKEY_ORIGIN`. HTTPS is required outside localhost; raw IP RP IDs are rejected. Optional secondary settings must be supplied together. Register the first administrator locally before exposing the service. Later registrations require admin approval. Use Node.js 22+.

---

## API Reference

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register/options` | Configured Origin | `{ name }` creates a single-use registration challenge |
| `POST` | `/api/auth/register/verify` | Configured Origin | `{ requestId, response }`; first verified account is admin, later accounts are pending |
| `POST` | `/api/auth/login/options` | Configured Origin | Discoverable passkey login options |
| `POST` | `/api/auth/login/verify` | Configured Origin | `{ requestId, response }`; verifies signature, UV, RP, origin and counter |
| `POST` | `/api/auth/hostscreen/login` | Shared HOST key | `{ key }`; 10 attempts per IP per 10 minutes; returns a `hostscreen` session |
| `GET` | `/api/auth/hostscreen/login-attempts` | admin | Newest 50 failed/blocked HOST attempts; optional `before` cursor |
| `DELETE` | `/api/auth/hostscreen/login-attempts` | admin | Permanently clear all HOST login records and remove the record-cap lockout; 204 |
| `GET` | `/api/auth/account-info` | approved admin/member | Returns `{ user, HOST_SCREEN_LOGIN_KEY }`; key is null when unset |
| `POST` | `/api/auth/app/token` | One-time code + S256 verifier | Native app exchange; no Origin, cookie or bearer token required |
| `GET` | `/api/auth/me` | session | Authoritative `{ level, user, partyId, memberId, expiresAt }` |
| `POST` | `/api/auth/logout` | session | Revoke this session and dependent guest sessions; 204 |
| `GET` | `/api/auth/passkeys` | account | Public credential metadata for your account |
| `POST` | `/api/auth/passkeys/options` | account + Origin | Options to enroll another passkey for your account |
| `POST` | `/api/auth/passkeys/verify` | account + Origin | `{ requestId, response }`; 201 on verified enrollment |
| `DELETE` | `/api/auth/passkeys/:id` | account | Remove an owned credential, retaining at least one; 204 |
| `GET` | `/api/auth/users` | admin | List accounts and approval status |
| `PATCH` | `/api/auth/users/:id` | admin | `{ role?, status? }`; revoke target's sessions and invitations |

Options endpoints return `{ requestId, options }`. A successful sign-in returns `{ token, level, user, partyId, memberId, expiresAt }`. Pending registration returns 201 with `{ pending: true, message }`, without a token. Role is assigned server-side; registration cannot request admin access. Names are case-insensitively unique, 2-60 characters. Challenges expire after five minutes, are consumed on the first verification attempt, and do not survive restart. `Origin` must match a configured origin exactly; credentials are verified against that ceremony's RP ID. Passkey ceremonies are rate-limited to 30 requests per five minutes per client IP and challenge storage is bounded.

Passkey roles are `admin` or `member`; account status is `pending`, `approved` or `revoked`. Account changes invalidate all of the target's sessions, outstanding app codes and dependent invitations/guests. Self-revocation and removing the last approved admin are rejected. Passkey removal does not revoke existing sessions; logout or account revocation does.

Apply [V7__Hostscreen_account.sql](db/migrations/V7__Hostscreen_account.sql) for the dedicated `HOSTSCREEN` account and `hostscreen` role. Configure the backend-only `HOST_SCREEN_LOGIN_KEY` with a long random secret; blank disables login (503), invalid keys return 401. This shared account can list active parties and join as organizer, then use queue/playback/invitation controls. It cannot create, rename, lock, unlock, end, delete, duplicate or reactivate parties, administer party members, join as guest (including authenticated invitation redemption), execute YouTube/ssMusic/member searches, enroll passkeys, read account info, or administer accounts. Party mutation routes return 403 even when HOSTSCREEN has organizer membership. Its role cannot be changed through `/auth/users/:id`. HOST sessions use the normal hashed tokens and 24-hour expiry. Each screen has a separate session but shares party membership with other screens. Changing the key requires a backend restart and does not revoke existing sessions. Never log login request bodies or account-info responses.

HOST login has its own per-IP limiter, separate from passkey ceremonies: the first 10 requests in a 10-minute window are allowed, and subsequent requests return 429 with `{ error }` and `Retry-After` seconds. The window starts at the first attempt, counts successful and failed requests, and is not extended by blocked requests. Responses remain non-cacheable. IP identification uses Express `req.ip` and the configured `TRUST_PROXY`; do not trust arbitrary forwarding headers. Like the existing limiters, counters are in memory per backend process and do not survive restart or synchronize across replicas.

### HOST Login Records

Apply [V8__Hostscreen_login_attempts.sql](db/migrations/V8__Hostscreen_login_attempts.sql) before starting the updated backend. Incorrect or malformed keys are recorded as `invalid_key`; requests rejected by the HOST limiter are recorded as `rate_limited` without checking the submitted key. Successful logins and disabled HOST login are not failure records. Each PostgreSQL row contains only `id`, `occurred_at`, `ip_address` and `outcome`. No keys, tokens, bodies or arbitrary request headers are persisted. IP addresses come from the configured Express proxy handling, not directly from a supplied header; unavailable or invalid IPs are stored as null.

The admin-only, non-cacheable endpoint returns `{ items, nextCursor, recordCount, recordLimit, loginDisabled }`, ordered by descending ID with at most 50 items. `recordCount` is the total across all pages; `recordLimit` is 1000. Pass `?before=<nextCursor>` for older records. A null cursor means there are no more records; malformed cursors return 400. Members, guests and HOSTSCREEN receive 403. Admins can also review, refresh, load older records and confirm clearing them in **Account Info > HOST login attempts**.

At 1000 records, HOST login returns 503 for every IP and key, and stops adding records. A shared PostgreSQL transaction advisory lock serializes counting, recording, successful login and admin clearing across backend instances, so concurrent requests cannot bypass the cap. The request that records the thousandth failure commits that record and returns the disabled status. The lockout persists until an admin clears the records using `DELETE /api/auth/hostscreen/login-attempts`; clearing is idempotent and does not reset the per-IP retry cooldown or revoke existing sessions. No new migration beyond V8 is needed.

Audit records persist across restarts independently of the in-memory retry counters and have no automatic expiry. Attempts before this migration are not backfilled. Database audit failures return a sanitized 503 without permitting the login. Requests rejected before reaching the HOST route, such as by an upstream proxy or the general API limiter, are not recorded here.

### Android App Handoff

`GET /app-login` is a frontend route on the configured HTTPS origin. It accepts exactly `redirect_uri=com.sskaraoke.player:/oauth/callback`, `code_challenge_method=S256`, `code_challenge`, and `state`. The latter two are 43-character unpadded base64url values. Unsupported callbacks/methods, missing or duplicate parameters, and fragments are rejected. The page requires a fresh passkey ceremony regardless of browser session state and offers registration, pending-approval feedback, cancellation and a **Return to app** fallback.

For app sign-in, `/api/auth/login/options` receives `{ appLogin: { redirect_uri, code_challenge, code_challenge_method, state } }`; `/api/auth/register/options` also receives `name`. The server validates the app parameters and HTTPS origin before binding them to its single-use WebAuthn challenge. Verify endpoints still accept only `{ requestId, response }`; app parameters submitted at verification cannot replace the bound request. All existing signature, origin, RP ID, counter, user-handle and user-verification checks remain in force.

A verified approved account returns `{ redirectUrl: "com.sskaraoke.player:/oauth/callback?code=...&state=..." }` instead of a browser session. The code is 32 random bytes encoded as 43 base64url characters and expires after two minutes. The original state is echoed unchanged. A first registration can authorize the initial administrator; later registrations return the normal pending response without a code. No existing browser session is copied into the app or replaced by the handoff.

The native client posts JSON to `/api/auth/app/token`:

```json
{
	"code": "<43-character authorization code>",
	"code_verifier": "<43-character base64url verifier>",
	"redirect_uri": "com.sskaraoke.player:/oauth/callback"
}
```

The server hashes the verifier with SHA-256/base64url, locks the approved account, and atomically deletes the matching unexpired code before creating a session in the same transaction. Only a SHA-256 code hash is stored; codes are bound to their account, callback and challenge. A successful exchange returns HTTP 200 with the normal flat `{ token, level, user: { id, name, role }, partyId, memberId, expiresAt }`, where `level` is `member` or `admin`, the party/member fields are null, and expiry is a future ISO-8601 timestamp. Existing 24-hour lifetimes, `/api/auth/me`, logout and authorization checks are unchanged. Concurrent exchanges cannot issue multiple sessions.

Malformed, expired, replayed, incorrectly bound or unapproved-account exchanges return 400 without a session. Exchange does not require browser cookies, an `Origin` header, or a fabricated browser identity. It uses the same 30-requests-per-five-minutes auth limiter (429 on exhaustion). The handoff page and auth responses use `Cache-Control: no-store`; the bundled proxy omits query strings from access logs. Do not log POST bodies, authorization codes, verifiers or tokens in additional proxies. No Android origin or Digital Asset Links entry is needed; both the app and browser must trust the configured HTTPS hostname's certificate.

### Parties

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/parties` | member | List active parties |
| `GET` | `/api/parties/all` | 🔐 admin | List all parties (active + ended) |
| `POST` | `/api/parties` | member | Create a party |
| `GET` | `/api/parties/members/search?name=` | member | Search members by name across all parties |
| `GET` | `/api/parties/:id` | party member / admin | Get authorized party details |
| `POST` | `/api/parties/invitations/resolve` | invitation | `{ invitation }` returns only party ID/name, host name and expiry |
| `POST` | `/api/parties/:id/invitations` | joined host | Issue a new invitation tied to this host's membership and session |
| `POST` | `/api/parties/:id/join` | invitation or account | Redeem an invitation as guest, or join as the authenticated account |
| `PATCH` | `/api/parties/:id` | 🔐 admin | Update party name |
| `PATCH` | `/api/parties/:id/reactivate` | admin | Reactivate an ended party |
| `PATCH` | `/api/parties/:id/lock` | passkey party host / admin | Lock or unlock; HOSTSCREEN is denied; caller-supplied member IDs are not authorization |
| `DELETE` | `/api/parties/:id` | passkey party host / admin | End a party and revoke invitations/guest sessions; HOSTSCREEN is denied |
| `DELETE` | `/api/parties/:id/remove` | admin | Permanently delete a party and all its data |
| `GET` | `/api/parties/:id/members` | party member / admin | List members of the authorized party |
| `GET` | `/api/parties/:id/members/:memberId` | own member / admin | Fetch your own membership |
| `PATCH` | `/api/parties/:id/members/:memberId` | 🔐 admin | Update member name / role |
| `DELETE` | `/api/parties/:id/members/:memberId` | 🔐 admin | Remove a member from the party |

Invitation creation returns `{ id, token, partyId, expiresAt }`. The secret is random (32 bytes, base64url); only its SHA-256 hash is persisted. It expires after at most 12 hours, capped by the host session. Generating a new QR for the same host membership/session revokes the old invitation and its guests. Other hosts' invitations are independent. Host logout, expiry, revocation, membership removal/demotion, or ending/deleting the party invalidates derived access. Reactivation does not restore invitations.

Guest redemption is `POST /api/parties/:id/join` with `{ "name": "Guest", "invitation": "<secret>" }`. It returns `{ member, token, level: "guest", user: null, partyId, memberId, expiresAt }`. The secret must match this party and a live host. `role: "organizer"`, supplied member/account IDs, weak codes, and expired/replaced invitations are rejected. Every redemption creates a distinct guest membership; a matching display name never grants another identity. The QR is reusable until revoked/expired, so possession permits joining that one party. Browser URLs use `/join/invite#invite=<secret>` to keep secrets out of request URLs/referrers; avoid logging POST bodies.

Approved accounts may join with `{ name?, role? }` and a bearer session; omitted role defaults to organizer. Their membership is keyed by account ID, not name. A guest bearer token without a valid invitation cannot join another party or upgrade its role. Legacy `GET /api/parties/join/:code` no longer grants access. Listing/searching parties or names requires an approved account. QR-only memberships cannot be promoted to host.

### Queue

All queue operations require membership in the requested party (or admin). The `member` label below includes a scoped QR guest, but never permits another party. Non-host submissions use the authenticated membership and name; forged member IDs are rejected. Hosts assigning a singer must choose a member of that same party.

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

Search includes all video categories and does not apply `videoEmbeddable` or `videoSyndicated` filters. Restricted results remain available to add.

Both queue-add endpoints check YouTube `status` and `contentDetails` after saving the item. Disabled embedding, private or unavailable videos, age restrictions, and any declared regional restriction automatically send that queued item through the existing ssMusic job worker. This check needs `YOUTUBE_API_KEY` and times out after five seconds; an unavailable check does not prevent adding the video. YouTube playback errors 100, 101, and 150 also trigger the same per-item submission, without duplicate requests for pending jobs. Other player errors do not start processing.

Pending items display "Video is processing, come back when done" in the playlist and player, with a notification after adding. The original queue identity is retained when ssMusic becomes ready. Failed processing leaves the song queued with an error and the existing "Send to ssMusic" retry action. Queue locks and upstream access restrictions still apply.

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

URL-encode the opaque `media_path` when requesting playback. Append `stream_path` to the configured API base URL, including its `/api` prefix, for the native media element's `src`. The stream route verifies a resource/session-bound ticket and rechecks its issuing session on every request. Tickets last at most four hours, capped by the session, and expire on backend restart. A QR guest can obtain/use tickets only for files in its own party queue. Logout, invitation replacement, host revocation, or removing that song from the queue blocks subsequent guest stream requests. Already buffered/downloaded bytes cannot be recalled. Do not log or share playback URLs.

`lyrics` contains `{ lines: [{ time, text }], text }`. Cue times are normalized to **milliseconds** from ssMusic's seconds-based `sylt` array; `text` is its plain `uslt` fallback. MP3 files may have embedded lyrics; other formats can play without them. No lyric generation or editing is exposed. Streaming never forwards the upstream key or redirects to the browser, and responses are private/non-cacheable.

### Utility

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | None | Health check |
| `GET` | `/api/server-info` | member | Get server's local IP address |

---

## Socket.IO Events

Connect using `io(origin, { auth: { token } })`. Unauthenticated/expired sessions are rejected at the handshake. Every room join/event revalidates the session and party membership; only hosts can send `video:progress`. Guests can seek/change audio only inside their joined party and while unlocked. Session/invitation revocations disconnect affected sockets, and sockets disconnect at session expiry. `join:party` acknowledges `{ ok: true }` or `{ error }`.

| Direction | Event | Payload / Description |
|-----------|-------|----------------------|
| Client → Server | `join:party` | Join a party's real-time room |
| Client → Server | `leave:party` | Leave a party's real-time room |
| Client → Server | `video:progress` | Organizer broadcasts current playback time & duration |
| Client → Server | `video:seek` | Guest requests a seek to a specific time |
| Server → Client | `queue:update` | Queue changed — `{ action, queue: [...] }` |
| Server → Client | `video:progress` | Forwarded playback progress to guests |
| Server → Client | `video:seek` | Forwarded seek request to organizer |
