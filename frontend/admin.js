const authToken = localStorage.getItem('ssv_token');
const currentUser = localStorage.getItem('ssv_user');

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

const isAdmin = getRoleFromToken() === 'admin';

if (!authToken || !isAdmin) {
  location.href = 'index.html';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

function generateUUID() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

let currentConfig = null;

function generateDevice() {
  const letter = document.getElementById('devLetter').value.toUpperCase() || 'X';
  const svc = generateUUID();
  const chr = generateUUID();
  const domain = window.location.host;
  const url = `https://${domain}/?device=${svc}&char=${chr}`;

  currentConfig = { letter, svc, chr, url };

  document.getElementById('resSvc').textContent = svc;
  document.getElementById('resChar').textContent = chr;
  document.getElementById('resUrl').textContent = url;
  
  const canvas = document.getElementById('qrCanvas');
  QRCode.toCanvas(canvas, url, { width: 200, margin: 2 }, (err) => {
    if (err) console.error(err);
  });

  document.getElementById('genResult').style.display = 'block';
  showToast('UUID-ji generirani.');
}

async function flashDevice() {
  if (!navigator.serial) {
    showToast('Web Serial ni podprt v tem brskalniku (uporabite Chrome/Edge).');
    return;
  }
  showToast('Web Serial flashing bo implementiran v naslednji fazi.');
  console.log('Target config:', currentConfig);
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

async function loadUsers() {
  const container = document.getElementById('usersList');
  if (!container) return;
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.napaka || 'Napaka pri pridobivanju uporabnikov.');
    }
    const users = await res.json();
    if (users.length === 0) {
      container.innerHTML = `<div style="color:var(--muted);text-align:center;padding:20px;">Ni registriranih uporabnikov.</div>`;
      return;
    }
    
    container.innerHTML = users.map(u => {
      const date = new Date(u.created_at).toLocaleDateString('sl-SI');
      
      let devicesHtml = '';
      if (u.devices && u.devices.length > 0) {
        devicesHtml = `
          <div class="user-devices" style="margin-top:8px; font-size:11px; color:var(--muted); line-height:1.4;">
            ${u.devices.map(d => `
              <div style="border-left:2px solid var(--acc); padding:2px 8px; margin-top:6px; background:rgba(255,255,255,0.02); border-radius:0 4px 4px 0;">
                <strong>${escapeHtml(d.friendly_name || 'Brez imena')}</strong><br/>
                Svc: <span style="font-family:var(--font-mono); color:var(--acc);">${escapeHtml(d.svc_uuid)}</span><br/>
                Char: <span style="font-family:var(--font-mono); color:var(--acc);">${escapeHtml(d.char_uuid)}</span>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        devicesHtml = `<div style="font-size:11px; color:var(--muted); margin-top:6px; font-style:italic;">Nima shranjenih naprav.</div>`;
      }

      return `
        <div class="user-item" style="flex-direction:column; align-items:stretch; padding:16px 0; border-bottom:1px solid var(--border);">
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <div class="user-info">
              <span class="user-name">
                ${escapeHtml(u.ime)}
                <span style="font-size:9px; background:${u.role === 'admin' ? 'var(--acc)' : 'var(--s2)'}; color:${u.role === 'admin' ? '#000' : 'var(--muted)'}; padding:2px 6px; border-radius:4px; margin-left:6px; font-weight:700; border:1px solid ${u.role === 'admin' ? 'var(--acc)' : 'var(--border)'};">
                  ${u.role.toUpperCase()}
                </span>
              </span>
              <span class="user-email">${escapeHtml(u.email)}</span>
            </div>
            <div class="user-meta">
              <div>Vaje: <strong>${u.runs_count}</strong></div>
              <div>Registracija: ${date}</div>
            </div>
          </div>

          <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
            <button class="setting-select" onclick="toggleUserRole(${u.id}, '${u.role}')" style="cursor:pointer; font-size:11px; padding:6px 10px; margin:0; flex:none; width:auto; border-radius:6px; background:var(--s2);">
              ${u.role === 'admin' ? 'Demotiraj' : 'Promoviraj v Admina'}
            </button>
            <button class="setting-select" onclick="showUserRuns(${u.id}, '${escapeHtml(u.ime)}')" style="cursor:pointer; font-size:11px; padding:6px 10px; margin:0; flex:none; width:auto; border-radius:6px; background:var(--s2);">
              Prikaži vaje
            </button>
            <button class="setting-select" onclick="deleteUser(${u.id}, '${escapeHtml(u.ime)}')" style="cursor:pointer; font-size:11px; padding:6px 10px; margin:0; flex:none; width:auto; border-radius:6px; color:var(--danger); border-color:var(--danger); background:var(--s2);">
              Izbriši uporabnika
            </button>
          </div>

          <div id="userRuns_${u.id}" style="display:none; margin-top:12px; padding:12px; background:var(--s2); border-radius:8px; border:1px solid var(--border);">
            <div style="font-size:12px; font-weight:700; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--acc);">Vaje uporabnika ${escapeHtml(u.ime)}</span>
              <button onclick="document.getElementById('userRuns_${u.id}').style.display='none'" style="background:none; border:none; color:var(--muted); cursor:pointer; font-size:14px; padding:4px;">&#10005;</button>
            </div>
            <div id="userRunsList_${u.id}">Nalagam...</div>
          </div>

          ${devicesHtml}
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);text-align:center;padding:20px;">${escapeHtml(err.message)}</div>`;
  }
}

async function toggleUserRole(userId, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  if (!confirm(`Ali res želiš spremeniti vlogo uporabnika v ${newRole}?`)) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: 'POST',
      headers: { 
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: newRole })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.napaka || 'Napaka pri posodabljanju vloge.');
    }
    showToast('Vloga posodobljena.');
    loadUsers();
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteUser(userId, userName) {
  if (!confirm(`POZOR: Ali res želiš trajno izbrisati uporabnika "${userName}" in vse njegove vaje? Tega ni mogoče razveljaviti!`)) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.napaka || 'Napaka pri brisanju uporabnika.');
    }
    showToast('Uporabnik izbrisan.');
    loadUsers();
  } catch (err) {
    showToast(err.message);
  }
}

