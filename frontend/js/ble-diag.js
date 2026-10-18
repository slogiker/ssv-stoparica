// SSV Stoparica - Bluetooth Diagnostics, Signal Strength & Device Management

// ── SIGNAL STRENGTH & RSSI ──
function rssiToSignal(rssi) {
  const distance = Math.pow(10, (BLE_TX_POWER_AT_1M - rssi) / (10 * BLE_PATH_LOSS_N));
  let bars;
  if (distance < 2) bars = 4;
  else if (distance < 5) bars = 3;
  else if (distance < 8) bars = 2;
  else bars = 1;
  return { bars, distance };
}

function updateSignalUI(rssi) {
  const svgEl = document.getElementById('signalBars');
  const distEl = document.getElementById('signalDist');
  const dbmEl = document.getElementById('signalDbm');
  if (!svgEl || !distEl || !dbmEl) return;

  const { bars, distance } = rssiToSignal(rssi);
  svgEl.setAttribute('data-bars', bars);

  const distCapped = Math.min(distance, 99.9);
  const distStr = distCapped < 10
    ? '~' + distCapped.toFixed(1) + 'm'
    : '~' + Math.round(distCapped) + 'm';
  distEl.textContent = distStr;
  distEl.className = 'signal-dist ' + (bars >= 4 ? 'near' : bars >= 3 ? 'near' : bars >= 2 ? 'mid' : 'far');
  dbmEl.textContent = rssi + 'dBm';

  const diagRssi = document.getElementById('diagRssi');
  const diagDist = document.getElementById('diagDist');
  if (diagRssi) diagRssi.textContent = rssi + ' dBm';
  if (diagDist) diagDist.textContent = distStr;
}

function clearSignalUI() {
  const svgEl = document.getElementById('signalBars');
  const distEl = document.getElementById('signalDist');
  const dbmEl = document.getElementById('signalDbm');
  if (svgEl) svgEl.setAttribute('data-bars', '0');
  if (distEl) { distEl.textContent = '-'; distEl.className = 'signal-dist'; }
  if (dbmEl) dbmEl.textContent = '';

  const diagRssi = document.getElementById('diagRssi');
  const diagDist = document.getElementById('diagDist');
  if (diagRssi) diagRssi.textContent = '-';
  if (diagDist) diagDist.textContent = '-';
}

async function startRssiWatch() {
  console.log('BLE RSSI: Initializing signal strength UI...');
  const svgEl = document.getElementById('signalBars');
  if (svgEl) svgEl.setAttribute('data-bars', '4');
  const distEl = document.getElementById('signalDist');
  if (distEl) { distEl.textContent = 'OK'; distEl.className = 'signal-dist near'; }
  const dbmEl = document.getElementById('signalDbm');
  if (dbmEl) dbmEl.textContent = '';

  if (!bleDevice || typeof bleDevice.watchAdvertisements !== 'function') {
    console.log('BLE RSSI: watchAdvertisements not supported on this platform/browser.');
    return;
  }
  if (_rssiWatchAbort) { try { _rssiWatchAbort.abort(); } catch (_) {} }
  _rssiWatchAbort = new AbortController();
  _rssiEma = null;
  try {
    console.log('BLE RSSI: Starting watchAdvertisements on device...');
    await bleDevice.watchAdvertisements({ signal: _rssiWatchAbort.signal });
    bleDevice.addEventListener('advertisementreceived', (evt) => {
      const rssi = evt.rssi;
      console.log('BLE RSSI: Advertisement packet received. Raw RSSI:', rssi, 'dBm');
      if (typeof rssi !== 'number') return;
      _rssiEma = _rssiEma === null ? rssi : _rssiEma + RSSI_EMA_ALPHA * (rssi - _rssiEma);
      updateSignalUI(Math.round(_rssiEma));
    });
  } catch (e) {
    console.warn('BLE RSSI: watchAdvertisements failed or was aborted:', e.message);
  }
}

// ── BLE DIAGNOSTICS & PING ──
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

  const dbmEl = document.getElementById('signalDbm');
  const distEl = document.getElementById('signalDist');
  document.getElementById('diagRssi').textContent = dbmEl ? (dbmEl.textContent || '-') : '-';
  document.getElementById('diagDist').textContent = distEl ? (distEl.textContent || '-') : '-';
  document.getElementById('pingResult').textContent = '-';
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

  if (btn) btn.disabled = true;
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
    if (btn) btn.disabled = false;
  }
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
