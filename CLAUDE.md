# CLAUDE.md — SSV Stoparica

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
- **Frontend:** Vanilla HTML/CSS/JS — single file PWA, no framework
- **Backend:** Node.js + Express
- **Database:** SQLite (better-sqlite3)
- **Auth:** JWT + bcrypt (NOT sha256)
- **Container:** Docker Compose (nginx + backend + sqlite volume)
- **Proxy:** Nginx Proxy Manager on existing home server

---

## Project Structure
```
ssv-stoparica/
├── frontend/
│   └── index.html          # entire PWA — single file
├── backend/
│   ├── index.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── runs.js
│   │   └── devices.js
│   ├── db.js               # SQLite setup + migrations
│   └── package.json
├── esp2/
│   └── esp2_stop/
│       └── esp2_stop.ino   # Arduino firmware for WROOM-32U
├── nginx.conf
├── docker-compose.yml
└── CLAUDE.md
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
  cas_ms      INTEGER NOT NULL,
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
| POST | /api/runs | JWT | { ekipa, disciplina, cas_ms } |
| GET | /api/runs/pr | JWT | lowest cas_ms |
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
URL: https://yourdomain.com/?device=SERVICE-UUID

Guest:      UUID → sessionStorage → auto-scan
Logged in:  UUID → DB (devices table) → auto-connect on next open
```

---

## Frontend — Key Behaviors

### Timer display
- Format: `SS:MM` where MM = centiseconds (not milliseconds)
- Colors: idle=white, running=accent yellow (#d4ff00), stopped=red (#ff4040)
- Uses `requestAnimationFrame` for smooth updates

### BLE
- Status dot: scanning=blue pulsing, connected=green breathing, lost=red
- Auto-reconnect loop on disconnect (retry every 2s)
- Manual stop button always visible (iOS fallback, no Web BT on iOS Safari)

### Audio
- GZS start sound files embedded as base64 in HTML (offline, no CORS)
- Zimska: "Enoti pripravita se, pozor, zdaj"
- Letna: equivalent GZS audio for summer discipline
- Fallback: Web Audio API synthetic beep if files not yet embedded
- Volume controlled by slider in settings

### User session
- **Guest:** runs stored in sessionStorage only (lost on tab close)
- **Logged in:** runs POST to backend, devices saved to DB

### Landscape mode
- On phone rotate → show ONLY timer + small stop button
- Wake Lock active while timer running
- Auto-detect via `matchMedia('(orientation:landscape)')`

### Settings panel
- Dark/Light mode (system default + manual override)
- Disciplina: Zimska/Letna (determines which audio plays)
- Ekipa: free text varchar, appended to every run
- Haptic feedback: toggle + intensity slider (3 levels)
- Volume slider
- BLE device info + "Pozabi napravo" button
- GitHub repo link at bottom (always visible)

---

## ESP2 Firmware Notes (Arduino / WROOM-32U)

```cpp
// Edge detection pattern — DO NOT change to level detection
bool btn = digitalRead(BTN_PIN);
if (btn == LOW && lastBtn == HIGH && deviceConnected) {
    // send 0x01 notify
    delay(50); // debounce
}
lastBtn = btn;
delay(10); // ~100Hz loop
```

Additional BLE characteristics to implement:
- Battery level: standard BLE Battery Service UUID `0x180F`
- Signal strength (RSSI): read on phone side, not ESP

---

## Docker

```yaml
# docker-compose.yml
services:
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
  backend:
    build: ./backend
    environment:
      - JWT_SECRET=${JWT_SECRET}
    volumes:
      - sqlite_data:/app/data
volumes:
  sqlite_data:
```

Nginx routes: `/` → frontend static, `/api/` → backend:3000

---

## Development Phases

### Phase 1 — MVP (current focus)
- [ ] ESP2 Arduino firmware (BLE peripheral, edge detection, battery level)
- [ ] PWA: BLE connect, auto-reconnect, status dot, RSSI + battery display
- [ ] PWA: GZS sounds base64 embedded
- [ ] PWA: Haptic feedback (Android)
- [ ] PWA: Wake Lock while running
- [ ] PWA: Manual stop button (iOS fallback)

### Phase 2 — Backend
- [ ] Node.js + Express + SQLite setup
- [ ] Auth routes (bcrypt + JWT)
- [ ] Runs + devices routes
- [ ] PWA login/register screen
- [ ] Guest vs logged-in flow
- [ ] Docker Compose + deploy

### Phase 3 — Polish
- [ ] PWA manifest + service worker (installable, offline)
- [ ] Landscape mode
- [ ] History screen (filters, run list with #ID counter)
- [ ] Three-dot menu (average, PR, graph, CSV export)
- [ ] PR badge + animation
- [ ] Dark/light mode
- [ ] Settings panel complete
- [ ] QR code generation per device UUID

---

## Coding Rules

- **No frameworks** on frontend — vanilla JS only
- **Single HTML file** for entire PWA (inline CSS + JS)
- **bcrypt** for passwords, never SHA256
- **JWT** for auth, 7-day expiry
- **better-sqlite3** for SQLite (sync API, simpler than async)
- Errors shown in **Slovenian** in UI, not raw JS errors
- All user-facing text in **Slovenian**
- Comments in **English**

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
