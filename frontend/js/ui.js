// SSV Stoparica - UI Helpers, Settings, and Layout Management

// ── HAPTIC FEEDBACK ──
function vibrate(pattern) {
  if (!hapticOn || !navigator.vibrate) return;
  const slider = document.getElementById('hapticSlider');
  const lvl = slider ? parseInt(slider.value) : 2;
  const scale = [0.5, 1, 1.8][lvl - 1] || 1;
  navigator.vibrate(Array.isArray(pattern) ? pattern.map(x => Math.round(x * scale)) : Math.round(pattern * scale));
}

function updateHapticUI() {
  const slider = document.getElementById('hapticSlider');
  if (slider) {
    slider.disabled = !hapticOn;
    slider.style.opacity = hapticOn ? '1' : '0.4';
  }
}

// ── TIMER FORMATTING ──
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function fmtDec(ms) { return '.' + String(Math.floor((ms % 1000) / 10)).padStart(2, '0'); }
function fmtFull(ms) { return fmt(ms) + fmtDec(ms); }

function setDisplay(ms, state) {
  const main = document.getElementById('timerMain');
  const dec = document.getElementById('timerDec');
  const wrap = document.getElementById('timerWrap');
  const ls = document.getElementById('lsTimer');
  const glow = document.getElementById('timerGlow');

  if (main) main.textContent = fmt(ms);
  if (dec) dec.textContent = fmtDec(ms);
  if (ls) {
    ls.innerHTML = fmt(ms) + '<span style="font-size:.45em;opacity:.5">' + fmtDec(ms) + '</span>';
    ls.className = 'landscape-timer' + (state ? ' ' + state : '');
  }
  if (wrap) wrap.className = 'timer-wrap' + (state ? ' ' + state : '');
  if (glow) glow.className = 'timer-glow' + (state === 'running' ? ' running' : '');
}

function setStopButtonState(disabled) {
  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) stopBtn.disabled = disabled;
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

// Lock/unlock interactive controls during PRIPRAVA / MERJENJE phases
function lockUI(locked) {
  ['authBtn', 'historyBtn', 'settingsBtn', 'soundBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  document.querySelectorAll('.ekipa-opt').forEach(b => b.disabled = locked);
}

// ── DISCIPLINE & TEAM ──
function setDisc(d) {
  discipline = d;
  const bZ = document.getElementById('badgeZ');
  const bL = document.getElementById('badgeL');
  const sel = document.getElementById('discSelect');
  if (bZ) bZ.className = 'badge' + (d === 'zimska' ? ' active' : '');
  if (bL) bL.className = 'badge' + (d === 'letna' ? ' active' : '');
  if (sel) sel.value = d;

  // Keep priprava description in sync when discipline changes
  if (pripravaOn) {
    const durata = d === 'letna' ? '3:00' : '1:00';
    const desc = document.getElementById('pripravaDesc');
    if (desc) desc.textContent = 'Odštevalnik ' + durata + ' (' + d + ')';
  }
}
function discChanged() { setDisc(document.getElementById('discSelect').value); }

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

// ── SETTINGS TOGGLES ──
function toggleSound() {
  soundOn = !soundOn;
  const tog = document.getElementById('soundTog');
  const btn = document.getElementById('soundBtn');
  if (tog) tog.className = 'tog' + (soundOn ? ' on' : '');
  if (btn) {
    btn.className = 'ico-btn' + (soundOn ? ' lit' : '');
    btn.innerHTML = soundOn ? '&#128266;' : '&#128263;';
  }
}

function toggleHaptic() {
  hapticOn = !hapticOn;
  const tog = document.getElementById('hapticTog');
  if (tog) tog.className = 'tog' + (hapticOn ? ' on' : '');
  updateHapticUI();
}

function toggleDark() {
  darkOn = !darkOn;
  localStorage.setItem('ssv_dark', darkOn ? '1' : '0');
  document.body.classList.toggle('light', !darkOn);
  const tog = document.getElementById('darkTog');
  if (tog) tog.className = 'tog' + (darkOn ? ' on' : '');
}

function toggleTts() {
  ttsOn = !ttsOn;
  localStorage.setItem('ssv_tts', ttsOn ? '1' : '0');
  const tog = document.getElementById('ttsTog');
  if (tog) tog.className = 'tog' + (ttsOn ? ' on' : '');
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
  if (hundredths > 0) text += ' in ' + getNumberWords(hundredths);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'sl-SI';
  const voices = window.speechSynthesis.getVoices();
  const slVoice = voices.find(v => v.lang.startsWith('sl'));
  if (slVoice) utterance.voice = slVoice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function togglePriprava() {
  pripravaOn = !pripravaOn;
  localStorage.setItem('ssv_priprava', pripravaOn ? '1' : '0');
  const tog = document.getElementById('pripravaTog');
  if (tog) tog.className = 'tog' + (pripravaOn ? ' on' : '');
  const durata = discipline === 'letna' ? '3:00' : '1:00';
  const desc = document.getElementById('pripravaDesc');
  if (desc) {
    desc.textContent = pripravaOn
      ? 'Odštevalnik ' + durata + ' (' + discipline + ')'
      : 'Odštevalnik pred startom';
  }
  const btn = document.getElementById('pripravaBtn');
  if (btn) {
    btn.className = 'btn-priprava' + (pripravaOn ? ' on' : '');
    const stateEl = document.getElementById('pripravaBtnState');
    if (stateEl) stateEl.textContent = pripravaOn ? 'ON' : 'OFF';
  }
}

function togglePwd(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.classList.toggle('visible', show);
}

// ── OVERLAY PANELS ──
function openSettings() {
  const panel = document.getElementById('settingsPanel');
  if (panel) panel.classList.add('open');
}
function closeSettings() {
  const panel = document.getElementById('settingsPanel');
  if (panel) panel.classList.remove('open');
}

// ── WAKE LOCK ──
let wakeLock = null;
async function requestWakeLock() {
  if (wakeLock) return;
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { }
}
function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// ── LANDSCAPE & ORIENTATION ──
function checkOrientation() {
  document.body.classList.toggle('landscape-mode', window.matchMedia('(orientation:landscape)').matches);
}
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 100));
window.addEventListener('resize', checkOrientation);

