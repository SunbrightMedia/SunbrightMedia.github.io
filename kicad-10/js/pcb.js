// Reads a .kicad_pcb (S-expression board file) into flat 2D layer geometry for the 3D builder.
// Format: https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/ and sexpr-intro/ ; where the
// spec is silent or out of date, behaviour follows KiCad 10.0.8's own reader and 3D viewer:
//   pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp, pcb_io_kicad_sexpr.cpp (writer)
//   pcbnew/pad.cpp, libs/kimath/src/convert_basic_shapes_to_polygon.cpp (pad shapes)
//   3d-viewer/3d_canvas/board_adapter.cpp, create_layer_items.cpp (layers, colours, Z stack)
//   3d-viewer/3d_rendering/opengl/create_scene.cpp, render_3d_opengl.cpp (what is cut from what)
import { parseSexpr, Str, S, find, findAll, num, getNum, getStr, getBool, hasAtom } from './sexpr.js';
import * as G from './geom.js';
import { layoutText, penWidth, ensureGlyphsFor } from './strokefont.js';

const RENDER_LAYERS = ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask', 'F.SilkS', 'B.SilkS'];
// DEFAULT_CHAINING_EPSILON_MM (pcbnew/board.h)
const CHAIN_EPS = 0.01;
// ADVANCED_CFG m_HoleWallThickness default (common/advanced_config.cpp)
const HOLE_WALL = 0.020;

// ---- colours (3d-viewer/3d_canvas/board_adapter.cpp, KiCad 10.0.8) -------------------------
const rgb = (r, g, b, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a });
const SILK_COLORS = { 'Not specified': rgb(245, 245, 245), Green: rgb(20, 51, 36), Red: rgb(181, 19, 21), Blue: rgb(2, 59, 162),
  Black: rgb(11, 11, 11), White: rgb(245, 245, 245), Purple: rgb(32, 2, 53), Yellow: rgb(194, 195, 0) };
const MASK_COLORS = { 'Not specified': rgb(20, 51, 36, 0.83), Green: rgb(20, 51, 36, 0.83), 'Light Green': rgb(91, 168, 12, 0.83),
  'Saturated Green': rgb(13, 104, 11, 0.83), Red: rgb(181, 19, 21, 0.83), 'Light Red': rgb(210, 40, 14, 0.83),
  'Red/Orange': rgb(239, 53, 41, 0.83), Blue: rgb(2, 59, 162, 0.83), 'Light Blue 1': rgb(54, 79, 116, 0.83),
  'Light Blue 2': rgb(61, 85, 130, 0.83), 'Green/Blue': rgb(21, 70, 80, 0.83), Black: rgb(11, 11, 11, 0.83),
  White: rgb(245, 245, 245, 0.83), Purple: rgb(32, 2, 53, 0.83), 'Light Purple': rgb(119, 31, 91, 0.83), Yellow: rgb(194, 195, 0, 0.83) };
const FINISH_COLORS = { Copper: rgb(184, 115, 50), Gold: rgb(178, 156, 0), Silver: rgb(213, 213, 213), Tin: rgb(160, 160, 160) };
const BOARD_COLORS = { 'FR4 natural, dark': rgb(51, 43, 22, 0.83), 'FR4 natural': rgb(109, 116, 75, 0.83), 'PTFE natural': rgb(252, 252, 250, 0.90),
  Polyimide: rgb(205, 130, 0, 0.68), 'Phenolic natural': rgb(92, 17, 6, 0.90), 'Brown 1': rgb(146, 99, 47, 0.83),
  'Brown 2': rgb(160, 123, 54, 0.83), 'Brown 3': rgb(146, 99, 47, 0.83), Aluminum: rgb(213, 213, 213, 1.0) };
// default 3D colour theme (common/settings/builtin_color_themes.h)
const THEME = { board: { r: 0.2, g: 0.17, b: 0.09, a: 0.9 }, copper: { r: 0.7, g: 0.61, b: 0.0, a: 1 },
  silk: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, mask: { r: 0.08, g: 0.2, b: 0.14, a: 0.83 } };

function parseHexColor(s) { // "#RRGGBB" or "#RRGGBBAA" (KIGFX::COLOR4D(wxString))
  const h = s.slice(1);
  const v = i => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: v(0), g: v(2), b: v(4), a: h.length >= 8 ? v(6) : 1 };
}
// BOARD_ADAPTER::GetLayerColors findColor(): '#' colours parsed, else name lookup, else COLOR4D() = opaque black
function findColor(name, set) {
  if (name && name.startsWith('#')) return parseHexColor(name);
  return set[name] ? { ...set[name] } : { r: 0, g: 0, b: 0, a: 1 };
}

// ---- layer helpers ----------------------------------------------------------------------
function expandLayers(names, copperNames) {
  const out = new Set();
  for (const n of names) {
    if (n === '*.Cu') copperNames.forEach(c => out.add(c));
    else if (n === 'F&B.Cu') { out.add('F.Cu'); out.add('B.Cu'); }
    else if (n.startsWith('*.')) { out.add('F.' + n.slice(2)); out.add('B.' + n.slice(2)); }
    else out.add(n);
  }
  return out;
}

