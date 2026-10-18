// SSV Stoparica - History Main Script

const API = '/api';
const authToken = localStorage.getItem('ssv_token') || null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Apply dark/light mode
const darkOn = localStorage.getItem('ssv_dark') !== '0';
if (!darkOn) document.body.classList.add('light');

// ── RUNS STATE ──
let runs = [];   // { id, datum, ekipa, disc, ms, time }

// ── UTILS ──
function fmt(ms) {
  if (!isFinite(ms) || ms < 0) return '00:00';
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function fmtDec(ms) {
  if (!isFinite(ms) || ms < 0) return '.00';
  return '.' + String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
}

function fmtFull(ms) {
  return fmt(ms) + fmtDec(ms);
}

// ── TOAST ──
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function parseDateSafe(val) {
  if (!val) return new Date();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  if (typeof val === 'number') return new Date(val);
  const s = String(val).trim();
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const sIso = s.replace(' ', 'T');
  d = new Date(sIso.endsWith('Z') ? sIso : sIso + 'Z');
  if (!isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    return new Date(
      parseInt(m[3], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[1], 10),
      parseInt(m[4] || 0, 10),
      parseInt(m[5] || 0, 10),
      parseInt(m[6] || 0, 10)
    );
  }
  return new Date();
}

// ── LOAD RUNS ──
async function loadRuns() {
  if (authToken) {
    try {
      const r = await fetch(API + '/runs', { headers: { 'Authorization': 'Bearer ' + authToken } });
      if (!r.ok) throw new Error();
      const data = await r.json();
      runs = data.map(r => {
        const d = parseDateSafe(r.datum);
        return {
          id: r.id,
          datum: d.toLocaleString('sl-SI'),
          datumIso: d.toISOString(),
          ekipa: r.ekipa || '-',
          disc: r.disciplina,
          ms: Math.round((r.cas_s || 0) * 1000),
          time: fmtFull(Math.round((r.cas_s || 0) * 1000))
        };
      });
    } catch (e) {
      showToast('Napaka pri nalaganju rezultatov.');
    }
  } else {
    // Guest: read from localStorage
    let stored = JSON.parse(localStorage.getItem('ssv_h') || '[]');
    const oneWeek = 7 * 86400000;
    const now = Date.now();
    const filtered = stored.filter(h => !h._ts || (now - h._ts) < oneWeek);
    if (filtered.length !== stored.length) {
      stored = filtered;
      localStorage.setItem('ssv_h', JSON.stringify(stored));
    }
    runs = stored.map(r => {
      const d = parseDateSafe(r.datumIso || r.datum);
      return {
        ...r,
        datum: d.toLocaleString('sl-SI'),
        datumIso: d.toISOString(),
        ms: Math.round((r.ms || 0)),
        time: r.time || fmtFull(Math.round((r.ms || 0)))
      };
    });
  }
  buildHistoryView();
  buildTeamFilters();
}

// ── BUILD VIEW ──
function buildHistoryView() {
  saveFilterState();
  const filtered = getHvFiltered();
  hvChecked = new Set(filtered.map(r => r.id));
  const container = document.getElementById('hvRuns');
  if (container) {
    container.innerHTML = '';
    if (!filtered.length) {
      container.innerHTML = `
        <div class="hv-run-empty">
          <p style="margin-bottom:8px">Ni rezultatov za izbrane filtre.</p>
          <button class="hv-tb-btn" onclick="resetHvPeriod()">Prikaži vse teke</button>
        </div>`;
      updateHvStats();
      return;
    }
    if (hvPeriod !== 'all' && hvSort === 'index') {
      renderCategorizedList(filtered, container);
    } else {
      renderFlatList(getSortedHv(filtered), container);
    }
  }
  updateHvStats();
}

function renderFlatList(list, container) {
  list.forEach(r => container.appendChild(makeRunItem(r)));
}

function renderCategorizedList(list, container) {
  groupRuns(list, hvPeriod).forEach(([key, group]) => {
    if (group.length) container.appendChild(makeCategoryEl(key, group));
  });
}

// ── DOM BUILDERS ──
function makeCategoryEl(key, list) {
  const isOpen = hvExpanded.has(key);
  const bestMs = Math.min(...list.map(r => r.ms));
  const allChecked = list.every(r => hvChecked.has(r.id));
  const someChecked = list.some(r => hvChecked.has(r.id));

  const cat = document.createElement('div');
  cat.className = 'hv-category';
  cat.dataset.key = key;

  const hdr = document.createElement('div');
  hdr.className = 'hv-cat-header' + (isOpen ? ' open' : '');

  const chk = document.createElement('div');
  chk.className = 'hv-run-check' + (allChecked ? ' checked' : someChecked ? ' partial' : '');
  chk.onclick = e => { e.stopPropagation(); toggleHvCategory(key, list, cat); };

  const info = document.createElement('div');
  info.className = 'hv-cat-info';
  info.innerHTML = `<div class="hv-cat-name">${getCategoryLabel(key)}</div>
    <div class="hv-cat-meta">${list.length} vaj \u00b7 PR: ${fmtFull(bestMs)}</div>`;

  const arrow = document.createElement('span');
  arrow.className = 'hv-cat-arrow';
  arrow.textContent = '\u25B6';

  hdr.appendChild(chk);
  hdr.appendChild(info);
  hdr.appendChild(arrow);
  hdr.onclick = () => toggleCategory(key, cat);

  const body = document.createElement('div');
  body.className = 'hv-cat-body' + (isOpen ? ' open' : '');
  list.forEach(r => body.appendChild(makeRunItem(r)));

  cat.appendChild(hdr);
  cat.appendChild(body);
  return cat;
}

function makeRunItem(r) {
  const el = document.createElement('div');
  el.className = 'hv-run-item' + (hvChecked.has(r.id) ? ' checked' : '');
  el.dataset.id = r.id;

  const content = document.createElement('div');
  content.className = 'hv-run-content';
  content.innerHTML = `
    <div class="hv-run-check${hvChecked.has(r.id) ? ' checked' : ''}"></div>
    <span class="hv-run-id">#${r.id}</span>
    <div class="hv-run-body">
      <span class="hv-run-time">${r.time}</span>
      <span class="hv-run-meta">${escapeHtml(r.ekipa)} \u00b7 ${r.disc === 'zimska' ? 'Zimska' : 'Letna'} \u00b7 ${r.datum}</span>
    </div>
    <button class="hv-run-hover-del" title="Izbriši ta vnos">&#128465;</button>`;

  let isSwiping = false;
  content.onclick = (e) => {
    if (isSwiping) { e.preventDefault(); return; }
    toggleHvRun(r.id);
  };

  const hoverDel = content.querySelector('.hv-run-hover-del');
  if (hoverDel) {
    hoverDel.onclick = (e) => {
      e.stopPropagation();
      deleteSingleRun(r.id);
    };
  }

  const delBtn = document.createElement('div');
  delBtn.className = 'hv-run-delete-btn';
  delBtn.textContent = 'Izbriši';
  delBtn.onclick = (e) => {
    e.stopPropagation();
    deleteSingleRun(r.id);
  };

  el.appendChild(content);
  el.appendChild(delBtn);

  // Touch swipe events
  let touchStartX = 0;
  let touchMoveX = 0;

  content.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    content.style.transition = 'none';
    isSwiping = false;
  }, { passive: true });

  content.addEventListener('touchmove', e => {
    touchMoveX = e.touches[0].clientX;
    const diff = touchMoveX - touchStartX;
    if (diff < -10) {
      isSwiping = true;
    }
    if (diff < 0) {
      const translateVal = Math.max(diff, -85);
      content.style.transform = `translateX(${translateVal}px)`;
    } else {
      content.style.transform = `translateX(0px)`;
    }
  }, { passive: true });

  content.addEventListener('touchend', e => {
    content.style.transition = 'transform 0.2s ease';
    const diff = touchMoveX - touchStartX;
    if (diff < -40) {
      content.style.transform = 'translateX(-80px)';
    } else {
      content.style.transform = 'translateX(0px)';
      setTimeout(() => { isSwiping = false; }, 50);
    }
    touchStartX = 0;
    touchMoveX = 0;
  });

  return el;
}

