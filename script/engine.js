/*
 * FontLab engine
 *
 *   font file --layout()--> base geometry tree --evaluate(mods, t)--> frame
 *
 * The tree has six levels: text > line > word > glyph > contour > point.
 * Every glyph becomes plain vector outlines (SVG-style commands) the moment
 * it is laid out, so nothing downstream needs the font again.
 *
 * A modifier targets one level and runs once per element of that level, in
 * stack order. Every parameter is an expression evaluated per element, with
 * variables such as i (index), u (0..1 along the level), t (seconds), x/y
 * (element centre or point position) and the parent indices li/wi/gi/ci.
 *
 * The engine has no DOM dependencies; the page and a future device runtime
 * can both use it.
 */
(function (root) {
  'use strict';

  const LEVELS = ['text', 'line', 'word', 'glyph', 'contour', 'point'];
  const D2R = Math.PI / 180;

  // ---------- helpers usable inside expressions ----------
  function hash2(a, b) {
    let h = Math.imul((Math.floor(a) | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((Math.floor(b) | 0) + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function noise(x, y) {
    y = y || 0;
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    const top = a + (b - a) * u, bot = c + (d - c) * u;
    return (top + (bot - top) * v) * 2 - 1;
  }
  const HELPERS = {};
  for (const k of Object.getOwnPropertyNames(Math)) HELPERS[k] = Math[k];
  Object.assign(HELPERS, {
    TAU: Math.PI * 2,
    rnd: (a, b) => hash2(a, b || 0),                       // 0..1, stable for integer inputs
    noise,                                                 // -1..1 smooth value noise
    fbm: (x, y, oct) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < (oct || 4); o++) { s += a * noise(x * f, (y || 0) * f); f *= 2; a *= 0.5; } return s; },
    clamp: (v, a, b) => Math.min(Math.max(v, a), b),
    lerp: (a, b, k) => a + (b - a) * k,
    mix: (a, b, k) => a + (b - a) * k,
    smoothstep: (a, b, v) => { const k = Math.min(Math.max((v - a) / (b - a), 0), 1); return k * k * (3 - 2 * k); },
    fract: v => v - Math.floor(v),
    tri: v => 1 - Math.abs((v - Math.floor(v)) * 2 - 1),   // 0..1..0 per unit
    saw: v => v - Math.floor(v),
    sq: v => (v - Math.floor(v)) < 0.5 ? 1 : 0,
    pulse: (v, w) => (v - Math.floor(v)) < (w == null ? 0.5 : w) ? 1 : 0,
    ease: k => { k = Math.min(Math.max(k, 0), 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; },
    deg: d => d * D2R,
    hsl: (h, s, l, a) => `hsla(${((h % 360) + 360) % 360},${s == null ? 80 : s}%,${l == null ? 50 : l}%,${a == null ? 1 : a})`,
    rgb: (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a == null ? 1 : a})`,
  });

  const VARS = ['i', 'n', 'u', 't', 'x', 'y', 'w', 'h', 'li', 'wi', 'gi', 'ci', 'pi', 'ctrl', 'k', 'ch', 'size'];
  const HN = Object.keys(HELPERS);
  const ARGS = new Array(VARS.length + HN.length);
  HN.forEach((k, j) => { ARGS[VARS.length + j] = HELPERS[k]; });

  const cache = new Map();
  function compile(src) {
    src = src == null ? '' : String(src).trim();
    let c = cache.get(src);
    if (c) return c;
    c = { src, fn: null, err: null, empty: src === '' };
    if (!c.empty) {
      try { c.fn = new Function(...VARS, ...HN, '"use strict";return (' + src + '\n);'); }
      catch (e) { c.err = e.message; }
    }
    if (cache.size > 5000) cache.clear();
    cache.set(src, c);
    return c;
  }

  // ---------- modifiers ----------
  // params: name -> default expression. str: params whose value is a string (colours);
  // if they don't evaluate, the raw text is used, so `#f80` and `red` work unquoted.
  const MODIFIERS = {
    transform: {
      label: 'Transform',
      levels: ['glyph', 'word', 'line', 'text', 'contour'],
      params: { tx: '0', ty: '0', rot: '0', sx: '1', sy: '1', skx: '0', px: '0.5', py: '0.5' },
      docs: { tx: 'move x', ty: 'move y', rot: 'rotate (degrees)', sx: 'scale x', sy: 'scale y', skx: 'skew x (degrees)', px: 'pivot x, 0..1 of bounding box', py: 'pivot y, 0..1 of bounding box' },
      apply: applyTransform,
    },
    displace: {
      label: 'Displace points',
      levels: ['point'],
      params: { dx: '0', dy: '0' },
      docs: { dx: 'offset x per point (x, y = point position; ctrl = 1 for curve handles)', dy: 'offset y per point' },
      apply: applyDisplace,
    },
    resample: {
      label: 'Resample (curves → dense points)',
      levels: ['contour'],
      params: { step: '4' },
      docs: { step: 'spacing between points, px. Put this before Displace for smooth bending' },
      apply: applyResample,
    },
    visible: {
      label: 'Visibility',
      levels: ['glyph', 'word', 'line', 'contour'],
      params: { show: '1' },
      docs: { show: 'element is hidden when ≤ 0' },
      apply: applyVisible,
    },
    style: {
      label: 'Style',
      levels: ['glyph', 'word', 'line', 'text'],
      params: { fill: '', stroke: '', sw: '', opacity: '', draw: '' },
      str: ['fill', 'stroke'],
      docs: { fill: 'colour, e.g. #f80, none, hsl(i*30)', stroke: 'outline colour', sw: 'outline width', opacity: '0..1', draw: '0..1 portion of the outline drawn (needs stroke)' },
      apply: applyStyle,
    },
  };

  function makeCtx(S, m, def, t) {
    const env = { i: 0, n: 1, u: 0, t, x: 0, y: 0, w: 0, h: 0, li: 0, wi: 0, gi: 0, ci: 0, pi: 0, ctrl: 0, k: 0, ch: 0, size: S.size };
    const fns = {};
    const strs = def.str || [];
    function fail(key, msg) {
      const e = S.errors[m.id] || (S.errors[m.id] = {});
      if (!e[key]) e[key] = msg;
    }
    for (const key in def.params) {
      const v = m.params && m.params[key];
      const src = v != null && String(v).trim() !== '' ? v : def.params[key];
      const c = compile(src);
      fns[key] = c;
      if (c.err && !strs.includes(key)) fail(key, c.err);
    }
    function run(key, quiet) {
      const c = fns[key];
      if (!c || !c.fn) return undefined;
      for (let j = 0; j < VARS.length; j++) ARGS[j] = env[VARS[j]];
      try { return c.fn.apply(null, ARGS); }
      catch (e) { if (!quiet) fail(key, e.message); return undefined; }
    }
    return {
      env, fail,
      has: key => !!fns[key] && !fns[key].empty,
      num(key, d) {
        let v = run(key);
        if (typeof v === 'boolean') v = +v;
        if (typeof v !== 'number' || !isFinite(v)) {
          if (v !== undefined) fail(key, 'not a finite number: ' + String(v));
          return d;
        }
        return v;
      },
      str(key) {
        const c = fns[key];
        if (!c || c.empty) return undefined;
        if (!c.fn) return c.src;
        const v = run(key, true);
        return v === undefined || v === null ? c.src : String(v);
      },
    };
  }

  function bbox(S, cs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ci of cs) {
      for (const k of S.contours[ci].cmds) for (const p of k.p) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
    }
    if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  function setNode(env, nd, j, n, b) {
    env.i = j; env.n = n; env.u = n > 1 ? j / (n - 1) : 0;
    env.x = b.cx; env.y = b.cy; env.w = b.w; env.h = b.h;
    env.li = nd.li; env.wi = nd.wi; env.gi = nd.gi; env.ci = nd.ci; env.ch = nd.ch;
    env.pi = 0; env.ctrl = 0; env.k = 0;
  }

  function applyTransform(S, level, c) {
    const list = S.nodes[level], n = list.length;
    for (let j = 0; j < n; j++) {
      const nd = list[j], b = bbox(S, nd.cs);
      setNode(c.env, nd, j, n, b);
      const tx = c.num('tx', 0), ty = c.num('ty', 0), rot = c.num('rot', 0) * D2R;
      const sx = c.num('sx', 1), sy = c.num('sy', 1), sk = c.num('skx', 0) * D2R;
      if (!tx && !ty && !rot && sx === 1 && sy === 1 && !sk) continue;
      const ox = b.x + b.w * c.num('px', 0.5), oy = b.y + b.h * c.num('py', 0.5);
      const cs = Math.cos(rot), sn = Math.sin(rot), kx = Math.tan(sk);
      for (const ci of nd.cs) for (const k of S.contours[ci].cmds) for (const p of k.p) {
        let dx = p[0] - ox, dy = p[1] - oy;
        dx += kx * dy; dx *= sx; dy *= sy;
        p[0] = ox + dx * cs - dy * sn + tx;
        p[1] = oy + dx * sn + dy * cs + ty;
      }
    }
  }

  function applyDisplace(S, level, c) {
    const env = c.env, C = S.contours;
    let k = 0;
    for (let ci = 0; ci < C.length; ci++) {
      const con = C[ci];
      let np = 0;
      for (const cm of con.cmds) np += cm.p.length;
      const b = bbox(S, [ci]);
      env.li = con.li; env.wi = con.wi; env.gi = con.gi; env.ci = ci; env.ch = con.ch;
      env.n = np; env.w = b.w; env.h = b.h;
      let pi = 0;
      for (const cm of con.cmds) {
        const L = cm.p.length;
        for (let q = 0; q < L; q++) {
          const p = cm.p[q];
          env.i = env.pi = pi; env.u = np > 1 ? pi / (np - 1) : 0;
          env.x = p[0]; env.y = p[1]; env.ctrl = q < L - 1 ? 1 : 0; env.k = k;
          const dx = c.num('dx', 0), dy = c.num('dy', 0);
          p[0] += dx; p[1] += dy;
          pi++; k++;
        }
      }
    }
  }

  function applyResample(S, level, c) {
    const list = S.nodes.contour, n = list.length;
    for (let j = 0; j < n; j++) {
      const nd = list[j];
      setNode(c.env, nd, j, n, bbox(S, nd.cs));
      const step = c.num('step', 4);
      if (!(step > 0)) continue;
      S.contours[j].cmds = resampleCmds(S.contours[j].cmds, Math.max(step, 0.25));
    }
  }

  function resampleCmds(cmds, step) {
    const out = [];
    let cur = null, start = null;
    const segs = len => Math.min(4000, Math.max(1, Math.ceil(len / step)));
    const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const line = (a, b, open) => {
      const ns = segs(d(a, b));
      for (let s = 1; s <= (open ? ns - 1 : ns); s++) {
        const k = s / ns;
        out.push({ t: 'L', p: [[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]] });
      }
    };
    for (const cm of cmds) {
      if (cm.t === 'M') { cur = start = cm.p[0]; out.push({ t: 'M', p: [[cur[0], cur[1]]] }); }
      else if (cm.t === 'L') { line(cur, cm.p[0]); cur = cm.p[0]; }
      else if (cm.t === 'Q') {
        const [a, e] = cm.p, ns = segs(d(cur, a) + d(a, e));
        for (let s = 1; s <= ns; s++) {
          const k = s / ns, m = 1 - k;
          out.push({ t: 'L', p: [[m * m * cur[0] + 2 * m * k * a[0] + k * k * e[0], m * m * cur[1] + 2 * m * k * a[1] + k * k * e[1]]] });
        }
        cur = e;
      } else if (cm.t === 'C') {
        const [a, b, e] = cm.p, ns = segs(d(cur, a) + d(a, b) + d(b, e));
        for (let s = 1; s <= ns; s++) {
          const k = s / ns, m = 1 - k;
          const w0 = m * m * m, w1 = 3 * m * m * k, w2 = 3 * m * k * k, w3 = k * k * k;
          out.push({ t: 'L', p: [[w0 * cur[0] + w1 * a[0] + w2 * b[0] + w3 * e[0], w0 * cur[1] + w1 * a[1] + w2 * b[1] + w3 * e[1]]] });
        }
        cur = e;
      } else if (cm.t === 'Z') {
        if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) line(cur, start, true);
        out.push({ t: 'Z', p: [] });
        cur = start;
      }
    }
    return out;
  }

  function applyVisible(S, level, c) {
    const list = S.nodes[level], n = list.length;
    for (let j = 0; j < n; j++) {
      const nd = list[j];
      setNode(c.env, nd, j, n, bbox(S, nd.cs));
      if (c.num('show', 1) <= 0) for (const ci of nd.cs) S.hidden[ci] = 1;
    }
  }

  function applyStyle(S, level, c) {
    const list = S.nodes[level], n = list.length;
    const sk = ['fill', 'stroke'].filter(c.has), nk = ['sw', 'opacity', 'draw'].filter(c.has);
    for (let j = 0; j < n; j++) {
      const nd = list[j];
      setNode(c.env, nd, j, n, bbox(S, nd.cs));
      for (const key of sk) { const v = c.str(key); if (v != null) for (const g of nd.gl) S.style[g][key] = v; }
      for (const key of nk) { const v = c.num(key, NaN); if (isFinite(v)) for (const g of nd.gl) S.style[g][key] = v; }
    }
  }

  // ---------- layout: font -> base geometry ----------
  function splitContours(cmds) {
    const out = [];
    let cur = null;
    for (const c of cmds) {
      if (c.type === 'M') { cur = [{ t: 'M', p: [[c.x, c.y]] }]; out.push(cur); }
      else if (!cur) continue;
      else if (c.type === 'L') cur.push({ t: 'L', p: [[c.x, c.y]] });
      else if (c.type === 'Q') cur.push({ t: 'Q', p: [[c.x1, c.y1], [c.x, c.y]] });
      else if (c.type === 'C') cur.push({ t: 'C', p: [[c.x1, c.y1], [c.x2, c.y2], [c.x, c.y]] });
      else if (c.type === 'Z') cur.push({ t: 'Z', p: [] });
    }
    return out;
  }

  const LAYOUT_DEFAULTS = { size: 160, lineHeight: 1.2, letterSpacing: 0, wordSpacing: 0, align: 'left', kerning: true, liga: true };

  function layout(font, text, opts) {
    const o = Object.assign({}, LAYOUT_DEFAULTS, opts);
    const size = +o.size || 160, scale = size / font.unitsPerEm;
    let lookups = null;
    try { lookups = font.position && font.position.defaultKerningTables; } catch (e) { lookups = null; }
    const kern = (a, b) => {
      if (!o.kerning) return 0;
      try { return lookups ? font.position.getKerningValue(lookups, a.index, b.index) : font.getKerningValue(a, b); }
      catch (e) { return 0; }
    };
    const sp = font.charToGlyph(' ');
    const spaceAdv = (sp && sp.advanceWidth ? sp.advanceWidth : font.unitsPerEm * 0.25) * scale;
    const nd = (level, index, extra) => Object.assign({ level, index, cs: [], gl: [], li: 0, wi: 0, gi: 0, ci: 0, ch: 0 }, extra);
    const base = { size, contours: [], nodes: { text: [nd('text', 0)], line: [], word: [], glyph: [], contour: [] } };
    const rootNode = base.nodes.text[0];

    String(text).split('\n').forEach((lt, li) => {
      const line = nd('line', li, { li });
      base.nodes.line.push(line);
      const y = li * size * o.lineHeight;
      let x = 0;
      lt.split(' ').forEach((wt, wj) => {
        if (wj > 0) x += spaceAdv + +o.wordSpacing;
        if (!wt) return;
        const wi = base.nodes.word.length;
        const word = nd('word', wi, { li, wi, text: wt });
        base.nodes.word.push(word);
        const glyphs = font.stringToGlyphs(wt, { features: { liga: !!o.liga, rlig: true } });
        glyphs.forEach((g, j) => {
          const gi = base.nodes.glyph.length;
          const glyph = nd('glyph', gi, { li, wi, gi, ch: g.unicode || 0, name: g.name });
          glyph.gl.push(gi);
          base.nodes.glyph.push(glyph);
          word.gl.push(gi); line.gl.push(gi); rootNode.gl.push(gi);
          for (const cmds of splitContours(g.getPath(x, y, size).commands)) {
            const ci = base.contours.length;
            base.contours.push({ cmds, li, wi, gi, ch: glyph.ch });
            base.nodes.contour.push(nd('contour', ci, { li, wi, gi, ci, ch: glyph.ch, cs: [ci], gl: [gi] }));
            glyph.cs.push(ci); word.cs.push(ci); line.cs.push(ci); rootNode.cs.push(ci);
          }
          x += g.advanceWidth * scale + +o.letterSpacing;
          if (j < glyphs.length - 1) x += kern(g, glyphs[j + 1]) * scale;
        });
      });
      line.width = x;
    });

    if (o.align === 'center' || o.align === 'right') {
      for (const line of base.nodes.line) {
        const off = o.align === 'center' ? -line.width / 2 : -line.width;
        for (const ci of line.cs) for (const k of base.contours[ci].cmds) for (const p of k.p) p[0] += off;
      }
    }
    return base;
  }

  // ---------- evaluate one frame ----------
  function evaluate(base, mods, t) {
    const S = {
      size: base.size,
      nodes: base.nodes,
      contours: base.contours.map(c => ({ li: c.li, wi: c.wi, gi: c.gi, ch: c.ch, cmds: c.cmds.map(k => ({ t: k.t, p: k.p.map(q => [q[0], q[1]]) })) })),
      hidden: new Uint8Array(base.contours.length),
      style: base.nodes.glyph.map(() => ({})),
      errors: {},
      points: 0,
      t,
    };
    for (const m of mods || []) {
      if (!m || m.on === false) continue;
      const def = MODIFIERS[m.type];
      if (!def) continue;
      const level = def.levels.includes(m.level) ? m.level : def.levels[0];
      const c = makeCtx(S, m, def, t);
      try { def.apply(S, level, c); } catch (e) { c.fail('_', e.message); }
    }
    for (const c of S.contours) for (const k of c.cmds) S.points += k.p.length;
    return S;
  }

  // ---------- output ----------
  const f = v => Math.round(v * 100) / 100;

  function glyphPathData(S, gi) {
    let d = '';
    for (const ci of S.nodes.glyph[gi].cs) {
      if (S.hidden[ci]) continue;
      for (const k of S.contours[ci].cmds) {
        d += k.t;
        for (let j = 0; j < k.p.length; j++) d += (j ? ' ' : '') + f(k.p[j][0]) + ' ' + f(k.p[j][1]);
      }
    }
    return d;
  }

  function bounds(S, visibleOnly) {
    const cs = [];
    for (let ci = 0; ci < S.contours.length; ci++) if (!visibleOnly || !S.hidden[ci]) cs.push(ci);
    return bbox(S, cs);
  }

  function styleAttrs(st, defaults) {
    const fill = st.fill != null ? st.fill : defaults.fill;
    let a = ` fill="${esc(fill)}"`;
    if (st.stroke != null) a += ` stroke="${esc(st.stroke)}" stroke-linejoin="round" stroke-linecap="round" stroke-width="${f(st.sw != null ? st.sw : 1)}"`;
    if (st.opacity != null) a += ` opacity="${f(st.opacity)}"`;
    if (st.draw != null) a += ` pathLength="1" stroke-dasharray="${Math.max(0, Math.min(1, st.draw))} 1.0001"`;
    return a;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function toSVG(S, defaults) {
    defaults = Object.assign({ fill: '#000', background: null }, defaults);
    const b = bounds(S, true), pad = S.size * 0.1;
    const vb = [f(b.x - pad), f(b.y - pad), f(b.w + pad * 2), f(b.h + pad * 2)];
    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}">\n`;
    if (defaults.background) out += `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${esc(defaults.background)}"/>\n`;
    S.nodes.glyph.forEach((g, gi) => {
      const d = glyphPathData(S, gi);
      if (d) out += `<path data-glyph="${gi}" d="${d}"${styleAttrs(S.style[gi], defaults)}/>\n`;
    });
    return out + '</svg>\n';
  }

  // Every glyph of a font as SVG path data (units = font units, y down, baseline at 0).
  function fontToJSON(font) {
    const glyphs = [];
    for (let j = 0; j < font.glyphs.length; j++) {
      const g = font.glyphs.get(j);
      glyphs.push({ index: j, name: g.name || null, unicodes: g.unicodes || [], adv: g.advanceWidth || 0, d: g.getPath(0, 0, font.unitsPerEm).toPathData(2) });
    }
    const n = font.names || {};
    const pick = k => n[k] && (n[k].en || Object.values(n[k])[0]) || null;
    return { family: pick('fontFamily'), style: pick('fontSubfamily'), unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, glyphs };
  }

  root.FontLab = { LEVELS, VARS, HELPERS: HN, MODIFIERS, LAYOUT_DEFAULTS, compile, layout, evaluate, bbox, bounds, glyphPathData, styleAttrs, toSVG, fontToJSON };
})(typeof window !== 'undefined' ? window : globalThis);