// ── TOAST NOTIFICATIONS ──
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ── EXPORT CSV ──
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

// ── HISTORY IFRAME PANEL ──
function openHistoryPanel() {
  const panel = document.getElementById('historyPanel');
  const frame = document.getElementById('historyFrame');
  if (!panel || !frame) {
    location.href = 'history.html';
    return;
  }
  if (!frame.src || frame.src.endsWith('about:blank')) {
    frame.src = 'history.html';
  } else {
    try {
      if (frame.contentWindow && typeof frame.contentWindow.loadRuns === 'function') {
        frame.contentWindow.loadRuns();
      }
    } catch (_) {}
  }
  panel.classList.add('open');
}
window.openHistoryPanel = openHistoryPanel;

function closeHistoryPanel() {
  const panel = document.getElementById('historyPanel');
  if (panel) panel.classList.remove('open');
  if (typeof syncRunsFromServer === 'function') {
    syncRunsFromServer();
  }
}
window.closeHistoryPanel = closeHistoryPanel;

function downloadLogs() {
  console.log('UI_CONTROL: User requested download of diagnostic logs.');
  const logsText = (window.consoleLogs || []).map(l => `[${l.time}] [${l.level}] ${l.message}`).join('\n');
  const blob = new Blob([logsText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ssv_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Dnevniki preneseni. Pošljite jih na report@slogiker.si');
}

// ── BROWSER COMPATIBILITY ──
function openInChrome() {
  const url = location.href;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isAndroid) {
    const intent = 'intent://' + url.replace(/^https?:\/\//, '') +
      '#Intent;scheme=' + location.protocol.replace(':', '') +
      ';package=com.android.chrome;end';
    try { location.href = intent; } catch (e) { }
  } else if (isIOS) {
    const chromeUrl = url.replace(/^http/, 'googlechrome');
    try { location.href = chromeUrl; } catch (e) { }
  }

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
  console.warn('USER_DECISION: User rejected switching browser and decided to continue without BLE.');
  sessionStorage.setItem('ssv_bwarn', '1');
  const modal = document.getElementById('browserWarnModal');
  if (modal) modal.classList.remove('open');
}
