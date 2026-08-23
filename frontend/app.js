// ── STATE ──
let isRunning = false, startTime = null, elapsed = 0, rafId = null;
let soundOn = true, hapticOn = true, darkOn = localStorage.getItem('ssv_dark') !== '0', ttsOn = localStorage.getItem('ssv_tts') === '1';
let discipline = 'letna';
let ekipa = localStorage.getItem('ssv_ekipa') || 'Člani-A';
let bleDevice = null, bleChar = null, bleServer = null, reconnectTimer = null;
let _reconnectDelay = 2000;
let _reconnectCountdownInterval = null;
let _bleConfirmResolve = null;
let soundPlaying = false;
let pripravaOn = localStorage.getItem('ssv_priprava') === '1';
let _pripravaRaf = null, _pripravaEnd = null, lastSpokenSec = null;

// ── SIGNAL STRENGTH / DISTANCE ──
// TX Power at 1 m — must match #define TX_POWER_AT_1M in ESP firmware (-59 dBm)
const BLE_TX_POWER_AT_1M = -59;
// Path-loss exponent n. 2.0 = ideal free space; 2.5–3.0 better for indoor use.
const BLE_PATH_LOSS_N = 2.5;
// Exponential Moving Average alpha: 0.15 = heavy smoothing, 0.4 = more responsive
const RSSI_EMA_ALPHA = 0.2;
let _rssiEma = null;           // smoothed RSSI value (null = no data yet)
let _rssiWatchAbort = null;    // AbortController for watchAdvertisements()

// Auth state
let authToken = localStorage.getItem('ssv_token') || null;
let currentUser = localStorage.getItem('ssv_user') || null;
let savedDevices = [];

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

// ── API HELPERS ──
const API = '/api';
function _assertJson(r) {
  const ct = r.headers.get('content-type') || '';
  if (!ct.startsWith('application/json'))
    throw new Error('Strežnik ni dosegljiv. Poskusite znova.');
}
async function _safeJson(r) {
  _assertJson(r);
  try { return await r.json(); }
  catch { throw new Error('Strežnik ni dosegljiv. Poskusite znova.'); }
}
async function apiPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const r = await fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await _safeJson(r);
  if (!r.ok) throw new Error(data.napaka || 'Napaka strežnika.');
  return data;
}
async function apiGet(path) {
  const r = await fetch(API + path, { headers: { 'Authorization': 'Bearer ' + authToken } });
  const data = await _safeJson(r);
  if (!r.ok) throw new Error(data.napaka || 'Napaka strežnika.');
  return data;
}
async function apiDelete(path) {
  const r = await fetch(API + path, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + authToken } });
  if (r.status === 204) return;
  const data = await _safeJson(r);
  if (!r.ok) throw new Error(data.napaka || 'Napaka strežnika.');
}
async function apiPut(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const r = await fetch(API + path, { method: 'PUT', headers, body: JSON.stringify(body) });
  const data = await _safeJson(r);
  if (!r.ok) throw new Error(data.napaka || 'Napaka strežnika.');
  return data;
}


let _audioEl = null;
let _audioStarted = false; // guards against double-fire in startSoundPhase

// ── HAPTIC ──
function vibrate(pattern) {
  if (!hapticOn || !navigator.vibrate) return;
  const lvl = parseInt(document.getElementById('hapticSlider').value);
  const scale = [0.5, 1, 1.8][lvl - 1];
  navigator.vibrate(Array.isArray(pattern) ? pattern.map(x => Math.round(x * scale)) : Math.round(pattern * scale));
}

// ── TIMER FORMATTING ──
// Display format: MM:SS (minutes:seconds). Centiseconds shown separately via fmtDec().
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function fmtDec(ms) { return '.' + String(Math.floor((ms % 1000) / 10)).padStart(2, '0'); }
function fmtFull(ms) { return fmt(ms) + fmtDec(ms); }

function setDisplay(ms, state) {
  document.getElementById('timerMain').textContent = fmt(ms);
  document.getElementById('timerDec').textContent = fmtDec(ms);
  // Keep landscape timer in sync
  document.getElementById('lsTimer').innerHTML = fmt(ms) + '<span style="font-size:.45em;opacity:.5">' + fmtDec(ms) + '</span>';
  document.getElementById('timerWrap').className = 'timer-wrap' + (state ? ' ' + state : '');
  document.getElementById('lsTimer').className = 'landscape-timer' + (state ? ' ' + state : '');
  document.getElementById('timerGlow').className = 'timer-glow' + (state === 'running' ? ' running' : '');
}

