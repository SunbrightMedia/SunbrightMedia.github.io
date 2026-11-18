(() => {
  'use strict';
  const FL = window.FontLab, Shapes = FL.Shapes;
  const $ = id => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const smooth = (a, b, v) => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'class') e.className = props[k];
      else if (k.startsWith('on')) e[k] = props[k];
      else if (k in e && k !== 'list') e[k] = props[k];
      else e.setAttribute(k, props[k]);
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  };

  // ---------- presets ----------
  const M = (type, level, params) => {
    const def = FL.MODIFIERS[type];
    return { id: uid(), type, level, on: true, params: def.spatial ? Object.assign({}, def.params, params) : params };
  };
  const PRESETS = {
    'Warp: star': () => [M('warp', 'space', { shape: 'star', x: '470', y: '-45', size: '55', intensity: '10', falloff: '25' })],
    'Warp: sweeping circle': () => [M('warp', 'space', { x: '380 + sin(t*0.7)*420', y: '-40', size: '40', intensity: '8', falloff: '45' })],
    'Warp: star rounding off': () => [M('warp', 'space', { shape: 'star', x: '380', y: '40', size: '90', rot: 't*20', intensity: '20 + tri(t*0.15)*60', falloff: '10' })],
    'Wave': () => [M('transform', 'glyph', { ty: 'sin(t*3 - i*0.6) * size*0.12' })],
    'Typewriter': () => [M('visible', 'glyph', { show: 'fract(t*0.15)*n*1.6 - i' })],
    'Wobbly outlines': () => [
      M('resample', 'contour', { step: '3' }),
      M('displace', 'point', { dx: 'noise(x*0.02, y*0.02 + t) * size*0.04', dy: 'noise(y*0.02 + 40, x*0.02 + t) * size*0.04' }),
    ],
    'Explode and return': () => [M('transform', 'glyph', {
      tx: '(rnd(i)-0.5) * size*4 * pow(sin(t)*0.5+0.5, 3)',
      ty: '(rnd(i,7)-0.5) * size*3 * pow(sin(t)*0.5+0.5, 3)',
      rot: '(rnd(i,3)-0.5) * 720 * pow(sin(t)*0.5+0.5, 3)',
    })],
    'Rainbow draw-on': () => [M('style', 'glyph', {
      fill: 'none', stroke: 'hsl(i*35 + t*60, 90, 60)', sw: 'size*0.015', draw: 'clamp(fract(t*0.25)*2.5 - u, 0, 1)',
    })],
    'Spinning holes': () => [M('transform', 'contour', { rot: 'sin(t*2 + ci) * 25' })],
    'Jelly words': () => [M('transform', 'word', { sx: '1 + sin(t*5 + i)*0.08', sy: '1 - sin(t*5 + i)*0.08', py: '1' })],
    'Melt': () => [
      M('resample', 'contour', { step: '3' }),
      M('displace', 'point', { dy: 'pow(noise(x*0.05, gi) * 0.5 + 0.5, 3) * size*0.8 * tri(t*0.2) * smoothstep(-size*0.75, size*0.1, y - li*size*1.2)' }),
    ],
  };

  const DEFAULT_PROJECT = {
    font: 'url:../fonts/segoeuib.ttf',
    text: 'Sunbright\nfont lab',
    layout: Object.assign({}, FL.LAYOUT_DEFAULTS, { size: 160 }),
    fill: '#ffffff',
    mods: PRESETS['Warp: star'](),
  };

  const STORE_KEY = 'fontlab.project.v1', UI_KEY = 'fontlab.ui.v1';
  function loadProject() {
    try { const p = JSON.parse(localStorage.getItem(STORE_KEY)); if (p && p.mods) return normalize(p); } catch (e) { /* ignore */ }
    return normalize(clone(DEFAULT_PROJECT));
  }
  function normalize(p) {
    p = Object.assign(clone(DEFAULT_PROJECT), p);
    delete p.bg; // the stage is always black
    if (!p.fill || p.fill.toLowerCase() === '#111111') p.fill = '#ffffff';
    p.layout = Object.assign({}, FL.LAYOUT_DEFAULTS, p.layout);
    p.mods = (p.mods || []).filter(m => FL.MODIFIERS[m.type]).map(m => {
      m = Object.assign({ id: uid(), on: true, params: {} }, m);
      const def = FL.MODIFIERS[m.type];
      if (def.spatial) { // keep only settings the modifier still has
        const p = Object.assign({}, def.params);
        for (const k in p) if (m.params[k] != null) p[k] = m.params[k];
        m.params = p;
      }
      return m;
    });
    return p;
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(project)); localStorage.setItem(UI_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
    }, 300);
  }

  let project = loadProject();
  let prefs = { gizmos: true, mask: false, stats: false, overlay: '', speed: 1 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(UI_KEY)) || {}); } catch (e) { /* ignore */ }

  let font = null, base = null, S = null;
  let playing = true, t = 0, last = performance.now(), dirty = true;
  let view = { x: 0, y: 0, w: 1000, h: 500 };
  let selected = null, drag = null, glyphD = [];
  let fontOptions = [];

  let toastTimer = 0;
  function toast(msg, isErr) {
    const e = $('toast');
    e.textContent = msg; e.classList.toggle('err', !!isErr); e.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { e.style.opacity = 0; }, isErr ? 8000 : 3500);
  }

  // ---------- fonts (stored in this browser only, never uploaded) ----------
  const BUILTIN = [
    { name: 'Segoe UI Bold', url: '../fonts/segoeuib.ttf' },
    { name: 'Segoe UI', url: '../fonts/segoeui.ttf' },
    { name: 'Segoe UI Light', url: '../fonts/segoeuil.ttf' },
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
    let names = [];
    try { names = await db.names(); } catch (e) { toast('Browser storage unavailable: added fonts will not be remembered.', true); }
    fontOptions = [
      ...names.map(n => ({ value: 'idb:' + n, label: n, device: true })),
      ...BUILTIN.map(b => ({ value: 'url:' + b.url, label: b.name, device: false })),
    ];
    if (!fontOptions.some(o => o.value === project.font)) project.font = fontOptions[0].value;
    if (selected === 'text') renderInspector();
  }

  async function useFont(val) {
    try {
      let buf;
      if (val.startsWith('idb:')) { const r = await db.get(val.slice(4)); if (!r) throw new Error('not found in browser storage'); buf = r.data; }
      else { const r = await fetch(val.slice(4)); if (!r.ok) throw new Error('HTTP ' + r.status); buf = await r.arrayBuffer(); }
      font = opentype.parse(buf);
      project.font = val; save();
      rebuild(true);
      renderList();
      if (selected === 'text') renderInspector();
    } catch (e) {
      toast('Could not load font: ' + e.message, true);
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
        toast(`${file.name}: ${/woff2/i.test(file.name) ? 'WOFF2 is not supported, use TTF, OTF or WOFF' : e.message}`, true);
      }
    }
    if (lastName) { project.font = 'idb:' + lastName; await refreshFonts(); await useFont(project.font); toast(`Added ${lastName}`); }
  }
  async function removeFont() {
    const v = project.font;
    if (!v.startsWith('idb:') || !confirm(`Remove ${v.slice(4)} from this browser?`)) return;
    await db.del(v.slice(4));
    project.font = DEFAULT_PROJECT.font;
    await refreshFonts(); useFont(project.font);
  }

  // ---------- geometry and view ----------
  function rebuild(refit) {
    if (!font) return;
    try { base = FL.layout(font, project.text, project.layout); }
    catch (e) { toast('Layout failed: ' + e.message, true); return; }
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
    dirty = true;
  }
  // Same mapping as the SVG viewBox with preserveAspectRatio="xMidYMid meet".
  function metrics() {
    const e = $('stageWrap'), W = e.clientWidth || 1, H = e.clientHeight || 1;
    const s = Math.min(W / view.w, H / view.h);
    return { W, H, s, ox: (W - view.w * s) / 2 - view.x * s, oy: (H - view.h * s) / 2 - view.y * s };
  }
  function toWorld(cx, cy) {
    const r = $('stageWrap').getBoundingClientRect(), m = metrics();
    return { x: (cx - r.left - m.ox) / m.s, y: (cy - r.top - m.oy) / m.s };
  }

  // ---------- rendering ----------
  function render() {
    glyphD = [];
    for (let gi = 0; gi < S.nodes.glyph.length; gi++) glyphD.push(FL.glyphPathData(S, gi));
    const big = [view.x - view.w * 50, view.y - view.h * 50, view.w * 101, view.h * 101];
    $('scene').innerHTML = FL.frameMarkup(S, { fill: project.fill, region: big, id: 'live' });
    renderOverlay();
    renderGizmos();
    renderMask();
  }

  function renderOverlay() {
    const g = $('overlayG'), lvl = prefs.overlay;
    if (!lvl) { if (g.firstChild) g.innerHTML = ''; return; }
    const k = 1 / metrics().s;
    let h = '';
    if (lvl === 'point') {
      let c = 0;
      outer: for (let ci = 0; ci < S.contours.length; ci++) {
        if (S.hidden[ci] || S.contours[ci].attach) continue;
        for (const cm of S.contours[ci].cmds) for (let j = 0; j < cm.p.length; j++) {
          if (++c > 6000) break outer;
          const p = cm.p[j], ctrl = j < cm.p.length - 1;
          h += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(k * (ctrl ? 1.5 : 2.2)).toFixed(2)}" fill="${ctrl ? '#ffb000' : '#4da3ff'}"/>`;
        }
      }
    } else {
      S.nodes[lvl].slice(0, 3000).forEach((nd, j) => {
        const b = FL.bbox(S, nd.cs.filter(ci => !S.hidden[ci]));
        if (!b.w && !b.h) return;
        h += `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" fill="none" stroke="#ff3d9a" stroke-width="${k.toFixed(2)}"/>`
          + `<text x="${b.x.toFixed(1)}" y="${(b.y - k * 3).toFixed(1)}" font-size="${(k * 11).toFixed(1)}" fill="#ff3d9a" font-family="monospace">${j}</text>`;
      });
    }
    g.innerHTML = h;
  }

  // Unselected spatial modifiers are a faint outline; the selected one gets its full gizmo.
  function renderGizmos() {
    const g = $('gizmoG');
    if (!prefs.gizmos || !S) { if (g.firstChild) g.innerHTML = ''; return; }
    const k = 1 / metrics().s, col = 'var(--gizmo)';
    let h = '';
    for (const f of S.fx) {
      const sh = f.shape, sel = f.id === selected;
      const seg = sh.size * 0.05, ring = Shapes.polyD(Shapes.levelPolygon(sh, 0, 72, seg));
      const infl = f.R > 0 ? Shapes.polyD(Shapes.levelPolygon(sh, f.R, 72, seg)) : '';
      if (!sel) {
        h += `<path data-gizmo="${f.id}" data-part="body" d="${infl || ring}" fill="#fff" fill-opacity="0.001" stroke="${col}" stroke-opacity="0.45" stroke-width="${k}" style="cursor:move"/>`;
        continue;
      }
      const ext = f.F;
      const outer = ext > 0 ? Shapes.polyD(Shapes.levelPolygon(sh, f.R + ext, 72, seg)) : '';
      h += `<g data-gizmo="${f.id}" data-part="body" style="cursor:move">`
        + `<path d="${infl || ring}" fill="#fff" fill-opacity="0.001" stroke="${col}" stroke-width="${1.5 * k}"/>`
        + (infl ? `<path d="${ring}" fill="none" stroke="${col}" stroke-width="${k}" stroke-dasharray="${4 * k} ${3 * k}" pointer-events="none"/>` : '')
        + (outer ? `<path d="${outer}" fill="none" stroke="${col}" stroke-opacity="0.5" stroke-width="${k}" stroke-dasharray="${1.5 * k} ${3 * k}" pointer-events="none"/>` : '')
        + `<circle cx="${sh.cx}" cy="${sh.cy}" r="${2.5 * k}" fill="${col}"/></g>`
        + `<line x1="${sh.cx}" y1="${sh.cy}" x2="${sh.handle[0]}" y2="${sh.handle[1]}" stroke="${col}" stroke-width="${k}" pointer-events="none"/>`
        + `<circle data-gizmo="${f.id}" data-part="handle" cx="${sh.handle[0]}" cy="${sh.handle[1]}" r="${6 * k}" fill="#000" stroke="${col}" stroke-width="${2 * k}" style="cursor:crosshair"/>`;
    }
    g.innerHTML = h;
  }

  // White-on-black view of where spatial modifiers act, evaluated per pixel.
  const maskSmall = document.createElement('canvas');
  function renderMask() {
    const cv = $('maskCv');
    if (!prefs.mask || !S) { cv.style.display = 'none'; return; }
    cv.style.display = 'block';
    const m = metrics(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(m.W * dpr); cv.height = Math.round(m.H * dpr);
    const step = 3, w = Math.ceil(m.W / step), h = Math.ceil(m.H / step);
    maskSmall.width = w; maskSmall.height = h;
    const sctx = maskSmall.getContext('2d'), img = sctx.createImageData(w, h), px = img.data;
    const fxs = S.fx.map(f => ({ f, soft: f.F, b: f.shape.bound + f.R + f.F }));
    for (let j = 0; j < h; j++) {
      const y = ((j + 0.5) * step - m.oy) / m.s;
      for (let i = 0; i < w; i++) {
        const x = ((i + 0.5) * step - m.ox) / m.s;
        let v = 0;
        for (const { f, soft, b } of fxs) {
          const sh = f.shape, dx = x - sh.cx, dy = y - sh.cy;
          if (dx * dx + dy * dy > b * b) continue;
          const d = sh.sdf(x, y);
          const wv = (soft > 0 ? 1 - smooth(f.R - soft, f.R + soft, d) : d < f.R ? 1 : 0) * f.A;
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
    ctx.strokeStyle = '#ff3d6b';
    ctx.lineWidth = 1.2 / m.s;
    ctx.stroke(new Path2D(glyphD.join('')));
  }

  // ---------- frame loop ----------
  let fpsN = 0, fpsT = performance.now(), fps = 0, evalMs = 0, lastErrUI = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) { t += dt * (+prefs.speed || 0); dirty = true; }
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
    const e = $('stats');
    e.hidden = !prefs.stats;
    if (!prefs.stats || !S) return;
    e.textContent = `${S.nodes.glyph.length} glyphs · ${S.contours.filter(c => !c.attach).length} contours · ${S.points} pts · ${evalMs.toFixed(1)} ms · ${fps} fps`;
  }

  // ---------- stack list ----------
  const subLabel = m => {
    const def = FL.MODIFIERS[m.type];
    return def.spatial ? (m.params.shape || def.params.shape) : (def.levels.includes(m.level) ? m.level : def.levels[0]);
  };
  function renderList() {
    const box = $('list');
    box.innerHTML = '';
    const textName = font ? fontLabel(font) : 'Text';
    box.append(el('div', { class: 'item' + (selected === 'text' ? ' sel' : ''), onclick: () => select(selected === 'text' ? null : 'text') },
      el('span', { class: 'glyph' }, 'T'), el('span', { class: 'name' }, 'Text ', el('span', { class: 'sub' }, textName))));
    for (const m of project.mods) {
      const def = FL.MODIFIERS[m.type];
      const dot = el('button', { class: 'dot', title: m.on === false ? 'Turn on' : 'Turn off', onclick: e => { e.stopPropagation(); m.on = m.on === false; renderList(); changed(); } });
      const bad = S && S.errors[m.id] && Object.keys(S.errors[m.id]).length ? el('span', { class: 'bad', title: 'This modifier has an error' }) : null;
      box.append(el('div', { class: 'item' + (m.id === selected ? ' sel' : '') + (m.on === false ? ' off' : ''), onclick: () => select(m.id === selected ? null : m.id) },
        dot, el('span', { class: 'name' }, def.label + ' ', el('span', { class: 'sub' }, subLabel(m))), bad));
    }
  }

  function select(id) {
    selected = id;
    renderList();
    renderInspector();
    dirty = true;
  }

  // ---------- inspector (only the selected item) ----------
  let refs = {};
  const field = (label, control, doc) => el('div', { class: 'f' }, el('label', { title: doc || label }, label), control);

  function sliderInput(value, [lo, hi, st], onInput, mono) {
    const txt = el('input', { type: 'text', value: String(value), spellcheck: false, class: mono ? 'mono' : '' });
    const rng = el('input', { type: 'range', min: lo, max: hi, step: st });
    const v = parseFloat(value); rng.value = isFinite(v) ? v : lo;
    rng.oninput = () => { txt.value = rng.value; onInput(rng.value); };
    txt.oninput = () => { if (/^\s*-?[\d.]+\s*$/.test(txt.value)) rng.value = parseFloat(txt.value); onInput(txt.value); };
    return { row: el('div', { class: 'row' }, rng, txt), txt, rng };
  }

  function renderInspector() {
    const box = $('insp');
    box.innerHTML = '';
    refs = {};
    if (selected === 'text') inspectText(box);
    else {
      const m = project.mods.find(x => x.id === selected);
      if (m) inspectMod(box, m); else selected = null;
    }
  }

  function inspectText(box) {
    box.append(el('div', { class: 'ih' }, el('b', null, 'Text')));
    const sel = el('select', { onchange: () => useFont(sel.value) });
    const dev = fontOptions.filter(o => o.device), site = fontOptions.filter(o => !o.device);
    if (dev.length) sel.append(el('optgroup', { label: 'On this device' }, ...dev.map(o => new Option(o.label, o.value))));
    sel.append(el('optgroup', { label: 'Site' }, ...site.map(o => new Option(o.label, o.value))));
    sel.value = project.font;
    const isDev = project.font.startsWith('idb:');
    box.append(field('font', el('div', { class: 'row' }, sel,
      el('button', { title: 'Add font files (kept in this browser only)', onclick: () => $('fontFile').click() }, '+'),
      isDev ? el('button', { title: 'Remove this font from this browser', onclick: removeFont }, '×') : null)));

    box.append(el('textarea', { class: 'mono', value: project.text, spellcheck: false, oninput: e => { project.text = e.target.value; save(); rebuild(true); } }));
    box.append(field('size', sliderInput(project.layout.size, [8, 400, 1], v => { const n = parseFloat(v); if (n > 0) { project.layout.size = n; save(); rebuild(true); } }).row));
    box.append(field('colour', el('input', { type: 'color', value: project.fill, oninput: e => { project.fill = e.target.value; changed(); } })));

    const num = (key, label, step) => field(label, el('input', { type: 'number', step, value: project.layout[key],
      oninput: e => { const v = parseFloat(e.target.value); if (isFinite(v)) { project.layout[key] = v; save(); rebuild(); } } }));
    const align = el('select', { onchange: e => { project.layout.align = e.target.value; save(); rebuild(true); } }, ...['left', 'center', 'right'].map(a => new Option(a, a)));
    align.value = project.layout.align;
    const check = (key, label) => el('label', { class: 'row' }, el('input', { type: 'checkbox', checked: !!project.layout[key], onchange: e => { project.layout[key] = e.target.checked; save(); rebuild(); } }), label);
    box.append(el('details', null, el('summary', null, 'Spacing and features'),
      num('lineHeight', 'line height', 0.05), num('letterSpacing', 'letters', 1), num('wordSpacing', 'words', 1),
      field('align', align), field('', el('div', { class: 'row' }, check('kerning', 'kerning'), check('liga', 'ligatures')))));
  }

  function inspectMod(box, m) {
    const def = FL.MODIFIERS[m.type], idx = project.mods.indexOf(m);
    const head = el('div', { class: 'ih' }, el('b', null, def.label),
      el('button', { class: 'ghost', title: 'Move up', onclick: () => moveMod(idx, -1) }, '↑'),
      el('button', { class: 'ghost', title: 'Move down', onclick: () => moveMod(idx, 1) }, '↓'),
      el('button', { class: 'ghost', title: 'Duplicate', onclick: () => { const c = Object.assign(clone(m), { id: uid() }); project.mods.splice(idx + 1, 0, c); select(c.id); changed(); } }, '⧉'),
      el('button', { class: 'ghost', title: 'Delete', onclick: () => { project.mods.splice(idx, 1); select(null); changed(); } }, '✕'));
    box.append(head);
    if (!def.spatial) {
      const lvl = el('select', { onchange: () => { m.level = lvl.value; renderList(); changed(); } }, ...def.levels.map(l => new Option('per ' + l, l)));
      lvl.value = def.levels.includes(m.level) ? m.level : def.levels[0];
      box.append(field('acts on', lvl));
    }
    for (const key in def.params) {
      if (def.spatial && (key === 'x' || key === 'y')) {
        if (key === 'y') continue;
        // x and y share one row, plus a button that brings the modifier into view
        const xy = ['x', 'y'].map(k => el('input', { type: 'text', class: 'mono', spellcheck: false, title: `${k} (drag the gizmo, or type an expression)`,
          value: m.params[k], oninput: e => { m.params[k] = e.target.value; changed(); } }));
        const msgs = xy.map(() => { const d = el('div', { class: 'msg' }); d.hidden = true; return d; });
        const f = field('position', el('div', { class: 'row xy' }, xy[0], xy[1],
          el('button', { class: 'ghost', title: 'Move to the middle of the view', onclick: () => { setParam(m, 'x', view.x + view.w / 2); setParam(m, 'y', view.y + view.h / 2); changed(); } }, '⌖')));
        f.append(...msgs);
        box.append(f);
        refs.x = { inp: xy[0], rng: null, msg: msgs[0] };
        refs.y = { inp: xy[1], rng: null, msg: msgs[1] };
        continue;
      }
      const doc = (def.docs && def.docs[key]) || '';
      const msg = el('div', { class: 'msg' }); msg.hidden = true;
      let control, inp, rng = null;
      if (def.choice && def.choice[key]) {
        inp = el('select', { title: doc, onchange: () => { m.params[key] = inp.value; renderList(); changed(); } }, ...def.choice[key].map(o => new Option(o, o)));
        inp.value = m.params[key] || def.params[key];
        control = inp;
      } else if (def.ui && def.ui[key]) {
        const s = sliderInput(m.params[key] != null ? m.params[key] : def.params[key], def.ui[key], v => { m.params[key] = v; changed(); }, true);
        control = s.row; inp = s.txt; rng = s.rng;
      } else {
        inp = el('input', { type: 'text', class: 'mono', spellcheck: false, title: doc, value: m.params[key] != null ? m.params[key] : '',
          placeholder: def.params[key] === '' ? 'unchanged' : def.params[key], oninput: () => { m.params[key] = inp.value; changed(); } });
        control = inp;
      }
      const f = field(key, control, doc);
      f.append(msg);
      box.append(f);
      refs[key] = { inp, rng, msg };
    }
    box.append(el('details', null, el('summary', null, 'Expression help'), $('helpTpl').content.cloneNode(true)));
    showErrors();
  }

  function setParam(m, key, v) {
    const s = String(Math.round(v * 10) / 10);
    m.params[key] = s;
    if (m.id === selected && refs[key]) { refs[key].inp.value = s; if (refs[key].rng) refs[key].rng.value = s; }
  }
  function moveMod(idx, d) {
    const j = idx + d;
    if (j < 0 || j >= project.mods.length) return;
    const [m] = project.mods.splice(idx, 1); project.mods.splice(j, 0, m);
    renderList(); renderInspector(); changed();
  }

  let errSig = '';
  function showErrors() {
    if (!S) return;
    const e = (selected && S.errors[selected]) || {};
    for (const key in refs) {
      const msg = e[key] || '';
      refs[key].inp.classList.toggle('err', !!msg);
      refs[key].msg.hidden = !msg;
      refs[key].msg.textContent = msg;
    }
    const sig = Object.keys(S.errors).join(',');
    if (sig !== errSig) { errSig = sig; renderList(); }
  }
  function changed() { dirty = true; save(); }

  function addModifier(type) {
    const def = FL.MODIFIERS[type];
    const m = { id: uid(), type, level: def.levels[0], on: true, params: Object.assign({}, def.params) };
    if (def.spatial) { m.params.x = String(Math.round(view.x + view.w / 2)); m.params.y = String(Math.round(view.y + view.h / 2)); }
    project.mods.push(m);
    select(m.id);
    changed();
  }
  function addPreset(name) {
    const mods = PRESETS[name]();
    project.mods.push(...mods);
    t = 0;
    select(mods[mods.length - 1].id);
    changed();
  }

  // ---------- menus ----------
  function closeMenus() { for (const m of document.querySelectorAll('.menu')) m.hidden = true; }
  function setupMenus() {
    for (const b of document.querySelectorAll('[data-menu]')) {
      b.onclick = e => {
        e.stopPropagation();
        const menu = $(b.dataset.menu), open = menu.hidden;
        closeMenus();
        if (!open) return;
        // fixed position under the button, kept on screen (the side panel would clip it otherwise)
        const r = b.getBoundingClientRect();
        menu.hidden = false;
        menu.style.top = r.bottom + 4 + 'px';
        menu.style.maxHeight = Math.max(120, innerHeight - r.bottom - 12) + 'px';
        menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px';
      };
    }
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.dd')) closeMenus(); });
    window.addEventListener('resize', closeMenus);
    $('side').addEventListener('scroll', closeMenus);
    for (const m of document.querySelectorAll('.menu')) m.addEventListener('click', e => { if (e.target.closest('button')) closeMenus(); });

    const add = $('addMenu');
    add.append(el('div', { class: 'mh' }, 'Modifier'));
    for (const k in FL.MODIFIERS) add.append(el('button', { onclick: () => addModifier(k) }, FL.MODIFIERS[k].label));
    add.append(el('hr'), el('div', { class: 'mh' }, 'Preset'));
    for (const name in PRESETS) add.append(el('button', { onclick: () => addPreset(name) }, name));
  }

  // ---------- files ----------
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
    const svg = FL.toSVG(S, { fill: project.fill, background: null, viewBox: [-m.ox / m.s, -m.oy / m.s, m.W / m.s, m.H / m.s], width: W, height: H });
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try { await img.decode(); } catch (e) { toast('PNG export failed: ' + e.message, true); return; }
    const cv = el('canvas', { width: W, height: H }), ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(img.src);
    cv.toBlob(b => download('fontlab-frame.png', b), 'image/png');
  }
  async function openProject(file) {
    try {
      project = normalize(JSON.parse(await file.text()));
      selected = null; save(); renderList(); renderInspector();
      await refreshFonts(); useFont(project.font);
    } catch (err) { toast('Could not open project: ' + err.message, true); }
  }

  // ---------- wiring ----------
  function wire() {
    setupMenus();
    $('fontFile').onchange = e => { addFontFiles([...e.target.files]); e.target.value = ''; };
    $('projFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); };

    $('play').onclick = togglePlay;
    $('time').oninput = e => { t = parseFloat(e.target.value); dirty = true; };
    $('fit').onclick = fit;
    const pref = (id, key, prop) => { const e = $(id); e[prop] = prefs[key]; e.onchange = e.oninput = () => { prefs[key] = prop === 'checked' ? e.checked : e.value; save(); dirty = true; updateStats(); }; };
    for (const l of FL.LEVELS) $('overlay').append(new Option(l, l));
    pref('gizmos', 'gizmos', 'checked'); pref('maskView', 'mask', 'checked'); pref('statsOn', 'stats', 'checked');
    pref('overlay', 'overlay', 'value'); pref('speed', 'speed', 'value');

    $('exportSvg').onclick = () => { if (S) download('fontlab-frame.svg', FL.toSVG(S, { fill: project.fill, background: '#000' }), 'image/svg+xml'); };
    $('exportPng').onclick = exportPNG;
    $('exportGlyphs').onclick = () => { if (font) download(fontLabel(font).replace(/[^\w.-]+/g, '_') + '.glyphs.json', JSON.stringify(FL.fontToJSON(font)), 'application/json'); };
    $('saveProj').onclick = () => download('fontlab-project.json', JSON.stringify(project, null, 2), 'application/json');
    $('openProj').onclick = () => $('projFile').click();
    $('reset').onclick = () => {
      if (!confirm('Reset text, layout and modifiers to defaults? Added fonts are kept.')) return;
      project = normalize(clone(DEFAULT_PROJECT)); selected = null; save(); renderList(); renderInspector(); useFont(project.font);
    };

    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (e.code === 'Space' && !typing) { e.preventDefault(); togglePlay(); }
      if (e.key === 'Escape') { closeMenus(); if (!typing) select(null); }
    });

    // drag and drop fonts or a project anywhere
    let depth = 0;
    window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { depth++; document.body.classList.add('dragging'); } });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
      e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
      const files = [...e.dataTransfer.files];
      const fonts = files.filter(f => /\.(ttf|otf|woff2?)$/i.test(f.name)), proj = files.find(f => /\.json$/i.test(f.name));
      if (fonts.length) addFontFiles(fonts); else if (proj) openProject(proj);
    });

    // stage: drag gizmos; otherwise pan (one pointer) and pinch-zoom (two); a plain click deselects
    const ui = $('ui');
    ui.addEventListener('wheel', e => {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY), k = Math.exp(e.deltaY * 0.0015);
      view = { x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w: view.w * k, h: view.h * k };
      applyView();
    }, { passive: false });
    const ptrs = new Map();
    let downAt = null;
    ui.addEventListener('pointerdown', e => {
      ui.setPointerCapture(e.pointerId);
      closeMenus();
      const gz = e.target.closest && e.target.closest('[data-gizmo]');
      if (gz && !ptrs.size && S) {
        const m = project.mods.find(x => x.id === gz.dataset.gizmo), f = S.fx.find(x => x.id === gz.dataset.gizmo);
        if (m && f) {
          const w = toWorld(e.clientX, e.clientY);
          drag = { pid: e.pointerId, m, part: gz.dataset.part, dx: w.x - f.shape.cx, dy: w.y - f.shape.cy, cx: f.shape.cx, cy: f.shape.cy };
          if (selected !== m.id) select(m.id);
          return;
        }
      }
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      downAt = ptrs.size === 1 ? [e.clientX, e.clientY] : null;
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
    const up = e => {
      if (drag && drag.pid === e.pointerId) { drag = null; return; }
      if (downAt && ptrs.size === 1 && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4 && selected) select(null);
      ptrs.delete(e.pointerId);
      downAt = null;
    };
    ui.addEventListener('pointerup', up);
    ui.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); downAt = null; if (drag && drag.pid === e.pointerId) drag = null; });
    window.addEventListener('resize', () => { dirty = true; });
  }
  function togglePlay() { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; last = performance.now(); }

  // ---------- start ----------
  wire();
  renderList();
  refreshFonts().then(() => useFont(project.font));
  requestAnimationFrame(frame);

  window.fontlab = { get project() { return project; }, get frame() { return S; }, get font() { return font; } }; // for console tinkering
})();
