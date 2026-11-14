// KiCad stroke font text layout, ported from KiCad 10.0.8:
//   common/font/stroke_font.cpp   (glyph decoding, GetTextAsGlyphs)
//   common/font/glyph.cpp         (STROKE_GLYPH::Transform)
//   common/font/font.cpp          (getLinePositions, drawMarkup overbar)
//   include/font/font_metrics.h   (interline 1.68, overbar 1.23)
//   include/font/stroke_font.h    (super/subscript 0.8, offsets 0.15 / -0.35)
//   include/font/font.h           (ITALIC_TILT = 1/8)
//   common/gr_text.cpp            (pen sizes for bold/normal, clamp to 25% of size)
import { rot } from './geom.js';
import BASE from './newstroke-base.js';

const STROKE_FONT_SCALE = 1 / 21, FONT_OFFSET = -8;
const ITALIC_TILT = 1 / 8;
const INTERLINE_PITCH = 1.68, LEGACY_FACTOR = 0.9583, OVERBAR_HEIGHT = 1.23;
const SUPER_SUB_SIZE = 0.8, SUB_OFFSET = 0.15, SUPER_OFFSET = -0.35;
const CJK_START = 0x2E80 - 0x20;

let table = BASE, cjkLoaded = false;
const cache = new Map();

export async function ensureGlyphsFor(strings) {
  if (cjkLoaded) return;
  for (const s of strings) for (const ch of s) if (ch.codePointAt(0) - 32 >= CJK_START) {
    const m = await import('./newstroke-cjk.js');
    table = BASE.concat(m.default); cjkLoaded = true; return;
  }
}

function glyph(idx) {
  let g = cache.get(idx);
  if (g) return g;
  const src = table[idx];
  const strokes = [];
  let cur = null, startX = 0, width = 0;
  for (let i = 0; i + 1 < src.length; i += 2) {
    const c0 = src.charCodeAt(i), c1 = src.charCodeAt(i + 1);
    if (i < 2) { startX = (c0 - 82) * STROKE_FONT_SCALE; width = (c1 - 82) * STROKE_FONT_SCALE - startX; continue; }
    if (c0 === 32 && c1 === 82) { cur = null; continue; }
    if (!cur) { cur = []; strokes.push(cur); }
    cur.push([(c0 - 82) * STROKE_FONT_SCALE - startX, (c1 - 82 + FONT_OFFSET) * STROKE_FONT_SCALE]);
  }
  g = { strokes, width };
  cache.set(idx, g);
  return g;
}
const SPACE_W = () => glyph(0).width;

// --- markup (~{overbar} ^{super} _{sub}) ------------------------------------
function parseMarkup(s) {
  const root = { kind: 'root', children: [] };
  const stack = [root];
  let buf = '';
  const flush = () => { if (buf) { stack[stack.length - 1].children.push({ kind: 'text', text: buf }); buf = ''; } };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '~' || c === '^' || c === '_') && s[i + 1] === '{') {
      flush();
      const node = { kind: c === '~' ? 'overbar' : c === '^' ? 'super' : 'sub', children: [] };
      stack[stack.length - 1].children.push(node); stack.push(node); i++;
    } else if (c === '}' && stack.length > 1) { flush(); stack.pop(); }
    else buf += c;
  }
  flush();
  return root;
}

// Lays out one run of plain text (GetTextAsGlyphs). Returns new cursor.
function runText(text, size, pos, style, out) {
  let gx = size[0], gy = size[1];
  let cx = pos[0], cy = pos[1];
  if (style.sub || style.sup) {
    gx *= SUPER_SUB_SIZE; gy *= SUPER_SUB_SIZE;
    cy += gy * (style.sub ? SUB_OFFSET : SUPER_OFFSET);
  }
  const tilt = style.italic ? ITALIC_TILT : 0;
  for (const ch of text) {
    if (ch === ' ') { cx += Math.round(gx * SPACE_W() * 1e6) / 1e6; continue; }
    if (ch === '\t') { cx += gx * SPACE_W() * 4; continue; }
    let dd = ch.codePointAt(0) - 32;
    if (dd < 0 || dd >= table.length) dd = '?'.charCodeAt(0) - 32;
    const g = glyph(dd);
    if (out) for (const st of g.strokes) {
      out.push(st.map(([x, y]) => { x *= gx; y *= gy; if (tilt) x -= y * tilt; return [x + cx, y + cy]; }));
    }
    cx += g.width * gx;
  }
  return [cx, pos[1]];
}

function drawNode(node, pos, size, style, out) {
  let next = pos;
  let st = style;
  if (node.kind === 'sub') st = { ...style, sub: true };
  if (node.kind === 'super') st = { ...style, sup: true };
  if (node.kind === 'text') return runText(node.text, size, pos, style, out);
  for (const ch of node.children) next = drawNode(ch, next, size, st, out);
  if (node.kind === 'overbar' && out) {
    const trim = size[0] * 0.1, off = size[1] * OVERBAR_HEIGHT;
    out.push([[pos[0] + trim, pos[1] - off], [next[0] - trim, next[1] - off]]);
  }
  return next;
}

export function penWidth(t) {
  // EDA_TEXT::GetEffectiveTextPenWidth with GetPenSizeForBold (/5), GetPenSizeForNormal (/8),
  // ClampTextPenSize (min(size) * 0.25)
  const w = t.size[0];
  let pw = t.thickness;
  if (!(pw > 0.000001)) pw = t.bold ? w / 5 : w / 8;
  return Math.min(pw, Math.min(Math.abs(t.size[0]), Math.abs(t.size[1])) * 0.25);
}

// t: {text, pos:[x,y], size:[w,h], thickness, bold, italic, hjust:'left'|'center'|'right',
//     vjust:'top'|'center'|'bottom', mirror, angle (draw rotation, degrees), lineSpacing}
// returns { strokes: [[ [x,y], ... ], ...], width }
export function layoutText(t) {
  const lines = t.text.split('\n');
  const [w, h] = t.size;
  const interline = h * INTERLINE_PITCH * LEGACY_FACTOR * (t.lineSpacing || 1);
  const style = { italic: !!t.italic };
  const trees = lines.map(parseMarkup);
  const ext = trees.map(tr => drawNode(tr, [0, 0], t.size, style, null)[0]);
  let height = 0;
  for (let i = 0; i < lines.length; i++) height += i === 0 ? h * 1.17 : interline;
  const sw = t.thickness || 0;
  const off = [sw / 1.52, h - sw * 0.052];
  if (t.vjust === 'center') off[1] -= height / 2;
  else if (t.vjust === 'bottom') off[1] -= height;
  const strokes = [];
  for (let i = 0; i < lines.length; i++) {
    let lx = off[0];
    if (t.hjust === 'center') lx = -ext[i] / 2;
    else if (t.hjust === 'right') lx = -(ext[i] + off[0]);
    const p = [t.pos[0] + lx, t.pos[1] + off[1] + i * interline];
    const local = [];
    drawNode(trees[i], p, t.size, style, local);
    for (const s of local) strokes.push(s.map(([x, y]) => {
      if (t.mirror) x = t.pos[0] - (x - t.pos[0]);
      if (t.angle) { const r = rot(x - t.pos[0], y - t.pos[1], t.angle); x = r[0] + t.pos[0]; y = r[1] + t.pos[1]; }
      return [x, y];
    }));
  }
  return { strokes, width: penWidth(t) };
}
