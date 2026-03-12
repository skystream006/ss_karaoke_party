# Karaoke Party 🎤

A web-based, self-hosted karaoke queue system. Users can search for songs on YouTube, queue them up, and sing together — all from their phone's browser.

## Features

- 🎉 **Create a Party** — Organizer starts a named session and receives a QR code / join link for guests
- 🎵 **Join a Party** — Guests join via QR code, join code, or browsing active parties; can join as Guest or Organizer
- 📋 **Party Queue** — Real-time playlist visible to all participants
- 🔍 **YouTube Search** — Guests search for songs (karaoke versions) and add them to the queue
- 🎛️ **Customization** — Organizer can adjust key, tempo, and vocal level
- 🖱️ **Drag & Drop Reordering** — Organizer can rearrange the playlist
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
└── Join a Party  → Browse parties / enter code → Enter name → Guest Page
                                                          └── (Scan QR) ──────────────────────┘
```

### Organizer Page

- Video player (YouTube IFrame API)
- Slide-out sidebar with:
  - **Playlist tab** — drag & drop reorder, play, remove songs; QR code button
  - **Settings tab** — key / tempo / vocal level sliders
- "Now Playing" info bar
- Auto-advance to next song when current song ends

### Guest Page

- **Queue tab** — view current playlist (read-only)
- **Search tab** — search YouTube and add songs to the queue

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/parties` | List active parties |
| `POST` | `/api/parties` | Create a party |
| `GET` | `/api/parties/:id` | Get party details |
| `GET` | `/api/parties/join/:code` | Look up party by join code |
| `POST` | `/api/parties/:id/join` | Join a party |
| `DELETE` | `/api/parties/:id` | End a party |
| `GET` | `/api/queue/:partyId` | Get party queue |
| `POST` | `/api/queue/:partyId` | Add song to queue |
| `DELETE` | `/api/queue/:partyId/:itemId` | Remove song from queue |
| `PUT` | `/api/queue/:partyId/reorder` | Reorder queue |
| `PATCH` | `/api/queue/:partyId/:itemId/status` | Update song status |
| `GET` | `/api/youtube/search?q=` | Search YouTube |

---

## License

MIT
