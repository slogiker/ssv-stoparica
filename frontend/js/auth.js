// SSV Stoparica - Authentication, Profile, Migration, and Server Sync

let _migrationResolve = null;

function checkMigration() {
  const stored = JSON.parse(localStorage.getItem('ssv_h') || '[]');
  if (!stored.length) return;
  const textEl = document.getElementById('migrationText');
  if (textEl) {
    textEl.textContent = `Našli smo ${stored.length} shranjenih rezultatov iz tega tedna. Jih želite prenesti na svoj račun?`;
  }
  const modal = document.getElementById('migrationModal');
  if (modal) modal.classList.add('open');
  return new Promise(resolve => { _migrationResolve = resolve; });
}

async function resolveMigration(confirm) {
  const modal = document.getElementById('migrationModal');
  if (modal) modal.classList.remove('open');
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
    await fetchDevices();
    if (!bleChar && !_isConnecting && typeof bleAutoConnect === 'function') {
      bleAutoConnect();
    }
  } catch (e) {
    const errEl = document.getElementById('authError');
    if (errEl) errEl.textContent = e.message;
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
    syncRunsFromServer();
    await fetchDevices();
    if (!bleChar && !_isConnecting && typeof bleAutoConnect === 'function') {
      bleAutoConnect();
    }
  } catch (e) {
    const errEl = document.getElementById('authError');
    if (errEl) errEl.textContent = e.message;
  }
}

function doLogout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('ssv_token');
  localStorage.removeItem('ssv_user');
  localStorage.removeItem('ssv_friendly_name');
  savedDevices = [];
  if (typeof updateDevicesUI === 'function') updateDevicesUI();
  history = [];
  localStorage.removeItem('ssv_h');
  pr = null;

  const lastTime = document.getElementById('lastTime');
  const prTime = document.getElementById('prTime');
  const todayTime = document.getElementById('todayTime');
  const lastPr = document.getElementById('lastPr');
  const lastStrip = document.getElementById('lastStrip');
  const prStrip = document.getElementById('prStrip');
  const todayStrip = document.getElementById('todayStrip');

  if (lastTime) lastTime.textContent = '-';
  if (prTime) prTime.textContent = '-';
  if (todayTime) todayTime.textContent = '-';
  if (lastPr) lastPr.className = 'last-pr';
  if (lastStrip) lastStrip.style.opacity = '.5';
  if (prStrip) prStrip.style.opacity = '.5';
  if (todayStrip) todayStrip.style.opacity = '.5';

  updateAuthUI();
  showToast('Odjavljeni ste.');
}

function getRoleFromToken() {
  if (!authToken) return 'user';
  try {
    const base64Url = authToken.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload).vloga || 'user';
  } catch (e) {
    return 'user';
  }
}

