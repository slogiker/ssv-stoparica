// SSV Stoparica - Stopwatch Core, Audio Phase, Preparation Tone and Persistence

function tick() {
  elapsed = Date.now() - startTime;
  setDisplay(elapsed, 'running');
  rafId = requestAnimationFrame(tick);
}

// ── AUDIO CONTEXT & UNLOCK (Web Audio API & HTML5 Audio) ──
let _audioCtx = null;
function getAudioContext() {
  if (!_audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) _audioCtx = new AudioContextClass();
  }
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => { });
  }
  return _audioCtx;
}

// Pre-unlock audio resources synchronously inside user click event to disarm mobile autoplay blockers
function unlockAudio() {
  getAudioContext();

  if (soundOn) {
    try {
      if (!_audioEl) {
        _audioEl = new Audio(discipline === 'zimska' ? AUDIO_ZIMSKA : AUDIO_LETNA);
      } else {
        _audioEl.src = discipline === 'zimska' ? AUDIO_ZIMSKA : AUDIO_LETNA;
      }
      _audioEl.load();
      const p = _audioEl.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          _audioEl.pause();
          _audioEl.currentTime = 0;
        }).catch(() => { });
      }
    } catch (e) { }
  }

  if ('speechSynthesis' in window) {
    try {
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0.01;
      window.speechSynthesis.speak(primer);
    } catch (e) { }
  }
}

// Pre-cache voices when available
if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
  window.speechSynthesis.onvoiceschanged = () => {
    try { window.speechSynthesis.getVoices(); } catch (e) { }
  };
}

// ── LOUD PREPARATION TONE / BUZZER (Dual-oscillator sports horn tone) ──
function playLoudPrepTone(freq = 880, dur = 0.7) {
  if (!soundOn) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    const volEl = document.getElementById('volSlider');
    const vol = volEl ? (parseFloat(volEl.value) / 100) : 1.0;

    osc1.type = 'square';
    osc1.frequency.setValueAtTime(freq, ctx.currentTime);

    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(freq * 1.5, ctx.currentTime);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol * 0.95, ctx.currentTime + 0.02);
    gain.gain.setValueAtTime(vol * 0.95, ctx.currentTime + dur - 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + dur);
    osc2.stop(ctx.currentTime + dur);
  } catch (e) {
    console.warn('playLoudPrepTone error:', e);
  }
}

function playPrepTone(freq = 880, dur = 0.7) {
  playLoudPrepTone(freq, dur);
}

function playBeep(freq = 880, dur = 0.7) {
  playLoudPrepTone(freq, dur);
}

// Cancel audio/priprava phase and return to idle.
function cancelAudio() {
  _audioStarted = true; // disarm any pending audio callback
  if (_audioEl) {
    _audioEl.pause();
    _audioEl = null;
  }
  if (_pripravaRaf) { cancelAnimationFrame(_pripravaRaf); _pripravaRaf = null; }
  if (_pripravaPauseTimeout) { clearTimeout(_pripravaPauseTimeout); _pripravaPauseTimeout = null; }
  _pripravaEnd = null;
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) { }
  }
  soundPlaying = false;
  setDisplay(0, '');
  document.getElementById('timerLabel').textContent = 'ČAKANJE NA START';
  document.getElementById('startBtn').disabled = false;
  setStopButtonState(true);
  document.getElementById('resetBtn').disabled = true;
  lockUI(false);
}

async function handleStart() {
  console.log('UI_CONTROL: Start button clicked.');
  if (isRunning || soundPlaying) return;

  // Immediately unlock audio resources synchronously on user gesture
  unlockAudio();

  if (!bleChar && typeof showBleConfirm === 'function') {
    const proceed = await showBleConfirm();
    if (!proceed) return;
    showToast('Brez ESP2 - ustavite ročno');
  }
  lockUI(true);
  soundPlaying = true;
  vibrate(80);
  document.getElementById('startBtn').disabled = true;
  const lsStart = document.getElementById('lsStartBtn');
  if (lsStart) lsStart.disabled = true;
  setStopButtonState(false); // allow cancel at any point

  if (pripravaOn) {
    const totalMs = (discipline === 'letna' ? 180 : 60) * 1000;
    playLoudPrepTone(880, 0.7);
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
    playLoudPrepTone(880, 0.7);
    vibrate([80, 60, 120]);
    document.getElementById('timerLabel').textContent = 'PREMOR...';
    document.getElementById('timerMain').textContent = '00:00';
    document.getElementById('timerDec').textContent = '';
    document.getElementById('lsTimer').textContent = '00:00';
    _pripravaPauseTimeout = setTimeout(() => {
      _pripravaPauseTimeout = null;
      startSoundPhase();
    }, 2500);
    return;
  }
  // TODO: Dodaj številčni vnos (number input) za izbiro sekunde začetka odštevanja (npr. pri kateri sekundi se začne odštevati namesto fiksno 5)
  if (ttsOn && s <= 5 && s > 0 && s !== lastSpokenSec) {
    lastSpokenSec = s;
    speakPrepSeconds(s);
  }
  _pripravaRaf = requestAnimationFrame(tickPriprava);
}

