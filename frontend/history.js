// ── HISTORY PAGE — standalone script ──

const API = '/api';
const authToken = localStorage.getItem('ssv_token') || null;

// Apply dark/light mode
const darkOn = localStorage.getItem('ssv_dark') !== '0';
if (!darkOn) document.body.classList.add('light');

// ── RUNS STATE ──
let runs = [];   // { id, datum, ekipa, disc, ms, time }

// ── FILTER STATE ──
let hvPeriod = 'all';
let hvDisc = 'all';
let hvTeam = 'all';
let hvSort = 'index';
let hvChecked = new Set();
let hvExpanded = new Set();

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
function fmtFull(ms) { return fmt(ms) + fmtDec(ms); }

// ── TOAST ──
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(_toastTimer); _toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ── LOAD RUNS ──
async function loadRuns() {
  if (authToken) {
    try {
      const r = await fetch(API + '/runs', { headers: { 'Authorization': 'Bearer ' + authToken } });
      if (!r.ok) throw new Error();
      const data = await r.json();
      runs = data.map(r => {
        const iso = r.datum.replace(' ', 'T');
        return {
          id: r.id,
          datum: new Date(iso).toLocaleString('sl-SI'),
          datumIso: new Date(iso).toISOString(),
          ekipa: r.ekipa || '—',
          disc: r.disciplina,
          ms: Math.round((r.cas_s || 0) * 1000),
          time: fmtFull(Math.round((r.cas_s || 0) * 1000))
        };
      });
    } catch (e) {
      showToast('Napaka pri nalaganju rezultatov.');
    }
  } else {
    // Guest: read from sessionStorage
    runs = JSON.parse(sessionStorage.getItem('ssv_h') || '[]').map(r => ({
      ...r,
      ms: Math.round((r.ms || 0)),
      datumIso: r.datumIso || r.datum
    }));
  }
  buildHistoryView();
}

// ── FILTER & SORT ──
function getHvFiltered() {
  const now = Date.now();
  const ms = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
  return runs.filter(r => {
    if (hvPeriod !== 'all' && ms[hvPeriod]) {
      const d = new Date(r.datumIso);
      if (isNaN(d) || (now - d.getTime()) > ms[hvPeriod]) return false;
    }
    if (hvDisc !== 'all' && r.disc !== hvDisc) return false;
    if (hvTeam !== 'all' && r.ekipa !== hvTeam) return false;
    return true;
  });
}

function getSortedHv(list) {
  if (hvSort === 'best') return [...list].sort((a, b) => a.ms - b.ms);
  return [...list].sort((a, b) => b.id - a.id);
}

