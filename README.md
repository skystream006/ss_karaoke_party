# Karaoke Party 🎤

A web-based, self-hosted karaoke queue system. Users can search for songs on YouTube, queue them up, and sing together — all from their phone's browser.

## Features

- 🎉 **Create a Party** — Organizer starts a named session and receives a QR code / join link for guests
- 🎵 **Join a Party** — Browse active parties, enter a join code, or scan a QR code; choose a Guest or Organizer role; name autocomplete suggests previous participants
- 📋 **Party Queue** — Real-time playlist visible to all participants with full song-status lifecycle (`queued → playing ↔ paused → played`)
- 🔍 **YouTube Search** — Search for songs with an optional **karaoke-only** filter, or add a song by pasting a YouTube URL directly
- ⏯️ **Playback Controls** — Play, pause, resume, skip to next or go back to previous song; guests can also control playback from their device
- 🖥️ **Fullscreen Playback** — Organizer can enter fullscreen mode with auto-hiding controls and previous/next navigation overlaid on the video
- 📊 **Song Progress** — Real-time progress bar shared between the organizer player and all guests; guests can seek to any position
- 🔄 **Queue Reset** — One-click reset returns all non-playing songs back to "queued"
- 🎛️ **Customization** — Organizer can adjust key, tempo, and vocal level in real time
- 🖱️ **Drag & Drop Reordering** — Organizer can rearrange the playlist; played songs are locked in place
- 👥 **Member Management** — View, rename, change the role of, or remove any party member; secondary organizers are supported
- 🔁 **Party Reactivation** — Ended parties can be reactivated without losing the member list or queue history
- 🎨 **Themes** — 7 colour themes selectable across the app (Classic, Neon Purple, Ocean, Forest, Sunset, Midnight Gold, Dark); preference saved locally
- ⚙️ **Admin / Settings Panel** — Dedicated settings page to manage all parties and their members; supports permanent party deletion
- 📱 **Mobile-first** — Designed to be used on phones
- ⚡ **Real-time Updates** — Queue updates pushed to all connected clients via Socket.IO

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
```

### 2. Start with Docker Compose

```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

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

Ensure a PostgreSQL server is running locally. The backend will automatically run `db/init.sql` on startup to create the required tables.

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
| `YOUTUBE_API_KEY` | — | **Required** for song search |
| `FRONTEND_URL` | `http://localhost:3000` | CORS allowed origin |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_API_URL` | `/api` (proxied) | Backend API base URL |
| `REACT_APP_SOCKET_URL` | auto-detected | Socket.IO server URL |

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

- YouTube video player (YouTube IFrame API) with fullscreen support
- **Previous / Next** song navigation buttons
- Auto-advance to next song when current song ends
- Slide-out sidebar with:
  - **Playlist tab** — drag & drop reorder, play/pause/resume, remove songs; song progress slider; QR code button
  - **Settings tab** — key / tempo / vocal level sliders
- "Now Playing" info bar with song thumbnail and title
- End party / permanently delete party controls

### Guest Page

- **Queue tab** — view current playlist with live progress bar; play/pause controls; seek to any position
- **Search tab** — search YouTube (with karaoke-only toggle) or add a song by YouTube URL; add songs to the queue

### Settings / Admin Page

- List all parties (active and inactive)
- Rename parties, reactivate ended parties, permanently delete parties
- View and manage party members — rename, change role (guest ↔ organizer), remove

---

## API Reference

### Parties

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/parties` | List active parties |
| `GET` | `/api/parties/all` | List all parties (active + ended) |
| `POST` | `/api/parties` | Create a party |
| `GET` | `/api/parties/:id` | Get party details |
| `GET` | `/api/parties/join/:code` | Look up party by join code |
| `POST` | `/api/parties/:id/join` | Join a party |
| `PATCH` | `/api/parties/:id` | Update party name |
| `PATCH` | `/api/parties/:id/reactivate` | Reactivate an ended party |
| `DELETE` | `/api/parties/:id` | End a party (marks inactive) |
| `DELETE` | `/api/parties/:id/remove` | Permanently delete a party and all its data |
| `GET` | `/api/parties/:id/members` | List party members |
| `PATCH` | `/api/parties/:id/members/:memberId` | Update member name / role |
| `DELETE` | `/api/parties/:id/members/:memberId` | Remove a member from the party |

### Queue

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/queue/:partyId` | Get party queue |
| `POST` | `/api/queue/:partyId` | Add song to queue |
| `DELETE` | `/api/queue/:partyId/:itemId` | Remove song from queue |
| `PUT` | `/api/queue/:partyId/reorder` | Reorder queue |
| `PATCH` | `/api/queue/:partyId/:itemId/status` | Update song status (`queued` / `playing` / `paused` / `played`) |
| `PATCH` | `/api/queue/:partyId/reset` | Reset all non-playing songs to `queued` |

### YouTube

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/youtube/search?q=` | Search YouTube (add `&karaoke=true` to filter karaoke versions) |
| `GET` | `/api/youtube/video?url=` | Fetch video metadata by YouTube URL |

### Utility

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/server-info` | Get server's local IP address |

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

---

## License

MIT
