// Live 12 player: the level meters, copied unchanged from the Arrangement replica (viewer.js), with the one theme value
// they read (Default Dark Neutral Medium's StandardVuMeter, from themes.js).
const T = { StandardVuMeter: {"OnlyMinimumToMaximum":"false","Maximum":"#ff0a0a","AboveZeroDecibel":"#ff0a0a","ZeroDecibel":"#ff0a0a","BelowZeroDecibel1":"#ffd100","BelowZeroDecibel2":"#00f758","Minimum":"#00f758"} };
// ---- Track level meters, from Live 12.0's exe (AVuMeterView, draw 0x14319e450) ----
// dB -> height: the converter's table type 6 (gdb: Live's global table [0x147225e10]+0x460, per dB from -70 to +6,
// percent of the height measured from the top), linear between whole dB; a stop's row is floor(height x pct / 100)
const VU_PCT = [100, 99.672134, 99.344261, 99.016396, 98.607162, 98.193657, 97.702423, 97.142723, 96.354973, 95.482452, 94.599998,
  93.707207, 92.80365, 91.888885, 90.96244, 90.023468, 89.071419, 88.10627, 87.127441, 86.134323, 85.126259, 84.102554, 83.062492,
  82.00528, 80.928947, 79.833321, 78.717506, 77.580452, 76.421043, 75.238083, 74.030289, 72.792442, 71.525627, 70.228745, 68.897942,
  67.527763, 66.120552, 64.666649, 63.166645, 61.611092, 59.999977, 58.333313, 56.666645, 54.999981, 53.333317, 51.666649, 49.999985,
  48.333317, 46.666653, 44.999989, 43.333321, 41.666656, 39.999992, 38.333324, 36.66666, 34.999992, 33.333328, 31.666662, 29.999996,
  28.333332, 26.666666, 25, 23.333334, 21.666668, 20, 18.333334, 16.666666, 15, 13.333333, 11.666667, 10, 8.333334, 6.666667,
  5.000001, 3.333334, 1.666667, 0];
