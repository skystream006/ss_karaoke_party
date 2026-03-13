# Backend API Reference

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
