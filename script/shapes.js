/*
 * Signed distance shapes for spatial modifiers.
 *
 * Each unit shape is a signed distance function in local space with y up and a
 * circumradius of about 1: negative inside, positive outside, and |d| is the
 * true distance to the edge. Offsetting the level (d < r) gives the exact
 * rounded "grown" version of the shape, which is what warp intensity uses.
 * Formulas after Inigo Quilez, https://iquilezles.org/articles/distfunctions2d/
 */
(function (root) {
  'use strict';
  const SQ3 = Math.sqrt(3);
  const len = Math.hypot;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

  const box = (x, y, bx, by) => {
    const qx = Math.abs(x) - bx, qy = Math.abs(y) - by;
    return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  };

  const K1X = 0.809016994375, K1Y = -0.587785252292;

  const UNIT = {
    circle: (x, y) => len(x, y) - 1,
    square: (x, y) => box(x, y, 0.8, 0.8),
    triangle: (x, y) => {
      const r = SQ3 / 2;
      let px = Math.abs(x) - r, py = y + r / SQ3;
      if (px + SQ3 * py > 0) { const nx = (px - SQ3 * py) / 2, ny = (-SQ3 * px - py) / 2; px = nx; py = ny; }
      px -= clamp(px, -2 * r, 0);
      return -len(px, py) * sign(py);
    },
    hexagon: (x, y) => {
      const kx = -0.866025404, ky = 0.5, kz = 0.577350269, r = 0.866;
      let px = Math.abs(x), py = Math.abs(y);
      const d = Math.min(kx * px + ky * py, 0);
      px -= 2 * d * kx; py -= 2 * d * ky;
      px -= clamp(px, -kz * r, kz * r); py -= r;
      return len(px, py) * sign(py);
    },
    star: (x, y) => {
      const rf = 0.45;
      let px = Math.abs(x), py = y;
      let d = Math.max(K1X * px + K1Y * py, 0); px -= 2 * d * K1X; py -= 2 * d * K1Y;
      d = Math.max(-K1X * px + K1Y * py, 0); px -= 2 * d * -K1X; py -= 2 * d * K1Y;
      px = Math.abs(px); py -= 1;
      const bax = rf * -K1Y, bay = rf * K1X - 1;
      const h = clamp((px * bax + py * bay) / (bax * bax + bay * bay), 0, 1);
      return len(px - bax * h, py - bay * h) * sign(py * bax - px * bay);
    },
    heart: (x, y) => {
      const k = 1.65;
      const px = Math.abs(x) / k, py = y / k + 0.55;
      let d;
      if (py + px > 1) d = len(px - 0.25, py - 0.75) - Math.SQRT2 / 4;
      else {
        const m = 0.5 * Math.max(px + py, 0);
        d = Math.sqrt(Math.min(px * px + (py - 1) * (py - 1), (px - m) * (px - m) + (py - m) * (py - m))) * sign(px - py);
      }
      return d * k;
    },
    cross: (x, y) => {
      let px = Math.abs(x), py = Math.abs(y);
      if (py > px) { const s = px; px = py; py = s; }
      const bx = 1, by = 0.3, qx = px - bx, qy = py - by, k = Math.max(qy, qx);
      const wx = k > 0 ? qx : by - px, wy = k > 0 ? qy : -k;
      return sign(k) * len(Math.max(wx, 0), Math.max(wy, 0));
    },
    bar: (x, y) => box(x, y, 1, 0.14),
  };
  const NAMES = Object.keys(UNIT);
  const BOUND = 1.2; // every unit shape fits inside this radius

  // Smoothed gradient of a unit shape's distance field (central differences 0.2 apart), the
  // direction the warp pushes things. It depends only on the shape type, so it is computed
  // once on a grid and looked up with bilinear interpolation afterwards.
  const FIELDS = {}, FE = 0.2;
  function unitDir(f, x, y) {
    let gx = f(x + FE, y) - f(x - FE, y), gy = f(x, y + FE) - f(x, y - FE);
    let l = len(gx, gy);
    if (l < 1e-9) { gx = x; gy = y; l = len(gx, gy); if (l < 1e-9) return [1, 0]; }
    return [gx / l, gy / l];
  }
  function flowField(name) {
    if (FIELDS[name]) return FIELDS[name];
    const f = UNIT[name] || UNIT.circle, N = 161, G = 3, cell = (2 * G) / (N - 1);
    const gx = new Float32Array(N * N), gy = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = unitDir(f, -G + i * cell, -G + j * cell);
      gx[j * N + i] = d[0]; gy[j * N + i] = d[1];
    }
    const sample = (x, y) => {
      const fx = (x + G) / cell, fy = (y + G) / cell, i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return unitDir(f, x, y);
      const tx = fx - i, ty = fy - j, k = j * N + i;
      const ax = gx[k] + (gx[k + 1] - gx[k]) * tx, bx = gx[k + N] + (gx[k + N + 1] - gx[k + N]) * tx;
      const ay = gy[k] + (gy[k + 1] - gy[k]) * tx, by = gy[k + N] + (gy[k + N + 1] - gy[k + N]) * tx;
      const vx = ax + (bx - ax) * ty, vy = ay + (by - ay) * ty, l = len(vx, vy);
      return l < 0.2 ? unitDir(f, x, y) : [vx / l, vy / l]; // opposing samples: compute exactly
    };
    return (FIELDS[name] = sample);
  }

  // A placed shape: centre, radius (size), rotation in degrees, clockwise on screen.
  function make(name, cx, cy, size, rotDeg) {
    const f = UNIT[name] || UNIT.circle;
    const s = Math.max(size, 1e-3), a = (rotDeg || 0) * Math.PI / 180;
    const c = Math.cos(a), sn = Math.sin(a);
    const sdf = (x, y) => {
      const dx = (x - cx) / s, dy = (y - cy) / s;
      return f(dx * c + dy * sn, -(-dx * sn + dy * c)) * s;
    };
    const eps = Math.max(s * 1e-3, 1e-3);
    const grad = (x, y) => {
      let gx = sdf(x + eps, y) - sdf(x - eps, y), gy = sdf(x, y + eps) - sdf(x, y - eps);
      let l = len(gx, gy);
      if (l < 1e-9) { gx = x - cx; gy = y - cy; l = len(gx, gy); if (l < 1e-9) return [1, 0]; }
      return [gx / l, gy / l];
    };
    const field = flowField(UNIT[name] ? name : 'circle');
    const flow = (x, y) => {
      const dx = (x - cx) / s, dy = (y - cy) / s;
      const g = field(dx * c + dy * sn, -(-dx * sn + dy * c));
      const gyd = -g[1]; // back to y down, then to world rotation
      return [g[0] * c - gyd * sn, g[0] * sn + gyd * c];
    };
    return { name, cx, cy, size: s, rot: rotDeg || 0, sdf, grad, flow, bound: s * BOUND, handle: [cx + s * sn, cy - s * c] };
  }

  // Polygon of the level set sdf = level, by bisection along rays from the centre. Rays are
  // added wherever neighbouring points are more than maxSeg apart, so rounded tips and sharp
  // notches stay smooth at any zoom. Exact for every built-in shape, since they are all
  // star-shaped around their centre.
  function levelPolygon(sh, level, n, maxSeg) {
    n = n || 120;
    maxSeg = maxSeg || Math.max(sh.size * 0.028, 0.25);
    if (sh.sdf(sh.cx, sh.cy) >= level) return null;
    const hiMax = sh.bound + Math.max(level, 0) + 1, TAU = Math.PI * 2;
    const at = a => {
      const dx = Math.cos(a), dy = Math.sin(a);
      let lo = 0, hi = hiMax;
      for (let it = 0; it < 16; it++) {
        const mid = (lo + hi) / 2;
        if (sh.sdf(sh.cx + dx * mid, sh.cy + dy * mid) < level) lo = mid; else hi = mid;
      }
      return [sh.cx + dx * lo, sh.cy + dy * lo];
    };
    let angs = [], pts = [];
    for (let i = 0; i < n; i++) { angs.push((i / n) * TAU); pts.push(at(angs[i])); }
    for (let pass = 0; pass < 6; pass++) {
      const na = [], np = [];
      let added = false;
      for (let i = 0; i < angs.length; i++) {
        const j = (i + 1) % angs.length;
        na.push(angs[i]); np.push(pts[i]);
        if (Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]) > maxSeg) {
          const a = angs[i] + ((j === 0 ? angs[0] + TAU : angs[j]) - angs[i]) / 2;
          na.push(a); np.push(at(a)); added = true;
        }
      }
      angs = na; pts = np;
      if (!added || angs.length > 4000) break;
    }
    return pts;
  }

  function polyD(poly) {
    if (!poly || !poly.length) return '';
    let d = 'M' + poly[0][0].toFixed(2) + ' ' + poly[0][1].toFixed(2);
    for (let i = 1; i < poly.length; i++) d += 'L' + poly[i][0].toFixed(2) + ' ' + poly[i][1].toFixed(2);
    return d + 'Z';
  }

  root.FontLabShapes = { UNIT, NAMES, BOUND, make, levelPolygon, polyD };
})(typeof window !== 'undefined' ? window : globalThis);
