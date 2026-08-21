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
- **Proxy:** Nginx Proxy Manager (NPM) on existing home server

---

## Project Structure
```
ssv-stoparica/
├── frontend/           # Main stopwatch app (PWA)
├── backend/            # Node.js API + SQLite management
├── esp2/               # Arduino/ESP32 firmware + device provisioning
├── docs/               # Project documentation (GEMINI.md, CHANGES.md)
├── scripts/            # Local dev tools (dev-start.sh, dev-proxy.py)
├── tools/              # Production tools (deploy.sh, gen_esp.py)
├── nginx.conf          # Internal stack proxy config
└── docker-compose.yml  # Production stack definition
```

---

## Deployment & Production

### Standard Deployment
To update the server with the latest changes from GitHub:
```bash
bash tools/deploy.sh
```

### Production Ports
- **Internal Nginx:** 8742 (Target for Nginx Proxy Manager)
- **Internal Backend:** 4827
- **NPM Config:** Ensure NPM points to the Pi's LAN IP (e.g., `192.168.1.136:8742`), not `localhost`.

### Environment
A `.env` file must exist in the root folder on the server:
```text
JWT_SECRET=your_long_random_secret
```

---

## Development Phases
(Phase details preserved from previous version...)