function updateAuthUI() {
  const btn = document.getElementById('authBtn');
  const saveBtn = document.getElementById('btnSaveDevice');
  const adminRow = document.getElementById('adminRow');
  if (!btn) return;

  if (currentUser) {
    btn.textContent = currentUser.slice(0, 2).toUpperCase();
    btn.classList.add('lit');
    btn.title = 'Račun (' + currentUser + ')';
    btn.onclick = openAccountModal;
    if (saveBtn) saveBtn.style.display = '';
    const isAdmin = getRoleFromToken() === 'admin';
    if (adminRow) adminRow.style.display = isAdmin ? 'flex' : 'none';
    if (typeof fetchDevices === 'function') fetchDevices();
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

let _syncRunsRetryTimer = null;
async function syncRunsFromServer() {
  if (!authToken) return;
  try {
    const runs = await apiGet('/runs');
    if (_syncRunsRetryTimer) { clearTimeout(_syncRunsRetryTimer); _syncRunsRetryTimer = null; }
    history = runs.map((r) => {
      const iso = r.datum.replace(' ', 'T');
      return {
        id: r.id,
        datum: new Date(iso + 'Z').toLocaleString('sl-SI'),
        datumIso: new Date(iso + 'Z').toISOString(),
        ekipa: r.ekipa || '-',
        disc: r.disciplina,
        ms: Math.round(r.cas_s * 1000),
        time: fmtFull(Math.round(r.cas_s * 1000))
      };
    });
    localStorage.setItem('ssv_h', JSON.stringify(history));
    const prRun = history.reduce((best, r) => (!best || r.ms < best.ms) ? r : best, null);
    if (prRun) {
      pr = prRun.ms;
      const prTimeEl = document.getElementById('prTime');
      const prStrip = document.getElementById('prStrip');
      if (prTimeEl) prTimeEl.textContent = fmtFull(pr);
      if (prStrip) prStrip.style.opacity = '1';
    }
    if (history.length > 0) {
      const lastTimeEl = document.getElementById('lastTime');
      const lastStrip = document.getElementById('lastStrip');
      if (lastTimeEl) lastTimeEl.textContent = history[0].time;
      if (lastStrip) lastStrip.style.opacity = '1';
    }
  } catch (e) {
    console.warn('Runs sync paused/failed:', e.message);
    const isTransient = e.message === _TRANSIENT_MSG ||
                        e instanceof TypeError || 
                        e.message === 'Failed to fetch' || 
                        e.message.includes('NetworkError') || 
                        e.message.includes('Load failed');
    if (!isTransient && (!history || history.length === 0) && navigator.onLine !== false) {
      showToast('Napaka pri sinhronizaciji rezultatov.');
    }
    if (!_syncRunsRetryTimer) {
      _syncRunsRetryTimer = setTimeout(() => {
        _syncRunsRetryTimer = null;
        if (authToken) syncRunsFromServer();
      }, 15000);
    }
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

// ── ACCOUNT MODAL & SECTIONS ──
function _updateAccPanel() {
  const initials = (currentUser || '').slice(0, 2).toUpperCase();
  const avatar = document.getElementById('accAvatar');
  const name = document.getElementById('accDisplayName');
  const input = document.getElementById('accImeInput');
  if (avatar) avatar.textContent = initials;
  if (name) name.textContent = currentUser || '';
  if (input) input.value = currentUser || '';
}

function toggleAccSection(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('expanded');
}

function openAccountModal() {
  if (!authToken) { openAuthModal(); return; }
  const err = document.getElementById('accError');
  if (err) err.textContent = '';
  document.querySelectorAll('.acc-section').forEach(s => s.classList.remove('expanded'));
  _updateAccPanel();
  const panel = document.getElementById('accountPanel');
  if (panel) panel.classList.add('open');
}

function closeAccountModal() {
  const panel = document.getElementById('accountPanel');
  if (panel) panel.classList.remove('open');
}

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
    const errEl = document.getElementById('accError');
    if (errEl) errEl.textContent = err.message;
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
    const errEl = document.getElementById('accError');
    if (errEl) errEl.textContent = err.message;
  }
}

async function submitDeleteAccount() {
  try {
    await apiDelete('/auth/account');
    closeAccountModal();
    doLogout();
    showToast('Račun je bil izbrisan.');
  } catch (err) {
    const errEl = document.getElementById('accError');
    if (errEl) errEl.textContent = err.message;
  }
}

// ── AUTH MODAL ──
function openAuthModal(mode) {
  const modal = document.getElementById('authModal');
  const err = document.getElementById('authError');
  if (modal) modal.classList.add('open');
  if (err) err.textContent = '';
  showAuthTab(mode || 'login');
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('open');
}

function showAuthTab(tab) {
  const isLogin = tab === 'login';
  const tabLogin = document.getElementById('authTabLogin');
  const tabReg = document.getElementById('authTabRegister');
  const formLogin = document.getElementById('authFormLogin');
  const formReg = document.getElementById('authFormRegister');
  const err = document.getElementById('authError');

  if (tabLogin) tabLogin.classList.toggle('active', isLogin);
  if (tabReg) tabReg.classList.toggle('active', !isLogin);
  if (formLogin) formLogin.style.display = isLogin ? '' : 'none';
  if (formReg) formReg.style.display = isLogin ? 'none' : '';
  if (err) err.textContent = '';
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
