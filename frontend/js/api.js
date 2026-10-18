// SSV Stoparica - API and Network Helpers

const API = '/api';
const _TRANSIENT_MSG = 'Strežnik ni dosegljiv. Poskusite znova.';

function _assertJson(r) {
  const ct = r.headers.get('content-type') || '';
  if (!ct.startsWith('application/json'))
    throw new Error(_TRANSIENT_MSG);
}

async function _safeJson(r) {
  _assertJson(r);
  try { return await r.json(); }
  catch { throw new Error(_TRANSIENT_MSG); }
}

// Retry wrapper: silently retries on transient connectivity errors
// (non-JSON responses from proxy, network failures) before surfacing to user.
async function _withRetry(fn, retries = 2, delayMs = 3000) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isTransient = e.message === _TRANSIENT_MSG
                       || e.name === 'TypeError'      // network error (fetch threw)
                       || e.message === 'Failed to fetch';
      if (isTransient && attempt < retries) {
        console.warn(`[api] Transient error, retry ${attempt + 1}/${retries} in ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
}

async function apiPost(path, body) {
  return _withRetry(async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    const r = await fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await _safeJson(r);
    if (!r.ok) throw new Error(data.napaka || 'Napaka strežnika.');
    return data;
  });
}

async function apiGet(path) {
  return _withRetry(async () => {
    const r = await fetch(API + path, { headers: { 'Authorization': 'Bearer ' + authToken } });
    const data = await _safeJson(r);
    if (!r.ok) throw new Error(data.napaka || 'Napaka strežnika.');
    return data;
  });
}

async function apiDelete(path) {
  return _withRetry(async () => {
    const r = await fetch(API + path, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + authToken } });
    if (r.status === 204) return;
    const data = await _safeJson(r);
    if (!r.ok) throw new Error(data.napaka || 'Napaka strežnika.');
  });
}

async function apiPut(path, body) {
  return _withRetry(async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    const r = await fetch(API + path, { method: 'PUT', headers, body: JSON.stringify(body) });
    const data = await _safeJson(r);
    if (!r.ok) throw new Error(data.napaka || 'Napaka strežnika.');
    return data;
  });
}

// ── OFFLINE QUEUE ──
let _offlineQueueTimer = null;
function scheduleFlushOfflineQueue(delayMs = 10000) {
  if (_offlineQueueTimer) return;
  _offlineQueueTimer = setTimeout(async () => {
    _offlineQueueTimer = null;
    await flushOfflineQueue();
  }, delayMs);
}

async function flushOfflineQueue() {
  if (!authToken) return;
  const raw = typeof safeStorage !== 'undefined' ? safeStorage.local.get('ssv_offline_queue') : localStorage.getItem('ssv_offline_queue');
  if (!raw) return;
  let q;
  try { q = JSON.parse(raw); } catch {
    if (typeof safeStorage !== 'undefined') safeStorage.local.remove('ssv_offline_queue');
    else localStorage.removeItem('ssv_offline_queue');
    return;
  }
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
    if (typeof safeStorage !== 'undefined') safeStorage.local.set('ssv_offline_queue', JSON.stringify(failed));
    else localStorage.setItem('ssv_offline_queue', JSON.stringify(failed));
    scheduleFlushOfflineQueue(20000);
  } else {
    if (typeof safeStorage !== 'undefined') safeStorage.local.remove('ssv_offline_queue');
    else localStorage.removeItem('ssv_offline_queue');
    if (_offlineQueueTimer) { clearTimeout(_offlineQueueTimer); _offlineQueueTimer = null; }
    showToast('Lokalni vnosi sinhronizirani.');
    if (typeof syncRunsFromServer === 'function') syncRunsFromServer();
  }
}
