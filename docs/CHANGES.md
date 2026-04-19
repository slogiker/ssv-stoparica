# SSV Stoparica — Implementation Notes

## Session 3 — Hardening, Offline Queue, Rate Limiting (2026-04-19)

### Rate Limiting (backend)
- Added `express-rate-limit` dependency
- 10 requests per IP per 15-minute window on `/api/auth/login` and `/api/auth/register`
- Returns Slovenian error message on 429
- Also upgraded `bcrypt` from 5.x → 6.x (fixes 3 high-severity transitive `tar` CVEs)

### JWT Silent Refresh
- **Backend:** `POST /api/auth/refresh` — requires valid JWT, returns new 7-day token
- **Frontend (error-guard.js):** fetch wrapper now intercepts 401 responses, calls `/auth/refresh`, retries original request with new token. If refresh fails → clears stored token + fires `ssv:logout` event
- **Frontend (app.js):** on init, if stored token expires within 2 days → silently refreshes. Listens for `ssv:logout` event → calls `doLogout()`

### Offline Run Queue
- **app.js `saveRun()`:** on API failure, pushes `{ ekipa, disciplina, cas_s }` to `safeStorage.local` under key `ssv_offline_queue` and shows "Ni povezave — vnos shranjen lokalno."
- **app.js `flushOfflineQueue()`:** iterates queue, POSTs each run, removes successes. Any still-failed items stay in queue.
- Flush triggered on: `window.online` event, and app init (after `syncRunsFromServer`)

### Ekipa — Custom Free-Text Input
- Settings panel now has a text input below the preset Člani-A/B buttons
- `maxlength="50"` on the input (matches backend's 50-char validation)
- Typing in the custom field deselects preset buttons; selecting a preset clears the custom field
- Custom value persisted to `localStorage` like preset values

### history.html Fix
- `error-guard.js` is now loaded before `history.js`
- Gives history page: global error handler, `safeStorage`, server watchdog banner, and the 401→refresh fetch wrapper

### Audit Fixes Applied (Session 2, same day)
Full list in git log. Key items:
- Backend: rate limiting, atomic account deletion, LIKE injection escape, CSV formula injection, DB indexes, length limits, CORS via env var
- Frontend: audio double-fire race, cancelAudio state cleanup, guest ID collision after delete, service worker cache updated (ssv-v3), chart colours for light mode, dead code removed
- ESP32: `volatile` on shared BLE variables, software debounce, LED status indicator, non-blocking reconnect
- Nginx: `server_tokens off`, security headers, proxy timeouts

---

## What Else Can Be Done (Backlog)

Ranked by value for this project:

1. **Offline-first history page** — fall back to `ssv_h` sessionStorage when API is unreachable instead of showing nothing
2. **Battery level on ESP32** — BLE Battery Service (0x180F), GPIO34 ADC + voltage divider, show % next to connection dot in app
3. **Session invalidation on password change** — add `token_version` int column on users, increment on password change, middleware rejects old version tokens
4. **Competition mode** — sequential auto-numbered runs for a full team session, auto-reset between runs, one-tap export of the full session
5. **Content Security Policy** — nginx CSP header; requires converting `onclick=` attributes to `addEventListener` in frontend
6. **Push Web Notifications** — Chrome supports Web Push without a native app; useful for pre-competition reminders
7. **Admin panel** — simple protected page listing all users + run counts; useful for the trainer/coach role
8. **Run tagging / notes** — optional 100-char note per run, one extra DB column, one extra UI field on result screen
9. **Leaderboard** — compare best times across users (opt-in); new API endpoint + history tab
10. **Manifest icon fix** — separate `any` and `maskable` purpose entries with proper safe-zone padding
11. **`orientation: "any"` in manifest** — lets CSS landscape mode work after PWA install (currently locked to portrait by manifest)
12. **Email verification** — send verification link on register (requires Nodemailer or transactional email service)
