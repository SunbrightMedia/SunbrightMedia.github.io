// 2D geometry in board millimetres (KiCad board coordinates: X right, Y down).
// Polygon booleans use ClipperLib (clipper-lib, Angus Johnson's Clipper, Boost licence).

const CL = () => globalThis.ClipperLib;
export const SCALE = 1e5;        // clipper integer units per mm (10 nm)
const MAX_ERR = 0.005;           // chord error for arcs/circles, mm

// KiCad's RotatePoint (libs/kimath/src/trigo.cpp): x' = y*sin + x*cos, y' = y*cos - x*sin
export function rot(x, y, deg) {
  if (!deg) return [x, y];
  const a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  return [y * s + x * c, y * c - x * s];
}

export function segCount(r, sweepRad, minFull = 16) {
  if (r <= 0) return 1;
  const step = 2 * Math.acos(Math.max(-1, 1 - Math.min(MAX_ERR, r) / r));
  const n = Math.ceil(Math.abs(sweepRad) / step);
  const nMin = Math.ceil(minFull * Math.abs(sweepRad) / (2 * Math.PI));
  return Math.max(n, nMin, 1);
}

// Points of an arc around (cx,cy); angles in radians in the board frame (atan2(dy,dx), Y down)
export function arcPts(cx, cy, r, a0, sweep, includeStart = true) {
  const n = segCount(r, sweep);
  const out = [];
  for (let i = includeStart ? 0 : 1; i <= n; i++) {
    const a = a0 + sweep * i / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

export function circlePoly(cx, cy, r, minSeg = 16) {
  const n = Math.max(segCount(r, 2 * Math.PI, minSeg), minSeg);
  const out = [];
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

// arc through start/mid/end -> {cx,cy,r,a0,sweep}
export function arc3(sx, sy, mx, my, ex, ey) {
  const d = 2 * (sx * (my - ey) + mx * (ey - sy) + ex * (sy - my));
  if (Math.abs(d) < 1e-12) return null;
  const s2 = sx * sx + sy * sy, m2 = mx * mx + my * my, e2 = ex * ex + ey * ey;
  const cx = (s2 * (my - ey) + m2 * (ey - sy) + e2 * (sy - my)) / d;
  const cy = (s2 * (ex - mx) + m2 * (sx - ex) + e2 * (mx - sx)) / d;
  const r = Math.hypot(sx - cx, sy - cy);
  const a0 = Math.atan2(sy - cy, sx - cx);
  const am = Math.atan2(my - cy, mx - cx);
  const a1 = Math.atan2(ey - cy, ex - cx);
  const norm = a => { while (a < 0) a += 2 * Math.PI; while (a >= 2 * Math.PI) a -= 2 * Math.PI; return a; };
  let sw = norm(a1 - a0);
  if (norm(am - a0) > sw) sw = sw - 2 * Math.PI; // mid not on positive sweep -> go negative
  if (Math.abs(sw) < 1e-12) sw = 2 * Math.PI;
  return { cx, cy, r, a0, sweep: sw };
}

// Thick segment with round ends (a track, or a stroked line)
export function segPoly(x1, y1, x2, y2, w) {
  const r = w / 2;
  const a = Math.atan2(y2 - y1, x2 - x1);
  if (x1 === x2 && y1 === y2) return circlePoly(x1, y1, r);
  return [...arcPts(x2, y2, r, a - Math.PI / 2, Math.PI), ...arcPts(x1, y1, r, a + Math.PI / 2, Math.PI)];
}

// Thick arc with round ends
export function arcStrokePoly(arc, w) {
  const { cx, cy, r, a0, sweep } = arc, h = w / 2;
  const a1 = a0 + sweep, sg = Math.sign(sweep) || 1;
  const outer = arcPts(cx, cy, r + h, a0, sweep);
  const e = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  const capE = arcPts(e[0], e[1], h, a1, sg * Math.PI, false);
  const inner = r - h > 0 ? arcPts(cx, cy, r - h, a1, -sweep) : [[cx, cy]];
  const s = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
  const capS = arcPts(s[0], s[1], h, a0 + Math.PI, sg * Math.PI, false);
  return [...outer, ...capE.slice(0, -1), ...inner, ...capS.slice(0, -1)];
}

export function bezierPts(p0, p1, p2, p3) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(4, Math.min(200, Math.ceil(len / 0.1)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
              u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}

// --- clipper helpers -------------------------------------------------------
export function toPath(pts) {
  const p = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) p[i] = { X: Math.round(pts[i][0] * SCALE), Y: Math.round(pts[i][1] * SCALE) };
  return p;
}
export function areaOf(path) { return CL().Clipper.Area(path); }

// A set of polygons collected for one layer; positive paths are unioned, then holes removed.
export class PolySet {
  constructor() { this.paths = []; }
  add(pts) { if (pts.length >= 3) { const p = toPath(pts); if (!CL().Clipper.Orientation(p)) p.reverse(); this.paths.push(p); } }
  addPath(p) { this.paths.push(p); }
  addHole(pts) { if (pts.length >= 3) { const p = toPath(pts); if (CL().Clipper.Orientation(p)) p.reverse(); this.paths.push(p); } }
  // ring: outer positive, inner negative (works with NonZero union)
  addRing(cx, cy, rOut, rIn) {
    const o = toPath(circlePoly(cx, cy, rOut)); if (!CL().Clipper.Orientation(o)) o.reverse();
    const i = toPath(circlePoly(cx, cy, rIn)); if (CL().Clipper.Orientation(i)) i.reverse();
    this.paths.push(o, i);
  }
  addPolyWithHoles(outer, holes) {
    const o = toPath(outer); if (!CL().Clipper.Orientation(o)) o.reverse();
    this.paths.push(o);
    for (const h of holes) { const p = toPath(h); if (CL().Clipper.Orientation(p)) p.reverse(); this.paths.push(p); }
  }
  get empty() { return this.paths.length === 0; }
}

export function union(paths, fill) {
  const C = CL();
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const out = new C.Paths();
  c.Execute(C.ClipType.ctUnion, out, fill ?? C.PolyFillType.pftNonZero, fill ?? C.PolyFillType.pftNonZero);
  return out;
}

// op: 'union' | 'difference' | 'intersection'; returns Paths (or PolyTree if tree=true)
export function boolean(subj, clip, op, tree = false) {
  const C = CL();
  const c = new C.Clipper();
  c.AddPaths(subj, C.PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(clip, C.PolyType.ptClip, true);
  const ct = op === 'difference' ? C.ClipType.ctDifference : op === 'intersection' ? C.ClipType.ctIntersection : C.ClipType.ctUnion;
  const out = tree ? new C.PolyTree() : new C.Paths();
  c.Execute(ct, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}

// PolyTree -> [{outer:[[x,y]...], holes:[[...]...]}] in mm
export function treeToExPolys(tree) {
  const res = [];
  const walk = node => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) { walk(ch); continue; }
      const ex = { outer: fromPath(ch.Contour()), holes: [] };
      for (const h of ch.Childs()) { ex.holes.push(fromPath(h.Contour())); walk(h); }
      res.push(ex);
    }
  };
  walk(tree);
  return res;
}
export function fromPath(p) { const r = new Array(p.length); for (let i = 0; i < p.length; i++) r[i] = [p[i].X / SCALE, p[i].Y / SCALE]; return r; }
