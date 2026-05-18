const authToken = localStorage.getItem('ssv_token');
const currentUser = localStorage.getItem('ssv_user');
const isAdmin = currentUser && ['slogiker', 'admin'].includes(currentUser.toLowerCase());

if (!authToken || !isAdmin) location.href = 'index.html';

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
