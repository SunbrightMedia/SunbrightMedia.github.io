/*
 * Transitions: animations that make a change of text interesting.
 *   intro / outro  completely new text appearing, or text disappearing
 *   inter          one text changing into a completely different one (none yet)
 *
 * A transition is latched to a script and plays when it is triggered (its play button, or when
 * it is added), on the timeline's clock, so pausing or scrubbing pauses or scrubs it too; a
 * script can also loop its intro and outro for previewing. Its progress runs through an
 * animation curve.
 *
 *   stroke  (intro, outro) the letters are drawn in the way they are probably written, stroke
 *           by stroke (see strokes.js); the outro undraws them
 */
(function (root) {
  'use strict';

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
    'ease in': IN.cubic,
    'ease out': outOf(IN.cubic),
    'ease in-out': inOutOf(IN.cubic),
    overshoot: outOf(IN.back),
    bounce: bounceOut,
    custom: null, // cubic-bezier from the bezier field
  };
  const CURVE_LIST = Object.keys(CURVES);
  // a curve name from before the list was cut down, as the nearest one still in it
  function curveName(name) {
    name = String(name || '');
    if (CURVES[name] !== undefined) return name;
    if (/back|elastic/.test(name)) return 'overshoot';
    if (/bounce/.test(name)) return 'bounce';
    if (/in-out/.test(name) || name === 'ease') return 'ease in-out';
    if (/ out$/.test(name)) return 'ease out';
    if (/ in$/.test(name)) return 'ease in';
    if (name === 'steps') return 'linear';
    return 'ease in-out';
  }
  const bezCache = new Map();
  // the curve function for a name; custom reads its cubic-bezier from `numbers` ("x1, y1, x2, y2")
  function curve(name, numbers) {
    name = curveName(name);
    if (name === 'custom') {
      const key = String(numbers);
      if (!bezCache.has(key)) {
        const v = String(numbers || '').split(/[\s,]+/).map(Number).filter(isFinite);
        bezCache.set(key, v.length >= 4 ? bezier(Math.min(1, Math.max(0, v[0])), v[1], Math.min(1, Math.max(0, v[2])), v[3]) : CURVES['ease in-out']);
        if (bezCache.size > 50) bezCache.delete(bezCache.keys().next().value);
      }
      return bezCache.get(key);
    }
    return CURVES[name];
  }

  // ---------- transitions ----------
  const TRANSITIONS = {
    stroke: {
      label: 'Stroke',
      roles: ['intro', 'outro'],
      params: { role: 'intro', duration: '3', curve: 'ease in-out', bezier: '0.42, 0, 0.58, 1', stagger: '0.2', order: 'reading', erase: 'reverse', softness: '0.05' },
      choice: { role: ['intro', 'outro'], order: ['reading', 'reverse', 'centre out', 'random'], erase: ['reverse', 'forward'] },
      curve: ['curve'],
      text: ['bezier'],
      only: { erase: { role: 'outro' }, bezier: { curve: 'custom' } },
      ends: { stagger: ['all at once', 'one by one'] },
      dims: { order: p => (num(p.stagger, 0.2) > 0 ? '' : 'stagger is 0: every letter goes at once, so the order makes no difference') },
      ui: { duration: [0.1, 10, 0.05], stagger: [0, 1, 0.01], softness: [0, 1, 0.01] },
      docs: {
        role: 'intro: the text is drawn in; outro: it is undrawn',
        duration: 'how long it takes, in seconds, for the whole script',
        curve: 'the pace of each letter: how its pen speeds up and slows down',
        bezier: 'cubic-bezier x1, y1, x2, y2, as in CSS',
        stagger: 'how the letters follow each other: 0 = all at once, 1 = each one starts when the one before has finished',
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
  // that have a shape; runs: script id -> { id, t0 } (a transition playing since t0) or
  // { loop: true, t0 } (its intro, a hold, its outro and a pause, over and over).
  const HOLD = 1.2, GAP = 0.8;
  function evaluate(scripts, glyphsOf, time, runs) {
    const out = [];
    let any = false;
    scripts.forEach((sc, si) => {
      const run = runs && runs.get(sc.id);
      if (!run) return;
      const list = (sc.transitions || []).filter(tr => tr && tr.on !== false && TRANSITIONS[tr.type]);
      if (!list.length) return;
      const glyphs = glyphsOf(si), n = glyphs.length;
      if (!n) return;
      const P = tr => Object.assign({}, TRANSITIONS[tr.type].params, tr.params), dur = tr => Math.max(0.05, num(P(tr).duration, 1));
      // which transition, and how far through it (P < 0: not begun; P >= 1: over)
      let tr = null, prog = 0;
      if (run.loop) {
        const intro = list.find(x => P(x).role !== 'outro'), outro = list.find(x => P(x).role === 'outro');
        const dIn = intro ? dur(intro) : 0, dOut = outro ? dur(outro) : 0, period = dIn + HOLD + dOut + GAP;
        const ph = (((time - run.t0) % period) + period) % period;
        if (intro && ph < dIn) { tr = intro; prog = ph / dIn; }
        else if (outro && ph >= dIn + HOLD) { tr = outro; prog = (ph - dIn - HOLD) / dOut; }
        else return;
      } else {
        tr = list.find(x => x.id === run.id);
        if (!tr) return;
        prog = (time - run.t0) / dur(tr);
      }
      const p = P(tr), intro = p.role !== 'outro';
      if (intro ? prog >= 1 : prog <= 0) return;   // done, or not begun: the text as it is
      const stagger = Math.min(1, Math.max(0, num(p.stagger, 0.2))), rk = ranks(n, p.order);
      const steps = Math.max(...rk) || 0, D = 1 / (1 + steps * stagger), ease = curve(p.curve, p.bezier);
      const sw = 1.5 + Math.min(1, Math.max(0, num(p.softness, 0.05))) * 58;
      for (let j = 0; j < n; j++) {
        const g = Math.min(1, Math.max(0, (prog - rk[j] * stagger * D) / D));
        const e = g <= 0 ? 0 : g >= 1 ? 1 : ease(g);
        let lo = 0, hi = 1;
        if (intro) hi = g <= 0 ? -1 : e;
        else if (p.erase === 'forward') lo = g >= 1 ? 2 : e;
        else hi = g >= 1 ? -1 : 1 - e;
        if (lo <= 0 && hi >= 1) continue;
        any = true;
        out[glyphs[j]] = hi <= 0 || lo >= 1 || hi <= lo ? 0 : { lo, hi, soft: sw };
      }
    });
    return any ? out : null;
  }

  root.FontLabTransitions = { CURVES, CURVE_LIST, curve, curveName, TRANSITIONS, evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
