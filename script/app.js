(() => {
  'use strict';
  const FL = window.FontLab, Shapes = FL.Shapes, TR = window.FontLabTransitions, ST = window.FontLabStrokes;
  const $ = id => document.getElementById(id);
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
  // Modifiers act on whatever script they touch; effects are latched to a script or a group.
  const M = (type, level, params) => {
    const def = FL.MODIFIERS[type];
    return { id: uid(), type, level, on: true, params: def.spatial ? Object.assign({}, def.params, params) : params };
  };
  const E = (type, params, level) => {
    const def = FL.EFFECTS[type];
    return { id: uid(), type, level: level || def.levels[0], on: true, params: Object.assign({}, def.params, params) };
  };
  const MOD_PRESETS = {
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
  const FX_PRESETS = {
    'Thermal heatmap': () => [E('heatmap', {}, 'glyph')],
    'ASCII': () => [E('ascii', {})],
    'ASCII glow': () => [E('ascii', { resolution: '22', glow: '0.35' })],
    'Matrix': () => [E('ascii', { mode: 'matrix', resolution: '16', glow: '0.25' })],
    'Heat ASCII': () => [E('heatmap', { glow: '0.15' }, 'glyph'), E('ascii', { resolution: '20', glow: '0.2' })],
    'Posterized heat': () => [E('heatmap', {}, 'glyph'), E('posterize', { levels: '4' })],
    'Kamisuki noise (shader demo)': () => [E('kamisuki', { scale: '5', radius: '0', gradient: '0.45' })],
    'Kamisuki erode': () => [E('kamisuki', { mode: 'erode', scale: '8', radius: '0.45', blend: '0.1', amount: '0.9' })],
  };

  // Transitions are latched to a script.
  const T = (type, params) => ({ id: uid(), type, on: true, params: Object.assign({}, TR.TRANSITIONS[type].params, params) });
  const TR_PRESETS = {
    'Stroke in': () => T('stroke', { role: 'intro' }),
    'Stroke out': () => T('stroke', { role: 'outro', start: '8' }),
    'Stroke in, letter by letter': () => T('stroke', { role: 'intro', duration: '4', stagger: '1', curve: 'sine in-out' }),
    'Stroke in, all at once': () => T('stroke', { role: 'intro', duration: '2', stagger: '0', curve: 'cubic out' }),
  };

  const DEFAULT_FONT = 'url:../fonts/segoeuib.ttf';
  const newScript = o => Object.assign({
    id: uid(), text: 'Text', font: DEFAULT_FONT, layout: Object.assign({}, FL.LAYOUT_DEFAULTS, { size: 160 }),
    fill: '#ffffff', x: 0, y: 0, group: null, effects: [], transitions: [],
  }, o);
  const defaultProject = () => ({ scripts: [newScript({ id: 's1', text: 'Sunbright\nfont lab' })], groups: [], mods: MOD_PRESETS['Warp: star']() });

  const STORE_KEY = 'fontlab.project.v1', UI_KEY = 'fontlab.ui.v1';
  function loadProject() {
    try { const p = JSON.parse(localStorage.getItem(STORE_KEY)); if (p) return normalize(p); } catch (e) { /* ignore */ }
    return normalize(defaultProject());
  }
  const keepParams = (item, def) => { // only the settings the item's definition still has
    const p = Object.assign({}, def.params);
    for (const k in p) if (item.params && item.params[k] != null) p[k] = item.params[k];
    item.params = p;
  };
  function normEffects(list) {
    return (list || []).filter(e => e && FL.EFFECTS[e.type]).map(e => {
      e = Object.assign({ id: uid(), on: true, params: {} }, e);
      const def = FL.EFFECTS[e.type];
      if (e.type === 'kamisuki') { // earlier static defaults now animate on their own
        if (String(e.params.waves).trim() === '2') delete e.params.waves;
        if (['1.6', '1.2'].includes(String(e.params.rotation).trim())) delete e.params.rotation;
        if (String(e.params.radius).trim() === '0.5' && e.params.mode !== 'erode') delete e.params.radius;
      }
      if (!def.levels.includes(e.level)) e.level = def.levels[0];
      keepParams(e, def);
      return e;
    });
  }
  function normTransitions(list) {
    return (list || []).filter(tr => tr && TR.TRANSITIONS[tr.type]).map(tr => {
      tr = Object.assign({ id: uid(), on: true, params: {} }, tr);
      keepParams(tr, TR.TRANSITIONS[tr.type]);
      return tr;
    });
  }
  function normalize(p) {
    p = p || {};
    if (!Array.isArray(p.scripts)) { // one-text projects from before scripts: its heatmap and kamisuki become its effects
      const old = p.mods || [];
      p.scripts = [{
        id: 's1', text: p.text != null ? p.text : 'Sunbright\nfont lab', font: p.font || DEFAULT_FONT, layout: p.layout, fill: p.fill,
        effects: old.filter(m => FL.EFFECTS[m && m.type]),
      }];
      p.mods = old.filter(m => !FL.EFFECTS[m && m.type]);
    }
    p.groups = (Array.isArray(p.groups) ? p.groups : []).map(g => ({ id: g.id || uid(), name: g.name || 'Group', effects: normEffects(g.effects) }));
    p.scripts = p.scripts.map(s => {
      s = newScript(Object.assign({}, s));
      s.layout = Object.assign({}, FL.LAYOUT_DEFAULTS, { size: 160 }, s.layout);
      if (!s.fill || String(s.fill).toLowerCase() === '#111111') s.fill = '#ffffff';
      s.x = +s.x || 0; s.y = +s.y || 0;
      if (!p.groups.some(g => g.id === s.group)) s.group = null;
      s.effects = normEffects(s.effects);
      s.transitions = normTransitions(s.transitions);
      return s;
    });
    if (!p.scripts.length) p.scripts = [newScript({ text: 'Sunbright' })];
    p.groups = p.groups.filter(g => p.scripts.some(s => s.group === g.id));
    p.mods = (p.mods || []).filter(m => m && FL.MODIFIERS[m.type]).map(m => {
      m = Object.assign({ id: uid(), on: true, params: {} }, m);
      if (FL.MODIFIERS[m.type].spatial) keepParams(m, FL.MODIFIERS[m.type]);
      return m;
    });
    return { scripts: p.scripts, groups: p.groups, mods: p.mods };
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

  let base = null, S = null, fxOut = [];
  let playing = true, t = 0, last = performance.now(), dirty = true;
  let view = { x: 0, y: 0, w: 1000, h: 500 };
  let selected = null, drag = null, glyphD = [], fills = [];
  let fontOptions = [];

  let toastTimer = 0;
  function toast(msg, isErr) {
    const e = $('toast');
    e.textContent = msg; e.classList.toggle('err', !!isErr); e.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { e.style.opacity = 0; }, isErr ? 8000 : 3500);
  }

  // ---------- lookups ----------
  const scriptById = id => project.scripts.find(s => s.id === id);
  const groupById = id => project.groups.find(g => g.id === id);
  const modById = id => project.mods.find(m => m.id === id);
  function effectById(id) {
    for (const o of [...project.scripts, ...project.groups]) { const e = o.effects.find(x => x.id === id); if (e) return { e, owner: o }; }
    return null;
  }
  function transitionById(id) {
    for (const sc of project.scripts) { const tr = sc.transitions.find(x => x.id === id); if (tr) return { tr, owner: sc }; }
    return null;
  }
  const selKind = () => (selected ? selected[0] : null), selId = () => (selected ? selected.slice(2) : null);
  // the script or group new effects go to
  function currentOwner() {
    const k = selKind(), id = selId();
    if (k === 's' && scriptById(id)) return scriptById(id);
    if (k === 'g' && groupById(id)) return groupById(id);
    if (k === 'e' && effectById(id)) return effectById(id).owner;
    if (k === 't' && transitionById(id)) return transitionById(id).owner;
    return project.scripts[0];
  }
  // the script new transitions go to (a selected group gives its first script)
  function currentScript() {
    const o = currentOwner();
    return isGroup(o) ? project.scripts.find(x => x.group === o.id) || project.scripts[0] : o;
  }
  const scriptName = s => (String(s.text).split('\n')[0].trim() || 'Script').slice(0, 28);
  const isGroup = o => !('text' in o);

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
  const fonts = new Map(); // font value -> Font, or a Promise of one while loading
  function loadFont(value) {
    if (fonts.has(value)) return Promise.resolve(fonts.get(value));
    const p = (async () => {
      let buf;
      if (value.startsWith('idb:')) { const r = await db.get(value.slice(4)); if (!r) throw new Error('not found in browser storage'); buf = r.data; }
      else { const r = await fetch(value.slice(4)); if (!r.ok) throw new Error('HTTP ' + r.status); buf = await r.arrayBuffer(); }
      return opentype.parse(buf);
    })();
    fonts.set(value, p);
    return p.then(f => { fonts.set(value, f); return f; }, e => { fonts.delete(value); throw e; });
  }
  const loadedFont = value => { const f = fonts.get(value); return f && !(f instanceof Promise) ? f : null; };

  async function refreshFonts() {
    let names = [];
    try { names = await db.names(); } catch (e) { toast('Browser storage unavailable: added fonts will not be remembered.', true); }
    fontOptions = [
      ...names.map(n => ({ value: 'idb:' + n, label: n, device: true })),
      ...BUILTIN.map(b => ({ value: 'url:' + b.url, label: b.name, device: false })),
    ];
    for (const s of project.scripts) if (!fontOptions.some(o => o.value === s.font)) s.font = DEFAULT_FONT;
    if (selKind() === 's') renderInspector();
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
    if (lastName) {
      const sc = selKind() === 's' ? scriptById(selId()) : project.scripts[0];
      await refreshFonts();
      sc.font = 'idb:' + lastName;
      save(); await rebuild(true); renderInspector();
      toast(`Added ${lastName}`);
    }
  }
  async function removeFont(sc) {
    const v = sc.font;
    if (!v.startsWith('idb:') || !confirm(`Remove ${v.slice(4)} from this browser?`)) return;
    await db.del(v.slice(4));
    fonts.delete(v);
    for (const s of project.scripts) if (s.font === v) s.font = DEFAULT_FONT;
    save(); await refreshFonts(); await rebuild(true); renderInspector();
  }

  // ---------- geometry and view ----------
  const layouts = new Map(); // laid-out scripts, by font + text + layout
  let buildSeq = 0;
  async function rebuild(refit) {
    const seq = ++buildSeq;
    const items = await Promise.all(project.scripts.map(async sc => {
      let f = null;
      try { f = await loadFont(sc.font); } catch (e) { toast('Could not load font: ' + e.message, true); }
      if (!f) return { base: null, x: sc.x, y: sc.y };
      const key = sc.font + '\u0000' + sc.text + '\u0000' + JSON.stringify(sc.layout);
      let b = layouts.get(key);
      if (!b) {
        try { b = FL.layout(f, sc.text, sc.layout); } catch (e) { toast('Layout failed: ' + e.message, true); b = null; }
        if (b) { layouts.set(key, b); if (layouts.size > 60) layouts.delete(layouts.keys().next().value); }
      }
      return { base: b, x: sc.x, y: sc.y };
    }));
    if (seq !== buildSeq) return;
    base = FL.mergeLayouts(items);
    if (refit) fit();
    dirty = true;
    renderList();
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
  const scriptBox = si => FL.bbox(S, S.nodes.text[si].cs.filter(ci => !S.hidden[ci]));

  // ---------- effects: owners and drawing units ----------
  function owners() {
    const list = project.scripts.map((sc, si) => ({ key: 's:' + sc.id, scripts: [si], effects: sc.effects }));
    for (const g of project.groups) {
      const members = project.scripts.map((sc, si) => (sc.group === g.id ? si : -1)).filter(si => si >= 0);
      if (members.length) list.push({ key: 'g:' + g.id, scripts: members, effects: g.effects });
    }
    return list;
  }
  // what gl.js draws, in order: scripts on their own, and groups (their scripts, then the group's effects)
  function units() {
    const byKey = new Map(fxOut.map(o => [o.key, o])), out = [], seen = new Set();
    const unit = sc => Object.assign({ kind: 'script' }, byKey.get('s:' + sc.id));
    for (const sc of project.scripts) {
      const g = sc.group && groupById(sc.group);
      if (!g) { out.push(unit(sc)); continue; }
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(Object.assign({ kind: 'group', members: project.scripts.filter(x => x.group === g.id).map(unit) }, byKey.get('g:' + g.id)));
    }
    return out;
  }
  const hasEffects = () => fxOut.some(o => o.records.length);
  let reveal = null; // what transitions show of each glyph this frame (null: everything)
  const needsGL = () => hasEffects() || !!reveal;

  // ---------- transitions ----------
  function glyphBox(gi) { return FL.bbox(S, S.nodes.glyph[gi].cs.filter(ci => !S.hidden[ci] && !S.contours[ci].attach)); }
  function strokeAnalysis(gi) {
    const d = glyphD[gi];
    if (!d) return null;
    const g = S.nodes.glyph[gi], b = glyphBox(gi);
    if (!(b.w > 0 && b.h > 0)) return null;
    return ST.analyze(d, b, (S.sizes && S.sizes[g.si]) || S.size);
  }
  const maskCanvases = new Map();
  function transitionReveal() {
    if (!project.scripts.some(sc => sc.transitions.some(tr => tr.on !== false))) return null;
    const lists = project.scripts.map(() => []);
    S.nodes.glyph.forEach((g, gi) => { if (glyphD[gi] && lists[g.si]) lists[g.si].push(gi); });
    const r = TR.evaluate(project.scripts, si => lists[si], t);
    if (!r) return null;
    const out = [], px = metrics().s * Math.min(window.devicePixelRatio || 1, 1.5); // device pixels per world unit
    r.forEach((v, gi) => {
      if (v === 0) { out[gi] = 0; return; }
      let a = null;
      try { a = strokeAnalysis(gi); } catch (e) { console.error(e); }
      if (!a) return;
      if (!maskCanvases.has(gi)) maskCanvases.set(gi, document.createElement('canvas'));
      out[gi] = { cv: ST.mask(a, v.lo, v.hi, v.soft, maskCanvases.get(gi), px / a.k), x: a.x, y: a.y, w: a.w / a.k, h: a.h / a.k };
    });
    return out;
  }

  // ---------- rendering ----------
  function render() {
    glyphD = S.nodes.glyph.map((g, gi) => FL.glyphPathData(S, gi));
    fills = S.nodes.glyph.map(g => (project.scripts[g.si] || {}).fill || '#ffffff');
    fxOut = FL.evaluateEffects(S, owners(), S.t);
    reveal = transitionReveal();
    const big = [view.x - view.w * 50, view.y - view.h * 50, view.w * 101, view.h * 101];
    $('scene').innerHTML = needsGL() ? '' : FL.frameMarkup(S, { fill: '#ffffff', fills, region: big, id: 'live' });
    renderEffects();
    renderOverlay();
    renderGizmos();
    renderMask();
  }

  let GLR = null, glFailed = false;
  // Draws the frame through gl.js at W x H device pixels; null when no script has effects and
  // no transition is under way.
  function effectFrame(W, H, s, ox, oy) {
    if (!S || !needsGL()) return null;
    if (!GLR && !glFailed) {
      try { GLR = FontLabGL.create(); } catch (e) { toast('WebGL failed: ' + e.message, true); }
      if (!GLR) { glFailed = true; toast('This browser has no WebGL, so effects cannot be drawn.', true); }
    }
    if (!GLR) return null;
    const holes = S.holes.length ? S.holes.map(Shapes.polyD).join('') : null;
    try { return GLR.render({ W, H, s, ox, oy, glyphD, style: S.style, fills, holes, reveal, units: units(), time: S.t }); }
    catch (e) { toast('Drawing failed: ' + e.message, true); return null; }
  }
  function renderEffects() {
    const m = metrics(), q = Math.min(window.devicePixelRatio || 1, 1.5);
    const cv = effectFrame(Math.round(m.W * q), Math.round(m.H * q), m.s * q, m.ox * q, m.oy * q);
    if (cv && !cv.isConnected) { cv.id = 'gl'; $('svg').after(cv); }
    if (GLR) GLR.canvas.style.display = cv ? 'block' : 'none';
  }

  function renderOverlay() {
    const g = $('overlayG'), lvl = prefs.overlay;
    let h = '';
    const k = 1 / metrics().s;
    if (lvl === 'strokes') { // how each glyph is probably drawn: its strokes in order, from the dot, numbered
      let n = 0;
      for (let gi = 0; gi < S.nodes.glyph.length && n < 400; gi++) {
        let a = null;
        try { a = strokeAnalysis(gi); } catch (e) { console.error(e); }
        if (!a) continue;
        a.strokes.forEach((st, j) => {
          n++;
          const col = `hsl(${(j * 67 + 190) % 360},90%,62%)`, p = st.pts;
          const d = 'M' + p.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L');
          h += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${(1.6 * k).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`;
          const e = p[p.length - 1], f = p[Math.max(0, p.length - 4)], ang = Math.atan2(e[1] - f[1], e[0] - f[0]), L = 7 * k;
          if (!st.dot) h += `<path d="M${(e[0] - Math.cos(ang - 0.45) * L).toFixed(1)} ${(e[1] - Math.sin(ang - 0.45) * L).toFixed(1)}L${e[0].toFixed(1)} ${e[1].toFixed(1)}L${(e[0] - Math.cos(ang + 0.45) * L).toFixed(1)} ${(e[1] - Math.sin(ang + 0.45) * L).toFixed(1)}" fill="none" stroke="${col}" stroke-width="${(1.6 * k).toFixed(2)}"/>`;
          h += `<circle cx="${p[0][0].toFixed(1)}" cy="${p[0][1].toFixed(1)}" r="${(3 * k).toFixed(2)}" fill="${col}"/>`
            + `<text x="${(p[0][0] + 4 * k).toFixed(1)}" y="${(p[0][1] - 4 * k).toFixed(1)}" font-size="${(k * 11).toFixed(1)}" fill="${col}" font-family="monospace">${j + 1}</text>`;
        });
      }
    } else if (lvl === 'point') {
      let c = 0;
      outer: for (let ci = 0; ci < S.contours.length; ci++) {
        if (S.hidden[ci] || S.contours[ci].attach) continue;
        for (const cm of S.contours[ci].cmds) for (let j = 0; j < cm.p.length; j++) {
          if (++c > 6000) break outer;
          const p = cm.p[j], ctrl = j < cm.p.length - 1;
          h += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(k * (ctrl ? 1.5 : 2.2)).toFixed(2)}" fill="${ctrl ? '#ffb000' : '#4da3ff'}"/>`;
        }
      }
    } else if (lvl) {
      S.nodes[lvl].slice(0, 3000).forEach((nd, j) => {
        const b = FL.bbox(S, nd.cs.filter(ci => !S.hidden[ci]));
        if (!b.w && !b.h) return;
        h += `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" fill="none" stroke="#ff3d9a" stroke-width="${k.toFixed(2)}"/>`
          + `<text x="${b.x.toFixed(1)}" y="${(b.y - k * 3).toFixed(1)}" font-size="${(k * 11).toFixed(1)}" fill="#ff3d9a" font-family="monospace">${j}</text>`;
      });
    }
    // a dashed frame around the selected script, or around each script of the selected group
    const framed = selKind() === 's' ? [selId()] : selKind() === 'g' ? project.scripts.filter(x => x.group === selId()).map(x => x.id) : [];
    for (const id of framed) {
      const si = project.scripts.findIndex(x => x.id === id);
      if (si < 0 || !S.nodes.text[si]) continue;
      const b = scriptBox(si), p = 6 * k;
      if (b.w || b.h) h += `<rect x="${(b.x - p).toFixed(1)}" y="${(b.y - p).toFixed(1)}" width="${(b.w + 2 * p).toFixed(1)}" height="${(b.h + 2 * p).toFixed(1)}" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="${k.toFixed(2)}" stroke-dasharray="${(4 * k).toFixed(2)} ${(3 * k).toFixed(2)}"/>`;
    }
    g.innerHTML = h;
  }

  // Unselected spatial modifiers are a faint outline; the selected one gets its full gizmo.
  function renderGizmos() {
    const g = $('gizmoG');
    if (!prefs.gizmos || !S) { if (g.firstChild) g.innerHTML = ''; return; }
    const k = 1 / metrics().s, col = 'var(--gizmo)', selMod = selKind() === 'm' ? selId() : null;
    let h = '';
    for (const f of S.fx) {
      const sh = f.shape, sel = f.id === selMod;
      const seg = sh.size * 0.05, ring = Shapes.polyD(Shapes.levelPolygon(sh, 0, 72, seg));
      const infl = f.R > 0 ? Shapes.polyD(Shapes.levelPolygon(sh, f.R, 72, seg)) : '';
      if (!sel) {
        h += `<path data-gizmo="${f.id}" data-part="body" d="${infl || ring}" fill="#fff" fill-opacity="0.001" stroke="${col}" stroke-opacity="0.45" stroke-width="${k}" style="cursor:move"/>`;
        continue;
      }
      const outer = f.F > 0 ? Shapes.polyD(Shapes.levelPolygon(sh, f.R + f.F, 72, seg)) : '';
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

  // White-on-black view of where warps act, evaluated per pixel.
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
    const fxs = S.fx.filter(f => f.type === 'warp').map(f => ({ f, soft: f.F, b: f.shape.bound + f.R + f.F }));
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
    e.textContent = `${project.scripts.length} scripts · ${S.nodes.glyph.length} glyphs · ${S.points} pts · ${evalMs.toFixed(1)} ms · ${fps} fps`;
  }

  // ---------- lists ----------
  const subOf = (item, def) => (def.subKey ? item.params[def.subKey] || def.params[def.subKey] : def.levels.includes(item.level) ? item.level : def.levels[0]);
  const hasErr = id => S && S.errors[id] && Object.keys(S.errors[id]).length;
  function row(key, depth, lead, name, sub, off, bad) {
    const r = el('div', { class: 'item' + (selected === key ? ' sel' : '') + (off ? ' off' : ''), onclick: () => select(selected === key ? null : key) },
      lead, el('span', { class: 'name' }, name + ' ', el('span', { class: 'sub' }, sub)), bad ? el('span', { class: 'bad', title: 'This has an error' }) : null);
    r.style.paddingLeft = 8 + depth * 18 + 'px';
    return r;
  }
  const toggle = (item, fx) => el('button', { class: 'dot' + (fx === 'tr' ? ' tr' : fx ? ' fx' : ''), title: item.on === false ? 'Turn on' : 'Turn off', onclick: e => { e.stopPropagation(); item.on = item.on === false; renderList(); changed(); } });
  const effectRow = (e, depth) => row('e:' + e.id, depth, toggle(e, true), FL.EFFECTS[e.type].label, subOf(e, FL.EFFECTS[e.type]), e.on === false, hasErr(e.id));
  const scriptRow = (sc, depth) => {
    const f = loadedFont(sc.font);
    return row('s:' + sc.id, depth, el('span', { class: 'glyph' }, 'T'), scriptName(sc), f ? fontLabel(f) : '', false, false);
  };
  function renderList() {
    const box = $('list'), seen = new Set();
    box.innerHTML = '';
    for (const sc of project.scripts) {
      const g = sc.group && groupById(sc.group);
      if (!g) { box.append(scriptRow(sc, 0)); continue; }
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const members = project.scripts.filter(x => x.group === g.id);
      box.append(row('g:' + g.id, 0, el('span', { class: 'glyph' }, '▣'), g.name, members.length + (members.length === 1 ? ' script' : ' scripts'), false, false));
      for (const m of members) box.append(scriptRow(m, 1));
    }
    // effects, under the script or group each is latched to
    const fb = $('fxList');
    fb.innerHTML = '';
    for (const o of [...project.scripts, ...project.groups]) {
      if (!o.effects.length) continue;
      const key = (isGroup(o) ? 'g:' : 's:') + o.id;
      fb.append(el('div', { class: 'owner', title: 'Select', onclick: () => select(key) }, 'on ' + (isGroup(o) ? o.name : scriptName(o))));
      for (const e of o.effects) fb.append(effectRow(e, 1));
    }
    if (!fb.firstChild) fb.append(el('div', { class: 'empty' }, 'none · + Effect adds one to the selected script'));
    // transitions, under the script each is latched to
    const tb = $('trList');
    tb.innerHTML = '';
    for (const sc of project.scripts) {
      if (!sc.transitions.length) continue;
      tb.append(el('div', { class: 'owner', title: 'Select', onclick: () => select('s:' + sc.id) }, 'on ' + scriptName(sc)));
      for (const tr of sc.transitions) {
        const def = TR.TRANSITIONS[tr.type], p = Object.assign({}, def.params, tr.params);
        tb.append(row('t:' + tr.id, 1, toggle(tr, 'tr'), def.label, `${p.role} · ${p.start}s`, tr.on === false, false));
      }
    }
    if (!tb.firstChild) tb.append(el('div', { class: 'empty' }, 'none · + Transition adds one to the selected script'));
    const mb = $('modList');
    mb.innerHTML = '';
    for (const m of project.mods) {
      const def = FL.MODIFIERS[m.type];
      mb.append(row('m:' + m.id, 0, toggle(m, false), def.label, subOf(m, def), m.on === false, hasErr(m.id)));
    }
    if (!project.mods.length) mb.append(el('div', { class: 'empty' }, 'none'));
  }

  function select(key) {
    selected = key;
    renderList();
    renderInspector();
    dirty = true;
  }

  // ---------- inspector (only the selected item) ----------
  let refs = {};
  const field = (label, control, doc) => el('div', { class: 'f' }, el('label', { title: doc || label }, label), control);
  const head = (title, sub, ...buttons) => el('div', { class: 'ih' }, el('b', null, title, sub ? el('span', { class: 'sub' }, ' ' + sub) : null), ...buttons);
  const ghost = (txt, title, fn, disabled) => el('button', { class: 'ghost', title, onclick: fn, disabled: !!disabled }, txt);
  const fxAdd = () => el('div', { class: 'dd' }, el('button', { class: 'ghost', 'data-menu': 'fxMenu', title: 'Add an effect to this' }, '+ Effect'));

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
    const k = selKind(), id = selId();
    if (k === 's' && scriptById(id)) inspectScript(box, scriptById(id));
    else if (k === 'g' && groupById(id)) inspectGroup(box, groupById(id));
    else if (k === 'e' && effectById(id)) inspectEffect(box, effectById(id));
    else if (k === 't' && transitionById(id)) inspectTransition(box, transitionById(id));
    else if (k === 'm' && modById(id)) inspectMod(box, modById(id));
    else selected = null;
  }

  function moveIn(list, item, d) {
    const i = list.indexOf(item), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    list.splice(i, 1); list.splice(j, 0, item);
    renderList(); renderInspector(); changed();
  }
  const pruneGroups = () => { project.groups = project.groups.filter(g => project.scripts.some(s => s.group === g.id)); };

  function inspectScript(box, sc) {
    const many = project.scripts.length > 1;
    box.append(head('Script', '', fxAdd(),
      ghost('↑', 'Draw earlier (further back)', () => { moveIn(project.scripts, sc, -1); rebuild(); }),
      ghost('↓', 'Draw later (further forward)', () => { moveIn(project.scripts, sc, 1); rebuild(); }),
      ghost('⧉', 'Duplicate', () => {
        const c = Object.assign(clone(sc), { id: uid(), y: sc.y + sc.layout.size * 1.4 });
        c.effects.forEach(e => { e.id = uid(); });
        c.transitions.forEach(x => { x.id = uid(); });
        project.scripts.splice(project.scripts.indexOf(sc) + 1, 0, c);
        select('s:' + c.id); changed(); rebuild(true);
      }),
      ghost('✕', many ? 'Delete' : 'The last script cannot be deleted', () => {
        project.scripts.splice(project.scripts.indexOf(sc), 1); pruneGroups(); select(null); changed(); rebuild();
      }, !many)));
    const sel = el('select', { onchange: async () => { sc.font = sel.value; save(); await rebuild(true); renderInspector(); } });
    const dev = fontOptions.filter(o => o.device), site = fontOptions.filter(o => !o.device);
    if (dev.length) sel.append(el('optgroup', { label: 'On this device' }, ...dev.map(o => new Option(o.label, o.value))));
    sel.append(el('optgroup', { label: 'Site' }, ...site.map(o => new Option(o.label, o.value))));
    sel.value = sc.font;
    box.append(field('font', el('div', { class: 'row' }, sel,
      el('button', { title: 'Add font files (kept in this browser only)', onclick: () => $('fontFile').click() }, '+'),
      sc.font.startsWith('idb:') ? el('button', { title: 'Remove this font from this browser', onclick: () => removeFont(sc) }, '×') : null)));
    box.append(el('textarea', { class: 'mono', value: sc.text, spellcheck: false, oninput: e => { sc.text = e.target.value; save(); rebuild(); } }));
    box.append(field('size', sliderInput(sc.layout.size, [8, 400, 1], v => { const n = parseFloat(v); if (n > 0) { sc.layout.size = n; save(); rebuild(); } }).row));
    box.append(field('colour', el('input', { type: 'color', value: sc.fill, oninput: e => { sc.fill = e.target.value; changed(); } })));
    const xy = ['x', 'y'].map(k => el('input', { type: 'number', step: 1, value: Math.round(sc[k]), title: k + ' (or drag the script when it is selected)',
      oninput: e => { const v = parseFloat(e.target.value); if (isFinite(v)) { sc[k] = v; save(); rebuild(); } } }));
    refs.sx = xy[0]; refs.sy = xy[1];
    box.append(field('position', el('div', { class: 'row xy' }, xy[0], xy[1])));
    const grp = el('select', { onchange: () => {
      if (grp.value === '+') { const g = { id: uid(), name: 'Group ' + (project.groups.length + 1), effects: [] }; project.groups.push(g); sc.group = g.id; }
      else sc.group = grp.value || null;
      pruneGroups(); renderList(); renderInspector(); changed();
    } }, new Option('none', ''), ...project.groups.map(g => new Option(g.name, g.id)), new Option('+ new group', '+'));
    grp.value = sc.group || '';
    box.append(field('group', grp, 'Scripts in a group share the group\'s effects'));

    const num = (key, label, step) => field(label, el('input', { type: 'number', step, value: sc.layout[key],
      oninput: e => { const v = parseFloat(e.target.value); if (isFinite(v)) { sc.layout[key] = v; save(); rebuild(); } } }));
    const align = el('select', { onchange: e => { sc.layout.align = e.target.value; save(); rebuild(); } }, ...['left', 'center', 'right'].map(a => new Option(a, a)));
    align.value = sc.layout.align;
    const check = (key, label) => el('label', { class: 'row' }, el('input', { type: 'checkbox', checked: !!sc.layout[key], onchange: e => { sc.layout[key] = e.target.checked; save(); rebuild(); } }), label);
    box.append(el('details', null, el('summary', null, 'Spacing and features'),
      num('lineHeight', 'line height', 0.05), num('letterSpacing', 'letters', 1), num('wordSpacing', 'words', 1),
      field('align', align), field('', el('div', { class: 'row' }, check('kerning', 'kerning'), check('liga', 'ligatures')))));
  }

  function inspectGroup(box, g) {
    box.append(head('Group', '', fxAdd(),
      ghost('✕', 'Ungroup (the scripts stay; the group\'s effects are removed)', () => {
        for (const s of project.scripts) if (s.group === g.id) s.group = null;
        pruneGroups(); select(null); changed();
      })));
    box.append(field('name', el('input', { type: 'text', value: g.name, oninput: e => { g.name = e.target.value || 'Group'; renderList(); save(); } })));
    const members = project.scripts.filter(s => s.group === g.id);
    box.append(field('scripts', el('div', { class: 'mutedlist' }, members.map(scriptName).join(', '))));
  }

  function inspectEffect(box, { e, owner }) {
    const def = FL.EFFECTS[e.type];
    box.append(head(def.label, 'on ' + (isGroup(owner) ? owner.name : scriptName(owner)), fxAdd(),
      ghost('↑', 'Earlier in the stack', () => moveIn(owner.effects, e, -1)),
      ghost('↓', 'Later in the stack', () => moveIn(owner.effects, e, 1)),
      ghost('⧉', 'Duplicate', () => { const c = Object.assign(clone(e), { id: uid() }); owner.effects.splice(owner.effects.indexOf(e) + 1, 0, c); select('e:' + c.id); changed(); }),
      ghost('✕', 'Delete', () => { owner.effects.splice(owner.effects.indexOf(e), 1); select(isGroup(owner) ? 'g:' + owner.id : 's:' + owner.id); changed(); })));
    params(box, e, def);
  }

  // play a transition from its start: the timeline jumps to just before it
  function playFrom(sec) {
    const L = TR.LOOP;
    t = Math.floor(t / L) * L + Math.max(0, Math.min(L - 0.01, sec));
    if (!playing) togglePlay();
    dirty = true;
  }
  function inspectTransition(box, { tr, owner }) {
    const def = TR.TRANSITIONS[tr.type], p = () => Object.assign({}, def.params, tr.params);
    box.append(head(def.label, 'on ' + scriptName(owner),
      ghost('▶', 'Play it (the timeline jumps to just before it starts)', () => playFrom(parseFloat(p().start) - 0.3)),
      ghost('⧉', 'Duplicate', () => { const c = Object.assign(clone(tr), { id: uid() }); owner.transitions.splice(owner.transitions.indexOf(tr) + 1, 0, c); select('t:' + c.id); changed(); }),
      ghost('✕', 'Delete', () => { owner.transitions.splice(owner.transitions.indexOf(tr), 1); select('s:' + owner.id); changed(); })));
    params(box, tr, def);
  }

  function inspectMod(box, m) {
    const def = FL.MODIFIERS[m.type];
    box.append(head(def.label, '',
      ghost('↑', 'Move up', () => moveIn(project.mods, m, -1)),
      ghost('↓', 'Move down', () => moveIn(project.mods, m, 1)),
      ghost('⧉', 'Duplicate', () => { const c = Object.assign(clone(m), { id: uid() }); project.mods.splice(project.mods.indexOf(m) + 1, 0, c); select('m:' + c.id); changed(); }),
      ghost('✕', 'Delete', () => { project.mods.splice(project.mods.indexOf(m), 1); select(null); changed(); })));
    params(box, m, def);
  }

  // settings of a modifier or an effect
  function params(box, m, def) {
    if (def.levels && !def.spatial && !def.global) {
      const lvl = el('select', { onchange: () => { m.level = lvl.value; renderList(); changed(); } }, ...def.levels.map(l => new Option('per ' + l, l)));
      lvl.value = def.levels.includes(m.level) ? m.level : def.levels[0];
      box.append(field('acts on', lvl));
    }
    for (const key in def.params) {
      const only = def.only && def.only[key];
      if (only && !Object.keys(only).every(k => [].concat(only[k]).includes(m.params[k] || def.params[k]))) continue;
      if (def.spatial && (key === 'x' || key === 'y')) {
        if (key === 'y') continue;
        // x and y share one row, plus a button that brings the modifier into view
        const xy = ['x', 'y'].map(k => el('input', { type: 'text', class: 'mono', spellcheck: false, title: `${k} (drag the gizmo, or type an expression)`,
          value: m.params[k], oninput: e => { m.params[k] = e.target.value; changed(); } }));
        const msgs = xy.map(() => { const d = el('div', { class: 'msg' }); d.hidden = true; return d; });
        const f = field('position', el('div', { class: 'row xy' }, xy[0], xy[1],
          ghost('⌖', 'Move to the middle of the view', () => { setParam(m, 'x', view.x + view.w / 2); setParam(m, 'y', view.y + view.h / 2); changed(); })));
        f.append(...msgs);
        box.append(f);
        refs.x = { inp: xy[0], rng: null, msg: msgs[0] };
        refs.y = { inp: xy[1], rng: null, msg: msgs[1] };
        continue;
      }
      const doc = (def.docs && def.docs[key]) || '';
      const msg = el('div', { class: 'msg' }); msg.hidden = true;
      let control, inp, rng = null;
      if (def.curve && def.curve.includes(key)) { // animation curve: grouped presets, and a graph of the one chosen
        inp = el('select', { title: doc });
        for (const grp in TR.CURVE_GROUPS) inp.append(el('optgroup', { label: grp }, ...TR.CURVE_GROUPS[grp].map(o => new Option(o, o))));
        inp.value = m.params[key] || def.params[key];
        const graph = el('div', { class: 'curve' });
        const draw = () => { graph.innerHTML = curveGraph(TR.curve(inp.value, m.params.bezier || def.params.bezier)); };
        inp.onchange = () => { m.params[key] = inp.value; renderList(); renderInspector(); changed(); };
        draw();
        control = el('div', null, inp, graph);
        refs._curveGraph = draw;
      } else if (def.choice && def.choice[key]) {
        inp = el('select', { title: doc, onchange: () => { m.params[key] = inp.value; renderList(); if (def.only) renderInspector(); changed(); } }, ...def.choice[key].map(o => new Option(o, o)));
        inp.value = m.params[key] || def.params[key];
        control = inp;
      } else if (def.color && def.color.includes(key)) {
        inp = el('input', { type: 'color', title: doc, value: /^#[0-9a-f]{6}$/i.test(m.params[key] || '') ? m.params[key] : def.params[key], oninput: () => { m.params[key] = inp.value; changed(); } });
        control = inp;
      } else if (def.text && def.text.includes(key)) {
        inp = el('input', { type: 'text', spellcheck: false, title: doc, value: m.params[key] || '', placeholder: def.params[key] || 'default set',
          oninput: () => { m.params[key] = inp.value; if (refs._curveGraph) refs._curveGraph(); changed(); } });
        control = inp;
      } else if (def.ui && def.ui[key]) {
        const s = sliderInput(m.params[key] != null ? m.params[key] : def.params[key], def.ui[key], v => { m.params[key] = v; if (def.roles) renderList(); changed(); }, true);
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
    if (!def.roles) box.append(el('details', null, el('summary', null, 'Expression help'), $('helpTpl').content.cloneNode(true)));
    showErrors();
  }
  // a small graph of an animation curve: progress across, eased progress up
  function curveGraph(f) {
    const W = 200, H = 90, pad = 14, y = v => (H - pad - v * (H - 2 * pad)).toFixed(1);
    let d = '';
    for (let i = 0; i <= 80; i++) { const x = i / 80; d += (i ? 'L' : 'M') + (pad / 2 + x * (W - pad)).toFixed(1) + ' ' + y(f(x)); }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">`
      + `<rect x="${pad / 2}" y="${pad}" width="${W - pad}" height="${H - 2 * pad}" fill="none" stroke="#2e2e2e"/>`
      + `<path d="${d}" fill="none" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function setParam(m, key, v) {
    const s = String(Math.round(v * 10) / 10);
    m.params[key] = s;
    if ('m:' + m.id === selected && refs[key]) { refs[key].inp.value = s; if (refs[key].rng) refs[key].rng.value = s; }
  }

  let errSig = '';
  function showErrors() {
    if (!S) return;
    const e = (selected && S.errors[selId()]) || {};
    for (const key in refs) {
      const r = refs[key];
      if (!r || !r.msg) continue;
      const msg = e[key] || '';
      r.inp.classList.toggle('err', !!msg);
      r.msg.hidden = !msg;
      r.msg.textContent = msg;
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
    select('m:' + m.id);
    changed();
  }
  function addEffects(list) {
    const owner = currentOwner();
    owner.effects.push(...list);
    t = 0;
    select('e:' + list[list.length - 1].id);
    changed();
  }
  function addTransition(tr) {
    const sc = currentScript();
    sc.transitions.push(tr);
    select('t:' + tr.id);
    changed();
    playFrom(parseFloat(tr.params.start) - 0.3);
  }
  async function addScript() {
    let y = 0, x = 0;
    if (S && S.nodes.text.length) {
      const b = FL.bounds(S, true), last = project.scripts[project.scripts.length - 1];
      y = b.y + b.h + (last ? last.layout.size : 160) * 0.9; x = b.x;
    }
    const sc = newScript({ text: 'Text', x: Math.round(x), y: Math.round(y) });
    project.scripts.push(sc);
    save();
    await rebuild(true);
    select('s:' + sc.id);
  }

  // ---------- menus ----------
  function closeMenus() { for (const m of document.querySelectorAll('.menu')) m.hidden = true; }
  function openMenu(b) {
    const menu = $(b.dataset.menu), open = menu.hidden;
    closeMenus();
    if (!open) return;
    if (menu.id === 'fxMenu') { const o = currentOwner(); $('fxTarget').textContent = 'Add to ' + (isGroup(o) ? o.name : scriptName(o)); }
    if (menu.id === 'trMenu') $('trTarget').textContent = 'Add to ' + scriptName(currentScript());
    // fixed position next to the button, kept on screen (the side panel would clip it otherwise)
    const r = b.getBoundingClientRect();
    menu.hidden = false;
    const below = innerHeight - r.bottom - 12, above = r.top - 12, h = menu.scrollHeight;
    if (below < Math.min(h, 320) && above > below) {
      menu.style.maxHeight = Math.max(120, above) + 'px';
      menu.style.top = Math.max(8, r.top - 4 - Math.min(h, above)) + 'px';
    } else {
      menu.style.maxHeight = Math.max(120, below) + 'px';
      menu.style.top = r.bottom + 4 + 'px';
    }
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px';
  }
  function setupMenus() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-menu]');
      if (b) { e.stopPropagation(); openMenu(b); }
    });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.dd') && !e.target.closest('.menu')) closeMenus(); });
    window.addEventListener('resize', closeMenus);
    $('side').addEventListener('scroll', closeMenus);
    for (const m of document.querySelectorAll('.menu')) m.addEventListener('click', e => { if (e.target.closest('button')) closeMenus(); });

    const mm = $('modMenu');
    mm.append(el('div', { class: 'mh' }, 'Modifier'));
    for (const k in FL.MODIFIERS) mm.append(el('button', { onclick: () => addModifier(k) }, FL.MODIFIERS[k].label));
    mm.append(el('hr'), el('div', { class: 'mh' }, 'Preset'));
    for (const name in MOD_PRESETS) mm.append(el('button', { onclick: () => { const l = MOD_PRESETS[name](); project.mods.push(...l); t = 0; select('m:' + l[l.length - 1].id); changed(); } }, name));

    const fm = $('fxMenu');
    fm.append(el('div', { class: 'mh', id: 'fxTarget' }, 'Effect'));
    for (const k in FL.EFFECTS) fm.append(el('button', { onclick: () => addEffects([E(k, {})]) }, FL.EFFECTS[k].label));
    fm.append(el('hr'), el('div', { class: 'mh' }, 'Preset'));
    for (const name in FX_PRESETS) fm.append(el('button', { onclick: () => addEffects(FX_PRESETS[name]()) }, name));

    const tm = $('trMenu');
    tm.append(el('div', { class: 'mh', id: 'trTarget' }, 'Transition'));
    for (const k in TR.TRANSITIONS) {
      const def = TR.TRANSITIONS[k];
      for (const role of def.roles) tm.append(el('button', { onclick: () => addTransition(T(k, Object.assign({ role }, role === 'outro' ? { start: '8' } : {}))) }, `${def.label} (${role})`));
    }
    tm.append(el('hr'), el('div', { class: 'mh' }, 'Preset'));
    for (const name in TR_PRESETS) tm.append(el('button', { onclick: () => addTransition(TR_PRESETS[name]()) }, name));
  }

  // ---------- files ----------
  function download(name, data, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const svgImage = async svg => {
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try { await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(img.src), 1000); }
  };
  async function exportPNG() {
    if (!S) return;
    const m = metrics(), dpr = 2, W = Math.round(m.W * dpr), H = Math.round(m.H * dpr);
    const vb = [-m.ox / m.s, -m.oy / m.s, m.W / m.s, m.H / m.s];
    const cv = el('canvas', { width: W, height: H }), ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    try {
      const glc = effectFrame(W, H, m.s * dpr, m.ox * dpr, m.oy * dpr);
      if (glc) ctx.drawImage(glc, 0, 0, W, H);
      else ctx.drawImage(await svgImage(FL.toSVG(S, { fill: '#ffffff', fills, background: null, viewBox: vb, width: W, height: H })), 0, 0, W, H);
    } catch (e) { toast('PNG export failed: ' + e.message, true); return; }
    dirty = true; // the stage's GL canvas was used at export size; draw it again
    cv.toBlob(b => download('fontlab-frame.png', b), 'image/png');
  }
  function exportSVG() {
    if (!S) return;
    if (!needsGL()) { download('fontlab-frame.svg', FL.toSVG(S, { fill: '#ffffff', fills, background: '#000' }), 'image/svg+xml'); return; }
    // per-pixel effects have no vector form: embed them as an image
    const m = metrics(), dpr = 2, W = Math.round(m.W * dpr), H = Math.round(m.H * dpr), vb = [-m.ox / m.s, -m.oy / m.s, m.W / m.s, m.H / m.s];
    const glc = effectFrame(W, H, m.s * dpr, m.ox * dpr, m.oy * dpr);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${Math.round(m.W)}" height="${Math.round(m.H)}">`
      + `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#000"/>`
      + (glc ? `<image href="${glc.toDataURL('image/png')}" x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" preserveAspectRatio="none"/>` : '')
      + '</svg>\n';
    dirty = true;
    download('fontlab-frame.svg', svg, 'image/svg+xml');
  }
  async function openProject(file) {
    try {
      project = normalize(JSON.parse(await file.text()));
      selected = null; save(); renderInspector();
      await refreshFonts(); await rebuild(true);
    } catch (err) { toast('Could not open project: ' + err.message, true); }
  }

  // ---------- wiring ----------
  function wire() {
    setupMenus();
    $('addScript').onclick = addScript;
    $('fontFile').onchange = e => { addFontFiles([...e.target.files]); e.target.value = ''; };
    $('projFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); };

    $('play').onclick = togglePlay;
    $('time').oninput = e => { t = parseFloat(e.target.value); dirty = true; };
    $('fit').onclick = fit;
    const pref = (id, key, prop) => { const e = $(id); e[prop] = prefs[key]; e.onchange = e.oninput = () => { prefs[key] = prop === 'checked' ? e.checked : e.value; save(); dirty = true; updateStats(); }; };
    for (const l of FL.LEVELS) $('overlay').append(new Option(l, l));
    $('overlay').append(new Option('strokes (how letters are drawn)', 'strokes'));
    pref('gizmos', 'gizmos', 'checked'); pref('maskView', 'mask', 'checked'); pref('statsOn', 'stats', 'checked');
    pref('overlay', 'overlay', 'value'); pref('speed', 'speed', 'value');

    $('exportSvg').onclick = exportSVG;
    $('exportPng').onclick = exportPNG;
    $('exportGlyphs').onclick = () => {
      const sc = selKind() === 's' ? scriptById(selId()) : project.scripts[0], f = sc && loadedFont(sc.font);
      if (f) download(fontLabel(f).replace(/[^\w.-]+/g, '_') + '.glyphs.json', JSON.stringify(FL.fontToJSON(f)), 'application/json');
    };
    $('saveProj').onclick = () => download('fontlab-project.json', JSON.stringify(project, null, 2), 'application/json');
    $('openProj').onclick = () => $('projFile').click();
    $('reset').onclick = () => {
      if (!confirm('Reset scripts, effects and modifiers to defaults? Added fonts are kept.')) return;
      project = normalize(defaultProject()); selected = null; save(); renderInspector(); rebuild(true);
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
      const fontFiles = files.filter(f => /\.(ttf|otf|woff2?)$/i.test(f.name)), proj = files.find(f => /\.json$/i.test(f.name));
      if (fontFiles.length) addFontFiles(fontFiles); else if (proj) openProject(proj);
    });

    // stage: drag gizmos; drag the selected script (or a script of the selected group); a click on
    // a script selects it; otherwise pan (one pointer) and pinch-zoom (two); a click on nothing deselects
    const ui = $('ui');
    ui.addEventListener('wheel', e => {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY), k = Math.exp(e.deltaY * 0.0015);
      view = { x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w: view.w * k, h: view.h * k };
      applyView();
    }, { passive: false });
    const hitScript = w => {
      if (!S) return null;
      for (let si = project.scripts.length - 1; si >= 0; si--) {
        if (!S.nodes.text[si]) continue;
        const b = scriptBox(si);
        if (b.w && w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) return project.scripts[si];
      }
      return null;
    };
    const ptrs = new Map();
    let downAt = null, downHit = null;
    ui.addEventListener('pointerdown', e => {
      ui.setPointerCapture(e.pointerId);
      closeMenus();
      const w = toWorld(e.clientX, e.clientY);
      const gz = e.target.closest && e.target.closest('[data-gizmo]');
      if (gz && !ptrs.size && S) {
        const m = modById(gz.dataset.gizmo), f = S.fx.find(x => x.id === gz.dataset.gizmo);
        if (m && f) {
          drag = { pid: e.pointerId, kind: 'gizmo', m, part: gz.dataset.part, dx: w.x - f.shape.cx, dy: w.y - f.shape.cy, cx: f.shape.cx, cy: f.shape.cy };
          if (selected !== 'm:' + m.id) select('m:' + m.id);
          return;
        }
      }
      const hit = !ptrs.size ? hitScript(w) : null;
      if (hit) {
        const groupSel = selKind() === 'g' && hit.group === selId();
        if (selected === 's:' + hit.id || groupSel) {
          const moving = groupSel ? project.scripts.filter(s => s.group === hit.group) : [hit];
          drag = { pid: e.pointerId, kind: 'script', w0: w, moving: moving.map(s => ({ s, x: s.x, y: s.y })) };
          return;
        }
      }
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      downAt = ptrs.size === 1 ? [e.clientX, e.clientY] : null;
      downHit = hit;
    });
    ui.addEventListener('pointermove', e => {
      if (drag && e.pointerId === drag.pid) {
        const w = toWorld(e.clientX, e.clientY);
        if (drag.kind === 'script') {
          for (const it of drag.moving) { it.s.x = Math.round(it.x + w.x - drag.w0.x); it.s.y = Math.round(it.y + w.y - drag.w0.y); }
          const one = drag.moving.length === 1 && selected === 's:' + drag.moving[0].s.id;
          if (one && refs.sx) { refs.sx.value = drag.moving[0].s.x; refs.sy.value = drag.moving[0].s.y; }
          save(); rebuild();
          return;
        }
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
      if (downAt && ptrs.size === 1 && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4) {
        if (downHit) select('s:' + downHit.id); else if (selected) select(null);
      }
      ptrs.delete(e.pointerId);
      downAt = null; downHit = null;
    };
    ui.addEventListener('pointerup', up);
    ui.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); downAt = null; if (drag && drag.pid === e.pointerId) drag = null; });
    window.addEventListener('resize', () => { dirty = true; });
  }
  function togglePlay() { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; last = performance.now(); }

  // ---------- start ----------
  const build = (/[?&]v=([^&]+)/.exec((document.querySelector('script[src*="app.js"]') || {}).src || '') || [])[1];
  $('build').textContent = 'version ' + (build || 'dev');
  wire();
  renderList();
  refreshFonts().then(() => rebuild(true));
  requestAnimationFrame(frame);

  // for console tinkering
  window.fontlab = { get project() { return project; }, get frame() { return S; }, get effects() { return fxOut; }, select: k => select(k), strokes: gi => strokeAnalysis(gi) };
})();
