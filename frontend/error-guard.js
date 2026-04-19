(function () {
  // --- Banner ---
  const bannerStyle = document.createElement('style');
  bannerStyle.textContent = '#serverBanner{position:fixed;top:0;left:0;right:0;z-index:9999;background:#ff4040;color:#fff;text-align:center;font-size:13px;padding:8px;display:none;font-family:monospace;letter-spacing:0.05em;}';
  document.head.appendChild(bannerStyle);

  const banner = document.createElement('div');
  banner.id = 'serverBanner';
  banner.textContent = '⚠ Strežnik nedosegljiv';
  document.addEventListener('DOMContentLoaded', () => document.body.prepend(banner));

  // --- Global error handlers ---
  window.onerror = function (msg, src, line, col, err) {
    console.error('[error-guard] JS error:', msg, src, line, col, err);
    if (typeof showToast === 'function') showToast('Prišlo je do napake. Prosimo, osvežite stran.');
    return true;
  };

  window.onunhandledrejection = function (event) {
    console.error('[error-guard] Unhandled rejection:', event.reason);
    if (typeof showToast === 'function') showToast('Napaka pri operaciji. Poskusite znova.');
  };

  // --- Fetch wrapper ---
  const _fetch = window.fetch.bind(window);

  // Attempt silent token refresh. Returns new token string on success, null on failure.
  async function _tryRefresh() {
    const stored = localStorage.getItem('ssv_token');
    if (!stored) return null;
    try {
      const r = await _fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + stored }
      });
      if (!r.ok) return null;
      const { token } = await r.json();
      localStorage.setItem('ssv_token', token);
      return token;
    } catch {
      return null;
    }
  }

  window.fetch = async function (input, init) {
    const doRequest = (overrideInit) => _fetch(input, overrideInit ?? init);
    let res;
    try {
      res = await doRequest();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Ni internetne povezave.');
      throw e;
    }

    // Retry once on server errors (gateway/upstream restart race)
    if ([502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        res = await doRequest();
      } catch (e) {
        if (typeof showToast === 'function') showToast('Ni internetne povezave.');
        throw e;
      }
    }

    // On 401, try a silent token refresh and retry the original request once.
    // Skip this for auth routes themselves to avoid infinite loops.
    const url = typeof input === 'string' ? input : (input.url || '');
    if (res.status === 401 && !url.includes('/api/auth/')) {
      const newToken = await _tryRefresh();
      if (newToken) {
        const newInit = {
          ...(init || {}),
          headers: { ...(init?.headers || {}), Authorization: 'Bearer ' + newToken }
        };
        try {
          res = await doRequest(newInit);
        } catch (e) {
          if (typeof showToast === 'function') showToast('Ni internetne povezave.');
          throw e;
        }
      } else {
        // Refresh failed — session is truly expired; signal app to log out
        localStorage.removeItem('ssv_token');
        window.dispatchEvent(new Event('ssv:logout'));
      }
    }

    return res;
  };

  // --- Watchdog ---
  let missedChecks = 0;
  window.startWatchdog = function () {
    setInterval(async () => {
      try {
        const r = await _fetch('/api/health');
        if (r.ok) {
          missedChecks = 0;
          banner.style.display = 'none';
        } else {
          missedChecks++;
        }
      } catch {
        missedChecks++;
      }
      if (missedChecks >= 2) banner.style.display = 'block';
    }, 30000);
  };

  // --- Safe storage ---
  const memStore = new Map();
  function makeStorage(store) {
    return {
      get(key) {
        try { return store.getItem(key); } catch { return memStore.get(key) ?? null; }
      },
      set(key, val) {
        try { store.setItem(key, val); } catch { memStore.set(key, val); }
      },
      remove(key) {
        try { store.removeItem(key); } catch { memStore.delete(key); }
      }
    };
  }
  let _ls, _ss;
  try { localStorage.getItem('__test__'); _ls = localStorage; } catch { _ls = null; }
  try { sessionStorage.getItem('__test__'); _ss = sessionStorage; } catch { _ss = null; }

  window.safeStorage = {
    local: _ls ? makeStorage(_ls) : { get: k => memStore.get('l:'+k) ?? null, set: (k,v) => memStore.set('l:'+k,v), remove: k => memStore.delete('l:'+k) },
    session: _ss ? makeStorage(_ss) : { get: k => memStore.get('s:'+k) ?? null, set: (k,v) => memStore.set('s:'+k,v), remove: k => memStore.delete('s:'+k) }
  };

  // --- iOS viewport fix ---
  function setVh() {
    document.documentElement.style.setProperty('--real-vh', (window.innerHeight * 0.01) + 'px');
  }
  setVh();
  window.addEventListener('resize', setVh);
})();
