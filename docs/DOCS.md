# SSV Stoparica — Technical Documentation

## Overview

SSV Stoparica is a Progressive Web App (PWA) used by SSV (spajanje sesalnega voda) firefighter competition trainers to precisely time runs. A phone running the app replaces the traditional hardware display/speaker combination.

**Key design decisions:**
- Vanilla JS, no framework — runs offline, installable as PWA
- ESP2 wireless stop button communicates over BLE (Web Bluetooth API)
- Backend is optional — guests store results locally, logged-in users sync to SQLite
- Audio gate — timer only starts once the GZS start sound fully plays

---

## Architecture

```
[ESP2 WROOM-32U + antenna]
        │
        │  BLE notify (0x01)
        ▼
[PWA on Android phone]  ←→  [Node.js + Express API]
                                      │
                                  [SQLite DB]
                                      │
                              [Docker Compose]
                                      │
                         [Nginx Proxy Manager / nginx]
```

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS, PWA (manifest + service worker) |
| Backend | Node.js 20 + Express 4 |
| Database | SQLite via `better-sqlite3` (sync API) |
| Auth | JWT (7-day expiry) + bcrypt (12 rounds) |
| Container | Docker Compose — nginx:alpine + node:20-alpine |
| Reverse proxy | Nginx Proxy Manager on home server |

---

## Frontend Pages

### `index.html` — Main Stopwatch

The core app. All timer controls, BLE connection, settings, and auth are here.

**Timer display:**
- Format: `MM:SS.cc` where `cc` = centiseconds
- Idle: white, Running: accent yellow (`#d4ff00`), Stopped: red (`#ff4040`)
- Uses `requestAnimationFrame` for smooth display

**State machine:**

```
IDLE → (START pressed / BLE countdown ends) → RUNNING → (STOP pressed / BLE 0x01) → STOPPED → (RESET) → IDLE
```

**Audio gate:**  
On START, the discipline-appropriate GZS countdown sound plays. The timer clock only starts ticking after `audio.ended` fires — this guarantees accurate timing from the true start signal.

**Disciplines:**
- `zimska` — winter discipline (default)
- `letna` — summer discipline
Each has its own GZS audio sequence.

**Guest vs logged-in:**
- Guest: results stored in `sessionStorage` only — lost on tab close
- Logged in: results POST to `/api/runs`, devices saved to DB

### `history.html` — Run History

Three-column desktop layout (filters | run list | stats), mobile tabs with overlay.

**Columns:**
- Left: filter controls (period, discipline, team, sort)
- Middle: grouped run list by team/discipline, each entry shows time + badge (PR/delta)
- Right: KPIs (PR, average, count) + interactive SVG chart

**Resizable columns** — drag the resizer handles between columns; cursor becomes `col-resize` on hover.

**Filter state** is saved to `sessionStorage` key `ssv_hv_filters` and restored on load — shared with `stats.html` so filters survive page navigation.

**Mobile:** Tab bar at bottom — Filtri (opens left overlay), Vaje (run list), Stats (opens `stats.html`).

### `stats.html` — Stats Page (Mobile)

Full-page stats view for mobile. Same KPIs and chart as the desktop right column of `history.html`. Shares the same `history.js` script — run list rendering is skipped because `#hvRuns` doesn't exist on this page.

### `style.css` — All Styles

Single CSS file for the whole app. Key CSS custom properties in `:root`:

```css
--acc: #d4ff00;      /* accent yellow */
--bg: #080808;       /* dark background */
--text: #e8e8e8;     /* primary text */
--muted: #666;       /* secondary text */
--border: #222;      /* borders */
--danger: #ff4040;   /* destructive actions */
--s1: #111;          /* surface 1 */
--s2: #161616;       /* surface 2 */
```

Light mode overrides these via `.light-mode` on `<body>`.

---

## Backend API

Base path: `/api`

All protected routes require `Authorization: Bearer <token>` header.

### Auth

| Method | Endpoint | Auth | Body / Query | Response |
|--------|----------|------|-------------|----------|
| `POST` | `/auth/register` | — | `{ ime, email, geslo }` | `{ token, ime }` |
| `POST` | `/auth/login` | — | `{ login, geslo }` | `{ token, ime }` |
| `PUT` | `/auth/profile` | JWT | `{ ime }` | `{ token, ime }` (new token with updated name) |
| `PUT` | `/auth/password` | JWT | `{ trenutno, novo }` | `{ ok: true }` |
| `DELETE` | `/auth/account` | JWT | — | `{ ok: true }` — deletes all user data |

Login accepts either `email` or `ime` in the `login` field.

### Runs

| Method | Endpoint | Auth | Body / Query | Response |
|--------|----------|------|-------------|----------|
| `GET` | `/runs` | JWT | `?filter=dan\|teden\|mesec\|leto&disciplina=&ekipa=` | Array of run objects |
| `POST` | `/runs` | JWT | `{ ekipa, disciplina, cas_s }` | Created run object |
| `GET` | `/runs/pr` | JWT | — | Best run object (lowest `cas_s`) |
| `GET` | `/runs/export` | JWT | — | CSV download |

**Run object:**
```json
{
  "id": 42,
  "user_id": 1,
  "ekipa": "Člani-A",
  "disciplina": "zimska",
  "cas_s": 47.83,
  "datum": "2026-04-01T18:32:00"
}
```

