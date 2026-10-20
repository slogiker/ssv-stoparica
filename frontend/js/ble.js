// SSV Stoparica - Bluetooth Low Energy (BLE) Hardware Integration

const DEFAULT_SVC = '12345678-1234-1234-1234-123456789012';
const DEFAULT_CHR = '12345678-1234-1234-1234-123456789abc';

let _isConnecting = false;
let _reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// BLE confirm dialog helpers
function bleConfirmResolve(v) {
  if (v) {
    if (typeof unlockAudio === 'function') unlockAudio();
    const cb = document.getElementById('bleNoShow');
    if (cb && cb.checked) localStorage.setItem('ssv_ble_noshow', '1');
  }
  const modal = document.getElementById('bleConfirmModal');
  if (modal) modal.classList.remove('open');
  if (_bleConfirmResolve) { _bleConfirmResolve(v); _bleConfirmResolve = null; }
}

function showBleConfirm() {
  if (localStorage.getItem('ssv_ble_noshow') === '1') return Promise.resolve(true);
  return new Promise(resolve => {
    _bleConfirmResolve = resolve;
    const cb = document.getElementById('bleNoShow');
    if (cb) cb.checked = false;
    const modal = document.getElementById('bleConfirmModal');
    if (modal) modal.classList.add('open');
  });
}

function getDeviceUUIDs() {
  const params = new URLSearchParams(window.location.search);
  const svcFromUrl = params.get('device');
  const chrFromUrl = params.get('char');
  if (svcFromUrl) {
    sessionStorage.setItem('ssv_svc', svcFromUrl);
    localStorage.setItem('ssv_svc', svcFromUrl);
  }
  if (chrFromUrl) {
    sessionStorage.setItem('ssv_chr', chrFromUrl);
    localStorage.setItem('ssv_chr', chrFromUrl);
  }

  let svc = sessionStorage.getItem('ssv_svc') || localStorage.getItem('ssv_svc');
  let chr = sessionStorage.getItem('ssv_chr') || localStorage.getItem('ssv_chr');

  if ((!svc || svc === DEFAULT_SVC) && savedDevices.length > 0) {
    svc = savedDevices[0].svc_uuid;
    chr = savedDevices[0].char_uuid;
    if (svc) localStorage.setItem('ssv_svc', svc);
    if (chr) localStorage.setItem('ssv_chr', chr);
    if (savedDevices[0].friendly_name) localStorage.setItem('ssv_friendly_name', savedDevices[0].friendly_name);
  }

  return { svc: svc || DEFAULT_SVC, chr: chr || DEFAULT_CHR };
}

