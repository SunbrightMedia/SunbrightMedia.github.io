// Live 12 player: the interface. A view of its own in Live's design language with only what is needed to listen to a
// project: the project menu, Play / Stop, position and tempo, Loop and Follow, zoom, the timeline (ruler with scrub area
// and loop brace, tracks with their clips) and, per track, activator, solo, volume, pan and meter; the Main track's
// volume, pan and meter at the bottom. Behaviours that were checked against the running Live for the Arrangement replica
// are kept as they were there (see viewer.js): Play on press, Stop on release, Stop when stopped returns to 1.1.1, a
// click while playing only moves the insert marker, the scrub area, the loop brace drags, Follow centring the play line
// and pausing on a sideways scroll, zoom steps 1.6 / 0.625.
'use strict';
const $ = s => document.querySelector(s);
const view = { insert: 0, ppb: 4, follow: true, followPaused: false, anchor: null };
const scroller = $('#scroller'), content = $('#content'), rowsEl = $('#rows'), ruler = $('#ruler'), grid = $('#grid');
let headW = 214, beats = 64, rows = [], projects = [], current = null, expectLeft = 0, raf = 0;
const MAX_PPB = 160;
const DPR = () => Math.min(3, window.devicePixelRatio || 1);

// ---------------------------------------------------------------------------
// Hooks the core calls

hooks.insert = () => view.insert;
hooks.onPlay = () => {
  $('#play').classList.add('on');
  setFollowPaused(false);
  $('#playhead').style.display = 'block';
  cancelAnimationFrame(raf);
  const loop = () => { if (!engine.playing) return; showPlay(engine.beatNow()); raf = requestAnimationFrame(loop); };
  loop();
};
hooks.onStop = () => {
  cancelAnimationFrame(raf);
  $('#play').classList.remove('on');
  $('#playhead').style.display = 'none';
  if (set) showPos(view.insert);
};
hooks.onPos = () => {};
hooks.onMeter = (t, st) => {
  const cv = t === set.main ? $('#mvu') : rows.find(r => r.t === t)?.vu;
  if (!cv || !cv.isConnected) return;
  const ctx = cv.getContext('2d'), h = cv.height;
  st.ch.forEach((c, i) => drawVu(ctx, 1 + 4 * i, h, -1, c.pk.shown, c.rms.shown, c.pk.held));
};

// the core's dialogs: a progress line under the bar and a message box for errors
function progressDialog(text, frac) {
  const b = $('#load i'); b.parentNode.style.display = 'block';
  b.style.width = (frac == null ? 15 : Math.round(frac * 100)) + '%';
  $('#load').title = text;
}
function openDialog(msg) { const m = $('#msg'); m.innerHTML = msg || ''; m.hidden = !msg; $('#load').style.display = 'none'; }
function closeDialog() { $('#load').style.display = 'none'; $('#msg').hidden = true; }
function pickSet(list) { return Promise.resolve(list[0]); }
function drawAll() { for (const r of rows) for (const tl of r.tiles) if (tl.shown && tl.audio) drawTile(tl); }
async function loadWaveforms() {
  const paths = new Set();
  for (const t of set.tracks) for (const c of t.clips) if (c.kind === 'audio' && c.file) paths.add(c.file);
  for (const p of paths) { await computePeaks(p); drawAll(); }
}

// ---------------------------------------------------------------------------
// Building the view

const cssPx = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
const lanesW = () => Math.max(1, scroller.clientWidth - headW);
const fitPpb = () => lanesW() / beats;
function isVisible(t) { let p = t.parent; while (p) { if (!p.unfolded) return false; p = p.parent; } return true; }

function showSet() {
  cancelAnimationFrame(raf);
  view.insert = 0; view.followPaused = false;
  headW = cssPx('--head-w');
  const bpb = beatsPerBar();
  beats = Math.ceil((set.end + 4 * bpb) / bpb) * bpb;
  view.ppb = clamp(fitPpb(), 3, 24);
  $('#loop').classList.toggle('on', set.loop.on);
  $('#proj-name').textContent = current ? current.name : set.name;
  document.title = set.name + ' - Ableton Live 12';
  buildRows();
  buildMaster();
  layoutTimeline();
  scroller.scrollLeft = 0; scroller.scrollTop = 0; expectLeft = 0;
  showPos(0);
  watchDownloads();
}

