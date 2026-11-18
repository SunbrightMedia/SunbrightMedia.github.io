(() => {
  'use strict';
  const FL = window.FontLab, Shapes = FL.Shapes, Nature = window.FontLabNature;
  const $ = id => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const smooth = (a, b, v) => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k); };

  // ---------- presets ----------
  const M = (type, level, params) => {
    const def = FL.MODIFIERS[type];
    return { id: uid(), type, level, on: true, params: def.spatial ? Object.assign({}, def.params, params) : params };
  };
  const PRESETS = {
    'Warp + moss (drag them)': () => [
      M('warp', 'space', { shape: 'star', x: '470', y: '-45', size: '55', intensity: '10', feather: '25' }),
      M('nature', 'space', { x: '200', y: '-30', size: '170', temperament: '0.3', energy: '0.65' }),
    ],
    'Warp sweep (circle)': () => [M('warp', 'space', { x: '380 + sin(t*0.7)*420', y: '-40', size: '40', intensity: '8', feather: '45' })],
    'Warp: star, rounded by intensity': () => [M('warp', 'space', { shape: 'star', x: '380', y: '40', size: '90', rot: 't*20', intensity: '20 + tri(t*0.15)*60', feather: '10' })],
    'Moss sweep': () => [M('nature', 'space', { x: '380 + sin(t*0.4)*400', y: '40', size: '170', temperament: '0.25', energy: '0.7' })],
    'Lichen (dry)': () => [M('nature', 'space', { x: '380', y: '40', size: '600', temperament: '0.85', energy: '0.7' })],
    'Wet ↔ dry cycle': () => [M('nature', 'space', { x: '380', y: '40', size: '600', temperament: '0.5 - cos(t*0.25)*0.5', energy: '0.7' })],
    'Wave (per glyph)': () => [M('transform', 'glyph', { ty: 'sin(t*3 - i*0.6) * size*0.12' })],
    'Typewriter (per glyph)': () => [M('visible', 'glyph', { show: 'fract(t*0.15)*n*1.6 - i' })],
    'Wobbly outlines (per point)': () => [
      M('resample', 'contour', { step: '3' }),
      M('displace', 'point', { dx: 'noise(x*0.02, y*0.02 + t) * size*0.04', dy: 'noise(y*0.02 + 40, x*0.02 + t) * size*0.04' }),
    ],
    'Explode and return (per glyph)': () => [M('transform', 'glyph', {
      tx: '(rnd(i)-0.5) * size*4 * pow(sin(t)*0.5+0.5, 3)',
      ty: '(rnd(i,7)-0.5) * size*3 * pow(sin(t)*0.5+0.5, 3)',
      rot: '(rnd(i,3)-0.5) * 720 * pow(sin(t)*0.5+0.5, 3)',
    })],
    'Rainbow draw-on (outline)': () => [M('style', 'glyph', {
      fill: 'none', stroke: 'hsl(i*35 + t*60, 90, 55)', sw: 'size*0.015', draw: 'clamp(fract(t*0.25)*2.5 - u, 0, 1)',
    })],
    'Spinning holes (per contour)': () => [M('transform', 'contour', { rot: 'sin(t*2 + ci) * 25' })],
    'Jelly words (per word)': () => [M('transform', 'word', { sx: '1 + sin(t*5 + i)*0.08', sy: '1 - sin(t*5 + i)*0.08', py: '1' })],
    'Melt (per point)': () => [
      M('resample', 'contour', { step: '3' }),
      M('displace', 'point', { dy: 'pow(noise(x*0.05, gi) * 0.5 + 0.5, 3) * size*0.8 * tri(t*0.2) * smoothstep(-size*0.75, size*0.1, y - li*size*1.2)' }),
    ],
  };

  const DEFAULT_PROJECT = {
    font: 'url:../fonts/segoeuib.ttf',
    text: 'Sunbright\nfont lab',
    layout: Object.assign({}, FL.LAYOUT_DEFAULTS, { size: 160 }),
    fill: '#111111',
    bg: '#ffffff',
    mods: PRESETS['Warp + moss (drag them)'](),
  };

  const STORE_KEY = 'fontlab.project.v1';
  function loadProject() {
    try { const p = JSON.parse(localStorage.getItem(STORE_KEY)); if (p && p.mods) return normalize(p); } catch (e) { /* ignore */ }
    return normalize(clone(DEFAULT_PROJECT));
  }
  function normalize(p) {
    p = Object.assign(clone(DEFAULT_PROJECT), p);
    p.layout = Object.assign({}, FL.LAYOUT_DEFAULTS, p.layout);
    p.mods = (p.mods || []).filter(m => FL.MODIFIERS[m.type]).map(m => {
      m = Object.assign({ id: uid(), on: true, params: {} }, m);
      const def = FL.MODIFIERS[m.type];
      if (def.spatial) m.params = Object.assign({}, def.params, m.params);
      return m;
    });
    return p;
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(project)); } catch (e) { /* ignore */ } }, 300);
  }

  let project = loadProject();
  let font = null, base = null, S = null, field = null;
  let playing = true, t = 0, last = performance.now(), dirty = true;
  let view = { x: 0, y: 0, w: 1000, h: 500 };
  let selected = null, drag = null, fxDrawn = false, clipPath = null, glyphD = [];

  function status(msg, isErr) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!isErr); }

  // ---------- font storage (IndexedDB, local to this browser) ----------
  const BUILTIN = [
    { name: 'Segoe UI Bold (site)', url: '../fonts/segoeuib.ttf' },
    { name: 'Segoe UI (site)', url: '../fonts/segoeui.ttf' },
    { name: 'Segoe UI Light (site)', url: '../fonts/segoeuil.ttf' },
  ];
  const db = {
    _p: null,
    open() {
      if (!this._p) this._p = new Promise((res, rej) => {
        const r = indexedDB.open('fontlab', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('fonts', { keyPath: 'name' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return this._p;
    },
    async tx(mode, fn) {
      const d = await this.open();
      return new Promise((res, rej) => {
        const req = fn(d.transaction('fonts', mode).objectStore('fonts'));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    },
    names() { return this.tx('readonly', s => s.getAllKeys()); },
    get(name) { return this.tx('readonly', s => s.get(name)); },
    put(name, data) { return this.tx('readwrite', s => s.put({ name, data, added: Date.now() })); },
    del(name) { return this.tx('readwrite', s => s.delete(name)); },
  };

  async function refreshFonts() {
    const sel = $('fontSel');
    let names = [];
    try { names = await db.names(); } catch (e) { status('Browser storage unavailable: fonts will not be remembered.', true); }
    sel.innerHTML = '';
    if (names.length) {
      const g = document.createElement('optgroup'); g.label = 'On this device';
      for (const n of names) g.append(new Option(n, 'idb:' + n));
      sel.append(g);
    }
    const g2 = document.createElement('optgroup'); g2.label = 'Site';
    for (const b of BUILTIN) g2.append(new Option(b.name, 'url:' + b.url));
    sel.append(g2);
    sel.value = project.font;
    if (sel.value !== project.font) sel.selectedIndex = 0;
  }

  async function useFont(val) {
    try {
      let buf;
      if (val.startsWith('idb:')) { const r = await db.get(val.slice(4)); if (!r) throw new Error('not found in browser storage'); buf = r.data; }
      else { const r = await fetch(val.slice(4)); if (!r.ok) throw new Error('HTTP ' + r.status); buf = await r.arrayBuffer(); }
      font = opentype.parse(buf);
      project.font = val; save();
      $('fontSel').value = val;
      status(`${fontLabel(font)} · ${font.glyphs.length} glyphs · ${font.unitsPerEm} units/em`);
      rebuild(true);
    } catch (e) {
      status('Could not load font: ' + e.message, true);
    }
  }
  function fontLabel(f) {
    const n = f.names || {}, pick = k => n[k] && (n[k].en || Object.values(n[k])[0]);
    return [pick('fontFamily'), pick('fontSubfamily')].filter(Boolean).join(' ') || 'font';
  }

  async function addFontFiles(files) {
    let lastName = null;
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        opentype.parse(buf); // validate before storing
        await db.put(file.name, buf);
        lastName = file.name;
      } catch (e) {
        status(`${file.name}: ${/woff2/i.test(file.name) ? 'WOFF2 is not supported, use TTF/OTF/WOFF' : e.message}`, true);
      }
    }
    if (lastName) { project.font = 'idb:' + lastName; await refreshFonts(); await useFont(project.font); }
  }

  // ---------- geometry ----------
  const needsNature = () => project.mods.some(m => m.type === 'nature');
  function ensureNature() {
    if (base && needsNature() && !base.nature) {
      try { field = Nature.prepare(base); Nature.sprites(); } catch (e) { status('Nature analysis failed: ' + e.message, true); }
    }
  }
  function rebuild(refit) {
    if (!font) return;
    try { base = FL.layout(font, project.text, project.layout); }
    catch (e) { status('Layout failed: ' + e.message, true); return; }
    field = null;
    ensureNature();
    if (refit) fit();
    dirty = true;
  }

  function fit() {
    if (!base) return;
    const b = FL.bounds(FL.evaluate(base, [], 0), false);
    const pad = Math.max(b.w, b.h, base.size) * 0.15;
    view = { x: b.x - pad, y: b.y - pad, w: Math.max(b.w + pad * 2, 1), h: Math.max(b.h + pad * 2, 1) };
    applyView();
  }
  function applyView() {
    for (const id of ['svg', 'ui']) $(id).setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    for (const id of ['bgRect', 'holesRect']) {
      const r = $(id);
      r.setAttribute('x', view.x - view.w * 50); r.setAttribute('y', view.y - view.h * 50);
      r.setAttribute('width', view.w * 101); r.setAttribute('height', view.h * 101);
    }
    const m = $('holesMask');
    m.setAttribute('x', view.x - view.w * 50); m.setAttribute('y', view.y - view.h * 50);
    m.setAttribute('width', view.w * 101); m.setAttribute('height', view.h * 101);
    dirty = true;
  }
  // Same mapping as the SVG viewBox with preserveAspectRatio="xMidYMid meet".
  function metrics() {
    const el = $('stageWrap'), W = el.clientWidth || 1, H = el.clientHeight || 1;
    const s = Math.min(W / view.w, H / view.h);
    return { W, H, s, ox: (W - view.w * s) / 2 - view.x * s, oy: (H - view.h * s) / 2 - view.y * s };
  }
  function toWorld(cx, cy) {
    const r = $('stageWrap').getBoundingClientRect(), m = metrics();
    return { x: (cx - r.left - m.ox) / m.s, y: (cy - r.top - m.oy) / m.s };
  }
  function sizeCanvas(cv) {
    const m = metrics(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(m.W * dpr), h = Math.round(m.H * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { m, dpr };
  }

  // ---------- rendering ----------
  const paths = [];
  function render() {
    const content = $('content');
    const n = S.nodes.glyph.length;
    while (paths.length < n) { const p = document.createElementNS(SVGNS, 'path'); content.append(p); paths.push(p); }
    while (paths.length > n) paths.pop().remove();
    $('bgRect').setAttribute('fill', project.bg);
    glyphD = [];
    for (let gi = 0; gi < n; gi++) {
      const p = paths[gi], st = S.style[gi], d = FL.glyphPathData(S, gi);
      glyphD.push(d);
      p.setAttribute('d', d);
      p.setAttribute('fill', st.fill != null ? st.fill : project.fill);
      if (st.stroke != null) {
        p.setAttribute('stroke', st.stroke);
        p.setAttribute('stroke-width', st.sw != null ? st.sw : 1);
        p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round');
      } else p.removeAttribute('stroke');
      if (st.opacity != null) p.setAttribute('opacity', st.opacity); else p.removeAttribute('opacity');
      if (st.draw != null) { p.setAttribute('pathLength', '1'); p.setAttribute('stroke-dasharray', `${Math.max(0, Math.min(1, st.draw))} 1.0001`); }
      else { p.removeAttribute('pathLength'); p.removeAttribute('stroke-dasharray'); }
    }
    clipPath = null;
    if (S.holes.length) {
      $('holesPath').setAttribute('d', S.holes.map(Shapes.polyD).join(''));
      content.setAttribute('mask', 'url(#holesMask)');
    } else content.removeAttribute('mask');
    renderOverlay();
  }

  function renderOverlay() {
    const g = $('overlayG'), lvl = $('overlay').value;
    if (!lvl) { if (g.firstChild) g.innerHTML = ''; return; }
    const sw = 1 / metrics().s;
    let h = '';
    if (lvl === 'point') {
      let c = 0;
      outer: for (let ci = 0; ci < S.contours.length; ci++) {
        if (S.hidden[ci] || S.contours[ci].attach) continue;
        for (const k of S.contours[ci].cmds) for (let j = 0; j < k.p.length; j++) {
          if (++c > 6000) break outer;
          const p = k.p[j], ctrl = j < k.p.length - 1;
          h += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(sw * (ctrl ? 1.5 : 2.2)).toFixed(2)}" fill="${ctrl ? '#e0a000' : '#0a62d0'}"/>`;
        }
      }
    } else {
      S.nodes[lvl].slice(0, 3000).forEach((nd, j) => {
        const b = FL.bbox(S, nd.cs.filter(ci => !S.hidden[ci]));
        if (!b.w && !b.h) return;
        h += `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" fill="none" stroke="#e0007a" stroke-width="${sw.toFixed(2)}"/>`
          + `<text x="${b.x.toFixed(1)}" y="${(b.y - sw * 3).toFixed(1)}" font-size="${(sw * 11).toFixed(1)}" fill="#e0007a" font-family="monospace">${j}</text>`;
      });
    }
    g.innerHTML = h;
  }

  const GIZMO_COLOR = { warp: '#0a84ff', nature: '#2e9d3a' };
  function renderGizmos() {
    const g = $('gizmoG');
    if (!$('gizmos').checked || !S) { if (g.firstChild) g.innerHTML = ''; return; }
    const k = 1 / metrics().s; // world units per screen pixel
    let h = '';
    for (const f of S.fx) {
      const sh = f.shape, col = GIZMO_COLOR[f.type] || '#888', sel = f.id === selected;
      const ring = Shapes.polyD(Shapes.levelPolygon(sh, 0, 96));
      const infl = f.type === 'warp' && f.R > 0 ? Shapes.polyD(Shapes.levelPolygon(sh, f.R, 96)) : '';
      const outer = f.type === 'warp' && f.F > 0 ? Shapes.polyD(Shapes.levelPolygon(sh, f.R + f.F, 96)) : '';
      const sw = (sel ? 2 : 1.25) * k;
      h += `<g data-gizmo="${f.id}" data-part="body" style="cursor:move">`
        + `<path d="${infl || ring}" fill="${col}" fill-opacity="${sel ? 0.12 : 0.06}" stroke="${col}" stroke-width="${sw}"/>`
        + (infl ? `<path d="${ring}" fill="none" stroke="${col}" stroke-width="${k}" stroke-dasharray="${4 * k} ${3 * k}" pointer-events="none"/>` : '')
        + (outer ? `<path d="${outer}" fill="none" stroke="${col}" stroke-opacity="0.55" stroke-width="${k}" stroke-dasharray="${1.5 * k} ${3 * k}" pointer-events="none"/>` : '')
        + `<circle cx="${sh.cx}" cy="${sh.cy}" r="${2.5 * k}" fill="${col}"/>`
        + `</g>`
        + `<line x1="${sh.cx}" y1="${sh.cy}" x2="${sh.handle[0]}" y2="${sh.handle[1]}" stroke="${col}" stroke-width="${k}" pointer-events="none"/>`
        + `<circle data-gizmo="${f.id}" data-part="handle" cx="${sh.handle[0]}" cy="${sh.handle[1]}" r="${6 * k}" fill="#fff" stroke="${col}" stroke-width="${2 * k}" style="cursor:crosshair"/>`
        + `<text x="${sh.handle[0] + 9 * k}" y="${sh.handle[1] - 7 * k}" font-size="${11 * k}" fill="${col}" font-family="system-ui,sans-serif" pointer-events="none">${f.type}</text>`;
    }
    g.innerHTML = h;
  }

  function drawFx() {
    const cv = $('fx'), ctx = cv.getContext('2d');
    const { m, dpr } = sizeCanvas(cv);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    fxDrawn = false;
    if (!field || !field.any) return;
    if (!clipPath) clipPath = new Path2D(glyphD.join(''));
    Nature.draw(ctx, field, S, clipPath, { s: dpr * m.s, ox: dpr * m.ox, oy: dpr * m.oy });
    fxDrawn = true;
  }

  // White-on-black view of every spatial modifier's influence, evaluated per pixel.
  const maskSmall = document.createElement('canvas');
  function renderMask() {
    const cv = $('maskCv');
    if (!$('maskView').checked || !S) { cv.style.display = 'none'; return; }
    cv.style.display = 'block';
    const { m, dpr } = sizeCanvas(cv);
    const step = 3, w = Math.ceil(m.W / step), h = Math.ceil(m.H / step);
    maskSmall.width = w; maskSmall.height = h;
    const sctx = maskSmall.getContext('2d'), img = sctx.createImageData(w, h), px = img.data;
    const fxs = S.fx.map(f => ({ f, b: f.shape.bound + (f.type === 'warp' ? f.R + f.F : f.shape.size * 0.2) }));
    for (let j = 0; j < h; j++) {
      const y = ((j + 0.5) * step - m.oy) / m.s;
      for (let i = 0; i < w; i++) {
        const x = ((i + 0.5) * step - m.ox) / m.s;
        let v = 0;
        for (const { f, b } of fxs) {
          const sh = f.shape, dx = x - sh.cx, dy = y - sh.cy;
          if (dx * dx + dy * dy > b * b) continue;
          const d = sh.sdf(x, y);
          let wv;
          if (f.type === 'warp') wv = (f.F > 0 ? 1 - smooth(f.R - f.F, f.R + f.F, d) : d < f.R ? 1 : 0) * f.A;
          else { const soft = sh.size * 0.18; wv = 1 - smooth(-soft, soft * 0.4, d); }
          if (wv > v) v = wv;
        }
        const o = (j * w + i) * 4, c = Math.round(v * 255);
        px[o] = px[o + 1] = px[o + 2] = c; px[o + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(maskSmall, 0, 0, w * step * dpr, h * step * dpr);
    ctx.setTransform(dpr * m.s, 0, 0, dpr * m.s, dpr * m.ox, dpr * m.oy);
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 1.2 / m.s;
    ctx.stroke(new Path2D(glyphD.join('')));
  }

  // ---------- frame loop ----------
  let fpsN = 0, fpsT = performance.now(), fps = 0, evalMs = 0, lastErrUI = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) { t += dt * (+$('speed').value || 0); dirty = true; }
    fpsN++;
    if (now - fpsT > 500) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; updateStats(); }
    if (!base) return;
    let changedGeom = false;
    if (dirty) {
      dirty = false;
      const t0 = performance.now();
      S = FL.evaluate(base, project.mods, t);
      render();
      evalMs = performance.now() - t0;
      changedGeom = true;
      if (document.activeElement !== $('time')) $('time').value = t % 20;
      $('tLabel').textContent = t.toFixed(2) + 's';
      if (now - lastErrUI > 250) { lastErrUI = now; showErrors(); }
      renderGizmos();
      renderMask();
    }
    if (!S) return;
    const growing = field ? Nature.step(field, S, dt) : false;
    if (growing || changedGeom || (fxDrawn && !(field && field.any))) drawFx();
  }
  function updateStats() {
    if (!S) return;
    const live = field ? field.sites.reduce((a, s) => a + (s.g > 0 ? 1 : 0), 0) : 0;
    $('stats').textContent = `${S.nodes.glyph.length} glyphs · ${S.contours.filter(c => !c.attach).length} contours · ${S.points} pts`
      + (field ? ` · ${live}/${field.sites.length} growing` : '') + ` · ${evalMs.toFixed(1)} ms · ${fps} fps`;
  }

  // ---------- modifier stack UI ----------
  const modInputs = new Map(); // id -> {key: {inp, range, msg}}
  function renderMods() {
    const box = $('mods');
    box.innerHTML = '';
    modInputs.clear();
    project.mods.forEach((m, idx) => {
      const def = FL.MODIFIERS[m.type];
      const card = document.createElement('div');
      card.className = 'mod' + (m.on === false ? ' off' : '') + (m.id === selected ? ' sel' : '');
      card.dataset.id = m.id;
      card.addEventListener('pointerdown', () => select(m.id, false));
      const hd = document.createElement('div'); hd.className = 'hd';
      const on = document.createElement('input'); on.type = 'checkbox'; on.checked = m.on !== false; on.title = 'enabled';
      on.onchange = () => { m.on = on.checked; card.classList.toggle('off', !on.checked); changed(); };
      const title = document.createElement('b'); title.textContent = def.label;
      hd.append(on, title);
      if (def.spatial) {
        const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'spatial';
        hd.append(tag, btn('⌖', 'move to the middle of the view', () => {
          setParam(m, 'x', view.x + view.w / 2); setParam(m, 'y', view.y + view.h / 2); changed();
        }));
      } else {
        const lvl = document.createElement('select');
        for (const l of def.levels) lvl.append(new Option('per ' + l, l));
        lvl.value = def.levels.includes(m.level) ? m.level : def.levels[0];
        lvl.onchange = () => { m.level = lvl.value; changed(); };
        hd.append(lvl);
      }
      hd.append(btn('↑', 'move up', () => move(idx, -1)), btn('↓', 'move down', () => move(idx, 1)),
        btn('⧉', 'duplicate', () => { project.mods.splice(idx + 1, 0, Object.assign(clone(m), { id: uid() })); renderMods(); changed(); }),
        btn('✕', 'delete', () => { project.mods.splice(idx, 1); renderMods(); changed(); }));
      card.append(hd);
      const grid = document.createElement('div'); grid.className = 'p';
      const refs = {};
      for (const key in def.params) {
        const doc = (def.docs && def.docs[key]) || '';
        const lab = document.createElement('label'); lab.textContent = key; lab.title = doc;
        const msg = document.createElement('div'); msg.className = 'msg'; msg.hidden = true;
        let cell, inp, range = null;
        if (def.choice && def.choice[key]) {
          inp = document.createElement('select'); inp.title = doc;
          for (const o of def.choice[key]) inp.append(new Option(o, o));
          inp.value = m.params[key] || def.params[key];
          inp.onchange = () => { m.params[key] = inp.value; changed(); };
          cell = inp;
        } else {
          inp = document.createElement('input'); inp.type = 'text'; inp.spellcheck = false; inp.title = doc;
          inp.value = m.params[key] != null ? m.params[key] : '';
          inp.placeholder = def.params[key] === '' ? '(unchanged)' : def.params[key];
          cell = inp;
          if (def.ui && def.ui[key]) {
            const [lo, hi, st] = def.ui[key];
            range = document.createElement('input'); range.type = 'range'; range.min = lo; range.max = hi; range.step = st; range.title = doc;
            const v = parseFloat(inp.value);
            range.value = isFinite(v) ? v : lo;
            range.oninput = () => { inp.value = range.value; m.params[key] = range.value; changed(); };
            cell = document.createElement('div'); cell.className = 'num';
            cell.append(range, inp);
          }
          inp.oninput = () => {
            m.params[key] = inp.value;
            if (range && /^\s*-?[\d.]+\s*$/.test(inp.value)) range.value = parseFloat(inp.value);
            changed();
          };
        }
        grid.append(lab, cell, msg);
        refs[key] = { inp, range, msg };
      }
      card.append(grid);
      box.append(card);
      modInputs.set(m.id, refs);
    });
    if (!project.mods.length) box.innerHTML = '<div style="color:var(--mute)">Empty. Add a modifier or load a preset.</div>';
  }
  function btn(txt, title, fn) { const b = document.createElement('button'); b.textContent = txt; b.title = title; b.onclick = fn; return b; }
  function move(idx, d) {
    const j = idx + d;
    if (j < 0 || j >= project.mods.length) return;
    const [m] = project.mods.splice(idx, 1); project.mods.splice(j, 0, m);
    renderMods(); changed();
  }
  function setParam(m, key, v) {
    const s = String(Math.round(v * 10) / 10);
    m.params[key] = s;
    const r = modInputs.get(m.id);
    if (r && r[key]) { r[key].inp.value = s; if (r[key].range) r[key].range.value = s; }
  }
  function select(id, scroll) {
    if (selected === id) return;
    selected = id;
    for (const c of $('mods').children) c.classList && c.classList.toggle('sel', c.dataset.id === id);
    if (scroll) { const c = [...$('mods').children].find(c => c.dataset.id === id); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    dirty = true;
  }
  function showErrors() {
    if (!S) return;
    for (const [id, refs] of modInputs) {
      const e = S.errors[id] || {};
      for (const key in refs) {
        const msg = e[key] || '';
        refs[key].inp.classList.toggle('err', !!msg);
        refs[key].msg.hidden = !msg;
        refs[key].msg.textContent = msg;
      }
    }
  }
  function changed() { ensureNature(); dirty = true; save(); }

  function fillAddLevels() {
    const def = FL.MODIFIERS[$('addType').value], sel = $('addLevel');
    sel.innerHTML = '';
    for (const l of def.levels) sel.append(new Option(def.spatial ? 'spatial' : 'per ' + l, l));
  }

  // ---------- project form ----------
  const LAYOUT_FIELDS = ['size', 'lineHeight', 'letterSpacing', 'wordSpacing'];
  function syncForm() {
    $('text').value = project.text;
    for (const k of LAYOUT_FIELDS) $(k).value = project.layout[k];
    $('align').value = project.layout.align;
    $('kerning').checked = !!project.layout.kerning;
    $('liga').checked = !!project.layout.liga;
    $('fill').value = project.fill;
    $('bg').value = project.bg;
  }

  function download(name, data, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function exportPNG() {
    if (!S) return;
    const m = metrics(), dpr = 2, W = Math.round(m.W * dpr), H = Math.round(m.H * dpr);
    const vb = [-m.ox / m.s, -m.oy / m.s, m.W / m.s, m.H / m.s];
    const svg = FL.toSVG(S, { fill: project.fill, background: project.bg, viewBox: vb, width: W, height: H });
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try { await img.decode(); } catch (e) { status('PNG export failed: ' + e.message, true); return; }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(img.src);
    if (fxDrawn) ctx.drawImage($('fx'), 0, 0, W, H);
    cv.toBlob(b => download('fontlab-frame.png', b), 'image/png');
  }

  // ---------- wiring ----------
  function wire() {
    $('fontSel').onchange = e => useFont(e.target.value);
    $('fontFile').onchange = e => { addFontFiles([...e.target.files]); e.target.value = ''; };
    $('fontDel').onclick = async () => {
      const v = $('fontSel').value;
      if (!v.startsWith('idb:')) { status('Site fonts cannot be removed here.', true); return; }
      if (!confirm(`Remove ${v.slice(4)} from this browser?`)) return;
      await db.del(v.slice(4));
      project.font = DEFAULT_PROJECT.font;
      await refreshFonts(); useFont(project.font);
    };
    $('exportGlyphs').onclick = () => {
      if (!font) return;
      const name = (fontLabel(font) || 'font').replace(/[^\w.-]+/g, '_');
      download(name + '.glyphs.json', JSON.stringify(FL.fontToJSON(font)), 'application/json');
    };

    $('text').oninput = e => { project.text = e.target.value; save(); rebuild(true); };
    for (const k of LAYOUT_FIELDS) $(k).oninput = e => { const v = parseFloat(e.target.value); if (isFinite(v)) { project.layout[k] = v; save(); rebuild(k === 'size'); } };
    $('align').onchange = e => { project.layout.align = e.target.value; save(); rebuild(true); };
    $('kerning').onchange = e => { project.layout.kerning = e.target.checked; save(); rebuild(); };
    $('liga').onchange = e => { project.layout.liga = e.target.checked; save(); rebuild(); };
    $('fill').oninput = e => { project.fill = e.target.value; changed(); };
    $('bg').oninput = e => { project.bg = e.target.value; changed(); };

    for (const name in PRESETS) $('preset').append(new Option(name, name));
    $('presetLoad').onclick = () => { project.mods = PRESETS[$('preset').value](); t = 0; renderMods(); changed(); };
    $('presetAdd').onclick = () => { project.mods.push(...PRESETS[$('preset').value]()); renderMods(); changed(); };

    for (const k in FL.MODIFIERS) $('addType').append(new Option(FL.MODIFIERS[k].label, k));
    $('addType').onchange = fillAddLevels;
    fillAddLevels();
    $('addMod').onclick = () => {
      const type = $('addType').value, def = FL.MODIFIERS[type];
      const m = { id: uid(), type, level: $('addLevel').value, on: true, params: Object.assign({}, def.params) };
      project.mods.push(m);
      renderMods();
      if (def.spatial) { setParam(m, 'x', view.x + view.w / 2); setParam(m, 'y', view.y + view.h / 2); select(m.id, true); }
      changed();
    };

    for (const l of FL.LEVELS) $('overlay').append(new Option('per ' + l, l));
    $('overlay').onchange = () => { dirty = true; };
    $('gizmos').onchange = () => { dirty = true; };
    $('maskView').onchange = () => { dirty = true; };

    $('play').onclick = togglePlay;
    $('time').oninput = e => { t = parseFloat(e.target.value); dirty = true; };
    $('fit').onclick = fit;
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
    });

    $('exportSvg').onclick = () => { if (S) download('fontlab-frame.svg', FL.toSVG(S, { fill: project.fill, background: project.bg }), 'image/svg+xml'); };
    $('exportPng').onclick = exportPNG;
    $('exportProj').onclick = () => download('fontlab-project.json', JSON.stringify(project, null, 2), 'application/json');
    $('importProjBtn').onclick = () => $('importProj').click();
    $('importProj').onchange = async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { project = normalize(JSON.parse(await f.text())); syncForm(); renderMods(); save(); await refreshFonts(); useFont($('fontSel').value); }
      catch (err) { status('Could not open project: ' + err.message, true); }
    };
    $('reset').onclick = () => {
      if (!confirm('Reset text, layout and modifiers to defaults? Stored fonts are kept.')) return;
      project = normalize(clone(DEFAULT_PROJECT)); syncForm(); renderMods(); save(); useFont(project.font);
    };

    // drag and drop fonts anywhere
    let dragDepth = 0;
    window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
      const files = [...e.dataTransfer.files];
      const proj = files.find(f => /\.json$/i.test(f.name));
      const fonts = files.filter(f => /\.(ttf|otf|woff2?)$/i.test(f.name));
      if (fonts.length) addFontFiles(fonts);
      else if (proj) { const dt = new DataTransfer(); dt.items.add(proj); $('importProj').files = dt.files; $('importProj').onchange({ target: $('importProj') }); }
    });

    // stage: drag gizmos, otherwise pan (one pointer) and pinch-zoom (two)
    const ui = $('ui');
    ui.addEventListener('wheel', e => {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY), k = Math.exp(e.deltaY * 0.0015);
      view = { x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w: view.w * k, h: view.h * k };
      applyView();
    }, { passive: false });
    const ptrs = new Map();
    ui.addEventListener('pointerdown', e => {
      ui.setPointerCapture(e.pointerId);
      const gz = e.target.closest && e.target.closest('[data-gizmo]');
      if (gz && !ptrs.size && S) {
        const m = project.mods.find(x => x.id === gz.dataset.gizmo), f = S.fx.find(x => x.id === gz.dataset.gizmo);
        if (m && f) {
          const w = toWorld(e.clientX, e.clientY);
          drag = { pid: e.pointerId, m, part: gz.dataset.part, dx: w.x - f.shape.cx, dy: w.y - f.shape.cy, cx: f.shape.cx, cy: f.shape.cy };
          select(m.id, true);
          return;
        }
      }
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    });
    ui.addEventListener('pointermove', e => {
      if (drag && e.pointerId === drag.pid) {
        const w = toWorld(e.clientX, e.clientY);
        if (drag.part === 'handle') {
          setParam(drag.m, 'size', Math.max(2, Math.hypot(w.x - drag.cx, w.y - drag.cy)));
          setParam(drag.m, 'rot', Math.atan2(w.x - drag.cx, -(w.y - drag.cy)) * 180 / Math.PI);
        } else {
          drag.cx = w.x - drag.dx; drag.cy = w.y - drag.dy;
          setParam(drag.m, 'x', drag.cx); setParam(drag.m, 'y', drag.cy);
        }
        changed();
        return;
      }
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId);
      if (ptrs.size === 1) {
        const a = toWorld(prev[0], prev[1]), b = toWorld(e.clientX, e.clientY);
        view.x -= b.x - a.x; view.y -= b.y - a.y;
      } else if (ptrs.size === 2) {
        const [o] = [...ptrs.entries()].filter(([id]) => id !== e.pointerId).map(([, v]) => v);
        const d0 = Math.hypot(prev[0] - o[0], prev[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
        if (d0 > 0 && d1 > 0) {
          const mid = toWorld((e.clientX + o[0]) / 2, (e.clientY + o[1]) / 2), k = d0 / d1;
          view = { x: mid.x - (mid.x - view.x) * k, y: mid.y - (mid.y - view.y) * k, w: view.w * k, h: view.h * k };
        }
      }
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      applyView();
    });
    const up = e => { ptrs.delete(e.pointerId); if (drag && drag.pid === e.pointerId) drag = null; };
    ui.addEventListener('pointerup', up);
    ui.addEventListener('pointercancel', up);
    window.addEventListener('resize', () => { dirty = true; });
  }
  function togglePlay() { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; last = performance.now(); }

  // ---------- start ----------
  wire();
  syncForm();
  renderMods();
  refreshFonts().then(() => useFont($('fontSel').value));
  requestAnimationFrame(frame);

  window.fontlab = { get project() { return project; }, get frame() { return S; }, get font() { return font; }, get field() { return field; } }; // for console tinkering
})();