async function deleteSingleRun(id) {
  if (!confirm('Ali res želiš izbrisati ta rezultat?')) return;
  if (authToken) {
    try {
      const r = await fetch(API + '/runs/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + authToken }
      });
      if (r.status === 204) {
        showToast('Rezultat izbrisan.');
      } else {
        showToast('Napaka pri brisanju.');
      }
    } catch {
      showToast('Napaka pri brisanju.');
    }
  } else {
    showToast('Rezultat izbrisan.');
  }

  runs = runs.filter(x => x.id !== id);
  localStorage.setItem('ssv_h', JSON.stringify(runs));
  hvChecked.delete(id);
  buildHistoryView();
}

// ── INTERACTIONS ──
function toggleHvRun(id) {
  if (hvChecked.has(id)) hvChecked.delete(id); else hvChecked.add(id);
  const el = document.querySelector(`#hvRuns .hv-run-item[data-id="${id}"]`);
  if (el) {
    el.classList.toggle('checked', hvChecked.has(id));
    el.querySelector('.hv-run-check').classList.toggle('checked', hvChecked.has(id));
    const cat = el.closest('.hv-category');
    if (cat) updateCatCheckState(cat);
  }
  updateHvStats();
}

function toggleHvCategory(key, list, catEl) {
  const allChecked = list.every(r => hvChecked.has(r.id));
  list.forEach(r => allChecked ? hvChecked.delete(r.id) : hvChecked.add(r.id));
  catEl.querySelectorAll('.hv-run-item').forEach(el => {
    const id = parseInt(el.dataset.id);
    el.classList.toggle('checked', hvChecked.has(id));
    el.querySelector('.hv-run-check').classList.toggle('checked', hvChecked.has(id));
  });
  updateCatCheckState(catEl);
  updateHvStats();
}

