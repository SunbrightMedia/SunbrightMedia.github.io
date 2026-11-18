/*
 * Transitions: animations that make a change of text interesting.
 *   intro / outro  completely new text appearing, or text disappearing
 *   inter          one text changing into a completely different one (none yet)
 *
 * A transition is latched to a script and placed on the timeline: it starts at `start` seconds
 * (the time slider runs from 0 to 20 and the timeline loops there) and lasts `duration`. Its
 * progress runs through an animation curve.
 *
 *   stroke  (intro, outro) the letters are drawn in the way they are probably written, stroke
 *           by stroke (see strokes.js); the outro undraws them
 */
(function (root) {
  'use strict';
  const LOOP = 20;

  // ---------- animation curves: progress 0..1 in, eased progress out ----------
  // cubic-bezier(x1, y1, x2, y2), as in CSS
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = s => ((ax * s + bx) * s + cx) * s, Y = s => ((ay * s + by) * s + cy) * s, dX = s => (3 * ax * s + 2 * bx) * s + cx;
    return x => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let s = x;
      for (let i = 0; i < 8; i++) { const e = X(s) - x, d = dX(s); if (Math.abs(e) < 1e-6) return Y(s); if (Math.abs(d) < 1e-6) break; s -= e / d; }
      let lo = 0, hi = 1; s = x;
      for (let i = 0; i < 30; i++) { const v = X(s); if (Math.abs(v - x) < 1e-6) break; if (v < x) lo = s; else hi = s; s = (lo + hi) / 2; }
      return Y(s);
    };
  }
  const outOf = f => x => 1 - f(1 - x), inOutOf = f => x => (x < 0.5 ? f(2 * x) / 2 : 1 - f(2 - 2 * x) / 2);
  const bounceOut = x => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  };
  const IN = {
    sine: x => 1 - Math.cos((x * Math.PI) / 2),
    quad: x => x * x,
    cubic: x => x * x * x,
    quart: x => x * x * x * x,
    quint: x => x * x * x * x * x,
    expo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
    circ: x => 1 - Math.sqrt(1 - Math.min(1, x * x)),
    back: x => 2.70158 * x * x * x - 1.70158 * x * x,
    elastic: x => (x <= 0 ? 0 : x >= 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * (2 * Math.PI) / 3)),
    bounce: x => 1 - bounceOut(1 - x),
  };
  const CURVES = {
    linear: x => x,
    ease: bezier(0.25, 0.1, 0.25, 1),
    'ease in': bezier(0.42, 0, 1, 1),
    'ease out': bezier(0, 0, 0.58, 1),
    'ease in-out': bezier(0.42, 0, 0.58, 1),
  };
  for (const k in IN) {
    CURVES[k + ' in'] = IN[k];
    CURVES[k + ' out'] = k === 'bounce' ? bounceOut : outOf(IN[k]);
    CURVES[k + ' in-out'] = inOutOf(IN[k]);
  }
  CURVES['steps'] = null; // steps(n), from the bezier field: its first number
  CURVES.custom = null;   // cubic-bezier from the bezier field
  const CURVE_GROUPS = {
    basic: ['linear', 'ease', 'ease in', 'ease out', 'ease in-out'],
    in: Object.keys(IN).map(k => k + ' in'),
    out: Object.keys(IN).map(k => k + ' out'),
    'in-out': Object.keys(IN).map(k => k + ' in-out'),
    other: ['steps', 'custom'],
  };
  const bezCache = new Map();
  // the curve function for a name; custom and steps read their numbers from `numbers` ("x1, y1, x2, y2" / "n")
  function curve(name, numbers) {
    if (name === 'custom') {
      const key = String(numbers);
      if (!bezCache.has(key)) {
        const v = String(numbers || '').split(/[\s,]+/).map(Number).filter(isFinite);
        bezCache.set(key, v.length >= 4 ? bezier(Math.min(1, Math.max(0, v[0])), v[1], Math.min(1, Math.max(0, v[2])), v[3]) : CURVES['ease in-out']);
        if (bezCache.size > 50) bezCache.delete(bezCache.keys().next().value);
      }
      return bezCache.get(key);
    }
    if (name === 'steps') {
      const n = Math.max(1, Math.round(parseFloat(numbers) || 5));
      return x => (x >= 1 ? 1 : Math.floor(Math.max(0, x) * n) / n);
    }
    return CURVES[name] || CURVES.linear;
  }

  // ---------- transitions ----------
  const TRANSITIONS = {
    stroke: {
      label: 'Stroke',
      roles: ['intro', 'outro'],
      params: { role: 'intro', start: '0.3', duration: '3', curve: 'ease in-out', bezier: '0.42, 0, 0.58, 1', stagger: '0.2', order: 'reading', erase: 'reverse', softness: '0.05' },
      choice: { role: ['intro', 'outro'], order: ['reading', 'reverse', 'centre out', 'random'], erase: ['reverse', 'forward'] },
      curve: ['curve'],
      text: ['bezier'],
      only: { erase: { role: 'outro' }, bezier: { curve: ['custom', 'steps'] } },
      ui: { start: [0, LOOP, 0.05], duration: [0.1, 10, 0.05], stagger: [0, 1, 0.01], softness: [0, 1, 0.01] },
      docs: {
        role: 'intro: the text is drawn in; outro: it is undrawn',
        start: 'when it begins, in seconds on the timeline (0 to 20; the timeline loops)',
        duration: 'how long it takes, in seconds, for the whole script',
        curve: 'the pace of each letter: how its pen speeds up and slows down',
        bezier: 'custom: cubic-bezier x1, y1, x2, y2 (as in CSS); steps: the number of steps',
        stagger: '0 = every letter at once, 1 = each letter after the one before',
        order: 'which letters go first',
        erase: 'reverse: the pen runs back over its strokes, last first; forward: the strokes vanish in the order they were drawn',
        softness: 'how soft the front of the pen is',
      },
    },
  };

  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // rank of each of n letters in the order they go
  function ranks(n, order) {
    const idx = [...Array(n).keys()];
    if (order === 'reverse') return idx.map(i => n - 1 - i);
    if (order === 'centre out') return idx.map(i => Math.round(Math.abs(i - (n - 1) / 2) - ((n - 1) / 2 % 1)));
    if (order === 'random') { const o = idx.slice().sort((a, b) => hash(a) - hash(b)), r = []; o.forEach((g, k) => { r[g] = k; }); return r; }
    return idx;
  }

  // What each glyph shows at a time: undefined (all of it), 0 (nothing), or { lo, hi, soft }: the
  // part the pen reaches between moments lo and hi (0..1, see strokes.js), with a soft front of
  // `soft` pixels. scripts: the project's scripts; glyphsOf(si): the glyph indices of script si
  // that have a shape.
  function evaluate(scripts, glyphsOf, time) {
    const tl = ((time % LOOP) + LOOP) % LOOP, out = [];
    let any = false;
    scripts.forEach((sc, si) => {
      const list = (sc.transitions || []).filter(tr => tr && tr.on !== false && TRANSITIONS[tr.type]);
      if (!list.length) return;
      const glyphs = glyphsOf(si), n = glyphs.length;
      if (!n) return;
      const lo = new Float32Array(n), hi = new Float32Array(n).fill(1), soft = new Float32Array(n).fill(1.5);
      for (const tr of list) {
        const def = TRANSITIONS[tr.type], p = Object.assign({}, def.params, tr.params);
        const start = num(p.start, 0), dur = Math.max(0.01, num(p.duration, 1)), P = (tl - start) / dur;
        const intro = p.role !== 'outro';
        if (intro ? P >= 1 : P <= 0) continue;     // done, or not begun: the text as it is
        const stagger = Math.min(1, Math.max(0, num(p.stagger, 0.2))), rk = ranks(n, p.order);
        const steps = Math.max(...rk) || 0, D = 1 / (1 + steps * stagger), ease = curve(p.curve, p.bezier);
        const sw = 1.5 + Math.min(1, Math.max(0, num(p.softness, 0.05))) * 58;
        for (let j = 0; j < n; j++) {
          const g = Math.min(1, Math.max(0, (P - rk[j] * stagger * D) / D));
          const e = g <= 0 ? 0 : g >= 1 ? 1 : ease(g);
          let a = 0, b = 1;
          if (intro) b = g <= 0 ? -1 : e;
          else if (p.erase === 'forward') a = g >= 1 ? 2 : e;
          else b = g >= 1 ? -1 : 1 - e;
          lo[j] = Math.max(lo[j], a); hi[j] = Math.min(hi[j], b); soft[j] = Math.max(soft[j], sw);
        }
      }
      for (let j = 0; j < n; j++) {
        if (lo[j] <= 0 && hi[j] >= 1) continue;
        any = true;
        out[glyphs[j]] = hi[j] <= 0 || lo[j] >= 1 || hi[j] <= lo[j] ? 0 : { lo: lo[j], hi: hi[j], soft: soft[j] };
      }
    });
    return any ? out : null;
  }

  root.FontLabTransitions = { LOOP, CURVES, CURVE_GROUPS, curve, TRANSITIONS, evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