async function fetchDevices() {
  if (!authToken) return;
  try {
    savedDevices = await apiGet('/devices');
    updateDevicesUI();
    if (savedDevices.length > 0) {
      const dev = savedDevices[0];
      const params = new URLSearchParams(window.location.search);
      if (!params.get('device')) {
        localStorage.setItem('ssv_svc', dev.svc_uuid);
        localStorage.setItem('ssv_chr', dev.char_uuid);
        if (dev.friendly_name) localStorage.setItem('ssv_friendly_name', dev.friendly_name);
      }
      const descEl = document.getElementById('bleDeviceDesc');
      if (descEl && (!bleDevice || !bleDevice.gatt?.connected)) {
        descEl.textContent = dev.friendly_name || 'Moja naprava';
      }
    }
  } catch (e) {
    console.warn('BLE: Napaka pri nalaganju naprav:', e.message);
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
  const dot = document.getElementById('bleDot');
  const lbl = document.getElementById('bleLabel');
  if (dot) dot.className = 'ble-dot' + (state ? ' ' + state : '');
  if (lbl) lbl.textContent = label;
}

function findPairedDevice(known) {
  if (!Array.isArray(known) || known.length === 0) return null;
  const targetFriendly = (savedDevices[0]?.friendly_name || localStorage.getItem('ssv_friendly_name') || '').toLowerCase();
  if (targetFriendly) {
    const match = known.find(d => d.name && (d.name.toLowerCase() === targetFriendly || d.name.toLowerCase().includes(targetFriendly)));
    if (match) return match;
  }
  const ssvMatch = known.find(d => d.name && d.name.toLowerCase().startsWith('ssv'));
  if (ssvMatch) return ssvMatch;
  if (known.length === 1) return known[0];
  return null;
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
  if (_isConnecting) {
    console.log('BLE: Connection attempt already in progress, please wait.');
    return;
  }
  _isConnecting = true;

  const { svc, chr } = getDeviceUUIDs();
  console.log('BLE: Starting connection sequence. Configured UUIDs - Service:', svc, 'Characteristic:', chr);
  _reconnectDelay = 2000;
  _reconnectAttempts = 0;
  if (_reconnectCountdownInterval) { clearInterval(_reconnectCountdownInterval); _reconnectCountdownInterval = null; }
  setDot('scanning', 'Išče napravo...');

  try {
    if (typeof navigator.bluetooth.getDevices === 'function') {
      try {
        console.log('BLE: Checking for previously paired devices...');
        const known = await navigator.bluetooth.getDevices();
        const prev = findPairedDevice(known);
        if (prev) {
          console.log('BLE: Found matching previously paired device:', prev.name, 'Attempting auto-reconnect...');
          bleDevice = prev;
          bleDevice.removeEventListener('gattserverdisconnected', onDisconn);
          bleDevice.addEventListener('gattserverdisconnected', onDisconn);
          let success = false;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              await bleGattConnect(svc, chr);
              success = true;
              break;
            } catch (err) {
              console.warn(`BLE: Auto-reconnect attempt ${attempt} failed:`, err.message);
              if (attempt < 2) await new Promise(r => setTimeout(r, 800));
            }
          }
          if (success) {
            showToast('BLE vzpostavljena ✓');
            const desc = document.getElementById('bleDeviceDesc');
            if (desc) desc.textContent = bleDevice.name || 'SSV-STOP';
            return;
          }
        } else {
          console.log('BLE: No matching previously paired device found.');
        }
      } catch (e) {
        console.warn('BLE: Auto-reconnect check failed (falling back to device picker):', e);
      }
    }

    const reqFilters = [{ namePrefix: 'SSV' }];
    const friendly = savedDevices[0]?.friendly_name || localStorage.getItem('ssv_friendly_name');
    if (friendly && !friendly.toUpperCase().startsWith('SSV')) {
      reqFilters.push({ namePrefix: friendly });
    }
    if (svc && svc !== DEFAULT_SVC) {
      reqFilters.push({ services: [svc] });
    }
    console.log('BLE: Requesting device list from browser picker with filters:', reqFilters);
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: reqFilters,
      optionalServices: [svc]
    });
    console.log('BLE: Device selected:', bleDevice.name, 'ID:', bleDevice.id);
    bleDevice.removeEventListener('gattserverdisconnected', onDisconn);
    bleDevice.addEventListener('gattserverdisconnected', onDisconn);
    await bleGattConnect(svc, chr);
    showToast('BLE vzpostavljena ✓');
    const desc = document.getElementById('bleDeviceDesc');
    if (desc) desc.textContent = bleDevice.name || 'SSV-STOP';
  } catch (e) {
    console.error('BLE: Connection failed or user canceled the dialog:', e);
    setDot('lost', 'Napaka - tapni za ponovni poskus');
    showToast('BLE: ' + (e.name === 'NotFoundError' ? 'Preklicano' : e.message));
  } finally {
    _isConnecting = false;
  }
}

function logDiagnosticInfo() {
  console.log('--- DIAGNOSTIC SYSTEM INFO ---');
  console.log('UserAgent:', navigator.userAgent);
  console.log('Platform:', navigator.platform);
  console.log('Bluetooth Supported:', !!navigator.bluetooth);
  if (bleDevice) {
    console.log('BLE Device Name:', bleDevice.name);
    console.log('BLE Device ID:', bleDevice.id);
    console.log('GATT Connected:', bleDevice.gatt?.connected);
  }
  const { svc, chr } = getDeviceUUIDs();
  console.log('Target Service UUID:', svc);
  console.log('Target Characteristic UUID:', chr);
  console.log('------------------------------');
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
  logDiagnosticInfo();
  localStorage.setItem('ssv_svc', svc);
  localStorage.setItem('ssv_chr', chr);
  _reconnectAttempts = 0;
  _reconnectDelay = 2000;
  if (_reconnectCountdownInterval) { clearInterval(_reconnectCountdownInterval); _reconnectCountdownInterval = null; }
  setDot('connected', bleDevice.name || 'SSV-STOP');
  startRssiWatch();
}

function onBleVal(e) {
  if (!e.target.value || e.target.value.byteLength === 0) {
    console.log('BLE: Characteristic value changed, but payload is empty (0 bytes).');
    return;
  }
  const dataView = e.target.value;
  const rawVal = Array.from(new Uint8Array(dataView.buffer));
  const opcode = dataView.getUint8(0);
  console.log('BLE: Characteristic value changed. Payload:', rawVal);
  if (opcode === 0x01) {
    if (isRunning) {
      let stopTimestamp = Date.now();
      if (dataView.byteLength >= 3) {
        const latencyMs = (dataView.getUint8(1) << 8) | dataView.getUint8(2);
        stopTimestamp -= latencyMs;
        console.log(`BLE: Stop signal (0x01) received with ${latencyMs}ms hardware latency compensation. Stopping stopwatch.`);
      } else {
        console.log('BLE: Stop signal (0x01) received without latency offset. Stopping stopwatch.');
      }
      handleStop('BLE', stopTimestamp);
    } else {
      console.log('BLE: Stop signal (0x01) received, but stopwatch is not running (redundant burst or late packet ignored).');
    }
  }
}

