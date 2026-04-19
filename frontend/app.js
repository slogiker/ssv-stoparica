// ── STATE ──
let isRunning = false, startTime = null, elapsed = 0, rafId = null;
let soundOn = true, hapticOn = true, darkOn = localStorage.getItem('ssv_dark') !== '0';
let discipline = 'letna';
let ekipa = localStorage.getItem('ssv_ekipa') || 'Člani-A';
let bleDevice = null, bleChar = null, bleServer = null, reconnectTimer = null;
let _reconnectDelay = 2000;
let _bleConfirmResolve = null;
let soundPlaying = false;
let pripravaOn = localStorage.getItem('ssv_priprava') === '1';
let _pripravaRaf = null, _pripravaEnd = null;
let history = JSON.parse(sessionStorage.getItem('ssv_h') || '[]');
let pr = null;

// Auth state
let authToken = localStorage.getItem('ssv_token') || null;
let currentUser = null;

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
  document.getElementById('stopBtn').disabled = true;
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
  document.getElementById('stopBtn').disabled = false; // allow cancel at any point

  if (pripravaOn) {
    const totalMs = (discipline === 'letna' ? 180 : 60) * 1000;
    playBeep(880, 0.5);
    document.getElementById('timerLabel').textContent = 'PRIPRAVA ORODJA';
    _pripravaEnd = Date.now() + totalMs;
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
  _pripravaRaf = requestAnimationFrame(tickPriprava);
}

function startSoundPhase() {
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
  document.getElementById('timerLabel').textContent = 'MERJENJE...';
  document.getElementById('stopBtn').disabled = false;
  document.getElementById('resetBtn').disabled = true;
  requestWakeLock();
}

function handleStop() {
  if (soundPlaying) { cancelAudio(); return; }
  if (!isRunning) return;
  cancelAnimationFrame(rafId); isRunning = false;
  elapsed = Date.now() - startTime; setDisplay(elapsed, 'stopped');
  vibrate([60, 40, 100]);
  document.getElementById('timerLabel').textContent = 'USTAVLJENO';
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('resetBtn').disabled = false;
  lockUI(false);
  saveRun();
  releaseWakeLock();
}

function handleReset() {
  cancelAnimationFrame(rafId); isRunning = false; elapsed = 0;
  soundPlaying = false; _audioEl = null; _audioStarted = true; _pripravaRaf = null; _pripravaEnd = null;
  setDisplay(0, '');
  document.getElementById('timerLabel').textContent = 'ČAKANJE NA START';
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
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
    time: fmtFull(elapsed)
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
  sessionStorage.setItem('ssv_h', JSON.stringify(history));
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
  const svc = sessionStorage.getItem('ssv_svc') || DEFAULT_SVC;
  const chr = sessionStorage.getItem('ssv_chr') || DEFAULT_CHR;
  return { svc, chr };
}

function setDot(state, label) {
  document.getElementById('bleDot').className = 'ble-dot' + (state ? ' ' + state : '');
  document.getElementById('bleLabel').textContent = label;
}

async function bleConnect() {
  if (!navigator.bluetooth) { showToast('Web Bluetooth ni podprt v tem brskalniku'); return; }
  const { svc, chr } = getDeviceUUIDs();
  setDot('scanning', 'Išče SSV-STOP...');
  try {
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'SSV-STOP' }],
      optionalServices: [svc]
    });
    bleDevice.addEventListener('gattserverdisconnected', onDisconn);
    await bleGattConnect(svc, chr);
    showToast('BLE vzpostavljena ✓');
    document.getElementById('bleDeviceDesc').textContent = bleDevice.name || 'SSV-STOP';
  } catch (e) {
    setDot('lost', 'Napaka — tapni za ponovni poskus');
    showToast('BLE: ' + e.message);
  }
}

async function bleGattConnect(svc, chr) {
  bleServer = await bleDevice.gatt.connect();
  const service = await bleServer.getPrimaryService(svc);
  bleChar = await service.getCharacteristic(chr);
  await bleChar.startNotifications();
  bleChar.addEventListener('characteristicvaluechanged', onBleVal);
  setDot('connected', bleDevice.name || 'SSV-STOP');
  // TODO Phase 1: subscribe to battery level characteristic (0x180F) once ADC is wired on ESP
}

function onBleVal(e) {
  if (e.target.value.getUint8(0) === 0x01 && isRunning) handleStop();
}

function onDisconn() {
  bleChar = null;
  bleServer = null;
  setDot('lost', 'Prekinjena — znova se povezujem...');
  clearTimeout(reconnectTimer);
  scheduleReconnect();
}

