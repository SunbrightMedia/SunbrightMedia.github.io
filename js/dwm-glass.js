/* Windows 7 DWM glass, ported to WebGL.
 *
 * Every number here comes from Windows 7 SP1 (x86) itself, read from the binaries with
 * Microsoft's public symbols:
 *
 *  Pixel shaders: dwmcore.dll RCDATA 2003 (pass 1) and 2005 (pass 2), cbuffer "BlurConstants":
 *    conv[8] (c0-c7), colorization_afterglow (c8), colorization_blurBalance (c9),
 *    colorization_color (c10).
 *      pass 1: out.rgb = sum(conv[i] * tex(tap i))
 *      pass 2: s = sum(conv[i] * tex(tap i)); lum = dot(s, (0.2126, 0.7152, 0.0722));
 *              out.rgb = s * blurBalance + lum * afterglow + color; out.a = 1
 *  Weights and taps: CBlurEffect::GenerateGaussianSampleOffsetsAndWeights with
 *    sigma = CCommonRegistryData::m_flBlurSigma = 3.0 and radius GetEffectiveBlurRadius() = ceil(6.9) = 7;
 *    CHw1DConvolutionFilterSampleCalculator packs taps -7..7 into 8 bilinear pairs
 *    (-7,-6) (-5,-4) (-3,-2) (-1,0) (1,2) (3,4) (5,6) (7) and normalises them.
 *  Pass 1 (CBlurEffect::SetupBlurBuffer / CalculateAccumulationBufferSampleCoordinates):
 *    horizontal, into a buffer of width >> 2 and full height; u offset = (offset - 0.5) / (4 * bufferWidth).
 *  Pass 2 (CBlurEffect::SetupVertexBuffer): vertical over that buffer, v offset = offset / height.
 *  Colour (uDWM.dll DwmpReadColorizationParameters, CGlassColorizationParameters::
 *    AdjustWindowColorization, CGlassColorizationResources::Update):
 *    HKCU\Software\Microsoft\Windows\DWM on a fresh Windows 7 Ultimate SP1 install:
 *      ColorizationColor 0x6b74b8fc, ColorizationAfterglow 0x6b74b8fc,
 *      ColorizationColorBalance 8, ColorizationAfterglowBalance 43, ColorizationBlurBalance 49.
 *    Window frames are blended with aero.msstyles DWMWindow TOPFRAME COLORIZATIONCOLOR (0) at
 *    COLORIZATIONOPACITY p (active 100, inactive 40):
 *      colorBalance' = round(100 * colorBalance * p), blurBalance' = round(100 * (1 - (1 - blurBalance) * p)).
 *    dwmcore (SetscRGBGlassColor / SetscRGBAfterglowColor) multiplies each colour by its balance.
 */
