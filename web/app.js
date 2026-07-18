const W = 1280, H = 720;

const canvas = document.getElementById('canvas');
const video = document.getElementById('video');

canvas.width = W;
canvas.height = H;

const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
if (!gl) { document.body.innerHTML = '<p style="color:#fff;padding:2em;">WebGL not supported</p>'; throw 'no webgl'; }

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_MIX = `
precision highp float;
uniform sampler2D u_cam;
uniform sampler2D u_fb;
uniform float u_fbAmt;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_cam, v_uv);
  vec4 f = texture2D(u_fb, v_uv);
  gl_FragColor = mix(c, f, u_fbAmt);
}
`;

const FRAG_FB = `
precision highp float;
uniform sampler2D u_mix;
uniform vec2  u_res;
uniform float u_theta;
uniform vec2  u_zoom;
uniform vec2  u_anchor;
uniform float u_bright;
uniform float u_contrast;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  vec2 a = u_anchor / u_res;
  vec2 r = uv - a;
  vec2 z = u_zoom;
  if (abs(z.x) < 0.001) z.x = 0.001;
  if (abs(z.y) < 0.001) z.y = 0.001;
  r /= z;
  float ct = cos(-u_theta), st = sin(-u_theta);
  r = vec2(r.x * ct - r.y * st, r.x * st + r.y * ct);
  vec4 m = texture2D(u_mix, r + a);
  vec3 c = (m.rgb - 0.5) * u_contrast + 0.5 + u_bright;
  gl_FragColor = vec4(c, 1.0);
}
`;

const FRAG_BLIT = `
precision highp float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_tex, v_uv); }
`;

function shader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s)); gl.deleteShader(s); return null;
  }
  return s;
}

function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p)); return null;
  }
  return p;
}

const progMix = program(VERT, FRAG_MIX);
const progFB = program(VERT, FRAG_FB);
const progBlit = program(VERT, FRAG_BLIT);

const u = (p, name) => gl.getUniformLocation(p, name);

const mixUniforms = {
  cam: u(progMix, 'u_cam'),
  fb: u(progMix, 'u_fb'),
  fbAmt: u(progMix, 'u_fbAmt'),
};
const fbUniforms = {
  mix: u(progFB, 'u_mix'),
  res: u(progFB, 'u_res'),
  theta: u(progFB, 'u_theta'),
  zoom: u(progFB, 'u_zoom'),
  anchor: u(progFB, 'u_anchor'),
  bright: u(progFB, 'u_bright'),
  contrast: u(progFB, 'u_contrast'),
};
const blitUniforms = { tex: u(progBlit, 'u_tex') };

const posLocMix = gl.getAttribLocation(progMix, 'a_pos');
const posLocFB = gl.getAttribLocation(progFB, 'a_pos');
const posLocBlit = gl.getAttribLocation(progBlit, 'a_pos');

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

function makeTex(w, h, data) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data || null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function makeFBO(w, h) {
  const t = makeTex(w, h);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo: f, tex: t };
}

const camTex = (() => {
  const t = makeTex(1, 1, new Uint8Array([60,60,60,255]));
  return t;
})();

const mixFbo = makeFBO(W, H);
const fbos = [makeFBO(W, H), makeFBO(W, H)];

[mixFbo, fbos[0], fbos[1]].forEach(f => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
  gl.clearColor(0,0,0,1);
  gl.clear(gl.COLOR_BUFFER_BIT);
});
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

let fbIdx = 0;
let running = true;
let camReady = false;

const state = {
  feedback: 0.9375,
  theta: 5.375404,
  zoomX: 1.086,
  zoomY: 0.816,
  anchorX: 529,
  anchorY: 531,
  brightness: 0.848,
  contrast: 1.389,
};

