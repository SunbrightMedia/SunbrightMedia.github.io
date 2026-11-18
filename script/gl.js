/*
 * FontLab GL: effects, drawn per pixel with WebGL.
 *
 * Effects are latched to a script or to a group of scripts. Each one is drawn on its own,
 * with transparency (premultiplied RGBA) carried through every pass, then layered over the
 * black stage in order:
 *
 *   script   its glyphs in their colours (Canvas 2D, then uploaded), then its effects in order
 *   group    its scripts (each with their own effects) layered together, then the group's
 *            effects over the whole group
 *
 * Every effect pass reads what is beneath it (the result so far) and writes a new result:
 *   heatmap   thermal colours inside the script and a heat glow around it
 *   kamisuki  "KamisukiNoise" (shadertoy.com/view/7clyWr): fill or erode the script
 *   ascii     characters in the colour of what is beneath (transparent between them): edges
 *             traced in characters shaped like them (| / \ _ ( ) ...), the rest by brightness;
 *             blur blurs what is beneath first, glow spills the characters' light around them
 *   posterize what is beneath, reduced to a number of levels per colour channel
 *
 * Blurs (of the script's coverage, or of what is beneath) are made on demand: halved with a
 * 4x4 box filter until the radius is a few texels, then two separable Gaussian passes.
 */
