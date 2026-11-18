/*
 * Schemes: colour for the rest of the lab.
 *   gradient maps  a colour for every brightness, 0 (black) to 1 (white); the Gradient map effect
 *                  recolours what is beneath through one
 *
 * Satin is after a satin-noise shadertoy shader: lighting of two drifting noise fields, coloured
 * by hue, saturation and value curves that wander slowly over time. The Satin effect draws its
 * light in black and white; the Satin gradient map carries its colours. Both draw their slowly
 * drifting settings from the same seeds, as the shader does, so the two together give the
 * shader's look.
 */
(function (root) {
  'use strict';
  const fract = x => x - Math.floor(x);
  const mix = (a, b, v) => a + (b - a) * v;
  const smoothstep = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  // Dave Hoskins' hash without sine
  function hash11(p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  // 1D gradient noise, 0..1
  function perlin11(x) {
    const i = Math.floor(x), f = x - i, g0 = hash11(i) * 2 - 1, g1 = hash11(i + 1) * 2 - 1;
    const u = f * f * f * (f * (f * 6 - 15) + 10), n = g0 * f + (g1 * (f - 1) - g0 * f) * u;
    return Math.min(1, Math.max(0, 0.5 + n * 1.4));
  }
  const perlin21 = x => [perlin11(x), perlin11(x + 57.31)];
  function hsv2rgb(h, s, v) {
    const c = k => { const x = Math.abs(fract(h + k / 3) * 6 - 3) - 1; return Math.min(1, Math.max(0, x)); };
    return [v * mix(1, c(0), s), v * mix(1, c(2), s), v * mix(1, c(1), s)];
  }

  // Satin's settings at a moment (base = seed + time / 16 at speed 1), drawn in the shader's order
  function satinParams(base) {
    const seed = k => base + hash11(k) * 512;
    const off = perlin21(seed(4));
    return {
      grain: mix(1 / 16, 1 / 128, perlin11(seed(1))), size: mix(0.25, 1, perlin11(seed(2))), strength: mix(1, 4, perlin11(seed(3))),
      offset: [off[0] * 4, off[1] * 4], seeds: [seed(5), seed(6), seed(7), seed(8)].map(v => v % 1024),
      p: mix(1, 4, perlin11(seed(9))), vp: mix(0.25, 2, perlin11(seed(10))),
      satRampdown: mix(0.5, 1, perlin11(seed(11))), satEnd: mix(0, 0.25, perlin11(seed(12))), hue: perlin21(seed(13)),
    };
  }
  function satinColor(P, x) {
    const value = Math.pow(Math.max(0, x), P.vp);
    const sat = mix(P.satEnd, 1, 1 - smoothstep(1 - P.satRampdown, 1, x));
    return hsv2rgb(P.hue[0] + x * P.hue[1] * 2, sat, value);
  }

  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };

  // Twilight, by Bastian Bechtold (github.com/bastibe/twilight, MIT; also in Matplotlib): a
  // perceptually uniform, cyclic map from off-white through blue to off-black, then through red
  // back to off-white. 64 even steps of its 510.
  const TWILIGHT = (
    'f4ebf4 e7e3ea dbdce2 cfd5db c3ced4 b6c8cf a9c1cb 9dbac8 92b3c6 88acc4 7fa5c3 779dc2 7195c0 6b8dbf 6784be 647cbc' +
    '6173ba 606ab7 5f61b4 5f57b0 5e4dab 5e44a5 5d3a9e 5b3095 58278b 541f7f 4f1971 481463 411155 380e47 2f0b3b 26072f' +
    '27072c 310b33 3c0f3a 46123f 511445 5c1749 661a4c 711d4f 7b2150 852650 8e2c50 963350 9e3b4f a54350 ab4b50 b15452' +
    'b65e54 ba6757 be715c c27b61 c58569 c78f72 c9997c cca288 ceac94 d1b5a2 d5bfb0 d9c7bf ded0cd e4d9db ebe2e7 f4ebf4'
  ).split(' ').map(h => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]);
  // colour at x along evenly spaced stops
  const along = stops => x => {
    const f = Math.min(1, Math.max(0, x)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), u = f - i, a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  };
  const GRADIENT_MAPS = {
    satin: {
      label: 'Satin',
      scheme: true,
      params: { drift: 'on', speed: '1', seed: '0' },
      choice: { drift: ['on', 'off'] },
      only: { speed: { drift: 'on' } },
      ui: { speed: [0, 8, 0.01], seed: [0, 100, 1] },
      docs: {
        drift: 'on: the colours wander slowly over time, as in the shader; off: they stay as they are at the seed',
        speed: 'how fast the colours wander (1 = the shader\'s pace)', seed: 'which colours: another seed, another palette (the Satin effect\'s seed matches it)',
      },
      colorAt(params, t) {
        const P = satinParams(num(params.seed, 0) + (params.drift === 'off' ? 0 : t * num(params.speed, 1) / 16));
        return x => satinColor(P, x);
      },
    },
    twilight: {
      label: 'Twilight',
      scheme: true,
      params: {},
      docs: {},
      about: 'off-white, blue, off-black, red, off-white (Bastian Bechtold\'s Twilight)',
      colorAt: () => along(TWILIGHT),
    },
    sunlight: {
      label: 'Sunlight',
      scheme: true,
      params: {},
      docs: {},
      about: 'Twilight shifted by half: off-black, red, off-white, blue, off-black',
      colorAt: () => along(TWILIGHT.slice(32).concat(TWILIGHT.slice(0, 32))),
    },
  };

  // 256 RGBA steps of a gradient map
  function lut(name, params, t) {
    const def = GRADIENT_MAPS[name] || GRADIENT_MAPS.satin, f = def.colorAt(Object.assign({}, def.params, params), t), out = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const c = f(i / 255);
      out[i * 4] = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
      out[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
      out[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  root.FontLabSchemes = { GRADIENT_MAPS, satinParams, satinColor, hsv2rgb, lut };
})(typeof window !== 'undefined' ? window : globalThis);
