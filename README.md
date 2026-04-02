# SSV Stoparica

PWA stopwatch for Slovenian firefighter **SSV** (spajanje sesalnega voda) competitions.

A phone running this app replaces the traditional ESP1 display/speaker setup. A wireless stop button (ESP2) sends a BLE signal when the team finishes.

---

## Quick Start (Docker)

**Requirements:** Docker + Docker Compose, a `.env` file.

```bash
cp .env.example .env
# Edit .env — set a strong JWT_SECRET
nano .env

docker compose up -d
```

App is now available at **http://localhost:8742**

---

## Development

```bash
cd backend && npm install
cd .. && ./scripts/dev-start.sh
```

Runs backend on `:4827`, dev proxy on `:8080`, and opens Chrome with a fresh profile (no cache).

Default test account: `test / test`

---

## Project Structure

```
ssv-stoparica/
├── frontend/           # Vanilla JS PWA (no framework)
│   ├── index.html      # Main stopwatch app
│   ├── history.html    # Run history with filters + stats
│   ├── stats.html      # Stats page (mobile)
│   ├── app.js          # Main app logic (BLE, timer, auth)
│   ├── history.js      # History + filter + chart logic
│   └── style.css       # All styles
├── backend/            # Node.js + Express API
│   ├── index.js        # Entry point
│   ├── db.js           # SQLite setup + schema migrations
│   ├── middleware.js    # JWT auth middleware
│   ├── routes/
│   │   ├── auth.js     # Register, login, profile, password, delete
│   │   ├── runs.js     # CRUD for timing results
│   │   └── devices.js  # BLE device registry
│   └── seed.js         # Dev DB seeder
├── esp2/               # Arduino firmware for stop button
├── scripts/            # Dev tooling
│   ├── dev-start.sh    # One-command dev startup
│   └── dev-proxy.py    # Dev proxy (static + API forwarding)
├── tools/              # Utilities
│   └── gen_qr.py       # QR code generator for device UUIDs
├── nginx.conf          # Nginx config (frontend static + API proxy)
├── docker-compose.yml
└── .env.example
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Long random string for signing JWTs — **change this** |
| `PORT` | Backend port (default: `4827`, internal only) |
| `DB_PATH` | SQLite database path (default: `/app/data/stoparica.db`) |

---

## Production (Nginx Proxy Manager)

The app listens on port **8742** (HTTP). Point your Nginx Proxy Manager entry to `localhost:8742` and let NPM handle SSL termination.

> See [DOCS.md](DOCS.md) for full technical documentation.
