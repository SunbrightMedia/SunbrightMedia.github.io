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
      // what a stroke's end is: a free tip of the glyph, or where it meets others
      const kind = id => (G.nodes[id] && (G.nodes[id].type === 'end' || G.nodes[id].type === 'dot') ? 'free' : 'junction');
      // forwards from b, then backwards from a
      for (const fwd of [true, false]) {
        let e = e0, atA = !fwd;
        for (let guard = 0; guard < 200; guard++) {
          const nx = pair.get(key(e, atA));
          if (!nx) break;
          if (nx.e === e0) { closed = true; break; }
          if (usedE.has(nx.e)) break;
          usedE.add(nx.e);
          const seg = nx.atA ? nx.e.pts : nx.e.pts.slice().reverse();
          if (fwd) pts = pts.concat(seg.slice(1)); else pts = seg.slice().reverse().slice(0, -1).concat(pts);
          e = nx.e; atA = !nx.atA;
        }
        if (fwd) endB = kind(atA ? e.a : e.b); else endA = kind(atA ? e.a : e.b);
      }
      strokes.push({ pts: smoothPts(pts, 2), closed, endA, endB });
    }
    // lone pixels (a tiny dot)
    for (const n of G.nodes) if (n.type === 'dot') strokes.push({ pts: [[n.x, n.y], [n.x + 0.01, n.y]], closed: false, endA: 'free', endB: 'free' });
    void w;
    return strokes;
  }

  // A hand lifts the pen at sharp corners (the corners of an L, the point of a V): split strokes
  // wherever they turn more than about 70 degrees within a stroke's width.
  function splitCorners(s, width) {
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
    const turn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (!s.closed && (cum[i] < d || cum[i] > L - d)) continue;
      const a = at(cum[i] - d), b = at(cum[i] + d), ax = p[i][0] - a[0], ay = p[i][1] - a[1], bx = b[0] - p[i][0], by = b[1] - p[i][1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) continue;
      turn[i] = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
    }
    const cand = [...turn.keys()].filter(i => turn[i] > 1.22).sort((a, b) => turn[b] - turn[a]), cuts = [];
    const gap = (i, j) => { const g = Math.abs(cum[i] - cum[j]); return s.closed ? Math.min(g, L - g) : g; };
    for (const i of cand) if (cuts.every(j => gap(i, j) > 2 * d)) cuts.push(i);
    if (!cuts.length) return [s];
    cuts.sort((a, b) => a - b);
    const pieces = [];
    if (s.closed) {
      const q = p.slice(0, -1), m = q.length;
      for (let k = 0; k < cuts.length; k++) {
        const from = cuts[k], to = cuts[(k + 1) % cuts.length], part = [];
        for (let i = from; ; i = (i + 1) % m) { part.push(q[i]); if (i === to % m && part.length > 1) break; if (part.length > m + 1) break; }
        pieces.push({ pts: part, closed: false, cutA: true, cutB: true, endA: 'corner', endB: 'corner' });
      }
    } else {
      let from = 0;
      cuts.forEach((c, k) => { pieces.push({ pts: p.slice(from, c + 1), closed: false, cutA: k > 0, cutB: true, endA: k > 0 ? 'corner' : s.endA, endB: 'corner' }); from = c; });
      pieces.push({ pts: p.slice(from), closed: false, cutA: true, cutB: false, endA: 'corner', endB: s.endB });
    }
    // the skeleton rounds a corner off; cut that bend away, so each piece runs straight into the corner
    for (const x of pieces) {
      if (x.cutA) x.pts = trim(x.pts, d * 0.5);
      if (x.cutB) x.pts = trim(x.pts.slice().reverse(), d * 0.5).reverse();
    }
    return pieces.filter(x => x.pts.length >= 2);
  }
  // drop the first `amount` of a polyline's length (keeping at least two points)
  function trim(p, amount) {
    let acc = 0, i = 0;
    while (i < p.length - 2 && acc + len(p[i], p[i + 1]) <= amount) { acc += len(p[i], p[i + 1]); i++; }
    return p.slice(i);
  }

  // direction and order, as handwriting goes
  function arrange(strokes, meanWidth) {
    strokes = strokes.flatMap(s => splitCorners(s, meanWidth));
    for (const s of strokes) {
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
        const flip = dy >= 0.5 * dx ? b[1] < a[1] : b[0] < a[0];
        if (flip) { s.pts = p.slice().reverse(); [s.endA, s.endB] = [s.endB, s.endA]; }
      }
      s.length = polyLength(s.pts);
      s.dot = s.length < 1.6 * meanWidth;
    }
    const keyOf = s => { let m = Infinity; for (const p of s.pts) m = Math.min(m, p[1] + 0.3 * p[0]); return m; }; // its top left
    strokes.sort((A, B) => (A.dot - B.dot) || keyOf(A) - keyOf(B));
    return strokes;
  }

  // carry an open stroke's ends on to the tips of the shape, so the pen starts and stops there
  function extendEnds(s, dist, w, h) {
    if (s.closed || s.pts.length < 2) return;
    const D = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : dist[yi * w + xi]; };
    const ext = (p, from) => {
      const L = polyLength(p), q = along(p, Math.min(L, 4)), dx = from[0] - q[0], dy = from[1] - q[1], l = Math.hypot(dx, dy);
      if (l < 1e-6) return [];
      const ux = dx / l, uy = dy / l, out = [], reach = 3 * D(from[0], from[1]) + 4;
      for (let d = 1; d <= reach; d++) { const x = from[0] + ux * d, y = from[1] + uy * d; if (D(x, y) < 0.5) break; out.push([x, y]); }
      return out;
    };
    // only free tips and corners: where a stroke meets others it stops at their middle
    const out = e => e === 'free' || e === 'corner';
    const head = out(s.endA) ? ext(s.pts, s.pts[0]).reverse() : [], tail = out(s.endB) ? ext(s.pts.slice().reverse(), s.pts[s.pts.length - 1]) : [];
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
      let P = gauss(rs.P, 2, s.closed, true);
      // widths: a running median against pixel noise, then smoothed
      const med = rs.V.map((v, i) => { const win = []; for (let j = Math.max(0, i - 3); j <= Math.min(rs.V.length - 1, i + 3); j++) win.push(rs.V[j]); win.sort((a, b) => a - b); return win[win.length >> 1]; });
      const R = gauss(med, 3, s.closed, false);
      if (s.closed) P[P.length - 1] = P[0].slice();
      // Near a free tip the pen takes the letter's own width on each side, measured straight across
      // (a serif, a flared or slanted end), so the tip is swept whole as the pen arrives.
      const RL = R.slice(), RR = R.slice(), n = P.length;
      const across = (q, nx, ny, cap) => { let d = 0; for (; d < cap; d += 0.5) { const x = Math.round(q[0] + nx * d), y = Math.round(q[1] + ny * d); if (x < 0 || y < 0 || x >= w || y >= h || !inside[y * w + x]) break; } return d; };
      const cumA = [0];
      for (let i = 1; i < n; i++) cumA.push(cumA[i - 1] + len(P[i - 1], P[i]));
      // the carried-out part of a free tip: as wide as the letter there, up to four times the stroke
      // (a serif, a flared or slanted end), as long as the measure ends at the letter's edge
      const ext = [s.headLen || 0, s.tailLen || 0];
      for (const [free, fromEnd] of [[s.endA === 'free', false], [s.endB === 'free', true]]) {
        if (!free || s.closed) continue;
        const zone = ext[fromEnd ? 1 : 0] + 1;
        for (let i = 0; i < n; i++) {
          const along = fromEnd ? cumA[n - 1] - cumA[i] : cumA[i];
          if (along > zone) continue;
          const a0 = P[Math.max(0, i - 1)], a1 = P[Math.min(n - 1, i + 1)], l = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
          const nx = -(a1[1] - a0[1]) / l, ny = (a1[0] - a0[0]) / l, cap = 4 * R[i];
          const eL = across(P[i], nx, ny, cap), eR = across(P[i], -nx, -ny, cap);
          if (eL < cap) RL[i] = Math.max(RL[i], eL - 0.5);
          if (eR < cap) RR[i] = Math.max(RR[i], eR - 0.5);
        }
      }
      const pts = P.map(q => [x0 + (q[0] + 0.5) / k, y0 + (q[1] + 0.5) / k]);
      const toW = v => (v * 1.08 + 0.8) / k, hwL = RL.map(toW), hwR = RR.map(toW), hw = hwL.map((v, i) => (v + hwR[i]) / 2);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(pts[i - 1], pts[i]));
      return { pts, hw, hwL, hwR, cum, L: Math.max(cum[cum.length - 1], 1e-6), closed: s.closed, dot: s.dot };
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
          const d = len(p.pts[i], be);
          if (d < 1.6 * p.hw[i] && (!best || d < best.d)) best = { p, i, bStart, d };
        }
      }
      if (!best) continue;
      if (!best.bStart) { // run it from the end that touches the parent
        b.pts.reverse(); const l = b.hwL.slice().reverse(); b.hwL = b.hwR.slice().reverse(); b.hwR = l; b.hw.reverse();
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

  // Draw the part of a stroke's pen between arc lengths A and B (world units) with ctx: the band
  // along its centre line, square at both ends; with `round`, a rounded lead ahead of B that is
  // full in the middle of the stroke and gone at its ends (so the pen squares off into an end).
  function drawBand(ctx, b, A, B, round, fat) {
    const { pts, hw, hwL, hwR, cum } = b;
    if (B - A <= 1e-6) return;
    fat = fat || 0; // a little extra, so neighbouring pieces overlap instead of meeting in a faint seam
    const at = arc => {
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= arc) lo = m; else hi = m; }
      const seg = cum[hi] - cum[lo], u = seg > 0 ? Math.min(1, Math.max(0, (arc - cum[lo]) / seg)) : 0;
      const mix = arr => arr[lo] + (arr[hi] - arr[lo]) * u;
      return { i: lo, p: [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * u, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * u], w: mix(hw), wl: mix(hwL), wr: mix(hwR) };
    };
    const a = at(A), z = at(B), P = [a.p], WL = [a.wl], WR = [a.wr];
    const lead = round && !b.dot ? Math.min(1, Math.min(B, b.L - B) / (2 * z.w)) : 0;
    for (let i = a.i + 1; i <= z.i; i++) { P.push(pts[i]); WL.push(hwL[i]); WR.push(hwR[i]); }
    P.push(z.p); WL.push(z.wl); WR.push(z.wr);
    // the ends pushed out by `fat` along the line
    const push = (i, j) => { const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], l = Math.hypot(dx, dy); if (l > 1e-9 && fat) P[i] = [P[i][0] + dx / l * fat, P[i][1] + dy / l * fat]; };
    if (P.length > 1) { push(0, 1); push(P.length - 1, P.length - 2); }
    // One outline whose width follows the stroke smoothly: each segment adds the strip on either
    // side of the centre line between its ends' offset points (shared with the next segment, so
    // there are no gaps), as triangles all wound the same way, so one fill is their union. Where a
    // tight inner curve folds a side back on itself, its triangles turn the other way round: those
    // are left out (the neighbours cover that part), so nothing cancels out into a crack.
    const n = P.length, N = [];
    for (let i = 0; i < n; i++) {
      const a0 = P[Math.max(0, i - 1)], a1 = P[Math.min(n - 1, i + 1)];
      let dx = a1[0] - a0[0], dy = a1[1] - a0[1];
      const l = Math.hypot(dx, dy) || 1;
      N.push([-dy / l, dx / l]);
    }
    const Lp = P.map((q, i) => [q[0] + N[i][0] * (WL[i] + fat), q[1] + N[i][1] * (WL[i] + fat)]);
    const Rp = P.map((q, i) => [q[0] - N[i][0] * (WR[i] + fat), q[1] - N[i][1] * (WR[i] + fat)]);
    const path = new Path2D();
    const tri = (a, b, c) => {
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) return; // folded over: leave it out
      path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]); path.lineTo(c[0], c[1]); path.closePath();
    };
    for (let i = 0; i < n - 1; i++) {
      tri(P[i], P[i + 1], Lp[i + 1]); tri(P[i], Lp[i + 1], Lp[i]);
      tri(P[i], Rp[i], Rp[i + 1]); tri(P[i], Rp[i + 1], P[i + 1]);
    }
    ctx.fill(path, 'nonzero');
    if (lead > 0.01 && n > 1) { // the round front of the pen (whole, so it overlaps the band behind it)
      const q = P[n - 2], dx = z.p[0] - q[0], dy = z.p[1] - q[1];
      ctx.beginPath(); ctx.ellipse(z.p[0], z.p[1], Math.max(1e-6, lead * z.w), z.w + fat, Math.atan2(dy, dx), 0, Math.PI * 2); ctx.fill();
    }
  }

  // what the pen has covered when the glyph's moment runs from lo to hi, drawn with ctx (world units)
  // round: the pen's front is rounded in the middle of a stroke (else it is flat, like a broad nib)
  function drawReveal(a, lo, hi, ctx, round) {
    const fat = 0.75 / (ctx.getTransform().a || 1); // about a device pixel
    for (const b of a.bands) {
      if (hi <= b.t0 || lo >= b.t1) continue;
      const span = Math.max(1e-9, b.t1 - b.t0);
      const A = lo <= b.t0 ? 0 : Math.min(1, (lo - b.t0) / span) * b.L, B = hi >= b.t1 ? b.L : Math.max(0, (hi - b.t0) / span) * b.L;
      if (B > A) drawBand(ctx, b, A, B, !!round && B < b.L, fat);
    }
    for (const r of a.rest) if (r.t <= hi && r.t >= lo) ctx.fill(r.path);
  }

  // A smooth outline of a set of pixels (marching squares over the set, softened), in world units:
  // each cell's piece of the inside, all wound the same way, so one fill is the whole shape.
  function contour(comp, w, h, x0, y0, k) {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const j of comp) { const x = j % w, y = Math.floor(j / w); bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    const gw = bx1 - bx0 + 5, gh = by1 - by0 + 5, ox = bx0 - 2, oy = by0 - 2, m = new Float32Array(gw * gh), f = new Float32Array(gw * gh);
    for (const j of comp) m[(Math.floor(j / w) - oy) * gw + (j % w) - ox] = 1;
    for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) { // a light blur, so the outline is smooth
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += m[(y + dy) * gw + x + dx] * (dx && dy ? 1 : dx || dy ? 2 : 4);
      f[y * gw + x] = s / 16;
    }
    const path = new Path2D(), X = x => x0 + (x + ox + 0.5) / k, Y = y => y0 + (y + oy + 0.5) / k, iso = 0.3;
    for (let y = 0; y < gh - 1; y++) for (let x = 0; x < gw - 1; x++) {
      const c = [[x, y, f[y * gw + x]], [x + 1, y, f[y * gw + x + 1]], [x + 1, y + 1, f[(y + 1) * gw + x + 1]], [x, y + 1, f[(y + 1) * gw + x]]];
      const ins = c.map(q => q[2] >= iso);
      if (!ins.some(Boolean)) continue;
      const pts = [];
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        if (ins[i]) pts.push([a[0], a[1]]);
        if (ins[i] !== ins[(i + 1) % 4]) { const u = (iso - a[2]) / (b[2] - a[2]); pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
      }
      path.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (let i = 1; i < pts.length; i++) path.lineTo(X(pts[i][0]), Y(pts[i][1]));
      path.closePath();
    }
    return path;
  }

  // the bits of the glyph no pen covers, each shown when the pen passes nearest to it
  function leftovers(bands, inside, w, h, x0, y0, k) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    g.fillStyle = g.strokeStyle = '#fff';
    for (const b of bands) drawBand(g, b, 0, b.L, false);
    const img = g.getImageData(0, 0, w, h).data, rest = new Uint8Array(w * h);
    let any = false;
    for (let j = 0; j < w * h; j++) if (inside[j] && img[j * 4 + 3] < 48) { rest[j] = 1; any = true; }
    if (!any) return [];
    // grow them a little so they overlap the bands around them
    const grown = Uint8Array.from(rest);
    for (let pass = 0; pass < 2; pass++) {
      const prev = Uint8Array.from(grown);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const j = y * w + x; if (!prev[j] && (prev[j - 1] || prev[j + 1] || prev[j - w] || prev[j + w])) grown[j] = 1; }
    }
    const seen = new Uint8Array(w * h), out = [];
    for (let j0 = 0; j0 < w * h; j0++) {
      if (!grown[j0] || seen[j0]) continue;
      const comp = [j0];
      seen[j0] = 1;
      for (let q = 0; q < comp.length; q++) {
        const j = comp[q], x = j % w;
        for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (n >= 0 && n < w * h && grown[n] && !seen[n]) { seen[n] = 1; comp.push(n); }
      }

      // when: once the pen has made its last pass over any of it (so none of its edges ever shows
      // against what is still to come), or, if no pen comes near, when the nearest one passes
      let T = -1, nearT = 1, near = Infinity;
      const reach = 3 / k;
      for (const b of bands) for (let i = 0; i < b.pts.length; i += 2) {
        let bd = Infinity;
        for (const j of comp) {
          const d = Math.hypot(b.pts[i][0] - (x0 + ((j % w) + 0.5) / k), b.pts[i][1] - (y0 + (Math.floor(j / w) + 0.5) / k)) - b.hw[i];
          if (d < bd) bd = d;
        }
        const bt = b.t0 + (b.cum[i] / b.L) * (b.t1 - b.t0);
        if (bd <= reach + 0.5 * b.hw[i]) T = Math.max(T, bt);
        if (bd < near) { near = bd; nearT = bt; }
      }
      if (T < 0) T = nearT;
      const path = contour(comp, w, h, x0, y0, k);
      out.push({ path, t: T });
    }
    return out;
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
    strokes = arrange(strokes, meanWidth);
    for (const s of strokes) extendEnds(s, dist, w, h);
    const bands = area ? brushes(strokes, dist, inside, w, h, x0, y0, k) : [];
    const rest = bands.length ? leftovers(bands, inside, w, h, x0, y0, k) : [];
    const out = {
      x: x0, y: y0, w: w / k, h: h / k, // the glyph's box (world units)
      bands, rest, // the pen of each stroke, in order, and the bits no pen covers (see drawReveal)
      strokes: bands.map(b => ({ pts: b.pts, closed: b.closed, dot: b.dot, t0: b.t0, t1: b.t1 })),
    };
    cache.set(key, out);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return out;
  }

  root.FontLabStrokes = { analyze, drawReveal, STROKE_RES };
})(typeof window !== 'undefined' ? window : globalThis);