async function showUserRuns(userId, userName) {
  const box = document.getElementById(`userRuns_${userId}`);
  const list = document.getElementById(`userRunsList_${userId}`);
  if (!box || !list) return;

  if (box.style.display === 'block') {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  list.innerHTML = '<div style="font-size:11px;color:var(--muted)">Nalagam...</div>';

  try {
    const res = await fetch(`/api/admin/users/${userId}/runs`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.napaka || 'Napaka pri pridobivanju tekov.');
    }
    const runs = await res.json();
    if (runs.length === 0) {
      list.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px 0;">Uporabnik nima zabeleženih vaj.</div>';
      return;
    }

    list.innerHTML = `
      <div style="overflow-x:auto; width:100%; margin-top:4px;">
        <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:left; min-width:300px;">
          <thead>
            <tr style="border-bottom:1px solid var(--border); color:var(--muted);">
              <th style="padding:6px 0;">Ekipa</th>
              <th style="padding:6px 0;">Discip.</th>
              <th style="padding:6px 0;">Čas</th>
              <th style="padding:6px 0;">Datum</th>
              <th style="padding:6px 0; text-align:right;">Akcija</th>
            </tr>
          </thead>
          <tbody>
            ${runs.map(r => {
              const date = new Date(r.datum).toLocaleDateString('sl-SI');
              return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 0; font-weight:500;">${escapeHtml(r.ekipa || '/')}</td>
                  <td style="padding:8px 0; text-transform:capitalize;">${escapeHtml(r.disciplina || '/')}</td>
                  <td style="padding:8px 0; font-family:var(--font-mono); color:var(--acc); font-weight:700;">${r.cas_s.toFixed(3)}s</td>
                  <td style="padding:8px 0; color:var(--muted);">${date}</td>
                  <td style="padding:8px 0; text-align:right;">
                    <button onclick="deleteUserRun(${r.id}, ${userId})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:11px; padding:4px; font-weight:500;">Izbriši</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    list.innerHTML = `<div style="color:var(--danger); font-size:11px;">${escapeHtml(err.message)}</div>`;
  }
}

async function deleteUserRun(runId, userId) {
  if (!confirm('Ali res želiš izbrisati to vajo?')) return;
  try {
    const res = await fetch(`/api/admin/runs/${runId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.napaka || 'Napaka pri brisanju teka.');
    }
    showToast('Vaja izbrisana.');
    
    // Reload user runs list
    await showUserRuns(userId);
    // Force reopen since showUserRuns toggles it
    document.getElementById(`userRuns_${userId}`).style.display = 'block';

    // Reload users count in the background
    const usersRes = await fetch('/api/admin/users', {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (usersRes.ok) {
      const users = await usersRes.json();
      const updatedUser = users.find(u => u.id === userId);
      if (updatedUser) {
        const countEl = document.querySelector(`#userRuns_${userId}`).closest('.user-item').querySelector('.user-meta strong');
        if (countEl) countEl.textContent = updatedUser.runs_count;
      }
    }
  } catch (err) {
    showToast(err.message);
  }
}

// Load users on startup
loadUsers();

// Silent auto-connect BLE to keep the device awake
async function bleKeepAlive() {
  if (!navigator.bluetooth) return;
  const svc = sessionStorage.getItem('ssv_svc') || '959e9299-896e-4d05-a747-3fe70fd2122c';
  const chr = sessionStorage.getItem('ssv_chr') || '9c2c6e30-04f3-4ef0-8577-b4d9ca5f68c3';
  if (typeof navigator.bluetooth.getDevices === 'function') {
    try {
      const known = await navigator.bluetooth.getDevices();
      const prev = known.find(d => d.name?.startsWith('SSV-STOP'));
      if (prev) {
        console.log('BLE Keep-Alive: Reconnecting to device:', prev.name);
        const server = await prev.gatt.connect();
        const service = await server.getPrimaryService(svc);
        const char = await service.getCharacteristic(chr);
        // Start notifications so the connection is active and fully setup
        await char.startNotifications();
        char.addEventListener('characteristicvaluechanged', (e) => {
          if (e.target.value && e.target.value.byteLength > 0) {
            console.log('BLE Keep-Alive: Received notification byte length:', e.target.value.byteLength);
          }
        });
        prev.addEventListener('gattserverdisconnected', () => {
          console.warn('BLE Keep-Alive: Device disconnected.');
        });
        console.log('BLE Keep-Alive: Connected and active.');
      }
    } catch (e) {
      console.log('BLE Keep-Alive: Silent reconnect failed/ignored:', e.message);
    }
  }
}
bleKeepAlive();
