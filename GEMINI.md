# GEMINI.md — SSV Stoparica

## Project Overview
PWA stopwatch for Slovenian firefighter SSV (spajanje sesalnega voda) competitions.
Phone (trainer) replaces ESP1 display/speaker setup. ESP2 (strojnik/c2) sends BLE stop signal.

**Repo:** github.com/slogiker/ssv-stoparica  
**Dev:** Daniel Pliberšek

---

## Architecture

```
[ESP2 WROOM-32U + antena] --BLE notify(0x01)--> [PWA on phone]
                                                      |
                                              [Node.js backend]
                                                      |
                                                  [SQLite DB]
                                              [Docker Compose]
```

### Stack
- **Frontend:** Vanilla HTML/CSS/JS (multi-file PWA, no framework)
- **Backend:** Node.js + Express
- **Database:** SQLite (better-sqlite3)
- **Auth:** JWT + bcrypt (12 rounds)
- **Container:** Docker Compose (nginx + backend + sqlite volume)
- **Proxy:** Nginx Proxy Manager on existing home server

---

## Project Structure
```
ssv-stoparica/
├── frontend/
│   ├── index.html          # Main stopwatch app
│   ├── history.html        # Run history with filters + stats
│   ├── stats.html          # Stats page (mobile)
│   ├── app.js              # Main app logic (BLE, timer, auth)
│   ├── history.js          # History + filter + chart logic
│   ├── style.css           # All styles
│   ├── sounds.js           # Base64 embedded GZS sounds
│   ├── error-guard.js      # Global error handling + watchdog
│   └── sw.js               # Service Worker
├── backend/
│   ├── index.js
│   ├── db.js               # SQLite setup + migrations
│   ├── middleware.js       # Auth middleware
│   ├── routes/
│   │   ├── auth.js
│   │   ├── runs.js
│   │   └── devices.js
│   └── package.json
├── esp2/
│   └── esp2_stop/
│       └── esp2_stop.ino   # Arduino firmware for WROOM-32U
├── scripts/                # Dev tooling (proxy, startup)
├── tools/                  # Utilities (deploy, test)
├── nginx.conf
├── docker-compose.yml
└── GEMINI.md
```

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

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | — | ime, email, geslo → JWT |
| POST | /api/auth/login | — | (ime\|email) + geslo → JWT |
| GET | /api/runs | JWT | ?filter=dan\|teden\|mesec\|leto &disciplina= &ekipa= |
| POST | /api/runs | JWT | { ekipa, disciplina, cas_s } |
| GET | /api/runs/pr | JWT | lowest cas_s |
| GET | /api/runs/export | JWT | CSV download |
| POST | /api/devices | JWT | { uuid, friendly_name } |
| GET | /api/devices | JWT | list saved devices |
| DELETE | /api/devices/:id | JWT | forget device |

---

## BLE Protocol

- **Device name format:** `SSV-STOP-[ID]` e.g. `SSV-STOP-A`
- **Service UUID:** unique per device, hardcoded in firmware before flashing
- **Characteristic UUID:** unique per device
- **Stop signal:** single byte `0x01` via BLE notify
- **Edge detection in firmware:** HIGH→LOW transition only = exactly 1 signal per press

### QR Code Flow
```
URL: https://ssv.slogiker.si/?device=SERVICE-UUID&char=CHARACTERISTIC-UUID

Guest:      UUID → sessionStorage → auto-scan
Logged in:  UUID → DB (devices table) → auto-connect on next open
```

---

## Frontend — Key Behaviors

### Timer display
- Format: `MM:SS.cc` where `cc` = centiseconds
- Colors: idle=white, running=accent yellow (#d4ff00), stopped=red (#ff4040)
- Uses `requestAnimationFrame` for smooth updates

### BLE
- Status dot: scanning=blue pulsing, connected=green breathing, lost=red
- Auto-reconnect loop on disconnect (retry with exponential backoff)
- Manual stop button always visible (iOS fallback)

### Audio
- GZS start sound files embedded as base64 in `sounds.js`
- Zimska: "Enoti pripravita se, pozor, zdaj"
- Letna: equivalent GZS audio for summer discipline
- Fallback: Web Audio API synthetic beep if files not available
- Volume controlled by slider in settings

### User session
- **Guest:** runs stored in sessionStorage only (lost on tab close)
- **Logged in:** runs POST to backend, offline queue for synchronization

---

## Development Phases

### Phase 1 — MVP (mostly complete)
- [x] ESP2 Arduino firmware (BLE peripheral, edge detection)
- [x] PWA: BLE connect, auto-reconnect, status dot, RSSI display
- [x] PWA: GZS sounds base64 embedded in separate file
- [x] PWA: Haptic feedback (Android)
- [x] PWA: Wake Lock while running
- [x] PWA: Manual stop button (iOS fallback)
- [ ] ESP2: Battery level service implementation (firmware + frontend)

### Phase 2 — Backend (complete)
- [x] Node.js + Express + SQLite setup
- [x] Auth routes (bcrypt + JWT)
- [x] Runs + devices routes
- [x] PWA login/register screen
- [x] Guest vs logged-in flow
- [x] Docker Compose + deploy

### Phase 3 — Polish (mostly complete)
- [x] PWA manifest + service worker (installable, offline)
- [x] Landscape mode
- [x] History screen (filters, run list with PR/delta badges)
- [x] Stats screen (mobile-friendly KPIs + charts)
- [x] Dark/light mode
- [x] Settings panel complete
- [ ] QR code generation per device UUID (script exists, UI pending)

---

## Coding Rules

- **No frameworks** on frontend — vanilla JS only
- **Split PWA files** (HTML, CSS, JS) for maintainability
- **bcrypt** (12 rounds) for passwords
- **JWT** for auth, 7-day expiry
- **better-sqlite3** for SQLite
- Errors shown in **Slovenian** in UI, not raw JS errors
- All user-facing text in **Slovenian**
- Comments in **English**
- Use **safeStorage** wrapper for localStorage/sessionStorage

---

## Context from Planning

This project was planned in detail via Claude conversation. Key decisions made:
- PWA over Flutter (Android primary, iOS manual stop fallback)
- WROOM-32U over C3 Mini (external antenna = range)
- bcrypt over SHA256 (password security)
- base64 audio over URL fetch (offline, no CORS)
- sessionStorage for guests, DB for logged-in users
- UUID in QR URL parameter, auto-connect flow
- Unique device naming (SSV-STOP-A/B) for multi-device support
- No DSQ/weather/notes fields in runs table (kept clean)
- `ekipa` as VARCHAR on runs table, set globally in settings