function setStopButtonState(disabled) {
  document.getElementById('stopBtn').disabled = disabled;
  const lsStop = document.getElementById('lsStopBtn');
  if (lsStop) {
    lsStop.style.display = disabled ? 'none' : '';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function tick() { elapsed = Date.now() - startTime; setDisplay(elapsed, 'running'); rafId = requestAnimationFrame(tick); }

// ── CONTROLS ──
// Lock/unlock interactive controls during PRIPRAVA / MERJENJE phases
function lockUI(locked) {
  ['authBtn', 'historyBtn', 'settingsBtn', 'soundBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  document.querySelectorAll('.ekipa-opt').forEach(b => b.disabled = locked);
}

// ── BEEP (Web Audio API) ──
function playBeep(freq = 880, dur = 0.5) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
    setTimeout(() => ctx.close(), (dur + 0.2) * 1000);
  } catch (e) { }
}

// Cancel audio/priprava phase and return to idle.
// Setting _audioStarted=true disarms the _onceStart closure so delayed 'ended'/'error'
// events from the paused element cannot trigger startTimerActual after cancel.
function cancelAudio() {
  _audioStarted = true; // disarm any pending audio callback
  if (_audioEl) {
    _audioEl.pause();
    _audioEl = null;
  }
  if (_pripravaRaf) { cancelAnimationFrame(_pripravaRaf); _pripravaRaf = null; }
  _pripravaEnd = null;
  soundPlaying = false;
  setDisplay(0, '');
  document.getElementById('timerLabel').textContent = 'ČAKANJE NA START';
  document.getElementById('startBtn').disabled = false;
  setStopButtonState(true);
  document.getElementById('resetBtn').disabled = true;
  lockUI(false);
}

// BLE confirm dialog helpers
function bleConfirmResolve(v) {
  if (v) {
    const cb = document.getElementById('bleNoShow');
    if (cb && cb.checked) localStorage.setItem('ssv_ble_noshow', '1');
  }
  document.getElementById('bleConfirmModal').classList.remove('open');
  if (_bleConfirmResolve) { _bleConfirmResolve(v); _bleConfirmResolve = null; }
}
function showBleConfirm() {
  if (localStorage.getItem('ssv_ble_noshow') === '1') return Promise.resolve(true);
  return new Promise(resolve => {
    _bleConfirmResolve = resolve;
    const cb = document.getElementById('bleNoShow');
    if (cb) cb.checked = false;
    document.getElementById('bleConfirmModal').classList.add('open');
  });
}

async function handleStart() {
  if (isRunning || soundPlaying) return;
  if (!bleChar) {
    const proceed = await showBleConfirm();
    if (!proceed) return;
    showToast('Brez ESP2 — ustavite ročno');
  }
  lockUI(true);
  soundPlaying = true;
  vibrate(80);
  document.getElementById('startBtn').disabled = true;
  setStopButtonState(false); // allow cancel at any point

  if (pripravaOn) {
    const totalMs = (discipline === 'letna' ? 180 : 60) * 1000;
    playBeep(880, 0.5);
    document.getElementById('timerLabel').textContent = 'PRIPRAVA ORODJA';
    _pripravaEnd = Date.now() + totalMs;
    lastSpokenSec = null;
    tickPriprava();
  } else {
    startSoundPhase();
  }
}

function tickPriprava() {
  const remaining = Math.max(0, _pripravaEnd - Date.now());
  const s = Math.ceil(remaining / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  document.getElementById('timerMain').textContent = mm + ':' + ss;
  document.getElementById('timerDec').textContent = '';
  document.getElementById('timerWrap').className = 'timer-wrap running';
  document.getElementById('lsTimer').textContent = mm + ':' + ss;
  if (remaining <= 0) {
    _pripravaRaf = null;
    playBeep(1100, 0.7);
    vibrate([80, 60, 120]);
    setTimeout(startSoundPhase, 700);
    return;
  }
  if (s <= 10 && s > 0 && s !== lastSpokenSec) {
    lastSpokenSec = s;
    speakPrepSeconds(s);
  }
  _pripravaRaf = requestAnimationFrame(tickPriprava);
}

function speakPrepSeconds(s) {
  if (!('speechSynthesis' in window)) return;
  const numWords = {
    10: 'deset',
    9: 'devet',
    8: 'osem',
    7: 'sedem',
    6: 'šest',
    5: 'pet',
    4: 'štiri',
    3: 'tri',
    2: 'dve',
    1: 'ena'
  };
  const word = numWords[s];
  if (!word) return;

  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'sl-SI';
  
  const voices = window.speechSynthesis.getVoices();
  const slVoice = voices.find(v => v.lang.startsWith('sl'));
  if (slVoice) {
    utterance.voice = slVoice;
  }
  
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function startSoundPhase() {
  console.log('STOPWATCH: Starting preparation phase (sound=' + soundOn + ', discipline=' + discipline + ')...');
  document.getElementById('timerLabel').textContent = 'PRIPRAVA...';
  if (soundOn) {
    if (_audioEl) { _audioEl.pause(); _audioEl.currentTime = 0; }
    _audioEl = new Audio(discipline === 'zimska' ? AUDIO_ZIMSKA : AUDIO_LETNA);
    _audioEl.volume = document.getElementById('volSlider').value / 100;
    // Guard: 'ended', 'error', and .play() rejection can all fire on the same
    // audio element — use module-level _audioStarted so cancelAudio can suppress it.
    _audioStarted = false;
    function _onceStart() { if (!_audioStarted) { _audioStarted = true; startTimerActual(); } }
    _audioEl.addEventListener('ended', _onceStart);
    _audioEl.addEventListener('error', _onceStart);
    _audioEl.play().catch(_onceStart);
  } else {
    startTimerActual();
  }
}

function startTimerActual() {
  // Audio listeners are closures; _audioStarted flag ensures only one call gets through.
  _audioEl = null;
  soundPlaying = false;
  isRunning = true; startTime = Date.now() - elapsed; rafId = requestAnimationFrame(tick);
  console.log('STOPWATCH: Timing started. Reference start time (ms):', startTime);
  document.getElementById('timerLabel').textContent = 'MERJENJE...';
  setStopButtonState(false);
  document.getElementById('resetBtn').disabled = true;
  requestWakeLock();
}

function handleStop() {
  if (soundPlaying) {
    console.log('STOPWATCH: Stop request during audio preparation. Cancelling audio.');
    cancelAudio();
    return;
  }
  if (!isRunning) return;
  cancelAnimationFrame(rafId); isRunning = false;
  elapsed = Date.now() - startTime; setDisplay(elapsed, 'stopped');
  console.log('STOPWATCH: Timing stopped. Final elapsed:', elapsed, 'ms (' + fmtFull(elapsed) + ')');
  vibrate([60, 40, 100]);
  document.getElementById('timerLabel').textContent = 'USTAVLJENO';
  document.getElementById('startBtn').disabled = true;
  setStopButtonState(true);
  document.getElementById('resetBtn').disabled = false;
  lockUI(false);
  saveRun();
  releaseWakeLock();
  // Disabled time announcement by request:
  // if (ttsOn) {
  //   speakSlovenianTime(elapsed / 1000);
  // }
}

function handleReset() {
  console.log('STOPWATCH: Reset.');
  cancelAnimationFrame(rafId); isRunning = false; elapsed = 0;
  soundPlaying = false; _audioEl = null; _audioStarted = true; _pripravaRaf = null; _pripravaEnd = null;
  setDisplay(0, '');
  document.getElementById('timerLabel').textContent = 'ČAKANJE NA START';
  document.getElementById('startBtn').disabled = false;
  setStopButtonState(true);
  document.getElementById('resetBtn').disabled = true;
  lockUI(false);
}

// ── SAVE RUN ──
function saveRun() {
  const now = new Date();
  const entry = {
    // Use timestamp as local ID to avoid collisions after deletion
    id: history.length ? Math.max(...history.map(h => h.id)) + 1 : 1,
    datum: now.toLocaleString('sl-SI'),
    datumIso: now.toISOString(),
    ekipa,
    disc: discipline,
    ms: elapsed,
    time: fmtFull(elapsed),
    _ts: Date.now()
  };

  if (authToken) {
    // Logged-in: persist to backend; queue locally on failure for retry when online
    const cas_s = parseFloat((elapsed / 1000).toFixed(3));
    apiPost('/runs', { ekipa, disciplina: discipline, cas_s })
      .then(run => { entry.id = run.id || entry.id; })
      .catch(() => {
        const q = JSON.parse(safeStorage.local.get('ssv_offline_queue') || '[]');
        q.push({ ekipa, disciplina: discipline, cas_s, _localId: entry.id });
        safeStorage.local.set('ssv_offline_queue', JSON.stringify(q));
        showToast('Ni povezave — vnos shranjen lokalno.');
      });
  }

  // Always keep local list in sync (instant UI feedback)
  history.unshift(entry);
  localStorage.setItem('ssv_h', JSON.stringify(history));
  const isPR = pr === null || elapsed < pr;
  if (isPR) pr = elapsed;
  document.getElementById('lastTime').textContent = entry.time;
  document.getElementById('prTime').textContent = fmtFull(pr);
  document.getElementById('prStrip').style.opacity = '1';
  const prEl = document.getElementById('lastPr');
  prEl.className = 'last-pr' + (isPR ? ' show' : '');
  if (isPR) {
    prEl.classList.remove('pop');
    void prEl.offsetWidth; // force reflow to restart animation
    prEl.classList.add('pop');
  }
  document.getElementById('lastStrip').style.opacity = '1';
  updateTodayBestUI();
  showToast((isPR ? '🏆 PR! ' : '') + entry.time + ' — ' + ekipa);
}

// ── DISCIPLINE ──
function setDisc(d) {
  discipline = d;
  document.getElementById('badgeZ').className = 'badge' + (d === 'zimska' ? ' active' : '');
  document.getElementById('badgeL').className = 'badge' + (d === 'letna' ? ' active' : '');
  document.getElementById('discSelect').value = d;
  // Keep priprava description in sync when discipline changes
  if (pripravaOn) {
    const durata = d === 'letna' ? '3:00' : '1:00';
    document.getElementById('pripravaDesc').textContent = 'Odštevalnik ' + durata + ' (' + d + ')';
  }
}
function discChanged() { setDisc(document.getElementById('discSelect').value); }

// ── BLE ──
// Service/characteristic UUIDs are per-device, loaded from URL ?device= param or sessionStorage
// Fallback to placeholder UUIDs — must be replaced per physical device before use
const DEFAULT_SVC = '12345678-1234-1234-1234-123456789012';
const DEFAULT_CHR = '12345678-1234-1234-1234-123456789abc';

function getDeviceUUIDs() {
  // QR URL format: ?device=SERVICE-UUID&char=CHAR-UUID (generated by tools/gen_esp.py)
  const params = new URLSearchParams(window.location.search);
  const svcFromUrl = params.get('device');
  const chrFromUrl = params.get('char');
  if (svcFromUrl) sessionStorage.setItem('ssv_svc', svcFromUrl);
  if (chrFromUrl) sessionStorage.setItem('ssv_chr', chrFromUrl);

  let svc = sessionStorage.getItem('ssv_svc');
  let chr = sessionStorage.getItem('ssv_chr');

  // If no URL/session UUIDs, use the first saved device from account
  if (!svc && savedDevices.length > 0) {
    svc = savedDevices[0].svc_uuid;
    chr = savedDevices[0].char_uuid;
  }

  return { svc: svc || DEFAULT_SVC, chr: chr || DEFAULT_CHR };
}

async function fetchDevices() {
  if (!authToken) return;
  try {
    savedDevices = await apiGet('/devices');
    updateDevicesUI();
  } catch (e) {
    showToast('Napaka pri nalaganju naprav.');
  }
}

async function saveCurrentDevice() {
  const { svc, chr } = getDeviceUUIDs();
  if (svc === DEFAULT_SVC) {
    showToast('Ni aktivne naprave za shranjevanje.');
    return;
  }
  try {
    await apiPost('/devices', { svc_uuid: svc, char_uuid: chr, friendly_name: bleDevice ? bleDevice.name : 'Moja naprava' });
    showToast('Naprava shranjena v račun.');
    fetchDevices();
  } catch (e) {
    showToast(e.message);
  }
}

async function removeDevice(id) {
  try {
    await apiDelete('/devices/' + id);
    showToast('Naprava odstranjena.');
    fetchDevices();
  } catch (e) {
    showToast(e.message);
  }
}

function setDot(state, label) {
  document.getElementById('bleDot').className = 'ble-dot' + (state ? ' ' + state : '');
  document.getElementById('bleLabel').textContent = label;
}

async function bleConnect() {
  if (!navigator.bluetooth) {
    console.error('BLE: Web Bluetooth API is not supported in this browser context (requires HTTPS or localhost).');
    showToast('Web Bluetooth ni podprt v tem brskalniku');
    return;
  }
  if (bleChar) {
    console.log('BLE: Already connected to device:', bleDevice ? bleDevice.name : 'Unknown');
    return;
  }
  const { svc, chr } = getDeviceUUIDs();
  console.log('BLE: Starting connection sequence. Configured UUIDs - Service:', svc, 'Characteristic:', chr);
  _reconnectDelay = 2000; // reset backoff on every manual tap
  if (_reconnectCountdownInterval) { clearInterval(_reconnectCountdownInterval); _reconnectCountdownInterval = null; }
  setDot('scanning', 'Išče SSV-STOP...');
 
  // Try to silently reconnect to a previously permitted device — skips the browser picker
  if (typeof navigator.bluetooth.getDevices === 'function') {
    try {
      console.log('BLE: Checking for previously paired devices...');
      const known = await navigator.bluetooth.getDevices();
      const prev = known.find(d => d.name?.startsWith('SSV-STOP'));
      if (prev) {
        console.log('BLE: Found matching previously paired device:', prev.name, 'Attempting auto-reconnect...');
        bleDevice = prev;
        bleDevice.removeEventListener('gattserverdisconnected', onDisconn);
        bleDevice.addEventListener('gattserverdisconnected', onDisconn);
        await bleGattConnect(svc, chr);
        showToast('BLE vzpostavljena ✓');
        document.getElementById('bleDeviceDesc').textContent = bleDevice.name || 'SSV-STOP';
        return;
      } else {
        console.log('BLE: No matching previously paired device found.');
      }
    } catch (e) {
      console.warn('BLE: Auto-reconnect check failed (falling back to device picker):', e);
    }
  }
 
  // First time or previously known device out of range — show browser picker
  try {
    console.log('BLE: Requesting device list from browser picker (prefix: SSV-STOP)...');
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'SSV-STOP' }],
      optionalServices: [svc]
    });
    console.log('BLE: Device selected:', bleDevice.name, 'ID:', bleDevice.id);
    bleDevice.removeEventListener('gattserverdisconnected', onDisconn);
    bleDevice.addEventListener('gattserverdisconnected', onDisconn);
    await bleGattConnect(svc, chr);
    showToast('BLE vzpostavljena ✓');
    document.getElementById('bleDeviceDesc').textContent = bleDevice.name || 'SSV-STOP';
  } catch (e) {
    console.error('BLE: Connection failed or user canceled the dialog:', e);
    setDot('lost', 'Napaka — tapni za ponovni poskus');
    showToast('BLE: ' + e.message);
  }
}
 
