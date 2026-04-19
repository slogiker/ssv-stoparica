require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Fail fast — without JWT_SECRET every token would be signed with undefined,
// which jsonwebtoken silently coerces to the string "undefined".
if (!process.env.JWT_SECRET) {
  console.error('[fatal] JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./middleware');
const authRoutes = require('./routes/auth');
const runsRoutes = require('./routes/runs');
const devicesRoutes = require('./routes/devices');

const app = express();
const PORT = process.env.PORT || 4827;

// CORS: allow only the production origin (or any origin in local dev).
// In production this runs behind nginx on the same origin — CORS headers
// are only relevant if the API is ever called cross-origin (e.g. mobile app).
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors(CORS_ORIGIN === '*' ? undefined : { origin: CORS_ORIGIN }));

// Limit request body to 10 kB — these endpoints have very small payloads.
app.use(express.json({ limit: '10kb' }));

// Rate-limit auth endpoints: 10 attempts per IP per 15-minute window.
// Prevents brute-force against login and registration spam.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { napaka: 'Preveč poskusov. Počakajte 15 minut in poskusite znova.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/runs', requireAuth, runsRoutes);
app.use('/api/devices', requireAuth, devicesRoutes);

// Global error handler — always returns JSON (must be last app.use)
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.type === 'entity.parse.failed' ? 400 : (err.status || err.statusCode || 500);
  res.status(status).json({ napaka: err.message || 'Interna napaka strežnika.' });
});

app.listen(PORT, () => {
  console.log(`SSV Stoparica backend running on port ${PORT}`);
  const { seedDemo } = require('./seed-demo');
  const db = require('./db');
  seedDemo(db).catch(e => console.error('[seed-demo] failed:', e.message));
});
