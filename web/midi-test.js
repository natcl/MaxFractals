const logEl = document.getElementById('msg-log');
const inputList = document.getElementById('inputs');
const outputList = document.getElementById('outputs');
const statusText = document.getElementById('status-text');
const dot = document.getElementById('dot');

function log(msg, cls) {
  if (logEl.querySelector('em')) logEl.innerHTML = '';
  const d = new Date();
  const ts = d.toLocaleTimeString('en-US', { hour12: false });
  const div = document.createElement('div');
  div.className = 'entry';
  div.innerHTML = `<span class="time">${ts}</span>${msg}`;
  logEl.appendChild(div);
  if (document.getElementById('autoscroll').checked)
    logEl.scrollTop = logEl.scrollHeight;
}

function logMsg(status, d1, d2) {
  const rawHex = [status, d1, d2].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const typ = status & 0xF0;
  const ch = (status & 0x0F) + 1;
  let parsed, cls;

  if (typ === 0xB0) {
    parsed = `CC  ch${ch}  #${d1} = ${d2}`;
    cls = 'cc';
  } else if (typ === 0x90) {
    parsed = `NOTE ch${ch}  key=${d1}  vel=${d2}`;
    cls = 'note';
  } else if (typ === 0x80) {
    parsed = `NOTE OFF ch${ch}  key=${d1}  vel=${d2}`;
    cls = 'note';
  } else if (typ === 0xC0) {
    parsed = `PROG CHANGE ch${ch}  prog=${d1}`;
    cls = 'note';
  } else if (typ === 0xD0) {
    parsed = `AFTERTOUCH ch${ch}  pressure=${d1}`;
    cls = 'note';
  } else if (typ === 0xE0) {
    const val = d1 | (d2 << 7);
    parsed = `PITCH BEND ch${ch}  value=${val}`;
    cls = 'note';
  } else if (typ === 0xA0) {
    parsed = `POLY AFTERTOUCH ch${ch}  key=${d1}  pressure=${d2}`;
    cls = 'note';
  } else {
    parsed = `UNKNOWN type=0x${typ.toString(16)} ch${ch}  d1=${d1} d2=${d2}`;
    cls = '';
  }
  log(`<span class="raw">${rawHex}</span><span class="parsed ${cls}">${parsed}</span>`);
}

function renderDevices(access) {
  const ins = [...access.inputs.values()];
  const outs = [...access.outputs.values()];

  if (ins.length) {
    inputList.innerHTML = ins.map(p =>
      `<div class="device">
        <span class="name">${p.name}</span>
        <span class="${p.state === 'connected' ? 'conn' : 'disc'}">${p.state}</span>
        <div class="meta">${p.manufacturer || '?'}  |  id: ${p.id}  |  ver: ${p.version || '?'}</div>
      </div>`
    ).join('');
  } else {
    inputList.innerHTML = '<em style="color:#555">No inputs found</em>';
  }

  if (outs.length) {
    outputList.innerHTML = outs.map(p =>
      `<div class="device">
        <span class="name">${p.name}</span>
        <span class="${p.state === 'connected' ? 'conn' : 'disc'}">${p.state}</span>
        <div class="meta">${p.manufacturer || '?'}  |  id: ${p.id}  |  ver: ${p.version || '?'}</div>
      </div>`
    ).join('');
  } else {
    outputList.innerHTML = '<em style="color:#555">No outputs found</em>';
  }
}

function setStatus(ok, msg) {
  dot.className = ok ? 'ok' : 'err';
  statusText.textContent = msg;
}

function setupPort(port) {
  port.onmidimessage = e => logMsg(...e.data);
}

let access = null;

async function connect() {
  const btn = document.getElementById('connect-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting...';

  try {
    if (!navigator.requestMIDIAccess) {
      setStatus(false, 'Web MIDI API not supported in this browser');
      log('ERROR: Web MIDI API not supported');
      btn.disabled = false;
      btn.textContent = 'Connect MIDI';
      return;
    }
    access = await navigator.requestMIDIAccess();
    setStatus(true, `Connected — ${access.inputs.size} input(s), ${access.outputs.size} output(s)`);
    log(`MIDI access granted: ${access.inputs.size} inputs, ${access.outputs.size} outputs`);

    for (const p of access.inputs.values()) {
      if (p.state === 'connected') setupPort(p);
      log(`Input: ${p.name} (${p.manufacturer || '?'}) — ${p.state}`);
    }
    for (const p of access.outputs.values()) {
      log(`Output: ${p.name} (${p.manufacturer || '?'}) — ${p.state}`);
    }

    access.onstatechange = e => {
      const p = e.port;
      if (p.type === 'input') {
        if (p.state === 'connected') setupPort(p);
        log(`State change: ${p.name} → ${p.state}`);
      }
      renderDevices(access);
    };

    renderDevices(access);
    btn.textContent = 'Reconnect MIDI';
    btn.disabled = false;
  } catch (e) {
    setStatus(false, 'Failed: ' + e.message);
    log(`ERROR: ${e.message}`);
    btn.disabled = false;
    btn.textContent = 'Connect MIDI';
  }
}

document.getElementById('connect-btn').addEventListener('click', connect);
document.getElementById('clear-btn').addEventListener('click', () => {
  logEl.innerHTML = '<em style="color:#555">Cleared</em>';
});
document.getElementById('autoscroll').addEventListener('change', () => {
  if (document.getElementById('autoscroll').checked)
    logEl.scrollTop = logEl.scrollHeight;
});

// — these populate from the terminal output we collected earlier.
// The groups/aconnect sections show placeholder text — edit midi-test.html
// to hardcode your results if desired.