async function bleGattConnect(svc, chr) {
  console.log('BLE: Connecting to GATT server on device:', bleDevice.name);
  bleServer = await bleDevice.gatt.connect();
  console.log('BLE: GATT server connected. Retrieving service:', svc);
  const service = await bleServer.getPrimaryService(svc);
  console.log('BLE: Service retrieved. Retrieving characteristic:', chr);
  bleChar = await service.getCharacteristic(chr);
  console.log('BLE: Characteristic retrieved. Subscribing to notifications...');
  await bleChar.startNotifications();
  bleChar.addEventListener('characteristicvaluechanged', onBleVal);
  console.log('BLE: Successfully subscribed to notifications.');
  // Clear any active reconnect countdown — we're connected
  if (_reconnectCountdownInterval) { clearInterval(_reconnectCountdownInterval); _reconnectCountdownInterval = null; }
  setDot('connected', bleDevice.name || 'SSV-STOP');
  // Start live RSSI monitoring via watchAdvertisements (Chrome 79+)
  startRssiWatch();
  // TODO Phase 2: subscribe to battery level characteristic (0x180F) once ADC is wired on ESP
}
 
function onBleVal(e) {
  const rawVal = Array.from(new Uint8Array(e.target.value.buffer));
  console.log('BLE: Characteristic value changed. Payload:', rawVal);
  if (e.target.value.getUint8(0) === 0x01) {
    if (isRunning) {
      console.log('BLE: Stop signal (0x01) received while running. Stopping stopwatch.');
      handleStop();
    } else {
      console.log('BLE: Stop signal (0x01) received, but stopwatch is not running.');
    }
  }
}
 
