# SSV Stoparica — Implementation Notes

## Session 4 — Security, Admin Panel, PWA Caching, Voice Countdown & ESP32 Optimizations (2026-08-21)

### Security & Authentication
- **Database Roles**: Added `role` column (`TEXT DEFAULT 'user'`) to the `users` table via idempotent migration in [`db.js`](file:///home/slogiker/Projects/ssv-stoparica/backend/db.js).
- **JWT Roles**: Encoded the user's role in the JWT token payload and replaced hardcoded string username matches on both the backend and client-side with JWT payload decoding.
- **Demo Seeding**: Refactored [`seed-demo.js`](file:///home/slogiker/Projects/ssv-stoparica/backend/seed-demo.js) to insert `admin` and `test` accounts only if they do not exist, reading passwords from environment variables with safe defaults.

### Admin Panel & Moderation
- **Moderation APIs**: Built administrative endpoints for role management, user deletion (cascade transaction), and retrieving/deleting user runs in [`admin.js`](file:///home/slogiker/Projects/ssv-stoparica/backend/routes/admin.js).
- **Admin UI**: Styled and built a moderation interface in [admin.html](file:///home/slogiker/Projects/ssv-stoparica/frontend/admin.html) and [admin.js](file:///home/slogiker/Projects/ssv-stoparica/frontend/admin.js) to promote/demote users, inspect run history tables, and delete users or individual runs.

### PWA & UX Quality
- **Offline Admin Panel**: Cached `/admin.html` and `/admin.js` in [`sw.js`](file:///home/slogiker/Projects/ssv-stoparica/frontend/sw.js) and bumped cache version to `ssv-v5` to support offline provisioning.
- **Wake Lock Re-acquisition**: Added a visibility change listener to automatically request and re-acquire screen wake lock when returning to the app from background while the stopwatch is running.
- **Watchdog Hardening**: Updated [`error-guard.js`](file:///home/slogiker/Projects/ssv-stoparica/frontend/error-guard.js) watchdog to prevent false `"Strežnik nedosegljiv"` alarms. Added offline state detection (`navigator.onLine === false`) and a 3-second quiet retry mechanism to ignore wake-up network reattachment latency.
- **Today's Best (Session PR)**: Added a "Najboljši danes" stat strip in the main interface that dynamically calculates and displays the best time recorded during the current calendar day.
- **Swipe-to-Delete**: Replaced select/delete checkboxes in [history.html](file:///home/slogiker/Projects/ssv-stoparica/frontend/history.html) with touch swipe gestures on run items to reveal an inline delete button, styled in [style.css](file:///home/slogiker/Projects/ssv-stoparica/frontend/style.css).

### Slovenian Voice Guidance & Countdown
- **Slovenian Time TTS**: Implemented a custom number-to-words parser in [`app.js`](file:///home/slogiker/Projects/ssv-stoparica/frontend/app.js) to speak finished stopwatch times in native Slovenian (supporting correct plural/dual forms like *sekundi/sekunde/sekund*).
- **Prep Countdown Audio**: Handled Slovenian speech countdown during the last 10 seconds of the preparation phase (*"Deset, devet... ena"*), immediately followed by the GZS start audio signal to start the stopwatch.

### ESP32 Firmware Perfecting
- **80MHz Clock Frequency**: Lowered CPU frequency to 80MHz in [`setup()`](file:///home/slogiker/Projects/ssv-stoparica/esp2/esp2_stop/esp2_stop.ino#L156) to reduce battery drain by ~50%.
- **3-Minute Auto Deep Sleep & Wake**: Changed connection timeout to 3 minutes, entering microamp deep sleep on inactivity. Enabled ext0 wakeup on the button pin, so pressing the button immediately wakes up the ESP32 (no hardware switch required).
- **1-Second Button Lockout**: Locked input checks for 1 second after a trigger to ignore button contact bounces.
- **BLE Diagnostics**: Equipped characteristic with read/write flags in firmware to support a real-time connection diagnostic ping test in the app.

---

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
