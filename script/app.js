(() => {
  'use strict';
  const FL = window.FontLab;
  const $ = id => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 9);

  // ---------- presets ----------
  const M = (type, level, params) => ({ id: uid(), type, level, on: true, params });
  const PRESETS = {
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
    mods: PRESETS['Wave (per glyph)'](),
  };

  const STORE_KEY = 'fontlab.project.v1';
  function loadProject() {
    try { const p = JSON.parse(localStorage.getItem(STORE_KEY)); if (p && p.mods) return normalize(p); } catch (e) { /* ignore */ }
    return normalize(clone(DEFAULT_PROJECT));
  }
  function normalize(p) {
    const d = clone(DEFAULT_PROJECT);
    p = Object.assign(d, p);
    p.layout = Object.assign({}, FL.LAYOUT_DEFAULTS, p.layout);
    p.mods = (p.mods || []).filter(m => FL.MODIFIERS[m.type]).map(m => Object.assign({ id: uid(), on: true, params: {} }, m));
    return p;
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(project)); } catch (e) { /* ignore */ } }, 300);
  }

  let project = loadProject();
  let font = null, base = null, S = null;
  let playing = true, t = 0, last = performance.now(), dirty = true;
  let view = { x: 0, y: 0, w: 1000, h: 500 };

  // ---------- status ----------
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
  function rebuild(refit) {
    if (!font) return;
    try { base = FL.layout(font, project.text, project.layout); }
    catch (e) { status('Layout failed: ' + e.message, true); return; }
    if (refit) fit();
    dirty = true;
  }

  function fit() {
    if (!base) return;
    const tmp = FL.evaluate(base, [], 0);
    const b = FL.bounds(tmp, false);
    const pad = Math.max(b.w, b.h, base.size) * 0.15;
    view = { x: b.x - pad, y: b.y - pad, w: Math.max(b.w + pad * 2, 1), h: Math.max(b.h + pad * 2, 1) };
    applyView();
  }
  function applyView() {
    $('svg').setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    const r = $('bgRect');
    // background covers far beyond the view so aspect-ratio letterboxing is filled too
    r.setAttribute('x', view.x - view.w * 50); r.setAttribute('y', view.y - view.h * 50);
    r.setAttribute('width', view.w * 101); r.setAttribute('height', view.h * 101);
    dirty = true;
  }

  // ---------- rendering ----------
  const paths = [];
  function render() {
    const content = $('content');
    const n = S.nodes.glyph.length;
    while (paths.length < n) { const p = document.createElementNS(SVGNS, 'path'); content.append(p); paths.push(p); }
    while (paths.length > n) paths.pop().remove();
    $('bgRect').setAttribute('fill', project.bg);
    for (let gi = 0; gi < n; gi++) {
      const p = paths[gi], st = S.style[gi];
      p.setAttribute('d', FL.glyphPathData(S, gi));
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
    renderOverlay();
  }

  function renderOverlay() {
    const g = $('overlayG'), lvl = $('overlay').value;
    if (!lvl) { if (g.firstChild) g.innerHTML = ''; return; }
    const sw = view.w / 600;
    let h = '';
    if (lvl === 'point') {
      let c = 0;
      outer: for (let ci = 0; ci < S.contours.length; ci++) {
        if (S.hidden[ci]) continue;
        for (const k of S.contours[ci].cmds) for (let j = 0; j < k.p.length; j++) {
          if (++c > 6000) break outer;
          const p = k.p[j], ctrl = j < k.p.length - 1;
          h += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(sw * (ctrl ? 1.5 : 2.2)).toFixed(2)}" fill="${ctrl ? '#e0a000' : '#0a62d0'}"/>`;
        }
      }
    } else {
      const list = S.nodes[lvl].slice(0, 3000);
      list.forEach((nd, j) => {
        const b = FL.bbox(S, nd.cs.filter(ci => !S.hidden[ci]));
        if (!b.w && !b.h) return;
        h += `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" fill="none" stroke="#e0007a" stroke-width="${sw.toFixed(2)}"/>`
          + `<text x="${b.x.toFixed(1)}" y="${(b.y - sw * 3).toFixed(1)}" font-size="${(sw * 11).toFixed(1)}" fill="#e0007a" font-family="monospace">${j}</text>`;
      });
    }
    g.innerHTML = h;
  }

  // ---------- frame loop ----------
  let fpsN = 0, fpsT = performance.now(), fps = 0, evalMs = 0, lastErrUI = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) { t += dt * (+$('speed').value || 0); dirty = true; }
    fpsN++;
    if (now - fpsT > 500) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; updateStats(); }
    if (!dirty || !base) return;
    dirty = false;
    const t0 = performance.now();
    S = FL.evaluate(base, project.mods, t);
    render();
    evalMs = performance.now() - t0;
    if (document.activeElement !== $('time')) $('time').value = t % 20;
    $('tLabel').textContent = t.toFixed(2) + 's';
    if (now - lastErrUI > 250) { lastErrUI = now; showErrors(); }
  }
  function updateStats() {
    if (!S) return;
    $('stats').textContent = `${S.nodes.line.length} lines · ${S.nodes.word.length} words · ${S.nodes.glyph.length} glyphs · ${S.contours.length} contours · ${S.points} pts · ${evalMs.toFixed(1)} ms · ${fps} fps`;
  }

  // ---------- modifier stack UI ----------
  const modInputs = new Map(); // id -> {key: {input, msg}}
  function renderMods() {
    const box = $('mods');
    box.innerHTML = '';
    modInputs.clear();
    project.mods.forEach((m, idx) => {
      const def = FL.MODIFIERS[m.type];
      const card = document.createElement('div');
      card.className = 'mod' + (m.on === false ? ' off' : '');
      const hd = document.createElement('div'); hd.className = 'hd';
      const on = document.createElement('input'); on.type = 'checkbox'; on.checked = m.on !== false; on.title = 'enabled';
      on.onchange = () => { m.on = on.checked; card.classList.toggle('off', !on.checked); changed(); };
      const title = document.createElement('b'); title.textContent = def.label;
      const lvl = document.createElement('select');
      for (const l of def.levels) lvl.append(new Option('per ' + l, l));
      lvl.value = def.levels.includes(m.level) ? m.level : def.levels[0];
      lvl.onchange = () => { m.level = lvl.value; changed(); };
      hd.append(on, title, lvl,
        btn('↑', 'move up', () => move(idx, -1)), btn('↓', 'move down', () => move(idx, 1)),
        btn('⧉', 'duplicate', () => { project.mods.splice(idx + 1, 0, Object.assign(clone(m), { id: uid() })); renderMods(); changed(); }),
        btn('✕', 'delete', () => { project.mods.splice(idx, 1); renderMods(); changed(); }));
      card.append(hd);
      const grid = document.createElement('div'); grid.className = 'p';
      const refs = {};
      for (const key in def.params) {
        const lab = document.createElement('label'); lab.textContent = key; lab.title = (def.docs && def.docs[key]) || '';
        const inp = document.createElement('input'); inp.type = 'text'; inp.spellcheck = false;
        inp.value = m.params[key] != null ? m.params[key] : '';
        inp.placeholder = def.params[key] === '' ? '(unchanged)' : def.params[key];
        inp.title = lab.title;
        inp.oninput = () => { m.params[key] = inp.value; changed(); };
        const msg = document.createElement('div'); msg.className = 'msg'; msg.hidden = true;
        grid.append(lab, inp, msg);
        refs[key] = { inp, msg };
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
  function changed() { dirty = true; save(); }

  function fillAddLevels() {
    const def = FL.MODIFIERS[$('addType').value], sel = $('addLevel');
    sel.innerHTML = '';
    for (const l of def.levels) sel.append(new Option('per ' + l, l));
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

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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
      project.mods.push({ id: uid(), type, level: $('addLevel').value, on: true, params: Object.assign({}, def.params) });
      renderMods(); changed();
    };

    for (const l of FL.LEVELS) $('overlay').append(new Option('per ' + l, l));
    $('overlay').onchange = () => { dirty = true; };

    $('play').onclick = togglePlay;
    $('time').oninput = e => { t = parseFloat(e.target.value); dirty = true; };
    $('fit').onclick = fit;
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
    });

    $('exportSvg').onclick = () => { if (S) download('fontlab-frame.svg', FL.toSVG(S, { fill: project.fill, background: project.bg }), 'image/svg+xml'); };
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

    // pan and zoom
    const svg = $('svg');
    const toWorld = (cx, cy) => { const m = svg.getScreenCTM().inverse(); const p = new DOMPoint(cx, cy).matrixTransform(m); return p; };
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY), k = Math.exp(e.deltaY * 0.0015);
      view = { x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w: view.w * k, h: view.h * k };
      applyView();
    }, { passive: false });
    const ptrs = new Map();
    let pinch = null;
    svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = null; });
    svg.addEventListener('pointermove', e => {
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
    const up = e => ptrs.delete(e.pointerId);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    window.addEventListener('resize', () => { dirty = true; });
  }
  function togglePlay() { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; last = performance.now(); }

  // ---------- start ----------
  wire();
  syncForm();
  renderMods();
  refreshFonts().then(() => useFont($('fontSel').value));
  requestAnimationFrame(frame);

  window.fontlab = { get project() { return project; }, get frame() { return S; }, get font() { return font; } }; // for console tinkering
})();