`cas_s` is stored as `REAL` (seconds with up to 3 decimal places, actual precision is centiseconds = 2 decimal places).

### Devices

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| `POST` | `/devices` | JWT | `{ uuid, friendly_name }` | Created device object |
| `GET` | `/devices` | JWT | — | Array of device objects |
| `DELETE` | `/devices/:id` | JWT | — | `204 No Content` |

---

## Database Schema

```sql
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ime         TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  geslo_hash  TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  ekipa       VARCHAR(50),
  disciplina  TEXT CHECK(disciplina IN ('zimska', 'letna')),
  cas_s       REAL NOT NULL,              -- seconds, e.g. 47.83
  datum       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  uuid          TEXT NOT NULL,
  friendly_name TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

SQLite runs in WAL mode (`journal_mode = WAL`) for better concurrent read performance.

Schema migrations run idempotently on every backend startup via `CREATE TABLE IF NOT EXISTS`.

---

## BLE Protocol

### Device Naming

Devices are named `SSV-STOP-[ID]`, e.g. `SSV-STOP-A`, `SSV-STOP-B`. Multiple devices are supported — each has unique UUIDs burned in at flash time.

### UUIDs

Each physical device gets its own `SERVICE_UUID` and `CHARACTERISTIC_UUID` (128-bit UUIDs). These are set as `#define` constants in the Arduino firmware before flashing. The phone pairs to a specific device by scanning for its service UUID.

### Stop Signal

The characteristic sends a single-byte notify: `0x01`.

The firmware uses **edge detection** (HIGH→LOW transition) so exactly one notification is sent per button press, regardless of how long it is held:

```cpp
bool btn = digitalRead(BTN_PIN);
if (btn == LOW && lastBtn == HIGH && deviceConnected) {
  uint8_t val = 0x01;
  pCharacteristic->setValue(&val, 1);
  pCharacteristic->notify();
  delay(50);  // debounce
}
lastBtn = btn;
delay(10);  // ~100Hz polling loop
```

### Additional BLE Services (planned)

- Battery level: standard Battery Service UUID `0x180F`
- RSSI: read on the phone side via Web Bluetooth API

### Phone-side BLE (Web Bluetooth)

Connection status dots:
- Scanning: blue pulsing
- Connected: green breathing
- Lost/error: red

Auto-reconnect: on `gattserverdisconnected`, the app retries every 2 seconds until reconnected.

### QR Code Flow

```
URL: https://ssv.slogiker.si/?device=SERVICE-UUID

Guest:      UUID → sessionStorage → auto-scan
Logged in:  UUID → DB (devices table) → auto-connect on next open
```

---

## ESP2 Firmware

**Target hardware:** ESP32 WROOM-32U with external antenna (for maximum range).

**File:** `esp2/esp2_stop/esp2_stop.ino`

**Before flashing each device:**
1. Replace `SERVICE_UUID` and `CHARACTERISTIC_UUID` with freshly generated UUIDs (use [uuidgenerator.net](https://www.uuidgenerator.net/) or similar)
2. Set `DEVICE_NAME` to `SSV-STOP-A`, `SSV-STOP-B`, etc.
3. Set `BTN_PIN` to the correct GPIO for your hardware

**Dependencies (Arduino Library Manager):**
- ESP32 Arduino core (Espressif)
- Built-in: `BLEDevice`, `BLEServer`, `BLEUtils`, `BLE2902`

---

## Docker Setup

### Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Orchestrates nginx + backend, SQLite volume |
| `nginx.conf` | Static file serving + `/api/` proxy to backend |
| `backend/Dockerfile` | node:20-alpine, installs production deps only |
| `backend/.dockerignore` | Excludes `node_modules`, `.env`, `data/` from image |
| `.env.example` | Template for required environment variables |

### Ports

| Host port | Container | Description |
|-----------|-----------|-------------|
| `8742` | `80` (nginx) | HTTP — the app |

SSL is terminated externally by **Nginx Proxy Manager** on the host. NPM proxies to `localhost:8742`.

### Data Persistence

SQLite database is stored in a named Docker volume `sqlite_data`, mounted at `/app/data/` inside the backend container. Data survives container rebuilds.

### Commands

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f

# Rebuild after code changes
docker compose up -d --build

# Stop
docker compose down

# Wipe database (nuclear)
docker compose down -v
```

---

## Development Setup

```bash
# Install backend deps
cd backend && npm install

# Seed dev database with test data
node seed.js

# Start everything (backend + dev proxy + Chrome)
cd .. && ./dev-start.sh
```

**`dev-start.sh`** starts:
- Backend on `:4827`
- Python dev proxy on `:8080` (routes `/api/` → `:4827`, serves frontend static files)
- Chrome with a fresh throwaway profile (no cache, no service worker state)

Dev account: `test / test`

---

## PWA — Offline & Installability

- `manifest.json` — enables "Add to Home Screen" on Android/iOS
- `sw.js` — service worker (caches static assets for offline use)
- GZS audio files are embedded as base64 in `app.js` — no external fetch needed, works offline

---

## Security Notes

- Passwords hashed with **bcrypt** (12 rounds) — never SHA256
- JWTs expire after 7 days
- All API input validated server-side before hitting the DB
- SQLite uses parameterized queries throughout — no string interpolation
- `.env` is gitignored — never commit secrets