// ---- main ------------------------------------------------------------------------------------
export async function readBoard(text, ctx = {}) {
  const t0 = performance.now();
  const root = parseSexpr(text);
  if (!root || (root[0] !== 'kicad_pcb')) throw new Error('Not a KiCad board file');
  const version = getNum(root, 'version', 0);
  if (version < 20211014) ctx.warn?.(`board file version ${version} predates KiCad 6; it may not read correctly`);

  // layers section
  const layersSec = find(root, 'layers');
  const enabled = new Set(), userNames = {}, copperNames = [];
  if (layersSec) for (const l of layersSec.slice(1)) {
    if (!Array.isArray(l)) continue;
    const name = S(l[1]); enabled.add(name);
    if (l[3] !== undefined) userNames[name] = S(l[3]);
    if (name.endsWith('.Cu')) copperNames.push(name);
  }
  const cuCount = copperNames.length || 2;

  // setup / stackup
  const setup = find(root, 'setup');
  const general = find(root, 'general');
  const generalThickness = getNum(general, 'thickness', 1.6); // DEFAULT_BOARD_THICKNESS_MM
  const padToMask = getNum(setup, 'pad_to_mask_clearance', 0);
  let tentF = true, tentB = true; // BOARD_DESIGN_SETTINGS m_TentViasFront/Back defaults
  const tenting = find(setup, 'tenting');
  if (tenting) {
    const fb = parseFrontBack(tenting);
    tentF = fb.front ?? false; tentB = fb.back ?? false;
  }
  const stack = readStackup(find(setup, 'stackup'), enabled, copperNames, generalThickness);

  // title block / project variables for ${...}
  const tb = find(root, 'title_block');
  const boardVars = Object.assign({}, ctx.textVars || {});
  if (tb) {
    for (const [k, key] of [['title', 'TITLE'], ['date', 'ISSUE_DATE'], ['rev', 'REVISION'], ['company', 'COMPANY']]) {
      const v = getStr(tb, k); if (v !== undefined) boardVars[key] = v;
    }
    for (const c of findAll(tb, 'comment')) boardVars['COMMENT' + S(c[1])] = S(c[2]);
  }
  if (ctx.fileName) boardVars.FILENAME = ctx.fileName;

  const L = {}; for (const n of RENDER_LAYERS) L[n] = new G.PolySet();
  const holes = [];      // {x,y,sx,sy,angle,plated}
  const edge = [];       // centreline paths on Edge.Cuts: {pts, closed}
  const models = [];
  const texts = [];      // deferred until glyph tables are ready
  const embedded = new Map();
  readEmbedded(find(root, 'embedded_files'), embedded);

  const want = l => L[l] !== undefined;

  // ---- graphic shapes ---------------------------------------------------------------------
  const addShape = (sh, xf) => {
    const layerNames = itemLayers(sh, copperNames);
    const geo = shapeGeometry(sh, xf);
    if (!geo) return;
    for (const ln of layerNames) {
      if (ln === 'Edge.Cuts') { edge.push(...geo.paths); continue; }
      if (!want(ln)) continue;
      emitShape(L[ln], geo, 0);
    }
  };

  const emitShape = (set, geo, inflate) => {
    const w = geo.width + 2 * inflate;
    if (geo.filled) for (const p of geo.paths) if (p.closed && p.pts.length >= 3) {
      if (inflate) set.addPath(...offsetPts(p.pts, inflate)); else set.add(p.pts);
    }
    if (w > 0) for (const p of geo.paths) strokePath(set, p, w);
  };

  // ---- text --------------------------------------------------------------------------------
  const addText = (tx, layerName, xf, fp, opts) => {
    if (!want(layerName)) return;
    texts.push({ tx, layerName, xf, fp, opts });
  };

  // ---- board-level items ------------------------------------------------------------------
  const identity = { x: 0, y: 0, a: 0 };
  for (const it of root.slice(1)) {
    if (!Array.isArray(it)) continue;
    switch (it[0]) {
      case 'gr_line': case 'gr_rect': case 'gr_circle': case 'gr_arc': case 'gr_poly': case 'gr_curve': case 'bezier':
        addShape(it, identity); break;
      case 'gr_text': {
        const lay = find(it, 'layer');
        addText(it, S(lay[1]), identity, null, { knockout: hasAtom(lay, 'knockout'), text: S(it[1]) });
        break;
      }
      case 'segment': {
        const ln = getStr(it, 'layer');
        if (!want(ln)) break;
        const s = xy(find(it, 'start')), e = xy(find(it, 'end'));
        L[ln].add(G.segPoly(s[0], s[1], e[0], e[1], getNum(it, 'width', 0)));
        break;
      }
      case 'arc': {
        const ln = getStr(it, 'layer');
        if (!want(ln)) break;
        const s = xy(find(it, 'start')), m = xy(find(it, 'mid')), e = xy(find(it, 'end'));
        const a = G.arc3(s[0], s[1], m[0], m[1], e[0], e[1]);
        const w = getNum(it, 'width', 0);
        if (a) L[ln].add(G.arcStrokePoly(a, w)); else L[ln].add(G.segPoly(s[0], s[1], e[0], e[1], w));
        break;
      }
      case 'via': readVia(it); break;
      case 'zone': readZone(it); break;
      case 'footprint': case 'module': readFootprint(it); break;
      default: break;
    }
  }

  function readVia(it) {
    const at = xy(find(it, 'at'));
    let size = getNum(it, 'size', 0);
    const drill = getNum(it, 'drill', 0);
    const lay = find(it, 'layers');
    const ls = lay ? lay.slice(1).map(S) : ['F.Cu', 'B.Cu'];
    const ps = find(it, 'padstack');
    const sizeOn = ln => {
      if (ps) for (const l of findAll(ps, 'layer')) if (S(l[1]) === ln) { const sz = find(l, 'size'); if (sz) return num(sz[1]); }
      return size;
    };
    let fbTent = {};
    const tt = find(it, 'tenting'); if (tt) fbTent = parseFrontBack(tt);
    const idx = n => n === 'F.Cu' ? 0 : n === 'B.Cu' ? 1e9 : parseInt(n.slice(2));
    const lo = Math.min(idx(ls[0]), idx(ls[1])), hi = Math.max(idx(ls[0]), idx(ls[1]));
    for (const [cu, mask, def, i] of [['F.Cu', 'F.Mask', tentF, 0], ['B.Cu', 'B.Mask', tentB, 1e9]]) {
      if (i < lo || i > hi) continue;
      const d = sizeOn(cu);
      L[cu].add(G.circlePoly(at[0], at[1], d / 2));
      const tented = (cu === 'F.Cu' ? fbTent.front : fbTent.back) ?? def;
      if (!tented) L[mask].add(G.circlePoly(at[0], at[1], d / 2 + padToMask));
    }
    if (lo === 0 && hi === 1e9) holes.push({ x: at[0], y: at[1], sx: drill, sy: drill, angle: 0, plated: true, via: true });
    else holes.push({ x: at[0], y: at[1], sx: drill, sy: drill, angle: 0, plated: true, via: true, partial: { lo, hi } });
  }

  function readZone(it) {
    for (const fp of findAll(it, 'filled_polygon')) {
      const ln = getStr(fp, 'layer');
      if (!want(ln)) continue;
      const pts = ptsOf(find(fp, 'pts'));
      if (pts.length >= 3) L[ln].add(pts);
    }
  }

  function readFootprint(fp) {
    const atL = find(fp, 'at');
    const fx = num(atL[1]), fy = num(atL[2]), fa = atL.length > 3 ? num(atL[3]) : 0;
    const fpLayer = getStr(fp, 'layer', 'F.Cu');
    const flipped = fpLayer === 'B.Cu';
    const xf = { x: fx, y: fy, a: fa };
    const fpMaskMargin = find(fp, 'solder_mask_margin') ? getNum(fp, 'solder_mask_margin') : undefined;
    const attr = find(fp, 'attr');
    const dnp = attr ? hasAtom(attr, 'dnp') : false;
    const fpEmbedded = new Map();
    readEmbedded(find(fp, 'embedded_files'), fpEmbedded);

    // fields and text variables
    const props = {};
    for (const p of findAll(fp, 'property')) props[S(p[1])] = S(p[2]);
    for (const t of findAll(fp, 'fp_text')) {
      if (t[1] === 'reference') props.Reference = S(t[2]);
      if (t[1] === 'value') props.Value = S(t[2]);
    }
    const lib = fp[1] instanceof Str ? S(fp[1]) : '';
    const vars = { REFERENCE: props.Reference ?? '', VALUE: props.Value ?? '',
      FOOTPRINT_LIBRARY: lib.includes(':') ? lib.split(':')[0] : '', FOOTPRINT_NAME: lib.includes(':') ? lib.split(':')[1] : lib };
    for (const k in props) vars[k.toUpperCase()] = props[k];

    for (const it of fp.slice(1)) {
      if (!Array.isArray(it)) continue;
      switch (it[0]) {
        case 'fp_line': case 'fp_rect': case 'fp_circle': case 'fp_arc': case 'fp_poly': case 'fp_curve':
          addShape(it, xf); break;
        case 'property': {
          if (!find(it, 'layer') || !find(it, 'at')) break;
          if (getBool(it, 'hide', false)) break;
          const eff = find(it, 'effects'); if (eff && hasAtom(eff, 'hide')) break;
          const lay = find(it, 'layer');
          addText(it, S(lay[1]), xf, vars, { knockout: hasAtom(lay, 'knockout'), text: S(it[2]), keepUpright: !getBool(it, 'unlocked', false), field: true });
          break;
        }
        case 'fp_text': {
          if (hasAtom(it, 'hide') || getBool(it, 'hide', false)) break;
          const eff = find(it, 'effects'); if (eff && hasAtom(eff, 'hide')) break;
          const lay = find(it, 'layer');
          addText(it, S(lay[1]), xf, vars, { knockout: hasAtom(lay, 'knockout'), text: S(it[2]), keepUpright: !getBool(it, 'unlocked', false) });
          break;
        }
        case 'pad': readPad(it, xf, fpMaskMargin); break;
        case 'zone': readZone(it); break;
        case 'model': {
          const m = readModel(it);
          if (m) models.push({ ...m, fpX: fx, fpY: fy, fpA: fa, flipped, dnp, ref: props.Reference || '', embedded: fpEmbedded });
          break;
        }
      }
    }
  }

  function readModel(it) {
    const file = S(it[1]);
    const v3 = k => { const e = find(it, k); const x = e && find(e, 'xyz'); return x ? [num(x[1]), num(x[2]), num(x[3])] : null; };
    let offset = v3('offset');
    if (!offset) { const at = v3('at'); offset = at ? at.map(v => v * 25.4) : [0, 0, 0]; } // legacy inches
    const hide = getBool(it, 'hide', false);
    return { file, offset, scale: v3('scale') || [1, 1, 1], rotate: v3('rotate') || [0, 0, 0],
      opacity: getNum(it, 'opacity', 1), show: !hide };
  }

  function readPad(pd, xf, fpMaskMargin) {
    const type = pd[2], shape = pd[3];
    const at = find(pd, 'at');
    const lx = num(at[1]), ly = num(at[2]);
    const angle = at.length > 3 && !isNaN(num(at[3])) ? num(at[3]) : 0; // absolute orientation
    const [rx, ry] = G.rot(lx, ly, xf.a);
    const px = xf.x + rx, py = xf.y + ry;
    const layers = expandLayers((find(pd, 'layers') || []).slice(1).map(S), copperNames);
    const base = padShapeParams(pd, shape);
    const ps = find(pd, 'padstack');
    const layerParams = ln => {
      if (!ps) return base;
      for (const l of findAll(ps, 'layer')) {
        const name = S(l[1]);
        if (name === ln || (name === 'Inner' && ln !== 'F.Cu' && ln !== 'B.Cu')) {
          const sh = find(l, 'shape');
          return { ...base, ...padShapeParams(l, sh ? sh[1] : base.shape, true) };
        }
      }
      return base;
    };
    // drill
    const dr = find(pd, 'drill');
    if (dr && (type === 'thru_hole' || type === 'np_thru_hole')) {
      const nums = dr.slice(1).filter(v => !Array.isArray(v) && v !== 'oval').map(num);
      const oval = hasAtom(dr, 'oval');
      const sx = nums[0] || 0, sy = oval && nums.length > 1 ? nums[1] : sx;
      if (sx > 0) holes.push({ x: px, y: py, sx, sy, angle, plated: type === 'thru_hole' });
    }
    const hasCu = [...layers].some(l => l.endsWith('.Cu'));
    let margin = find(pd, 'solder_mask_margin') ? getNum(pd, 'solder_mask_margin') : fpMaskMargin ?? padToMask;
    for (const ln of layers) {
      if (!want(ln)) continue;
      if (ln.endsWith('.SilkS')) continue; // pads on silk draw outlines only (rare); not handled
      const isMask = ln.endsWith('.Mask');
      const cuLayer = ln.startsWith('F.') ? 'F.Cu' : 'B.Cu';
      const prm = layerParams(isMask ? cuLayer : ln);
      if (type === 'np_thru_hole' && !isMask && !(prm.sx > 0)) continue;
      let infl = 0;
      if (isMask && hasCu) {
        infl = margin;
        if (infl < 0) infl = Math.max(infl, -Math.min(prm.sx, prm.sy) / 2);
      }
      const poly = padPolygon(prm, angle, px, py, infl);
      for (const p of poly) L[ln].addPath(p);
    }
  }

  // ---- texts (need glyph tables, possibly the CJK part) ----------------------------------
  const resolved = texts.map(t => resolveVars(t.opts.text, t.fp, boardVars, userNames[t.layerName] || t.layerName));
  await ensureGlyphsFor(resolved);
  texts.forEach((t, i) => emitText(t, resolved[i]));

  function emitText({ tx, layerName, xf, opts }, shown) {
    if (!shown) return;
    const set = L[layerName];
    const eff = find(tx, 'effects');
    const font = find(eff, 'font');
    const size = find(font, 'size');
    const at = find(tx, 'at');
    const lx = num(at[1]), ly = num(at[2]);
    let angle = at.length > 3 && !isNaN(num(at[3])) ? num(at[3]) : 0; // absolute text angle
    const [rx, ry] = G.rot(lx, ly, xf.a);
    const pos = [xf.x + rx, xf.y + ry];
    const just = find(eff, 'justify') || [];
    const attrs = {
      text: shown, pos,
      size: size ? [num(size[2]), num(size[1])] : [1.524, 1.524],
      thickness: getNum(font, 'thickness', 0),
      bold: getBool(font, 'bold', false), italic: getBool(font, 'italic', false),
      hjust: hasAtom(just, 'left') ? 'left' : hasAtom(just, 'right') ? 'right' : 'center',
      vjust: hasAtom(just, 'top') ? 'top' : hasAtom(just, 'bottom') ? 'bottom' : 'center',
      mirror: hasAtom(just, 'mirror'),
      lineSpacing: getNum(font, 'line_spacing', 1),
    };
    // PCB_TEXT::GetDrawRotation: footprint text kept upright within ]-90, 90]
    if (xf !== identity && opts.keepUpright) { while (angle > 90) angle -= 180; while (angle <= -90) angle += 180; }
    attrs.angle = angle;
    let glyphPaths = [];
    const rc = find(tx, 'render_cache');
    if (rc && S(rc[1]) === shown) {
      for (const pg of findAll(rc, 'polygon')) {
        const ps = new G.PolySet();
        findAll(pg, 'pts').forEach((p, k) => { const pts = ptsOf(p); if (k === 0) ps.add(pts); else ps.addHole(pts); });
        glyphPaths.push(...G.union(ps.paths));
      }
    } else {
      const { strokes, width } = layoutText(attrs);
      const ps = new G.PolySet();
      for (const st of strokes) for (let k = 0; k + 1 < st.length; k++) ps.add(G.segPoly(st[k][0], st[k][1], st[k + 1][0], st[k + 1][1], width));
      glyphPaths = ps.paths;
    }
    if (!opts.knockout) { glyphPaths.forEach(p => set.addPath(p)); return; }
    // knockout: bounding box (in text frame) inflated by GetKnockoutTextMargin, minus the text
    const pw = penWidth(attrs);
    const margin = Math.max(pw / 2, attrs.size[1] / 9);
    const glyph = G.union(glyphPaths);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of glyph) for (const q of p) {
      const [x, y] = G.rot(q.X / G.SCALE - pos[0], q.Y / G.SCALE - pos[1], -angle);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (!isFinite(minX)) return;
    const box = [[minX - margin, minY - margin], [maxX + margin, minY - margin], [maxX + margin, maxY + margin], [minX - margin, maxY + margin]]
      .map(([x, y]) => { const r = G.rot(x, y, angle); return [r[0] + pos[0], r[1] + pos[1]]; });
    const res = G.boolean([G.toPath(box)], glyph, 'difference');
    for (const p of res) set.addPath(p);
  }

  // ---- board outline -------------------------------------------------------------------------
  let outline = buildOutline(edge);
  if (!outline.length) {
    ctx.warn?.('no closed board outline on Edge.Cuts; using the bounding box of the copper');
    outline = bboxOutline(L);
  }

  return {
    version, stack, outline, layers: L, holes, models, embedded,
    title: tb ? getStr(tb, 'title', '') : '',
    parseMs: performance.now() - t0,
  };
}