const midiControls = {
  'feedback':   { prop: 'feedback',   min: 0, max: 1,     sens: 0.005, abs: v => v / 127 },
  'theta':      { prop: 'theta',      min: 0, max: 6.283, sens: 0.02,  abs: v => v / 127 * 6.283 },
  'zoom-x':     { prop: 'zoomX',      min: -3, max: 3,    sens: 0.02,  abs: v => v / 127 * 6 - 3 },
  'zoom-y':     { prop: 'zoomY',      min: -3, max: 3,    sens: 0.02,  abs: v => v / 127 * 6 - 3 },
  'anchor-x':   { prop: 'anchorX',    min: 0, max: 1280,  sens: 5,     abs: v => Math.round(v / 127 * 1280) },
  'anchor-y':   { prop: 'anchorY',    min: 0, max: 720,   sens: 5,     abs: v => Math.round(v / 127 * 720) },
  'brightness': { prop: 'brightness', min: -1, max: 1,    sens: 0.01,  abs: v => v / 127 * 2 - 1 },
  'contrast':   { prop: 'contrast',   min: 0, max: 3,     sens: 0.02,  abs: v => v / 127 * 3 },
};

let midiAccess = null;
let midiInput = null;
let midiOutput = null;
let midiLearning = null;
let midiBindings = {};

const PRESETS = [
  { id: 1,  feedback: 0.793085,  theta: 4.476783, zoomX: 0.315,  zoomY: -1.24,  anchorX: 231, anchorY: 449, brightness: 1.025, contrast: 1.28   },
  { id: 2,  feedback: 0.752416,  theta: 4.46735,  zoomX: 0.509,  zoomY: 1.011,  anchorX: 131, anchorY: 560, brightness: 1.007, contrast: 1.294  },
  { id: 3,  feedback: 0.826851,  theta: 3.783223, zoomX: 0.683,  zoomY: -0.61,  anchorX: 493, anchorY: 560, brightness: 1.007, contrast: 1.294  },
  { id: 4,  feedback: 0.880009,  theta: 1.979677, zoomX: 0.683,  zoomY: -0.61,  anchorX: 493, anchorY: 560, brightness: 0.82,  contrast: 1.361  },
  { id: 5,  feedback: 0.880009,  theta: 4.294982, zoomX: 0.928,  zoomY: -0.61,  anchorX: 812, anchorY: 405, brightness: 0.82,  contrast: 1.361  },
  { id: 6,  feedback: 0.908134,  theta: 5.19104,  zoomX: 1.11,   zoomY: -0.61,  anchorX: 575, anchorY: 475, brightness: 0.82,  contrast: 1.361  },
  { id: 7,  feedback: 0.908134,  theta: 4.12433,  zoomX: 0.906,  zoomY: -0.61,  anchorX: 575, anchorY: 475, brightness: 0.82,  contrast: 1.361  },
  { id: 8,  feedback: 0.908134,  theta: 0.084011, zoomX: 0.915,  zoomY: 0.86,   anchorX: 529, anchorY: 531, brightness: 0.82,  contrast: 1.361  },
  { id: 9,  feedback: 0.908134,  theta: 4.103007, zoomX: 0.915,  zoomY: 0.86,   anchorX: 529, anchorY: 531, brightness: 0.82,  contrast: 1.361  },
  { id: 10, feedback: 0.953192,  theta: 1.649045, zoomX: 0.284,  zoomY: 2.36,   anchorX: 611, anchorY: 705, brightness: 0.989, contrast: 1.118  },
  { id: 11, feedback: 0.894149,  theta: 1.68565,  zoomX: 0.252,  zoomY: 2.265,  anchorX: 611, anchorY: 688, brightness: 0.989, contrast: 1.118  },
  { id: 12, feedback: 0.9375,    theta: 4.294871, zoomX: 0.915,  zoomY: 0.86,   anchorX: 529, anchorY: 531, brightness: 0.82,  contrast: 1.361  },
  { id: 13, feedback: 0.9375,    theta: 4.471043, zoomX: 1.163,  zoomY: 0.86,   anchorX: 529, anchorY: 531, brightness: 0.82,  contrast: 1.361  },
  { id: 14, feedback: 0.908134,  theta: 2.941167, zoomX: 0.915,  zoomY: 0.86,   anchorX: 529, anchorY: 531, brightness: 0.83,  contrast: 1.378  },
];

