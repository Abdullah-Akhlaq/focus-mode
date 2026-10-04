const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

async function load() {
  const o = await chrome.storage.local.get('focus');
  const s = o.focus;
  return s && s.active && Date.now() < s.endsAt ? s : null;
}

function fmt(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return (h ? h + ':' : '') + pad(m) + ':' + pad(s);
}

function show(which) {
  for (const id of ['setup', 'active', 'exit']) $(id).hidden = id !== which;
}

async function render() {
  const s = await load();
  if (!s) return show('setup');
  if (!s.exit) {
    show('active');
    $('left').textContent = fmt(s.endsAt - Date.now()) + ' left';
    return;
  }
  show('exit');
  const wait = s.exit.requestedAt + s.exit.cooldownMs - Date.now();
  if (wait > 0) {
    $('wait').textContent = 'Wait ' + fmt(wait) + '. Remember why you started.';
    $('typing').hidden = true;
  } else {
    $('wait').textContent = '';
    $('typing').hidden = false;
    if ($('challenge').textContent !== s.exit.challenge) $('challenge').textContent = s.exit.challenge;
  }
}

$('start').onclick = async () => {
  await send({ type: 'start', minutes: $('minutes').value });
  window.close();
};
$('quit').onclick = async () => { await send({ type: 'requestExit' }); render(); };
$('stay').onclick = async () => { await send({ type: 'cancelExit' }); render(); };
$('confirm').onclick = async () => {
  const r = await send({ type: 'confirmExit', text: $('answer').value });
  if (r && r.ok) { render(); }
  else { $('err').textContent = "Doesn't match. Check every character."; }
};

for (const ev of ['paste', 'drop', 'contextmenu']) {
  $('answer').addEventListener(ev, (e) => e.preventDefault());
}

render();
setInterval(render, 500);
