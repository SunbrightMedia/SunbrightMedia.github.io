/*
 * FontLab GL: per-pixel surface modifiers (heatmap), drawn with WebGL.
 *
 *   1. mask      the final glyphs, rasterised with Canvas 2D: alpha = coverage,
 *                red = the glyph's temperature, green = a per-glyph random id
 *   2. blur      the premultiplied mask is halved (4x4 box filter per step) until the
 *                blur radius is a few texels, then blurred with two separable
 *                Gaussian passes: how "thick" the script is around each pixel, and
 *                its temperature diffused outwards
 *   3. shade     the heatmap: temperature + stroke core heat + drifting mottle,
 *                looked up in a palette, with halo, halftone grain and grey ghosts
 *
 * Further surface modifiers become extra passes after "shade".
 */
(function (root) {
  'use strict';

  // Colour scales. "thermal" follows the reference poster: blue, violet, magenta, pink, orange, yellow.
  const PALETTES = {
    thermal: [[0, '#1d1cff'], [0.15, '#5d1cff'], [0.3, '#a51cff'], [0.45, '#f01ce0'], [0.58, '#ff1f9a'], [0.7, '#ff3a55'], [0.8, '#ff5a1e'], [0.9, '#ff9a00'], [1, '#ffe800']],
    iron: [[0, '#000000'], [0.2, '#24095a'], [0.4, '#86157f'], [0.6, '#df3c2a'], [0.8, '#ffa21a'], [1, '#fffbe0']],
    arctic: [[0, '#00081f'], [0.3, '#0b2b8c'], [0.6, '#1aa6ff'], [0.85, '#a3eaff'], [1, '#ffffff']],
    'white hot': [[0, '#000000'], [1, '#ffffff']],
  };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
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

  const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  const BLUR = `precision highp float;
varying vec2 uv; uniform sampler2D src; uniform vec2 stepv; uniform float prem;
void main(){
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -12; i <= 12; i++) {
    float x = float(i) / 4.0, w = exp(-0.5 * x * x);
    vec4 s = texture2D(src, uv + stepv * float(i));
    if (prem > 0.5) s = vec4(s.rg * s.a, 0.0, s.a);
    acc += s * w; ws += w;
  }
  gl_FragColor = acc / ws;
}`;

  const DOWN = `precision highp float;
varying vec2 uv; uniform sampler2D src; uniform vec2 texel; uniform float prem;
vec4 tap(vec2 o) { vec4 s = texture2D(src, uv + texel * o); return prem > 0.5 ? vec4(s.rg * s.a, 0.0, s.a) : s; }
void main(){ gl_FragColor = 0.25 * (tap(vec2(-0.5, -0.5)) + tap(vec2(0.5, -0.5)) + tap(vec2(-0.5, 0.5)) + tap(vec2(0.5, 0.5))); }`;

  const SHADE = `precision highp float;
varying vec2 uv;
uniform sampler2D mask, blur, lut;
uniform vec2 res, origin, ghostOff[3];
uniform float scale, nscale, dotCell, time, core, mottle, glow, grain, ghosts;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
vec3 pal(float t) { return texture2D(lut, vec2(clamp(t, 0.0, 1.0) * 0.996 + 0.002, 0.5)).rgb; }
void main() {
  vec4 m = texture2D(mask, uv), b = texture2D(blur, uv);
  float a = m.a;
  float tb = b.a > 0.003 ? b.r / b.a : m.r;
  vec2 fc = gl_FragCoord.xy;
  vec2 w = vec2(fc.x - origin.x, (res.y - fc.y) - origin.y) / scale; // world position: patterns stick to the script
  // temperature: own value, diffused neighbours, hotter stroke cores, drifting mottle
  float T = mix(m.r, tb, 0.35);
  T += core * (smoothstep(0.2, 0.95, b.a) - 0.45) * 0.7; // thick stroke cores run hot, thin ends cool
  T += mottle * (fbm(w * nscale + vec2(m.g * 41.0, time * 0.12)) - 0.5) * 0.9;
  T = clamp(T, 0.0, 1.0);
  vec3 col = pal(T);
  // halftone screen, rotated 45 degrees
  vec2 hp = mat2(0.7071, 0.7071, -0.7071, 0.7071) * w / dotCell;
  float dots = smoothstep(0.46, 0.2, length(fract(hp) - 0.5));
  col *= mix(1.0, 0.8 + 0.32 * dots, grain);
  // heat halo and grey ghosts behind the script
  vec3 halo = pal(clamp(tb * 0.85, 0.0, 1.0)) * smoothstep(0.0, 0.7, b.a) * glow * 0.8;
  float gh = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 q = uv + ghostOff[k];
    float g = mix(texture2D(mask, q).a, texture2D(blur, q).a, 0.45);
    gh = max(gh, g * (0.5 - 0.12 * float(k)));
  }
  vec3 back = vec3(0.42, 0.42, 0.47) * gh * ghosts + halo;
  vec3 outc = mix(back, col, a);
  outc += (hash(fc + fract(time) * 91.0) - 0.5) * 0.08 * grain;
  gl_FragColor = vec4(outc, 1.0);
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
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(pr, i), nm = info.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(pr, info.name); }
      return { pr, u };
    };
    const P = { down: program(DOWN), blur: program(BLUR), shade: program(SHADE) };

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
      if (T.w === w && T.h === h) return;
      T.w = w; T.h = h;
      gl.bindTexture(gl.TEXTURE_2D, T.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.tex, 0);
    };
    const maskTex = texture(), lutTex = texture(), A = target(), B = target(), levels = [];
    let lutName = null;
    const maskCanvas = document.createElement('canvas'), mctx = maskCanvas.getContext('2d');

    const bindTex = (unit, tex, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
    const draw = (fb, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };

    // o: { W, H, s, ox, oy } device pixels and world->device mapping; glyphD: path data per glyph;
    // holes: path data of warp holes; hm: the heatmap record from the engine; size: font size; time
    function render(o) {
      const { W, H, s, ox, oy, hm } = o;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

      // 1. mask
      if (maskCanvas.width !== W || maskCanvas.height !== H) { maskCanvas.width = W; maskCanvas.height = H; }
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, W, H);
      mctx.globalCompositeOperation = 'source-over';
      mctx.setTransform(s, 0, 0, s, ox, oy);
      o.glyphD.forEach((d, gi) => {
        if (!d) return;
        const T = isNaN(hm.temps[gi]) ? 0.5 : hm.temps[gi];
        const id = (Math.sin(gi * 12.9898 + 4.1) * 43758.5453) % 1;
        mctx.fillStyle = `rgb(${Math.round(T * 255)},${Math.round(Math.abs(id) * 255)},0)`;
        mctx.fill(new Path2D(d));
      });
      if (o.holes) { mctx.globalCompositeOperation = 'destination-out'; mctx.fill(new Path2D(o.holes)); }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);

      if (lutName !== hm.palette) {
        lutName = hm.palette;
        const data = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) { const c = paletteColor(lutName, i / 255); data.set([c[0], c[1], c[2], 255], i * 4); }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      }

      // 2. blur: halve until the radius is ~6 texels (so taps never skip detail), then Gaussian
      const sigma = Math.max(0.75, hm.spread * o.size * s); // device pixels at full resolution
      const L = Math.max(1, Math.min(6, Math.ceil(Math.log2(sigma / 6))));
      let src = maskTex, sw = W, shh = H;
      gl.useProgram(P.down.pr);
      for (let l = 1; l <= L; l++) {
        const T = levels[l] || (levels[l] = target()), w = Math.max(1, Math.ceil(sw / 2)), h = Math.max(1, Math.ceil(shh / 2));
        sizeTarget(T, w, h);
        bindTex(0, src, P.down.u.src);
        gl.uniform2f(P.down.u.texel, 1 / sw, 1 / shh); gl.uniform1f(P.down.u.prem, l === 1 ? 1 : 0);
        draw(T.fb, w, h);
        src = T.tex; sw = w; shh = h;
      }
      sizeTarget(A, sw, shh); sizeTarget(B, sw, shh);
      gl.useProgram(P.blur.pr);
      gl.uniform1f(P.blur.u.prem, 0);
      bindTex(0, src, P.blur.u.src);
      gl.uniform2f(P.blur.u.stepv, sigma / 4 / W, 0);
      draw(A.fb, sw, shh);
      bindTex(0, A.tex, P.blur.u.src);
      gl.uniform2f(P.blur.u.stepv, 0, sigma / 4 / H);
      draw(B.fb, sw, shh);

      // 3. shade
      const u = P.shade.u;
      gl.useProgram(P.shade.pr);
      bindTex(0, maskTex, u.mask); bindTex(1, B.tex, u.blur); bindTex(2, lutTex, u.lut);
      gl.uniform2f(u.res, W, H); gl.uniform2f(u.origin, ox, oy);
      gl.uniform1f(u.scale, s); gl.uniform1f(u.nscale, 4.5 / o.size); gl.uniform1f(u.dotCell, o.size * 0.022);
      gl.uniform1f(u.time, o.time); gl.uniform1f(u.core, hm.core); gl.uniform1f(u.mottle, hm.mottle);
      gl.uniform1f(u.glow, hm.glow); gl.uniform1f(u.grain, hm.grain); gl.uniform1f(u.ghosts, hm.ghosts);
      const off = [];
      [[-0.42, 0.06], [0.5, -0.04], [-0.85, 0.12]].forEach(([gx, gy], k) => {
        const dx = (gx + 0.06 * Math.sin(o.time * 0.35 + k * 2.1)) * o.size * s, dy = gy * o.size * s;
        off.push(dx / W, -dy / H);
      });
      gl.uniform2fv(u.ghostOff, new Float32Array(off));
      draw(null, W, H);
      return canvas;
    }

    return { canvas, render };
  }

  root.FontLabGL = { create, PALETTES, paletteColor };
})(window);