function onDisconn() {
  console.warn('BLE: Device disconnected:', bleDevice ? bleDevice.name : 'Unknown');
  bleChar = null;
  bleServer = null;
  clearSignalUI();
  // Stop RSSI watch — device is gone
  if (_rssiWatchAbort) { try { _rssiWatchAbort.abort(); } catch (_) {} _rssiWatchAbort = null; }
  _rssiEma = null;
  setDot('lost', 'Prekinjena — znova se povezujem...');
  clearTimeout(reconnectTimer);
  scheduleReconnect();
}
 
function startReconnectCountdown(ms) {
  if (_reconnectCountdownInterval) clearInterval(_reconnectCountdownInterval);
  const end = Date.now() + ms;
  _reconnectCountdownInterval = setInterval(() => {
    if (!bleDevice || bleChar) {
      clearInterval(_reconnectCountdownInterval);
      _reconnectCountdownInterval = null;
      return;
    }
    const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    if (remaining > 0) {
      setDot('lost', 'Prekinjena — znova v ' + remaining + 's');
    } else {
      clearInterval(_reconnectCountdownInterval);
      _reconnectCountdownInterval = null;
    }
  }, 500);
}
 
function scheduleReconnect() {
  console.log('BLE: Reconnect scheduled in ' + _reconnectDelay + 'ms.');
  startReconnectCountdown(_reconnectDelay);
  reconnectTimer = setTimeout(async () => {
    if (!bleDevice || bleChar) return; // forgotten or already reconnected
    console.log('BLE: Attempting scheduled reconnect...');
    setDot('scanning', 'Znova se povezujem...');
    const { svc, chr } = getDeviceUUIDs();
    try {
      await bleGattConnect(svc, chr);
      _reconnectDelay = 2000; // reset on success
    } catch (e) {
      console.warn('BLE: Scheduled reconnect attempt failed:', e);
      _reconnectDelay = Math.min(_reconnectDelay * 2, 10000);
      scheduleReconnect();
    }
  }, _reconnectDelay);
}
 
function forgetDevice() {
  console.log('BLE: User request to forget device.');
  clearTimeout(reconnectTimer);
  if (_reconnectCountdownInterval) { clearInterval(_reconnectCountdownInterval); _reconnectCountdownInterval = null; }
  _reconnectDelay = 2000;
  if (_rssiWatchAbort) { try { _rssiWatchAbort.abort(); } catch (_) {} _rssiWatchAbort = null; }
  _rssiEma = null;
  clearSignalUI();
  if (bleDevice) bleDevice.removeEventListener('gattserverdisconnected', onDisconn);
  bleDevice = null; bleChar = null; bleServer = null;
  sessionStorage.removeItem('ssv_svc');
  sessionStorage.removeItem('ssv_chr');
  setDot('', 'Tapni za povezavo z ESP2');
  document.getElementById('bleDeviceDesc').textContent = 'Ni shranjene naprave';
  showToast('Naprava pozabljena');
}

// ── SIGNAL STRENGTH & DISTANCE ──

/**
 * Converts smoothed RSSI to a bar count (1–4) and distance estimate.
 * Uses the log-distance path-loss model:
 *   distance = 10 ^ ((TxPowerAt1m - rssi) / (10 * n))
 *
 * Bar thresholds (distance-based for intuitive UX):
 *   4 bars  — < 2 m   (excellent)
 *   3 bars  — 2–5 m   (good)
 *   2 bars  — 5–8 m   (fair)
 *   1 bar   — > 8 m   (weak)
 */
function rssiToSignal(rssi) {
  const distance = Math.pow(10, (BLE_TX_POWER_AT_1M - rssi) / (10 * BLE_PATH_LOSS_N));
  let bars;
  if      (distance < 2) bars = 4;
  else if (distance < 5) bars = 3;
  else if (distance < 8) bars = 2;
  else                   bars = 1;
  return { bars, distance };
}

/** Update the signal bars SVG, distance text, and dBm label. */
function updateSignalUI(rssi) {
  const svgEl  = document.getElementById('signalBars');
  const distEl = document.getElementById('signalDist');
  const dbmEl  = document.getElementById('signalDbm');
  if (!svgEl || !distEl || !dbmEl) return;

  const { bars, distance } = rssiToSignal(rssi);

  svgEl.setAttribute('data-bars', bars);

  // Distance display — format to one decimal, cap at 99.9 m
  const distCapped = Math.min(distance, 99.9);
  const distStr = distCapped < 10
    ? '~' + distCapped.toFixed(1) + 'm'
    : '~' + Math.round(distCapped) + 'm';
  distEl.textContent = distStr;
  distEl.className = 'signal-dist ' + (bars >= 4 ? 'near' : bars >= 3 ? 'near' : bars >= 2 ? 'mid' : 'far');

  // Raw dBm shown in small text
  dbmEl.textContent = rssi + 'dBm';

  // Live diagnostic modal sync
  const diagRssi = document.getElementById('diagRssi');
  const diagDist = document.getElementById('diagDist');
  if (diagRssi) diagRssi.textContent = rssi + ' dBm';
  if (diagDist) diagDist.textContent = distStr;
}

