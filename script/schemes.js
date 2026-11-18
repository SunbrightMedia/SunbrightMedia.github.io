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