function applyPreset(data) {
  state.feedback   = data.feedback;
  state.theta      = data.theta;
  state.zoomX      = data.zoomX;
  state.zoomY      = data.zoomY;
  state.anchorX    = data.anchorX;
  state.anchorY    = data.anchorY;
  state.brightness = data.brightness;
  state.contrast   = data.contrast;
  syncUI();
}

function syncUI() {
  document.getElementById('feedback').value   = state.feedback;
  document.getElementById('feedback-val').textContent = state.feedback.toFixed(3);
  document.getElementById('zoom-x').value     = state.zoomX;
  document.getElementById('zoom-x-val').textContent  = state.zoomX.toFixed(3);
  document.getElementById('zoom-y').value     = state.zoomY;
  document.getElementById('zoom-y-val').textContent  = state.zoomY.toFixed(3);
  document.getElementById('anchor-x').value   = state.anchorX;
  document.getElementById('anchor-x-val').textContent = Math.round(state.anchorX);
  document.getElementById('anchor-y').value   = state.anchorY;
  document.getElementById('anchor-y-val').textContent = Math.round(state.anchorY);
  document.getElementById('brightness').value = state.brightness;
  document.getElementById('brightness-val').textContent = state.brightness.toFixed(3);
  document.getElementById('contrast').value   = state.contrast;
  document.getElementById('contrast-val').textContent  = state.contrast.toFixed(3);
  updateDial(state.theta);
}

function updateDial(angle) {
  state.theta = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const el = document.getElementById('theta-dial');
  const d = Math.min(el.offsetWidth, el.offsetHeight);
  if (d === 0) { requestAnimationFrame(() => updateDial(angle)); return; }
  const r = d / 2 - 8;
  const cx = el.offsetWidth / 2;
  const cy = el.offsetHeight / 2;
  const x = cx + r * Math.sin(angle);
  const y = cy - r * Math.cos(angle);
  const ind = el.querySelector('.dial-indicator');
  ind.style.left = x + 'px';
  ind.style.top = y + 'px';
  document.getElementById('theta-val').textContent = state.theta.toFixed(3);
}

function midiDelta(raw) {
  if (raw >= 1 && raw <= 63) return raw;
  if (raw >= 65 && raw <= 127) return raw - 128;
  return 0;
}

function midiKey(msgType, channel, num) {
  const t = msgType === 0xB0 ? 'cc' : msgType === 0x90 ? 'note' : '?';
  return t + '_' + channel + '_' + num;
}

function loadBindings() {
  try {
    const saved = localStorage.getItem('maxfractals-midi');
    if (saved) midiBindings = JSON.parse(saved);
  } catch (_) {}
}

function saveBindings() {
  try { localStorage.setItem('maxfractals-midi', JSON.stringify(midiBindings)); } catch (_) {}
}

function updateMidiUI() {
  const dot = document.getElementById('midi-dot');
  dot.className = midiLearning ? 'learning'
    : midiAccess ? 'connected'
    : '';
  dot.title = midiLearning ? 'MIDI learn: move a controller'
    : midiInput ? 'MIDI: ' + midiInput.name
    : 'Click to connect MIDI';

  for (const id of Object.keys(midiControls)) {
    const badge = document.getElementById(id + '-midi');
    const ctrl = badge && badge.closest('.ctrl');
    const found = Object.entries(midiBindings).find(([k, v]) => v === id);
    if (badge) {
      badge.textContent = found ? found[0].replace(/^cc_/, '') : '';
      badge.classList.toggle('show', !!found);
    }
    if (midiLearning === id) {
      if (ctrl) ctrl.classList.add('learning');
    } else {
      if (ctrl) ctrl.classList.remove('learning');
    }
  }
}

function startLearn(id) {
  if (midiLearning === id) { midiLearning = null; updateMidiUI(); return; }
  midiLearning = id;
  updateMidiUI();
  setTimeout(() => {
    if (midiLearning === id) { midiLearning = null; updateMidiUI(); }
  }, 8000);
}

