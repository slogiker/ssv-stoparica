require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { requireAuth } = require('./middleware');
const authRoutes = require('./routes/auth');
const runsRoutes = require('./routes/runs');
const devicesRoutes = require('./routes/devices');

const app = express();
const PORT = process.env.PORT || 4827;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/runs', requireAuth, runsRoutes);
app.use('/api/devices', requireAuth, devicesRoutes);

app.listen(PORT, () => {
  console.log(`SSV Stoparica backend running on port ${PORT}`);
});