// ---- stackup (board_adapter.cpp InitSettings / GetLayerColors, board_stackup.cpp) -------------
function readStackup(st, enabled, copperNames, generalThickness) {
  const items = [];
  let finish = 'Not specified';
  if (st) {
    for (const l of st.slice(1)) {
      if (!Array.isArray(l)) continue;
      if (l[0] === 'copper_finish') { finish = S(l[1]); continue; }
      if (l[0] !== 'layer') continue;
      const name = S(l[1]);
      const type = getStr(l, 'type', '');
      // dielectric sublayers ("addsublayer") are summed
      let thick = 0, k = 0, colors = [];
      let cur = { thickness: undefined, color: undefined };
      const subs = [cur];
      for (const e of l.slice(2)) {
        if (e === 'addsublayer') { cur = { thickness: undefined, color: undefined }; subs.push(cur); continue; }
        if (!Array.isArray(e)) continue;
        if (e[0] === 'thickness') cur.thickness = num(e[1]);
        if (e[0] === 'color') cur.color = S(e[1]);
      }
      items.push({ name, type, subs });
    }
  }
  const has = items.length > 0;
  let body = 0, cuF = 0.035, cuB = 0.035, maskF = 0.01, maskB = 0.01;
  const colors = { silkF: null, silkB: null, maskF: null, maskB: null, body: null, copper: null };
  if (has) {
    let bodyCol = null;
    for (const it of items) {
      const isCu = it.name.endsWith('.Cu');
      if (it.name.startsWith('dielectric')) {
        for (const s of it.subs) body += s.thickness ?? 0;
        const c = findColor(it.subs[0].color ?? 'Not specified', BOARD_COLORS);
        if (!bodyCol) bodyCol = c;
        else { const f = 1 - c.a; bodyCol = { r: c.r * (1 - f) + bodyCol.r * f, g: c.g * (1 - f) + bodyCol.g * f, b: c.b * (1 - f) + bodyCol.b * f, a: bodyCol.a }; }
        bodyCol.a += (1 - bodyCol.a) * c.a / 2;
      } else if (isCu) {
        const t = Math.max(it.subs[0].thickness ?? 0.035, 0.001);
        if (it.name === 'F.Cu') cuF = t; else if (it.name === 'B.Cu') cuB = t; else body += t;
      } else if (it.name === 'F.Mask' || it.name === 'B.Mask') {
        const t = Math.max(it.subs[0].thickness ?? 0.01, 0.001);
        if (it.name === 'F.Mask') maskF = t; else maskB = t;
        colors[it.name === 'F.Mask' ? 'maskF' : 'maskB'] = findColor(it.subs[0].color ?? 'Not specified', MASK_COLORS);
      } else if (it.name === 'F.SilkS' || it.name === 'B.SilkS') {
        colors[it.name === 'F.SilkS' ? 'silkF' : 'silkB'] = findColor(it.subs[0].color ?? 'Not specified', SILK_COLORS);
      }
    }
    if (bodyCol) colors.body = bodyCol;
  } else {
    // BOARD_STACKUP::BuildDefaultStackupList: dielectric = thickness - copper - masks, all colours "Not specified"
    const nCu = copperNames.length || 2;
    const nMask = (enabled.has('F.Mask') ? 1 : 0) + (enabled.has('B.Mask') ? 1 : 0);
    const diel = (generalThickness - 0.035 * nCu - 0.01 * nMask) / Math.max(1, nCu - 1);
    body = diel * (nCu - 1) + 0.035 * Math.max(0, nCu - 2);
    if (enabled.has('F.SilkS')) colors.silkF = { ...SILK_COLORS['Not specified'] };
    if (enabled.has('B.SilkS')) colors.silkB = { ...SILK_COLORS['Not specified'] };
    if (enabled.has('F.Mask')) colors.maskF = { ...MASK_COLORS['Not specified'] };
    if (enabled.has('B.Mask')) colors.maskB = { ...MASK_COLORS['Not specified'] };
    colors.body = { r: 0, g: 0, b: 0, a: 1 }; // findColor("Not specified", g_BoardColors) -> COLOR4D()
  }
  // copper finish
  if (finish.endsWith('OSP')) colors.copper = FINISH_COLORS.Copper;
  else if (finish.endsWith('IG') || finish.endsWith('gold')) colors.copper = FINISH_COLORS.Gold;
  else if (finish.startsWith('HAL') || finish.startsWith('HASL') || finish.endsWith('tin') || finish.endsWith('nickel')) colors.copper = FINISH_COLORS.Tin;
  else if (finish.endsWith('silver')) colors.copper = FINISH_COLORS.Silver;
  for (const [k, d] of [['silkF', THEME.silk], ['silkB', THEME.silk], ['maskF', THEME.mask], ['maskB', THEME.mask], ['body', THEME.board], ['copper', THEME.copper]])
    if (!colors[k]) colors[k] = { ...d };
  return { hasStackup: has, body, cuF, cuB, maskF, maskB, colors, finish,
    hasMaskF: enabled.has('F.Mask'), hasMaskB: enabled.has('B.Mask') };
}