/** Reset signal widget to idle state (on disconnect/forget). */
function clearSignalUI() {
  const svgEl  = document.getElementById('signalBars');
  const distEl = document.getElementById('signalDist');
  const dbmEl  = document.getElementById('signalDbm');
  if (svgEl)  svgEl.setAttribute('data-bars', '0');
  if (distEl) { distEl.textContent = '—'; distEl.className = 'signal-dist'; }
  if (dbmEl)  dbmEl.textContent = '';

  const diagRssi = document.getElementById('diagRssi');
  const diagDist = document.getElementById('diagDist');
  if (diagRssi) diagRssi.textContent = '—';
  if (diagDist) diagDist.textContent = '—';
}

/**
 * Start watching BLE advertisements from the connected device.
 * Chrome's watchAdvertisements() delivers advertisement events (including RSSI)
 * even while a GATT connection is active — without disconnecting.
 *
 * Falls back gracefully if watchAdvertisements is not supported.
 */
async function startRssiWatch() {
  if (!bleDevice || typeof bleDevice.watchAdvertisements !== 'function') {
    // API not supported — show bars at max (we know it's connected)
    const svgEl = document.getElementById('signalBars');
    if (svgEl) svgEl.setAttribute('data-bars', '4');
    const distEl = document.getElementById('signalDist');
    if (distEl) { distEl.textContent = 'OK'; distEl.className = 'signal-dist near'; }
    return;
  }
  // Abort any previous watcher
  if (_rssiWatchAbort) { try { _rssiWatchAbort.abort(); } catch (_) {} }
  _rssiWatchAbort = new AbortController();
  _rssiEma = null;
  try {
    await bleDevice.watchAdvertisements({ signal: _rssiWatchAbort.signal });
    bleDevice.addEventListener('advertisementreceived', (evt) => {
      const rssi = evt.rssi;
      if (typeof rssi !== 'number') return;
      // Exponential Moving Average to smooth RSSI jitter
      _rssiEma = _rssiEma === null ? rssi : _rssiEma + RSSI_EMA_ALPHA * (rssi - _rssiEma);
      updateSignalUI(Math.round(_rssiEma));
    });
  } catch (e) {
    // watchAdvertisements may throw if already watching or if permission denied
    // Non-fatal: bars show connected state without distance
    const svgEl = document.getElementById('signalBars');
    if (svgEl) svgEl.setAttribute('data-bars', '4');
  }
}

// ── SETTINGS TOGGLES ──
function toggleSound() {
  soundOn = !soundOn;
  document.getElementById('soundTog').className = 'tog' + (soundOn ? ' on' : '');
  document.getElementById('soundBtn').className = 'ico-btn' + (soundOn ? ' lit' : '');
  document.getElementById('soundBtn').innerHTML = soundOn ? '&#128266;' : '&#128263;';
}
function toggleHaptic() {
  hapticOn = !hapticOn;
  document.getElementById('hapticTog').className = 'tog' + (hapticOn ? ' on' : '');
  updateHapticUI();
}
function updateHapticUI() {
  const slider = document.getElementById('hapticSlider');
  if (slider) {
    slider.disabled = !hapticOn;
    slider.style.opacity = hapticOn ? '1' : '0.4';
  }
}
function toggleDark() {
  darkOn = !darkOn;
  localStorage.setItem('ssv_dark', darkOn ? '1' : '0');
  document.body.classList.toggle('light', !darkOn);
  document.getElementById('darkTog').className = 'tog' + (darkOn ? ' on' : '');
}
function toggleTts() {
  ttsOn = !ttsOn;
  localStorage.setItem('ssv_tts', ttsOn ? '1' : '0');
  document.getElementById('ttsTog').className = 'tog' + (ttsOn ? ' on' : '');
}

function speakSlovenianTime(seconds) {
  if (!('speechSynthesis' in window)) return;
  
  function getNumberWords(num) {
    if (num === 0) return 'nič';
    const ones = ['', 'ena', 'dve', 'tri', 'štiri', 'pet', 'šest', 'sedem', 'osem', 'devet'];
    const teens = ['deset', 'enajst', 'dvanajst', 'trinajst', 'štirinajst', 'petnajst', 'šestnajst', 'sedemnajst', 'osemnajst', 'devetnajst'];
    const tens = ['', 'deset', 'dvajset', 'trideset', 'štirideset', 'petdeset', 'šestdeset', 'sedemdeset', 'osemdeset', 'devetdeset'];

    if (num < 10) return ones[num];
    if (num < 20) return teens[num - 10];
    const ten = Math.floor(num / 10);
    const one = num % 10;
    if (one === 0) return tens[ten];
    
    let oneWord = (one === 1) ? 'en' : ones[one];
    if (one === 2) oneWord = 'dve';
    return oneWord + 'in' + tens[ten];
  }

  const wholeSeconds = Math.floor(seconds);
  const hundredths = Math.round((seconds - wholeSeconds) * 100);
  
  let text = getNumberWords(wholeSeconds);

  if (hundredths > 0) {
    text += ' in ' + getNumberWords(hundredths);
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'sl-SI';
  
  const voices = window.speechSynthesis.getVoices();
  const slVoice = voices.find(v => v.lang.startsWith('sl'));
  if (slVoice) {
    utterance.voice = slVoice;
  }
  
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// ── BLE DIAGNOSTICS ──
function handleBlePillClick() {
  if (bleChar) {
    openBleDiag();
  } else {
    bleConnect();
  }
}

function openBleDiag() {
  const modal = document.getElementById('bleDiagModal');
  if (!modal) return;
  modal.classList.add('open');
  
  document.getElementById('diagStatus').textContent = bleChar ? 'Povezan' : 'Brez povezave';
  document.getElementById('diagStatus').style.color = bleChar ? 'var(--acc)' : 'var(--danger)';
  document.getElementById('diagName').textContent = bleDevice ? (bleDevice.name || 'SSV-STOP') : 'Neznano';
  
  // Set initial signal strength if available
  const dbmEl = document.getElementById('signalDbm');
  const distEl = document.getElementById('signalDist');
  document.getElementById('diagRssi').textContent = dbmEl ? (dbmEl.textContent || '—') : '—';
  document.getElementById('diagDist').textContent = distEl ? (distEl.textContent || '—') : '—';
  document.getElementById('pingResult').textContent = '—';
  document.getElementById('pingResult').style.color = 'var(--text)';
}

function closeBleDiag() {
  const modal = document.getElementById('bleDiagModal');
  if (modal) modal.classList.remove('open');
}

async function runPingTest() {
  const btn = document.querySelector('#bleDiagModal button[onclick="runPingTest()"]');
  const resEl = document.getElementById('pingResult');
  if (!bleChar) { showToast('BLE ni povezan.'); return; }
  
  btn.disabled = true;
  resEl.textContent = 'Merim...';
  
  try {
    const t0 = performance.now();
    await bleChar.readValue();
    const roundtrip = Math.round(performance.now() - t0);
    resEl.textContent = `${roundtrip} ms`;
    if (roundtrip < 30) {
      resEl.style.color = 'var(--acc)';
    } else if (roundtrip < 80) {
      resEl.style.color = 'var(--blue)';
    } else {
      resEl.style.color = 'var(--danger)';
    }
  } catch (err) {
    resEl.textContent = 'Napaka';
    resEl.style.color = 'var(--danger)';
    showToast('Ping napaka: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}
function setEkipa(el) {
  ekipa = el.dataset.e;
  localStorage.setItem('ssv_ekipa', ekipa);
  document.querySelectorAll('.ekipa-opt').forEach(b => b.classList.toggle('active', b.dataset.e === ekipa));
  const custom = document.getElementById('ekipaCustom');
  if (custom) custom.value = '';
}

function setEkipaCustom(val) {
  if (!val.trim()) {
    ekipa = 'Člani-A';
    localStorage.setItem('ssv_ekipa', ekipa);
    document.querySelectorAll('.ekipa-opt').forEach(b => b.classList.toggle('active', b.dataset.e === ekipa));
    return;
  }
  ekipa = val.trim().slice(0, 50);
  localStorage.setItem('ssv_ekipa', ekipa);
  document.querySelectorAll('.ekipa-opt').forEach(b => b.classList.remove('active'));
}
function togglePriprava() {
  pripravaOn = !pripravaOn;
  localStorage.setItem('ssv_priprava', pripravaOn ? '1' : '0');
  document.getElementById('pripravaTog').className = 'tog' + (pripravaOn ? ' on' : '');
  const durata = discipline === 'letna' ? '3:00' : '1:00';
  document.getElementById('pripravaDesc').textContent = pripravaOn
    ? 'Odštevalnik ' + durata + ' (' + discipline + ')'
    : 'Odštevalnik pred startom';
  // Sync main-screen quick-toggle button
  const btn = document.getElementById('pripravaBtn');
  if (btn) {
    btn.className = 'btn-priprava' + (pripravaOn ? ' on' : '');
    document.getElementById('pripravaBtnState').textContent = pripravaOn ? 'ON' : 'OFF';
  }
}

function togglePwd(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.classList.toggle('visible', show);
}


// ── PANELS ──
function openSettings() { document.getElementById('settingsPanel').classList.add('open'); }
function closeSettings() { document.getElementById('settingsPanel').classList.remove('open'); }

// ── WAKE LOCK ──
let wakeLock = null;
async function requestWakeLock() {
  if (wakeLock) return;
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch (e) { }
}
function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && isRunning) {
    await requestWakeLock();
  }
});

// ── LANDSCAPE ──
function checkOrientation() {
  document.body.classList.toggle('landscape-mode', window.matchMedia('(orientation:landscape)').matches);
}
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 100));
window.addEventListener('resize', checkOrientation);