// the audio files of a folder project still coming in: the line under the bar shows how many are in
function watchDownloads() {
  const all = [...pendingFiles.values()];
  if (!all.length) return;
  let done = 0;
  const step = () => { if (done >= all.length) closeDialog(); else progressDialog(`Loading audio… ${done} of ${all.length}`, done / all.length); };
  step();
  const mine = pendingFiles;
  for (const p of all) p.then(() => { if (pendingFiles === mine) { done++; step(); } });
}

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.append(e);
  return e;
}

function buildRows() {
  for (const r of rows) for (const tl of r.tiles) io.unobserve(tl.cv);
  rowsEl.textContent = '';
  rows = [];
  for (const t of set.tracks) {
    if (!isVisible(t)) continue;
    const row = el('div', 'row', rowsEl);
    const head = el('div', 'head' + (t.parent ? ' child' : ''), row);
    head.style.setProperty('--c', t.color);
    if (t.parent) head.style.setProperty('--pc', t.parent.color);
    el('div', 'sw', head);
    const mid = el('div', 'mid', head);
    const nm = el('div', 'nm', mid);
    if (t.type === 'group') {
      const f = el('button', 'fold' + (t.unfolded ? '' : ' shut'), nm);
      f.title = t.unfolded ? 'Fold' : 'Unfold'; f.setAttribute('aria-label', f.title);
      f.addEventListener('click', () => { t.unfolded = !t.unfolded; buildRows(); layoutTimeline(); });
    }
    el('span', null, nm, t.name).title = t.name;
    const ctl = el('div', 'ctl', mid);
    const act = el('button', 'act' + (t.mixer.on ? '' : ' off'), ctl, t.label);
    act.title = 'Track Activator';
    act.addEventListener('click', () => { t.mixer.on = !t.mixer.on; engine.updateMix(); refreshMix(); });
    const solo = el('button', 'solo' + (t.mixer.solo ? ' on' : ''), ctl, 'S');
    solo.title = 'Solo';
    solo.addEventListener('click', e => {
      // exclusive solo (Live's default); Ctrl / Cmd adds to the soloed tracks
      const on = !t.mixer.solo;
      if (!(e.ctrlKey || e.metaKey)) for (const x of set.tracks) x.mixer.solo = false;
      t.mixer.solo = on;
      engine.updateMix(); refreshMix();
    });
    const vol = mixField(ctl, t, 'vol'), pan = mixField(ctl, t, 'pan');
    const vu = el('canvas', 'vu', head); vu.width = 9; vu.height = Math.max(1, Math.round(cssPx('--row-h')) - 1);
    const lane = el('div', 'lane' + (t.type === 'group' ? ' grp' : ''), row);
    lane.addEventListener('click', laneClick);
    rows.push({ t, row, head, act, solo, vol, pan, vu, lane, tiles: [] });
  }
  refreshMix();
}

function buildMaster() {
  const m = $('#master');
  m.textContent = '';
  el('span', 'nm', m, set.main.name);
  const ctl = el('div', 'ctl', m);
  set.main.mixer.on = true; set.main.mixer.solo = false;
  m._vol = mixField(ctl, set.main, 'vol'); m._pan = mixField(ctl, set.main, 'pan');
  const vu = el('canvas', 'vu', m); vu.id = 'mvu'; vu.width = 9; vu.height = 22;
  refreshField(m._vol, set.main, 'vol'); refreshField(m._pan, set.main, 'pan');
}

function refreshMix() {
  for (const r of rows) {
    r.act.classList.toggle('off', !r.t.mixer.on);
    r.solo.classList.toggle('on', r.t.mixer.solo);
    r.row.classList.toggle('muted', !engine.audible(r.t));
    refreshField(r.vol, r.t, 'vol'); refreshField(r.pan, r.t, 'pan');
  }
}

// ---------------------------------------------------------------------------
// Volume and pan fields: drag up / down (Shift: fine), double click / double tap to reset. Steps as in the replica's
// mixer fields (viewer.js mixField: the position in 400 steps, 4000 with Shift); volume 0 dB, pan centre by default.