function speakPrepSeconds(s) {
  if (!ttsOn || !('speechSynthesis' in window)) return;
  const numWordsSl = {
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
  const numWordsPl = {
    10: 'deset',
    9: 'devet',
    8: 'osem',
    7: 'sedem',
    6: 'szest',
    5: 'pet',
    4: 'sztiri',
    3: 'tri',
    2: 'dva',
    1: 'ena'
  };

  const voices = window.speechSynthesis.getVoices() || [];
  let preferredVoice = voices.find(v => (v.lang || '').toLowerCase().startsWith('sl'));
  let isPolish = false;

  if (!preferredVoice) {
    preferredVoice = voices.find(v => (v.name || '').includes('Google polski'))
      || voices.find(v => (v.name || '').toLowerCase().includes('polski') || (v.lang || '').toLowerCase().startsWith('pl'));
    if (preferredVoice) isPolish = true;
  }

  if (!preferredVoice && voices.length > 0) {
    preferredVoice = voices.find(v => v.default) || voices[0];
  }

  const word = isPolish ? numWordsPl[s] : numWordsSl[s];
  if (!word) return;

  const utterance = new SpeechSynthesisUtterance(word);
  if (preferredVoice) {
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice.lang || (isPolish ? 'pl-PL' : 'sl-SI');
  } else {
    utterance.lang = 'sl-SI';
  }
  utterance.rate = 1.05;
  utterance.pitch = 1.0;

  const volEl = document.getElementById('volSlider');
  utterance.volume = volEl ? (parseFloat(volEl.value) / 100) : 1.0;

  try {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    setTimeout(() => {
      try {
        window.speechSynthesis.speak(utterance);
      } catch (e) { }
    }, 15);
  } catch (e) { }
}

function startSoundPhase() {
  console.log('STOPWATCH: Starting preparation phase (sound=' + soundOn + ', discipline=' + discipline + ')...');
  document.getElementById('timerLabel').textContent = 'PRIPRAVA...';
  if (soundOn) {
    if (!_audioEl) {
      _audioEl = new Audio(discipline === 'zimska' ? AUDIO_ZIMSKA : AUDIO_LETNA);
    } else {
      _audioEl.src = discipline === 'zimska' ? AUDIO_ZIMSKA : AUDIO_LETNA;
    }
    const slider = document.getElementById('volSlider');
    _audioEl.volume = slider ? (parseFloat(slider.value) / 100) : 1.0;
    _audioEl.currentTime = 0;
    _audioStarted = false;

    function _onceStart() {
      if (!_audioStarted) {
        _audioStarted = true;
        startTimerActual();
      }
    }

    _audioEl.onended = _onceStart;
    _audioEl.onerror = (err) => {
      console.warn('Audio element playback error, falling back to WebAudio tone:', err);
      playLoudPrepTone(900, 0.7);
      setTimeout(_onceStart, 800);
    };

    const p = _audioEl.play();
    if (p !== undefined) {
      p.catch((err) => {
        console.warn('Audio play() failed/blocked, falling back to WebAudio tone:', err);
        playLoudPrepTone(900, 0.7);
        setTimeout(_onceStart, 800);
      });
    }
  } else {
    startTimerActual();
  }
}

function startTimerActual() {
  _audioEl = null;
  soundPlaying = false;
  isRunning = true;
  startTime = Date.now() - elapsed;
  rafId = requestAnimationFrame(tick);
  console.log('STOPWATCH: Timing started. Reference start time (ms):', startTime);
  document.getElementById('timerLabel').textContent = 'MERJENJE...';
  setStopButtonState(false);
  document.getElementById('resetBtn').disabled = true;
  const lsReset = document.getElementById('lsResetBtn');
  if (lsReset) lsReset.disabled = true;
  if (typeof requestWakeLock === 'function') requestWakeLock();
}

function handleStop(triggeredBy, stopTimestamp) {
  if (soundPlaying) {
    console.log('STOPWATCH: Stop request during audio preparation. Cancelling audio.');
    cancelAudio();
    return;
  }
  if (!isRunning) return;
  cancelAnimationFrame(rafId);
  isRunning = false;
  const nowTime = (typeof stopTimestamp === 'number' && stopTimestamp > 0) ? stopTimestamp : Date.now();
  elapsed = Math.max(0, nowTime - startTime);
  setDisplay(elapsed, 'stopped');
  console.log('STOPWATCH: Timing stopped by ' + (triggeredBy || 'UI') + '. Final elapsed:', elapsed, 'ms (' + fmtFull(elapsed) + ')');
  vibrate([60, 40, 100]);
  document.getElementById('timerLabel').textContent = 'USTAVLJENO';
  document.getElementById('startBtn').disabled = true;
  const lsStart = document.getElementById('lsStartBtn');
  if (lsStart) lsStart.disabled = true;
  setStopButtonState(true);
  document.getElementById('resetBtn').disabled = false;
  const lsReset = document.getElementById('lsResetBtn');
  if (lsReset) lsReset.disabled = false;
  lockUI(false);
  saveRun();
  if (typeof releaseWakeLock === 'function') releaseWakeLock();
}

function handleReset() {
  console.log('UI_CONTROL: Reset button clicked.');
  cancelAnimationFrame(rafId);
  isRunning = false;
  elapsed = 0;
  soundPlaying = false;
  _audioEl = null;
  _audioStarted = true;
  _pripravaRaf = null;
  _pripravaEnd = null;
  if (_pripravaPauseTimeout) { clearTimeout(_pripravaPauseTimeout); _pripravaPauseTimeout = null; }
  if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) { } }
  setDisplay(0, '');
  document.getElementById('timerLabel').textContent = 'ČAKANJE NA START';
  document.getElementById('startBtn').disabled = false;
  const lsStart = document.getElementById('lsStartBtn');
  if (lsStart) lsStart.disabled = false;
  setStopButtonState(true);
  document.getElementById('resetBtn').disabled = true;
  const lsReset = document.getElementById('lsResetBtn');
  if (lsReset) lsReset.disabled = true;
  lockUI(false);
}