// ── TOAST ──
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// CSV export — server for logged-in, client-side for guests
function exportCSV() {
  if (authToken) {
    fetch('/api/runs/export', { headers: { 'Authorization': 'Bearer ' + authToken } })
      .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
      .then(blob => {
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(blob), download: 'ssv-rezultati.csv'
        });
        a.click(); URL.revokeObjectURL(a.href);
      })
      .catch(() => showToast('Izvoz ni uspel.'));
    return;
  }
  const lines = ['id,ekipa,disciplina,cas_s,cas_format,datum'];
  for (const r of history) {
    const ek = (r.ekipa || '').replace(/"/g, '""');
    const cas_s = (r.ms / 1000).toFixed(3);
    lines.push(`${r.id},"${ek}",${r.disc || ''},${cas_s},${r.time},${r.datum}`);
  }
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' })),
    download: 'ssv-rezultati.csv'
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── AUTH ──
// ── MIGRATION ──
let _migrationResolve = null;
function checkMigration() {
  const stored = JSON.parse(localStorage.getItem('ssv_h') || '[]');
  if (!stored.length) return;
  document.getElementById('migrationText').textContent = `Našli smo ${stored.length} shranjenih rezultatov iz tega tedna. Jih želite prenesti na svoj račun?`;
  document.getElementById('migrationModal').classList.add('open');
  return new Promise(resolve => { _migrationResolve = resolve; });
}
async function resolveMigration(confirm) {
  document.getElementById('migrationModal').classList.remove('open');
  if (confirm) {
    const stored = JSON.parse(localStorage.getItem('ssv_h') || '[]');
    const failed = [];
    for (const item of stored) {
      try {
        await apiPost('/runs', {
          ekipa: item.ekipa,
          disciplina: item.disc,
          cas_s: parseFloat((item.ms / 1000).toFixed(3))
        });
      } catch { failed.push(item); }
    }
    if (failed.length) {
      localStorage.setItem('ssv_h', JSON.stringify(failed));
      showToast(`Napaka pri prenosu ${failed.length} vnosov.`);
    } else {
      localStorage.removeItem('ssv_h');
      showToast('Rezultati uspešno preneseni.');
    }
    syncRunsFromServer();
  } else {
    localStorage.removeItem('ssv_h');
    showToast('Lokalni rezultati izbrisani.');
  }
  if (_migrationResolve) { _migrationResolve(); _migrationResolve = null; }
}

async function doLogin(login, geslo) {
  try {
    const data = await apiPost('/auth/login', { login, geslo });
    authToken = data.token;
    currentUser = data.ime;
    localStorage.setItem('ssv_token', authToken);
    localStorage.setItem('ssv_user', currentUser);
    closeAuthModal();
    await checkMigration();
    updateAuthUI();
    showToast('Dobrodošel, ' + currentUser + '!');
    syncRunsFromServer();
  } catch (e) {
    document.getElementById('authError').textContent = e.message;
  }
}

async function doRegister(ime, email, geslo) {
  try {
    const data = await apiPost('/auth/register', { ime, email, geslo });
    authToken = data.token;
    currentUser = data.ime;
    localStorage.setItem('ssv_token', authToken);
    localStorage.setItem('ssv_user', currentUser);
    closeAuthModal();
    await checkMigration();
    updateAuthUI();
    showToast('Registracija uspešna. Dobrodošel, ' + currentUser + '!');
  } catch (e) {
    document.getElementById('authError').textContent = e.message;
  }
}

function doLogout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('ssv_token');
  localStorage.removeItem('ssv_user');
  history = []; localStorage.removeItem('ssv_h');
  pr = null;
  // Clear both strips so a new guest session starts clean
  document.getElementById('lastTime').textContent = '\u2014';
  document.getElementById('prTime').textContent = '\u2014';
  document.getElementById('todayTime').textContent = '\u2014';
  document.getElementById('lastPr').className = 'last-pr';
  document.getElementById('lastStrip').style.opacity = '.5';
  document.getElementById('prStrip').style.opacity = '.5';
  document.getElementById('todayStrip').style.opacity = '.5';
  updateAuthUI();
  showToast('Odjavljeni ste.');
}