function onDisconn() {
  console.warn('BLE: Device disconnected:', bleDevice ? bleDevice.name : 'Unknown');
  bleChar = null;
  bleServer = null;
  clearSignalUI();
  if (_rssiWatchAbort) { try { _rssiWatchAbort.abort(); } catch (_) {} _rssiWatchAbort = null; }
  _rssiEma = null;
  _reconnectAttempts = 0;
  _reconnectDelay = 2000;
  setDot('lost', 'Prekinjena - znova se povezujem...');
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
      setDot('lost', 'Prekinjena - znova v ' + remaining + 's');
    } else {
      clearInterval(_reconnectCountdownInterval);
      _reconnectCountdownInterval = null;
    }
  }, 500);
}

function scheduleReconnect() {
  if (!bleDevice || bleChar) return;
  _reconnectAttempts++;
  if (_reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.log('BLE: Button appears to be turned off or out of range after ' + MAX_RECONNECT_ATTEMPTS + ' attempts. Pausing auto-reconnect.');
    if (_reconnectCountdownInterval) { clearInterval(_reconnectCountdownInterval); _reconnectCountdownInterval = null; }
    setDot('offline', 'ESP2 je izklopljen ali izven dosega (tapni za povezavo)');
    return;
  }
  console.log('BLE: Reconnect attempt ' + _reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ' scheduled in ' + _reconnectDelay + 'ms.');
  startReconnectCountdown(_reconnectDelay);
  reconnectTimer = setTimeout(async () => {
    if (!bleDevice || bleChar || _isConnecting) return;
    _isConnecting = true;
    console.log('BLE: Attempting scheduled reconnect (' + _reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')...');
    setDot('scanning', 'Znova se povezujem (' + _reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')...');
    const { svc, chr } = getDeviceUUIDs();
    try {
      await bleGattConnect(svc, chr);
      _reconnectDelay = 2000;
      _reconnectAttempts = 0;
    } catch (e) {
      console.warn('BLE: Scheduled reconnect attempt failed:', e);
      _reconnectDelay = Math.min(_reconnectDelay * 2, 10000);
      scheduleReconnect();
    } finally {
      _isConnecting = false;
    }
  }, _reconnectDelay);
}

function forgetDevice() {
  console.log('BLE: User request to forget device.');
  clearTimeout(reconnectTimer);
  if (_reconnectCountdownInterval) { clearInterval(_reconnectCountdownInterval); _reconnectCountdownInterval = null; }
  _reconnectDelay = 2000;
  _reconnectAttempts = 0;
  if (_rssiWatchAbort) { try { _rssiWatchAbort.abort(); } catch (_) {} _rssiWatchAbort = null; }
  _rssiEma = null;
  clearSignalUI();
  if (bleDevice) bleDevice.removeEventListener('gattserverdisconnected', onDisconn);
  bleDevice = null;
  bleChar = null;
  bleServer = null;
  sessionStorage.removeItem('ssv_svc');
  sessionStorage.removeItem('ssv_chr');
  setDot('', 'Tapni za povezavo z ESP2');
  const desc = document.getElementById('bleDeviceDesc');
  if (desc) desc.textContent = 'Ni shranjene naprave';
  showToast('Naprava pozabljena');
}

async function bleAutoConnect() {
  if (!navigator.bluetooth || bleChar || _isConnecting) return;
  _isConnecting = true;
  const { svc, chr } = getDeviceUUIDs();
  if (typeof navigator.bluetooth.getDevices === 'function') {
    try {
      console.log('BLE Auto-Connect: Checking for previously paired devices...');
      const known = await navigator.bluetooth.getDevices();
      const prev = findPairedDevice(known);
      if (prev) {
        console.log('BLE Auto-Connect: Found matching previously paired device:', prev.name, 'Attempting auto-reconnect...');
        setDot('scanning', 'Povezujem...');
        bleDevice = prev;
        bleDevice.removeEventListener('gattserverdisconnected', onDisconn);
        bleDevice.addEventListener('gattserverdisconnected', onDisconn);

        let success = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await bleGattConnect(svc, chr);
            success = true;
            break;
          } catch (err) {
            console.warn(`BLE Auto-Connect: Attempt ${attempt} failed:`, err.message);
            if (attempt < 2) await new Promise(r => setTimeout(r, 800));
          }
        }
        if (success) {
          showToast('BLE vzpostavljena ✓');
          const desc = document.getElementById('bleDeviceDesc');
          if (desc) desc.textContent = bleDevice.name || 'SSV-STOP';
        } else {
          setDot('', 'Tapni za povezavo z ESP2');
        }
      } else {
        console.log('BLE Auto-Connect: No previously paired devices found in browser permissions.');
        const friendly = savedDevices[0]?.friendly_name || localStorage.getItem('ssv_friendly_name');
        if (friendly) {
          setDot('', 'Tapni za povezavo: ' + friendly);
          const desc = document.getElementById('bleDeviceDesc');
          if (desc) desc.textContent = friendly;
        }
      }
    } catch (e) {
      console.log('BLE Auto-Connect: Auto-reconnect failed/ignored:', e.message);
      setDot('', 'Tapni za povezavo z ESP2');
    } finally {
      _isConnecting = false;
    }
  } else {
    _isConnecting = false;
  }
}