function parseFrontBack(l) {
  const r = {};
  for (const e of l.slice(1)) {
    if (e === 'front') r.front = true;
    else if (e === 'back') r.back = true;
    else if (e === 'none') { r.front = undefined; r.back = undefined; }
    else if (Array.isArray(e) && (e[0] === 'front' || e[0] === 'back')) {
      const v = S(e[1]); r[e[0]] = v === 'yes' || v === 'true' ? true : v === 'no' || v === 'false' ? false : undefined;
    }
  }
  return r;
}

function readEmbedded(sec, map) {
  if (!sec) return;
  for (const f of findAll(sec, 'file')) {
    const name = getStr(f, 'name');
    const data = find(f, 'data');
    if (name && data && data.length > 1) map.set(name, { data: S(data[1]), type: getStr(f, 'type', 'other') });
  }
}

// ---- text variables -----------------------------------------------------------------------
function resolveVars(text, fpVars, boardVars, layerName) {
  if (!text) return text;
  let out = text, guard = 0;
  while (out.includes('${') && guard++ < 6) {
    out = out.replace(/\$\{([^}]*)\}/g, (m, name) => {
      if (name === 'LAYER') return layerName;
      if (fpVars && fpVars[name] !== undefined) return fpVars[name];
      if (boardVars[name] !== undefined) return boardVars[name];
      return m;
    });
  }
  return out;
}

