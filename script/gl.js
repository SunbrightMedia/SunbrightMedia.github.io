/*
 * FontLab GL: surface modifiers, drawn per pixel with WebGL as a chain of passes.
 *
 *   mask    the final glyphs rasterised with Canvas 2D: alpha = coverage, red = the
 *           glyph's heatmap temperature, green = a per-glyph random id
 *   blur    on demand, per radius: the premultiplied mask is halved (4x4 box filter per
 *           step) until the radius is a few texels, then blurred with two separable
 *           Gaussian passes. Gives how "deep inside" the script each pixel is.
 *   base    the plain script colour on black
 *   then one pass per surface modifier, in stack order, each reading the previous result:
 *     heatmap   thermal shading, halo, halftone grain and grey ghosts (after the poster)
 *     kamisuki  "KamisukiNoise" (shadertoy.com/view/7clyWr): fill or erode the script
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
  const lin = h => hex(h).map(c => Math.pow(c / 255, 2.2));
  const srgb = h => hex(h).map(c => c / 255);

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

  const COPY = `precision highp float; varying vec2 uv; uniform sampler2D src; void main(){ gl_FragColor = vec4(texture2D(src, uv).rgb, 1.0); }`;

  // shared by the shading passes: screen to world mapping and value noise
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

  const BASE = COMMON + `uniform vec3 fill;
void main() { gl_FragColor = vec4(fill * texture2D(mask, uv).a, 1.0); }`;

  const HEAT = COMMON + `uniform sampler2D blur, lut;
uniform vec2 ghostOff[3];
uniform float core, mottle, glow, grain, ghosts;
vec3 pal(float t) { return texture2D(lut, vec2(clamp(t, 0.0, 1.0) * 0.996 + 0.002, 0.5)).rgb; }
void main() {
  vec4 m = texture2D(mask, uv), b = texture2D(blur, uv);
  float a = m.a, tb = b.a > 0.003 ? b.r / b.a : m.r;
  vec2 w = worldPos();
  float T = mix(m.r, tb, 0.35);
  T += core * (smoothstep(0.2, 0.95, b.a) - 0.45) * 0.7;              // thick stroke cores run hot
  T += mottle * (fbm(w * (4.5 / size) + vec2(m.g * 41.0, time * 0.12)) - 0.5) * 0.9;
  T = clamp(T, 0.0, 1.0);
  vec3 col = pal(T);
  vec2 hp = mat2(0.7071, 0.7071, -0.7071, 0.7071) * w / (size * 0.022);  // halftone screen
  col *= mix(1.0, 0.8 + 0.32 * smoothstep(0.46, 0.2, length(fract(hp) - 0.5)), grain);
  vec3 halo = pal(clamp(tb * 0.85, 0.0, 1.0)) * smoothstep(0.0, 0.7, b.a) * glow * 0.8;
  float gh = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 q = uv + ghostOff[k];
    gh = max(gh, mix(texture2D(mask, q).a, texture2D(blur, q).a, 0.45) * (0.5 - 0.12 * float(k)));
  }
  vec3 back = texture2D(prev, uv).rgb * (1.0 - a) + vec3(0.42, 0.42, 0.47) * gh * ghosts + halo;
  vec3 outc = mix(back, col, a);
  outc += (hash(gl_FragCoord.xy + fract(time) * 91.0) - 0.5) * 0.08 * grain;
  gl_FragColor = vec4(outc, 1.0);
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
  vec3 col;
  float ins = smoothstep(0.0, 0.35, m.a);   // anti-aliased edge pixels count as inside, so no outline is left
  if (mode < 0.5) {
    col = mix(pv.rgb, pv.rgb * mix(1.0, pat, clamp(amount, 0.0, 1.0)), ins);    // fill
  } else {
    // erode: the pattern's dark parts bite in from the edge; how deep depends on amount
    float inner = clamp((texture2D(blur, uv).a - 0.5) * 2.0, 0.0, 1.0); // 0 at the edge, 1 deep inside
    float keep = smoothstep(-0.03, 0.03, inner - (1.0 - pat) * amount * 0.5 + 0.04);
    col = pv.rgb * mix(1.0, keep, ins);
  }
  gl_FragColor = vec4(col, 1.0);
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
    for (const [k, src] of Object.entries({ down: DOWN, blur: BLUR, copy: COPY, base: BASE, heatmap: HEAT, kamisuki: KAMI })) P[k] = program(src);

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
    const maskTex = texture(), lutTex = texture(), chain = [], blurPairs = [], C = [target(), target()];
    let lutName = null;
    const maskCanvas = document.createElement('canvas'), mctx = maskCanvas.getContext('2d');

    // bind a program and set uniforms by name: numbers, [x, y], [r, g, b], Float32Array (vec2 array) or textures
    function use(prog, uniforms) {
      const p = P[prog];
      gl.useProgram(p.pr);
      let unit = 0;
      for (const name in uniforms) {
        const loc = p.u[name];
        if (!loc) continue;
        const v = uniforms[name];
        if (v instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v); gl.uniform1i(loc, unit++); }
        else if (v instanceof Float32Array) gl.uniform2fv(loc, v);
        else if (typeof v === 'number') gl.uniform1f(loc, v);
        else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      }
    }
    const draw = (T, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, T ? T.fb : null); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };

    // o: { W, H, s, ox, oy } device pixels and world->device mapping; glyphD: path data per glyph;
    // holes: path data of warp holes; surface: the engine's surface records in stack order;
    // fill: the script colour; size: font size; time
    function render(o) {
      const { W, H, s, ox, oy } = o;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const heat = o.surface.find(r => r.type === 'heatmap');

      // mask
      if (maskCanvas.width !== W || maskCanvas.height !== H) { maskCanvas.width = W; maskCanvas.height = H; }
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.globalCompositeOperation = 'source-over';
      mctx.clearRect(0, 0, W, H);
      mctx.setTransform(s, 0, 0, s, ox, oy);
      o.glyphD.forEach((d, gi) => {
        if (!d) return;
        const T = heat && !isNaN(heat.temps[gi]) ? heat.temps[gi] : 0.5;
        const id = Math.abs((Math.sin(gi * 12.9898 + 4.1) * 43758.5453) % 1);
        mctx.fillStyle = `rgb(${Math.round(T * 255)},${Math.round(id * 255)},0)`;
        mctx.fill(new Path2D(d));
      });
      if (o.holes) { mctx.globalCompositeOperation = 'destination-out'; mctx.fill(new Path2D(o.holes)); }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);

      // blurred mask, per radius (device pixels), cached for this frame
      let built = 0, pairsUsed = 0;
      const blurCache = new Map();
      const level = l => {
        while (built < l) {
          const src = built === 0 ? { tex: maskTex, w: W, h: H } : chain[built];
          const T = sizeTarget(chain[built + 1] || (chain[built + 1] = target()), Math.max(1, Math.ceil(src.w / 2)), Math.max(1, Math.ceil(src.h / 2)));
          use('down', { src: src.tex, texel: [1 / src.w, 1 / src.h], prem: built === 0 ? 1 : 0 });
          draw(T, T.w, T.h);
          built++;
        }
        return chain[l];
      };
      const blurred = sigma => {
        sigma = Math.max(0.75, sigma);
        const key = Math.round(sigma * 2);
        if (blurCache.has(key)) return blurCache.get(key);
        const src = level(Math.max(1, Math.min(6, Math.ceil(Math.log2(sigma / 6)))));
        const pair = blurPairs[pairsUsed] || (blurPairs[pairsUsed] = [target(), target()]);
        pairsUsed++;
        const [A, B] = pair.map(T => sizeTarget(T, src.w, src.h));
        use('blur', { src: src.tex, stepv: [sigma / 4 / W, 0] }); draw(A, A.w, A.h);
        use('blur', { src: A.tex, stepv: [0, sigma / 4 / H] }); draw(B, B.w, B.h);
        blurCache.set(key, B.tex);
        return B.tex;
      };

      const common = { res: [W, H], origin: [ox, oy], scale: s, size: o.size, time: o.time, mask: maskTex };
      let cur = sizeTarget(C[0], W, H), other = sizeTarget(C[1], W, H);
      use('base', Object.assign({ fill: srgb(o.fill) }, common));
      draw(cur, W, H);

      for (const r of o.surface) {
        const u = Object.assign({ prev: cur.tex }, common);
        if (r.type === 'heatmap') {
          if (lutName !== r.palette) {
            lutName = r.palette;
            const data = new Uint8Array(256 * 4);
            for (let i = 0; i < 256; i++) { const c = paletteColor(lutName, i / 255); data.set([c[0], c[1], c[2], 255], i * 4); }
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.bindTexture(gl.TEXTURE_2D, lutTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
          }
          const off = [];
          [[-0.42, 0.06], [0.5, -0.04], [-0.85, 0.12]].forEach(([gx, gy], k) => {
            off.push((gx + 0.06 * Math.sin(o.time * 0.35 + k * 2.1)) * o.size * s / W, -gy * o.size * s / H);
          });
          Object.assign(u, { blur: blurred(r.spread * o.size * s), lut: lutTex, ghostOff: new Float32Array(off), core: r.core, mottle: r.mottle, glow: r.glow, grain: r.grain, ghosts: r.ghosts });
        } else if (r.type === 'kamisuki') {
          Object.assign(u, {
            blur: blurred(0.05 * o.size * s), mode: r.mode === 'erode' ? 1 : 0, kscale: r.scale, waves: r.waves, rotation: r.rotation,
            radius: r.radius, gradient: r.gradient, blend: r.blend, sharp: r.sharp, level: r.level, amount: r.amount, cx: r.cx, hw: r.hw,
          });
        } else continue;
        use(r.type, u);
        draw(other, W, H);
        [cur, other] = [other, cur];
      }
      use('copy', { src: cur.tex });
      draw(null, W, H);
      return canvas;
    }

    return { canvas, render };
  }

  root.FontLabGL = { create, PALETTES, paletteColor };
})(window);
