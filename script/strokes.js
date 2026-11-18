/*
 * How a glyph is probably drawn.
 *
 * The glyph is rasterised (STROKE_RES pixels per font size) and thinned to its skeleton, the
 * line down the middle of every stroke (Zhang-Suen). The skeleton becomes a graph of ends,
 * junctions and the lines between them; short spurs that thinning leaves in corners are pruned.
 * At every junction the lines that carry on most nearly straight are joined into one stroke, as
 * a pen would go through a crossing (the bar of a T, the two strokes of an X), and the others end
 * there (the arch of an n starting from its stem).
 *
 * Strokes then get a direction and an order, as handwriting does: top to bottom, or left to right
 * when a stroke is mostly level; closed loops start at the top and run anticlockwise, like an o;
 * strokes are drawn top to bottom, then left to right; dots (of i and j) last.
 *
 * Drawing them is vector, as in Hanzi Writer and the after-effects write-on: the pen is a band
 * along each stroke's centre line (smoothed), as wide as the letter there, cut square at its
 * front (or, as an option, rounded in the middle of a stroke); the band is then cut to the
 * glyph's own outline, so every edge is the font's own curve or the pen's, at any size. Free tips and the
 * pieces split at corners are carried straight out to the edge at full width, so square ends and
 * corners are swept, not popped in. The few bits no band covers (serifs, ink traps) are found
 * once and shown as the pen passes them.
 */