function updateCatCheckState(catEl) {
  const items = [...catEl.querySelectorAll('.hv-run-item')];
  const n = items.filter(i => i.classList.contains('checked')).length;
  const chk = catEl.querySelector('.hv-cat-header .hv-run-check');
  if (chk) {
    chk.classList.toggle('checked', n === items.length && items.length > 0);
    chk.classList.toggle('partial', n > 0 && n < items.length);
  }
}

function toggleCategory(key, catEl) {
  const hdr = catEl.querySelector('.hv-cat-header');
  const body = catEl.querySelector('.hv-cat-body');
  const open = body.classList.contains('open');
  if (open) { hvExpanded.delete(key); hdr.classList.remove('open'); body.classList.remove('open'); }
  else { hvExpanded.add(key); hdr.classList.add('open'); body.classList.add('open'); }
}

// ── STATS & TOOLBAR ──
function updateHvStats() {
  const filtered = getHvFiltered();
  const selected = filtered.filter(r => hvChecked.has(r.id));
  const delBtn = document.getElementById('hvDeleteBtn');
  if (delBtn) delBtn.style.display = hvChecked.size > 0 ? '' : 'none';

  // Toolbar elements
  const countEl = document.getElementById('hvTbCount');
  if (countEl) countEl.textContent = `Označenih: ${selected.length} / ${filtered.length}`;

  const tbDelBtn = document.getElementById('hvDeleteSelectedBtn');
  if (tbDelBtn) {
    tbDelBtn.style.display = selected.length > 0 ? '' : 'none';
    tbDelBtn.textContent = `Izbriši izbrane (${selected.length})`;
  }

  const selAllBtn = document.getElementById('hvSelectAllBtn');
  if (selAllBtn) {
    const allSelected = filtered.length > 0 && filtered.every(r => hvChecked.has(r.id));
    selAllBtn.textContent = allSelected ? 'Odznači vse' : 'Izberi vse';
  }

  if (!selected.length) {
    document.getElementById('hvPR').textContent = '-';
    document.getElementById('hvAvg').textContent = '-';
    document.getElementById('hvCount').textContent = '0';
    document.getElementById('hvChart').innerHTML = '';
    return;
  }
  const best = selected.reduce((b, r) => r.ms < b.ms ? r : b);
  const avg = Math.round(selected.reduce((s, r) => s + r.ms, 0) / selected.length);
  document.getElementById('hvPR').textContent = fmtFull(best.ms);
  document.getElementById('hvAvg').textContent = fmtFull(avg);
  document.getElementById('hvCount').textContent = selected.length;
  renderChart([...selected].sort((a, b) => parseDateSafe(a.datumIso) - parseDateSafe(b.datumIso)));
}

// ── SELECTION HELPERS ──
function toggleSelectAll() {
  const filtered = getHvFiltered();
  const allSelected = filtered.length > 0 && filtered.every(r => hvChecked.has(r.id));
  if (allSelected) {
    filtered.forEach(r => hvChecked.delete(r.id));
  } else {
    filtered.forEach(r => hvChecked.add(r.id));
  }
  updateAllCheckmarksUI();
  updateHvStats();
}

function deselectAll() {
  hvChecked.clear();
  updateAllCheckmarksUI();
  updateHvStats();
}

function updateAllCheckmarksUI() {
  document.querySelectorAll('#hvRuns .hv-run-item').forEach(el => {
    const id = parseInt(el.dataset.id, 10);
    const isChecked = hvChecked.has(id);
    el.classList.toggle('checked', isChecked);
    const chk = el.querySelector('.hv-run-check');
    if (chk) chk.classList.toggle('checked', isChecked);
  });
  document.querySelectorAll('#hvRuns .hv-category').forEach(cat => updateCatCheckState(cat));
}

// ── INIT ──
restoreFilterState();
loadRuns();
initResizers();