function handleMIDI(e) {
  const [status, d1, d2] = e.data;
  const typ = status & 0xF0;
  const ch = status & 0x0F;
  if (typ !== 0xB0 && typ !== 0x90) return;

  const key = midiKey(typ, ch, d1);
  const val = typ === 0x90 ? (d2 > 0 ? 127 : 0) : d2;

  if (midiLearning) {
    midiBindings[key] = midiLearning;
    midiLearning = null;
    saveBindings();
    updateMidiUI();
    return;
  }

  const ctrlId = midiBindings[key];
  if (!ctrlId) return;
  const mc = midiControls[ctrlId];
  if (!mc) return;

  const prop = mc.prop;
  if (val === 0 || val === 64) return;

  const delta = midiDelta(val);
  if (delta === 0) return;

  if (prop === 'theta') {
    state.theta = Math.max(mc.min, Math.min(mc.max, state.theta + delta * mc.sens));
    updateDial(state.theta);
  } else {
    state[prop] = Math.max(mc.min, Math.min(mc.max, state[prop] + delta * mc.sens));
    const el = document.getElementById(ctrlId);
    if (el) el.value = state[prop];
    const vEl = document.getElementById(ctrlId + '-val');
    if (vEl) vEl.textContent = ctrlId.startsWith('anchor')
      ? Math.round(state[prop]) : state[prop].toFixed(3);
  }
  sendMidiFeedback(key, state[prop], mc);
}

function sendMidiFeedback(key, val, mc) {
  if (!midiOutput) return;
  const parts = key.split('_');
  if (parts[0] !== 'cc') return;
  const ch = parseInt(parts[1]);
  const num = parseInt(parts[2]);
  const norm = (val - mc.min) / (mc.max - mc.min);
  const out = Math.round(Math.max(0, Math.min(127, norm * 127)));
  try { midiOutput.send([0xB0 | ch, num, out]); } catch (_) {}
}

async function initMIDI() {
  if (!navigator.requestMIDIAccess) return;
  try {
    midiAccess = await navigator.requestMIDIAccess();
    for (const inp of midiAccess.inputs.values()) {
      if (!midiInput) { midiInput = inp; inp.onmidimessage = handleMIDI; }
    }
    for (const out of midiAccess.outputs.values()) {
      if (!midiOutput) midiOutput = out;
    }
    midiAccess.onstatechange = () => {
      for (const inp of midiAccess.inputs.values()) {
        if (inp.state === 'connected' && !midiInput) {
          midiInput = inp; inp.onmidimessage = handleMIDI;
        }
      }
      for (const out of midiAccess.outputs.values()) {
        if (out.state === 'connected' && !midiOutput) midiOutput = out;
      }
      updateMidiUI();
    };
    loadBindings();
    updateMidiUI();
  } catch (_) {}
}

function render() {
  if (!running) { requestAnimationFrame(render); return; }

  if (camReady && video.readyState >= 2) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, camTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  // Read from previously-written FBO, write to the other (ping-pong)
  const fbTex = fbos[1 - fbIdx].tex;

  // Pass 1: Mix camera + feedback at DIRECT uv → mixFbo
  gl.bindFramebuffer(gl.FRAMEBUFFER, mixFbo.fbo);
  gl.viewport(0, 0, W, H);
  gl.useProgram(progMix);

  gl.uniform1f(mixUniforms.fbAmt, state.feedback);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, camTex);
  gl.uniform1i(mixUniforms.cam, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, fbTex);
  gl.uniform1i(mixUniforms.fb, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(posLocMix);
  gl.vertexAttribPointer(posLocMix, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Pass 2: Blit mixFbo to screen (display the raw crossfade only)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(progBlit);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, mixFbo.tex);
  gl.uniform1i(blitUniforms.tex, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(posLocBlit);
  gl.vertexAttribPointer(posLocBlit, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Pass 3: Transform mix + brcosa → feedback FBO
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[fbIdx].fbo);
  gl.viewport(0, 0, W, H);
  gl.useProgram(progFB);

  gl.uniform1f(fbUniforms.theta, state.theta);
  gl.uniform2f(fbUniforms.zoom, state.zoomX, state.zoomY);
  gl.uniform2f(fbUniforms.anchor, state.anchorX, state.anchorY);
  gl.uniform1f(fbUniforms.bright, state.brightness);
  gl.uniform1f(fbUniforms.contrast, state.contrast);
  gl.uniform2f(fbUniforms.res, W, H);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, mixFbo.tex);
  gl.uniform1i(fbUniforms.mix, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(posLocFB);
  gl.vertexAttribPointer(posLocFB, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  fbIdx = 1 - fbIdx;
  requestAnimationFrame(render);
}

async function initVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    await video.play();
    camReady = true;
  } catch (e) {
    console.warn('Camera unavailable, running with static seed:', e);
    camReady = false;
  }
}

