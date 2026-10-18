// SSV Stoparica - Application State and Global Configuration

// Core stopwatch state
let isRunning = false;
let startTime = null;
let elapsed = 0;
let rafId = null;

// Settings state
let soundOn = true;
let hapticOn = true;
let darkOn = localStorage.getItem('ssv_dark') !== '0';
let ttsOn = localStorage.getItem('ssv_tts') === '1';
let discipline = 'letna';
let ekipa = localStorage.getItem('ssv_ekipa') || 'Člani-A';

// Bluetooth Low Energy state
let bleDevice = null;
let bleChar = null;
let bleServer = null;
let reconnectTimer = null;
let _reconnectDelay = 2000;
let _reconnectCountdownInterval = null;
let _bleConfirmResolve = null;

// Audio and Preparation state
let soundPlaying = false;
let pripravaOn = localStorage.getItem('ssv_priprava') === '1';
let _pripravaRaf = null;
let _pripravaEnd = null;
let _pripravaPauseTimeout = null;
let lastSpokenSec = null;
let _audioEl = null;
let _audioStarted = false;

// Signal strength / distance constants (ESP32 calibrated)
const BLE_TX_POWER_AT_1M = -53;
const BLE_PATH_LOSS_N = 2.5;
const RSSI_EMA_ALPHA = 0.2;
let _rssiEma = null;
let _rssiWatchAbort = null;

// Authentication state
let authToken = localStorage.getItem('ssv_token') || null;
let currentUser = localStorage.getItem('ssv_user') || null;
let savedDevices = [];

// Local history state
let history = JSON.parse(localStorage.getItem('ssv_h') || '[]');
// Expiry: Guest runs only last 1 week
if (!authToken) {
  const oneWeek = 7 * 86400000;
  const now = Date.now();
  const filtered = history.filter(h => !h._ts || (now - h._ts) < oneWeek);
  if (filtered.length !== history.length) {
    history = filtered;
    localStorage.setItem('ssv_h', JSON.stringify(history));
  }
}
let pr = null;