// ---- shapes ---------------------------------------------------------------------------------
function xy(l) { return [num(l[1]), num(l[2])]; }
function xform(xf, p) { if (!xf.a && !xf.x && !xf.y) return p; const [x, y] = G.rot(p[0], p[1], xf.a); return [xf.x + x, xf.y + y]; }

function ptsOf(ptsList, xf) {
  const out = [];
  if (!ptsList) return out;
  for (const e of ptsList.slice(1)) {
    if (!Array.isArray(e)) continue;
    if (e[0] === 'xy') out.push([num(e[1]), num(e[2])]);
    else if (e[0] === 'arc') {
      const s = xy(find(e, 'start')), m = xy(find(e, 'mid')), en = xy(find(e, 'end'));
      const a = G.arc3(s[0], s[1], m[0], m[1], en[0], en[1]);
      if (a) out.push(...G.arcPts(a.cx, a.cy, a.r, a.a0, a.sweep)); else out.push(s, en);
    }
  }
  return xf ? out.map(p => xform(xf, p)) : out;
}

function itemLayers(sh, copperNames) {
  const l = find(sh, 'layer');
  if (l) return [S(l[1])];
  const ls = find(sh, 'layers');
  return ls ? [...expandLayers(ls.slice(1).map(S), copperNames)] : [];
}

