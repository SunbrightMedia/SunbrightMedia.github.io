// Board geometry -> three.js meshes, in KiCad's 3D frame (millimetres; X right, Y up = -board Y,
// Z out of the front side), centred on the board outline. Layer Z positions follow
// BOARD_ADAPTER::InitSettings (3d-viewer/3d_canvas/board_adapter.cpp, KiCad 10.0.8).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from './geom.js';

const PASTE_THICKNESS = 0.04;        // SOLDERPASTE_LAYER_THICKNESS (board_adapter.cpp)
const TECH_THICKNESS = 0.025;        // DEFAULT_TECH_LAYER_THICKNESS
const LAYER_MARGIN = 1.1;            // layerThicknessMargin
const HOLE_WALL = 0.020;             // ADVANCED_CFG m_HoleWallThickness

const lin = c => new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);

export function buildBoard(board) {
  const { stack } = board;
  const T = stack.body;
  const z = {
    cuF: T / 2 + stack.cuF, cuB: -T / 2 - stack.cuB,
  };
  z.maskF = z.cuF + stack.maskF; z.maskB = z.cuB - stack.maskB;
  const off = TECH_THICKNESS * LAYER_MARGIN;
  z.silkF = z.cuF + off + TECH_THICKNESS; z.silkB = z.cuB - off - TECH_THICKNESS;
  z.modelF = z.cuF + PASTE_THICKNESS;   // GetFootprintZPos(false) = top of F_Paste
  z.modelB = z.cuB;                     // GetFootprintZPos(true)  = bottom of B_Paste

  // outline bbox -> centre
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of board.outline) for (const q of p) {
    minX = Math.min(minX, q.X); maxX = Math.max(maxX, q.X); minY = Math.min(minY, q.Y); maxY = Math.max(maxY, q.Y);
  }
  const cx = (minX + maxX) / 2 / G.SCALE, cy = (minY + maxY) / 2 / G.SCALE;
  const size = [(maxX - minX) / G.SCALE, (maxY - minY) / G.SCALE];
  const P = (x, y) => [x - cx, -(y - cy)];          // board mm -> KiCad 3D frame (centred)

  // hole outlines: TH outer diameter (drill + plating) and NPTH
  const holeOD = [], holeID = [], plated = [];
  for (const h of board.holes) {
    const od = h.plated ? HOLE_WALL : 0;
    const shape = holeShape(h, od);
    holeOD.push(G.toPath(shape));
    if (h.plated) { holeID.push(holeShape(h, 0)); plated.push(h); }
  }
  const holesUnion = G.union(holeOD);

  const outline = board.outline;
  const group = new THREE.Group();
  group.name = 'pcb';
  const mats = materials(stack.colors);

  // board body with holes
  const bodyTree = G.boolean(outline, holesUnion, 'difference', true);
  const bodyEx = G.treeToExPolys(bodyTree);
  const bodyGeo = extrude(bodyEx, P, -T / 2, T / 2);
  const body = new THREE.Mesh(bodyGeo, mats.body);
  group.add(body);

  // flat layers
  const layerSurface = (paths, zz, mat, normalUp) => {
    if (!paths.length) return null;
    const tree = G.boolean(paths, holesUnion, 'difference', true);
    const clipped = G.boolean(G.union(polyTreeToPaths(tree)), outline, 'intersection', true);
    const geo = flat(G.treeToExPolys(clipped), P, zz, normalUp);
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    group.add(m);
    return m;
  };
  const L = board.layers;
  const cuF = G.union(L['F.Cu'].paths), cuB = G.union(L['B.Cu'].paths);
  layerSurface(cuF, z.cuF, mats.copper, true);
  layerSurface(cuB, z.cuB, mats.copper, false);
  if (stack.hasMaskF) layerSurface(G.boolean(outline, G.union(L['F.Mask'].paths), 'difference'), z.maskF, mats.maskF, true);
  if (stack.hasMaskB) layerSurface(G.boolean(outline, G.union(L['B.Mask'].paths), 'difference'), z.maskB, mats.maskB, false);
  layerSurface(G.union(L['F.SilkS'].paths), z.silkF, mats.silkF, true);
  layerSurface(G.union(L['B.SilkS'].paths), z.silkB, mats.silkB, false);

  // plated barrels (copper walls inside plated holes)
  const walls = [];
  for (let i = 0; i < plated.length; i++) {
    const h = plated[i];
    let zt = z.cuF, zb = z.cuB;
    if (h.partial) { /* blind/buried via: span approximated over the whole board */ }
    walls.push(wallGeometry(holeID[i].map(([x, y]) => P(x, y)), zb, zt, true));
  }
  if (walls.length) {
    const g = mergeGeometries(walls);
    group.add(new THREE.Mesh(g, mats.barrel));
  }

  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    group, z, centre: [cx, cy], size, thickness: z.maskF - z.maskB, P,
    outlineEx: G.treeToExPolys(G.boolean(outline, null, 'union', true)),
  };
}

function polyTreeToPaths(tree) { return globalThis.ClipperLib.Clipper.PolyTreeToPaths(tree); }

