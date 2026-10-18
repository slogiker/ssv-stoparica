// SSV Stoparica - History CSV Export and Column Resizing

function exportCSV() {
  if (typeof authToken !== 'undefined' && authToken) {
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
  const list = typeof runs !== 'undefined' ? runs : [];
  for (const r of list) {
    const ek = (r.ekipa || '').replace(/"/g, '""');
    lines.push(`${r.id},"${ek}",${r.disc || ''},${(r.ms / 1000).toFixed(3)},${r.time},${r.datum}`);
  }
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' })),
    download: 'ssv-rezultati.csv'
  });
  a.click(); URL.revokeObjectURL(a.href);
}

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

function historyBack() {
  if (window.parent && window.parent !== window && typeof window.parent.closeHistoryPanel === 'function') {
    window.parent.closeHistoryPanel();
  } else {
    history.back();
  }
}
window.historyBack = historyBack;