async function flushOfflineQueue() {
  if (!authToken) return;
  const raw = safeStorage.local.get('ssv_offline_queue');
  if (!raw) return;
  let q;
  try { q = JSON.parse(raw); } catch { safeStorage.local.remove('ssv_offline_queue'); return; }
  if (!q.length) return;
  const failed = [];
  for (const item of q) {
    try {
      await apiPost('/runs', { ekipa: item.ekipa, disciplina: item.disciplina, cas_s: item.cas_s });
    } catch {
      failed.push(item);
    }
  }
  if (failed.length) {
    safeStorage.local.set('ssv_offline_queue', JSON.stringify(failed));
  } else {
    safeStorage.local.remove('ssv_offline_queue');
    showToast('Lokalni vnosi sinhronizirani.');
    syncRunsFromServer();
  }
}

function updateSidebarHistory() {
  const container = document.getElementById('miniHistory');
  if (!container) return;
  if (!history.length) {
    container.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:12px">Ni rezultatov</div>';
    return;
  }
  container.innerHTML = '';
  // Show last 20 runs
  history.slice(0, 20).forEach(r => {
    const el = document.createElement('div');
    el.className = 'hv-run-item';
    el.innerHTML = `
      <div class="hv-run-body">
        <span class="hv-run-time">${r.time}</span>
        <span class="hv-run-meta">${escapeHtml(r.ekipa)} · ${r.disc === 'zimska' ? 'Zimska' : 'Letna'} · ${r.datum.split(',')[0]}</span>
      </div>`;
    container.appendChild(el);
  });
}

function updateDevicesUI() {
  const container = document.getElementById('accDeviceList');
  if (!container) return;
  if (!savedDevices.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:10px">Ni shranjenih naprav.</div>';
    return;
  }
  container.innerHTML = '';
  savedDevices.forEach(dev => {
    const el = document.createElement('div');
    el.className = 'setting-row';
    el.style.padding = '10px 20px';
    el.innerHTML = `
      <div class="setting-info">
        <div class="setting-name" style="font-size:13px">${escapeHtml(dev.friendly_name || 'Neznana naprava')}</div>
        <div class="setting-desc">${dev.svc_uuid.slice(0, 8)}...</div>
      </div>
      <button class="ico-btn" onclick="removeDevice(${dev.id})" style="color:var(--danger);border-color:var(--border)">&#128465;</button>
    `;
    container.appendChild(el);
  });
}

function getRoleFromToken() {
  if (!authToken) return 'user';
  try {
    const base64Url = authToken.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload).role || 'user';
  } catch (e) {
    return 'user';
  }
}
function getTodayBest() {
  const todayPrefix = new Date().toLocaleDateString('sl-SI');
  const todayRuns = history.filter(r => r.datum && r.datum.startsWith(todayPrefix));
  if (todayRuns.length === 0) return null;
  return Math.min(...todayRuns.map(r => r.ms));
}

function updateTodayBestUI() {
  const best = getTodayBest();
  const el = document.getElementById('todayTime');
  const strip = document.getElementById('todayStrip');
  if (best && el && strip) {
    el.textContent = fmtFull(best);
    strip.style.opacity = '1';
  } else if (el && strip) {
    el.textContent = '\u2014';
    strip.style.opacity = '.5';
  }
}

function updateAuthUI() {
  const btn = document.getElementById('authBtn');
  const saveBtn = document.getElementById('btnSaveDevice');
  const adminRow = document.getElementById('adminRow');
  if (currentUser) {
    btn.textContent = currentUser.slice(0, 2).toUpperCase();
    btn.classList.add('lit');
    btn.title = 'Račun (' + currentUser + ')';
    btn.onclick = openAccountModal;
    if (saveBtn) saveBtn.style.display = '';
    const isAdmin = getRoleFromToken() === 'admin';
    if (adminRow) adminRow.style.display = isAdmin ? 'flex' : 'none';
    fetchDevices();
  } else {
    btn.innerHTML = '&#128100;';
    btn.classList.remove('lit');
    btn.title = 'Prijava / Registracija';
    btn.onclick = openAuthModal;
    if (saveBtn) saveBtn.style.display = 'none';
    if (adminRow) adminRow.style.display = 'none';
    savedDevices = [];
  }
}

async function syncRunsFromServer() {
  if (!authToken) return;
  try {
    const runs = await apiGet('/runs');
    history = runs.map((r, i) => {
      const iso = r.datum.replace(' ', 'T');
      return {
        id: r.id,
        datum: new Date(iso + 'Z').toLocaleString('sl-SI'),
        datumIso: new Date(iso + 'Z').toISOString(),
        ekipa: r.ekipa || '—',
        disc: r.disciplina,
        ms: Math.round(r.cas_s * 1000),
        time: fmtFull(Math.round(r.cas_s * 1000))
      };
    });
    localStorage.setItem('ssv_h', JSON.stringify(history));
    const prRun = history.reduce((best, r) => (!best || r.ms < best.ms) ? r : best, null);
    if (prRun) {
      pr = prRun.ms;
      document.getElementById('prTime').textContent = fmtFull(pr);
      document.getElementById('prStrip').style.opacity = '1';
    }
    // Restore last run strip (first entry is the most recent)
    if (history.length > 0) {
      document.getElementById('lastTime').textContent = history[0].time;
      document.getElementById('lastStrip').style.opacity = '1';
    }
  } catch (e) {
    console.error('Runs sync failed:', e);
    // Only show toast for genuine server errors, not transient network/fetch blips (like DevTools hard reloads)
    const isNetworkError = e instanceof TypeError || 
                           e.message === 'Failed to fetch' || 
                           e.message.includes('NetworkError') || 
                           e.message.includes('Load failed');
    if (navigator.onLine !== false && !isNetworkError) {
      showToast('Napaka pri sinhronizaciji rezultatov.');
    }
  }
}