function holeShape(h, grow) {
  const sx = h.sx + 2 * grow, sy = h.sy + 2 * grow;
  if (Math.abs(sx - sy) < 1e-9) return G.circlePoly(h.x, h.y, sx / 2, 12);
  const hw = Math.min(sx, sy) / 2;
  const dx = sx / 2 - hw, dy = sy / 2 - hw;
  const local = G.segPoly(-dx, -dy, dx, dy, 2 * hw);
  return local.map(([x, y]) => { const r = G.rot(x, y, h.angle); return [r[0] + h.x, r[1] + h.y]; });
}

function shapesFromEx(ex, P) {
  const shapes = [];
  for (const e of ex) {
    const s = new THREE.Shape(e.outer.map(([x, y]) => new THREE.Vector2(...P(x, y))));
    for (const h of e.holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(...P(x, y)))));
    shapes.push(s);
  }
  return shapes;
}

function flat(ex, P, zz, up) {
  if (!ex.length) return null;
  const geo = new THREE.ShapeGeometry(shapesFromEx(ex, P), 1);
  geo.translate(0, 0, zz);
  if (!up) { // face -Z
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const n = geo.attributes.normal.array; for (let i = 2; i < n.length; i += 3) n[i] = -1;
  }
  return geo;
}

// top+bottom faces and side walls
function extrude(ex, P, z0, z1) {
  const parts = [];
  const top = flat(ex, P, z1, true), bot = flat(ex, P, z0, false);
  if (top) parts.push(top); if (bot) parts.push(bot);
  for (const e of ex) {
    parts.push(wallGeometry(e.outer.map(([x, y]) => P(x, y)), z0, z1, false));
    for (const h of e.holes) parts.push(wallGeometry(h.map(([x, y]) => P(x, y)), z0, z1, false));
  }
  return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
}

// vertical wall along a closed contour; normals point away from the polygon interior for
// outer contours (CCW in the 3D frame) and into the hole for holes. inward=true flips them
// (used for barrels, seen from inside the hole).
function wallGeometry(pts, z0, z1, inward) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0;
  const pos = new Float32Array(n * 18), nor = new Float32Array(n * 18);
  let k = 0;
  for (let i = 0; i < n; i++) {
    let a = pts[i], b = pts[(i + 1) % n];
    if (!ccw) [a, b] = [b, a];
    // outward normal for CCW contour edge a->b is (dy, -dx)
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    let quad = [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]];
    if (inward) { nx = -nx; ny = -ny; quad = [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]; }
    for (const v of quad) { pos[k] = v[0]; pos[k + 1] = v[1]; pos[k + 2] = v[2]; nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = 0; k += 3; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 12), 2));
  return g;
}

function materials(c) {
  // Colours come from the board (stackup) or KiCad's defaults; surface finish properties
  // (roughness/metalness) are rendering choices for the PBR renderer.
  const copper = new THREE.MeshStandardMaterial({ color: lin(c.copper), metalness: 1, roughness: 0.35, side: THREE.FrontSide });
  const mask = col => new THREE.MeshPhysicalMaterial({ color: lin(col), roughness: 0.45, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4,
    transparent: col.a < 1, opacity: col.a, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const silk = col => new THREE.MeshStandardMaterial({ color: lin(col), roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const body = new THREE.MeshStandardMaterial({ color: lin(c.body), roughness: 0.7, metalness: 0, transparent: c.body.a < 1, opacity: c.body.a });
  return {
    copper, barrel: copper.clone(), body,
    maskF: mask(c.maskF), maskB: mask(c.maskB), silkF: silk(c.silkF), silkB: silk(c.silkB),
  };
}

// Convex pieces of the outline (for the physics collider): triangulate, then greedily merge
// neighbouring triangles while the union stays convex (Hertel-Mehlhorn).
export function convexPieces(outlineEx, P) {
  const pieces = [];
  for (const e of outlineEx) {
    const contour = e.outer.map(([x, y]) => new THREE.Vector2(...P(x, y)));
    const holes = e.holes.map(h => h.map(([x, y]) => new THREE.Vector2(...P(x, y))));
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    const verts = contour.concat(...holes);
    let polys = tris.map(t => t.slice());
    const isConvex = poly => {
      let sign = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = verts[poly[i]], b = verts[poly[(i + 1) % poly.length]], c = verts[poly[(i + 2) % poly.length]];
        const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cr) < 1e-9) continue;
        if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
      }
      return true;
    };
    let merged = true;
    while (merged) {
      merged = false;
      const edgeMap = new Map();
      for (let pi = 0; pi < polys.length; pi++) {
        const p = polys[pi];
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length];
          const key = a < b ? a + ',' + b : b + ',' + a;
          const other = edgeMap.get(key);
          if (other !== undefined && other !== pi) {
            const q = polys[other];
            // p runs a->b, q runs b->a: polygon = p from b round to a, then q after a up to before b
            const ia = q.indexOf(a);
            const qa = q.slice(ia).concat(q.slice(0, ia));
            const pr = p.slice(i + 1).concat(p.slice(0, i + 1));
            const cand = pr.concat(qa.slice(1, -1));
            if (isConvex(cand)) {
              polys[pi] = cand; polys.splice(other, 1);
              merged = true; break;
            }
          } else edgeMap.set(key, pi);
        }
        if (merged) break;
      }
    }
    for (const p of polys) pieces.push(p.map(i => [verts[i].x, verts[i].y]));
  }
  return pieces;
}