function strokeWidth(sh) {
  const st = find(sh, 'stroke');
  if (st) return getNum(st, 'width', 0);
  return getNum(sh, 'width', 0);
}
function isFilled(sh) {
  const f = find(sh, 'fill');
  if (!f) return false;
  const v = S(f[1]);
  return v === 'yes' || v === 'solid' || v === 'true';  // hatch fills are not drawn as solid
}

// shape -> { paths:[{pts, closed}], width, filled }  (board coordinates)
export function shapeGeometry(sh, xf) {
  const kind = sh[0].replace(/^(fp_|gr_)/, '');
  const w = strokeWidth(sh), filled = isFilled(sh);
  const P = k => xform(xf, xy(find(sh, k)));
  switch (kind) {
    case 'line': return { paths: [{ pts: [P('start'), P('end')], closed: false }], width: w, filled: false };
    case 'rect': {
      const s = xy(find(sh, 'start')), e = xy(find(sh, 'end'));
      const r = getNum(sh, 'radius', 0);
      let pts;
      if (r > 0) {
        const x0 = Math.min(s[0], e[0]), x1 = Math.max(s[0], e[0]), y0 = Math.min(s[1], e[1]), y1 = Math.max(s[1], e[1]);
        const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
        pts = [...G.arcPts(x1 - rr, y0 + rr, rr, -Math.PI / 2, Math.PI / 2), ...G.arcPts(x1 - rr, y1 - rr, rr, 0, Math.PI / 2),
          ...G.arcPts(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI / 2), ...G.arcPts(x0 + rr, y0 + rr, rr, Math.PI, Math.PI / 2)];
      } else pts = [s, [e[0], s[1]], e, [s[0], e[1]]];
      return { paths: [{ pts: pts.map(p => xform(xf, p)), closed: true }], width: w, filled };
    }
    case 'circle': {
      const c = xy(find(sh, 'center')), e = xy(find(sh, 'end'));
      const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
      return { paths: [{ pts: G.circlePoly(c[0], c[1], r).map(p => xform(xf, p)), closed: true, circle: { c: xform(xf, c), r } }], width: w, filled };
    }
    case 'arc': {
      const st = find(sh, 'start'), md = find(sh, 'mid'), en = find(sh, 'end');
      if (!md) { // legacy: start=centre, end=arc start, angle
        const c = xy(st), s = xy(en), ang = getNum(sh, 'angle', 0) * Math.PI / 180;
        const r = Math.hypot(s[0] - c[0], s[1] - c[1]), a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
        return { paths: [{ pts: G.arcPts(c[0], c[1], r, a0, ang).map(p => xform(xf, p)), closed: false }], width: w, filled: false };
      }
      const s = xy(st), m = xy(md), e = xy(en);
      const a = G.arc3(s[0], s[1], m[0], m[1], e[0], e[1]);
      const pts = a ? G.arcPts(a.cx, a.cy, a.r, a.a0, a.sweep) : [s, e];
      if (pts.length) { pts[0] = s; pts[pts.length - 1] = e; }
      return { paths: [{ pts: pts.map(p => xform(xf, p)), closed: false }], width: w, filled: false };
    }
    case 'poly': {
      const pts = ptsOf(find(sh, 'pts'), xf);
      return { paths: [{ pts, closed: true }], width: w, filled };
    }
    case 'curve': case 'bezier': {
      const p = ptsOf(find(sh, 'pts'));
      if (p.length < 4) return null;
      return { paths: [{ pts: G.bezierPts(p[0], p[1], p[2], p[3]).map(q => xform(xf, q)), closed: false }], width: w, filled: false };
    }
  }
  return null;
}