function scheduleReconnect() {
  reconnectTimer = setTimeout(async () => {
    if (!bleDevice || bleChar) return; // forgotten or already reconnected
    const { svc, chr } = getDeviceUUIDs();
    try {
      await bleGattConnect(svc, chr);
      _reconnectDelay = 2000; // reset on success
    } catch {
      _reconnectDelay = Math.min(_reconnectDelay * 2, 10000);
      scheduleReconnect();
    }
  }, _reconnectDelay);
}

function forgetDevice() {
  clearTimeout(reconnectTimer);
  _reconnectDelay = 2000;
  if (bleDevice) bleDevice.removeEventListener('gattserverdisconnected', onDisconn);
  bleDevice = null; bleChar = null; bleServer = null;
  sessionStorage.removeItem('ssv_svc');
  sessionStorage.removeItem('ssv_chr');
  setDot('', 'Tapni za povezavo z ESP2');
  document.getElementById('bleDeviceDesc').textContent = 'Ni shranjene naprave';
  showToast('Naprava pozabljena');
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
}
function toggleDark() {
  darkOn = !darkOn;
  localStorage.setItem('ssv_dark', darkOn ? '1' : '0');
  document.body.classList.toggle('light', !darkOn);
  document.getElementById('darkTog').className = 'tog' + (darkOn ? ' on' : '');
}
function setEkipa(el) {
  ekipa = el.dataset.e;
  localStorage.setItem('ssv_ekipa', ekipa);
  document.querySelectorAll('.ekipa-opt').forEach(b => b.classList.toggle('active', b.dataset.e === ekipa));
  const custom = document.getElementById('ekipaCustom');
  if (custom) custom.value = '';
}

function setEkipaCustom(val) {
  if (!val.trim()) return;
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
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release(); wakeLock = null; } }

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
async function doLogin(login, geslo) {
  try {
    const data = await apiPost('/auth/login', { login, geslo });
    authToken = data.token;
    currentUser = data.ime;
    localStorage.setItem('ssv_token', authToken);
    closeAuthModal();
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
    closeAuthModal();
    updateAuthUI();
    showToast('Registracija uspešna. Dobrodošel, ' + currentUser + '!');
  } catch (e) {
    document.getElementById('authError').textContent = e.message;
  }
}

function doLogout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('ssv_token');
  history = []; sessionStorage.removeItem('ssv_h');
  pr = null;
  // Clear both strips so a new guest session starts clean
  document.getElementById('lastTime').textContent = '\u2014';
  document.getElementById('prTime').textContent = '\u2014';
  document.getElementById('lastPr').className = 'last-pr';
  document.getElementById('lastStrip').style.opacity = '.5';
  document.getElementById('prStrip').style.opacity = '.5';
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

function updateAuthUI() {
  const btn = document.getElementById('authBtn');
  if (currentUser) {
    btn.textContent = currentUser.slice(0, 2).toUpperCase();
    btn.classList.add('lit');
    btn.title = 'Račun (' + currentUser + ')';
    btn.onclick = openAccountModal;
  } else {
    btn.innerHTML = '&#128100;';
    btn.classList.remove('lit');
    btn.title = 'Prijava / Registracija';
    btn.onclick = openAuthModal;
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
        datum: new Date(iso).toLocaleString('sl-SI'),
        datumIso: new Date(iso).toISOString(),
        ekipa: r.ekipa || '—',
        disc: r.disciplina,
        ms: Math.round(r.cas_s * 1000),
        time: fmtFull(Math.round(r.cas_s * 1000))
      };
    });
    sessionStorage.setItem('ssv_h', JSON.stringify(history));
    const prRun = history.reduce((best, r) => (!best || r.ms < best.ms) ? r : best, null);
    if (prRun) {
      pr = prRun.ms;
      document.getElementById('prTime').textContent = fmtFull(pr);
      document.getElementById('prStrip').style.opacity = '1';
    }
  } catch (e) {
    showToast('Napaka pri sinhronizaciji rezultatov.');
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
  // Android intent URI — opens current URL in Chrome
  const intent = 'intent://' + url.replace(/^https?:\/\//, '') +
    '#Intent;scheme=' + location.protocol.replace(':', '') +
    ';package=com.android.chrome;end';
  try { location.href = intent; } catch (e) { }
  // Fallback: copy URL hint
  setTimeout(() => showToast('Kopirajte URL in odprite v Chromu'), 800);
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
