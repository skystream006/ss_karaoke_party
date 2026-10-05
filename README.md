# Karaoke Party 🎤

A web-based, self-hosted karaoke queue system. Users can search for songs on YouTube, queue them up, and sing together — all from their phone's browser.

## Features

- 🎉 **Create a Party** — Organizer starts a named session and receives a QR code / join link for guests
- 🎵 **Join a Party** — Guests join via QR code, join code, or browsing active parties; can join as Guest or Organizer
- 👋 **Returning Member Quick-Join** — Join page shows current party members to click and rejoin instantly; name field autocompletes from past parties
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
- 🔐 **Password Protection** — Two-tier access control (member / admin); QR-code join links auto-grant member access without a password prompt
- **Default Username** — After password login, select an existing party-member name from autocomplete or enter a new one. The choice is remembered in this browser and prefills the editable name fields when joining or creating parties. New names become available to other users after joining or creating a party; QR-code access does not require this selection step.
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
API_ADMIN_PW=choose_a_strong_admin_password
API_MEMBER_PW=choose_a_member_password
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

- Frontend: http://localhost:3000
- Backend API: http://localhost:6000

### Optional: ssMusic Server

Use an [ssMusic Server](https://github.com/skystream006/ssMusic_Server) version containing [PR #21](https://github.com/skystream006/ssMusic_Server/pull/21). Configure `SEARCH_API_KEY` on that server, then set these **backend-only** variables in this app's root `.env` for Docker Compose (or `backend/.env` for local development):

```dotenv
SSMUSIC_SERVER_URL=https://music.example.com
SSMUSIC_API_KEY=replace_with_the_server_search_api_key
```

The URL must be reachable from the backend container; `localhost` inside Docker refers to that container, not another server. Restart/rebuild the backend after changing configuration. Flyway applies the queue media-source migration automatically with Docker Compose; local installations must also apply new migrations before starting.

For a self-signed certificate or private CA, obtain the **public certificate** from the ssMusic administrator through a trusted channel. Put it in `certs/ssmusic-ca.pem` and set `SSMUSIC_CA_CERT_FILE=/app/certs/ssmusic-ca.pem` in the root `.env`. Compose mounts `certs` read-only. Native Node users should set an absolute local file path instead. Leave this setting unset for certificates already trusted by Node. Never copy the server's private key.

The hostname or IP in `SSMUSIC_SERVER_URL` must also appear in the certificate's Subject Alternative Names. For example, a certificate for `192-168-6-66.sslip.io` does not cover the raw IP `192.168.6.66`; use `https://192-168-6-66.sslip.io:4123/` when that name resolves to your server. Certificate verification stays enabled. Replace the trusted certificate and restart the backend if the server regenerates its self-signed certificate.

In either search panel, check **ssMusic Search** and search normally. Unchecking it restores YouTube search; **Karaoke versions only** is a YouTube-only filter. Use **Load more** for additional library results. Both **Add to queue** and **Play next** support ssMusic songs.

The search API introduced by PR #21 currently returns **audio files only**. The player also supports video files when supplied by the server. Videos use native browser playback; audio uses the SYLT lyric screen, including in fullscreen. Click a timed lyric line to seek; instrumental cues display as ♪. Plain USLT lyrics are shown when SYLT is absent. ssMusic currently reads embedded lyrics from MP3 files only.

Pause/resume, seek, tempo, volume, guest progress and automatic next-song playback work with both sources. If the browser blocks autoplay, click **Play song**. Media codecs must be supported by the browser; this app does not transcode media or generate missing lyrics.

Search, lyric retrieval and streaming are proxied through the backend using `X-API-Key`; the ssMusic key is never sent to the browser. Media URLs use expiring, file-scoped playback tickets instead of the key or login token. Only files accessible to the server's read-only search key are available; private media remains subject to ssMusic Server's access checks. Use HTTPS when accessing a remote server.

### 3. Open on your phone

Make sure your phone and the host machine are on the same network, then browse to:

```
http://<your-machine-ip>:3000
```

---

## Development (without Docker)

### Backend

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
| `FRONTEND_URL` | `http://localhost:3000` | CORS allowed origin |
| `API_ADMIN_PW` | — | **Required** password for admin access (settings page, management APIs) |
| `API_MEMBER_PW` | — | **Required** password for member access (join, guest, organizer pages) |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_API_URL` | `/api` (proxied) | Backend API base URL |
| `REACT_APP_SOCKET_URL` | auto-detected | Socket.IO server URL |

---

## Authentication

The app uses a simple password-based session system. Two password tiers are configured via environment variables:

| Level | Env var | Access |
|-------|---------|--------|
| **member** | `API_MEMBER_PW` | Join parties, use guest and organizer pages, and their APIs |
| **admin** | `API_ADMIN_PW` | Everything above **plus** the settings page and all party/member management APIs |

On first visit the app prompts for a password. A session token (valid for 24 hours) is issued and sent with every subsequent API request as a `Bearer` token. QR-code join links automatically obtain a member-level session without a password prompt.

---

## Application Flow

```
Welcome Screen
├── Start a Party → Enter party name + your name → Organizer Page
├── Join a Party  → Browse parties / enter code → Enter name → Guest Page
│                                                       └── (Scan QR) ──────┘
└── Settings      → Admin panel (manage parties & members)
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

---

## API Reference & Socket.IO Events

See [`backend/README.md`](backend/README.md) for the full API reference and Socket.IO event documentation.

---

## License

MIT