function vuPct(db) {
  const i = Math.trunc(db + 70);
  if (i < 0) return 100;
  if (i >= VU_PCT.length - 1) return 0;
  const f = db + 70 - i; return VU_PCT[i] + (VU_PCT[i + 1] - VU_PCT[i]) * f;
}
// HSLuv (0x144130370 / 0x143209cd0: hue 0..360, saturation and lightness 0..100), for the gradient
const HSLUV_M = [[3.240969941904521, -1.537383177570093, -0.498610760293], [-0.96924363628087, 1.87596750150772, 0.041555057407175], [0.055630079696993, -0.20397695888897, 1.056971514242878]];
const HSLUV_MI = [[0.41239079926595, 0.35758433938387, 0.18048078840183], [0.21263900587151, 0.71516867876775, 0.072192315360733], [0.019330818715591, 0.11919477979462, 0.95053215224966]];
const hsluvMaxC = (L, H) => {
  const s1 = (L + 16) ** 3 / 1560896, s2 = s1 > 0.0088564516 ? s1 : L / 903.2962962, hr = H * Math.PI / 180; let best = Infinity;
  for (const [m1, m2, m3] of HSLUV_M) for (const t of [0, 1]) {
    const top1 = (284517 * m1 - 94839 * m3) * s2, top2 = (838422 * m3 + 769860 * m2 + 731718 * m1) * L * s2 - 769860 * t * L;
    const bottom = (632260 * m3 - 126452 * m2) * s2 + 126452 * t, len = (top2 / bottom) / (Math.sin(hr) - (top1 / bottom) * Math.cos(hr));
    if (len >= 0) best = Math.min(best, len);
  }
  return best;
};
function rgbToHsluv([r, g, b]) {
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const [R, G, B] = [r, g, b].map(lin), [X, Y, Z] = HSLUV_MI.map(m => m[0] * R + m[1] * G + m[2] * B);
  const L = Y <= 0.0088564516 ? Y * 903.2962962 : 116 * Math.cbrt(Y) - 16;
  if (L === 0) return [0, 0, 0];
  const d = X + 15 * Y + 3 * Z, U = 13 * L * (4 * X / d - 0.19783000664283), Vv = 13 * L * (9 * Y / d - 0.46831999493879);
  const H = (Math.atan2(Vv, U) * 180 / Math.PI + 360) % 360;
  if (L > 99.9999999) return [H, 0, 100];
  if (L < 1e-8) return [H, 0, 0];
  return [H, Math.hypot(U, Vv) / hsluvMaxC(L, H) * 100, L];
}
function hsluvToRgb([H, S, L]) {
  if (L > 99.9999999) return [255, 255, 255];
  if (L < 1e-8) return [0, 0, 0];
  const C = hsluvMaxC(L, H) / 100 * S, U = C * Math.cos(H * Math.PI / 180), Vv = C * Math.sin(H * Math.PI / 180);
  const vU = U / (13 * L) + 0.19783000664283, vV = Vv / (13 * L) + 0.46831999493879, Y = L <= 8 ? L / 903.2962962 : ((L + 16) / 116) ** 3;
  const X = -(9 * Y * vU) / ((vU - 4) * vV - vU * vV), Z = (9 * Y - 15 * vV * Y - vV * X) / (3 * vV);
  const gam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return HSLUV_M.map(m => Math.trunc(clamp(gam(m[0] * X + m[1] * Y + m[2] * Z), 0, 1) * 255));
}
// Per-row colours (0x143209de0): four runs from the top, Above -> Maximum down to the 0 dB row, ZeroDecibel ->
// BelowZeroDecibel1 to the -9 dB row, -> BelowZeroDecibel2 to the -18 dB row (dB from the converter's slots 11..13),
// -> Minimum to the bottom; each run steps t = k / n in HSLuv (0x1432097e0). Matches all 82 rows Live built.
const vuCache = new Map();
function vuColours(h) {
  if (vuCache.has(h)) return vuCache.get(h);
  const S = T.StandardVuMeter || {}, hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const col = k => hex(S[k] || '#00f758'), row = db => Math.floor(h * vuPct(db) / 100);
  const r0 = row(0), r9 = row(-9), r18 = row(-18), out = [];
  const run = (a, b, n) => {
    const A = rgbToHsluv(col(a)), B = rgbToHsluv(col(b));
    for (let k = 0; k < n; k++) {
      const t = k / n, c = A.map((x, i) => clamp(x + (B[i] - x) * t, 0, i ? 100 : 360));
      out.push('rgb(' + hsluvToRgb(c).join(',') + ')');
    }
  };
  run('AboveZeroDecibel', 'Maximum', r0); run('ZeroDecibel', 'BelowZeroDecibel1', r9 - r0);
  run('BelowZeroDecibel1', 'BelowZeroDecibel2', r18 - r9); run('BelowZeroDecibel2', 'Minimum', h - r18);
  vuCache.set(h, out);
  return out;
}
// One bar: rows from the peak down in the gradient colours, the part between the peak and the average darkened by
// MeterBackground at alpha 0x57, and the held peak as a 1 px line in its row's colour (0x14319e450). Levels: meters().
function drawVu(ctx, x, h, sep, peakDb, rmsDb, holdDb) {
  const cols = vuColours(h), row = db => h * vuPct(db) / 100;
  const pk = row(peakDb), av = row(rmsDb), hold = row(holdDb), top = Math.max(0, Math.floor(Math.min(pk, av)));
  ctx.clearRect(x, 0, 3, h);
  for (let r = top; r < h; r++) if (r !== sep) { ctx.fillStyle = cols[r]; ctx.fillRect(x, r, 3, 1); }
  if (av > pk) { ctx.fillStyle = 'rgba(24,24,24,' + 0x57 / 255 + ')'; ctx.fillRect(x, pk, 3, av - pk); ctx.clearRect(x, sep, 3, 1); }
  // held peak (0x14319e78b..0x14319e8ab): drawn while its flag [+0x105] is on (held > -140 dB) at row round(row(held))
  // (CRT round) in that row's gradient colour, only for rows inside the gradient table (row < h): -70 dB and below map
  // to row h, so no extra dB cut-off. The separator row is painted after it (0x14319e1d0, theme colour 6 for both states).
  const hr = Math.round(hold);
  if (holdDb > -140 && hr >= 0 && hr < h && hr !== sep) { ctx.fillStyle = cols[hr]; ctx.fillRect(x, hr, 3, 1); }
}