(function (root) {
  'use strict';
  const STROKE_RES = 150, PAD = 6;
  const cache = new Map();
  let cv = null, ctx = null;

  // squared Euclidean distance transform (Felzenszwalb & Huttenlocher), 1D pass
  function dt1d(f, n, d, v, z, arg) {
    let k = 0;
    v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) {
        const p = v[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s <= z[k] && k > 0) k--; else break;
      }
      if (s <= z[k]) { k = 0; v[0] = q; z[0] = -1e20; z[1] = 1e20; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + f[p];
      if (arg) arg[q] = p;
    }
  }
  // distance from every inside pixel to the nearest outside one
  function distance(inside, w, h) {
    const INF = 1e20, n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const g = new Float64Array(w * h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = inside[y * w + x] ? INF : 0;
      dt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = g[y * w + x];
      dt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
    }
    return out;
  }

  // Zhang-Suen thinning
  function thin(inside, w, h) {
    const sk = Uint8Array.from(inside), del = [];
    for (let changed = true, guard = 0; changed && guard < 400; guard++) {
      changed = false;
      for (let step = 0; step < 2; step++) {
        del.length = 0;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!sk[i]) continue;
          const p2 = sk[i - w], p3 = sk[i - w + 1], p4 = sk[i + 1], p5 = sk[i + w + 1], p6 = sk[i + w], p7 = sk[i + w - 1], p8 = sk[i - 1], p9 = sk[i - w - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (step === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
          del.push(i);
        }
        for (const i of del) sk[i] = 0;
        if (del.length) changed = true;
      }
    }
    return sk;
  }

  const N8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]; // clockwise from north
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function polyLength(p) { let s = 0; for (let i = 1; i < p.length; i++) s += len(p[i - 1], p[i]); return s; }
  // the point a given distance along a polyline
  function along(p, dist) {
    let s = 0;
    for (let i = 1; i < p.length; i++) {
      const l = len(p[i - 1], p[i]);
      if (s + l >= dist) { const u = l ? (dist - s) / l : 0; return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * u, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * u]; }
      s += l;
    }
    return p[p.length - 1];
  }

  // skeleton -> graph of nodes (ends, junctions) and edges (pixel chains between them)
  function graph(sk, w, h) {
    const nb = i => { const x = i % w, y = (i - x) / w, out = []; for (const [dx, dy] of N8) { const j = (y + dy) * w + x + dx; out.push(sk[j] ? j : -1); } return out; };
    const kind = new Int8Array(w * h); // 1 end, 2 line, 3 junction, 4 lone pixel
    for (let i = 0; i < w * h; i++) {
      if (!sk[i]) continue;
      const n = nb(i);
      let runs = 0, count = 0;
      for (let k = 0; k < 8; k++) { if (n[k] >= 0) count++; if (n[k] < 0 && n[(k + 1) % 8] >= 0) runs++; }
      if (count === 8) runs = 1;
      kind[i] = count === 0 ? 4 : runs >= 3 ? 3 : runs === 1 ? 1 : 2;
    }
    // junction pixels that touch are one node
    const nodeOf = new Int32Array(w * h).fill(-1), nodes = [];
    for (let i = 0; i < w * h; i++) {
      if (!(kind[i] === 1 || kind[i] === 3 || kind[i] === 4) || nodeOf[i] >= 0) continue;
      const id = nodes.length, px = [i], type = kind[i] === 3 ? 'junction' : kind[i] === 4 ? 'dot' : 'end';
      nodeOf[i] = id;
      if (type === 'junction') for (let q = 0; q < px.length; q++) for (const j of nb(px[q])) if (j >= 0 && kind[j] === 3 && nodeOf[j] < 0) { nodeOf[j] = id; px.push(j); }
      let cx = 0, cy = 0;
      for (const j of px) { cx += j % w; cy += Math.floor(j / w); }
      nodes.push({ id, type, px, x: cx / px.length, y: cy / px.length, edges: [] });
    }
    const P = i => [i % w, Math.floor(i / w)];
    const edges = [], used = new Uint8Array(w * h), seenPair = new Set();
    const addEdge = (a, b, pts, closed) => { const e = { id: edges.length, a, b, pts, closed: !!closed }; edges.push(e); nodes[a].edges.push(e); if (b !== a || closed) nodes[b].edges.push(e); return e; };
    // walk from a node pixel through line pixels to the next node (4-neighbours first, so staircases are not skipped)
    const order = [0, 2, 4, 6, 1, 3, 5, 7];
    for (const node of nodes) {
      for (const start of node.px) for (const first of nb(start)) {
        if (first < 0 || nodeOf[first] === node.id) continue;
        if (nodeOf[first] >= 0) { // two nodes side by side
          const key = Math.min(node.id, nodeOf[first]) + ':' + Math.max(node.id, nodeOf[first]);
          if (!seenPair.has(key)) { seenPair.add(key); addEdge(node.id, nodeOf[first], [[node.x, node.y], [nodes[nodeOf[first]].x, nodes[nodeOf[first]].y]]); }
          continue;
        }
        if (used[first]) continue;
        const pts = [[node.x, node.y]];
        let prev = start, cur = first, end = -1;
        for (let guard = 0; guard < w * h; guard++) {
          used[cur] = 1; pts.push(P(cur));
          const n = nb(cur);
          let next = -1;
          for (const k of order) { const j = n[k]; if (j < 0 || j === prev) continue; if (nodeOf[j] >= 0 && (nodeOf[j] !== node.id || pts.length > 3)) { end = nodeOf[j]; break; } }
          if (end >= 0) break;
          for (const k of order) { const j = n[k]; if (j >= 0 && j !== prev && !used[j] && nodeOf[j] < 0) { next = j; break; } }
          if (next < 0) { // ran out: this is an end nobody marked
            const id = nodes.length, q = P(cur);
            nodes.push({ id, type: 'end', px: [cur], x: q[0], y: q[1], edges: [] });
            nodeOf[cur] = id; end = id; pts.pop(); break;
          }
          prev = cur; cur = next;
        }
        if (end < 0) continue;
        pts.push([nodes[end].x, nodes[end].y]);
        addEdge(node.id, end, pts);
      }
    }
    // closed loops with no node at all (an o)
    for (let i = 0; i < w * h; i++) {
      if (!sk[i] || used[i] || nodeOf[i] >= 0) continue;
      const pts = [], start = i;
      let prev = -1, cur = i;
      for (let guard = 0; guard < w * h; guard++) {
        used[cur] = 1; pts.push(P(cur));
        const n = nb(cur);
        let next = -1;
        for (const k of order) { const j = n[k]; if (j >= 0 && j !== prev && !used[j]) { next = j; break; } }
        if (next < 0) break;
        prev = cur; cur = next;
      }
      if (pts.length < 3) continue;
      const q = P(start), id = nodes.length;
      nodes.push({ id, type: 'loop', px: [start], x: q[0], y: q[1], edges: [] });
      pts.push(pts[0].slice());
      addEdge(id, id, pts, true);
    }
    return { nodes, edges };
  }

  // Remove the short spurs thinning leaves in corners; join junctions a short line apart (thinning
  // splits a crossing like the middle of an X into two junctions); then merge the lines through
  // nodes left with two.
  function prune(G, dist, w) {
    const D = n => { let m = 0; for (const i of n.px) m = Math.max(m, dist[i]); return m; };
    const deg = n => n.edges.reduce((k, e) => k + (e.a === n.id) + (e.b === n.id), 0);
    const alive = new Set(G.edges);
    const drop = e => { alive.delete(e); for (const n of [G.nodes[e.a], G.nodes[e.b]]) n.edges = n.edges.filter(x => x !== e); };
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const e of [...alive]) {
        if (!alive.has(e) || e.closed) continue;
        const A = G.nodes[e.a], B = G.nodes[e.b];
        const end = A.type === 'end' && deg(B) >= 3 ? A : B.type === 'end' && deg(A) >= 3 ? B : null;
        if (!end) continue;
        const j = end === A ? B : A, L = polyLength(e.pts);
        if (L >= Math.max(3, 1.15 * D(j))) continue;
        // a short end that carries straight on from another line through the junction is real (the
        // ear of a p's stem above its bowl), not a corner spur: keep it if it is not tiny
        const dirFrom = (f, atNode) => { const p = f.a === j.id && atNode ? f.pts : f.b === j.id ? f.pts.slice().reverse() : f.pts; const q = along(p, Math.min(polyLength(p) * 0.6, Math.max(3, D(j)))); const dx = q[0] - j.x, dy = q[1] - j.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
        const ds = dirFrom(e, true);
        const straight = j.edges.some(f => { if (f === e) return false; const d = dirFrom(f, true); return -(d[0] * ds[0] + d[1] * ds[1]) > 0.85; });
        if (straight && L > Math.max(3, 0.35 * D(j))) continue;
        drop(e); end.edges = []; changed = true;
      }
      for (const e of [...alive]) {
        if (!alive.has(e) || e.closed || e.a === e.b) continue;
        const A = G.nodes[e.a], B = G.nodes[e.b];
        if (A.type !== 'junction' || B.type !== 'junction' || polyLength(e.pts) >= 1.6 * Math.max(D(A), D(B))) continue;
        drop(e);
        for (const f of B.edges) { if (f.a === B.id) f.a = A.id; if (f.b === B.id) f.b = A.id; if (!A.edges.includes(f)) A.edges.push(f); }
        A.px = A.px.concat(B.px); A.x = (A.x + B.x) / 2; A.y = (A.y + B.y) / 2;
        B.edges = []; B.type = 'gone';
        changed = true;
      }
      // a node left with two lines is just a bend; one line, an end
      for (const n of G.nodes) {
        if (n.type === 'junction' && deg(n) === 1) n.type = 'end';
        if (n.type !== 'junction' || deg(n) !== 2) continue;
        if (n.edges.length === 1) { n.edges[0].closed = true; n.type = 'loop'; changed = true; continue; } // a loop on its own
        const [e1, e2] = n.edges;
        const p1 = e1.b === n.id ? e1.pts : e1.pts.slice().reverse(), p2 = e2.a === n.id ? e2.pts : e2.pts.slice().reverse();
        const a = e1.b === n.id ? e1.a : e1.b, b = e2.a === n.id ? e2.b : e2.a;
        drop(e1); drop(e2);
        const e = { id: G.edges.length, a, b, pts: p1.concat(p2.slice(1)), closed: false };
        if (a === b && a === n.id) e.closed = true;
        G.edges.push(e); alive.add(e);
        G.nodes[a].edges.push(e); if (b !== a) G.nodes[b].edges.push(e);
        n.edges = []; n.type = 'gone';
        changed = true;
      }
      if (!changed) break;
    }
    G.edges = [...alive];
    void w;
  }

  // light smoothing of the pixel staircase, ends kept
  function smoothPts(p, rounds) {
    let q = p;
    for (let r = 0; r < rounds; r++) {
      const o = [q[0]];
      for (let i = 1; i < q.length - 1; i++) o.push([(q[i - 1][0] + 2 * q[i][0] + q[i + 1][0]) / 4, (q[i - 1][1] + 2 * q[i][1] + q[i + 1][1]) / 4]);
      if (q.length > 1) o.push(q[q.length - 1]);
      q = o;
    }
    return q;
  }

  // join the lines that carry straight on through each junction into strokes
  function strokesOf(G, dist, w) {
    const D = n => { let m = 1; for (const i of n.px) m = Math.max(m, dist[i]); return m; };
    const ends = new Map(); // node id -> [{ e, atA, dir }]
    for (const e of G.edges) for (const atA of [true, false]) {
      const nid = atA ? e.a : e.b, n = G.nodes[nid];
      if (n.type !== 'junction') continue;
      const p = atA ? e.pts : e.pts.slice().reverse(), L = polyLength(p);
      const q = along(p, Math.min(L * 0.5, Math.max(3, 1.6 * D(n))));
      const dx = q[0] - n.x, dy = q[1] - n.y, l = Math.hypot(dx, dy) || 1;
      if (!ends.has(nid)) ends.set(nid, []);
      ends.get(nid).push({ e, atA, dir: [dx / l, dy / l] });
    }
    const pair = new Map(); // "edgeId:a|b" -> { e, atA }
    const key = (e, atA) => e.id + (atA ? ':a' : ':b');
    for (const list of ends.values()) {
      const cands = [];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const s = -(list[i].dir[0] * list[j].dir[0] + list[i].dir[1] * list[j].dir[1]);
        if (s > 0.64) cands.push([s, list[i], list[j]]);
      }
      cands.sort((a, b) => b[0] - a[0]);
      for (const [, A, B] of cands) {
        if (pair.has(key(A.e, A.atA)) || pair.has(key(B.e, B.atA))) continue;
        pair.set(key(A.e, A.atA), B); pair.set(key(B.e, B.atA), A);
      }
    }
    const usedE = new Set(), strokes = [];
    for (const e0 of G.edges) {
      if (usedE.has(e0)) continue;
      usedE.add(e0);
      let pts = e0.pts.slice(), closed = e0.closed, endA = 'junction', endB = 'junction';
      const joints = []; // the junctions it runs on through: x, y, and their radius
      // what a stroke's end is: a free tip of the glyph, or where it meets others
      const kind = id => (G.nodes[id] && (G.nodes[id].type === 'end' || G.nodes[id].type === 'dot') ? 'free' : 'junction');
      // forwards from b, then backwards from a
      for (const fwd of [true, false]) {
        let e = e0, atA = !fwd;
        for (let guard = 0; guard < 200; guard++) {
          const nx = pair.get(key(e, atA));
          if (!nx) break;
          const J = G.nodes[atA ? e.a : e.b], rJ = D(J);
          joints.push([J.x, J.y, rJ]);
          if (nx.e === e0) { closed = true; break; }
          if (usedE.has(nx.e)) break;
          usedE.add(nx.e);
          // straight on through the junction: the skeleton bends towards a junction's middle, so
          // the points within its radius are left out and the line goes straight across
          const near = q => len(q, [J.x, J.y]) < rJ;
          const trimEnd = p => { let k = p.length; while (k > 2 && near(p[k - 1])) k--; return p.slice(0, k); };
          const trimStart = p => { let k = 0; while (p.length - k > 2 && near(p[k])) k++; return p.slice(k); };
          const seg = nx.atA ? nx.e.pts : nx.e.pts.slice().reverse();
          if (fwd) pts = trimEnd(pts).concat(trimStart(seg));
          else pts = trimEnd(seg.slice().reverse()).concat(trimStart(pts));
          e = nx.e; atA = !nx.atA;
        }
        if (fwd) endB = kind(atA ? e.a : e.b); else endA = kind(atA ? e.a : e.b);
      }
      strokes.push({ pts: smoothPts(pts, 2), closed, endA, endB, joints });
    }
    // lone pixels (a tiny dot)
    for (const n of G.nodes) if (n.type === 'dot') strokes.push({ pts: [[n.x, n.y], [n.x + 0.01, n.y]], closed: false, endA: 'free', endB: 'free' });
    void w;
    return strokes;
  }

  // A hand lifts the pen at sharp corners (the corners of an L, the point of a V): split strokes
  // wherever they turn more than about 70 degrees within a stroke's width.
  function splitCorners(s, width, dist, inside, w, h) {
    const p = s.pts, n = p.length;
    if (n < 5) return [s];
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + len(p[i - 1], p[i]);
    const L = cum[n - 1], d = Math.max(3, width);
    if (L < 3 * d) return [s];
    const at = arc => { // the point at an arc length, wrapping round a closed stroke
      if (s.closed) arc = ((arc % L) + L) % L; else arc = Math.max(0, Math.min(L, arc));
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= arc) lo = mid; else hi = mid; }
      const u = cum[hi] > cum[lo] ? (arc - cum[lo]) / (cum[hi] - cum[lo]) : 0;
      return [p[lo][0] + (p[hi][0] - p[lo][0]) * u, p[lo][1] + (p[hi][1] - p[lo][1]) * u];
    };
    const turnAt = (i, dd) => {
      const a = at(cum[i] - dd), b = at(cum[i] + dd), ax = p[i][0] - a[0], ay = p[i][1] - a[1], bx = b[0] - p[i][0], by = b[1] - p[i][1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      return la < 1e-6 || lb < 1e-6 ? 0 : Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
    };
    // (and the letter is pointed there: its outline runs out past the corner, about 1.4 widths out
    // for a right angle; where it is rounded off, about one, the line was a curve after all, only
    // a thick one, whose middle line bends sharply)
    const pointed = (i, dd) => {
      if (!dist) return true;
      const a = at(cum[i] - dd), b = at(cum[i] + dd), q = p[i];
      let ax = a[0] - q[0], ay = a[1] - q[1], bx = b[0] - q[0], by = b[1] - q[1];
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      let ox = -(ax / la + bx / lb), oy = -(ay / la + by / lb);
      const lo = Math.hypot(ox, oy);
      if (lo < 1e-6) return true;
      ox /= lo; oy /= lo;
      const xi = Math.round(q[0]), yi = Math.round(q[1]), r = xi >= 0 && yi >= 0 && xi < w && yi < h ? Math.max(1, dist[yi * w + xi]) : 1;
      let out = 0;
      for (; out < 3 * r; out += 0.5) { const X = Math.round(q[0] + ox * out), Y = Math.round(q[1] + oy * out); if (X < 0 || Y < 0 || X >= w || Y >= h || !inside[Y * w + X]) break; }
      return out > 1.2 * r;
    };
    // a corner turns sharply within a short way (most of the turn within half the window); a curve,
    // however tight, turns evenly (half the window, half the turn): only corners split a stroke
    const turn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (!s.closed && (cum[i] < d || cum[i] > L - d)) continue;
      // (not where it runs on through a junction: the skeleton bends there towards the junction's
      // middle, and the line was judged to carry straight on through it)
      if (s.joints && s.joints.some(J => len(p[i], J) < 2 * J[2] + 2)) continue;
      const full = turnAt(i, d);
      if (full > 1.22 && turnAt(i, d / 2) > 0.7 * full && pointed(i, d)) turn[i] = full;
    }
    const cand = [...turn.keys()].filter(i => turn[i] > 1.22).sort((a, b) => turn[b] - turn[a]), cuts = [];
    const gap = (i, j) => { const g = Math.abs(cum[i] - cum[j]); return s.closed ? Math.min(g, L - g) : g; };
    for (const i of cand) if (cuts.every(j => gap(i, j) > 2 * d)) cuts.push(i);
    if (!cuts.length) return [s];
    cuts.sort((a, b) => a - b);
    const pieces = [];
    if (s.closed) {
      const q = p.slice(0, -1), m = q.length;
      // the last point of a closed line is its first again
      const cs = [...new Set(cuts.map(c => c % m))].sort((a, b) => a - b);
      cuts.length = 0; cuts.push(...cs);
      for (let k = 0; k < cuts.length; k++) {
        const from = cuts[k], to = cuts[(k + 1) % cuts.length], part = [];
        for (let i = from; ; i = (i + 1) % m) { part.push(q[i]); if (i === to % m && part.length > 1) break; if (part.length > m + 1) break; }
        pieces.push({ pts: part, closed: false, cutA: true, cutB: true, endA: 'corner', endB: 'corner', angA: turn[from], angB: turn[to % m] });
      }
    } else {
      let from = 0;
      cuts.forEach((c, k) => { pieces.push({ pts: p.slice(from, c + 1), closed: false, cutA: k > 0, cutB: true, endA: k > 0 ? 'corner' : s.endA, endB: 'corner', angA: k > 0 ? turn[from] : 0, angB: turn[c] }); from = c; });
      pieces.push({ pts: p.slice(from), closed: false, cutA: true, cutB: false, endA: 'corner', endB: s.endB, angA: turn[from], angB: 0 });
    }
    // each piece keeps the skeleton's own bend through the corner and is then carried on past it
    // (extendEnds), so the two overlap at the corner like a mitre and leave no wedge between them
    return pieces.filter(x => x.pts.length >= 2);
  }
  // drop the first `amount` of a polyline's length (keeping at least two points)
  function trim(p, amount) {
    p = p.filter(Boolean);
    let acc = 0, i = 0;
    while (i < p.length - 2 && acc + len(p[i], p[i + 1]) <= amount) { acc += len(p[i], p[i + 1]); i++; }
    return p.slice(i);
  }

  // direction and order, as handwriting goes
  function arrange(strokes, meanWidth, dist, inside, w, h) {
    strokes = strokes.flatMap(s => splitCorners(s, meanWidth, dist, inside, w, h));
    for (const s of strokes) {
      // a loop that leaves and comes back to the same junction (the bowl of a Q, its tail going
      // on from there) is drawn as a loop, from its top, like an O
      if (!s.closed && s.endA === 'junction' && s.endB === 'junction' && s.pts.length > 8 && len(s.pts[0], s.pts[s.pts.length - 1]) < meanWidth && polyLength(s.pts) > 4 * meanWidth) {
        s.closed = true; s.pts = s.pts.concat([s.pts[0].slice()]);
      }
      const p = s.pts;
      if (s.closed) {
        let top = 0;
        for (let i = 1; i < p.length; i++) if (p[i][1] < p[top][1] - 0.01 || (Math.abs(p[i][1] - p[top][1]) < 0.01 && p[i][0] < p[top][0])) top = i;
        let q = p.slice(0, -1);
        q = q.slice(top).concat(q.slice(0, top));
        q.push(q[0].slice());
        const ahead = q[Math.min(q.length - 1, 4)];
        if (ahead[0] > q[0][0]) q.reverse(); // from the top, go left first: anticlockwise
        s.pts = q;
      } else {
        const a = p[0], b = p[p.length - 1], dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
        const flip = dy >= 0.25 * dx ? b[1] < a[1] : b[0] < a[0]; // from its top, unless it lies about flat: from its left
        if (flip) { s.pts = p.slice().reverse(); [s.endA, s.endB] = [s.endB, s.endA]; [s.angA, s.angB] = [s.angB, s.angA]; }
      }
      s.length = polyLength(s.pts);
      s.dot = s.length < 1.6 * meanWidth && s.endA !== 'junction' && s.endB !== 'junction'; // on its own, like the dot of an i
    }
    // a dot stands clear of every other stroke (a short stroke that touches one is a serif or a bar)
    for (const s of strokes) if (s.dot && strokes.some(o => o !== s && o.pts.some(q => s.pts.some(p => len(p, q) < meanWidth)))) s.dot = false;
    const keyOf = s => { let m = Infinity; for (const p of s.pts) m = Math.min(m, p[1] + 0.3 * p[0]); return m; }; // its top left
    // how steeply it sets off downwards (a stem before the bowl that leaves from the same corner)
    const down = s => { const q = along(s.pts, Math.min(s.length, 2 * meanWidth)), p = s.pts[0], l = len(p, q) || 1; return (q[1] - p[1]) / l; };
    // (strokes starting at about the same height and place form one band of the order; within it,
    // the one setting off most steeply downwards goes first)
    const band = s => Math.round(keyOf(s) / (0.75 * meanWidth));
    for (const s of strokes) { s._band = band(s); s._down = down(s); s._key = keyOf(s); }
    strokes.sort((A, B) => (A.dot - B.dot) || (A._band - B._band) || (B._down - A._down) || (A._key - B._key));
    return strokes;
  }

  // carry an open stroke's ends on to the tips of the shape, so the pen starts and stops there
  // ... until the pen's whole end edge (across the stroke's width) is past the letter's edge, so
  // a square, slanted or rounded tip is covered to its last pixel when the stroke is done
  function extendEnds(s, dist, inside, w, h) {
    if (s.closed || s.pts.length < 2) return;
    const D = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : dist[yi * w + xi]; };
    let viaInto = false;
    const ext = (p, from, corner) => {
      const L = polyLength(p), q = along(p, Math.min(L, 4)), dx = from[0] - q[0], dy = from[1] - q[1], l = Math.hypot(dx, dy);
      if (l < 1e-6) return [];
      const ux = dx / l, uy = dy / l, nx = -uy, ny = ux, r = Math.max(1, D(from[0], from[1])), half = 1.3 * r + 1, out = [];
      const anyInside = (x, y) => {
        for (let t = -half; t <= half; t += 0.5) { const X = Math.round(x + nx * t), Y = Math.round(y + ny * t); if (X >= 0 && Y >= 0 && X < w && Y < h && inside[Y * w + X]) return true; }
        return false;
      };
      // (the outer tip of a corner is about a width away: one that is not out by then is not an
      // outer corner, and the line runs on into the stroke there, as at a junction)
      for (let d = 1; d <= (corner ? 2.5 * r + 4 : 4 * r + 6); d++) {
        const x = from[0] + ux * d, y = from[1] + uy * d;
        out.push([x, y]);
        if (!anyInside(x, y)) { out.push([x + ux * 1.5, y + uy * 1.5]); return out; }
      }
      return corner ? into(p, from) : out;
    };
    // where a stroke meets another, it runs on into it by its own width, so its square end lies
    // inside that stroke instead of leaving a wedge beside it
    function into(p, from) {
      viaInto = true;
      const L = polyLength(p), q = along(p, Math.min(L, 4)), dx = from[0] - q[0], dy = from[1] - q[1], l = Math.hypot(dx, dy);
      if (l < 1e-6) return [];
      const ux = dx / l, uy = dy / l, r = Math.max(1, D(from[0], from[1])), out = [];
      for (let d = 1; d <= 1.2 * r + 1; d++) { const x = from[0] + ux * d, y = from[1] + uy * d; if (D(x, y) < 0.5) break; out.push([x, y]); }
      return out;
    }
    // a corner of about a right angle is carried out to its outer tip (so it is swept, not popped in);
    // a sharp one (the point of a V) is not, or it would spike through the other stroke there: its
    // tip comes with the other stroke
    const out = (e, ang) => e === 'free' || (e === 'corner' && (ang || 0) < 2.0);
    // A stroke that sets off from a junction it comes back through itself (the bowl of a 9,
    // leaving its stem and closing on it again; the crossing of an &) starts where it leaves the
    // junction: it fills the junction as it passes through later, instead of opening with a
    // spiky patch of it.
    if (s.endA === 'junction') {
      const o = s.pts[0], r = Math.max(1, D(o[0], o[1]));
      let sum = 0, back = false;
      for (let i = 1; i < s.pts.length && !back; i++) { sum += len(s.pts[i - 1], s.pts[i]); if (sum > 3 * r && len(s.pts[i], o) < 1.5 * r) back = true; }
      if (back) {
        let k = 0;
        while (k < s.pts.length - 3 && len(s.pts[k], o) < r) k++;
        s.pts = s.pts.slice(k); s.selfStart = true;
      }
    }
    viaInto = false;
    const head = s.selfStart ? [] : (out(s.endA, s.angA) ? ext : into)(s.pts, s.pts[0], s.endA === 'corner').reverse();
    s.headInto = viaInto || !!s.selfStart; viaInto = false;
    const tail = (out(s.endB, s.angB) ? ext : into)(s.pts.slice().reverse(), s.pts[s.pts.length - 1], s.endB === 'corner');
    s.tailInto = viaInto;
    s.pts = head.concat(s.pts, tail);
    s.headN = head.length; s.tailN = tail.length;
    s.headLen = head.length ? polyLength(head.concat([s.pts[head.length]])) : 0;
    s.tailLen = tail.length ? polyLength([s.pts[s.pts.length - tail.length - 1]].concat(tail)) : 0;
  }

  // resample a polyline (and a value per point) to points `step` apart
  function resample(p, vals, step, closed) {
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + len(p[i - 1], p[i]));
    const L = cum[cum.length - 1], n = Math.max(2, Math.round(L / step) + 1), P = [], V = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const at = (k / (n - 1)) * L;
      while (j < p.length - 2 && cum[j + 1] < at) j++;
      const seg = cum[j + 1] - cum[j], u = seg > 0 ? Math.min(1, Math.max(0, (at - cum[j]) / seg)) : 0;
      P.push([p[j][0] + (p[j + 1][0] - p[j][0]) * u, p[j][1] + (p[j + 1][1] - p[j][1]) * u]);
      V.push(vals[j] + (vals[j + 1] - vals[j]) * u);
    }
    void closed;
    return { P, V };
  }
  // Gaussian smoothing of a list of numbers or points (ends held for open lines, wrapped for closed)
  function gauss(arr, sigma, closed, holdEnds) {
    const n = arr.length, R = Math.ceil(sigma * 2.5), kern = [];
    for (let k = -R; k <= R; k++) kern.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
    const isPt = Array.isArray(arr[0]), out = [];
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sw = 0;
      for (let k = -R; k <= R; k++) {
        let j = i + k;
        if (closed) j = ((j % n) + n) % n; else if (j < 0 || j >= n) continue;
        const wk = kern[k + R];
        if (isPt) { sx += arr[j][0] * wk; sy += arr[j][1] * wk; } else sx += arr[j] * wk;
        sw += wk;
      }
      out.push(isPt ? [sx / sw, sy / sw] : sx / sw);
    }
    if (holdEnds && !closed && n > 1) { out[0] = arr[0]; out[n - 1] = arr[n - 1]; }
    return out;
  }

  // The pen for each stroke: its centre line and half-width, smoothed, in world units, and when
  // it is drawn (t0..t1 of the glyph's 0..1).
  function brushes(strokes, dist, inside, w, h, x0, y0, k) {
    const D = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : dist[yi * w + xi]; };
    const out = strokes.map(s => {
      let p = s.pts;
      if (s.closed && p.length > 2 && len(p[0], p[p.length - 1]) > 0.01) p = p.concat([p[0]]);
      const r = p.map(q => Math.max(0.5, D(q[0], q[1])));
      // the carried-on ends run out to the edge, where the distance shrinks: the pen keeps its width there
      const h0 = Math.min(s.headN || 0, p.length - 1), t0 = Math.max(h0, p.length - 1 - (s.tailN || 0));
      for (let i = 0; i < h0; i++) r[i] = r[h0];
      for (let i = t0 + 1; i < p.length; i++) r[i] = r[t0];
      const rs = resample(p, r, 1, s.closed);
      // which points are the stroke's own (only those claim the glyph): not where it runs on into
      // another stroke at a junction (its tips, carried out past the letter's edge, are its own)
      // (nor the part of it inside the stroke it runs into, up to that one's edge: a bowl drawn
      // before its stem stops square at the stem, instead of taking a point of the junction)
      const jH = s.headInto && !s.selfStart && h0 < p.length ? [p[h0], D(p[h0][0], p[h0][1])] : null, jT = s.tailInto && t0 >= 0 ? [p[t0], D(p[t0][0], p[t0][1])] : null;
      const coreFlag = p.map((q, i) => (i < h0 ? (s.headInto ? 0 : 1) : i > t0 ? (s.tailInto ? 0 : 1) : (jH && len(q, jH[0]) < jH[1]) || (jT && len(q, jT[0]) < jT[1]) ? 0 : 1)), core = resample(p, coreFlag, 1, s.closed).V;
      let P = gauss(rs.P, 2, s.closed, true);
      // widths: a running median against pixel noise, then smoothed
      const med = rs.V.map((v, i) => { const win = []; for (let j = Math.max(0, i - 3); j <= Math.min(rs.V.length - 1, i + 3); j++) win.push(rs.V[j]); win.sort((a, b) => a - b); return win[win.length >> 1]; });
      const R = gauss(med, 3, s.closed, false);
      if (s.closed) P[P.length - 1] = P[0].slice();
      // The pen's width on each side, in analysis pixels: measured straight across to the letter's
      // edge, plus a margin, so it never falls short of the edge on a curve, a slanted end or a
      // serif. Where the measure runs on into another stroke (a junction), the stroke's own
      // width there; the pen is widened later to cover all of its region (see widen).
      const n = P.length, RL = new Array(n), RR = new Array(n);
      const across = (q, nx, ny, cap) => { let d = 0; for (; d < cap; d += 0.25) { const x = Math.round(q[0] + nx * d), y = Math.round(q[1] + ny * d); if (x < 0 || y < 0 || x >= w || y >= h || !inside[y * w + x]) break; } return d; };
      const Rs = R.slice().sort((a, b) => a - b), Rmed = Rs[Rs.length >> 1]; // the stroke's typical half-width
      for (let i = 0; i < n; i++) {
        const a0 = P[Math.max(0, i - 1)], a1 = P[Math.min(n - 1, i + 1)], l = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
        const nx = -(a1[1] - a0[1]) / l, ny = (a1[0] - a0[0]) / l, cap = 4 * Math.min(R[i], 1.5 * Rmed) + 3;
        const wide = Math.min(R[i], 1.3 * Rmed) + 1.5, eL = across(P[i], nx, ny, cap), eR = across(P[i], -nx, -ny, cap);
        // (and no more than half as wide again as the stroke: where it crosses another stroke, or
        // itself, the measure runs on along that one, which the pen must not sweep across)
        const most = 1.6 * Math.min(R[i], 1.3 * Rmed) + 2;
        RL[i] = eL < cap ? Math.min(eL + 1.5, most) : wide;
        RR[i] = eR < cap ? Math.min(eR + 1.5, most) : wide;
      }
      // smoothed, so the width cannot jump about from one point to the next; never pulled short
      const sm = arr => {
        const med = arr.map((v, i) => { const win = []; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) win.push(arr[j]); win.sort((a, b) => a - b); return win[win.length >> 1]; });
        const g = gauss(med, 1.5, s.closed, false);
        return g.map((v, i) => Math.max(v, arr[i]));
      };
      const SL = sm(RL), SR = sm(RR);
      const pts = P.map(q => [x0 + (q[0] + 0.5) / k, y0 + (q[1] + 0.5) / k]);
      const hwL = SL.map(v => v / k), hwR = SR.map(v => v / k), hw = hwL.map((v, i) => (v + hwR[i]) / 2);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(pts[i - 1], pts[i]));
      return { pts, hw, hwL, hwR, cum, L: Math.max(cum[cum.length - 1], 1e-6), closed: s.closed, dot: s.dot, ap: P, aR: R, core, headInto: !!s.headInto, tailInto: !!s.tailInto };
    });
    // Short strokes that sprout from a longer one (the wings of a serif, half a crossbar) grow out
    // of it while its pen passes there, from that end outwards, instead of being drawn on their own.
    const avg = b => b.hw.reduce((x, y) => x + y, 0) / b.hw.length;
    for (const b of out) {
      if (b.closed || b.dot || b.L > 5 * avg(b)) continue;
      let best = null;
      for (const p of out) {
        if (p === b || p.attach || p.L <= b.L) continue;
        for (let i = 0; i < p.pts.length; i++) for (const [be, bStart] of [[b.pts[0], true], [b.pts[b.pts.length - 1], false]]) {
          const d = len(p.pts[i], be), bw = bStart ? b.hw[0] : b.hw[b.hw.length - 1];
          if (d < 1.6 * Math.max(p.hw[i], bw) && (!best || d < best.d)) best = { p, i, bStart, d };
        }
      }
      if (!best) continue;
      if (!best.bStart) { // run it from the end that touches the parent
        b.pts.reverse(); const l = b.hwL.slice().reverse(); b.hwL = b.hwR.slice().reverse(); b.hwR = l; b.hw.reverse();
        b.ap.reverse(); b.aR.reverse(); if (b.core) b.core.reverse();
        [b.headInto, b.tailInto] = [b.tailInto, b.headInto];
        b.cum = [0]; for (let i = 1; i < b.pts.length; i++) b.cum.push(b.cum[i - 1] + len(b.pts[i - 1], b.pts[i]));
      }
      b.attach = best;
    }
    // timing: a constant pace, with a short lift between strokes
    const main = out.filter(b => !b.attach);
    const lift = main.length > 1 ? 0.15 * main.reduce((a, b) => a + b.L, 0) / main.length : 0;
    let total = 0;
    for (const b of main) { b.at = total; total += b.L + lift; }
    total = Math.max(total - lift, 1e-6);
    for (const b of main) { b.t0 = b.at / total; b.t1 = (b.at + b.L) / total; }
    for (const b of out) {
      if (!b.attach) continue;
      const p = b.attach.p, span = p.t1 - p.t0, at = p.t0 + (p.cum[b.attach.i] / p.L) * span, part = span * Math.min(0.5, b.L / p.L);
      b.t0 = Math.max(p.t0, Math.min(at, p.t1 - part)); b.t1 = b.t0 + part;
    }
    return out;
  }

  // Each stroke's own region of the glyph. First come, first served: each stroke, in the order they
  // are drawn, claims what lies within its own typical width of its centre line and is not claimed
  // yet (so the bar of a T keeps the whole bar, a stem the whole stem, against strokes that start
  // on them later); whatever no stroke covers (the fillets where strokes meet, corners) goes to the
  // stroke whose edge it is nearest (its distance from the centre line less the half-width there),
  // or, where a later stroke's edge is nearly as near, to that later one: a junction's fillets come
  // with the stroke that arrives there, so the one drawn before keeps a clean edge. The regions
  // tile the glyph, so a pen cut to its region never spills into a neighbour (no barbs at
  // junctions), and when a stroke is done its whole region is shown (nothing is left over). Worked
  // out on a grid twice as fine as the analysis; see shape() for their outlines. (A glyph of one
  // stroke is not cut to its region, but its region still gives the pen's width: see widen.)
  function regions(bands, w, h, x0, y0, k, inside) {
    if (!bands.length || bands.length > 250) return null;
    const F = 2, W = w * F, H = h * F, N = W * H;
    const label = new Uint8Array(N).fill(255), first = new Int16Array(N).fill(-1), score = [], near = [];
    const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), arg = new Int32Array(n);
    const colD = new Float64Array(N), colR = new Int32Array(N), src = new Float32Array(N), srcI = new Int32Array(N), nearI = [];
    // the letter's separate pieces (the dot of an i and its stem): a stroke claims nothing in a
    // piece other than its own, so the stem of an i does not take the bottom of its dot
    const part = new Int32Array(w * h).fill(-1);
    let parts = 0;
    for (let j0 = 0; j0 < w * h; j0++) {
      if (!inside[j0] || part[j0] >= 0) continue;
      const st = [j0]; part[j0] = parts;
      while (st.length) { const j = st.pop(), x = j % w; for (const q of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (q >= 0 && q < w * h && inside[q] && part[q] < 0) { part[q] = parts; st.push(q); } }
      parts++;
    }
    const partAt = (X, Y) => part[Math.floor(Y / F) * w + Math.floor(X / F)];
    const byTime = bands.map((b, bi) => bi).sort((p, q) => bands[p].t0 - bands[q].t0 || p - q);
    byTime.forEach(bi => {
      const b = bands[bi], sc = score[bi] = new Float32Array(N).fill(1e9), ni = nearI[bi] = new Int16Array(N).fill(-1);
      src.fill(-1);
      // its piece of the letter: where most of its own points lie
      const votes = new Map();
      for (let i = 0; i < b.ap.length; i++) { if (b.core && b.core[i] < 0.5) continue; const X = Math.round(b.ap[i][0]), Y = Math.round(b.ap[i][1]); if (X >= 0 && Y >= 0 && X < w && Y < h && part[Y * w + X] >= 0) votes.set(part[Y * w + X], (votes.get(part[Y * w + X]) || 0) + 1); }
      let mine = -1, mv = 0;
      for (const [pp, c] of votes) if (c > mv) { mv = c; mine = pp; }
      // (each stroke's typical width, not the wider measure at a junction, so a stroke does not
      // claim a wedge of the stroke it meets there)
      const P = b.ap, g = q => (q + 0.5) * F - 0.5, Rc = b.aR.filter((r, i) => !b.core || b.core[i] >= 0.5).sort((x, y) => x - y);
      const Rmid = Rc.length ? Rc[Rc.length >> 1] : 1, R = b.aR.map(r => Math.min(r, 1.1 * Rmid));
      near[bi] = Rmid * F; // how much nearer another stroke's edge must be to keep a fillet from it
      // Where it runs into another stroke, it claims nothing past its own end (a square end, not
      // a round one: the stem of a 1 stops flat in its foot instead of leaving a blob in it)
      let ih = -1, it = -1;
      for (let i = 0; i < P.length; i++) if (!b.core || b.core[i] >= 0.5) { if (ih < 0) ih = i; it = i; }
      const endCut = (i, j0, j1) => { if (i < 0 || j0 < 0 || j1 < 0 || j0 >= P.length || j1 >= P.length) return null; const dx = P[j1][0] - P[j0][0], dy = P[j1][1] - P[j0][1], l = Math.hypot(dx, dy) || 1; return [g(P[i][0]), g(P[i][1]), dx / l, dy / l]; };
      const cutH = !b.closed && b.headInto ? endCut(ih, ih, Math.min(it, ih + 3)) : null, cutT = !b.closed && b.tailInto ? endCut(it, it, Math.max(ih, it - 3)) : null;
      const past = (X, Y, i) => { const c = i === ih ? cutH : i === it ? cutT : null; return !!c && (X - c[0]) * c[2] + (Y - c[1]) * c[3] < -0.5; };
      for (let i = 0; i < P.length - 1; i++) {
        if (b.core && (b.core[i] < 0.5 || b.core[i + 1] < 0.5) && b.core.some(c => c >= 0.5)) continue; // carried-on ends claim nothing
        const ax = g(P[i][0]), ay = g(P[i][1]), bx = g(P[i + 1][0]), by = g(P[i + 1][1]);
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5));
        for (let q = 0; q <= steps; q++) {
          const u = q / steps, X = Math.round(ax + (bx - ax) * u), Y = Math.round(ay + (by - ay) * u);
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X, r = (R[i] + (R[i + 1] - R[i]) * u) * F;
          if (r >= src[j]) { src[j] = r; srcI[j] = u < 0.5 ? i : i + 1; }
        }
      }
      // nearest centre line point: down each column, then the lower envelope along each row
      for (let X = 0; X < W; X++) {
        let last = -1;
        for (let Y = 0; Y < H; Y++) { if (src[Y * W + X] >= 0) last = Y; colR[Y * W + X] = last; }
        last = -1;
        for (let Y = H - 1; Y >= 0; Y--) {
          const j = Y * W + X;
          if (src[j] >= 0) last = Y;
          let r = colR[j];
          if (last >= 0 && (r < 0 || last - Y < Y - r)) r = last;
          colR[j] = r; colD[j] = r < 0 ? 1e20 : (Y - r) * (Y - r);
        }
      }
      for (let Y = 0; Y < H; Y++) {
        for (let X = 0; X < W; X++) f[X] = colD[Y * W + X];
        dt1d(f, W, d, v, z, arg);
        for (let X = 0; X < W; X++) {
          const px = arg[X], ry = colR[Y * W + px];
          if (ry < 0) continue;
          const j = Y * W + X, e = Math.sqrt(d[X]) - src[ry * W + px];
          const si = srcI[ry * W + px], pp = partAt(X, Y);
          if (pp >= 0 && mine >= 0 && pp !== mine) continue; // another piece of the letter
          if (e <= 1.25 && first[j] < 0 && !past(X, Y, si)) first[j] = bi;
          sc[j] = e; ni[j] = si;
        }
      }
    });
    for (let j = 0; j < N; j++) {
      if (first[j] >= 0) { label[j] = first[j]; continue; }
      let m = 1e9;
      for (const bi of byTime) m = Math.min(m, score[bi][j]);
      // (the latest whose edge is nearly as near, and close by: a fillet beside it, not a strip
      // along the edge of a stroke drawn before)
      for (const bi of byTime) if (score[bi][j] <= m + 0.25 || (score[bi][j] <= m + near[bi] && score[bi][j] <= 0.6 * near[bi])) label[j] = bi;
    }
    // Outside the letter, each cell goes with the nearest cell inside it, so the gap between two
    // pieces of the letter (an i and its dot) is split between them, and no region, grown a
    // little when it is traced, reaches over the gap into the other piece.
    {
      const q = [], seen = new Uint8Array(N);
      for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) if (inside[Math.floor(Y / F) * w + Math.floor(X / F)]) { const j = Y * W + X; seen[j] = 1; q.push(j); }
      for (let h0 = 0; h0 < q.length; h0++) {
        const j = q[h0], X = j % W;
        for (const r of [X > 0 ? j - 1 : -1, X < W - 1 ? j + 1 : -1, j - W, j + W]) if (r >= 0 && r < N && !seen[r]) { seen[r] = 1; label[r] = label[j]; q.push(r); }
      }
    }
    // How far each stroke's region reaches out on either side of each point of its centre line
    // (within the letter): the pen is made at least that wide there, so that as it passes it
    // covers all of its region, fillets and corners too, not leaving them to show up only when
    // the stroke is done (analysis pixels, b.extL / b.extR beside b.ap).
    bands.forEach(b => { b.extL = new Float32Array(b.ap.length); b.extR = new Float32Array(b.ap.length); });
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const j = Y * W + X, bi = label[j];
      if (bi === 255 || !inside[Math.floor(Y / F) * w + Math.floor(X / F)]) continue;
      const b = bands[bi], i = nearI[bi][j];
      if (i < 0) continue;
      const P = b.ap, m = P.length, a0 = P[Math.max(0, i - 1)], a1 = P[Math.min(m - 1, i + 1)], l = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
      const nx = -(a1[1] - a0[1]) / l, ny = (a1[0] - a0[0]) / l, dx = (X + 0.5) / F - 0.5 - P[i][0], dy = (Y + 0.5) / F - 0.5 - P[i][1];
      const side = dx * nx + dy * ny;
      if (side > 0) b.extL[i] = Math.max(b.extL[i], side); else b.extR[i] = Math.max(b.extR[i], -side);
    }
    return { label, W, H, x0, y0, s: k * F, n: bands.length, shapes: new Map() };
  }

  // The outline of the regions of the strokes in `list` taken together (one shape, so where two of
  // them meet there is no edge to show as a seam), as a path; worked out when first wanted.
  function shape(R, list) {
    const key = list.length === 1 ? list[0] : list.slice().sort((p, q) => p - q).join(',');
    let p = R.shapes.get(key);
    if (!p) {
      const want = new Uint8Array(256);
      for (const bi of list) want[bi] = 1;
      p = trace(R.label, want, R.W, R.H, R.x0, R.y0, R.s);
      R.shapes.set(key, p);
      if (R.shapes.size > 64) R.shapes.delete(R.shapes.keys().next().value);
    }
    return p;
  }

  // The outline of the cells whose label is in `want`, grown by a cell and softened, by marching
  // squares: closed loops, all wound the same way, as one path, in world units (s cells per unit).
  function trace(label, want, W, H, x0, y0, s) {
    const GW = W + 4, GH = H + 4, m = new Float32Array(GW * GH), fld = new Float32Array(GW * GH);
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) if (want[label[Y * W + X]]) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m[(Y + 2 + dy) * GW + X + 2 + dx] = 1; // grown
    }
    for (let Y = 1; Y < GH - 1; Y++) for (let X = 1; X < GW - 1; X++) {
      let t = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) t += m[(Y + dy) * GW + X + dx] * (dx && dy ? 1 : dx || dy ? 2 : 4);
      fld[Y * GW + X] = t / 16;
    }
    const iso = 0.5, at = (X, Y) => fld[Y * GW + X];
    // edge ids: horizontal edge from (X,Y) to (X+1,Y) is Y*GW+X; vertical from (X,Y) to (X,Y+1) is N+Y*GW+X
    const NE = GW * GH, pt = new Map(), next = new Map();
    const P = (id) => {
      if (pt.has(id)) return pt.get(id);
      let X, Y, x, y;
      if (id < NE) { Y = Math.floor(id / GW); X = id % GW; const a = at(X, Y), b = at(X + 1, Y); x = X + (iso - a) / (b - a); y = Y; }
      else { const j = id - NE; Y = Math.floor(j / GW); X = j % GW; const a = at(X, Y), b = at(X, Y + 1); x = X; y = Y + (iso - a) / (b - a); }
      const p = [x0 + (x - 2 + 0.5) / s, y0 + (y - 2 + 0.5) / s]; pt.set(id, p); return p;
    };
    const seg = (a, b) => { next.set(a, b); };
    for (let Y = 0; Y < GH - 1; Y++) for (let X = 0; X < GW - 1; X++) {
      const tl = at(X, Y) > iso, tr = at(X + 1, Y) > iso, br = at(X + 1, Y + 1) > iso, bl = at(X, Y + 1) > iso;
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = Y * GW + X, B = (Y + 1) * GW + X, L = NE + Y * GW + X, Rr = NE + Y * GW + X + 1;
      // segments run with the inside on their left, so loops close consistently
      switch (c) {
        case 1: seg(L, B); break; case 2: seg(B, Rr); break; case 3: seg(L, Rr); break;
        case 4: seg(Rr, T); break; case 6: seg(B, T); break; case 7: seg(L, T); break;
        case 8: seg(T, L); break; case 9: seg(T, B); break; case 11: seg(T, Rr); break;
        case 12: seg(Rr, L); break; case 13: seg(Rr, B); break; case 14: seg(B, L); break;
        case 5: { const mid = (at(X, Y) + at(X + 1, Y) + at(X + 1, Y + 1) + at(X, Y + 1)) / 4; if (mid > iso) { seg(L, T); seg(Rr, B); } else { seg(L, B); seg(Rr, T); } break; }
        case 10: { const mid = (at(X, Y) + at(X + 1, Y) + at(X + 1, Y + 1) + at(X, Y + 1)) / 4; if (mid > iso) { seg(B, L); seg(T, Rr); } else { seg(T, L); seg(B, Rr); } break; }
      }
    }
    const path = new Path2D(), seen = new Set();
    for (const startId of next.keys()) {
      if (seen.has(startId)) continue;
      let id = startId, first = true, guard = 0;
      while (id !== undefined && !seen.has(id) && guard++ < 1e6) {
        seen.add(id); const p = P(id);
        if (first) { path.moveTo(p[0], p[1]); first = false; } else path.lineTo(p[0], p[1]);
        id = next.get(id);
      }
      path.closePath();
    }
    return path;
  }

  // Draw the part of a stroke's pen between arc lengths A and B (world units) with ctx: the band
  // along its centre line, square at both ends; with `round`, a rounded lead ahead of B that is
  // full in the middle of the stroke and gone at its ends (so the pen squares off into an end).
  // Near the far end, each side stops where it leaves the stroke's own region (cL, cR; see
  // frontEnds), so the pen's front turns to lie along the edge it meets instead of leaving a
  // sliver beside it. (with `into`, the shape is added to that path instead)
  function drawBand(ctx, b, A, B, round, fat, into) {
    const { pts, hwL, hwR, cum } = b, n = pts.length;
    if (B - A <= 1e-6 || n < 2) return;
    fat = fat || 0; // a little extra all round (a device pixel or so), so it overlaps what it meets
    if (!b.N) { // the normal at each point of the centre line
      b.N = pts.map((q, i) => {
        const a0 = pts[Math.max(0, i - 1)], a1 = pts[Math.min(n - 1, i + 1)], dx = a1[0] - a0[0], dy = a1[1] - a0[1], l = Math.hypot(dx, dy) || 1;
        return [-dy / l, dx / l];
      });
    }
    const NN = b.N, cL = b.cL || b.L, cR = b.cR || b.L;
    const at = arc => {
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= arc) lo = m; else hi = m; }
      const seg = cum[hi] - cum[lo], u = seg > 0 ? Math.min(1, Math.max(0, (arc - cum[lo]) / seg)) : 0;
      const mix = arr => arr[lo] + (arr[hi] - arr[lo]) * u;
      let nx = NN[lo][0] + (NN[hi][0] - NN[lo][0]) * u, ny = NN[lo][1] + (NN[hi][1] - NN[lo][1]) * u;
      const nl = Math.hypot(nx, ny) || 1;
      return { i: lo, p: [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * u, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * u], n: [nx / nl, ny / nl], wl: mix(hwL), wr: mix(hwR), w: (mix(hwL) + mix(hwR)) / 2 };
    };
    // One side's edge (sgn 1: left, -1: right), at the pen's width on that side of the centre
    // line, from point i0 to the end of the stroke: worked out for all of it at once, so it does
    // not change as the pen goes (and kept, for the whole stroke).
    const whole = (sgn, i0) => {
      const key = sgn > 0 ? 'edgeL' : 'edgeR';
      if (i0 === 0 && b[key] && b[key].fat === fat) return b[key].V;
      const W = sgn > 0 ? hwL : hwR, V = [];
      for (let i = i0; i < n; i++) V.push([pts[i][0] + NN[i][0] * sgn * (W[i] + fat), pts[i][1] + NN[i][1] * sgn * (W[i] + fat)]);
      const m = V.length, back = k => (V[k + 1][0] - V[k][0]) * (pts[i0 + k + 1][0] - pts[i0 + k][0]) + (V[k + 1][1] - V[k][1]) * (pts[i0 + k + 1][1] - pts[i0 + k][1]) < 0;
      // Where it folds back on itself (the inside of a sharp turn), the loop is cut off where the
      // edge crosses itself: every point of the loop is moved to the crossing, so the pen's front
      // pivots there while the line goes round
      for (let k = 0; k < m - 3; k++) {
        let rev = false;
        for (let q = k; q < Math.min(m - 1, k + 96) && !rev; q++) rev = back(q);
        if (!rev) { k += 95; continue; }
        const p0 = V[k], p1 = V[k + 1], minx = Math.min(p0[0], p1[0]), maxx = Math.max(p0[0], p1[0]), miny = Math.min(p0[1], p1[1]), maxy = Math.max(p0[1], p1[1]);
        for (let j = k + 2; j < Math.min(m - 1, k + 96); j++) {
          const c = V[j], d = V[j + 1];
          if (Math.max(c[0], d[0]) < minx || Math.min(c[0], d[0]) > maxx || Math.max(c[1], d[1]) < miny || Math.min(c[1], d[1]) > maxy) continue;
          const rx = p1[0] - p0[0], ry = p1[1] - p0[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((c[0] - p0[0]) * sy - (c[1] - p0[1]) * sx) / den, u = ((c[0] - p0[0]) * ry - (c[1] - p0[1]) * rx) / den;
          if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) {
            const X = [p0[0] + rx * t, p0[1] + ry * t];
            for (let q = k + 1; q <= j; q++) V[q] = X.slice();
            k = j - 1;
            break;
          }
        }
      }
      // and it never runs back over where it has been: on the inside of a tight curve the pen's
      // cross-sections swing round faster than the edge moves on, so its end would go backwards
      // and give up some of what the pen had drawn; instead it waits there (the pen turns about
      // it) until the curve carries it on. So what is drawn only ever grows.
      for (let k = 1; k < m; k++) if ((V[k][0] - V[k - 1][0]) * (pts[i0 + k][0] - pts[i0 + k - 1][0]) + (V[k][1] - V[k - 1][1]) * (pts[i0 + k][1] - pts[i0 + k - 1][1]) < 0) V[k] = V[k - 1].slice();
      if (i0 === 0) b[key] = { fat, V };
      return V;
    };
    // the edge between arcs s0 and s1, its ends pushed out by `fat`
    const edge = (s0, s1, sgn) => {
      const a = at(s0), z = at(Math.max(s0, s1)), V = whole(sgn, a.i), m = V.length;
      // (its ends on the edge's own line between points, so the corners of the pen's front lie
      // just where the edge will run once the pen has passed: nothing bulges out and back)
      const on = (x, arc) => { const k = x.i - a.i, q0 = V[k], q1 = V[Math.min(m - 1, k + 1)], seg = cum[Math.min(n - 1, x.i + 1)] - cum[x.i], u = seg > 0 ? Math.min(1, Math.max(0, (arc - cum[x.i]) / seg)) : 0; return [q0[0] + (q1[0] - q0[0]) * u, q0[1] + (q1[1] - q0[1]) * u]; };
      const Q = [on(a, s0)];
      for (let i = a.i + 1; i <= z.i; i++) Q.push(V[i - a.i]);
      Q.push(on(z, Math.max(s0, s1)));
      if (fat) { // (along the way the pen is going there, so it does not falter where a point falls)
        const mm = Q.length;
        Q[0] = [Q[0][0] - a.n[1] * fat, Q[0][1] + a.n[0] * fat];
        Q[mm - 1] = [Q[mm - 1][0] + z.n[1] * fat, Q[mm - 1][1] - z.n[0] * fat];
      }
      return Q;
    };
    // The band as one outline: the left edge out, the front, the right edge back. (One shape with
    // no part over another: a fill of many overlapping pieces leaves faint dotted seams where the
    // canvas adds up their edges.)
    const BL = Math.min(B, cL), BR = Math.min(B, cR), AL = Math.min(A, cL), AR = Math.min(A, cR);
    if (BL - AL <= 1e-6 && BR - AR <= 1e-6) return;
    const Lq = edge(AL, BL, 1), Rq = edge(AR, BR, -1), path = into || new Path2D();
    path.moveTo(Lq[0][0], Lq[0][1]);
    for (let i = 1; i < Lq.length; i++) path.lineTo(Lq[i][0], Lq[i][1]);
    const z = at(B), lead = round && !b.dot && B < Math.min(cL, cR) ? Math.min(1, Math.min(B, b.L - B) / (2 * z.w)) : 0;
    if (lead > 0.01) { // the round front of the pen: half an ellipse ahead of the end
      const zp = z.p, tx = z.n[1], ty = -z.n[0], nx = z.n[0], ny = z.n[1], rx = lead * z.w, K = 16;
      for (let k = 1; k < K; k++) {
        const th = Math.PI / 2 - (Math.PI * k) / K, c = Math.cos(th), sn = Math.sin(th), side = sn > 0 ? z.wl + fat : z.wr + fat;
        path.lineTo(zp[0] + tx * (rx * c + fat) + nx * side * sn, zp[1] + ty * (rx * c + fat) + ny * side * sn);
      }
    }
    for (let i = Rq.length - 1; i >= 0; i--) path.lineTo(Rq[i][0], Rq[i][1]);
    path.closePath();
    if (!into) ctx.fill(path, 'nonzero');
  }

  // The pen at least as wide as the stroke's region reaches on each side (see regions), plus a
  // margin, spread a little along the line so the edge does not jump about. (A glyph of one
  // stroke is not cut to its region, so there the pen is widened only by about its own width:
  // where the stroke crosses itself, the region near the crossing runs out along the other
  // pass, which the pen must not sweep across early.)
  function widen(bands, k, uncut) {
    for (const b of bands) {
      if (!b.extL || b.dot) continue;
      const Rs = b.aR.slice().sort((p, q) => p - q), cap = uncut ? 1.2 * Rs[Rs.length >> 1] + 1 : Infinity;
      const n = b.pts.length, grow = (ext, hw) => {
        for (let i = 0; i < n; i++) {
          let e = 0;
          for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) e = Math.max(e, Math.min(cap, ext[j]));
          if (e > 0) hw[i] = Math.max(hw[i], (e + 1.5) / k);
        }
      };
      grow(b.extL, b.hwL); grow(b.extR, b.hwR);
      for (let i = 0; i < n; i++) b.hw[i] = (b.hwL[i] + b.hwR[i]) / 2;
      b.N = null;
    }
  }

  // How each stroke's pen meets the far edge of the stroke's own region (where it runs into
  // another stroke at a junction, or the far side of a corner), so its front can turn to lie
  // along that edge instead of leaving a sliver beside it: the front ends up on a line across
  // the stroke (cL on the left edge, cR on the right, as arc lengths) past which nothing of the
  // region lies; each side of the pen goes no further than its end of it, and from Lend (the
  // later of the two) the stroke is done and its whole region shown. At a free end the region
  // runs on past the letter, so the pen runs to its end, square.
  function frontEnds(bands, R) {
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi];
      b.cL = b.cR = b.Lend = b.L;
      if (!R || b.dot || b.closed || b.pts.length < 3) continue;
      const { pts, hwL, hwR, cum } = b, n = pts.length;
      const med = arr => { const v = arr.slice().sort((p, q) => p - q); return v[v.length >> 1]; };
      const typ = med(b.hw), zone = Math.min(b.L / 2, 4 * typ);
      const own = (x, y) => { const X = Math.floor((x - R.x0) * R.s), Y = Math.floor((y - R.y0) * R.s); return X < 0 || Y < 0 || X >= R.W || Y >= R.H || R.label[Y * R.W + X] === bi; };
      // the last arc (near the end) at which the point v across the stroke (+ left) is in the region
      const reach = v => {
        for (let i = n - 1; i >= 0 && b.L - cum[i] <= zone; i--) {
          const a0 = pts[Math.max(0, i - 1)], a1 = pts[Math.min(n - 1, i + 1)], l = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
          if (own(pts[i][0] - (a1[1] - a0[1]) / l * v, pts[i][1] + (a1[0] - a0[0]) / l * v)) return i === n - 1 ? b.L : Math.min(b.L, cum[i + 1]);
        }
        return -1;
      };
      const vs = [-1, -0.67, -0.33, 0, 0.33, 0.67, 1].map(f => f * 0.85 * typ), S = vs.map(reach);
      if (S.some(x => x < 0) || S.every(x => x >= b.L)) continue;
      // the line s = a + k v, sloped as the region's end is, moved on until all of it is behind
      const k = (S[S.length - 1] - S[0]) / (vs[vs.length - 1] - vs[0]);
      let a = -Infinity;
      vs.forEach((v, j) => { a = Math.max(a, S[j] - k * v); });
      const tail = cum.map((c, i) => i).filter(i => b.L - cum[i] <= zone), wl = med(tail.map(i => hwL[i])), wr = med(tail.map(i => hwR[i]));
      const lo = b.L - zone;
      b.cL = Math.min(b.L, Math.max(lo, a + k * wl));
      b.cR = Math.min(b.L, Math.max(lo, a - k * wr));
      b.Lend = Math.max(b.cL, b.cR);
    }
  }

  // the middle of a dot and the radius that covers all of it
  function dotMiddle(b) {
    let x = 0, y = 0;
    for (const p of b.pts) { x += p[0]; y += p[1]; }
    x /= b.pts.length; y /= b.pts.length;
    let r = 0;
    b.pts.forEach((p, i) => { r = Math.max(r, Math.hypot(p[0] - x, p[1] - y) + Math.max(b.hwL[i], b.hwR[i])); });
    return [x, y, r];
  }
  // What the pen has covered when the glyph's moment runs from lo to hi, drawn with ctx (world
  // units); round: the pen's front is rounded in the middle of a stroke (else it is flat, like a
  // broad nib). Each stroke's pen is cut to the stroke's own region; a finished stroke shows its
  // whole region. The finished regions are filled as one shape, and a stroke being drawn is cut to
  // its region and theirs as one shape, so where they meet there is no edge to leave a faint seam.
  function drawReveal(a, lo, hi, ctx, round) {
    const fat = 1.25 / (ctx.getTransform().a || 1); // a device pixel or so
    const regs = a.regions, live = [];
    let done = null;
    a.bands.forEach((b, bi) => {
      if (hi <= b.t0 || lo >= b.t1) return;
      const span = Math.max(1e-9, b.t1 - b.t0);
      const A = lo <= b.t0 ? 0 : Math.min(1, (lo - b.t0) / span) * b.L;
      let B = hi >= b.t1 ? b.L : Math.max(0, (hi - b.t0) / span) * b.L;
      // a loop closes on itself quickly: the last stretch, the gap between where it began and the
      // pen, goes three times as fast, so it does not linger as a crack across the finished ring
      if (b.closed && !b.dot) { const z = b.L - (b.close || (b.close = 2 * b.hw.slice().sort((p, q) => p - q)[b.hw.length >> 1])); if (B > z) B = Math.min(b.L, z + 3 * (B - z)); }
      // (within a few device pixels of its end it is done: the last sliver, the hairline left as
      // a loop closes on itself, is not drawn on its own)
      const end = Math.max(0, (b.Lend || b.L) - 2.5 * fat);
      if (B <= A || A >= end) return;
      if (A <= 0 && B >= end) (done || (done = [])).push(bi);
      else live.push([b, bi, A, B]);
    });
    if (!regs && done) { ctx.fillRect(a.x - 1, a.y - 1, a.w + 2, a.h + 2); return; } // the only stroke, done: the whole glyph
    if (done) ctx.fill(shape(regs, done), 'nonzero');
    for (const [b, bi, A, B] of live) {
      const path = new Path2D();
      if (b.dot) { // a dot is dabbed on: it grows from its middle
        const c = b.mid || (b.mid = dotMiddle(b)), r = c[2] * Math.min(1, (B - A) / b.L) + fat;
        path.moveTo(c[0] + r, c[1]); path.arc(c[0], c[1], r, 0, Math.PI * 2); path.closePath();
      } else drawBand(ctx, b, A, B, !!round && B < b.L, fat, path);
      if (regs) { ctx.save(); ctx.clip(shape(regs, done ? done.concat(bi) : [bi]), 'nonzero'); }
      ctx.fill(path, 'nonzero');
      if (regs) ctx.restore();
    }
  }

  // d: the glyph's path (world units), box: its bounds, size: its font size
  function analyze(d, box, size) {
    const key = d + '\u0000' + size.toFixed(2);
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
    let k = STROKE_RES / Math.max(size, 1e-3);
    if (box.w * k * box.h * k > 600 * 600) k = 600 / Math.max(box.w, box.h);
    const w = Math.max(1, Math.ceil(box.w * k) + 2 * PAD), h = Math.max(1, Math.ceil(box.h * k) + 2 * PAD);
    const x0 = box.x - PAD / k, y0 = box.y - PAD / k;
    if (!cv) { cv = document.createElement('canvas'); ctx = cv.getContext('2d', { willReadFrequently: true }); }
    if (cv.width < w || cv.height < h) { cv.width = Math.max(cv.width, w); cv.height = Math.max(cv.height, h); }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    ctx.fillStyle = '#fff'; ctx.fill(new Path2D(d));
    const img = ctx.getImageData(0, 0, w, h).data, inside = new Uint8Array(w * h);
    let area = 0;
    for (let j = 0; j < w * h; j++) if (img[j * 4 + 3] >= 128) { inside[j] = 1; area++; }
    const dist = distance(inside, w, h);
    const G = graph(thin(inside, w, h), w, h);
    prune(G, dist, w);
    let strokes = strokesOf(G, dist, w).filter(s => s.pts.length >= 2);
    let wsum = 0, wn = 0;
    for (const s of strokes) for (const p of s.pts) { const xi = Math.round(p[0]), yi = Math.round(p[1]); if (xi >= 0 && yi >= 0 && xi < w && yi < h) { wsum += dist[yi * w + xi] * 2; wn++; } }
    const meanWidth = wn ? wsum / wn : 4;
    strokes = arrange(strokes, meanWidth, dist, inside, w, h);
    for (const s of strokes) extendEnds(s, dist, inside, w, h);
    const bands = area ? brushes(strokes, dist, inside, w, h, x0, y0, k) : [];
    let regs = regions(bands, w, h, x0, y0, k, inside);
    if (regs) widen(bands, k, regs.n < 2);
    if (regs && regs.n < 2) regs = null; // one stroke: nothing to cut it to
    frontEnds(bands, regs);
    const out = {
      x: x0, y: y0, w: w / k, h: h / k, // the glyph's box (world units)
      bands, regions: regs, // the pen of each stroke, in order, and their regions of the glyph (see drawReveal)
      strokes: bands.map(b => ({ pts: b.pts, closed: b.closed, dot: b.dot, t0: b.t0, t1: b.t1 })),
    };
    cache.set(key, out);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return out;
  }

  root.FontLabStrokes = { analyze, drawReveal, STROKE_RES };
})(typeof window !== 'undefined' ? window : globalThis);