// ── ACCOUNT PANEL ──
function _updateAccPanel() {
  const initials = (currentUser || '').slice(0, 2).toUpperCase();
  document.getElementById('accAvatar').textContent = initials;
  document.getElementById('accDisplayName').textContent = currentUser || '';
  document.getElementById('accImeInput').value = currentUser || '';
}
function toggleAccSection(id) {
  document.getElementById(id).classList.toggle('expanded');
}
function openAccountModal() {
  if (!authToken) { openAuthModal(); return; }
  document.getElementById('accError').textContent = '';
  document.querySelectorAll('.acc-section').forEach(s => s.classList.remove('expanded'));
  _updateAccPanel();
  document.getElementById('accountPanel').classList.add('open');
}
function closeAccountModal() { document.getElementById('accountPanel').classList.remove('open'); }
async function submitProfileChange(e) {
  e.preventDefault();
  const ime = document.getElementById('accImeInput').value.trim();
  try {
    const data = await apiPut('/auth/profile', { ime });
    authToken = data.token;
    currentUser = data.ime;
    localStorage.setItem('ssv_token', authToken);
    localStorage.setItem('ssv_user', currentUser);
    updateAuthUI();
    _updateAccPanel();
    showToast('Ime posodobljeno.');
  } catch (err) {
    document.getElementById('accError').textContent = err.message;
  }
}
async function submitPasswordChange(e) {
  e.preventDefault();
  const trenutno = document.getElementById('accTrenutno').value;
  const novo = document.getElementById('accNovo').value;
  try {
    await apiPut('/auth/password', { trenutno, novo });
    closeAccountModal();
    showToast('Geslo posodobljeno.');
  } catch (err) {
    document.getElementById('accError').textContent = err.message;
  }
}
async function submitDeleteAccount() {
  try {
    await apiDelete('/auth/account');
    closeAccountModal();
    doLogout();
    showToast('Račun je bil izbrisan.');
  } catch (err) {
    document.getElementById('accError').textContent = err.message;
  }
}

// Auth modal open/close
function openAuthModal(mode) {
  document.getElementById('authModal').classList.add('open');
  document.getElementById('authError').textContent = '';
  showAuthTab(mode || 'login');
}
function closeAuthModal() { document.getElementById('authModal').classList.remove('open'); }
function showAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('authTabLogin').classList.toggle('active', isLogin);
  document.getElementById('authTabRegister').classList.toggle('active', !isLogin);
  document.getElementById('authFormLogin').style.display = isLogin ? '' : 'none';
  document.getElementById('authFormRegister').style.display = isLogin ? 'none' : '';
  document.getElementById('authError').textContent = '';
}

function submitLogin(e) {
  e.preventDefault();
  doLogin(document.getElementById('loginInput').value.trim(),
    document.getElementById('loginGeslo').value);
}
function submitRegister(e) {
  e.preventDefault();
  doRegister(document.getElementById('regIme').value.trim(),
    document.getElementById('regEmail').value.trim(),
    document.getElementById('regGeslo').value);
}

// ── BROWSER COMPATIBILITY WARNING ──
function openInChrome() {
  const url = location.href;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isAndroid) {
    // Android intent URI — opens current URL specifically in Chrome
    const intent = 'intent://' + url.replace(/^https?:\/\//, '') +
      '#Intent;scheme=' + location.protocol.replace(':', '') +
      ';package=com.android.chrome;end';
    try { location.href = intent; } catch (e) { }
  } else if (isIOS) {
    // Try to open in Chrome on iOS using the googlechromes:// scheme
    const chromeUrl = url.replace(/^http/, 'googlechrome');
    try { location.href = chromeUrl; } catch (e) { }
  }

  // Common fallback/helper for PC or if schemes fail: Copy URL to clipboard
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('Povezava kopirana. Odprite jo v Chromu.');
    }).catch(() => {
      showToast('Kopirajte URL in odprite v Chromu.');
    });
  } else {
    showToast('Kopirajte URL in odprite v Chromu.');
  }
}
function dismissBrowserWarn() {
  sessionStorage.setItem('ssv_bwarn', '1');
  document.getElementById('browserWarnModal').classList.remove('open');
}

// Stop audio/priprava if user navigates away
window.addEventListener('pagehide', () => {
  if (_audioEl) { _audioEl.pause(); _audioEl = null; }
  if (_pripravaRaf) { cancelAnimationFrame(_pripravaRaf); _pripravaRaf = null; }
});

// ── INIT ──
// Show browser warning if Web Bluetooth not available and not dismissed this session
if (!navigator.bluetooth && sessionStorage.getItem('ssv_bwarn') !== '1') {
  document.getElementById('browserWarnModal').classList.add('open');
}
if (!darkOn) document.body.classList.add('light');
document.getElementById('darkTog').className = 'tog' + (darkOn ? ' on' : '');
updateHapticUI();
document.getElementById('ttsTog').className = 'tog' + (ttsOn ? ' on' : '');
// setDisc must run before pripravaDesc so the description shows the correct discipline
setDisc('zimska');
document.getElementById('pripravaTog').className = 'tog' + (pripravaOn ? ' on' : '');
const _pripravaBtn = document.getElementById('pripravaBtn');
if (_pripravaBtn) {
  _pripravaBtn.className = 'btn-priprava' + (pripravaOn ? ' on' : '');
  document.getElementById('pripravaBtnState').textContent = pripravaOn ? 'ON' : 'OFF';
}
if (pripravaOn) {
  const durata = discipline === 'letna' ? '3:00' : '1:00';
  document.getElementById('pripravaDesc').textContent = 'Odštevalnik ' + durata + ' (' + discipline + ')';
}
setDisplay(0, '');
// Restore last run and PR strips from local cache on init (instant, before async sync)
if (history.length > 0) {
  const prRun = history.reduce((best, r) => (!best || r.ms < best.ms) ? r : best, null);
  if (prRun) {
    pr = prRun.ms;
    document.getElementById('prTime').textContent = fmtFull(pr);
    document.getElementById('prStrip').style.opacity = '1';
  }
  document.getElementById('lastTime').textContent = history[0].time;
  document.getElementById('lastStrip').style.opacity = '1';
  updateTodayBestUI();
}
// Restore ekipa — highlight preset button if it matches, otherwise show in custom input
const ekipaIsPreset = [...document.querySelectorAll('.ekipa-opt')].some(b => b.dataset.e === ekipa);
document.querySelectorAll('.ekipa-opt').forEach(b => b.classList.toggle('active', b.dataset.e === ekipa));
if (!ekipaIsPreset) {
  const custom = document.getElementById('ekipaCustom');
  if (custom) custom.value = ekipa;
}
checkOrientation();
updateAuthUI();
if (authToken) {
  syncRunsFromServer();
  flushOfflineQueue();
  // Silent token refresh: if token expires within 2 days, renew it now
  try {
    const payload = JSON.parse(atob(authToken.split('.')[1]));
    if (payload.exp && (payload.exp - Date.now() / 1000) < 2 * 86400) {
      apiPost('/auth/refresh', {})
        .then(d => { if (d && d.token) { authToken = d.token; localStorage.setItem('ssv_token', authToken); } })
        .catch(() => {});
    }
  } catch {}
}

// Force logout when error-guard detects a failed token refresh
window.addEventListener('ssv:logout', () => doLogout());

// Flush queued offline runs when network is restored
window.addEventListener('online', () => flushOfflineQueue());

if (typeof startWatchdog === 'function') startWatchdog();

// Service worker registration (Phase 3 — offline/installable PWA)
// Skip service worker on localhost (dev) — avoids stale cache issues
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js');
