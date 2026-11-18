/*
 * Nature: moss and lichen that grow on the script wherever a Nature modifier touches it.
 *
 * prepare(base)  analyses each glyph once (inside mask, distance to the edge, edge
 *                normal, how enclosed each spot is) and scatters growth sites over it.
 *                Sites are attached to the glyph, so they ride along with every
 *                transform, displacement and warp.
 * step(...)      decides per site what should live there (moss, lichen, crust or nothing)
 *                from the modifier's temperament and energy and the spot's
 *                microclimate, then animates growth towards that, or browning and decay
 *                away from it. A site that has reached its target stays as it is.
 * draw(...)      paints everything on a 2D canvas in world coordinates, batched by colour.
 */
(function (root) {
  'use strict';
  const FL = root.FontLab;
  const TAU = Math.PI * 2;
  const NONE = 0, MOSS = 1, LICHEN_GREY = 2, LICHEN_YELLOW = 3, LICHEN_ORANGE = 4, CRUST_WHITE = 5, CRUST_YELLOW = 6, CRUST_ORANGE = 7;

  function hash(a, b) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(((b | 0) + 0x632be5ab) | 0, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const top = a + (b - a) * u, bot = c + (d - c) * u;
    return (top + (bot - top) * v) * 2 - 1;
  }
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };
  const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const easeOut = k => 1 - (1 - k) * (1 - k);

  // ---------- analysis ----------
  function prepare(base) {
    if (base.nature) return base.nature;
    const S0 = FL.evaluate(base, [], 0);
    const size = base.size, cell = size / 64, sp = size * 0.04, u = size * 0.03;
    const sites = [];
    let seed = 1;

    base.nodes.glyph.forEach((g, gi) => {
      const d = FL.glyphPathData(S0, gi);
      if (!d) return;
      const b = FL.bbox(S0, g.cs);
      const pad = 2, W = Math.ceil(b.w / cell) + pad * 2, H = Math.ceil(b.h / cell) + pad * 2;
      if (W * H > 4e6) return;
      const ox = b.x - pad * cell, oy = b.y - pad * cell;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.setTransform(1 / cell, 0, 0, 1 / cell, -ox / cell, -oy / cell);
      ctx.fill(new Path2D(d));
      const px = ctx.getImageData(0, 0, W, H).data;
      const inside = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) inside[i] = px[i * 4 + 3] > 127 ? 1 : 0;

      // chamfer distance to the nearest outside cell
      const dt = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) dt[i] = inside[i] ? 1e9 : 0;
      const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : dt[y * W + x]);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!dt[i]) continue;
        dt[i] = Math.min(dt[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
      }
      for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (!dt[i]) continue;
        dt[i] = Math.min(dt[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
      }

      // summed-area table: how enclosed a spot is (crevices hold water, tips dry out)
      const sat = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        sat[(y + 1) * (W + 1) + x + 1] = inside[y * W + x] + sat[y * (W + 1) + x + 1] + sat[(y + 1) * (W + 1) + x] - sat[y * (W + 1) + x];
      const rw = Math.max(2, Math.round(size * 0.09 / cell));
      const cover = (x, y) => {
        const x0 = Math.max(0, x - rw), y0 = Math.max(0, y - rw), x1 = Math.min(W, x + rw + 1), y1 = Math.min(H, y + rw + 1);
        const s = sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
        return s / ((2 * rw + 1) * (2 * rw + 1));
      };

      const pts = [];
      let j = 0;
      for (let yy = b.y + sp * 0.5, row = 0; yy < b.y + b.h; yy += sp, row++) {
        for (let xx = b.x + sp * 0.5, col = 0; xx < b.x + b.w; xx += sp, col++) {
          const sx = xx + (hash(gi * 7919 + col, row) - 0.5) * sp * 0.9;
          const sy = yy + (hash(row * 104729 + gi, col + 7) - 0.5) * sp * 0.9;
          const cx = Math.floor((sx - ox) / cell), cy = Math.floor((sy - oy) / cell);
          if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1 || !inside[cy * W + cx]) continue;
          let gx = at(cx + 1, cy) - at(cx - 1, cy), gy = at(cx, cy + 1) - at(cx, cy - 1);
          const gl = Math.hypot(gx, gy);
          const nx = gl > 1e-6 ? -gx / gl : 0, ny = gl > 1e-6 ? -gy / gl : -1;
          const id = seed++;
          const r = new Float32Array(8);
          for (let q = 0; q < 8; q++) r[q] = hash(id * 31 + q, 9001);
          const s = {
            gi, k: j, ci: -1,
            e: (at(cx, cy) * cell) / size,           // distance to edge, in ems
            cov: cover(cx, cy),                       // 0..1 fraction of stone around
            nx, ny,                                   // outward normal (towards the nearest edge)
            patch: noise(sx / (size * 0.45), sy / (size * 0.45) + 17.3),
            r, var: Math.floor(r[7] * 997), rot0: r[6] * TAU,
            kind: NONE, g: 0, v: 1, vig: 0.5, T: 0.3, wait: 0, delay: 0, rate: 1 / (0.45 + 0.9 * r[5]),
            px: sx, py: sy, cnx: nx, cny: ny, sc: 1,
          };
          s.stalk = hash(id, 77) < 0.16;
          pts.push([sx, sy], [sx + nx * u, sy + ny * u]);
          j += 2;
          sites.push(s);
        }
      }
      if (pts.length) {
        const ci = FL.attach(base, gi, pts);
        for (const s of sites) if (s.gi === gi && s.ci < 0) s.ci = ci;
      }
    });
    base.nature = { sites, sp, u, size };
    return base.nature;
  }

  // What wants to live at this spot, given the modifier's temperament (0 wet .. 1 dry) and energy.
  function classify(s, T, E) {
    const edge = 1 - smooth(0, 0.09, s.e);
    const interior = smooth(0.03, 0.12, s.e);
    const crevice = smooth(0.5, 0.75, s.cov) * edge;   // inside corners and narrow gaps keep water
    const convex = (1 - smooth(0.25, 0.45, s.cov)) * edge; // tips and serifs dry out first
    const up = Math.max(0, -s.ny) * edge;                // upward-facing edges catch rain
    const wet = 1 - T;
    const moist = clamp01(wet * 0.95 + 0.35 * crevice + 0.3 * up - 0.25 * convex + 0.35 * s.patch - 0.2);
    const moss = moist * (0.3 + 0.7 * Math.max(edge, crevice, wet * wet));
    const lichen = (1 - moist) * (0.4 + 0.6 * Math.max(interior, convex)) * (0.5 + 0.5 * T);
    let kind, vigor;
    if (moss >= lichen) { kind = MOSS; vigor = moss; }
    else {
      // species follow the climate: grey-green foliose where damp, pale yellow in between,
      // bright orange (Xanthoria-like) where it is dry and exposed
      const orange = smooth(0.45, 0.95, T) * (0.7 + 0.3 * convex), grey = 1 - smooth(0.05, 0.55, T), x = s.r[5];
      const sp = x < orange * 0.85 ? 2 : x > 1 - grey * 0.8 ? 0 : 1;
      kind = s.r[3] < 0.2 ? LICHEN_GREY + sp : CRUST_WHITE + sp;
      vigor = lichen;
    }
    const gate = E * 1.5 * (0.4 + 0.6 * vigor) + 0.3 * s.patch - 0.12;
    if (s.r[0] > gate) return null;
    return { kind, vigor, amount: clamp01(0.45 + 0.55 * vigor) };
  }

  // ---------- simulation ----------
  function step(field, S, dt) {
    const natures = S.fx.filter(f => f.type === 'nature');
    let active = false, any = false;
    const u = field.u;
    for (const s of field.sites) {
      const con = S.contours[s.ci];
      if (!con) continue;
      const P = con.cmds[0].p, p = P[s.k], q = P[s.k + 1];
      s.px = p[0]; s.py = p[1];
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1e-9;
      s.cnx = dx / L; s.cny = dy / L;
      // How much the surface under the site was stretched or squashed by the modifiers.
      // Material crushed into a warp's rim (or torn far apart) cannot hold growth.
      const stretch = L / u;
      const crushed = stretch < 0.3 || stretch > 3.5;
      s.sc = Math.min(1.8, Math.max(0.5, stretch));

      let best = null, inf = 0;
      if (!S.hidden[s.ci] && !crushed) {
        for (const f of natures) {
          const d = f.shape.sdf(p[0], p[1]), soft = f.shape.size * 0.18;
          const w = 1 - smooth(-soft, soft * 0.4, d);
          if (w > inf) { inf = w; best = f; }
        }
      }
      let kind = NONE, amt = 0, vig = s.vig;
      if (best && inf > 0.01) {
        const c = classify(s, best.T, best.E);
        if (c) { kind = c.kind; vig = c.vigor; amt = c.amount * inf; }
      }
      if (s.g <= 0.0005 && s.kind !== kind) { s.kind = kind; s.g = 0; s.vig = vig; }
      const tgt = s.kind === kind ? amt : 0;
      if (s.kind === kind && kind) { s.vig += (vig - s.vig) * Math.min(1, dt * 4); s.T += (best.T - s.T) * Math.min(1, dt * 4); }

      if (tgt > s.g + 0.002) {
        if (s.g <= 0.0005) {
          if (s.wait === 0) {
            const dist = Math.hypot(s.px - best.shape.cx, s.py - best.shape.cy) / best.shape.size;
            s.delay = 0.05 + 0.4 * s.r[4] + 0.45 * (1 - s.vig) + 0.5 * Math.min(dist, 1.5);
            s.T = best.T;
          }
          s.wait += dt;
          active = true;
          if (s.wait < s.delay) continue;
          s.v = 1;
        }
        s.v = Math.min(1, s.v + dt * 3);
        s.g = Math.min(tgt, s.g + dt * s.rate);
        active = true;
      } else if (tgt < s.g - 0.002) {
        s.wait = 0;
        const vt = tgt <= 0 ? 0 : tgt / s.g;
        s.v = Math.max(vt, s.v - dt * (1.2 + s.r[6]));        // browns first...
        if (s.v < 0.6 || tgt > 0) s.g = Math.max(tgt, s.g - dt * s.rate * 0.55); // ...then withers away
        active = true;
      } else {
        if (tgt <= 0) { s.g = 0; s.wait = 0; }
        else if (s.v < 1) { s.v = Math.min(1, s.v + dt * 2); active = true; }
      }
      if (s.g > 0) any = true;
    }
    field.any = any;
    return active;
  }

  // ---------- sprites ----------
  // Every organism is drawn from a small set of pre-rendered sprites, shaded per pixel once
  // (dome lighting from the top left, leaflet texture, lobes, cups, cracks). At runtime each
  // site is one to three drawImage calls, which stays fast while hundreds of sites animate.
  const L = (() => { const v = [-0.5, -0.62, 0.6], l = Math.hypot(v[0], v[1], v[2]); return v.map(c => c / l); })();
  const ramp = (P, s) => (s < 0.5 ? mix3(P.dark, P.mid, s * 2) : mix3(P.mid, P.light, (s - 0.5) * 2));
  const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  function sprite(n, fn) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n), d = img.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = fn((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1);
      if (!c || c[3] <= 0) continue;
      const o = (y * n + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.min(255, c[3] * 255);
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function worley(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const d = Math.hypot(cx + hash(cx, cy * 7 + 3) - x, cy + hash(cx * 13 + 1, cy) - y);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return f2 - f1;
  }

  const MOSS_PAL = {
    wet: { dark: [18, 46, 12], mid: [58, 112, 28], light: [146, 192, 66], tip: [206, 236, 128] },
    dry: { dark: [54, 52, 22], mid: [118, 114, 50], light: [184, 174, 100], tip: [226, 214, 152] },
    dead: { dark: [48, 34, 20], mid: [114, 82, 48], light: [174, 138, 94], tip: [210, 184, 142] },
  };
  function mossSprite(seed, P) {
    const H = (x, y) => {
      const th = Math.atan2(y, x);
      const edge = 0.8 + 0.1 * noise(Math.cos(th) * 1.5 + seed * 7.1, Math.sin(th) * 1.5 + seed * 3.3) + 0.05 * noise(Math.cos(th) * 4 + seed, Math.sin(th) * 4 - seed);
      const r = Math.hypot(x, y) / edge;
      return { e: r, h: Math.sqrt(Math.max(0, 1 - r * r)) * (0.8 + 0.2 * noise(x * 3 + seed, y * 3)) + 0.1 * noise(x * 11 + seed * 2, y * 11 + seed) };
    };
    return sprite(72, (u, v) => {
      const fz = 0.12 * noise(u * 17 + seed * 13, v * 17 - seed * 5);
      const c0 = H(u, v), e = c0.e + fz;
      if (e > 1.02) return null;
      const a = 1 - smooth(0.88, 1.02, e);
      const dd = 0.025, k = 0.55;
      const nx = (H(u - dd, v).h - H(u + dd, v).h) / (2 * dd) * k, ny = (H(u, v - dd).h - H(u, v + dd).h) / (2 * dd) * k;
      const nl = Math.hypot(nx, ny, 1);
      const dif = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / nl);
      const leaf = noise(u * 24 + seed * 31, v * 24 - seed * 17) * 0.5 + 0.5;
      const shade = clamp01((0.1 + 0.95 * dif) * (0.7 + 0.42 * leaf) * (0.5 + 0.5 * Math.min(1, c0.h * 1.8)));
      let c = ramp(P, shade);
      if (leaf > 0.8 && dif > 0.55) c = mix3(c, P.tip, Math.min(1, (leaf - 0.8) * 4));
      return [c[0], c[1], c[2], a];
    });
  }

  const LICHEN_PAL = {
    grey: { base: [150, 168, 148], margin: [194, 206, 188], center: [116, 132, 114], cup: [44, 42, 38], cupRim: [70, 66, 60], cups: 0.5 },
    yellow: { base: [196, 204, 118], margin: [224, 230, 162], center: [166, 176, 96], cup: [156, 112, 56], cupRim: [206, 176, 100], cups: 1 },
    orange: { base: [234, 148, 40], margin: [250, 196, 92], center: [212, 116, 30], cup: [190, 78, 18], cupRim: [246, 172, 70], cups: 1 },
    dead: { base: [148, 142, 130], margin: [178, 172, 160], center: [122, 116, 106], cup: [92, 86, 78], cupRim: [130, 124, 114], cups: 1 },
  };
  function lichenSprite(seed, P, cupsFrom) {
    const lobes = 13 + Math.floor(hash(seed, 1) * 7), ph = hash(seed, 2) * TAU;
    const cups = [];
    const nc = 3 + Math.floor(hash(seed, 3) * 5);
    for (let i = 0; i < nc; i++) {
      const a = hash(seed, 10 + i) * TAU, r = Math.sqrt(hash(seed, 20 + i)) * 0.42;
      cups.push([Math.cos(a) * r, Math.sin(a) * r, 0.05 + 0.06 * hash(seed, 30 + i)]);
    }
    const cupAmt = (cupsFrom || P).cups;
    return sprite(96, (u, v) => {
      const rho = Math.hypot(u, v), th = Math.atan2(v, u);
      const wob = 0.09 * noise(Math.cos(th) * 2 + seed, Math.sin(th) * 2 + seed * 2);
      const jag = noise(th * 3 + seed * 5, rho * 4);              // lobes of uneven width and length
      const lc = Math.abs(Math.cos(lobes * th / 2 + ph + 2.5 * wob + 0.6 * jag));
      const edge = 0.76 + 0.14 * Math.pow(lc, 0.35) + 0.06 * jag + wob;
      const e = rho / edge;
      if (e > 1.01) return null;
      const a = 1 - smooth(0.94, 1.01, e);
      const margin = smooth(0.68, 0.97, e);
      const division = (1 - smooth(0, 0.09, lc)) * smooth(0.45, 0.8, e) * 0.6;
      const center = 1 - smooth(0.08, 0.55, e);
      const wr = noise(u * 15 + seed, v * 15 - seed) * 0.5 + 0.5;
      let c = mix3(P.base, P.margin, margin * 0.85);
      c = mix3(c, P.center, center * 0.7);
      const lit = rho > 1e-6 ? -(u * L[0] + v * L[1]) / rho : 0; // raised lobe margins catch the light
      c = scale3(c, (0.86 + 0.24 * wr - 0.28 * division) * (1 + 0.14 * margin * lit));
      if (cupAmt > 0.75) {
        for (const k of cups) {
          const d = Math.hypot(u - k[0], v - k[1]) / k[2];
          if (d < 1) { c = d < 0.62 ? mix3(P.cup, scale3(P.cup, 0.8), d) : mix3(P.cupRim, P.margin, smooth(0.9, 1, d)); break; }
        }
      } else if (cupAmt > 0) {
        const dots = noise(u * 30 + seed * 5, v * 30);
        if (dots > 0.62 && center > 0.2) c = mix3(c, P.cup, Math.min(1, (dots - 0.62) * 6));
      }
      return [c[0], c[1], c[2], a];
    });
  }

  const CRUST_PAL = {
    white: { base: [214, 212, 200], light: [236, 234, 224], crack: [120, 118, 108] },
    yellow: { base: [206, 196, 108], light: [228, 222, 146], crack: [116, 106, 56] },
    orange: { base: [226, 146, 60], light: [244, 186, 98], crack: [136, 76, 28] },
    dead: { base: [158, 154, 144], light: [182, 178, 168], crack: [96, 92, 86] },
  };
  function crustSprite(seed, P) {
    return sprite(64, (u, v) => {
      const rho = Math.hypot(u, v), th = Math.atan2(v, u);
      const edge = 0.74 + 0.2 * noise(Math.cos(th) * 1.7 + seed, Math.sin(th) * 1.7 - seed);
      const e = rho / edge + 0.07 * noise(u * 10 + seed, v * 10);
      if (e > 1) return null;
      const a = (1 - smooth(0.86, 1, e)) * 0.95;
      const crack = 1 - smooth(0.03, 0.1, worley(u * 5 + seed * 3, v * 5 - seed));
      let c = mix3(P.base, P.light, noise(u * 7 + seed, v * 7) * 0.5 + 0.5);
      c = mix3(c, P.crack, crack * 0.85);
      return [c[0], c[1], c[2], a];
    });
  }

  let SPR = null;
  const MOSS_VARS = 6, LICHEN_VARS = 4, CRUST_VARS = 4;
  function sprites() {
    if (SPR) return SPR;
    SPR = { moss: {}, lichen: {}, crust: {} };
    for (const k in MOSS_PAL) SPR.moss[k] = Array.from({ length: MOSS_VARS }, (_, i) => mossSprite(i * 1.37 + 0.5, MOSS_PAL[k]));
    for (const k of ['grey', 'yellow', 'orange']) {
      SPR.lichen[k] = Array.from({ length: LICHEN_VARS }, (_, i) => lichenSprite(i * 101 + k.length * 7, LICHEN_PAL[k]));
      SPR.lichen[k + 'Dead'] = Array.from({ length: LICHEN_VARS }, (_, i) => lichenSprite(i * 101 + k.length * 7, LICHEN_PAL.dead, LICHEN_PAL[k]));
    }
    for (const k of ['white', 'yellow', 'orange']) {
      SPR.crust[k] = Array.from({ length: CRUST_VARS }, (_, i) => crustSprite(i * 3.1 + k.length, CRUST_PAL[k]));
      SPR.crust[k + 'Dead'] = Array.from({ length: CRUST_VARS }, (_, i) => crustSprite(i * 3.1 + k.length, CRUST_PAL.dead));
    }
    const sh = document.createElement('canvas'); sh.width = sh.height = 48;
    const g = sh.getContext('2d'), gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
    SPR.shadow = sh;
    return SPR;
  }

  const LICHEN_SPECIES = ['grey', 'yellow', 'orange'], CRUST_SPECIES = ['white', 'yellow', 'orange'];

  // M: world -> device pixels, { s, ox, oy }.
  function draw(ctx, field, S, clip, M) {
    if (!field.any) return;
    const P = sprites(), sp = field.sp;
    const put = (img, x, y, size, rot, alpha) => {
      if (alpha <= 0.003 || size <= 0) return;
      const X = M.s * x + M.ox, Y = M.s * y + M.oy, D = M.s * size;
      if (D < 0.6) return;
      ctx.globalAlpha = Math.min(1, alpha);
      if (rot) {
        const c = Math.cos(rot), s = Math.sin(rot);
        ctx.setTransform(c, s, -s, c, X, Y);
        ctx.drawImage(img, -D / 2, -D / 2, D, D);
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, X - D / 2, Y - D / 2, D, D);
      }
    };
    const moss = [], flat = [];
    for (const s of field.sites) if (s.g > 0 && s.kind) (s.kind === MOSS ? moss : flat).push(s);

    // lichens and crusts lie flat on the letter surface: clip to it
    ctx.save();
    if (clip) { ctx.setTransform(M.s, 0, 0, M.s, M.ox, M.oy); ctx.clip(clip); }
    for (const s of flat) {
      const ge = easeOut(Math.min(1, s.g)), fade = smooth(0, 0.15, s.g);
      const lichen = s.kind >= LICHEN_GREY && s.kind <= LICHEN_ORANGE;
      const sp_ = lichen ? LICHEN_SPECIES[s.kind - LICHEN_GREY] : CRUST_SPECIES[s.kind - CRUST_WHITE];
      const set = lichen ? P.lichen : P.crust, vi = s.var % (lichen ? LICHEN_VARS : CRUST_VARS);
      const size = lichen
        ? sp * s.sc * (1.4 + 2.2 * s.r[2]) * (0.6 + 0.4 * s.vig) * ge
        : sp * s.sc * (0.9 + 0.9 * s.r[2]) * ge;
      put(set[sp_][vi], s.px, s.py, size, s.rot0, fade);
      if (s.v < 0.99) put(set[sp_ + 'Dead'][vi], s.px, s.py, size, s.rot0, fade * (1 - s.v));
    }
    ctx.restore();

    // moss cushions sit on top and spill over edges
    moss.sort((a, b) => a.py - b.py);
    const R = s => sp * s.sc * (0.85 + 0.75 * s.vig) * (0.3 + 0.7 * easeOut(Math.min(1, s.g)));
    for (const s of moss) {
      const r = R(s), edge = 1 - smooth(0, 0.09, s.e);
      s._cx = s.px + s.cnx * r * 0.45 * edge; s._cy = s.py + s.cny * r * 0.45 * edge; s._r = r;
      put(P.shadow, s._cx + r * 0.18, s._cy + r * 0.3, r * 2.6, 0, smooth(0, 0.2, s.g) * 0.9);
    }
    for (const s of moss) {
      const fade = smooth(0, 0.18, s.g), D = s._r * 2.35, vi = s.var % MOSS_VARS;
      const dry = smooth(0.15, 0.95, s.T);
      const [a, b, k] = dry < 0.5 ? [P.moss.wet, P.moss.dry, dry] : [P.moss.dry, P.moss.wet, 1 - dry];
      put(a[vi], s._cx, s._cy, D, 0, fade);
      if (k > 0.02) put(b[vi], s._cx, s._cy, D, 0, fade * k);
      if (s.v < 0.99) put(P.moss.dead[vi], s._cx, s._cy, D, 0, fade * (1 - s.v));
    }
    ctx.globalAlpha = 1;

    // spore stalks on lush, healthy, wet moss
    ctx.setTransform(M.s, 0, 0, M.s, M.ox, M.oy);
    ctx.lineCap = 'round';
    for (const s of moss) {
      if (!(s.stalk && s.T < 0.45 && s.vig > 0.45 && s.g > 0.8 && s.v > 0.7)) continue;
      const k = smooth(0.8, 1, s.g), r = s._r, up = Math.max(0, -s.cny);
      let dx = s.cnx * 0.35 * up + (s.r[7] - 0.5) * 0.6, dy = -1;
      const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
      const h = r * (1.3 + s.r[6]) * k, x0 = s._cx + (s.r[6] - 0.5) * r * 0.6, y0 = s._cy - r * 0.2;
      const x1 = x0 + dx * h, y1 = y0 + dy * h;
      ctx.strokeStyle = `rgba(150,62,30,${0.9 * s.v})`;
      ctx.lineWidth = Math.max(0.25, r * 0.045);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + dx * h * 0.2 - dy * r * 0.15, y0 + dy * h * 0.6, x1, y1); ctx.stroke();
      ctx.fillStyle = `rgba(92,46,22,${s.v})`;
      ctx.beginPath(); ctx.ellipse(x1, y1, r * 0.07 * k, r * 0.12 * k, Math.atan2(dy, dx) + Math.PI / 2, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(210,150,90,${0.7 * s.v})`;
      ctx.beginPath(); ctx.arc(x1 - r * 0.025, y1 - r * 0.04, r * 0.025 * k, 0, TAU); ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  root.FontLabNature = { prepare, step, draw, classify, sprites };
})(window);