(function () {
  'use strict';

  const SIGMA = 3.0, RADIUS = Math.ceil(6.9);
  const COLOR = 0x6b74b8fc, AFTERGLOW = 0x6b74b8fc;
  const BAL = { color: 8, afterglow: 43, blur: 49 };

  const f = Math.fround;
  // CBlurEffect::GenerateGaussianSampleOffsetsAndWeights + CHw1DConvolutionFilterSampleCalculator
  function kernel() {
    const variance = f(SIGMA * SIGMA), twoVar = variance + variance;
    const norm = 1 / f(Math.sqrt(f(variance * 6.2831854820251465)));
    const w = x => f(Math.pow(2.718281828459045, -(x * x) / twoVar) * norm);
    const weights = [], offsets = [];
    let total = f(0);
    for (let i = -RADIUS; i <= RADIUS; i += 2) {
      const a = w(i), b = i + 1 <= RADIUS ? w(i + 1) : f(0), sum = f(a + b);
      weights.push(sum); offsets.push(f(i + f(b / sum))); total = f(total + sum);
    }
    return { weights: weights.map(x => f(x / total)), offsets };
  }

  function rgb(argb) { return [(argb >>> 16 & 255) / 255, (argb >>> 8 & 255) / 255, (argb & 255) / 255]; }
  const pct = x => Math.floor(f(x * 100) + 0.5); // FloatPercentageToUInt
  function balances(p) { // AdjustWindowColorization with a transparent frame colour (alpha 0)
    const cb = BAL.color / 100, bb = BAL.blur / 100, ag = BAL.afterglow / 100;
    return { color: pct(cb * p) / 100, afterglow: pct(ag) / 100, blur: pct(1 - (1 - bb) * p) / 100 };
  }

  const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const PASS1 = `precision highp float;
uniform sampler2D src; uniform vec2 size; uniform float qw; uniform float w[8]; uniform float o[8];
void main(){
  float u0 = gl_FragCoord.x / qw, v = gl_FragCoord.y / size.y; vec3 s = vec3(0.0);
  for (int i = 0; i < 8; i++) s += w[i] * texture2D(src, vec2(u0 + (o[i] - 0.5) / (4.0 * qw), v)).rgb;
  gl_FragColor = vec4(s, 1.0);
}`;
  const PASS2 = `precision highp float;
uniform sampler2D src; uniform vec2 size; uniform float w[8]; uniform float o[8];
uniform vec3 afterglow; uniform float blurBalance; uniform vec3 color;
void main(){
  float u = gl_FragCoord.x / size.x, v0 = (size.y - gl_FragCoord.y) / size.y; vec3 s = vec3(0.0);
  for (int i = 0; i < 8; i++) s += w[i] * texture2D(src, vec2(u, v0 + o[i] / size.y)).rgb;
  float lum = dot(s, vec3(0.2125999927520751953125, 0.715200006961822509765625, 0.072200000286102294921875));
  gl_FragColor = vec4(s * blurBalance + lum * afterglow + color, 1.0);
}`;

  function program(gl, fs) {
    const pr = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(pr, sh);
    }
    gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    return pr;
  }
  function texture(gl, w, h, data) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    if (data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  // Renders the glass that DWM would show over `background` (a canvas the size of the screen)
  // for each colourization opacity in `opacities`; returns one canvas per opacity.
  function render(background, opacities) {
    const W = background.width, H = background.height, QW = Math.max(1, W >> 2);
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const { weights, offsets } = kernel();
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // pass 1: source -> quarter-width buffer (8-bit, as DWM's B8G8R8A8 surface)
    const src = texture(gl, W, H, background);
    const quarter = texture(gl, QW, H, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, quarter, 0);
    const p1 = program(gl, PASS1); gl.useProgram(p1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(p1, 'src'), 0);
    gl.uniform2f(gl.getUniformLocation(p1, 'size'), W, H);
    gl.uniform1f(gl.getUniformLocation(p1, 'qw'), QW);
    gl.uniform1fv(gl.getUniformLocation(p1, 'w'), weights);
    gl.uniform1fv(gl.getUniformLocation(p1, 'o'), offsets);
    gl.viewport(0, 0, QW, H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // pass 2: quarter buffer -> screen, vertical taps + colorization
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const p2 = program(gl, PASS2); gl.useProgram(p2);
    gl.bindTexture(gl.TEXTURE_2D, quarter);
    gl.uniform1i(gl.getUniformLocation(p2, 'src'), 0);
    gl.uniform2f(gl.getUniformLocation(p2, 'size'), W, H);
    gl.uniform1fv(gl.getUniformLocation(p2, 'w'), weights);
    gl.uniform1fv(gl.getUniformLocation(p2, 'o'), offsets);
    gl.viewport(0, 0, W, H);
    const out = [];
    for (const p of opacities) {
      const b = balances(p);
      gl.uniform3fv(gl.getUniformLocation(p2, 'afterglow'), rgb(AFTERGLOW).map(c => c * b.afterglow));
      gl.uniform1f(gl.getUniformLocation(p2, 'blurBalance'), b.blur);
      gl.uniform3fv(gl.getUniformLocation(p2, 'color'), rgb(COLOR).map(c => c * b.color));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(canvas, 0, 0); out.push(c);
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return out;
  }

  // The desktop wallpaper as Windows draws it with "Fill" (scale to cover, centred).
  function wallpaper(img, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return c;
  }

  const urls = [];
  let img, timer;
  function update() {
    const W = Math.max(1, Math.round(innerWidth)), H = Math.max(1, Math.round(innerHeight));
    let out;
    try { out = render(wallpaper(img, W, H), [1.0, 0.4]); } catch (e) { console.warn('DWM glass:', e); return; }
    if (!out) return;
    Promise.all(out.map(c => new Promise(r => c.toBlob(r)))).then(blobs => {
      const root = document.documentElement.style;
      blobs.forEach((b, i) => {
        if (!b) return;
        if (urls[i]) URL.revokeObjectURL(urls[i]);
        urls[i] = URL.createObjectURL(b);
        root.setProperty(i ? '--dwm-glass-inactive' : '--dwm-glass', `url("${urls[i]}")`);
      });
      document.documentElement.classList.add('dwm-glass');
    });
  }
  window.dwmGlass = { kernel, balances };
  img = new Image();
  img.onload = update;
  img.src = 'images/wallpaper.jpg';
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(update, 150); });
})();