function mixField(parent, t, kind) {
  const d = el('div', 'field ' + kind, parent);
  el('i', null, d); el('span', null, d);
  d.title = kind === 'vol' ? 'Track Volume' : 'Track Panning';
  let lastTap = 0;
  d.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (e.timeStamp - lastTap < 350) { lastTap = 0; setMix(t, kind, kind === 'vol' ? 1 : 0); return; }
    lastTap = e.timeStamp;
    d.setPointerCapture(e.pointerId);
    const lo = kind === 'vol' ? 0 : -1, hi = 1;
    let lastY = e.clientY, acc = 0;
    const move = ev => {
      acc += lastY - ev.clientY; lastY = ev.clientY;
      const steps = Math.trunc(acc); if (!steps) return;
      acc -= steps; lastTap = 0;
      const N = 400 * (ev.shiftKey ? 10 : 1);
      const cur = kind === 'vol' ? volToPos(t.mixer.volume) : t.mixer.pan;
      const pos = clamp(Math.round(N * (cur - lo) / (hi - lo)) + steps, 0, N);
      const v = f32(lo + (hi - lo) * pos / N);
      setMix(t, kind, kind === 'vol' ? posToVol(v) : v);
    };
    const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); };
    d.addEventListener('pointermove', move); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
  });
  refreshField(d, t, kind);
  return d;
}
function setMix(t, kind, v) {
  if (kind === 'vol') t.mixer.volume = v; else t.mixer.pan = v;
  if (t === set.main && engine.master) engine.master.gain.setTargetAtTime(v, engine.ctx.currentTime, 0.01);
  engine.updateMix();
  if (t === set.main) { const m = $('#master'); refreshField(m._vol, t, 'vol'); refreshField(m._pan, t, 'pan'); }
  else refreshMix();
}
function refreshField(d, t, kind) {
  const fill = d.firstChild, txt = d.lastChild;
  if (kind === 'vol') {
    const p = volFill(t.mixer.volume);
    fill.style.left = '1px'; fill.style.width = `calc((100% - 2px) * ${p})`;
    txt.textContent = dbText(t.mixer.volume);
  } else {
    const p = clamp(t.mixer.pan, -1, 1);
    fill.style.left = `calc(1px + (100% - 2px) * ${(1 + Math.min(0, p)) / 2})`;
    fill.style.width = `calc((100% - 2px) * ${Math.abs(p) / 2})`;
    txt.textContent = panText(t.mixer.pan);
  }
}

// ---------------------------------------------------------------------------
// The timeline at the current zoom: ruler, grid, clips, loop brace and lines

const barPx = () => beatsPerBar() * view.ppb;
// the grid step (beats) for lines, snapping and the ruler: whole bars, doubled until they are 34 px apart, or the
// beat (or half / quarter beat) when bars are wide
function gridStep() {
  const bpb = beatsPerBar(), bl = beatLen();
  if (barPx() >= 34) { for (const s of [bl / 4, bl / 2, bl]) if (s * view.ppb >= 16) return s; return bpb; }
  let n = 1; while (n * barPx() < 34 && n < 4096) n *= 2;
  return n * bpb;
}
function labelStep() { let n = 1; while (n * barPx() < 34 && n < 4096) n *= 2; return n * beatsPerBar(); }

