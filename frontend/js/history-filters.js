// SSV Stoparica - History Filters and Grouping

// ── FILTER STATE ──
let hvPeriod = 'all';
let hvDisc = 'all';
let hvTeam = 'all';
let hvSort = 'index';
let hvChecked = new Set();
let hvExpanded = new Set();

// ── DYNAMIC FILTERS ──
function buildTeamFilters() {
  const containers = document.querySelectorAll('.hv-team-filters-container');
  if (!containers.length) return;

  // Get unique teams from runs, excluding '-' and 'Vse'
  const usedTeams = [...new Set(runs.map(r => r.ekipa))].filter(t => t && t !== '-' && t !== 'Vse');
  // Combine with defaults
  const teams = ['Člani-A', 'Člani-B', ...usedTeams.filter(t => t !== 'Člani-A' && t !== 'Člani-B')];

  containers.forEach(container => {
    const activeVal = hvTeam;
    container.innerHTML = `<div class="hv-radio-option${activeVal === 'all' ? ' active' : ''}" data-team="all" onclick="setHvTeam(this)"><div class="hv-radio-dot"></div><span class="hv-radio-label">Vse</span></div>`;
    
    teams.forEach(team => {
      const el = document.createElement('div');
      el.className = 'hv-radio-option' + (activeVal === team ? ' active' : '');
      el.dataset.team = team;
      el.onclick = () => setHvTeam(el);
      el.innerHTML = `<div class="hv-radio-dot"></div><span class="hv-radio-label">${escapeHtml(team)}</span>`;
      container.appendChild(el);
    });
  });
}

// ── FILTER & SORT ──
function getHvFiltered() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = new Date(startOfDay);
  const dayOfWeek = (startOfWeek.getDay() + 6) % 7; // Monday = 0
  startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
  const rollingMs = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };

  return runs.filter(r => {
    if (hvPeriod !== 'all') {
      const d = parseDateSafe(r.datumIso).getTime();
      if (hvPeriod === 'day') {
        if (d < startOfDay && (Date.now() - d) > rollingMs.day) return false;
      } else if (hvPeriod === 'week') {
        if (d < startOfWeek.getTime() && (Date.now() - d) > rollingMs.week) return false;
      } else if (hvPeriod === 'month') {
        if (d < startOfMonth && (Date.now() - d) > rollingMs.month) return false;
      } else if (hvPeriod === 'year') {
        if (d < startOfYear && (Date.now() - d) > rollingMs.year) return false;
      }
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

// ── GROUPING ──
function groupRuns(list, period) {
  const groups = new Map();
  for (const r of list) {
    const d = parseDateSafe(r.datumIso);
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
  // YYYY-MM-DD -> "Ponedeljek (14.12.2025)" or "Ponedeljek (14.12.)" for current year
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(key + 'T00:00:00');
    const days = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];
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
    return f(mon) + ' - ' + f(sun) + ' ' + sun.getFullYear();
  }
  if (key.length === 7) {
    const [year, mo] = key.split('-');
    return ['Januar', 'Februar', 'Marec', 'April', 'Maj', 'Junij', 'Julij', 'Avgust', 'September', 'Oktober', 'November', 'December'][parseInt(mo) - 1] + ' ' + year;
  }
  return key;
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
  hvTeam = el.dataset.team;
  // Re-sync all UI options with this value
  document.querySelectorAll(`[data-team="${hvTeam}"]`).forEach(e => e.classList.add('active'));
  buildHistoryView();
}

function setHvSort(el) {
  document.querySelectorAll('[data-sort]').forEach(e => e.classList.remove('active'));
  el.classList.add('active'); hvSort = el.dataset.sort; buildHistoryView();
}

function resetHvPeriod() {
  hvPeriod = 'all';
  document.querySelectorAll('[data-period]').forEach(e => e.classList.toggle('active', e.dataset.period === 'all'));
  buildHistoryView();
}

// ── FILTER OVERLAY (mobile) ──
function openFilterOverlay() {
  const el = document.getElementById('filterOverlay');
  if (el) el.classList.add('open');
}

function closeFilterOverlay() {
  const el = document.getElementById('filterOverlay');
  if (el) el.classList.remove('open');
}
