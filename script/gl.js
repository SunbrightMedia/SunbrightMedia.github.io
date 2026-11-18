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
 *   ascii     characters coloured by what is beneath, transparent between them; blur and
 *             glow act on what is beneath before it is turned into characters
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
    ascii: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    matrix: 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789Z:.=*+-<>¦',
  };
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

  // ASCII: a grid of characters, each coloured by what is beneath its cell and chosen by how
  // bright that is (ascii), or random and flickering with falling rain (matrix).
  const ASCII = COMMON + `uniform sampler2D srcA, srcG, atlas;
uniform vec2 cellUV, inset0, insetSize;
uniform float glow, cols, count, cellW, cellH, mode, gain, rain, flicker;
float h1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 toUV(vec2 w) { return vec2((w.x * scale + origin.x) / res.x, 1.0 - (w.y * scale + origin.y) / res.y); }
void main() {
  vec2 cs = vec2(cellW, cellH), g = worldPos() / cs;
  vec2 cell = floor(g), local = fract(g);
  vec2 cuv = toUV((cell + 0.5) * cs);
  vec4 s = texture2D(srcA, cuv);
  if (glow > 0.0) s += texture2D(srcG, cuv) * glow * 1.15 * (1.0 - s.a);  // what is beneath spills out
  s = clamp(s, 0.0, 1.0);
  float L = clamp((max(max(s.r, s.g), s.b) * 0.5 + dot(s.rgb, vec3(0.299, 0.587, 0.114)) * 0.5) * gain, 0.0, 1.0);
  vec3 col = s.a > 0.002 ? clamp(s.rgb / s.a, 0.0, 1.0) : vec3(1.0);
  float idx, bright = 1.0;
  if (mode < 0.5) {
    idx = floor(smoothstep(0.06, 1.0, L) * (count - 1.0) + 0.5);   // near-black stays blank
    if (idx < 0.5) { gl_FragColor = vec4(0.0); return; }
  } else {
    if (L < 0.06) { gl_FragColor = vec4(0.0); return; }
    float tick = floor(time * flicker * (0.5 + h1(cell + 3.1) * 3.0) + h1(cell) * 13.0);
    idx = floor(h1(cell + tick * 0.6131) * count);
    float speed = 5.0 + h1(vec2(cell.x, 7.7)) * 12.0, len = 5.0 + h1(vec2(cell.x, 2.3)) * 14.0;
    float d = mod(time * speed + h1(vec2(cell.x, 9.1)) * 60.0 - cell.y, 60.0);  // cells below the falling head
    bright = L * mix(1.0, 0.3 + 0.7 * exp(-d / len), rain);
    col = mix(col, vec3(1.0), smoothstep(1.2, 0.0, d) * rain * 0.75);          // the leading glyph burns white
  }
  vec2 lc = inset0 + local * insetSize;   // sample inside the cell's margin, so neighbours never bleed in
  float a = texture2D(atlas, vec2((mod(idx, cols) + lc.x) * cellUV.x, (floor(idx / cols) + lc.y) * cellUV.y)).a;
  gl_FragColor = vec4(col, 1.0) * a * bright;
}`;

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
    for (const [k, src] of Object.entries({ down: DOWN, blur: BLUR, tex: TEX, final: FINAL, heatmap: HEAT, kamisuki: KAMI, ascii: ASCII, posterize: POSTER })) P[k] = program(src);

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
    const maskTex = texture(), colorTex = texture(), lutTex = texture(), pool = [];
    let poolUsed = 0, lutName = null;
    const mcv = document.createElement('canvas'), mctx = mcv.getContext('2d');

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

    // Character atlases: 16 columns of cells 1.5 times taller than wide, drawn at about the size
    // a cell has on screen (in steps), so no mipmaps are needed: mipmaps would draw a faint box
    // around every character, because the lookup jumps across the atlas from one cell to the next.
    // Glyphs sit inside a transparent margin that is never sampled, so neighbours cannot bleed in.
    const INSET0 = [0.09, 0.1], INSET = [0.82, 0.8];
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
    const atlases = new Map();
    function atlas(mode, chars, cellPx) {
      const B = [8, 12, 16, 24, 32, 48, 64, 96].find(b => b * INSET[0] >= cellPx * 0.95) || 96;
      const list = charList(mode, chars), key = mode + '\u0000' + chars + '\u0000' + B;
      if (atlases.has(key)) return atlases.get(key);
      const cw = B, ch = Math.round(B * 1.5), cols = 16, rows = Math.max(1, Math.ceil(list.length / cols));
      const cv = document.createElement('canvas'); cv.width = cols * cw; cv.height = rows * ch;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${mode === 'matrix' ? 500 : 600} ${Math.round(B * 0.72)}px ${FAMILIES[mode] || FAMILIES.ascii}`;
      list.forEach((c, i) => {
        ctx.save(); ctx.translate((i % cols) * cw + cw / 2, Math.floor(i / cols) * ch + ch / 2);
        if (mode === 'matrix') ctx.scale(-1, 1); // mirrored, as in the film
        ctx.fillText(c, 0, 0); ctx.restore();
      });
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const at = { tex, count: list.length, cols, cellUV: [cw / cv.width, ch / cv.height], inset0: INSET0, insetSize: INSET, aspect: (1.5 * INSET[1]) / INSET[0] };
      atlases.set(key, at);
      if (atlases.size > 24) { const [k0, a0] = atlases.entries().next().value; gl.deleteTexture(a0.tex); atlases.delete(k0); }
      return at;
    }

    // o: { W, H, s, ox, oy } device pixels and world->device mapping; glyphD and style per glyph;
    // fills: default colour per glyph; holes: warp holes; units: what to draw, in order:
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

      // the glyphs in their own colours (fill, outline, opacity from the Style modifier)
      function colorOf(glyphs) {
        begin();
        for (const gi of glyphs) {
          const p = paths[gi];
          if (!p) continue;
          const st = o.style[gi] || {}, fill = st.fill != null ? st.fill : o.fills[gi];
          mctx.globalAlpha = st.opacity != null ? Math.max(0, Math.min(1, st.opacity)) : 1;
          if (fill && fill !== 'none') { mctx.fillStyle = fill; mctx.fill(p); }
          if (st.stroke != null && st.stroke !== 'none') { mctx.strokeStyle = st.stroke; mctx.lineWidth = st.sw != null ? st.sw : 1; mctx.lineJoin = 'round'; mctx.stroke(p); }
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
          mctx.fillStyle = `rgb(${Math.round(T * 255)},${Math.round(id * 255)},0)`;
          mctx.fill(p);
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
          const un = Object.assign({ prev: cur.tex, mask: maskTex, size: u.size }, common);
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
            const cellW = u.size / Math.max(0.5, r.resolution), at = atlas(r.mode, r.chars, cellW * s);
            Object.assign(un, {
              srcA: r.blur > 0 ? blurOf(cur.tex, W, H, r.blur * 0.15 * u.size * s, false) : cur.tex,
              srcG: r.glow > 0 ? blurOf(cur.tex, W, H, (0.04 + 0.1 * r.glow) * u.size * s, false) : cur.tex,
              atlas: at.tex, cellUV: at.cellUV, inset0: at.inset0, insetSize: at.insetSize, cols: at.cols, count: at.count, cellW, cellH: cellW * at.aspect,
              glow: r.glow, mode: r.mode === 'matrix' ? 1 : 0, gain: r.gain, rain: r.rain, flicker: r.flicker,
            });
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