function layoutTimeline() {
  if (!set) return;
  const W = beats * view.ppb;
  content.style.width = headW + W + 'px';
  ruler.style.width = W + 'px';
  // ruler labels and ticks
  ruler.querySelectorAll('.bn, .tk').forEach(e => e.remove());
  const frag = document.createDocumentFragment(), ls = labelStep(), bpb = beatsPerBar();
  for (let b = 0; b < beats; b += ls) {
    const d = el('div', 'bn', frag, String(Math.round(b / bpb) + 1)); d.style.left = Math.round(b * view.ppb) + 'px';
  }
  const tick = ls > bpb ? bpb : beatLen();
  if (tick * view.ppb >= 6) for (let b = 0; b < beats; b += tick) {
    if (Math.abs(b / ls - Math.round(b / ls)) < 1e-9) continue;
    el('div', 'tk', frag).style.left = Math.round(b * view.ppb) + 'px';
  }
  ruler.prepend(frag);
  // grid: lines at the grid step, stronger at bars, every other step shaded (Live's grid tiles)
  grid.textContent = '';
  grid.style.left = headW + 'px'; grid.style.width = W + 'px';
  const gs = gridStep(), g = document.createDocumentFragment();
  for (let i = 0, b = 0; b < beats; i++, b = i * gs) {
    const x = Math.round(b * view.ppb), x1 = Math.round((b + gs) * view.ppb);
    if (i % 2 === 1) { const z = el('div', 'gz', g); z.style.left = x + 'px'; z.style.width = (x1 - x) + 'px'; }
    const onBar = Math.abs(b / bpb - Math.round(b / bpb)) < 1e-9;
    el('div', onBar ? 'gl bar' : 'gl', g).style.left = x + 'px';
  }
  grid.append(g);
  for (const r of rows) layoutLane(r);
  layoutLoop();
  placeLine($('#insert'), view.insert);
  if (engine.playing) showPlay(engine.beatNow());
}

const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const tl = e.target._tile; if (!tl) continue;
    tl.shown = e.isIntersecting;
    if (tl.shown) drawTile(tl); else { tl.cv.width = 0; tl.cv.height = 0; tl.drawn = false; }
  }
}, { root: scroller, rootMargin: '0px 60% 0px 60%' });

const TILE = 1024;   // css px per clip canvas
function layoutLane(r) {
  for (const tl of r.tiles) io.unobserve(tl.cv);
  r.tiles = [];
  r.lane.textContent = '';
  r.lane.style.width = beats * view.ppb + 'px';
  const t = r.t;
  if (t.type === 'group') {
    // a group shows its tracks' clips, one thin row per track
    const kidsOf = x => x.children.flatMap(k => [k, ...kidsOf(k)]).filter(k => k.type !== 'group');
    const ks = kidsOf(t), n = Math.max(1, ks.length);
    ks.forEach((k, i) => {
      for (const c of k.clips) {
        const d = el('div', 'gclip', r.lane);
        d.style.left = c.start * view.ppb + 'px'; d.style.width = Math.max(1, (c.end - c.start) * view.ppb) + 'px';
        d.style.top = `calc(3px + (100% - 6px) * ${i / n})`; d.style.height = `max(1px, calc((100% - 6px) / ${n} - 1px))`;
        d.style.background = c.disabled ? '#636363' : c.color;
      }
    });
    return;
  }
  for (const c of t.clips) {
    const w = (c.end - c.start) * view.ppb;
    const d = el('div', 'clip' + (c.disabled ? ' dis' : ''), r.lane);
    d.style.left = c.start * view.ppb + 'px'; d.style.width = Math.max(1, w) + 'px';
    d.style.setProperty('--c', c.disabled ? '#636363' : c.color);
    d.style.color = clipText(c.disabled ? '#636363' : c.color);
    if (c.name) el('div', 'ct', d, c.name);
    for (let x0 = 0; x0 < w; x0 += TILE) {
      const cv = el('canvas', null, d);
      const tw = Math.min(TILE, w - x0);
      cv.style.left = x0 + 'px'; cv.style.width = tw + 'px';
      const tl = { cv, c, x0, w: tw, shown: false, audio: c.kind === 'audio' };
      cv._tile = tl; r.tiles.push(tl); io.observe(cv);
    }
  }
}

