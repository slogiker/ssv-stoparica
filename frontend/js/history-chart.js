// SSV Stoparica - History Catmull-Rom SVG Chart

let _hvResizeObserver = null;
let _currentChartItems = [];

function renderChart(items) {
  _currentChartItems = items;
  const svg = document.getElementById('hvChart');
  const wrap = svg && svg.closest('.hv-chart-wrap');
  if (!svg || !wrap) return;

  if (!_hvResizeObserver) {
    _hvResizeObserver = new ResizeObserver(() => drawChart(_currentChartItems));
    _hvResizeObserver.observe(wrap);
  }
  drawChart(_currentChartItems);
}

function drawChart(items) {
  const svg = document.getElementById('hvChart');
  const wrap = svg && svg.closest('.hv-chart-wrap');
  if (!svg || !wrap) return;

  const rect = wrap.getBoundingClientRect();
  const W = rect.width || 420;
  const H = rect.height || 160;

  const acc = getComputedStyle(document.body).getPropertyValue('--acc').trim() || '#d4ff00';

  let tip = wrap.querySelector('.ct');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'ct';
    wrap.appendChild(tip);
  }

  const PL = 62, PR = 8, PT = 8, PB = 26;

  if (items.length < 2) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" font-family="monospace" font-size="10" fill="${acc}" opacity="0.3">Premalo podatkov</text>`;
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

  const yTicks = [0, 0.33, 0.67, 1].map(t => {
    const v = minV + t * range;
    return { y: toY(v), label: fmtFull(Math.round(v)) };
  });

  const xi = [0, Math.floor((items.length - 1) / 2), items.length - 1];
  const xLabels = xi.map(i => ({ x: toX(i), label: items[i].datum.split(',')[0] }));

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${acc}" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="${acc}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${yTicks.map(t => `
      <line x1="${PL}" y1="${t.y.toFixed(1)}" x2="${W - PR}" y2="${t.y.toFixed(1)}"
            stroke="rgba(127,127,127,0.15)" stroke-width="1"/>
      <text x="${PL - 5}" y="${(t.y + 3).toFixed(1)}" text-anchor="end"
            font-family="monospace" font-size="11" fill="rgba(127,127,127,0.65)">${t.label}</text>
    `).join('')}
    <path d="${fillPath}" fill="url(#${gid})"/>
    <path d="${curve}" fill="none" stroke="${acc}" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"/>
    ${showDots ? pts.map(p => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2"
              fill="${acc}" opacity="0.55"/>
    `).join('') : ''}
    ${xLabels.map(l => `
      <text x="${l.x.toFixed(1)}" y="${H - 4}" text-anchor="middle"
            font-family="monospace" font-size="10" fill="rgba(127,127,127,0.65)">${l.label}</text>
    `).join('')}
    <line id="hvCrosshair" x1="0" y1="${PT}" x2="0" y2="${PT + ph}"
          stroke="${acc}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
    <circle id="hvActiveDot" cx="-99" cy="-99" r="5"
            fill="${acc}" stroke="var(--bg)" stroke-width="2" opacity="0"/>
    <rect id="hvHitzone" x="${PL}" y="${PT}" width="${pw}" height="${ph}"
          fill="transparent" style="cursor:crosshair"/>
  `;

  const crosshair = document.getElementById('hvCrosshair');
  const activeDot = document.getElementById('hvActiveDot');
  const hitzone = document.getElementById('hvHitzone');

  function pickPoint(clientX) {
    const rct = svg.getBoundingClientRect();
    const svgX = ((clientX - rct.left) / rct.width) * W;
    let best = 0, bestD = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - svgX); if (d < bestD) { bestD = d; best = i; } });
    return { idx: best, pt: pts[best], rct };
  }

  function showTip(clientX) {
    const { pt, rct } = pickPoint(clientX);
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
    const relX = (pt.x / W) * rct.width;
    const relY = (pt.y / H) * rct.height;
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

  const newHitzone = hitzone.cloneNode(true);
  hitzone.parentNode.replaceChild(newHitzone, hitzone);
  
  newHitzone.addEventListener('mousemove', e => showTip(e.clientX));
  newHitzone.addEventListener('mouseleave', hideTip);
  newHitzone.addEventListener('touchmove', e => { e.preventDefault(); showTip(e.touches[0].clientX); }, { passive: false });
  newHitzone.addEventListener('touchend', hideTip);
}