(function (root) {
  'use strict';

  // Heatmap colour scales. "thermal" follows the reference poster.
  const PALETTES = {
    thermal: [[0, '#1d1cff'], [0.15, '#5d1cff'], [0.3, '#a51cff'], [0.45, '#f01ce0'], [0.58, '#ff1f9a'], [0.7, '#ff3a55'], [0.8, '#ff5a1e'], [0.9, '#ff9a00'], [1, '#ffe800']],
    iron: [[0, '#000000'], [0.2, '#24095a'], [0.4, '#86157f'], [0.6, '#df3c2a'], [0.8, '#ffa21a'], [1, '#fffbe0']],
    arctic: [[0, '#00081f'], [0.3, '#0b2b8c'], [0.6, '#1aa6ff'], [0.85, '#a3eaff'], [1, '#ffffff']],
    'white hot': [[0, '#000000'], [1, '#ffffff']],
  };
  const hex = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0);
  function paletteColor(name, t) {
    const st = PALETTES[name] || PALETTES.thermal;
    t = Math.min(1, Math.max(0, t));
    for (let i = 1; i < st.length; i++) {
      if (t <= st[i][0]) {
        const a = hex(st[i - 1][1]), b = hex(st[i][1]), k = (t - st[i - 1][0]) / (st[i][0] - st[i - 1][0]);
        return [0, 1, 2].map(c => Math.round(a[c] + (b[c] - a[c]) * k));
      }
    }
    return hex(st[st.length - 1][1]);
  }

  // ASCII character sets. "ascii" is sorted by ink at load; "matrix" is the half-width katakana
  // and digits of the film's digital rain, drawn mirrored as they were there.
  const CHARSETS = {
    ascii: " .'`^\",:;Il!i><~+_¯-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    matrix: 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789Z:.=*+-<>¦',
  };
  // The characters that may trace an edge; in a set of your own (and in matrix) any may.
  const EDGE_CHARS = { ascii: "|/\\_¯-()[]<>'.,`^~\"" };
  const FAMILIES = {
    ascii: 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
    matrix: '"MS Gothic", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", "IPAGothic", "Yu Gothic", monospace',
  };

  const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  const DOWN = `precision highp float;
varying vec2 uv; uniform sampler2D src; uniform vec2 texel; uniform float prem;
vec4 tap(vec2 o) { vec4 s = texture2D(src, uv + texel * o); return prem > 0.5 ? vec4(s.rg * s.a, 0.0, s.a) : s; }
void main(){ gl_FragColor = 0.25 * (tap(vec2(-0.5, -0.5)) + tap(vec2(0.5, -0.5)) + tap(vec2(-0.5, 0.5)) + tap(vec2(0.5, 0.5))); }`;

  const BLUR = `precision highp float;
varying vec2 uv; uniform sampler2D src; uniform vec2 stepv;
void main(){
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -12; i <= 12; i++) { float x = float(i) / 4.0, w = exp(-0.5 * x * x); acc += texture2D(src, uv + stepv * float(i)) * w; ws += w; }
  gl_FragColor = acc / ws;
}`;

  const TEX = `precision highp float; varying vec2 uv; uniform sampler2D src; void main(){ gl_FragColor = texture2D(src, uv); }`;
  const FINAL = `precision highp float; varying vec2 uv; uniform sampler2D src; void main(){ gl_FragColor = vec4(texture2D(src, uv).rgb, 1.0); }`;

  // shared by the effect passes: screen to world mapping and value noise
  const COMMON = `precision highp float;
varying vec2 uv;
uniform vec2 res, origin;
uniform float scale, size, time;
uniform sampler2D prev, mask;
vec2 worldPos() { vec2 fc = gl_FragCoord.xy; return vec2(fc.x - origin.x, (res.y - fc.y) - origin.y) / scale; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
`;

  const HEAT = COMMON + `uniform sampler2D blur, lut;
uniform float core, mottle, glow;
vec3 pal(float t) { return texture2D(lut, vec2(clamp(t, 0.0, 1.0) * 0.996 + 0.002, 0.5)).rgb; }
void main() {
  vec4 m = texture2D(mask, uv), b = texture2D(blur, uv), pv = texture2D(prev, uv);
  float a = m.a, tb = b.a > 0.003 ? b.r / b.a : m.r;
  vec2 w = worldPos();
  float T = mix(m.r, tb, 0.35);
  T += core * (smoothstep(0.2, 0.95, b.a) - 0.45) * 0.7;              // thick stroke cores run hot
  T += mottle * (fbm(w * (4.5 / size) + vec2(m.g * 41.0, time * 0.12)) - 0.5) * 0.9;
  vec3 col = pal(clamp(T, 0.0, 1.0));
  vec3 halo = pal(clamp(tb * 0.85, 0.0, 1.0)) * smoothstep(0.0, 0.7, b.a) * glow * 0.8;
  float ha = clamp(max(max(halo.r, halo.g), halo.b), 0.0, 1.0);
  vec4 heat = vec4(col * a + halo * (1.0 - a), a + ha * (1.0 - a));
  // the heat colours replace the script itself; anything else beneath shows around it
  gl_FragColor = heat + pv * (1.0 - smoothstep(0.0, 0.35, a)) * (1.0 - heat.a);
}`;

  // Kamisuki noise, as in the original (hash22 by Dave_Hoskins, smin by iq).
  const KAMI = COMMON + `uniform sampler2D blur;
uniform float mode, kscale, waves, rotation, radius, gradient, blend, sharp, level, amount, cx, hw;
#define PI 3.14159265359
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float smin(float a, float b, float k) {
  k *= 6.0;
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k * (1.0 / 6.0);
}
float KamisukiNoise(vec2 p, float n, float a, float r, float k) {
  vec2 ip = floor(p + 0.5);
  float total = 8.0;
  for (int y = -2; y <= 2; y++)
  for (int x = -2; x <= 2; x++) {
    vec2 cell = ip + vec2(float(x), float(y));
    vec2 o = hash22(cell + 2.0) * 2.0 - 1.0;
    vec2 lp = p - cell;
    float d = length(lp) - r;
    float la = o.x * a;
    lp *= mat2(cos(la), sin(la), -sin(la), cos(la));
    d = -smin(-(sin(lp.y * PI * 2.0 * n) * 0.5 + 0.5), -d, k);
    total = smin(total, d, k);
  }
  return total;
}
void main() {
  vec4 pv = texture2D(prev, uv), m = texture2D(mask, uv);
  vec2 w = worldPos();
  float r = radius + gradient * clamp((w.x - cx) / hw, -1.0, 1.0);
  float v = KamisukiNoise(w / size * kscale, waves, rotation, r, max(blend, 1e-4));
  float aa = 1.5 * kscale / (size * scale);                           // one pixel, in noise units
  float pat = mix(clamp(v, 0.0, 1.0), smoothstep(level - aa, level + aa, v), sharp);
  float ins = smoothstep(0.0, 0.35, m.a);   // anti-aliased edge pixels count as inside, so no outline is left
  if (mode < 0.5) {
    gl_FragColor = pv * mix(1.0, mix(1.0, pat, clamp(amount, 0.0, 1.0)), ins);   // fill
  } else {
    // erode: the pattern's dark parts bite in from the edge; how deep depends on amount
    float inner = clamp((texture2D(blur, uv).a - 0.5) * 2.0, 0.0, 1.0); // 0 at the edge, 1 deep inside
    float keep = smoothstep(-0.03, 0.03, inner - (1.0 - pat) * amount * 0.5 + 0.04);
    gl_FragColor = pv * mix(1.0, keep, ins);
  }
}`;

  // ASCII. What is beneath is first turned into an edge map (how steeply its light changes, at
  // the scale of a character). Then, once per cell, the pick pass measures the cell's character box
  // in a 3x5 grid of patches. Where an edge crosses the cell, it picks the character whose ink lies
  // most like the edge does: a vertical edge through the middle gets a |, a diagonal a / or \, a
  // bottom edge an _, a curve a ( or ), a corner an L or a 7 (matrix: the katakana shaped most
  // alike, flickering between near matches). Elsewhere it picks by brightness. The tint pass takes
  // each cell's colour. The draw pass then shows the characters in the colour of what is beneath
  // them, transparent between them. Pitch spaces the grid without resizing the characters; below 1
  // they overlap their neighbours, so each pixel looks at the characters of the 3x3 cells around it.
  const DESC_X = 3, DESC_Y = 5;
  const ASCII_LIGHT = `uniform float gain;
float light(vec4 s) { s = clamp(s, 0.0, 1.0); return clamp((max(max(s.r, s.g), s.b) * 0.5 + dot(s.rgb, vec3(0.299, 0.587, 0.114)) * 0.5) * gain, 0.0, 1.0); }
vec2 toUV(vec2 w) { return vec2((w.x * scale + origin.x) / res.x, 1.0 - (w.y * scale + origin.y) / res.y); }
`;
  const ASCII_EDGE = COMMON + ASCII_LIGHT + `uniform sampler2D src;
uniform vec2 texel;
uniform float k;
void main() {
  vec2 dx = vec2(texel.x, 0.0), dy = vec2(0.0, texel.y);
  vec2 g = vec2(light(texture2D(src, uv + dx)) - light(texture2D(src, uv - dx)), light(texture2D(src, uv + dy)) - light(texture2D(src, uv - dy)));
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(length(g) * k, 0.0, 1.0));
}`;
  const ASCII_TINT = COMMON + ASCII_LIGHT + `uniform sampler2D srcA;
uniform vec2 c0, gap, box;
void main() {
  vec2 corner = (c0 + floor(gl_FragCoord.xy) + 0.5) * gap - 0.5 * box;
  vec3 sum = vec3(0.0); float sa = 0.0, ma = 0.0;
  for (int b = 0; b < 5; b++) for (int a = 0; a < 3; a++) {
    vec4 c = clamp(texture2D(srcA, toUV(corner + vec2((float(a) + 0.5) / 3.0, (float(b) + 0.5) / 5.0) * box)), 0.0, 1.0);
    sum += c.rgb; sa += c.a; ma = max(ma, c.a);
  }
  gl_FragColor = vec4(sa > 0.0 ? min(sum / sa, 1.0) : vec3(0.0), ma);   // colour, and how opaque the cell gets
}`;
  const ASCII_PICK = COMMON + ASCII_LIGHT + `uniform sampler2D srcA, edgeT, desc;
uniform vec2 c0, gap, box;
uniform float count, edges, matrix, flicker;
float h1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// how unlike character k is to the cell (t, also packed as t0..t3, of length tn); 1e9 if it may not be used
float costOf(float k, bool edge, float t[16], vec4 t0, vec4 t1, vec4 t2, vec4 t3, float tn) {
  float y = (k + 0.5) / count;
  vec4 d0 = texture2D(desc, vec2(0.125, y)), d1 = texture2D(desc, vec2(0.375, y)), d2 = texture2D(desc, vec2(0.625, y)), d3 = texture2D(desc, vec2(0.875, y));
  if (edge && d3.w < 0.5) return 1e9;   // only line characters trace edges
  d3.w = 0.0;
  if (!edge) {   // away from edges: the closest light, patch by patch
    vec4 e0 = d0 - t0, e1 = d1 - t1, e2 = d2 - t2, e3 = d3 - t3;
    return dot(e0, e0) + dot(e1, e1) + dot(e2, e2) + dot(e3, e3);
  }
  // edges: the most alike shape, whatever its amount of ink. The upright strokes of a monospace
  // font all stand in the middle of the box, so an edge along a side may also be matched one
  // column over, a little less readily: an edge near the side still gets a |, not the serif of
  // a bracket.
  float dd[16];
  dd[0] = d0.x; dd[1] = d0.y; dd[2] = d0.z; dd[3] = d0.w; dd[4] = d1.x; dd[5] = d1.y; dd[6] = d1.z; dd[7] = d1.w;
  dd[8] = d2.x; dd[9] = d2.y; dd[10] = d2.z; dd[11] = d2.w; dd[12] = d3.x; dd[13] = d3.y; dd[14] = d3.z; dd[15] = 0.0;
  float here = 0.0, fromL = 0.0, fromR = 0.0, dn = 0.0;
  for (int r = 0; r < 5; r++) for (int a = 0; a < 3; a++) {
    float x = dd[r * 3 + a];
    dn += x * x; here += x * t[r * 3 + a];
    if (a > 0) fromL += x * t[r * 3 + a - 1];
    if (a < 2) fromR += x * t[r * 3 + a + 1];
  }
  return 1.0 - max(here, 0.85 * max(fromL, fromR)) / (sqrt(dn) * tn + 1e-4);
}
void main() {
  vec2 cell = c0 + floor(gl_FragCoord.xy);
  vec2 corner = (cell + 0.5) * gap - 0.5 * box;   // top left of the character box (world, y down)
  float c[16], e[16];
  float mc = 0.0, lc = 1.0, me = 0.0;
  for (int b = 0; b < 5; b++) for (int a = 0; a < 3; a++) {   // light and edge of each patch, 3x3 samples each
    float sl = 0.0, se = 0.0;
    for (int q = 0; q < 3; q++) for (int r = 0; r < 3; r++) {
      vec2 l = toUV(corner + vec2((float(a) + (float(r) + 0.5) / 3.0) / 3.0, (float(b) + (float(q) + 0.5) / 3.0) / 5.0) * box);
      sl += light(texture2D(srcA, l)); se += texture2D(edgeT, l).a;
    }
    c[b * 3 + a] = sl / 9.0; e[b * 3 + a] = se / 9.0;
    mc = max(mc, sl / 9.0); lc = min(lc, sl / 9.0); me = max(me, se / 9.0);
  }
  c[15] = 0.0; e[15] = 0.0;
  // an edge: light changes steeply here and within the cell, drawn by the cell on its lit side only
  bool edge = me * edges > 0.3 && mc > 0.25 && (mc - lc) * edges > 0.3;
  if (mc < 0.06 && !edge) { gl_FragColor = vec4(0.0); return; }   // near-black stays blank
  // matrix: every cell swaps its character flicker times a second on average (each at its own pace)
  float tick = floor(time * flicker * (0.3 + h1(cell + 3.1) * 1.4) + h1(cell) * 13.0);
  if (matrix > 0.5 && !edge) {   // inside: any character, as in the film
    gl_FragColor = vec4(floor(h1(cell + tick * 0.6131) * count) / 255.0, 1.0, 0.0, 1.0);
    return;
  }
  float t[16];
  for (int k = 0; k < 16; k++) t[k] = edge ? e[k] / me : c[k];
  vec4 t0 = vec4(t[0], t[1], t[2], t[3]), t1 = vec4(t[4], t[5], t[6], t[7]), t2 = vec4(t[8], t[9], t[10], t[11]), t3 = vec4(t[12], t[13], t[14], t[15]);
  float tn = sqrt(dot(t0, t0) + dot(t1, t1) + dot(t2, t2) + dot(t3, t3));
  float best = 1e9, bi = 0.0;
  for (int k = 0; k < 256; k++) {
    if (float(k) >= count) break;
    float cost = costOf(float(k), edge, t, t0, t1, t2, t3, tn);
    if (cost < best) { best = cost; bi = float(k); }
  }
  if (matrix > 0.5) {   // edges in matrix: swap between the characters nearly as alike as the best
    float pick = -1.0;
    for (int k = 0; k < 256; k++) {
      if (float(k) >= count) break;
      if (costOf(float(k), edge, t, t0, t1, t2, t3, tn) > best + 0.1) continue;
      float r = h1(cell * 1.13 + vec2(float(k) * 7.31, tick));
      if (r > pick) { pick = r; bi = float(k); }
    }
  }
  gl_FragColor = vec4(bi / 255.0, 1.0, edge ? 1.0 : 0.0, 1.0);
}`;
  const ASCII = COMMON + `uniform sampler2D srcA, atlas, pick, tint;
uniform vec2 cellUV, inset0, insetSize, c0, grid;
uniform float cols, cellW, cellH, pitch, mode, rain;
float h1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// the character picked for a cell, or -1 for a blank cell; bright dims matrix trails, burn whitens their heads
float charOf(vec2 cell, out float bright, out float burn) {
  bright = 1.0; burn = 0.0;
  vec4 p = texture2D(pick, (cell - c0 + 0.5) / grid);
  if (p.g < 0.5) return -1.0;
  if (mode > 0.5) {   // rain: drops of light run down each column, white at the head, fading behind
    float speed = 4.0 + h1(vec2(cell.x, 7.7)) * 10.0;    // rows a second
    float period = 16.0 + h1(vec2(cell.x, 4.4)) * 28.0;  // rows from one drop to the next
    float len = 3.0 + h1(vec2(cell.x, 2.3)) * 9.0;       // trail length, rows
    float d = mod(time * speed + h1(vec2(cell.x, 9.1)) * period - cell.y, period);   // rows behind the head
    bright = mix(1.0, 0.04 + 0.96 * exp(-d / len), rain);
    burn = smoothstep(1.5, 0.0, d) * rain;
  }
  return floor(p.r * 255.0 + 0.5);
}
void main() {
  vec2 box = vec2(cellW, cellH), gap = box * pitch, w = worldPos();
  vec2 home = floor(w / gap);
  float best = 0.0, burnBest = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (pitch >= 1.0 && (i != 0 || j != 0)) continue;   // characters fit inside their own cell
    vec2 cell = home + vec2(float(i), float(j));
    vec2 local = (w - (cell + 0.5) * gap) / box + 0.5;
    if (local.x < 0.0 || local.y < 0.0 || local.x > 1.0 || local.y > 1.0) continue;
    float bright, burn, idx = charOf(cell, bright, burn);
    if (idx < 0.0) continue;
    vec2 lc = inset0 + local * insetSize;   // sample inside the cell's margin, so neighbours never bleed in
    float a = texture2D(atlas, vec2((mod(idx, cols) + lc.x) * cellUV.x, (floor(idx / cols) + lc.y) * cellUV.y)).a * bright;
    if (a > best) { best = a; burnBest = burn; }
  }
  // the colour of what is beneath: this very pixel, or, where a character reaches past the edge of
  // what is beneath (an outline character), the colour of its cell
  vec4 tc = texture2D(tint, (floor(w / gap) - c0 + 0.5) / grid);
  vec4 o = max(clamp(texture2D(srcA, uv), 0.0, 1.0), vec4(tc.rgb * tc.a, tc.a)) * best;
  gl_FragColor = vec4(mix(o.rgb, vec3(o.a), burnBest), o.a);
}`;

  // Glow: the light of the layer below (here, the ASCII characters) spilled out around it.
  const BLOOM = COMMON + `uniform sampler2D src, spill;
uniform float amount;
void main() { gl_FragColor = min(texture2D(src, uv) + texture2D(spill, uv) * amount, 1.0); }`;

  // Posterize: each colour channel of what is beneath snapped to n levels; transparency is kept.
  const POSTER = COMMON + `uniform float levels;
void main() {
  vec4 pv = texture2D(prev, uv);
  if (pv.a < 0.002) { gl_FragColor = pv; return; }
  float n = max(levels, 2.0) - 1.0;
  vec3 c = floor(clamp(pv.rgb / pv.a, 0.0, 1.0) * n + 0.5) / n;
  gl_FragColor = vec4(c * pv.a, pv.a);
}`;

  function create() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) return null;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const program = fs => {
      const pr = gl.createProgram();
      gl.attachShader(pr, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      const u = {}, n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(pr, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(pr, info.name); }
      return { pr, u };
    };
    const P = {};
    for (const [k, src] of Object.entries({ down: DOWN, blur: BLUR, tex: TEX, final: FINAL, heatmap: HEAT, kamisuki: KAMI, ascii: ASCII, asciiPick: ASCII_PICK, asciiEdge: ASCII_EDGE, asciiTint: ASCII_TINT, bloom: BLOOM, posterize: POSTER })) P[k] = program(src);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const texture = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    const target = () => ({ tex: texture(), fb: gl.createFramebuffer(), w: 0, h: 0 });
    const sizeTarget = (T, w, h) => {
      if (T.w === w && T.h === h) return T;
      T.w = w; T.h = h;
      gl.bindTexture(gl.TEXTURE_2D, T.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.tex, 0);
      return T;
    };
    const fixed = { acc: target(), p0: target(), p1: target(), g0: target(), g1: target() };
    const nearest = () => { // exact texel lookups (clamped, which WebGL 1 needs for sizes that are not powers of two)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    };
    const pickT = target(), tintT = target(); // one texel per ASCII cell: which character it shows, in which colour
    for (const T of [pickT, tintT]) { gl.bindTexture(gl.TEXTURE_2D, T.tex); nearest(); }
    const maskTex = texture(), colorTex = texture(), lutTex = texture(), pool = [];
    let poolUsed = 0, lutName = null;
    const mcv = document.createElement('canvas'), mctx = mcv.getContext('2d');
    const gcv = document.createElement('canvas'), gctx = gcv.getContext('2d'); // one glyph at a time, for transitions

    // bind a program and set uniforms by name: numbers, [x, y], [r, g, b] or textures
    function use(prog, uniforms) {
      const p = P[prog];
      gl.useProgram(p.pr);
      let unit = 0;
      for (const name in uniforms) {
        const loc = p.u[name];
        if (!loc) continue;
        const v = uniforms[name];
        if (v instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v); gl.uniform1i(loc, unit++); }
        else if (typeof v === 'number') gl.uniform1f(loc, v);
        else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      }
    }
    const draw = (T, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, T ? T.fb : null); gl.viewport(0, 0, T ? T.w : w, T ? T.h : h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    const clear = T => { gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.viewport(0, 0, T.w, T.h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };
    const over = (srcTex, T) => { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); use('tex', { src: srcTex }); draw(T); gl.disable(gl.BLEND); };

    const scratch = (w, h) => { const T = sizeTarget(pool[poolUsed] || (pool[poolUsed] = target()), w, h); poolUsed++; return T; };
    // blur any full-resolution texture (prem: premultiply a coverage mask first)
    function blurOf(src, W, H, sigma, prem) {
      sigma = Math.max(0.75, sigma);
      const L = Math.max(1, Math.min(6, Math.ceil(Math.log2(sigma / 6))));
      let cur = { tex: src, w: W, h: H };
      for (let l = 1; l <= L; l++) {
        const T = sizeTarget(pool[poolUsed] || (pool[poolUsed] = target()), Math.max(1, Math.ceil(cur.w / 2)), Math.max(1, Math.ceil(cur.h / 2)));
        poolUsed++;
        use('down', { src: cur.tex, texel: [1 / cur.w, 1 / cur.h], prem: l === 1 && prem ? 1 : 0 });
        draw(T);
        cur = T;
      }
      const A = sizeTarget(pool[poolUsed] || (pool[poolUsed] = target()), cur.w, cur.h); poolUsed++;
      const B = sizeTarget(pool[poolUsed] || (pool[poolUsed] = target()), cur.w, cur.h); poolUsed++;
      use('blur', { src: cur.tex, stepv: [sigma / 4 / W, 0] }); draw(A);
      use('blur', { src: A.tex, stepv: [0, sigma / 4 / H] }); draw(B);
      return B.tex;
    }

    // Character atlases: 16 columns of cells, drawn at about the size a cell has on screen (in
    // steps), so no mipmaps are needed: mipmaps would draw a faint box around every character,
    // because the lookup jumps across the atlas from one cell to the next. A cell on screen is
    // one character box of the set: as wide as its widest character and as tall as its tallest,
    // like a terminal, so a | spans the whole height and an _ sits on the bottom. Around each box
    // is a transparent margin that is never sampled, so neighbours cannot bleed in.
    const MARGIN = 0.15;
    const orders = new Map();
    function charList(mode, chars) { // ascii: sorted by ink, emptiest first, starting with a blank
      const set = chars && chars.length ? chars : CHARSETS[mode] || CHARSETS.ascii, key = mode + '\u0000' + set;
      if (orders.has(key)) return orders.get(key);
      let list = [...new Set([...set])];
      if (mode === 'matrix') list = list.filter(c => c !== ' ');
      else {
        if (!list.includes(' ')) list.unshift(' ');
        const cv = document.createElement('canvas'); cv.width = 64; cv.height = 96;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 46px ${FAMILIES.ascii}`;
        const ink = list.map(c => {
          ctx.clearRect(0, 0, 64, 96); ctx.fillText(c, 32, 48);
          const d = ctx.getImageData(0, 0, 64, 96).data; let s = 0;
          for (let i = 3; i < d.length; i += 4) s += d[i];
          return s;
        });
        list = list.map((c, i) => [c, ink[i]]).sort((a, b) => a[1] - b[1]).map(e => e[0]);
      }
      list = list.slice(0, 256);
      orders.set(key, list);
      return list;
    }
    const weightOf = mode => (mode === 'matrix' ? 500 : 600), familyOf = mode => FAMILIES[mode] || FAMILIES.ascii;
    const metricsOf = new Map();
    function metrics(mode, chars) { // the set's character box at a 100 px font
      const list = charList(mode, chars), key = mode + '\u0000' + chars;
      if (metricsOf.has(key)) return metricsOf.get(key);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${weightOf(mode)} 100px ${familyOf(mode)}`;
      let adv = 1, A = 1, D = 0;
      for (const c of list) {
        const m = ctx.measureText(c);
        adv = Math.max(adv, m.width); A = Math.max(A, m.actualBoundingBoxAscent || 0); D = Math.max(D, m.actualBoundingBoxDescent || 0);
      }
      const out = { adv, A, D };
      metricsOf.set(key, out);
      return out;
    }
    // the set drawn into a canvas, B px per character box width
    function cellsCanvas(mode, chars, B) {
      const list = charList(mode, chars), m = metrics(mode, chars), k = B / m.adv;
      const ww = B, wh = Math.max(1, Math.ceil((m.A + m.D) * k)), mg = Math.ceil(B * MARGIN);
      const cw = ww + 2 * mg, ch = wh + 2 * mg, cols = 16, rows = Math.max(1, Math.ceil(list.length / cols));
      const cv = document.createElement('canvas'); cv.width = cols * cw; cv.height = rows * ch;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `${weightOf(mode)} ${(100 * k).toFixed(2)}px ${familyOf(mode)}`;
      list.forEach((c, i) => {
        ctx.save(); ctx.translate((i % cols) * cw + cw / 2, Math.floor(i / cols) * ch + mg + m.A * k);
        if (mode === 'matrix') ctx.scale(-1, 1); // mirrored, as in the film
        ctx.fillText(c, 0, 0); ctx.restore();
      });
      return { cv, ctx, list, cols, cw, ch, ww, wh, mg, inset0: [mg / cw, mg / ch], insetSize: [ww / cw, wh / ch], aspect: wh / ww };
    }

    // The shape of every character: how much of each patch of a 3x5 grid over its box its ink
    // covers, scaled so the fullest patch of the set is 1, as 4 RGBA texels per character; the
    // last slot says whether it may trace an edge.
    const descs = new Map();
    function descriptors(mode, chars) {
      const key = mode + '\u0000' + chars;
      if (descs.has(key)) return descs.get(key);
      const c = cellsCanvas(mode, chars, 48), d = c.ctx.getImageData(0, 0, c.cv.width, c.cv.height).data;
      const pw = c.ww / DESC_X, ph = c.wh / DESC_Y, area = pw * ph;
      let max = 1e-6;
      const raw = c.list.map((_, i) => {
        const x0 = (i % c.cols) * c.cw + c.mg, y0 = Math.floor(i / c.cols) * c.ch + c.mg, v = new Float32Array(16);
        for (let y = 0; y < c.wh; y++) for (let x = 0; x < c.ww; x++)
          v[Math.min(DESC_Y - 1, Math.floor((y + 0.5) / ph)) * DESC_X + Math.min(DESC_X - 1, Math.floor((x + 0.5) / pw))] += d[((y0 + y) * c.cv.width + x0 + x) * 4 + 3] / 255 / area;
        for (let j = 0; j < 15; j++) max = Math.max(max, v[j]);
        return v;
      });
      const data = new Uint8Array(c.list.length * 16), edgeSet = !chars && EDGE_CHARS[mode];
      raw.forEach((v, k) => {
        for (let j = 0; j < 15; j++) data[k * 16 + j] = Math.round(Math.min(1, v[j] / max) * 255);
        data[k * 16 + 15] = c.list[k] !== ' ' && (!edgeSet || edgeSet.includes(c.list[k])) ? 255 : 0; // may trace an edge
      });
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, c.list.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      nearest();
      const out = { tex, count: c.list.length };
      descs.set(key, out);
      if (descs.size > 12) { const [k0, d0] = descs.entries().next().value; gl.deleteTexture(d0.tex); descs.delete(k0); }
      return out;
    }
    const atlases = new Map();
    function atlas(mode, chars, cellPx) {
      const B = [8, 12, 16, 24, 32, 48, 64, 96].find(b => b >= cellPx * 0.95) || 96, key = mode + '\u0000' + chars + '\u0000' + B;
      if (atlases.has(key)) return atlases.get(key);
      const c = cellsCanvas(mode, chars, B);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c.cv);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const at = { tex, count: c.list.length, cols: c.cols, cellUV: [c.cw / c.cv.width, c.ch / c.cv.height], inset0: c.inset0, insetSize: c.insetSize, aspect: c.aspect };
      atlases.set(key, at);
      if (atlases.size > 24) { const [k0, a0] = atlases.entries().next().value; gl.deleteTexture(a0.tex); atlases.delete(k0); }
      return at;
    }

    // o: { W, H, s, ox, oy } device pixels and world->device mapping; glyphD and style per glyph;
    // fills: default colour per glyph; holes: warp holes; reveal: what transitions show of each glyph;
    // units: what to draw, in order:
    //   { kind: 'script', glyphs, records, size } or { kind: 'group', members: [scripts], glyphs, records, size }
    function render(o) {
      const { W, H, s, ox, oy } = o;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      if (mcv.width !== W || mcv.height !== H) { mcv.width = W; mcv.height = H; }
      for (const k in fixed) sizeTarget(fixed[k], W, H);
      poolUsed = 0;
      const holes = o.holes ? new Path2D(o.holes) : null;
      const paths = o.glyphD.map(d => (d ? new Path2D(d) : null));
      const common = { res: [W, H], origin: [ox, oy], scale: s, time: o.time };

      const upload = (tex, premultiply) => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mcv);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      };
      const begin = () => {
        mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalCompositeOperation = 'source-over'; mctx.globalAlpha = 1;
        mctx.clearRect(0, 0, W, H); mctx.setTransform(s, 0, 0, s, ox, oy);
      };
      const cutHoles = () => { if (holes) { mctx.globalAlpha = 1; mctx.globalCompositeOperation = 'destination-out'; mctx.fill(holes); } };
      // Draw one glyph with fn(ctx). A transition may show only part of it: o.reveal[gi] is 0
      // (nothing) or { cv, x, y, w, h }, a mask in world units; then the glyph is drawn on its own
      // and masked before it joins the rest.
      function drawGlyph(gi, fn) {
        const rv = o.reveal && o.reveal[gi];
        if (rv === 0) return;
        if (!rv) { fn(mctx); return; }
        const x0 = Math.floor(rv.x * s + ox) - 2, y0 = Math.floor(rv.y * s + oy) - 2;
        const gw = Math.max(1, Math.ceil(rv.w * s) + 4), gh = Math.max(1, Math.ceil(rv.h * s) + 4);
        if (x0 > W || y0 > H || x0 + gw < 0 || y0 + gh < 0) return;
        if (gcv.width < gw || gcv.height < gh) { gcv.width = Math.max(gcv.width, gw); gcv.height = Math.max(gcv.height, gh); }
        gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalCompositeOperation = 'source-over'; gctx.globalAlpha = 1;
        gctx.clearRect(0, 0, gw, gh);
        gctx.setTransform(s, 0, 0, s, ox - x0, oy - y0);
        fn(gctx);
        gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalAlpha = 1; gctx.globalCompositeOperation = 'destination-in'; gctx.imageSmoothingEnabled = true;
        gctx.drawImage(rv.cv, rv.x * s + ox - x0, rv.y * s + oy - y0, rv.w * s, rv.h * s);
        gctx.clearRect(gw, 0, gcv.width - gw, gcv.height); gctx.clearRect(0, gh, gw, gcv.height - gh);
        gctx.globalCompositeOperation = 'source-over';
        mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalAlpha = 1; mctx.globalCompositeOperation = 'source-over';
        mctx.drawImage(gcv, 0, 0, gw, gh, x0, y0, gw, gh);
        mctx.restore();
      }

      // the glyphs in their own colours (fill, outline, opacity from the Style modifier)
      function colorOf(glyphs) {
        begin();
        for (const gi of glyphs) {
          const p = paths[gi];
          if (!p) continue;
          const st = o.style[gi] || {}, fill = st.fill != null ? st.fill : o.fills[gi];
          drawGlyph(gi, c => {
            c.globalAlpha = st.opacity != null ? Math.max(0, Math.min(1, st.opacity)) : 1;
            if (fill && fill !== 'none') { c.fillStyle = fill; c.fill(p); }
            if (st.stroke != null && st.stroke !== 'none') { c.strokeStyle = st.stroke; c.lineWidth = st.sw != null ? st.sw : 1; c.lineJoin = 'round'; c.stroke(p); }
          });
        }
        cutHoles();
        upload(colorTex, true);
        return colorTex;
      }
      // coverage of the glyphs, with the heatmap temperature (red) and a random id (green)
      function maskOf(glyphs, records) {
        const heat = records.find(r => r.type === 'heatmap');
        begin();
        for (const gi of glyphs) {
          const p = paths[gi];
          if (!p) continue;
          const T = heat && !isNaN(heat.temps[gi]) ? heat.temps[gi] : 0.5;
          const id = Math.abs((Math.sin(gi * 12.9898 + 4.1) * 43758.5453) % 1);
          drawGlyph(gi, c => { c.fillStyle = `rgb(${Math.round(T * 255)},${Math.round(id * 255)},0)`; c.fill(p); });
        }
        cutHoles();
        upload(maskTex, false);
      }

      // run a unit's effects over the texture in A, ping-ponging with B; returns the result target
      function effects(u, A, B) {
        if (!u.records.length) return A;
        maskOf(u.glyphs, u.records);
        const maskBlurs = new Map();
        const maskBlur = sigma => { const k = Math.round(sigma * 2); if (!maskBlurs.has(k)) maskBlurs.set(k, blurOf(maskTex, W, H, sigma, true)); return maskBlurs.get(k); };
        let cur = A, other = B;
        for (const r of u.records) {
          const un = Object.assign({ prev: cur.tex, mask: maskTex, size: u.size }, common, r.time != null ? { time: r.time } : null);
          if (r.type === 'heatmap') {
            if (lutName !== r.palette) {
              lutName = r.palette;
              const data = new Uint8Array(256 * 4);
              for (let i = 0; i < 256; i++) { const c = paletteColor(lutName, i / 255); data.set([c[0], c[1], c[2], 255], i * 4); }
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
              gl.bindTexture(gl.TEXTURE_2D, lutTex);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
            }
            Object.assign(un, { blur: maskBlur(r.spread * u.size * s), lut: lutTex, core: r.core, mottle: r.mottle, glow: r.glow });
          } else if (r.type === 'kamisuki') {
            Object.assign(un, {
              blur: maskBlur(0.05 * u.size * s), mode: r.mode === 'erode' ? 1 : 0, kscale: r.scale, waves: r.waves, rotation: r.rotation,
              radius: r.radius, gradient: r.gradient, blend: r.blend, sharp: r.sharp, level: r.level, amount: r.amount, cx: r.cx, hw: r.hw,
            });
          } else if (r.type === 'ascii') {
            const cellW = Math.max(u.size / Math.max(0.5, r.resolution), 2 / s), at = atlas(r.mode, r.chars, cellW * s), ds = descriptors(r.mode, r.chars);
            const cellH = cellW * at.aspect, gap = [cellW * r.pitch, cellH * r.pitch];
            const c0 = [Math.floor(-ox / s / gap[0]) - 1, Math.floor(-oy / s / gap[1]) - 1];   // the cells covering the screen, plus one around
            const grid = [Math.ceil(W / s / gap[0]) + 3, Math.ceil(H / s / gap[1]) + 3];
            const beneath = r.blur > 0 ? blurOf(cur.tex, W, H, r.blur * 0.15 * u.size * s, false) : cur.tex;   // blur what is beneath
            const cell = { c0, gap, box: [cellW, cellH], gain: r.gain };
            const eSigma = Math.max(1, cellW * s / 6), soft = blurOf(beneath, W, H, eSigma, false), edgeT = scratch(W, H);
            use('asciiEdge', Object.assign({ src: soft, texel: [1.5 / W, 1.5 / H], k: eSigma * 2.5 / 3, gain: r.gain }, common));
            draw(edgeT);
            sizeTarget(tintT, grid[0], grid[1]);
            use('asciiTint', Object.assign({ srcA: beneath }, cell, common));
            draw(tintT);
            sizeTarget(pickT, grid[0], grid[1]);
            use('asciiPick', Object.assign({ srcA: beneath, edgeT: edgeT.tex, desc: ds.tex, count: ds.count, edges: r.edges,
              matrix: r.mode === 'matrix' ? 1 : 0, flicker: r.flicker }, cell, common));
            draw(pickT);
            Object.assign(un, {
              srcA: beneath, pick: pickT.tex, tint: tintT.tex, c0, grid, atlas: at.tex, cellUV: at.cellUV, inset0: at.inset0, insetSize: at.insetSize, cols: at.cols,
              cellW, cellH, pitch: r.pitch, mode: r.mode === 'matrix' ? 1 : 0, rain: r.rain,
            });
            use('ascii', un);
            draw(other);
            if (r.glow > 0) { // the light through the characters spills out around them; the result lands back in cur
              use('bloom', Object.assign({ src: other.tex, spill: blurOf(other.tex, W, H, (0.03 + 0.17 * r.glow) * u.size * s, false), amount: r.glow * 2.5 }, common));
              draw(cur);
            } else [cur, other] = [other, cur];
            continue;
          } else if (r.type === 'posterize') {
            un.levels = r.levels;
          } else continue;
          use(r.type, un);
          draw(other);
          [cur, other] = [other, cur];
        }
        return cur;
      }

      function script(u) {
        const tex = colorOf(u.glyphs);
        clear(fixed.p0);
        use('tex', { src: tex }); draw(fixed.p0);
        return effects(u, fixed.p0, fixed.p1);
      }

      clear(fixed.acc);
      for (const u of o.units) {
        let result;
        if (u.kind === 'group') {
          clear(fixed.g0);
          for (const m of u.members) over(script(m).tex, fixed.g0);
          result = effects(u, fixed.g0, fixed.g1);
        } else result = script(u);
        over(result.tex, fixed.acc);
      }
      use('final', { src: fixed.acc.tex });
      draw(null, W, H);
      return canvas;
    }

    return { canvas, render };
  }

  root.FontLabGL = { create, PALETTES, CHARSETS, paletteColor };
})(window);