function setupUI() {
  document.querySelectorAll('#controls input[type="range"]').forEach(el => {
    el.addEventListener('input', () => {
      const val = parseFloat(el.value);
      const id = el.id;
      const map = {
        'feedback':   'feedback',
        'zoom-x':     'zoomX',
        'zoom-y':     'zoomY',
        'anchor-x':   'anchorX',
        'anchor-y':   'anchorY',
        'brightness': 'brightness',
        'contrast':   'contrast',
      };
      if (map[id] !== undefined) state[map[id]] = val;
      const vEl = document.getElementById(id + '-val');
      if (vEl) vEl.textContent = id.startsWith('anchor')
        ? Math.round(val) : val.toFixed(3);
      if (map[id] && midiInput) {
        const mc = midiControls[id];
        if (mc) sendMidiFeedback(
          Object.entries(midiBindings).find(([k, v]) => v === id)?.[0] || '',
          state[map[id]], mc
        );
      }
    });
    el.addEventListener('contextmenu', e => { e.preventDefault(); startLearn(el.id); });
  });

  const dialEl = document.getElementById('theta-dial');
  let dragging = false;

  function dialAngle(e) {
    const rect = dialEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const pt = e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
                         : { x: e.clientX, y: e.clientY };
    return Math.atan2(pt.x - cx, cy - pt.y);
  }

  dialEl.addEventListener('mousedown', e => { if (e.button !== 0) return; dragging = true; updateDial(dialAngle(e)); });
  window.addEventListener('mousemove', e => { if (dragging) updateDial(dialAngle(e)); });
  window.addEventListener('mouseup', () => { dragging = false; });

  dialEl.addEventListener('touchstart', e => { dragging = true; updateDial(dialAngle(e)); e.preventDefault(); });
  window.addEventListener('touchmove', e => { if (dragging) { updateDial(dialAngle(e)); e.preventDefault(); } });
  window.addEventListener('touchend', () => { dragging = false; });

  dialEl.addEventListener('contextmenu', e => { e.preventDefault(); startLearn('theta'); });

  const sel = document.getElementById('presets');
  PRESETS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = 'Preset ' + p.id;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    const id = parseInt(sel.value);
    if (!id) return;
    const p = PRESETS.find(x => x.id === id);
    if (p) applyPreset(p);
    sel.value = '';
  });

  document.getElementById('toggle-btn').addEventListener('click', () => {
    running = !running;
    document.getElementById('toggle-btn').classList.toggle('active');
  });

  document.getElementById('midi-dot').addEventListener('click', () => {
    if (!midiAccess) initMIDI();
  });

  document.getElementById('fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.getElementById('viewer').requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'f' || e.key === 'F') {
      document.getElementById('fullscreen-btn').click();
    }
    if (e.key === ' ') {
      e.preventDefault();
      document.getElementById('toggle-btn').click();
    }
    if (e.key === 'Escape' && document.fullscreenElement) {
      document.exitFullscreen();
    }
  });

  updateDial(state.theta);
}

initVideo();
setupUI();
render();
initMIDI();