// ── FILTER STATE PERSISTENCE ──
function saveFilterState() {
  sessionStorage.setItem('ssv_hv_filters', JSON.stringify({
    period: hvPeriod, disc: hvDisc, team: hvTeam, sort: hvSort
  }));
}
function restoreFilterState() {
  const s = JSON.parse(sessionStorage.getItem('ssv_hv_filters') || 'null');
  if (!s) return;
  hvPeriod = s.period || 'all';
  hvDisc = s.disc || 'all';
  hvTeam = s.team || 'all';
  hvSort = s.sort || 'index';
  // sync all radio UI to restored state
  document.querySelectorAll('[data-period]').forEach(e => e.classList.toggle('active', e.dataset.period === hvPeriod));
  document.querySelectorAll('[data-disc]').forEach(e => e.classList.toggle('active', e.dataset.disc === hvDisc));
  document.querySelectorAll('[data-team]').forEach(e => e.classList.toggle('active', e.dataset.team === hvTeam));
  document.querySelectorAll('[data-sort]').forEach(e => e.classList.toggle('active', e.dataset.sort === hvSort));
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
      container.innerHTML = '<div class="hv-run-empty">Ni rezultatov za ta filter.</div>';
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

// ── GROUPING ──
function groupRuns(list, period) {
  const groups = new Map();
  for (const r of list) {
    const d = new Date(r.datumIso);
    let key;
    if (period === 'month') key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    else if (period === 'week') key = getISOWeekKey(d);
    else if (period === 'year') key = String(d.getFullYear());
    else if (period === 'day') key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    else key = 'all';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function getISOWeekKey(d) {
  const dt = new Date(d); dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() + 3 - (dt.getDay() + 6) % 7);
  const w1 = new Date(dt.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((dt - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
  return dt.getFullYear() + '-W' + String(wn).padStart(2, '0');
}

function getCategoryLabel(key) {
  // YYYY-MM-DD → "Ponedeljek (14.12.2025)" or "Ponedeljek (14.12.)" for current year
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(key + 'T00:00:00');
    const days = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', '\u010cetrtek', 'Petek', 'Sobota'];
    const day = days[d.getDay()];
    const dd = d.getDate() + '.' + (d.getMonth() + 1) + '.';
    const yr = d.getFullYear();
    return yr === new Date().getFullYear() ? `${day} (${dd})` : `${day} (${dd}${yr})`;
  }
  if (key.includes('-W')) {
    const [year, wPart] = key.split('-W');
    const wn = parseInt(wPart);
    const w1 = new Date(year, 0, 4);
    const mon = new Date(w1); mon.setDate(w1.getDate() - (w1.getDay() + 6) % 7 + (wn - 1) * 7);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const f = dd => dd.getDate() + '. ' + ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'][dd.getMonth()];
    return f(mon) + ' \u2013 ' + f(sun) + ' ' + sun.getFullYear();
  }
  if (key.length === 7) {
    const [year, mo] = key.split('-');
    return ['Januar', 'Februar', 'Marec', 'April', 'Maj', 'Junij', 'Julij', 'Avgust', 'September', 'Oktober', 'November', 'December'][parseInt(mo) - 1] + ' ' + year;
  }
  return key;
}

// ── DOM BUILDERS ──
function makeCategoryEl(key, list) {
  const isOpen = hvExpanded.has(key);
  const bestMs = Math.min(...list.map(r => r.ms));
  const allChecked = list.every(r => hvChecked.has(r.id));
  const someChecked = list.some(r => hvChecked.has(r.id));

  const cat = document.createElement('div');
  cat.className = 'hv-category'; cat.dataset.key = key;

  const hdr = document.createElement('div');
  hdr.className = 'hv-cat-header' + (isOpen ? ' open' : '');

  const chk = document.createElement('div');
  chk.className = 'hv-run-check' + (allChecked ? ' checked' : someChecked ? ' partial' : '');
  chk.onclick = e => { e.stopPropagation(); toggleHvCategory(key, list, cat); };

  const info = document.createElement('div'); info.className = 'hv-cat-info';
  info.innerHTML = `<div class="hv-cat-name">${getCategoryLabel(key)}</div>
    <div class="hv-cat-meta">${list.length} vaj \u00b7 PR: ${fmtFull(bestMs)}</div>`;

  const arrow = document.createElement('span'); arrow.className = 'hv-cat-arrow'; arrow.textContent = '\u25B6';

  hdr.appendChild(chk); hdr.appendChild(info); hdr.appendChild(arrow);
  hdr.onclick = () => toggleCategory(key, cat);

  const body = document.createElement('div');
  body.className = 'hv-cat-body' + (isOpen ? ' open' : '');
  list.forEach(r => body.appendChild(makeRunItem(r)));

  cat.appendChild(hdr); cat.appendChild(body);
  return cat;
}

function makeRunItem(r) {
  const el = document.createElement('div');
  el.className = 'hv-run-item' + (hvChecked.has(r.id) ? ' checked' : '');
  el.dataset.id = r.id;
  el.innerHTML = `
    <div class="hv-run-check${hvChecked.has(r.id) ? ' checked' : ''}"></div>
    <span class="hv-run-id">#${r.id}</span>
    <div class="hv-run-body">
      <span class="hv-run-time">${r.time}</span>
      <span class="hv-run-meta">${r.ekipa} \u00b7 ${r.disc === 'zimska' ? 'Zimska' : 'Letna'} \u00b7 ${r.datum}</span>
    </div>`;
  el.onclick = () => toggleHvRun(r.id);
  return el;
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

// ── STATS ──
function updateHvStats() {
  const selected = getHvFiltered().filter(r => hvChecked.has(r.id));
  if (!selected.length) {
    document.getElementById('hvPR').textContent = '\u2014';
    document.getElementById('hvAvg').textContent = '\u2014';
    document.getElementById('hvCount').textContent = '0';
    document.getElementById('hvChart').innerHTML = '';
    return;
  }
  const best = selected.reduce((b, r) => r.ms < b.ms ? r : b);
  const avg = Math.round(selected.reduce((s, r) => s + r.ms, 0) / selected.length);
  document.getElementById('hvPR').textContent = fmtFull(best.ms);
  document.getElementById('hvAvg').textContent = fmtFull(avg);
  document.getElementById('hvCount').textContent = selected.length;
  renderChart([...selected].sort((a, b) => new Date(a.datumIso) - new Date(b.datumIso)));
}

// ── FILTER SETTERS ──
function setHvPeriod(el) {
  document.querySelectorAll('[data-period]').forEach(e => e.classList.remove('active'));
  el.classList.add('active'); hvPeriod = el.dataset.period; buildHistoryView();
}
function setHvDisc(el) {
  document.querySelectorAll('[data-disc]').forEach(e => e.classList.remove('active'));
  el.classList.add('active'); hvDisc = el.dataset.disc; buildHistoryView();
}
function setHvTeam(el) {
  document.querySelectorAll('[data-team]').forEach(e => e.classList.remove('active'));
  el.classList.add('active'); hvTeam = el.dataset.team; buildHistoryView();
}
function setHvSort(el) {
  document.querySelectorAll('[data-sort]').forEach(e => e.classList.remove('active'));
  el.classList.add('active'); hvSort = el.dataset.sort; buildHistoryView();
}

// ── FILTER OVERLAY (mobile) ──
function openFilterOverlay() {
  document.getElementById('filterOverlay').classList.add('open');
}
function closeFilterOverlay() {
  document.getElementById('filterOverlay').classList.remove('open');
}

// ── CHART (Catmull-Rom → Cubic Bezier) ──
// items: array of {ms, datum, ekipa, disc} sorted chronologically
function renderChart(items) {
  const svg = document.getElementById('hvChart');
  const wrap = svg && svg.closest('.hv-chart-wrap');
  if (!svg || !wrap) return;

  // Ensure tooltip element
  let tip = wrap.querySelector('.ct');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'ct';
    wrap.appendChild(tip);
  }

  const W = 420, H = 160, PL = 62, PR = 8, PT = 8, PB = 26;

  if (items.length < 2) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" font-family="monospace" font-size="10" fill="rgba(255,255,255,0.2)">Premalo podatkov</text>`;
    tip.style.opacity = '0';
    return;
  }

  const values = items.map(r => r.ms);
  const pw = W - PL - PR, ph = H - PT - PB;
  const minV = Math.min(...values), maxV = Math.max(...values), range = maxV - minV || 1;
  const toX = i => PL + (i / (items.length - 1)) * pw;
  const toY = v => PT + ph - ((v - minV) / range) * ph;
  const pts = items.map((r, i) => ({
    x: toX(i), y: toY(r.ms),
    ms: r.ms, datum: r.datum, ekipa: r.ekipa || '', disc: r.disc || ''
  }));

  function buildPath(p) {
    let d = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
      d += ` C ${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)},`
        + ` ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)},`
        + ` ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  const curve = buildPath(pts);
  const fillPath = curve + ` L ${pts[pts.length - 1].x.toFixed(1)} ${(PT + ph).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(PT + ph).toFixed(1)} Z`;
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const showDots = items.length <= 18;

  // 4 Y ticks
  const yTicks = [0, 0.33, 0.67, 1].map(t => {
    const v = minV + t * range;
    return { y: toY(v), label: fmtFull(Math.round(v)) };
  });

  // 3 X date labels (sl-SI locale gives "2. 4. 2026, 14:30:00" — take before comma)
  const xi = [0, Math.floor((items.length - 1) / 2), items.length - 1];
  const xLabels = xi.map(i => ({ x: toX(i), label: items[i].datum.split(',')[0] }));

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#d4ff00" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="#d4ff00" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${yTicks.map(t => `
      <line x1="${PL}" y1="${t.y.toFixed(1)}" x2="${W - PR}" y2="${t.y.toFixed(1)}"
            stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <text x="${PL - 5}" y="${(t.y + 3).toFixed(1)}" text-anchor="end"
            font-family="monospace" font-size="11" fill="rgba(255,255,255,0.65)">${t.label}</text>
    `).join('')}
    <path d="${fillPath}" fill="url(#${gid})"/>
    <path d="${curve}" fill="none" stroke="#d4ff00" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"/>
    ${showDots ? pts.map(p => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2"
              fill="#d4ff00" opacity="0.55"/>
    `).join('') : ''}
    ${xLabels.map(l => `
      <text x="${l.x.toFixed(1)}" y="${H - 4}" text-anchor="middle"
            font-family="monospace" font-size="10" fill="rgba(255,255,255,0.55)">${l.label}</text>
    `).join('')}
    <line id="hvCrosshair" x1="0" y1="${PT}" x2="0" y2="${PT + ph}"
          stroke="#d4ff00" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
    <circle id="hvActiveDot" cx="-99" cy="-99" r="5"
            fill="#d4ff00" stroke="#080808" stroke-width="2" opacity="0"/>
    <rect id="hvHitzone" x="${PL}" y="${PT}" width="${pw}" height="${ph}"
          fill="transparent" style="cursor:crosshair"/>
  `;

  const crosshair = document.getElementById('hvCrosshair');
  const activeDot = document.getElementById('hvActiveDot');
  const hitzone = document.getElementById('hvHitzone');

  function pickPoint(clientX) {
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - svgX); if (d < bestD) { bestD = d; best = i; } });
    return { idx: best, pt: pts[best], rect };
  }

  function showTip(clientX) {
    const { pt, rect } = pickPoint(clientX);
    crosshair.setAttribute('x1', pt.x.toFixed(1));
    crosshair.setAttribute('x2', pt.x.toFixed(1));
    crosshair.setAttribute('opacity', '0.45');
    activeDot.setAttribute('cx', pt.x.toFixed(1));
    activeDot.setAttribute('cy', pt.y.toFixed(1));
    activeDot.setAttribute('opacity', '1');
    const shortDate = pt.datum.split(',')[0];
    tip.innerHTML = `<span class="ct-time">${fmtFull(pt.ms)}</span>`
      + `<span class="ct-meta">${shortDate} · ${pt.ekipa}</span>`;
    tip.style.opacity = '1';
    const relX = (pt.x / W) * rect.width;
    const relY = (pt.y / H) * rect.height;
    const tw = tip.offsetWidth || 110;
    const wrapW = wrap.offsetWidth || W;
    let left = relX - tw / 2;
    if (left < 4) left = 4;
    if (left + tw > wrapW - 4) left = wrapW - tw - 4;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(4, relY - 56) + 'px';
  }

  function hideTip() {
    crosshair.setAttribute('opacity', '0');
    activeDot.setAttribute('opacity', '0');
    tip.style.opacity = '0';
  }

  hitzone.addEventListener('mousemove', e => showTip(e.clientX));
  hitzone.addEventListener('mouseleave', hideTip);
  hitzone.addEventListener('touchmove', e => { e.preventDefault(); showTip(e.touches[0].clientX); }, { passive: false });
  hitzone.addEventListener('touchend', hideTip);
}

// ── CSV EXPORT ──
function exportCSV() {
  if (authToken) {
    fetch(API + '/runs/export', { headers: { 'Authorization': 'Bearer ' + authToken } })
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
  for (const r of runs) {
    const ek = (r.ekipa || '').replace(/"/g, '""');
    lines.push(`${r.id},"${ek}",${r.disc || ''},${(r.ms / 1000).toFixed(3)},${r.time},${r.datum}`);
  }
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' })),
    download: 'ssv-rezultati.csv'
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── RESIZABLE COLUMNS ──
function initResizers() {
  const body = document.querySelector('.hv-body');
  if (!body) return;
  setupResizer(document.getElementById('hvRes1'), body, 'left');
  setupResizer(document.getElementById('hvRes2'), body, 'right');
}

function setupResizer(el, body, side) {
  if (!el) return;
  let startX = 0, startFW = 200, startSW = 280;
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    startX = e.clientX;
    const cols = getComputedStyle(body).gridTemplateColumns.split(' ').map(v => parseFloat(v));
    // cols: [filters, 4, runs, 4, stats] — runs is 1fr resolved to px
    startFW = cols[0] || 200;
    startSW = cols[4] || 280;
  });
  el.addEventListener('pointermove', e => {
    if (!el.classList.contains('dragging')) return;
    const dx = e.clientX - startX;
    let fw = startFW, sw = startSW;
    if (side === 'left') fw = Math.max(100, startFW + dx);
    if (side === 'right') sw = Math.max(160, startSW - dx);
    body.style.setProperty('--hv-cols', `${fw}px 4px 1fr 4px ${sw}px`);
  });
  el.addEventListener('pointerup', () => el.classList.remove('dragging'));
}

// ── INIT ──
restoreFilterState();
loadRuns();
initResizers();
