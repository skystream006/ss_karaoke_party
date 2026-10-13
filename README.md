# Karaoke Party 🎤

A web-based, self-hosted karaoke queue system. Users can search for songs on YouTube, queue them up, and sing together — all from their phone's browser.

## Features

- 🎉 **Create a Party** — Organizer starts a named session and receives a QR code / join link for guests
- **Join a Party** - Approved passkey accounts can browse and host parties. QR guests join only the party named in a valid host invitation.
- **Account-bound Memberships** - Returning hosts rejoin their own membership; a name or member ID cannot impersonate another person.
- 📋 **Party Queue** — Real-time playlist visible to all participants with full song-status lifecycle (`queued → playing ↔ paused → played`)
- 🔍 **YouTube Search** — Both organizer and guests can search for songs with an optional **karaoke-only** filter, or add a song by pasting a YouTube URL directly
- 🎶 **ssMusic Search** — Check **ssMusic Search** to search a self-hosted ssMusic Server library and queue its songs alongside YouTube songs
- 🎤 **Synchronized Lyrics** — ssMusic audio displays an auto-scrolling SYLT screen with timed lyric highlighting; plain lyrics or a no-lyrics message appear when synchronized lyrics are unavailable
- ⏯️ **Playback Controls** — Play, pause, resume, skip to next or go back to previous song; guests can also control playback from their device
- ⏭️ **Auto-advance** — Player automatically moves to the next queued song when the current one ends
- 📊 **Song Progress** — Real-time progress bar shared between the organizer player and all guests; guests can seek to any position
- 🔄 **Queue Reset** — One-click reset returns all non-playing songs to `queued`
- 🎛️ **Customization** — Organizer can adjust key, tempo, and vocal level in real time
- 🖱️ **Drag & Drop Reordering** — Organizer and guests can rearrange and remove songs from the playlist
- 👥 **Member Management** — View, rename, change the role of, or remove any party member; secondary organizers are supported
- 🔁 **Party Reactivation** — Ended parties can be reactivated without losing the member list or queue history
- 🎨 **Themes** — Multiple colour themes selectable across the app
- **Passkey Login** - WebAuthn with required user verification; the first account is admin and later accounts need approval. Password login is removed.
- **Android App Login** - ssKaraoke Player signs in through the browser with a single-use, S256 PKCE-protected handoff.
- **Host-bound QR Invitations** - Random, expiring invitations grant a separate guest identity and access to one party only. Host logout, access revocation, invitation replacement, or ending the party revokes that guest access.
- ⚙️ **Admin / Settings Panel** — Dedicated settings page to manage all parties and their members; supports permanent party deletion
- 📱 **Mobile-first** — Designed to be used on phones
- ⚡ **Real-time Updates** — Queue and playback state pushed to all connected clients via Socket.IO
- 🔒 **Rate Limiting** — API endpoints are rate-limited to prevent abuse

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, React Router v6, @hello-pangea/dnd, Socket.IO client |
| Backend | Node.js, Express, Socket.IO |
| Database | PostgreSQL |
| Real-time | Socket.IO |
| Containerisation | Docker + Docker Compose |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- A [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key (free tier)

## Quick Start

### 1. Clone and configure

```bash
git clone <repo-url>
cd ss_karaoke_party
cp .env.example .env
```

Edit `.env` and fill in:

```
YOUTUBE_API_KEY=your_key_here
PORT=3124
HTTPS_PORT=4124
PASSKEY_RP_ID=localhost
PASSKEY_ORIGIN=https://localhost:4124
DOCKER_BIND_ADDRESS=127.0.0.1
```

#### Initialize ssMusic configuration with Python

With Python 3 installed, run this instead of copying `.env.example` manually:

```powershell
python _initialize_project.py
```

The script creates `.env` from the example with placeholder credentials, a placeholder ssMusic hostname, and `SSMUSIC_CA_CERT_FILE=/app/certs/ssmusic-ca.pem`. It creates `certs/ssmusic-ca.pem` by exporting the existing public certificate from the local `ssmusic_server-app-1` Docker container. Existing `.env` and certificate files are preserved; existing certificates are still validated. No containers are started or restarted. No Python packages need to be installed.

For a different container name, use `--container NAME`. A custom public certificate path inside the container can be supplied with `--container-cert-path PATH`. Alternatively, import a trusted PEM certificate or CA bundle obtained from the ssMusic administrator:

```powershell
python _initialize_project.py --cert-file C:/path/to/server-cert.pem
```

The script validates public certificates and rejects private keys. It does not generate an unrelated self-signed certificate, because that would not establish trust in the existing ssMusic server. If certificate import fails, it exits with an error and leaves any newly created placeholder `.env` in place for the next attempt. Fill in the placeholder values before starting Docker, and ensure the ssMusic hostname matches the certificate. On Windows, `py` can be used instead of `python` when the Python launcher is installed.

### 2. Start with Docker Compose

```bash
docker-compose up --build
```
#### 2.a Updating
```bash
cd /to/folder && git pull && docker compose up --build -d
```

- HTTPS frontend and API: https://localhost:4124
- HTTP: http://localhost:3124 redirects to `PASSKEY_ORIGIN`
- Backend diagnostics only: http://localhost:6000 (loopback; normal clients use the frontend proxy)

Open the frontend at the exact `PASSKEY_ORIGIN` and create the first administrator passkey before exposing the application. Compose binds the frontend, database and backend ports to loopback by default. For remote hosting, configure the final HTTPS hostname before enrolling passkeys; see Authentication below. Never remove existing database volumes when upgrading.

On first startup, Nginx generates a self-signed TLS certificate in a persistent Docker volume. Trust its public certificate on each client or supply a trusted certificate/key pair as described below. Changing the examples does not change an existing `.env`: replace any old HTTP `PASSKEY_ORIGIN` with the actual HTTPS origin before rebuilding.

### Optional: ssMusic Server

Use an [ssMusic Server](https://github.com/skystream006/ssMusic_Server) version containing [PR #21](https://github.com/skystream006/ssMusic_Server/pull/21) for search and [the playlist-aware KaraokeParty jobs API](https://github.com/skystream006/ssMusic_Server/commit/06ea037343d9b312f8bd2684ac95b97a404dbf11) for video add/remove actions. Configure `SEARCH_API_KEY` on that server and keep its KaraokeParty ExtServer account approved; provisioning requires an approved administrator. Set these **backend-only** variables in this app's root `.env` for Docker Compose (or `backend/.env` for local development):

```dotenv
SSMUSIC_SERVER_URL=https://music.example.com
SSMUSIC_API_KEY=replace_with_the_server_search_api_key
```

The URL must be reachable from the backend container; `localhost` inside Docker refers to that container, not another server. Restart/rebuild the backend after changing configuration. Flyway applies the queue migrations automatically with Docker Compose, including [V3__Queue_ssmusic_jobs.sql](backend/db/migrations/V3__Queue_ssmusic_jobs.sql) for pending downloads and [V4__Queue_kp_media.sql](backend/db/migrations/V4__Queue_kp_media.sql) for removable playlist references; local installations must also apply new migrations before starting.

For a self-signed certificate or private CA, obtain the **public certificate** from the ssMusic administrator through a trusted channel. Put it in `certs/ssmusic-ca.pem` and set `SSMUSIC_CA_CERT_FILE=/app/certs/ssmusic-ca.pem` in the root `.env`. Compose mounts `certs` read-only. Native Node users should set an absolute local file path instead. Leave this setting unset for certificates already trusted by Node. Never copy the server's private key.

The hostname or IP in `SSMUSIC_SERVER_URL` must also appear in the certificate's Subject Alternative Names. For example, a certificate for `192-168-6-66.sslip.io` does not cover the raw IP `192.168.6.66`; use `https://192-168-6-66.sslip.io:4123/` when that name resolves to your server. Certificate verification stays enabled. Replace the trusted certificate and restart the backend if the server regenerates its self-signed certificate.

In either search panel, check **ssMusic Search** and search normally. **No vocals only** appears beside it and is checked by default; uncheck it to include songs with vocals. This filter requires an ssMusic Server version supporting the `NoVocalsOnly` search parameter. Unchecking **ssMusic Search** hides the filter and restores YouTube search; **Karaoke versions only** is a YouTube-only filter. Use **Load more** for additional library results. Both **Add to queue** and **Play next** support ssMusic songs.

Playlist rows show **Play now / Resume** or **Pause** directly beside the three-dot menu, according to the available controls. The menu contains **Remove** and, for YouTube rows in unlocked parties, **Send to ssMusic**, which registers the video using this party's ID. Multiple rows can be sent independently. Each stays playable on YouTube while downloading, then becomes an ssMusic video marked **kpMedia**, retaining its queue position, singer, and playback status. Ready duplicates switch immediately. Pending jobs survive browser disconnects and resume after backend restarts. Errors remain on the affected row; failed upstream jobs must be rerun on ssMusic before trying again.

Removing a **kpMedia** row releases the party's video reference on ssMusic before deleting the local row. Multiple copies in one party share a reference, which is released only when the last copy is removed. ssMusic decides whether the underlying video can be deleted; other playlists, owners, library memberships, and protected legacy references can keep it. Busy or inaccessible jobs leave the row in place with an error so removal can be retried. Ordinary YouTube rows and ssMusic search results are not marked kpMedia and do not send remove actions upstream.

The search API introduced by PR #21 currently returns **audio files only**. The player also supports video files when supplied by the server. Videos use native browser playback; audio uses the SYLT lyric screen, including in fullscreen. Click a timed lyric line to seek; instrumental cues display as ♪. Plain USLT lyrics are shown when SYLT is absent. ssMusic currently reads embedded lyrics from MP3 files only.

Pause/resume, seek, tempo, volume, guest progress and automatic next-song playback work with both sources. If the browser blocks autoplay, click **Play song**. Media codecs must be supported by the browser; this app does not transcode media or generate missing lyrics.

Search, video add/remove actions, job status, lyric retrieval and streaming are proxied through the backend using `X-API-Key`; the ssMusic key is never sent to the browser. Media URLs use expiring, file-scoped playback tickets instead of the key or login token. Only files accessible to the server's search/playlist key are available; private media remains subject to ssMusic Server's access checks. Use HTTPS when accessing a remote server.

### 3. Open on your phone

Configure a hostname reachable by the host and phones, with a trusted certificate. For direct access through the bundled HTTPS proxy:

```dotenv
DOCKER_BIND_ADDRESS=0.0.0.0
HTTPS_PORT=4124
PASSKEY_RP_ID=party.example.com
PASSKEY_ORIGIN=https://party.example.com:4124
```

Open that exact URL on the host, sign in, join a party as Organizer, and open its QR panel. Guests scan the generated invitation and enter a name; they do not need an account or passkey. Raw IP addresses are not valid passkey RP IDs. The QR uses the host browser's origin, so a `localhost` QR is only useful on that same computer.

The included Nginx reverse proxy terminates TLS, serves the UI, and forwards `/api` and `/socket.io` to the internal backend. Change `DOCKER_BIND_ADDRESS` only when the intended clients/proxy need network access, after enrolling the initial administrator. Allow the selected ports through the host firewall as appropriate; this project does not change firewall or router rules. Do not expose the backend or database ports publicly.

## HTTPS and Reverse Proxy

This follows ssMusic_Server's separate HTTP/HTTPS listeners and persistent-certificate behavior, adapted to the existing Nginx frontend. `PORT` (default 3124) publishes container port 80 for HTTP redirects. `HTTPS_PORT` (default 4124) publishes container port 443 for TLS 1.2/1.3. `PASSKEY_ORIGIN` is the exact browser-facing HTTPS origin and is the fixed redirect target; request `Host` headers cannot redirect visitors to arbitrary hosts. Redirects preserve paths/query strings, and browsers retain invitation URL fragments.

### Certificates

When `HTTPS_CERT_PATH` and `HTTPS_KEY_PATH` are unset, startup generates a unique self-signed certificate and key under `/var/lib/karaoke/tls` in the named `frontend_tls` volume. The private key has mode 0600 and is never placed in the image or source tree. The certificate covers primary/secondary passkey hostnames and loopback. It is reused across container rebuilds/recreation, and regenerated on startup when required hostnames change or fewer than 30 days remain. Restart the frontend periodically so renewal checks run; a regenerated self-signed certificate must be trusted again. Back up this volume along with the database; never use `docker compose down -v` unless intentionally deleting data.

Export only the generated public certificate for inspection/trust:

```powershell
docker compose cp frontend:/var/lib/karaoke/tls/server-cert.pem ./certs/karaoke-https.pem
```

Verify and trust it on your devices using their normal certificate-management tools. A browser warning bypass is not a substitute for trusted TLS and may prevent passkeys. For public access, a CA-issued certificate is recommended. No automatic public ACME issuance is configured.

To use your own full certificate chain and matching unencrypted private key, put them in the separate Git-ignored `tls/` directory (not `certs/`) or set `HTTPS_CERTS_DIR` to an existing certificate directory:

```dotenv
HTTPS_CERTS_DIR=./tls
HTTPS_CERT_PATH=/run/karaoke-tls/fullchain.pem
HTTPS_KEY_PATH=/run/karaoke-tls/privkey.pem
```

Compose mounts that directory read-only in the frontend. Both settings are required, and the certificate must be valid, match the private key, and cover every configured origin hostname. Custom files are never overwritten or replaced with generated files; startup fails if they are invalid. Reload/restart Nginx after renewing them. The separate `certs/` mount continues to hold only public CA certificates for outbound ssMusic connections.

### An External Proxy on Port 443

Keep `PASSKEY_ORIGIN=https://party.example.com` when clients use standard port 443. Configure the external reverse proxy to reach the app's **HTTPS** listener on port 4124, forwarding `/api` and WebSocket upgrades for `/socket.io`. Do not forward it to HTTP port 3124, which now only redirects. Verify the upstream certificate using its hostname and trusted certificate/CA; do not disable certificate verification.

If clients also need direct access on port 4124 with the same passkey hostname:

```dotenv
PASSKEY_RP_ID=party.example.com
PASSKEY_ORIGIN=https://party.example.com
PASSKEY_RP_ID_SECONDARY=party.example.com
PASSKEY_ORIGIN_SECONDARY=https://party.example.com:4124
```

Both exact origins are accepted and use the same RP ID. Different hostnames need separately enrolled passkeys. Alternatively, forward public TCP port 443 to local 4124 without terminating TLS upstream; the bundled Nginx will terminate it. DNS and port forwarding must be configured outside this project.

Nginx forwards the connection's scheme and client address. Compose defaults `TRUST_PROXY=1` for the bundled proxy. If another trusted proxy is in front, configure the appropriate hop count/subnet and restrict network access so clients cannot bypass it; otherwise forwarded-address-based rate limits can be spoofed. Native Node development leaves proxy trust disabled unless explicitly configured.

---

## Development (without Docker)

### Backend

Use Node.js 22 or newer (the Docker images use Node.js 24).

```bash
cd backend
cp .env.example .env   # set DB creds and YOUTUBE_API_KEY
npm install
npm run dev            # nodemon watches for changes
```

The backend runs on **port 5000**.

### Frontend

```bash
cd frontend
npm install
npm start              # runs on port 3000, proxies /api to :5000
```

### Database

Ensure a PostgreSQL server is running locally. Schema migrations are managed by **Flyway**.

When running via Docker Compose, Flyway runs automatically before the backend starts. For local development without Docker, run Flyway manually:

```bash
docker run --rm \
  -v "$(pwd)/backend/db/migrations:/flyway/sql" \
  flyway/flyway:10-alpine \
  -url=jdbc:postgresql://localhost:5432/karaoke_party \
  -user=postgres \
  -password=postgres \
  migrate
```

#### Adding a new migration

Create a new file in `backend/db/migrations/` following the naming convention:

```
V<version>__<description>.sql
```

Examples:
- `V2__Add_played_at_to_queue.sql`
- `V3__Add_party_settings_table.sql`

Flyway applies migrations in version order and tracks which have already run in the `flyway_schema_history` table — each migration is applied exactly once.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Backend port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `karaoke_party` | Database name |
| `DB_USER` | `postgres` | DB username |
| `DB_PASSWORD` | `postgres` | DB password |
| `YOUTUBE_API_KEY` | — | **Required** for YouTube search |
| `SSMUSIC_SERVER_URL` | — | Optional ssMusic Server base URL, reachable from the backend |
| `SSMUSIC_API_KEY` | — | Optional ssMusic Server `SEARCH_API_KEY`; required with `SSMUSIC_SERVER_URL` |
| `SSMUSIC_CA_CERT_FILE` | — | Optional backend path to a trusted CA/self-signed public certificate for ssMusic HTTPS |
| `FRONTEND_URL` | `http://localhost:3000` | Legacy fallback for the passkey origin in native execution |
| `PASSKEY_RP_ID` | Origin hostname | Passkey relying-party hostname; never a raw IP address |
| `PASSKEY_ORIGIN` | `FRONTEND_URL` or `http://localhost:3000` | Exact browser origin, including a non-default port; HTTPS except localhost |
| `PASSKEY_RP_ID_SECONDARY` | Unset | Optional second hostname, configured together with its origin |
| `PASSKEY_ORIGIN_SECONDARY` | Unset | Optional second exact browser origin; both configured origins are allowed by CORS |

For Compose, `PORT` is the HTTP redirect port (3124), `HTTPS_PORT` is the TLS frontend port (4124), and `DOCKER_BIND_ADDRESS` defaults to `127.0.0.1`. The backend's internal port remains 5000. Compose defaults `PASSKEY_ORIGIN` to `https://localhost:${HTTPS_PORT}` and the RP ID to `localhost`. Set the actual browser origin explicitly, including the HTTPS port when it is not 443; a proxy-facing origin can differ from the published port. Native Node development still uses the HTTP backend/CRA setup above.

Docker TLS settings: `HTTPS_CERT_PATH` and `HTTPS_KEY_PATH` select a custom pair inside the frontend; `HTTPS_CERTS_DIR` selects its host directory (default `./tls`). Unset certificate paths enable persistent generated certificates. `TRUST_PROXY` configures trusted backend proxy hops (Compose default 1).

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_API_URL` | `/api` (proxied) | Backend API base URL |
| `REACT_APP_SOCKET_URL` | Page origin | Socket.IO server URL; the same-origin proxy is recommended |

---

## Authentication

### HOSTSCREEN Login

Set `HOST_SCREEN_LOGIN_KEY` to a long random secret in the root `.env` for Docker, or in the backend environment for local development. An empty value disables HOST login. Apply migration `V7__Hostscreen_account.sql` before starting the updated backend; Docker Compose runs it automatically. It creates the dedicated `HOSTSCREEN` system account with API role `hostscreen`, without changing first-passkey administrator registration.

Approved registered users can open **Account Info** from the three-dot menu to reveal or copy the key. On the login screen, choose **Login as HOST** and enter it. HOSTSCREEN can browse active parties and join only as **Organizer**, with playback, queue and invitation controls. It cannot create, rename, lock, unlock, end, delete, duplicate or reactivate parties, administer party members, search songs or members, join as Guest, enroll passkeys, retrieve the key, or manage accounts. Party administration is blocked by the API as well as hidden in the menu. The system account cannot be promoted through account administration.

The key is shared across host screens, so protect it like a password and use HTTPS. It is sent only to authenticated approved passkey users, never embedded in the frontend build or stored in browser storage. Each HOST login receives an independent 24-hour session; sign-out revokes that session and its guest invitations. Changing the environment key and restarting the backend blocks new logins with the old key; existing sessions remain valid until logout or expiry. All screens share the same HOSTSCREEN membership within a party.


Authentication uses SimpleWebAuthn, following the passkey enrollment model in ssMusic_Server. The first verified registration creates the approved administrator atomically. All later registrations are pending until an admin approves them in **Settings > Accounts**. Admins can assign Host (`member`) or Admin roles and revoke access. Account changes revoke that account's sessions and dependent guest access. At least one approved administrator must remain.

**Settings > Passkeys** lists your credentials and allows adding another passkey or removing one while retaining at least one. Private keys stay in your authenticator. PostgreSQL stores public keys, counters, accounts, and SHA-256 session/invitation hashes. WebAuthn challenges require user verification, are single-use, expire after five minutes, and are bound to the configured origin and RP ID. Enrollment of an additional credential is also bound to the signed-in account/session.

Account sessions expire after 24 hours, survive backend restarts, and are stored in browser session storage. Logout revokes the server session. A guest's session is tied to its party, new guest membership, invitation, and host session; its role cannot be upgraded through `/join`. Guests cannot list parties/accounts, manage hosts, create invitations, or read/change another party's queue. Search remains available for adding songs; guest ssMusic playback is restricted to songs in their own queue. HTTP requests, socket room joins/events, and media requests enforce the same scope.

Each QR display creates a new cryptographically random 256-bit invitation, valid for up to 12 hours and never beyond the host session. The secret is in the URL fragment (`/join/invite#invite=...`), not a public join code or URL sent to the server; the browser submits it in a POST body. Replacing that host session's QR revokes its previous invitation and derived guest sessions. Closing the QR panel does not revoke it; reopening generates a replacement. Sign out or end the party to revoke access when finished. Treat the QR/link as a bearer invitation: anyone who receives or photographs it can join that party while it remains valid. It is reusable by multiple guests, each receiving a distinct member/session, not a one-use ticket.

Use HTTPS outside localhost and keep RP hostnames stable. A secondary origin can be configured as a matched origin/RP pair; unrelated hostnames need separately enrolled credentials. Run one backend instance: challenges, rate limits, Socket.IO rooms and media-ticket signing keys are process-local. Expired sessions are denied even if their rows have not yet been pruned. Already downloaded or buffered media cannot be recalled.

### Android App Sign-In

This server implements the browser handoff required by [ssKaraoke Player PR #10](https://github.com/skystream006/ssKaraoke_Player/pull/10). Rebuild both the frontend and backend and apply [V6__App_login_codes.sql](backend/db/migrations/V6__App_login_codes.sql) before using it. `docker compose up --build -d` applies migrations automatically; native installations must run Flyway first. Existing accounts, passkeys and party data are retained.

Configure the phone-reachable HTTPS hostname as `PASSKEY_ORIGIN` with its matching `PASSKEY_RP_ID`. Both Android and its browser must trust the certificate. The frontend must serve `/app-login` and proxy `/api` on that same origin (`REACT_APP_API_URL=/api`); external authentication proxies must allow the native token exchange without requiring browser cookies. App sign-in does not support HTTP, including HTTP localhost, or raw IP RP IDs.

The app opens `/app-login` with its fixed callback, S256 challenge and random state. That page always requires fresh browser WebAuthn, even when the browser is already signed in. Account creation uses the same first-admin and approval rules as the website. Pending accounts stay on the sign-in page until approved and successfully verified; cancelling does not sign out an existing browser session.

After verification, the browser opens `com.sskaraoke.player:/oauth/callback?code=...&state=...` and also offers **Return to app**. Only a two-minute, single-use authorization code appears in that callback, never a session token. Android exchanges the code and its private verifier at `POST /api/auth/app/token` without an `Origin` header or browser cookies. PostgreSQL stores only the code hash, bound to the approved account, callback and challenge. Exchange checks approval again and creates a separate normal 24-hour account session. Account access changes invalidate outstanding codes as well as sessions. See the [backend contract](backend/README.md#android-app-handoff) for request and response details.

Existing `/api/auth/me`, logout, permissions and invitation revocation apply unchanged to app sessions. Account/passkey management opens `/account` independently in the browser and may need a separate login. No Android WebAuthn origin or Digital Asset Links configuration is needed. PKCE prevents an app that intercepts the custom-scheme callback from redeeming the code without the verifier; it does not prove which installed app initiated the request. Start sign-in only from an app you trust. After deployment, verify the return-to-app flow on a real Android device.

### Upgrading from passwords

Apply [V5__Passkeys_and_party_invitations.sql](backend/db/migrations/V5__Passkeys_and_party_invitations.sql) through Flyway before starting the new backend. Compose applies it automatically. Existing parties, members, and queues are retained. Old member names do not establish account ownership; approved hosts join with their new account to create an owned membership. Existing password sessions and six-character QR links are invalid. `API_ADMIN_PW` and `API_MEMBER_PW` are no longer read and can be removed from existing environment files. Complete first-admin enrollment locally, approve other hosts, then generate new QR invitations.

---

## Application Flow

```
Welcome Screen
├── Start a Party → Enter party name + your name → Organizer Page
├── Join a Party  → Approved account joins its own membership
└── Settings      → Passkeys / Accounts (admin) / Parties (admin)

Host QR invitation → Validate invitation → Enter name → Scoped Guest Page
```

### Organizer Page

- YouTube video player (YouTube IFrame API) with fullscreen support and closed captions disabled (lyrics embedded in the video are unchanged), plus native ssMusic audio/video playback with a synchronized lyric screen for audio
- **Previous / Next** song navigation buttons
- Auto-advance to next song when current song ends
- Slide-out sidebar with:
  - **Playlist tab** — drag & drop reorder, play/pause/resume, remove songs; song progress slider; QR code button
  - **Settings tab** — key / tempo / vocal level sliders
- "Now Playing" info bar with song thumbnail and title
- End party / permanently delete party controls

### Guest Page

- **Queue tab** — view current playlist with live progress bar; play/pause controls; seek to any position
- **Search tab** — search YouTube (with karaoke-only toggle), check **ssMusic Search** for the configured media library, or add a song by YouTube URL; add songs to the queue

### Settings / Admin Page

- List all parties (active and inactive)
- Rename parties, reactivate ended parties, permanently delete parties
- View and manage party members — rename, change role (guest ↔ organizer), remove

QR-only members cannot be promoted to organizers; hosting requires an approved passkey account.

## Verification

Run `npm --prefix backend test` and `npm --prefix frontend test -- --watchAll=false --runInBand`, then `npm --prefix frontend run build`. The setup-helper tests use `python -m unittest discover -s tests -v`.

The security integration suite uses real signed WebAuthn responses and PostgreSQL transactions. Point `TEST_DATABASE_URL` at a disposable database whose name ends in `_test`, then run `npm --prefix backend run test:security`. The suite creates and drops only a uniquely named test schema. It covers concurrent first-admin enrollment, pending approval, signature/origin/user-verification failures, passkey management, invitation rotation/expiry, impersonation and cross-party denial, host logout, party end/reactivation, and account revocation. Do not use a production database.

---

## API Reference & Socket.IO Events

See [`backend/README.md`](backend/README.md) for the full API reference and Socket.IO event documentation.

---

## License

MIT