// a clip name's colour (Live 12.0, traced for the replica, viewer.js textOn): black (ClipText) on a clip colour brighter
// than 110 (sqrt(0.241 r² + 0.691 g² + 0.068 b²) in float), else white, mixed into the clip colour by ClipBlendFactor
function clipText(hex) {
  const fr = Math.fround, n = parseInt(hex.slice(1, 7), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  let s = fr(fr(g * fr(0.691)) * g); s = fr(r * fr(r * fr(0.241)) + s); s = fr(b * fr(b * fr(0.068)) + s);
  const fg = Math.trunc(fr(Math.sqrt(s))) > 110 ? 0 : 255, k = fr(0.7580000162);
  return 'rgb(' + [r, g, b].map(v => Math.trunc(v + k * (fg - v))).join(',') + ')';
}
// one canvas of a clip: its notes or waveform for css px x0 .. x0 + w of the clip
function drawTile(tl) {
  const { cv, c } = tl, dpr = DPR(), h = cv.clientHeight;
  if (!h) return;
  const W = Math.max(1, Math.round(tl.w * dpr)), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  const col = c.disabled ? '#636363' : c.color;
  if (c.kind === 'midi') drawNotes(ctx, c, tl, W, H, dpr, col);
  else drawWave(ctx, c, tl, W, H, dpr, col);
  tl.drawn = true;
}
// note and waveform colour: Live's WaveformColor (#171717 at alpha 0xef) over the clip colour
function inkOver(col, a = 0xef) {
  const n = parseInt(col.slice(1, 7), 16);
  return 'rgb(' + [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round((23 * a + v * (255 - a)) / 255)).join(',') + ')';
}
function drawNotes(ctx, c, tl, W, H, dpr, col) {
  if (!c.notes.length) return;
  const range = c.hi - c.lo + 1, rowH = Math.max(1, Math.floor((H - 2 * dpr) / range)), nh = Math.max(1, rowH - Math.max(1, Math.round(dpr)));
  const top = Math.floor((H - rowH * range) / 2), len = c.end - c.start, ppx = view.ppb * dpr, x0 = tl.x0 * dpr;
  ctx.fillStyle = inkOver(col);
  let d = 0;
  for (let k = 0; k < 4000 && d < len; k++) {
    const cs = contentAt(c, d), pe = Math.min(len, nextWrap(c, d)), ce = cs + (pe - d);
    if (d * ppx - x0 > W) break;
    if (pe * ppx - x0 >= 0) for (const n of c.notes) {
      if (n.t + n.d <= cs || n.t >= ce) continue;
      const s = Math.max(n.t, cs), e = Math.min(n.t + n.d, ce);
      const a = Math.round((d + s - cs) * ppx - x0), b = Math.round((d + e - cs) * ppx - x0);
      if (b < 0 || a > W) continue;
      ctx.globalAlpha = n.on ? 1 : 0.35;
      ctx.fillRect(a, top + (c.hi - n.key) * rowH, Math.max(1, b - a - 1), nh);
    }
    if (pe === Infinity) break;
    d = pe;
  }
  ctx.globalAlpha = 1;
}
function drawWave(ctx, c, tl, W, H, dpr, col) {
  const pk = c.file ? peaks.get(c.file) : null;
  if (!pk || !pk.done) return;
  const len = c.end - c.start, ppx = view.ppb * dpr, x0 = tl.x0 * dpr, gain = c.gain ?? 1;
  const secAt = dd => c.warped ? warpSec(c, contentAt(c, dd)) : contentAt(c, tempoMap.sec(c.start + dd) - tempoMap.sec(c.start));
  const chs = pk.ch, hh = H / chs;
  ctx.fillStyle = inkOver(col);
  for (let x = 0; x < W; x++) {
    const d0 = (x0 + x) / ppx, d1 = (x0 + x + 1) / ppx;
    if (d0 >= len) break;
    // content seconds at the column's two edges (a loop wrap inside the column: the part before it)
    const w = nextWrap(c, d0), e = Math.min(d1, w - 1e-9, len);
    let f0 = secAt(d0) * pk.sr, f1 = secAt(e) * pk.sr;
    if (f1 < f0) [f0, f1] = [f1, f0];
    const span = Math.max(1, f1 - f0), k = Math.max(4, Math.floor(Math.log2(span)));
    const size = 2 ** k, j0 = Math.floor(f0 / size), j1 = Math.max(j0, Math.floor((f1 - 1) / size));
    for (let ch = 0; ch < chs; ch++) {
      let lo = 0, hi = 0;
      for (let j = j0; j <= j1; j++) { const [a, b] = blockMinMax(pk, k, j, ch); if (a < lo) lo = a; if (b > hi) hi = b; }
      const cy = hh * ch + hh / 2, s = hh / 2 - 0.5 * dpr;
      const ya = clamp(cy - hi * gain * s, hh * ch, hh * (ch + 1)), yb = clamp(cy - lo * gain * s, hh * ch, hh * (ch + 1));
      ctx.fillRect(x, Math.floor(ya), 1, Math.max(1, Math.ceil(yb) - Math.floor(ya)));
    }
  }
}

function placeLine(e, b) { e.style.transform = `translateX(${Math.round(headW + b * view.ppb)}px)`; }

function layoutLoop() {
  const L = set.loop, br = $('#brace');
  br.style.left = L.start * view.ppb + 'px'; br.style.width = Math.max(4, L.length * view.ppb) + 'px';
  br.classList.toggle('on', L.on);
  for (const [id, b] of [['#ll0', L.start], ['#ll1', L.start + L.length]]) {
    const e = $(id); e.style.display = L.on ? 'block' : 'none'; placeLine(e, b);
  }
}

// ---------------------------------------------------------------------------
// Transport, position, follow

function showPos(b) {
  $('#pos').textContent = fmtPos(b).join('. ');
  $('#tempo').textContent = tempoMap.tempoAt(Math.max(0, b)).toFixed(2);
}
function showPlay(b) {
  placeLine($('#playhead'), b);
  showPos(b);
  // Follow (Live 12.0, traced for the replica): the play line is kept at the middle of the lanes once it gets there
  if (view.follow && !view.followPaused) {
    const target = Math.max(0, Math.round(b * view.ppb) - Math.trunc(lanesW() * 0.5));
    if (Math.abs(scroller.scrollLeft - target) >= 1) { scroller.scrollLeft = target; }
    expectLeft = scroller.scrollLeft;
  }
}
function setFollowPaused(v) { view.followPaused = v; $('#follow').classList.toggle('paused', v); }
// a sideways scroll by the user while Follow scrolls the playing song pauses Follow (Live: the Follow button turns
// Alert; it goes on with Stop and Play, or a click on Follow)
scroller.addEventListener('scroll', () => {
  if (engine.playing && view.follow && !view.followPaused && Math.abs(scroller.scrollLeft - expectLeft) > 1) setFollowPaused(true);
  if (!engine.playing || !view.follow || view.followPaused) expectLeft = scroller.scrollLeft;
}, { passive: true });

function setInsert(b) {
  view.insert = Math.max(0, b);
  placeLine($('#insert'), view.insert);
  if (!engine.playing) showPos(view.insert);
}
// a beat from a pointer's x, snapped to the grid
function beatAt(clientX, snap = true) {
  const r = content.getBoundingClientRect();
  const b = (clientX - r.left - headW) / view.ppb;
  if (!snap) return clamp(b, 0, beats);
  const s = gridStep();
  return clamp(Math.round(b / s) * s, 0, beats);
}
function laneClick(e) { if (set) setInsert(beatAt(e.clientX)); }

// playing on from here with the loop changed: playback is planned again from just ahead of the play line
function replan() {
  if (!engine.playing) return;
  const b = engine.beatNow() + 0.06 * tempoMap.tempoAt(engine.beatNow()) / 60;
  engine.jump(b, b);
}

$('#play').addEventListener('pointerdown', e => { if (e.button === 0 && set) engine.play(view.insert); });
$('#stop').addEventListener('click', () => {
  if (!set) return;
  if (engine.playing) { engine.stop(); return; }
  setInsert(0);
});
$('#loop').addEventListener('click', () => {
  if (!set) return;
  set.loop.on = !set.loop.on; $('#loop').classList.toggle('on', set.loop.on);
  layoutLoop(); replan();
});
$('#follow').addEventListener('click', () => {
  if (view.followPaused) { setFollowPaused(false); return; }
  view.follow = !view.follow; $('#follow').classList.toggle('on', view.follow);
});
addEventListener('keydown', e => {
  if (!set || e.target.closest?.('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); if (engine.playing) engine.stop(); else engine.play(view.insert); }
  if (e.key === '+' || e.key === '=') zoom(1.6);
  if (e.key === '-') zoom(0.625);
});

// ---------------------------------------------------------------------------
// Zoom: buttons, + / - and Ctrl + wheel (a trackpad pinch); the play line stays put while Follow scrolls, else the
// pointer's beat (wheel) or the middle of the lanes (buttons, keys)

function zoom(f, clientX) {
  if (!set) return;
  const ppb = clamp(view.ppb * f, Math.min(fitPpb(), 3), MAX_PPB);
  if (ppb === view.ppb) return;
  const following = engine.playing && view.follow && !view.followPaused;
  const r = scroller.getBoundingClientRect();
  const vx = clientX != null ? clientX - r.left : headW + lanesW() / 2;
  const b = following ? engine.beatNow() : (scroller.scrollLeft + vx - headW) / view.ppb;
  const ax = following ? headW + b * view.ppb - scroller.scrollLeft : vx;
  view.ppb = ppb;
  layoutTimeline();
  scroller.scrollLeft = headW + b * ppb - ax;
  expectLeft = scroller.scrollLeft;
}
$('#zin').addEventListener('click', () => zoom(1.6));
$('#zout').addEventListener('click', () => zoom(0.625));
scroller.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoom(Math.exp(-e.deltaY * 0.01), e.clientX);
}, { passive: false });

// ---------------------------------------------------------------------------
// Ruler: the scrub area (press plays from the bar / jumps there at the next bar, held: the bar repeats) and the loop
// brace (drag the middle to move it, an end to resize it; snapped to the grid)

ruler.addEventListener('pointerdown', e => {
  if (!set || e.button !== 0 || e.target.closest('#brace')) return;
  e.preventDefault();
  ruler.setPointerCapture(e.pointerId);
  engine.scrubPress(beatAt(e.clientX, false), quantBeats(set.quant));
  const up = () => { engine.scrubRelease(); ruler.removeEventListener('pointerup', up); ruler.removeEventListener('pointercancel', up); };
  ruler.addEventListener('pointerup', up); ruler.addEventListener('pointercancel', up);
});
$('#brace').addEventListener('pointerdown', e => {
  if (!set || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const br = $('#brace'), L = set.loop, mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm';
  br.setPointerCapture(e.pointerId); br.classList.add('sel');
  const s0 = L.start, len0 = L.length, b0 = beatAt(e.clientX, false), step = gridStep();
  const move = ev => {
    const b = beatAt(ev.clientX, false);
    if (mode === 'm') L.start = clamp(Math.round((s0 + b - b0) / step) * step, 0, beats - len0);
    else if (mode === 'l') { const s = clamp(Math.round(b / step) * step, 0, s0 + len0 - step); L.length = s0 + len0 - s; L.start = s; }
    else L.length = Math.max(step, clamp(Math.round(b / step) * step, 0, beats) - s0);
    layoutLoop();
  };
  const up = () => {
    br.classList.remove('sel');
    br.removeEventListener('pointermove', move); br.removeEventListener('pointerup', up); br.removeEventListener('pointercancel', up);
    if (L.start !== s0 || L.length !== len0) replan();
  };
  br.addEventListener('pointermove', move); br.addEventListener('pointerup', up); br.addEventListener('pointercancel', up);
});

// ---------------------------------------------------------------------------
// Projects (projects/manifest.json)

$('#proj').addEventListener('click', e => {
  e.stopPropagation();
  const m = $('#proj-menu');
  if (!m.hidden) { m.hidden = true; return; }
  m.textContent = '';
  for (const p of projects) {
    const d = el('div', p === current ? 'on' : '', m, p.name);
    d.addEventListener('click', () => { m.hidden = true; openProject(p); });
  }
  if (!projects.length) el('div', '', m, 'No projects');
  m.hidden = false;
});
addEventListener('click', () => { $('#proj-menu').hidden = true; });
function openProject(p) {
  current = p;
  $('#proj-name').textContent = p.name;
  progressDialog(`Downloading ${p.name}…`, 0);
  fetchProject(p);
}

let resizeT = 0;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (!set) return;
    const hw = cssPx('--head-w');
    if (hw !== headW) { headW = hw; }
    if (view.ppb < fitPpb() && fitPpb() <= MAX_PPB) view.ppb = fitPpb();
    layoutTimeline();
  }, 100);
});

(async () => {
  try {
    const res = await fetch('projects/manifest.json', { cache: 'no-cache' });
    projects = (await res.json()).projects || [];
  } catch (e) { projects = []; }
  if (projects.length) openProject(projects[0]);
  else openDialog('No projects yet.');
})();
