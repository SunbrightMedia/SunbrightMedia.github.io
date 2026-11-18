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
  const Shapes = root.FontLabShapes;

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
      label: 'Displace',
      levels: ['point'],
      params: { dx: '0', dy: '0' },
      docs: { dx: 'offset x per point (x, y = point position; ctrl = 1 for curve handles)', dy: 'offset y per point' },
      apply: applyDisplace,
    },
    resample: {
      label: 'Resample',
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

    // ---- spatial modifiers: placed on the stage, act on whatever geometry they touch ----
    warp: {
      label: 'Warp',
      spatial: true,
      subKey: 'shape',
      levels: ['space'],
      params: { shape: 'circle', x: '0', y: '0', size: '60', rot: '0', intensity: '12', falloff: '30', amount: '1' },
      choice: { shape: Shapes.NAMES },
      ui: { size: [2, 600, 1], rot: [-180, 180, 1], intensity: [0, 300, 1], falloff: [0, 300, 1], amount: [0, 1, 0.01] },
      docs: {
        shape: 'shape of the modifier', x: 'centre x (drag the gizmo)', y: 'centre y', size: 'radius', rot: 'rotation (degrees)',
        intensity: 'how far beyond the shape the influence reaches; high values round off corners and points',
        falloff: 'how gradually the push fades: 0 = everything inside snaps to the edge, higher = the script bends smoothly around it',
        amount: '0..1 how far the script is pushed out',
      },
      apply: applyWarp,
    },

  };


  // ---- effects: latched to a script or a group of scripts, drawn per pixel by gl.js ----
  const EFFECTS = {
    heatmap: {
      label: 'Heatmap',
      levels: ['glyph', 'word', 'line', 'text'],
      params: {
        temp: '0.68 + 0.26*noise(i*0.9 + 3, t*0.2)', palette: 'thermal', core: '0.6', spread: '0.12', mottle: '0.35', glow: '0.6',
      },
      choice: { palette: ['thermal', 'iron', 'arctic', 'white hot'] },
      ui: { core: [0, 1, 0.01], spread: [0, 0.5, 0.01], mottle: [0, 1, 0.01], glow: [0, 1, 0.01] },
      docs: {
        temp: 'temperature of each element, 0 = coldest colour, 1 = hottest (an expression per element)',
        palette: 'colour scale', core: 'how much hotter the thick middle of strokes runs', spread: 'how far heat diffuses and glows, relative to the font size',
        mottle: 'drifting blotches of warmer and cooler heat', glow: 'heat halo around the script',
      },
      apply: fxHeatmap,
    },
    // Port of "KamisukiNoise" (shadertoy.com/view/7clyWr): rotated wave kernels in circles,
    // merged with smooth minimums. Fills the script with the pattern, or erodes its edges.
    kamisuki: {
      label: 'Kamisuki noise',
      global: true,
      subKey: 'mode',
      levels: ['text'],
      params: { mode: 'fill', scale: '6', waves: '(sin(t*0.5)*0.5 + 0.5)*3 + 1', rotation: 'PI*(sin(t)*0.5 + 0.5)', radius: '0', gradient: '0', blend: '0.125', sharp: '1', level: '0.5', amount: '1' },
      choice: { mode: ['fill', 'erode'] },
      ui: { scale: [1, 40, 0.1], waves: [0, 8, 0.01], rotation: [0, 6.2832, 0.01], radius: [-1, 1.5, 0.01], gradient: [-1, 1, 0.01], blend: [0, 0.5, 0.005], sharp: [0, 1, 0.01], level: [0, 1.5, 0.01], amount: [0, 2, 0.01] },
      docs: {
        mode: 'fill: the pattern inside the script; erode: the pattern eats into the script from its edges',
        scale: 'kernels per font size', waves: 'waves per kernel (n); animates over time by default, as in the shader demo',
        rotation: 'maximum kernel rotation, radians (a); animates over time by default',
        radius: 'kernel radius (r)', gradient: 'radius change from the left to the right of the script (the demo uses 0.45)',
        blend: 'smooth-minimum blending (k)', sharp: '0 = raw noise, 1 = thresholded', level: 'threshold', amount: 'strength',
      },
      apply: fxKamisuki,
    },
    ascii: {
      label: 'ASCII',
      global: true,
      subKey: 'mode',
      levels: ['text'],
      params: { mode: 'ascii', resolution: '18', pitch: '1', edges: '1', chars: '', gain: '1.2', blur: '0', glow: '0', rain: '0.75', flicker: '1' },
      choice: { mode: ['ascii', 'matrix'] },
      text: ['chars'],
      ui: { resolution: [3, 80, 0.5], pitch: [0.35, 3, 0.01], edges: [0, 2, 0.01], gain: [0, 4, 0.01], blur: [0, 1, 0.01], glow: [0, 1, 0.01], rain: [0, 1, 0.01], flicker: [0, 4, 0.01] },
      docs: {
        mode: 'ascii: keyboard characters chosen by shape and brightness; matrix: mirrored katakana and digits chosen by shape, with falling rain',
        resolution: 'characters per font size: higher = smaller characters',
        pitch: 'spacing between characters, across and down together: 1 = side by side, lower = closer (overlapping), higher = farther apart',
        edges: 'outline characters: where an edge crosses a cell it gets the character shaped like that edge (| through the middle, / or \\ on a diagonal, _ along the bottom, ( ) on curves); 0 = brightness only, higher = fainter edges count too', chars: 'your own characters (leave empty for the mode\'s set; ascii sorts them by ink)',
        gain: 'brightness boost before characters are chosen', blur: 'blurs what is beneath, which then shows through the characters softly and fades out past the edges',
        glow: 'the light that shows through the characters spills out around them, like a glow', rain: 'matrix: falling trails', flicker: 'matrix: how fast characters change',
      },
      apply: fxAscii,
    },
    posterize: {
      label: 'Posterize',
      global: true,
      subKey: 'levels',
      levels: ['text'],
      params: { levels: '4' },
      ui: { levels: [2, 32, 1] },
      docs: { levels: 'colour levels per channel: what is beneath is reduced to this many steps of red, green and blue' },
      apply: fxPosterize,
    },
  };

  function makeCtx(S, m, def, t) {
    const env = { i: 0, n: 1, u: 0, t, x: 0, y: 0, w: 0, h: 0, li: 0, wi: 0, gi: 0, ci: 0, pi: 0, ctrl: 0, k: 0, ch: 0, size: S.size };
    Object.defineProperty(env, '_sizes', { value: S.sizes, enumerable: false });
    const fns = {};
    const strs = def.str || [];
    function fail(key, msg) {
      const e = S.errors[m.id] || (S.errors[m.id] = {});
      if (!e[key]) e[key] = msg;
    }
    for (const key in def.params) {
      if ((def.choice && def.choice[key]) || (def.color && def.color.includes(key)) || (def.text && def.text.includes(key))) continue;
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
      const con = S.contours[ci];
      if (con.attach) continue;
      for (const k of con.cmds) for (const p of k.p) {
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
    if (env._sizes) env.size = env._sizes[nd.si] || env.size;
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
      if (S.sizes) env.size = S.sizes[con.si] || S.size;
      env.n = np; env.w = b.w; env.h = b.h;
      let pi = 0;
      for (const cm of con.cmds) {
        const L = cm.p.length;
        for (let q = 0; q < L; q++) {
          const p = cm.p[q];
          env.i = env.pi = pi; env.u = np > 1 ? pi / (np - 1) : 0;
          env.x = p[0]; env.y = p[1]; env.ctrl = q < L - 1 && cm.t !== 'A' ? 1 : 0; env.k = k;
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

  // Curves and lines become dense line segments. If `near` is given, only segments whose
  // control points pass near(pts) === true are subdivided; the rest are kept as they are.
  function resampleCmds(cmds, step, near) {
    const out = [];
    let cur = null, start = null;
    const segs = len => Math.min(4000, Math.max(1, Math.ceil(len / step)));
    const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const keep = (cm, pts) => near && !near(pts) ? (out.push(cm), true) : false;
    const line = (a, b, open) => {
      const ns = segs(d(a, b));
      for (let s = 1; s <= (open ? ns - 1 : ns); s++) {
        const k = s / ns;
        out.push({ t: 'L', p: [[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]] });
      }
    };
    for (const cm of cmds) {
      if (cm.t === 'M') { cur = start = cm.p[0]; out.push({ t: 'M', p: [[cur[0], cur[1]]] }); }
      else if (cm.t === 'L') { if (!keep(cm, [cur, cm.p[0]])) line(cur, cm.p[0]); cur = cm.p[0]; }
      else if (cm.t === 'Q') {
        if (keep(cm, [cur, cm.p[0], cm.p[1]])) { cur = cm.p[1]; continue; }
        const [a, e] = cm.p, ns = segs(d(cur, a) + d(a, e));
        for (let s = 1; s <= ns; s++) {
          const k = s / ns, m = 1 - k;
          out.push({ t: 'L', p: [[m * m * cur[0] + 2 * m * k * a[0] + k * k * e[0], m * m * cur[1] + 2 * m * k * a[1] + k * k * e[1]]] });
        }
        cur = e;
      } else if (cm.t === 'C') {
        if (keep(cm, [cur, cm.p[0], cm.p[1], cm.p[2]])) { cur = cm.p[2]; continue; }
        const [a, b, e] = cm.p, ns = segs(d(cur, a) + d(a, b) + d(b, e));
        for (let s = 1; s <= ns; s++) {
          const k = s / ns, m = 1 - k;
          const w0 = m * m * m, w1 = 3 * m * m * k, w2 = 3 * m * k * k, w3 = k * k * k;
          out.push({ t: 'L', p: [[w0 * cur[0] + w1 * a[0] + w2 * b[0] + w3 * e[0], w0 * cur[1] + w1 * a[1] + w2 * b[1] + w3 * e[1]]] });
        }
        cur = e;
      } else if (cm.t === 'Z') {
        if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1]) && (!near || near([cur, start]))) line(cur, start, true);
        out.push({ t: 'Z', p: [] });
        cur = start;
      }
    }
    return out;
  }

  // ---------- spatial modifiers ----------
  function spatial(c, m) {
    return {
      shape: Shapes.make(m.params && m.params.shape, c.num('x', 0), c.num('y', 0), Math.max(0.5, c.num('size', 60)), c.num('rot', 0)),
    };
  }

  // Polynomial smooth maximum: max(a, b) with the corner rounded over width k.
  function smax(a, b, k) {
    if (k <= 0) return Math.max(a, b);
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.max(a, b) + h * h * k * 0.25;
  }

  // Warp: every point within reach flows away from the shape until its distance to the shape
  // becomes smax(d, intensity, falloff). Points inside the influence area end up on its edge;
  // with falloff they ease out smoothly instead of stopping at a hard edge.
  //
  // The flow follows a smoothed version of the distance field's gradient: close to the shape
  // it pushes straight away from the nearest edge, and where two edges compete (the middle
  // of a star's arm, the inside of a notch) the directions blend instead of jumping. Flow
  // lines of a smooth field never cross, so outlines never fold or tear. Segments the flow
  // stretches are subdivided, and everything the map leaves empty is clipped as a hole.
  function applyWarp(S, level, c, m) {
    const sh = spatial(c, m).shape;
    const R = Math.max(0, c.num('intensity', 12)), F = Math.max(0, c.num('falloff', 30));
    const A = Math.min(1, Math.max(0, c.num('amount', 1)));
    const fx = { type: 'warp', id: m.id, shape: sh, R, F, A, hole: null };
    S.fx.push(fx);
    if (A <= 0) return;
    const reach = R + F, bound = sh.bound + reach, b2 = bound * bound, cx = sh.cx, cy = sh.cy;
    const target = d => d + A * (smax(d, R, F) - d);

    const hMax = Math.max(0.25, sh.size * 0.09), dir = sh.flow;
    const warp = (px, py) => {
      const ox = px - cx, oy = py - cy;
      if (ox * ox + oy * oy > b2) return [px, py];
      let d = sh.sdf(px, py);
      if (d >= reach) return [px, py];
      const want = target(d);
      if (want - d < 1e-4) return [px, py];
      let x = px, y = py;
      for (let it = 0; it < 400 && d < want - 0.005; it++) {
        const h = Math.min(hMax, want - d); // the field grows at most 1 per unit, so this never overshoots by much
        const a = dir(x, y), b = dir(x + a[0] * h * 0.5, y + a[1] * h * 0.5);
        let nx = x + b[0] * h, ny = y + b[1] * h, dn = sh.sdf(nx, ny);
        if (dn <= d + h * 0.05) { // barely any progress: take an exact gradient step instead
          const g = sh.grad(x, y);
          nx = x + g[0] * h; ny = y + g[1] * h; dn = sh.sdf(nx, ny);
        }
        if (dn > want) { // land exactly on the wanted level
          let lo = 0, hi = 1;
          for (let k = 0; k < 14; k++) { const t = (lo + hi) / 2; if (sh.sdf(x + (nx - x) * t, y + (ny - y) * t) < want) lo = t; else hi = t; }
          nx = x + (nx - x) * hi; ny = y + (ny - y) * hi; dn = want;
        }
        x = nx; y = ny; d = dn;
      }
      return [x, y];
    };

    // Densify outlines where the warp reaches, then warp, splitting any segment it stretches.
    const step = Math.min(3, Math.max(0.4, S.size / 140)), maxLen = step * 1.6;
    const near = pts => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      const dx = Math.max(x0 - cx, 0, cx - x1), dy = Math.max(y0 - cy, 0, cy - y1);
      return dx * dx + dy * dy <= b2;
    };
    for (let ci = 0; ci < S.contours.length; ci++) {
      const con = S.contours[ci];
      if (S.hidden[ci]) continue;
      if (con.attach) { for (const k of con.cmds) for (const p of k.p) { const w = warp(p[0], p[1]); p[0] = w[0]; p[1] = w[1]; } continue; }
      const all = [];
      for (const k of con.cmds) for (const p of k.p) all.push(p);
      if (!all.length || !near(all)) continue;
      const cmds = resampleCmds(con.cmds, step, near), out = [];
      let aO = null, aW = null, sO = null, sW = null;
      const emit = (pO, pW, qO, qW, depth) => {
        if (depth < 7 && Math.hypot(qW[0] - pW[0], qW[1] - pW[1]) > maxLen) {
          const mO = [(pO[0] + qO[0]) / 2, (pO[1] + qO[1]) / 2], mW = warp(mO[0], mO[1]);
          emit(pO, pW, mO, mW, depth + 1); emit(mO, mW, qO, qW, depth + 1);
        } else out.push({ t: 'L', p: [qW] });
      };
      for (const cm of cmds) {
        if (cm.t === 'M') { sO = aO = cm.p[0]; sW = aW = warp(aO[0], aO[1]); out.push({ t: 'M', p: [aW] }); }
        else if (cm.t === 'L') { const qO = cm.p[0], qW = warp(qO[0], qO[1]); emit(aO, aW, qO, qW, 0); aO = qO; aW = qW; }
        else if (cm.t === 'Z') { if (aO && sO && (aO[0] !== sO[0] || aO[1] !== sO[1])) { emit(aO, aW, sO, sW, 0); out.pop(); } out.push(cm); aO = sO; aW = sW; }
        else { // curves the warp cannot reach stay curves
          out.push(cm); const e = cm.p[cm.p.length - 1]; aO = e; aW = [e[0], e[1]];
        }
      }
      con.cmds = out;
    }

    // Nothing maps closer to the shape than target(deepest point): that area becomes a hole.
    const d0 = sh.sdf(cx, cy), m0 = target(d0);
    if (m0 > d0 + 1e-6) {
      fx.hole = Shapes.levelPolygon(sh, m0, 120);
      if (fx.hole) S.holes.push(fx.hole);
    }
  }

  // ---------- effects ----------
  // owner: { scripts: [script index], set, glyphs: [glyph index], size }. Each returns a record for gl.js.

  // Heatmap: per-element temperatures (0..1) for the owner's glyphs; the per-pixel work happens in gl.js.
  function fxHeatmap(S, owner, c, e) {
    const def = EFFECTS.heatmap, level = def.levels.includes(e.level) ? e.level : def.levels[0];
    const list = S.nodes[level].filter(nd => owner.set.has(nd.si)), n = list.length;
    const temps = new Float32Array(S.nodes.glyph.length).fill(NaN);
    for (let j = 0; j < n; j++) {
      const nd = list[j];
      setNode(c.env, nd, j, n, bbox(S, nd.cs));
      const v = Math.min(1, Math.max(0, c.num('temp', 0.5)));
      for (const g of nd.gl) temps[g] = v;
    }
    const k = (key, d) => Math.min(1, Math.max(0, c.num(key, d)));
    const p = e.params || {};
    return {
      temps, palette: def.choice.palette.includes(p.palette) ? p.palette : def.params.palette,
      core: k('core', 0.6), spread: Math.min(0.5, Math.max(0, c.num('spread', 0.12))), mottle: k('mottle', 0.35), glow: k('glow', 0.6),
    };
  }

  function fxKamisuki(S, owner, c, e) {
    const p = e.params || {}, def = EFFECTS.kamisuki;
    const cs = [];
    for (const g of owner.glyphs) for (const ci of S.nodes.glyph[g].cs) if (!S.hidden[ci]) cs.push(ci);
    const b = bbox(S, cs);
    return {
      mode: def.choice.mode.includes(p.mode) ? p.mode : 'fill',
      scale: Math.max(0.01, c.num('scale', 6)), waves: c.num('waves', 2), rotation: c.num('rotation', 1.6), radius: c.num('radius', 0),
      gradient: c.num('gradient', 0), blend: Math.max(0, c.num('blend', 0.125)), sharp: Math.min(1, Math.max(0, c.num('sharp', 1))),
      level: c.num('level', 0.5), amount: c.num('amount', 1), cx: b.cx, hw: Math.max(b.w / 2, 1),
    };
  }

  function fxAscii(S, owner, c, e) {
    const p = e.params || {}, def = EFFECTS.ascii, k = (key, d) => Math.min(1, Math.max(0, c.num(key, d)));
    return {
      mode: def.choice.mode.includes(p.mode) ? p.mode : 'ascii', chars: typeof p.chars === 'string' ? p.chars : '',
      resolution: Math.max(0.5, c.num('resolution', 18)), pitch: Math.min(3, Math.max(0.34, c.num('pitch', 1))), edges: Math.max(0, c.num('edges', 1)), gain: Math.max(0, c.num('gain', 1.2)),
      blur: k('blur', 0), glow: k('glow', 0), rain: k('rain', 0.75), flicker: Math.max(0, c.num('flicker', 1)),
    };
  }

  function fxPosterize(S, owner, c) {
    return { levels: Math.max(2, Math.min(256, Math.round(c.num('levels', 4)))) };
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
      const line = nd('line', li, { li, text: lt });
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

  // Several scripts in one scene: each laid out on its own (see layout), then merged with
  // its position. Every node and contour gets si, the index of its script; nodes.text has
  // one node per script.
  // list: [{ base: layout(...) or null, x, y }]
  function mergeLayouts(list) {
    const out = { size: 160, sizes: [], contours: [], nodes: { text: [], line: [], word: [], glyph: [], contour: [] } };
    list.forEach((it, si) => {
      const b = it.base, dx = +it.x || 0, dy = +it.y || 0;
      const co = out.contours.length, go = out.nodes.glyph.length, wo = out.nodes.word.length, lo = out.nodes.line.length;
      const shift = (n, level) => Object.assign({}, n, {
        index: out.nodes[level].length, si, cs: n.cs.map(i => i + co), gl: n.gl.map(i => i + go),
        li: n.li + lo, wi: n.wi + wo, gi: n.gi + go, ci: n.ci + co,
      });
      if (!b) {
        out.nodes.text.push({ level: 'text', index: si, si, cs: [], gl: [], li: lo, wi: wo, gi: go, ci: co, ch: 0 });
        out.sizes.push(160);
        return;
      }
      for (const c of b.contours) out.contours.push({ si, li: c.li + lo, wi: c.wi + wo, gi: c.gi + go, ch: c.ch, cmds: c.cmds.map(k => ({ t: k.t, p: k.p.map(q => [q[0] + dx, q[1] + dy]) })) });
      for (const level of ['line', 'word', 'glyph', 'contour']) for (const n of b.nodes[level]) out.nodes[level].push(shift(n, level));
      out.nodes.text.push(Object.assign(shift(b.nodes.text[0], 'text'), { index: si }));
      out.sizes.push(b.size);
    });
    out.size = out.sizes[0] || 160;
    return out;
  }

  // ---------- evaluate one frame ----------
  function evaluate(base, mods, t) {
    const S = {
      size: base.size,
      sizes: base.sizes || null,
      nodes: base.nodes,
      contours: base.contours.map(c => ({ attach: c.attach, si: c.si || 0, li: c.li, wi: c.wi, gi: c.gi, ch: c.ch, cmds: c.cmds.map(k => ({ t: k.t, p: k.p.map(q => [q[0], q[1]]) })) })),
      hidden: new Uint8Array(base.contours.length),
      style: base.nodes.glyph.map(() => ({})),
      errors: {},
      fx: [],       // spatial modifiers that ran, for gizmos and masks
      holes: [],    // polygons the warp emptied
      points: 0,
      t,
    };
    for (const m of mods || []) {
      if (!m || m.on === false) continue;
      const def = MODIFIERS[m.type];
      if (!def) continue;
      const level = def.levels.includes(m.level) ? m.level : def.levels[0];
      const c = makeCtx(S, m, def, t);
      try { def.apply(S, level, c, m); } catch (e) { c.fail('_', e.message); }
    }
    for (const c of S.contours) if (!c.attach) for (const k of c.cmds) S.points += k.p.length;
    return S;
  }

  // Effects of each owner (a script or a group of scripts), after the modifiers have run.
  // owners: [{ key, scripts: [script index], effects: [...] }]; errors land in S.errors by effect id.
  function evaluateEffects(S, owners, t) {
    return owners.map(ow => {
      const set = new Set(ow.scripts), glyphs = [];
      S.nodes.glyph.forEach((g, gi) => { if (set.has(g.si)) glyphs.push(gi); });
      const size = (S.sizes && S.sizes[ow.scripts[0]]) || S.size;
      const owner = { scripts: ow.scripts, set, glyphs, size }, records = [];
      for (const e of ow.effects || []) {
        if (!e || e.on === false) continue;
        const def = EFFECTS[e.type];
        if (!def) continue;
        const c = makeCtx(S, e, def, t);
        c.env.size = size;
        try { const r = def.apply(S, owner, c, e); if (r) records.push(Object.assign(r, { id: e.id, type: e.type })); }
        catch (err) { c.fail('_', err.message); }
      }
      return { key: ow.key, scripts: ow.scripts, glyphs, size, records };
    });
  }

  // ---------- output ----------
  const f = v => Math.round(v * 100) / 100;

  function glyphPathData(S, gi) {
    let d = '';
    for (const ci of S.nodes.glyph[gi].cs) {
      if (S.hidden[ci] || S.contours[ci].attach) continue;
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

  // The drawable frame as SVG markup: the glyphs, with warp holes cut out.
  // o: { fill, region: [x, y, w, h] the area masks must cover, id: unique prefix }
  function frameMarkup(S, o) {
    const p = o.id || 'fl', reg = o.region.map(f);
    const rect = `x="${reg[0]}" y="${reg[1]}" width="${reg[2]}" height="${reg[3]}"`;
    let glyphs = '';
    S.nodes.glyph.forEach((g, gi) => {
      const d = glyphPathData(S, gi);
      if (d) glyphs += `<path d="${d}"${styleAttrs(S.style[gi], o.fills ? { fill: o.fills[gi] || o.fill } : o)}/>`;
    });
    if (!S.holes.length) return `<g>${glyphs}</g>`;
    return `<defs><mask id="${p}-holes" maskUnits="userSpaceOnUse" ${rect}><rect ${rect} fill="#fff"/>`
      + `<path fill="#000" d="${S.holes.map(Shapes.polyD).join('')}"/></mask></defs><g mask="url(#${p}-holes)">${glyphs}</g>`;
  }

  function toSVG(S, defaults) {
    defaults = Object.assign({ fill: '#fff', background: '#000', viewBox: null, width: null, height: null }, defaults);
    let vb = defaults.viewBox;
    if (!vb) { const b = bounds(S, true), pad = S.size * 0.1; vb = [b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2]; }
    vb = vb.map(f);
    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${defaults.width || vb[2]}" height="${defaults.height || vb[3]}">\n`;
    if (defaults.background) out += `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${esc(defaults.background)}"/>\n`;
    out += frameMarkup(S, { fill: defaults.fill, fills: defaults.fills, region: vb, id: 'fl' }) + '\n';
    return out + '</svg>\n';
  }

  // Attach extra points to a glyph. They are carried through every modifier that moves the
  // glyph (transforms, displace, warp) but are never drawn: surface effects anchor to them.
  function attach(base, gi, pts) {
    const g = base.nodes.glyph[gi], ci = base.contours.length;
    base.contours.push({ attach: true, li: g.li, wi: g.wi, gi, ch: g.ch, cmds: [{ t: 'A', p: pts }] });
    for (const nd of [g, base.nodes.word[g.wi], base.nodes.line[g.li], base.nodes.text[0]]) if (nd) nd.cs.push(ci);
    return ci;
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

  root.FontLab = { LEVELS, VARS, HELPERS: HN, MODIFIERS, EFFECTS, LAYOUT_DEFAULTS, Shapes, compile, layout, mergeLayouts, evaluate, evaluateEffects, attach, bbox, bounds, glyphPathData, styleAttrs, frameMarkup, toSVG, fontToJSON, smax };
})(typeof window !== 'undefined' ? window : globalThis);