function strokePath(set, p, w) {
  const pts = p.pts;
  if (p.circle) { set.addRing(p.circle.c[0], p.circle.c[1], p.circle.r + w / 2, Math.max(0, p.circle.r - w / 2)); return; }
  const n = p.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    set.add(G.segPoly(a[0], a[1], b[0], b[1], w));
  }
}

function offsetPts(pts, d) {
  const C = globalThis.ClipperLib;
  const co = new C.ClipperOffset();
  co.AddPath(G.toPath(pts), C.JoinType.jtRound, C.EndType.etClosedPolygon);
  co.ArcTolerance = 0.005 * G.SCALE;
  const out = new C.Paths();
  co.Execute(out, d * G.SCALE);
  return out;
}

// ---- pads -----------------------------------------------------------------------------------
function padShapeParams(l, shape, partial = false) {
  const p = partial ? {} : { shape, sx: 0, sy: 0, rratio: 0, chamferRatio: 0, chamfer: 0, delta: [0, 0], offset: [0, 0], anchor: 'circle', prims: null };
  if (partial) p.shape = shape;
  const sz = find(l, 'size'); if (sz) { p.sx = num(sz[1]); p.sy = sz.length > 2 ? num(sz[2]) : num(sz[1]); }
  const rr = find(l, 'roundrect_rratio'); if (rr) p.rratio = num(rr[1]);
  const cr = find(l, 'chamfer_ratio'); if (cr) p.chamferRatio = num(cr[1]);
  const ch = find(l, 'chamfer');
  if (ch) { // RECT_CHAMFER_POSITIONS bit flags (include/padstack.h)
    let b = 0;
    for (const c of ch.slice(1)) b |= { top_left: 1, top_right: 2, bottom_left: 4, bottom_right: 8 }[c] || 0;
    p.chamfer = b;
  }
  const rd = find(l, 'rect_delta'); if (rd) p.delta = [num(rd[1]), num(rd[2])];
  const dr = find(l, 'drill'); const off = dr && find(dr, 'offset'); if (off) p.offset = [num(off[1]), num(off[2])];
  const lo = find(l, 'offset'); if (lo) p.offset = [num(lo[1]), num(lo[2])];
  const opt = find(l, 'options'); if (opt) { const a = find(opt, 'anchor'); if (a) p.anchor = a[1]; }
  const pr = find(l, 'primitives'); if (pr) p.prims = pr;
  return p;
}

const CHAMFER_TL = 1, CHAMFER_TR = 2, CHAMFER_BL = 4, CHAMFER_BR = 8;

// TransformRoundChamferedRectToPolygon corner list (convert_basic_shapes_to_polygon.cpp)
function roundChamferedRect(hx, hy, radius, chamferRatio, chamferBits, sx, sy) {
  const corners = [[-hx, -hy, radius], [hx, -hy, radius], [hx, hy, radius], [-hx, hy, radius]];
  if (chamferBits) {
    const shorter = Math.min(sx, sy);
    const chamfer = Math.max(0, chamferRatio * shorter);
    const chamId = [CHAMFER_TL, CHAMFER_TR, CHAMFER_BR, CHAMFER_BL];
    const sign = [0, 1, -1, 0, 0, -1, 1, 0];
    for (let cc = 0, pos = 0; cc < 4; cc++, pos++) {
      if (!(chamferBits & chamId[cc])) continue;
      corners[pos][2] = 0;
      if (chamfer === 0) continue;
      corners.splice(pos + 1, 0, [...corners[pos]]);
      corners[pos][0] += sign[(2 * cc) & 7] * chamfer;
      corners[pos][1] += sign[(2 * cc - 2) & 7] * chamfer;
      corners[pos + 1][0] += sign[(2 * cc + 1) & 7] * chamfer;
      corners[pos + 1][1] += sign[(2 * cc - 1) & 7] * chamfer;
      pos++;
    }
  }
  return cornersToPolygon(corners);
}

// rounded corner list -> polygon (fillet each corner with its radius)
function cornersToPolygon(corners) {
  const out = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const [x, y, r] = corners[i];
    if (!r) { out.push([x, y]); continue; }
    const p = corners[(i + n - 1) % n], q = corners[(i + 1) % n];
    const d1 = [p[0] - x, p[1] - y], d2 = [q[0] - x, q[1] - y];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const u1 = [d1[0] / l1, d1[1] / l1], u2 = [d2[0] / l2, d2[1] / l2];
    const half = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))) / 2;
    const t = Math.min(r / Math.tan(half), l1 / 2, l2 / 2);
    const rr = t * Math.tan(half);
    const bis = [u1[0] + u2[0], u1[1] + u2[1]], bl = Math.hypot(...bis);
    const cdist = rr / Math.sin(half);
    const c = [x + bis[0] / bl * cdist, y + bis[1] / bl * cdist];
    const s = [x + u1[0] * t, y + u1[1] * t], e = [x + u2[0] * t, y + u2[1] * t];
    let a0 = Math.atan2(s[1] - c[1], s[0] - c[0]), a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    let sw = a1 - a0; while (sw > Math.PI) sw -= 2 * Math.PI; while (sw < -Math.PI) sw += 2 * Math.PI;
    out.push(...G.arcPts(c[0], c[1], rr, a0, sw));
  }
  return out;
}