// ── SAVE RUN ──
function saveRun() {
  const now = new Date();
  const entry = {
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
    const cas_s = parseFloat((elapsed / 1000).toFixed(3));
    apiPost('/runs', { ekipa, disciplina: discipline, cas_s })
      .then(run => { entry.id = run.id || entry.id; })
      .catch(() => {
        const qRaw = typeof safeStorage !== 'undefined' ? safeStorage.local.get('ssv_offline_queue') : localStorage.getItem('ssv_offline_queue');
        const q = JSON.parse(qRaw || '[]');
        q.push({ ekipa, disciplina: discipline, cas_s, _localId: entry.id });
        if (typeof safeStorage !== 'undefined') safeStorage.local.set('ssv_offline_queue', JSON.stringify(q));
        else localStorage.setItem('ssv_offline_queue', JSON.stringify(q));
        showToast('Ni povezave - vnos shranjen lokalno.');
        scheduleFlushOfflineQueue(5000);
      });
  }

  history.unshift(entry);
  localStorage.setItem('ssv_h', JSON.stringify(history));
  const isPR = pr === null || elapsed < pr;
  if (isPR) pr = elapsed;
  const lastTimeEl = document.getElementById('lastTime');
  const prTimeEl = document.getElementById('prTime');
  const prStrip = document.getElementById('prStrip');
  const prEl = document.getElementById('lastPr');
  const lastStrip = document.getElementById('lastStrip');

  if (lastTimeEl) lastTimeEl.textContent = entry.time;
  if (prTimeEl) prTimeEl.textContent = fmtFull(pr);
  if (prStrip) prStrip.style.opacity = '1';
  if (prEl) {
    prEl.className = 'last-pr' + (isPR ? ' show' : '');
    if (isPR) {
      prEl.classList.remove('pop');
      void prEl.offsetWidth; // force reflow
      prEl.classList.add('pop');
    }
  }
  if (lastStrip) lastStrip.style.opacity = '1';
  updateTodayBestUI();
  showToast((isPR ? '🏆 PR! ' : '') + entry.time + ' - ' + ekipa);
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
    el.textContent = '-';
    strip.style.opacity = '.5';
  }
}
