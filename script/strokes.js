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
 * Finally every pixel gets the moment (0..1) the pen reaches it, on a grid twice as fine
 * (FIELD pixels per analysis pixel): the moment its nearest point on a stroke is drawn, less a
 * lead for a round pen. The pen is as wide as the stroke under it; it starts flat, rounds out
 * along the stroke and squares off again towards its end, so square ends and corners are swept
 * by a straight edge instead of popping in. A transition shows the pixels whose moment has come.
 */
(function (root) {
  'use strict';
  const STROKE_RES = 150, PAD = 6, FIELD = 2;
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
        if (L < Math.max(3, 1.15 * D(j))) { drop(e); end.edges = []; changed = true; }
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
      let pts = e0.pts.slice(), closed = e0.closed;
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
      }
      strokes.push({ pts: smoothPts(pts, 2), closed });
    }
    // lone pixels (a tiny dot)
    for (const n of G.nodes) if (n.type === 'dot') strokes.push({ pts: [[n.x, n.y], [n.x + 0.01, n.y]], closed: false });
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
        pieces.push({ pts: part, closed: false, cutA: true, cutB: true });
      }
    } else {
      let from = 0;
      cuts.forEach((c, k) => { pieces.push({ pts: p.slice(from, c + 1), closed: false, cutA: k > 0, cutB: true }); from = c; });
      pieces.push({ pts: p.slice(from), closed: false, cutA: true, cutB: false });
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
        if (flip) s.pts = p.slice().reverse();
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
    const head = ext(s.pts, s.pts[0]).reverse(), tail = ext(s.pts.slice().reverse(), s.pts[s.pts.length - 1]);
    s.pts = head.concat(s.pts, tail);
    s.headN = head.length; s.tailN = tail.length;
  }

  // The moment the pen reaches each pixel of a grid F times finer than the analysis.
  function field(strokes, dist, w, h, F) {
    const W = w * F, H = h * F, N = W * H, tau = new Float32Array(N);
    const D = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : dist[yi * w + xi]; };
    // timing: the pen moves at a constant pace, with a short lift between strokes
    const lift = strokes.length > 1 ? 0.15 * strokes.reduce((a, s) => a + s.length, 0) / strokes.length : 0;
    let total = 0;
    for (const s of strokes) {
      const p = s.pts;
      s.cum = new Float64Array(p.length);
      for (let i = 1; i < p.length; i++) s.cum[i] = s.cum[i - 1] + len(p[i - 1], p[i]);
      s.len2 = Math.max(s.cum[p.length - 1], 1e-3);
      s.r = p.map(q => Math.max(0.5, D(q[0], q[1])));
      // the carried-on ends run out to the edge, where the distance shrinks: the pen keeps its width there
      const h0 = Math.min(s.headN || 0, p.length - 1), t0 = Math.max(h0, p.length - 1 - (s.tailN || 0));
      for (let i = 0; i < h0; i++) s.r[i] = s.r[h0];
      for (let i = t0 + 1; i < p.length; i++) s.r[i] = s.r[t0];
      s.at = total; total += s.len2 + lift;
    }
    total = Math.max(total - lift, 1e-3);
    for (const s of strokes) { s.t0 = s.at / total; s.t1 = (s.at + s.len2) / total; }
    // every stroke drawn into the grid, each pixel keeping the earliest stroke point on it
    const srcS = new Int32Array(N).fill(-1), srcI = new Int32Array(N), srcT = new Float32Array(N);
    const toF = v => (v + 0.5) * F - 0.5;
    strokes.forEach((s, si) => {
      const p = s.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const ax = toF(p[i][0]), ay = toF(p[i][1]), bx = toF(p[i + 1][0]), by = toF(p[i + 1][1]);
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5));
        for (let k = 0; k <= steps; k++) {
          const u = k / steps, X = Math.round(ax + (bx - ax) * u), Y = Math.round(ay + (by - ay) * u);
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X, T = s.at + s.cum[i] + (s.cum[i + 1] - s.cum[i]) * u;
          if (srcS[j] < 0 || T < srcT[j]) { srcS[j] = si; srcI[j] = i; srcT[j] = T; }
        }
      }
    });
    // Each stroke in turn sweeps its whole width: the pixels it covers first are its own, so where
    // strokes meet (a corner, a junction) the one drawn first takes the shared part.
    const own = new Int32Array(N).fill(-1), ownI = new Int32Array(N);
    strokes.forEach((s, si) => {
      const p = s.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const ax = toF(p[i][0]), ay = toF(p[i][1]), bx = toF(p[i + 1][0]), by = toF(p[i + 1][1]);
        const R = Math.max(s.r[i], s.r[i + 1]) * F * 1.05 + 0.75, steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(0.5, R / 4)));
        for (let k = 0; k <= steps; k++) {
          const u = k / steps, px = ax + (bx - ax) * u, py = ay + (by - ay) * u, rr = (s.r[i] + (s.r[i + 1] - s.r[i]) * u) * F * 1.05 + 0.75;
          const x0 = Math.max(0, Math.floor(px - rr)), x1 = Math.min(W - 1, Math.ceil(px + rr)), y0 = Math.max(0, Math.floor(py - rr)), y1 = Math.min(H - 1, Math.ceil(py + rr));
          for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) {
            const j = Y * W + X;
            if (own[j] >= 0) continue;
            if ((X - px) * (X - px) + (Y - py) * (Y - py) <= rr * rr) { own[j] = si; ownI[j] = i; }
          }
        }
      }
    });
    // anything no stroke swept: the nearest stroke point (down each column, then the lower envelope along each row)
    const INF = 1e20, n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), arg = new Int32Array(n);
    const colD = new Float64Array(N), colR = new Int32Array(N);
    for (let X = 0; X < W; X++) {
      let last = -1;
      for (let Y = 0; Y < H; Y++) { if (srcS[Y * W + X] >= 0) last = Y; colR[Y * W + X] = last; }
      last = -1;
      for (let Y = H - 1; Y >= 0; Y--) {
        const j = Y * W + X;
        if (srcS[j] >= 0) last = Y;
        const up = colR[j];
        let best = -1;
        if (up >= 0) best = up;
        if (last >= 0 && (best < 0 || last - Y < Y - best)) best = last;
        colR[j] = best; colD[j] = best < 0 ? INF : (Y - best) * (Y - best);
      }
    }
    const nearest = new Int32Array(N).fill(-1);
    for (let Y = 0; Y < H; Y++) {
      for (let X = 0; X < W; X++) f[X] = colD[Y * W + X];
      dt1d(f, W, d, v, z, arg);
      for (let X = 0; X < W; X++) { const px = arg[X], r = colR[Y * W + px]; nearest[Y * W + X] = r < 0 ? -1 : r * W + px; }
    }
    // the moment: where the pixel lies along its stroke, less the lead of a round pen
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const j = Y * W + X, src = nearest[j];
      let si, seg;
      if (own[j] >= 0) { si = own[j]; seg = ownI[j]; } else if (src >= 0) { si = srcS[src]; seg = srcI[src]; } else { tau[j] = 1; continue; }
      const s = strokes[si], p = s.pts, cx = (X + 0.5) / F - 0.5, cy = (Y + 0.5) / F - 0.5;
      let bestD = Infinity, arc = 0, r = 1;
      for (let i = Math.max(0, seg - 6); i <= Math.min(p.length - 2, seg + 6); i++) {
        const ax = p[i][0], ay = p[i][1], ex = p[i + 1][0] - ax, ey = p[i + 1][1] - ay, l2 = ex * ex + ey * ey;
        const u = l2 > 0 ? Math.min(1, Math.max(0, ((cx - ax) * ex + (cy - ay) * ey) / l2)) : 0;
        const qx = ax + ex * u - cx, qy = ay + ey * u - cy, dd = qx * qx + qy * qy;
        if (dd < bestD) { bestD = dd; arc = s.cum[i] + (s.cum[i + 1] - s.cum[i]) * u; r = s.r[i] + (s.r[i + 1] - s.r[i]) * u; }
      }
      // round in the middle of a stroke, flat at its ends: square ends are swept, not popped in
      const round = Math.min(1, Math.min(arc, s.len2 - arc) / (2 * r));
      const lead = round * Math.sqrt(Math.max(0, r * r - bestD));
      tau[j] = (s.at + Math.max(0, arc - lead)) / total;
    }
    return { tau, total, W, H };
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
    const fl = area && strokes.length ? field(strokes, dist, w, h, FIELD) : { tau: new Float32Array(w * h * FIELD * FIELD), total: 1, W: w * FIELD, H: h * FIELD };
    const toWorld = p => [x0 + (p[0] + 0.5) / k, y0 + (p[1] + 0.5) / k];
    const out = {
      // tau[j]: the moment (0..1) the pen reaches pixel j of a w x h grid, k pixels per world unit; total: the pen's path in analysis pixels
      w: fl.W, h: fl.H, x: x0, y: y0, k: k * FIELD, tau: fl.tau, total: fl.total,
      strokes: strokes.map(s => ({ pts: s.pts.map(toWorld), closed: s.closed, dot: s.dot, t0: s.t0, t1: s.t1 })),
    };
    cache.set(key, out);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return out;
  }

  // A mask of the glyph's pixels whose moment lies in [lo, hi], soft over `soft` pixels of pen
  // travel, drawn into the given canvas at `m` mask pixels per field pixel. The moments are
  // interpolated before they are cut, so the front stays smooth however large the glyph is drawn.
  function mask(a, lo, hi, soft, canvas, m) {
    const { w, h, tau } = a;
    m = Math.max(1, Math.min(4, m || 1));
    const W = Math.max(1, Math.round(w * m)), H = Math.max(1, Math.round(h * m));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const c2 = canvas.getContext('2d'), img = c2.createImageData(W, H), px = img.data;
    const sw = Math.max(1, soft) / a.total, k = 255 / sw, cut = lo > 0;
    const x0 = new Int32Array(W), fx = new Float32Array(W);
    for (let X = 0; X < W; X++) { const f = Math.min(w - 1, Math.max(0, (X + 0.5) / m - 0.5)), i = Math.min(w - 2, Math.floor(f)); x0[X] = Math.max(0, i); fx[X] = w > 1 ? f - x0[X] : 0; }
    for (let Y = 0; Y < H; Y++) {
      const f = Math.min(h - 1, Math.max(0, (Y + 0.5) / m - 0.5)), j = Math.max(0, Math.min(h - 2, Math.floor(f))), fy = h > 1 ? f - j : 0;
      const r0 = j * w, r1 = Math.min(h - 1, j + 1) * w;
      for (let X = 0; X < W; X++) {
        const i = x0[X], i1 = Math.min(w - 1, i + 1), u = fx[X];
        const top = tau[r0 + i] + (tau[r0 + i1] - tau[r0 + i]) * u, bot = tau[r1 + i] + (tau[r1 + i1] - tau[r1 + i]) * u;
        const T = top + (bot - top) * fy;
        let v = (hi - T) * k + 127.5;
        if (cut) v = Math.min(v, (T - lo) * k + 127.5);
        const o = (Y * W + X) * 4;
        px[o] = px[o + 1] = px[o + 2] = 255;
        px[o + 3] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    c2.putImageData(img, 0, 0);
    return canvas;
  }

  root.FontLabStrokes = { analyze, mask, STROKE_RES };
})(typeof window !== 'undefined' ? window : globalThis);