// returns clipper paths of the pad on one layer, inflated by `infl` mm (mask margin)
function padPolygon(p, angle, px, py, infl) {
  const [ox, oy] = G.rot(p.offset[0], p.offset[1], angle);
  const cx = px + ox, cy = py + oy;
  const place = pts => pts.map(([x, y]) => { const r = G.rot(x, y, angle); return [r[0] + cx, r[1] + cy]; });
  const hx = p.sx / 2, hy = p.sy / 2;
  let local;
  switch (p.shape) {
    case 'circle': return [orient(G.toPath(G.circlePoly(cx, cy, hx + infl)))];
    case 'oval': {
      if (Math.abs(hx - hy) < 1e-9) return [orient(G.toPath(G.circlePoly(cx, cy, hx + infl)))];
      const hw = Math.min(hx, hy);
      const d = [hx - hw, hy - hw];
      local = G.segPoly(-d[0], -d[1], d[0], d[1], 2 * (hw + infl));
      return [orient(G.toPath(place(local)))];
    }
    case 'rect': case 'trapezoid': {
      const ddx = p.shape === 'trapezoid' ? p.delta[0] / 2 : 0, ddy = p.shape === 'trapezoid' ? p.delta[1] / 2 : 0;
      local = [[-hx + ddy, -hy - ddx], [hx - ddy, -hy + ddx], [hx + ddy, hy - ddx], [-hx - ddy, hy + ddx]];
      break;
    }
    case 'roundrect': {
      const radius = p.rratio * Math.min(p.sx, p.sy);
      const doCh = p.chamferRatio > 0 && p.chamfer;
      local = roundChamferedRect(hx, hy, radius, doCh ? p.chamferRatio : 0, doCh ? p.chamfer : 0, p.sx, p.sy);
      break;
    }
    case 'custom': {
      const set = new G.PolySet();
      if (p.anchor === 'rect') set.add([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]);
      else set.add(G.circlePoly(0, 0, hx));
      if (p.prims) {
        const pw = getNum(p.prims, 'width', 0);
        for (const pr of p.prims.slice(1)) {
          if (!Array.isArray(pr) || !pr[0].startsWith('gr_')) continue;
          const geo = shapeGeometry(pr, { x: 0, y: 0, a: 0 });
          if (!geo) continue;
          const w = geo.width || pw;
          const fill = isFilled(pr) || pr[0] === 'gr_poly' && !find(pr, 'fill') && w === 0;
          if (fill || geo.filled) for (const q of geo.paths) if (q.closed) set.add(q.pts);
          if (w > 0) for (const q of geo.paths) strokePath(set, q, w);
        }
      }
      let paths = G.union(set.paths).map(path => G.toPath(place(G.fromPath(path))));
      if (infl) paths = inflatePaths(paths, infl);
      return paths;
    }
    default: local = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  }
  let path = orient(G.toPath(place(local)));
  if (infl) return inflatePaths([path], infl);
  return [path];
}
function orient(p) { if (!globalThis.ClipperLib.Clipper.Orientation(p)) p.reverse(); return p; }
function inflatePaths(paths, d) {
  const C = globalThis.ClipperLib;
  const co = new C.ClipperOffset();
  co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  co.ArcTolerance = 0.005 * G.SCALE;
  const out = new C.Paths();
  co.Execute(out, d * G.SCALE);
  return out;
}

// ---- Edge.Cuts outline (ConvertOutlineToPolygon-like chaining with DEFAULT_CHAINING_EPSILON_MM)
function buildOutline(paths) {
  const closed = [], open = [];
  for (const p of paths) {
    if (p.pts.length < 2) continue;
    if (p.closed) closed.push(p.pts.slice());
    else open.push(p.pts.slice());
  }
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= CHAIN_EPS;
  const used = new Array(open.length).fill(false);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = open[i].slice();
    let grew = true;
    while (grew && !near(chain[0], chain[chain.length - 1])) {
      grew = false;
      const end = chain[chain.length - 1];
      let best = -1, bestRev = false, bestD = CHAIN_EPS;
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue;
        const s = open[j][0], e = open[j][open[j].length - 1];
        const ds = Math.hypot(s[0] - end[0], s[1] - end[1]), de = Math.hypot(e[0] - end[0], e[1] - end[1]);
        if (ds <= bestD) { best = j; bestRev = false; bestD = ds; }
        if (de <= bestD) { best = j; bestRev = true; bestD = de; }
      }
      if (best >= 0) {
        used[best] = true;
        const seg = bestRev ? open[best].slice().reverse() : open[best];
        chain.push(...seg.slice(1));
        grew = true;
      }
    }
    if (near(chain[0], chain[chain.length - 1]) && chain.length >= 3) { chain.pop(); closed.push(chain); }
  }
  if (!closed.length) return [];
  const C = globalThis.ClipperLib;
  const c = new C.Clipper();
  c.AddPaths(closed.map(G.toPath), C.PolyType.ptSubject, true);
  const out = new C.Paths();
  c.Execute(C.ClipType.ctUnion, out, C.PolyFillType.pftEvenOdd, C.PolyFillType.pftEvenOdd);
  return out;
}

function bboxOutline(L) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of ['F.Cu', 'B.Cu']) for (const p of L[k].paths) for (const q of p) {
    minX = Math.min(minX, q.X); maxX = Math.max(maxX, q.X); minY = Math.min(minY, q.Y); maxY = Math.max(maxY, q.Y);
  }
  if (!isFinite(minX)) return [];
  return [[{ X: minX, Y: minY }, { X: maxX, Y: minY }, { X: maxX, Y: maxY }, { X: minX, Y: maxY }]];
}
