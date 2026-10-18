// SSV Stoparica - Application Entrypoint and Lifecycle Orchestration

// ── BROWSER & LIFECYCLE LISTENERS ──
window.addEventListener('pagehide', () => {
  if (_audioEl) { _audioEl.pause(); _audioEl = null; }
  if (_pripravaRaf) { cancelAnimationFrame(_pripravaRaf); _pripravaRaf = null; }
  if (_pripravaPauseTimeout) { clearTimeout(_pripravaPauseTimeout); _pripravaPauseTimeout = null; }
  if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) { } }
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && isRunning) {
    if (typeof requestWakeLock === 'function') await requestWakeLock();
  }
});

// Force logout when error-guard detects a failed token refresh
window.addEventListener('ssv:logout', () => {
  if (typeof doLogout === 'function') doLogout();
});

// Flush queued offline runs when network is restored
window.addEventListener('online', () => {
  if (typeof flushOfflineQueue === 'function') flushOfflineQueue();
});

// ── INITIALIZATION ──
function initApp() {
  // Show browser warning if Web Bluetooth not available and not dismissed this session
  if (!navigator.bluetooth && sessionStorage.getItem('ssv_bwarn') !== '1') {
    const modal = document.getElementById('browserWarnModal');
    if (modal) modal.classList.add('open');
  }

  // Theme setup
  if (!darkOn) document.body.classList.add('light');
  const darkTog = document.getElementById('darkTog');
  if (darkTog) darkTog.className = 'tog' + (darkOn ? ' on' : '');

  if (typeof updateHapticUI === 'function') updateHapticUI();

  const ttsTog = document.getElementById('ttsTog');
  if (ttsTog) ttsTog.className = 'tog' + (ttsOn ? ' on' : '');

  // Discipline setup (must run before pripravaDesc so description reflects discipline)
  if (typeof setDisc === 'function') setDisc('zimska');

  const pripravaTog = document.getElementById('pripravaTog');
  if (pripravaTog) pripravaTog.className = 'tog' + (pripravaOn ? ' on' : '');

  const pripravaBtn = document.getElementById('pripravaBtn');
  if (pripravaBtn) {
    pripravaBtn.className = 'btn-priprava' + (pripravaOn ? ' on' : '');
    const stateEl = document.getElementById('pripravaBtnState');
    if (stateEl) stateEl.textContent = pripravaOn ? 'ON' : 'OFF';
  }

  if (pripravaOn) {
    const durata = discipline === 'letna' ? '3:00' : '1:00';
    const desc = document.getElementById('pripravaDesc');
    if (desc) desc.textContent = 'Odštevalnik ' + durata + ' (' + discipline + ')';
  }

  if (typeof setDisplay === 'function') setDisplay(0, '');

  // Restore last run and PR strips from local cache on init (instant)
  if (history.length > 0) {
    const prRun = history.reduce((best, r) => (!best || r.ms < best.ms) ? r : best, null);
    if (prRun) {
      pr = prRun.ms;
      const prTimeEl = document.getElementById('prTime');
      const prStrip = document.getElementById('prStrip');
      if (prTimeEl && typeof fmtFull === 'function') prTimeEl.textContent = fmtFull(pr);
      if (prStrip) prStrip.style.opacity = '1';
    }
    const lastTimeEl = document.getElementById('lastTime');
    const lastStrip = document.getElementById('lastStrip');
    if (lastTimeEl) lastTimeEl.textContent = history[0].time;
    if (lastStrip) lastStrip.style.opacity = '1';
    if (typeof updateTodayBestUI === 'function') updateTodayBestUI();
  }

  // Restore ekipa - highlight preset button if it matches, otherwise show in custom input
  const ekipaIsPreset = [...document.querySelectorAll('.ekipa-opt')].some(b => b.dataset.e === ekipa);
  document.querySelectorAll('.ekipa-opt').forEach(b => b.classList.toggle('active', b.dataset.e === ekipa));
  if (!ekipaIsPreset) {
    const custom = document.getElementById('ekipaCustom');
    if (custom) custom.value = ekipa;
  }

  if (typeof checkOrientation === 'function') checkOrientation();
  if (typeof updateAuthUI === 'function') updateAuthUI();

  // Logged-in startup sync & silent token refresh
  if (authToken) {
    if (typeof syncRunsFromServer === 'function') syncRunsFromServer();
    if (typeof flushOfflineQueue === 'function') flushOfflineQueue();

    try {
      const payload = JSON.parse(atob(authToken.split('.')[1]));
      if (payload.exp && (payload.exp - Date.now() / 1000) < 2 * 86400) {
        if (typeof apiPost === 'function') {
          apiPost('/auth/refresh', {})
            .then(d => { if (d && d.token) { authToken = d.token; localStorage.setItem('ssv_token', authToken); } })
            .catch(() => {});
        }
      }
    } catch (_) {}
  }

  if (typeof startWatchdog === 'function') startWatchdog();

  // Service worker registration (offline/installable PWA)
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW:', e));
  }

  // Initial startup BLE connection
  (async () => {
    if (authToken && typeof fetchDevices === 'function') {
      try { await fetchDevices(); } catch (_) {}
    }
    if (typeof bleAutoConnect === 'function') bleAutoConnect();
  })();
}

// Run init when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
