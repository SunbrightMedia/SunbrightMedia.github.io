// Live 12's text rasterizer, reproduced. Live draws text with its own Skia (CPU raster, SkDraw) and a statically linked
// FreeType 2.10.0 (version read from the FT_LibraryRec at run time), so the same pixels can be computed here:
//  - outline: TrueType points scaled with FT_MulFix(x, FT_DivFix(trunc(px * 64), upem)), no hinting (load flags 0x10020a
//    read in the SkScalerContext_FreeType ctor 0x144269030), plus Skia's subpixel shift (quarter pixel, x only);
//  - FreeType "Harmony" LCD rendering (no FT_CONFIG_OPTION_SUBPIXEL_RENDERING; lcd_geometry (-21,0) (0,0) (21,0) read
//    from the library): three gray renders of the outline shifted by -sub[k].x (smooth renderer 0x14472c722,
//    ft_lcd_padding 0x1447233b0, gray rasterizer 0x14472e260 / 0x14472e030 / 0x14472d7ac with Win64 32-bit 'long');
//  - Skia mask: bounds from the outline cbox (0x144268860) widened by fLCDExtra 2 (generateMetrics 0x144267f90),
//    copyFT2LCD16 0x1416d4650 with the preblend tables of SkTMaskGamma<3,3,3> (contrast 0xcc, gamma 0: the eight
//    256-byte tables below were read from the running Live) picked per channel by colour >> 5, packed 565;
//  - placement (SkFindAndPlaceGlyph, DrawOneGlyph 0x1416aaad0): sub = (int)(frac(x) * 65536 + 8192) >> 14 & 3,
//    left = floor(x + 1/8) + mask.left, top = floor(y + 1/2) + mask.top; x = origin + sum of float(adv * px / 64)
//    accumulated in double (ADeferredGraphPort 0x1429f9ce0);
//  - blit: blit_row_lcd16_opaque 0x144266ae0: per channel m5 += m5 >> 4, d + ((s - d) * m5 >> 5).
// Every step was checked against Live: 801/801 FreeType bitmaps and LCD16 masks byte-exact, glyph positions and blit
// rectangles of the traced runs exact (re-notes Session 4).
'use strict';
const LiveText = (() => {
  const GB = atob('AAECAgMEBQYGBwgJCgoLDA0ODg8QERISExQVFhYXGBkaGhscHR4eHyAhIiMjJCUmJycoKSorLCwtLi8wMDEyMzQ1NTY3ODk6Ojs8PT4/P0BBQkNERUVGR0hJSkpLTE1OT1BQUVJTVFVWVldYWVpbXF1dXl9gYWJjZGRlZmdoaWpra2xtbm9wcXJzdHR1dnd4eXp7fH19fn+AgYKDhIWGh4iJioqLjI2Oj5CRkpOUlZaXmJmam5ydnp+goaKjpKWmp6ipqqusra6vsLGys7S1tre5uru8vb6/wMHDxMXGx8jKy8zNztDR0tTV1tjZ2tzd3+Di5OXn6evt7/H09/r8/wABAgIDBAUGBwcICQoLCwwNDg8PEBESExQUFRYXGBkZGhscHR4eHyAhIiMjJCUmJygoKSorLC0tLi8wMTIzMzQ1Njc4OTk6Ozw9Pj8/QEFCQ0RFRUZHSElKS0xMTU5PUFFSU1NUVVZXWFlaW1tcXV5fYGFiY2RkZWZnaGlqa2xtbm5vcHFyc3R1dnd4eXp7e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsrO0tba3uLm6vL2+v8DBwsTFxsfIycvMzc7Q0dLT1dbX2Nrb3N7f4eLj5ebo6evs7u/x8/T2+Pn7/f8AAQIDBAQFBgcICQoLDAwNDg8QERITFBQVFhcYGRobHB0dHh8gISIjJCUmJicoKSorLC0uLzAwMTIzNDU2Nzg5Ojs7PD0+P0BBQkNERUZHSEhJSktMTU5PUFFSU1RVVldXWFlaW1xdXl9gYWJjZGVmZ2hpamtrbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6yur7CxsrO0tba3uLm6u7y9vsDBwsPExcbHyMnKzM3Oz9DR0tPU1tfY2drb3N7f4OHi4+Tm5+jp6uzt7u/w8fP09fb4+fr7/f7/AAECAwQFBgcICQoLDA0PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxcbHyMnKy8zNzs/Q0dLT1NXW19jZ2tvc3d7f4OHi4+Pk5ebn6Onq6+zt7u/w8fLz9PX29/f4+fr7/P3+/wABAwQFBwgJCwwNDxARExQVFxgZGxwdHiAhIiMlJicoKissLS8wMTI0NTY3ODo7PD0+QEFCQ0RFR0hJSktMTk9QUVJTVFVXWFlaW1xdXl9hYmNkZWZnaGlqa2xub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqKjpKWmp6ipqqusra6vr7CxsrO0tba3uLi5uru8vb6/v8DBwsPExcbGx8jJysvMzM3Oz9DR0dLT1NXW1tfY2dra29zd3t/f4OHi4+Pk5ebn5+jp6urr7O3u7u/w8fHy8/T09fb3+Pj5+vv7/P3+/v8AAgQGCAoMDhASFBYXGRsdHiAiJCUnKCosLS8wMjM1Njg5Ozw+P0FCQ0VGSElKTE1OUFFSU1VWV1haW1xdX2BhYmNlZmdoaWprbW5vcHFyc3R1dnh5ent8fX5/gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZWWl5iZmpucnZ6fn6ChoqOkpaanp6ipqqusrK2ur7CxsbKztLW2tre4ubq6u7y9vr6/wMHBwsPExcXGx8jIycrLy8zNzs7P0NHR0tPT1NXW1tfY2Nna2tvc3d3e39/g4eHi4+Pk5eXm5+fo6enq6+vs7e3u7+/w8fHy8/P09PX29vf4+Pn5+vv7/P39/v7/AAQIDBATFhkcHyEkJikrLTAyNDY4Ojw+QEFDRUdISktNT1BSU1VWWFlbXF1fYGFjZGVnaGlqa21ub3Bxc3R1dnd4eXp7fX5/gIGCg4SFhoeIiYqLjI2Oj5CQkZKTlJWWl5iZmZqbnJ2en6CgoaKjpKWlpqeoqamqq6ytra6vsLCxsrOztLW2tre4ubm6u7u8vb6+v8DAwcLCw8TFxcbHx8jJycrLy8zNzc7Oz9DQ0dLS09TU1dXW19fY2dna2tvc3N3d3t/f4ODh4uLj4+Tk5ebm5+fo6Onq6uvr7Ozt7e7v7/Dw8fHy8vPz9PX19vb39/j4+fn6+vv7/Pz9/f7+/wANFhwiJiouMjU4Oz1AQkVHSUtNT1FTVVZYWlxdX2BiY2VmaGlqbG1ucHFyc3V2d3h5enx9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SUlZaXmJmam5ucnZ6fn6ChoqOjpKWmp6eoqaqqq6ytra6vr7CxsrKztLS1tra3uLm5uru7vL29vr6/wMDBwsLDxMTFxcbHx8jIycrKy8vMzc3Ozs/Q0NHR0tLT1NTV1dbW19fY2Nna2tvb3Nzd3d7e39/g4OHi4uPj5OTl5ebm5+fo6Onp6urr6+zs7e3u7u7v7/Dw8fHy8vPz9PT19fb29vf3+Pj5+fr6+/v7/Pz9/f7+//8=');
  const GAMMA = Uint8Array.from(GB, c => c.charCodeAt(0));
  const f32 = Math.fround;

  // ---- TrueType outlines ------------------------------------------------------------------------------------------
  function parse(buf) {
    const d = new DataView(buf), u16 = o => d.getUint16(o), s16 = o => d.getInt16(o), u32 = o => d.getUint32(o);
    const tab = {};
    for (let i = 0, n = u16(4); i < n; i++) { const r = 12 + 16 * i; tab[String.fromCharCode(d.getUint8(r), d.getUint8(r + 1), d.getUint8(r + 2), d.getUint8(r + 3))] = u32(r + 8); }
    const upem = u16(tab.head + 18), locf = s16(tab.head + 50), nH = u16(tab.hhea + 34);
    let cm = null;
    for (let i = 0, n = u16(tab.cmap + 2); i < n; i++) {
      const r = tab.cmap + 4 + 8 * i, pid = u16(r), eid = u16(r + 2), o = tab.cmap + u32(r + 4), fmt = u16(o);
      if (pid === 3 && eid === 10 && fmt === 12) { cm = { fmt, o }; break; }
      if (pid === 3 && eid === 1 && fmt === 4 && !cm) cm = { fmt, o };
    }
    const gidOf = cp => {
      const o = cm.o;
      if (cm.fmt === 12) {
        for (let i = 0, n = u32(o + 12); i < n; i++) { const r = o + 16 + 12 * i, a = u32(r), b = u32(r + 4); if (cp >= a && cp <= b) return u32(r + 8) + cp - a; }
        return 0;
      }
      const seg = u16(o + 6) / 2, ends = o + 14, starts = ends + 2 * seg + 2, deltas = starts + 2 * seg, ranges = deltas + 2 * seg;
      for (let i = 0; i < seg; i++) {
        if (cp > u16(ends + 2 * i)) continue;
        const st = u16(starts + 2 * i); if (cp < st) return 0;
        const ro = u16(ranges + 2 * i);
        if (!ro) return (cp + s16(deltas + 2 * i)) & 0xffff;
        const g = u16(ranges + 2 * i + ro + 2 * (cp - st)); return g ? (g + s16(deltas + 2 * i)) & 0xffff : 0;
      }
      return 0;
    };
    const loca = g => locf ? u32(tab.loca + 4 * g) : 2 * u16(tab.loca + 2 * g);
    // glyph outline in font units: { x:[], y:[], on:[], ends:[] } (composite components merged, offsets kept apart
    // because FreeType scales each component's points and its offset separately)
    function outline(g, depth = 0) {
      const o = tab.glyf + loca(g), len = loca(g + 1) - loca(g);
      const res = { x: [], y: [], on: [], ends: [], off: [] };
      if (len <= 0 || depth > 8) return res;
      const nc = s16(o);
      if (nc >= 0) {
        let p = o + 10; const ends = [];
        for (let i = 0; i < nc; i++, p += 2) ends.push(u16(p));
        const n = nc ? ends[nc - 1] + 1 : 0;
        p += 2 + u16(p);
        const fl = [];
        while (fl.length < n) { const f = d.getUint8(p++); fl.push(f); if (f & 8) { let r = d.getUint8(p++); while (r--) fl.push(f); } }
        let v = 0;
        for (let i = 0; i < n; i++) { const f = fl[i]; if (f & 2) { const b = d.getUint8(p++); v += f & 16 ? b : -b; } else if (!(f & 16)) { v += s16(p); p += 2; } res.x.push(v); }
        v = 0;
        for (let i = 0; i < n; i++) { const f = fl[i]; if (f & 4) { const b = d.getUint8(p++); v += f & 32 ? b : -b; } else if (!(f & 32)) { v += s16(p); p += 2; } res.y.push(v); }
        for (let i = 0; i < n; i++) { res.on.push(fl[i] & 1); res.off.push(null); }
        res.ends = ends;
        return res;
      }
      let p = o + 10, more = true;
      while (more) {
        const fl = u16(p), gi = u16(p + 2); p += 4;
        let a1, a2;
        if (fl & 1) { a1 = s16(p); a2 = s16(p + 2); p += 4; } else { a1 = d.getInt8(p); a2 = d.getInt8(p + 1); p += 2; }
        if (fl & 8) p += 2; else if (fl & 0x40) p += 4; else if (fl & 0x80) p += 8;
        const sub = outline(gi, depth + 1), base = res.x.length;
        for (let i = 0; i < sub.x.length; i++) { res.x.push(sub.x[i]); res.y.push(sub.y[i]); res.on.push(sub.on[i]); res.off.push(fl & 2 ? [a1, a2, sub.off[i]] : sub.off[i]); }
        for (const e of sub.ends) res.ends.push(e + base);
        more = !!(fl & 0x20);
      }
      return res;
    }
    return { upem, gidOf, outline, adv: g => u16(tab.hmtx + 4 * Math.min(g, nH - 1)) };
  }
  const mulFix = (a, b) => { const s = (a < 0) !== (b < 0) ? -1 : 1; a = Math.abs(a); b = Math.abs(b); return s * Math.floor((a * b + 0x8000) / 65536); };
  const divFix = (a, b) => { const s = (a < 0) !== (b < 0) ? -1 : 1; a = Math.abs(a); b = Math.abs(b); return s * Math.floor((a * 65536 + (b >> 1)) / b); };

  // ---- FreeType 2.10.0 gray rasterizer (ftgrays.c as compiled for Win64: TPos = 32-bit long) ----------------------
  function Gray(W, H) {
    this.W = W; this.H = H; this.rows = []; this.ex = 0; this.ey = 0; this.area = 0; this.cover = 0; this.invalid = 1; this.x = 0; this.y = 0;
  }
  Gray.prototype.setCell = function (ex, ey) {
    if (ex < 0) ex = -1;
    if (!this.invalid && (this.area || this.cover)) {
      const r = this.rows[this.ey] || (this.rows[this.ey] = new Map()), c = r.get(this.ex);
      if (c) { c[0] = (c[0] + this.cover) | 0; c[1] = (c[1] + this.area) | 0; } else r.set(this.ex, [this.cover, this.area]);
    }
    this.ex = ex; this.ey = ey; this.area = 0; this.cover = 0;
    this.invalid = ey >= this.H || ey < 0 || ex >= this.W ? 1 : 0;
  };
  Gray.prototype.line = function (tx, ty) {
    let ey1 = this.y >> 8; const ey2 = ty >> 8;
    if ((ey1 >= this.H && ey2 >= this.H) || (ey1 < 0 && ey2 < 0)) { this.x = tx; this.y = ty; return; }
    let ex1 = this.x >> 8; const ex2 = tx >> 8;
    let fx1 = this.x - (ex1 << 8), fy1 = this.y - (ey1 << 8);
    const dx = (tx - this.x) | 0, dy = (ty - this.y) | 0;
    if (ex1 === ex2 && ey1 === ey2) { /* inside one cell */ }
    else if (dy === 0) { ex1 = ex2; this.setCell(ex1, ey1); }
    else if (dx === 0) {
      if (dy > 0) do { this.cover += 256 - fy1; this.area += (256 - fy1) * fx1 * 2; fy1 = 0; ey1++; this.setCell(ex1, ey1); } while (ey1 !== ey2);
      else do { this.cover -= fy1; this.area -= fy1 * fx1 * 2; fy1 = 256; ey1--; this.setCell(ex1, ey1); } while (ey1 !== ey2);
    } else {
      let prod = (Math.imul(dx, fy1) - Math.imul(dy, fx1)) | 0;
      const dxr = ex1 !== ex2 ? (0xffffff / dx) | 0 : 0, dyr = ey1 !== ey2 ? (0xffffff / dy) | 0 : 0;
      const dx8 = Math.imul(dx, 256), dy8 = Math.imul(dy, 256);
      do {
        let fx2, fy2;
        if (prod <= 0 && ((prod - dx8) | 0) > 0) {                               // left
          fx2 = 0; fy2 = Math.imul(prod, dxr) >>> 24; prod = (prod - dy8) | 0;
          this.cover += fy2 - fy1; this.area += (fy2 - fy1) * (fx1 + fx2); fx1 = 256; fy1 = fy2; ex1--;
        } else if (((prod - dx8) | 0) <= 0 && ((prod - dx8 + dy8) | 0) > 0) {     // up
          prod = (prod - dx8) | 0; fx2 = Math.imul(-prod, dyr) >>> 24; fy2 = 256;
          this.cover += fy2 - fy1; this.area += (fy2 - fy1) * (fx1 + fx2); fx1 = fx2; fy1 = 0; ey1++;
        } else if (((prod - dx8 + dy8) | 0) <= 0 && ((prod + dy8) | 0) >= 0) {   // right
          prod = (prod + dy8) | 0; fx2 = 256; fy2 = Math.imul(prod, dxr) >>> 24;
          this.cover += fy2 - fy1; this.area += (fy2 - fy1) * (fx1 + fx2); fx1 = 0; fy1 = fy2; ex1++;
        } else {                                                                     // down
          fx2 = Math.imul(-prod, dyr) >>> 24; fy2 = 0; prod = (prod + dx8) | 0;
          this.cover += fy2 - fy1; this.area += (fy2 - fy1) * (fx1 + fx2); fx1 = fx2; fy1 = 256; ey1--;
        }
        this.setCell(ex1, ey1);
      } while (ex1 !== ex2 || ey1 !== ey2);
    }
    const fx2 = tx - (ex2 << 8), fy2 = ty - (ey2 << 8);
    this.cover += fy2 - fy1; this.area += (fy2 - fy1) * (fx1 + fx2);
    this.x = tx; this.y = ty;
  };
  Gray.prototype.moveTo = function (x, y) { x <<= 2; y <<= 2; this.setCell(x >> 8, y >> 8); this.x = x; this.y = y; };
  Gray.prototype.lineTo = function (x, y) { this.line(x << 2, y << 2); };
  const half = v => (v / 2) | 0;      // C signed division by 2
  Gray.prototype.conicTo = function (cx, cy, x, y) {
    const A = [x << 2, y << 2, cx << 2, cy << 2, this.x, this.y];
    const H = this.H;
    if (((A[1] >> 8) >= H && (A[3] >> 8) >= H && (A[5] >> 8) >= H) || ((A[1] >> 8) < 0 && (A[3] >> 8) < 0 && (A[5] >> 8) < 0)) { this.x = A[0]; this.y = A[1]; return; }
    let dx = Math.abs(A[4] + A[0] - 2 * A[2]); const dy = Math.abs(A[5] + A[1] - 2 * A[3]);
    if (dx < dy) dx = dy;
    let draw = 1;
    while (dx > 64) { dx >>>= 2; draw <<= 1; }
    let i = 0;
    do {
      let split = 1;
      while ((draw & split) === 0) {
        for (let k = 0; k < 2; k++) {
          const b0 = A[i + k], b1 = A[i + 2 + k], b2 = A[i + 4 + k];
          A[i + 8 + k] = b2;
          const bb = half(b1 + b2), aa = half(b0 + b1);
          A[i + 6 + k] = bb; A[i + 2 + k] = aa; A[i + 4 + k] = half(aa + bb);
        }
        i += 4; split <<= 1;
      }
      this.line(A[i], A[i + 1]);
      i -= 4;
    } while (--draw);
  };
  Gray.prototype.decompose = function (X, Y, on, ends) {
    let first = 0;
    for (const last of ends) {
      let vs = [X[first], Y[first]]; const vl = [X[last], Y[last]];
      let limit = last, p = first;
      if (!on[first]) {
        if (on[last]) { vs = vl; limit--; } else vs = [half(vs[0] + vl[0]), half(vs[1] + vl[1])];
        p--;
      }
      this.moveTo(vs[0], vs[1]);
      let closed = false;
      while (p < limit) {
        p++;
        if (on[p]) { this.lineTo(X[p], Y[p]); continue; }
        let vc = [X[p], Y[p]];
        for (;;) {
          if (p < limit) {
            p++;
            if (on[p]) { this.conicTo(vc[0], vc[1], X[p], Y[p]); break; }
            const vm = [half(vc[0] + X[p]), half(vc[1] + Y[p])];
            this.conicTo(vc[0], vc[1], vm[0], vm[1]); vc = [X[p], Y[p]]; continue;
          }
          this.conicTo(vc[0], vc[1], vs[0], vs[1]); closed = true; break;
        }
        if (closed) break;
      }
      if (!closed) this.lineTo(vs[0], vs[1]);
      first = last + 1;
    }
    this.setCell(this.ex, this.ey);   // records the last cell (gray_convert_glyph ends with gray_record_cell)
  };
  Gray.prototype.sweep = function (buf, pitch, xoff) {
    const cv = a => { a >>= 9; if (a < 0) a = ~a; return a >= 256 ? 255 : a; };
    for (let ey = 0; ey < this.H; ey++) {
      const row = this.rows[ey]; if (!row) continue;
      const r0 = (this.H - 1 - ey) * pitch + xoff;
      const xs = Array.from(row.keys()).sort((a, b) => a - b);
      let cover = 0, x = 0;
      for (const ex of xs) {
        const c = row.get(ex);
        if (cover && ex > x) { const v = cv(cover); for (let k = x; k < ex; k++) buf[r0 + k] = v; }
        cover = (cover + (c[0] << 9)) | 0;
        const a = (cover - c[1]) | 0;
        if (a && ex >= 0) buf[r0 + ex] = cv(a);
        x = ex + 1;
      }
      if (cover) { const v = cv(cover); for (let k = x; k < this.W; k++) buf[r0 + k] = v; }
    }
  };
  const SUB = [-21, 0, 21];
  // FT_Render_Glyph(FT_RENDER_MODE_LCD) of a 26.6 outline: { left, top, w (pixels), rows, pitch, bits }
  function lcdRender(X, Y, on, ends) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < X.length; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
    if (!X.length) x0 = y0 = x1 = y1 = 0;
    const pb = [x0 >> 6, y0 >> 6, x1 >> 6, y1 >> 6];
    const cb = [(x0 & 63) - 21, (y0 & 63), (x1 & 63) + 21, (y1 & 63)];   // ft_lcd_padding: -max(sub.x), -min(sub.x)
    pb[0] += cb[0] >> 6; pb[1] += cb[1] >> 6; pb[2] += (cb[2] + 63) >> 6; pb[3] += (cb[3] + 63) >> 6;
    const left = pb[0], top = pb[3], w = pb[2] - pb[0], h = pb[3] - pb[1], W = w * 3, pitch = (W + 3) & ~3;
    const tmp = new Uint8Array(pitch * h);
    const tx = -left * 64, ty = -(top - h) * 64;
    for (let k = 0; k < 3; k++) {
      const g = new Gray(W, h);
      g.decompose(X.map(v => v + tx - SUB[k]), Y.map(v => v + ty), on, ends);
      g.sweep(tmp, pitch, k * w);
    }
    const bits = new Uint8Array(pitch * h);
    for (let r = 0; r < h; r++) for (let j = 0; j < w; j++) for (let k = 0; k < 3; k++) bits[r * pitch + 3 * j + k] = tmp[r * pitch + j + k * w];
    return { left, top, w, rows: h, pitch, bits };
  }

  // ---- fonts, glyph masks -------------------------------------------------------------------------------------------
  const FONTS = {};
  const FILES = { regular: 'fonts/AbletonSansSmall-Regular.ttf', bold: 'fonts/AbletonSansSmall-Bold.ttf', italic: 'fonts/AbletonSansSmall-RegularItalic.ttf', light: 'fonts/AbletonSans-Light.ttf' };
  const ready = Promise.all(Object.entries(FILES).map(async ([k, u]) => {
    try { const r = await fetch(u); if (r.ok) FONTS[k] = parse(await r.arrayBuffer()); } catch (e) {}
  }));
  const cache = new Map();
  // Skia LCD16 mask of one glyph at px size `px` (float) and quarter-pixel shift `sub`, preblended for `color`
  // A8 (grayscale) masks, for text Live draws with LCD off (clip names: 0x143b666e0 passes the no-LCD argument to the
  // text draw, 0x14297d180 then clears the font's LCD byte +0x20, so the run's paint lacks kLCDRenderText 0x200):
  //  - bounds (generateMetrics 0x144267f90): the cbox floor/ceil to 64, no fLCDExtra (that is only for mask format 4);
  //  - generateGlyphImage 0x14426d9f2: outline translated by -floor64(min x), -floor64(min y), FT_Outline_Render
  //    0x14471e080 into a gray target of the mask's size, then every byte through the preblend table [ctx+0x78];
  //  - preblend (SkScalerContext rec setup 0x14417143a): luminance colour = (G*183 + R*54 + B*19) >> 8 as grey, then
  //    CanonicalColor 0x1416a6650 (top 3 bits), so the table is GAMMA[(lum >> 5) * 256 + v].
  function glyphMaskA8(fk, gid, px, sub, color) {
    const lum = ((color >> 8 & 255) * 183 + (color >> 16 & 255) * 54 + (color & 255) * 19) >> 8;
    const key = 'a8:' + fk + ':' + px + ':' + gid + ':' + sub + ':' + (lum >> 5);
    let m = cache.get(key);
    if (m !== undefined) return m;
    const F = FONTS[fk]; m = null;
    if (F) {
      const o = F.outline(gid);
      if (o.x.length) {
        const ch = Math.trunc(f32(f32(px) * 64)), s = divFix(Math.floor((ch * 72 + 36) / 72), F.upem);
        const X = [], Y = [];
        for (let i = 0; i < o.x.length; i++) {
          let x = mulFix(o.x[i], s), y = mulFix(o.y[i], s);
          for (let q = o.off[i]; q; q = q[2]) { x += mulFix(q[0], s); y += mulFix(q[1], s); }
          X.push(x + sub * 16); Y.push(y);
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < X.length; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
        x0 &= ~63; y0 &= ~63; x1 = (x1 + 63) & ~63; y1 = (y1 + 63) & ~63;
        const L = x0 >> 6, T = -(y1 >> 6), W = (x1 - x0) >> 6, H = (y1 - y0) >> 6;
        if (W > 0 && H > 0) {
          const g = new Gray(W, H), bits = new Uint8Array(W * H);
          g.decompose(X.map(v => v - x0), Y.map(v => v - y0), o.on, o.ends);
          g.sweep(bits, W, 0);
          const t = (lum >> 5) * 256, mk = new Uint8Array(W * H);
          for (let i = 0; i < W * H; i++) mk[i] = GAMMA[t + bits[i]];
          m = { L, T, W, H, mk, a8: true };
        }
      }
    }
    cache.set(key, m);
    return m;
  }
  function glyphMask(fk, gid, px, sub, color) {
    const key = fk + ':' + px + ':' + gid + ':' + sub + ':' + ((color >> 21 & 7) << 6 | (color >> 13 & 7) << 3 | (color >> 5 & 7));
    let m = cache.get(key);
    if (m !== undefined) return m;
    const F = FONTS[fk]; m = null;
    if (F) {
      const o = F.outline(gid);
      if (o.x.length) {
        const ch = Math.trunc(f32(f32(px) * 64)), s = divFix(Math.floor((ch * 72 + 36) / 72), F.upem);
        const X = [], Y = [];
        for (let i = 0; i < o.x.length; i++) {
          let x = mulFix(o.x[i], s), y = mulFix(o.y[i], s);
          for (let q = o.off[i]; q; q = q[2]) { x += mulFix(q[0], s); y += mulFix(q[1], s); }
          X.push(x + sub * 16); Y.push(y);
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < X.length; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
        x0 &= ~63; y0 &= ~63; x1 = (x1 + 63) & ~63; y1 = (y1 + 63) & ~63;
        const L = (x0 >> 6) - 1, T = -(y1 >> 6), W = ((x1 - x0) >> 6) + 2, H = (y1 - y0) >> 6;
        if (W > 2 && H > 0) {
          const r = lcdRender(X, Y, o.on, o.ends);
          const tr = (color >> 21 & 7) * 256, tg = (color >> 13 & 7) * 256, tb = (color >> 5 & 7) * 256;
          const mk = new Uint16Array(W * H);
          for (let y = 0; y < H; y++) {
            const by = y + T + r.top; if (by < 0 || by >= r.rows) continue;
            for (let x = 0; x < W; x++) {
              const bx = x + L - r.left; if (bx < 0 || bx >= r.w) continue;
              const q = by * r.pitch + 3 * bx;
              mk[y * W + x] = (GAMMA[tr + r.bits[q]] >> 3) << 11 | (GAMMA[tg + r.bits[q + 1]] >> 2) << 5 | GAMMA[tb + r.bits[q + 2]] >> 3;
            }
          }
          m = { L, T, W, H, mk };
        }
      }
    }
    cache.set(key, m);
    return m;
  }
  // Live font: integer size (11 = the page's 10 px) -> Skia px size (text draw 0x14297c760: float(size) * 0.9045)
  const pxOf = size => f32(f32(size) * f32(0.9045));
  // HarfBuzz-style advances at 64 units/em (the page's shaper, viewer.js parseFont) -> glyph ids + x advances
  function shape(fk, str) {
    const F = FONTS[fk]; if (!F) return null;
    const sh = typeof SHAPER !== 'undefined' && SHAPER[fk === 'bold' ? 'bold' : 'regular'];
    const cps = Array.from(str);
    const gids = cps.map(c => F.gidOf(c.codePointAt(0)));
    let adv;
    if (sh && (fk === 'regular' || fk === 'bold')) adv = sh.advances(str);
    else { const mult = Math.floor(64 * 65536 / F.upem); adv = gids.map(g => Math.floor((F.adv(g) * mult + 32768) / 65536)); }
    return gids.map((g, i) => [adv[i], g]);
  }
  // draw `str` with its pen origin at device (ox, oy) into RGBA pixels `px` (w x h, origin at device (bx, by))
  function drawInto(px, w, h, bx, by, str, fk, size, color, ox, oy, clip, a8, alpha = 255) {
    const run = shape(fk, str); if (!run) return 0;
    const p = pxOf(size), k = f32(p * 0.015625);
    let pen = ox;
    const sr = color >> 16 & 255, sg = color >> 8 & 255, sb = color & 255;
    const iy = Math.floor(f32(f32(oy) + 0.5));
    for (const [a, g] of run) {
      const x = f32(pen), fl = Math.floor(x);
      const sub = (Math.trunc(f32(f32(f32(x - fl) * 65536) + 8192)) >> 14) & 3;
      const m = a8 ? glyphMaskA8(fk, g, p, sub, color) : glyphMask(fk, g, p, sub, color);
      if (m && m.a8) {
        // A8 blit (SkBlitMask::BlitColor 0x144242320 -> 0x1416af2d0 -> row proc 0x1416b07f0 / tail 0x1441b13c0, black
        // 0x1441b10a0): per channel ((c * a + c) >> 8) + ((d * (255 - a) + d) >> 8)
        const L = Math.floor(f32(x + 0.125)) + m.L, T = iy + m.T;
        for (let yy = 0; yy < m.H; yy++) {
          const Y = T + yy; if (Y < clip.y0 || Y >= clip.y1) continue;
          const ry = Y - by; if (ry < 0 || ry >= h) continue;
          for (let xx = 0; xx < m.W; xx++) {
            const a = m.mk[yy * m.W + xx]; if (!a) continue;
            const X = L + xx; if (X < clip.x0 || X >= clip.x1) continue;
            const rx = X - bx; if (rx < 0 || rx >= w) continue;
            const o = (ry * w + rx) * 4, ia = 255 - a;
            px[o] = ((sr * a + sr) >> 8) + ((px[o] * ia + px[o]) >> 8);
            px[o + 1] = ((sg * a + sg) >> 8) + ((px[o + 1] * ia + px[o + 1]) >> 8);
            px[o + 2] = ((sb * a + sb) >> 8) + ((px[o + 2] * ia + px[o + 2]) >> 8); px[o + 3] = 255;
          }
        }
      } else if (m) {
        const L = Math.floor(f32(x + 0.125)) + m.L, T = iy + m.T;
        for (let yy = 0; yy < m.H; yy++) {
          const Y = T + yy; if (Y < clip.y0 || Y >= clip.y1) continue;
          const ry = Y - by; if (ry < 0 || ry >= h) continue;
          for (let xx = 0; xx < m.W; xx++) {
            const v = m.mk[yy * m.W + xx]; if (!v) continue;
            const X = L + xx; if (X < clip.x0 || X >= clip.x1) continue;
            const rx = X - bx; if (rx < 0 || rx >= w) continue;
            const o = (ry * w + rx) * 4;
            if (v === 0xffff && alpha === 255) { px[o] = sr; px[o + 1] = sg; px[o + 2] = sb; px[o + 3] = 255; continue; }
            let mr = v >> 11, mg = v >> 6 & 31, mb = v & 31;
            mr += mr >> 4; mg += mg >> 4; mb += mb >> 4;
            // a colour with alpha < 255 (SkBlitMask::BlitColor picks 0x144266e20 instead of 0x144266ae0): the unpremultiplied
            // colour, each channel's m scaled by (alpha + 1) >> 8 first (0x144266ea0 / SIMD 0x144266fb0)
            if (alpha !== 255) { const A = alpha + 1; mr = mr * A >> 8; mg = mg * A >> 8; mb = mb * A >> 8; }
            px[o] = px[o] + ((sr - px[o]) * mr >> 5); px[o + 1] = px[o + 1] + ((sg - px[o + 1]) * mg >> 5);
            px[o + 2] = px[o + 2] + ((sb - px[o + 2]) * mb >> 5); px[o + 3] = 255;
          }
        }
      }
      pen += f32(f32(a) * k);
    }
    return pen - ox;
  }
  // Live's text width (text measure 0x14297d960): ceil(float(float(sum of advances * size) * 0.0141328126f)) + 1
  function liveWidth(str, fk, size) {
    const run = shape(fk, str); if (!run) return 0;
    let sum = 0; for (const [a] of run) sum += a;
    return Math.ceil(f32(f32(sum * size) * f32(0.01413281261920929))) + 1;
  }
  // device-pixel extent of a string (for the read-back rectangle)
  function extent(str, fk, size) {
    const run = shape(fk, str); if (!run) return 0;
    const k = f32(pxOf(size) * 0.015625); let w = 0; for (const [a] of run) w += f32(f32(a) * k); return w;
  }
  // ---- page glue ---------------------------------------------------------------------------------------------------
  // The page's CSS fonts stand for Live's: 10 px "Ableton Sans Small" = Live size 11 (9.9495 px), 9 px "Ableton Sans
  // Small 9" = size 10; other sizes: the Live size whose px size (size * 0.9045) is nearest. At a device pixel ratio d
  // the size is round(size * d) (text draw 0x14297c760 rounds size * scale with the CRT round).
  const FAMILY = { 'Ableton Sans Small': 0.9, 'Ableton Sans Small 9': 8 / 9, 'Ableton Sans Light': 17 / 18 };
  function fontOf(family, weight, style, cssPx) {
    const fam = family.split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (!(fam in FAMILY)) return null;
    const fk = fam === 'Ableton Sans Light' ? 'light' : (+weight >= 600 || weight === 'bold') ? 'bold' : style === 'italic' ? 'italic' : 'regular';
    if (!FONTS[fk]) return null;
    return { fk, size: Math.round(cssPx / 0.9045), asc: FAMILY[fam] * cssPx };
  }
  const liveSize = (size, d) => d === 1 ? size : Math.round(size * d);
  const rgbOf = s => {
    const m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return [parseInt(m[1], 16), 1];
    const r = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(s);
    return r ? [(+r[1] << 16) | (+r[2] << 8) | +r[3], r[4] === undefined ? 1 : +r[4]] : null;
  };
  // canvas text: draw at the canvas user-space point (x, baseline of ctx.textBaseline at y), clip = optional user-space
  // rect [x0, y0, x1, y1]. Falls back to the canvas' own fillText until the fonts are in.
  function fillText(ctx, str, x, y, clip, a8) {
    const cs = /(?:(bold|[1-9]00)\s+)?(?:(italic)\s+)?([\d.]+)px\s+(.+)$/.exec(ctx.font);
    const col = rgbOf(ctx.fillStyle);
    const f = cs && col && col[1] === 1 && fontOf(cs[4], cs[1] || 400, cs[2] || 'normal', +cs[3]);
    if (!f) return ctx.fillText(str, x, y);
    const b = ctx.textBaseline;
    let dy = 0;
    if (b !== 'alphabetic') { const m1 = ctx.measureText(str); ctx.textBaseline = 'alphabetic'; const m2 = ctx.measureText(str); ctx.textBaseline = b; dy = m2.fontBoundingBoxAscent - m1.fontBoundingBoxAscent; }
    const t = ctx.getTransform(), d = t.a;
    const ox = t.a * x + t.e, oy = t.d * (y + dy) + t.f, size = liveSize(f.size, d);
    const w = Math.ceil(extent(str, f.fk, size)) + 8, hgt = Math.ceil(size * 1.4) + 4;
    let x0 = Math.floor(ox) - 4, y0 = Math.floor(oy) - Math.ceil(size * 1.1) - 2, x1 = x0 + w + 4, y1 = y0 + hgt + 4;
    if (clip) { x0 = Math.max(x0, Math.floor(t.a * clip[0] + t.e)); y0 = Math.max(y0, Math.floor(t.d * clip[1] + t.f)); x1 = Math.min(x1, Math.ceil(t.a * clip[2] + t.e)); y1 = Math.min(y1, Math.ceil(t.d * clip[3] + t.f)); }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(ctx.canvas.width, x1); y1 = Math.min(ctx.canvas.height, y1);
    if (x1 <= x0 || y1 <= y0) return;
    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    drawInto(img.data, x1 - x0, y1 - y0, x0, y0, str, f.fk, size, col[0], ox, oy, { x0, y0, x1, y1 }, a8);
    ctx.putImageData(img, x0, y0);
    const ga = ctx.globalAlpha; ctx.globalAlpha = 0; ctx.fillText(str, x, y); ctx.globalAlpha = ga;   // keeps text hooks informed
  }
  // DOM text: every visible text node in one of Live's fonts is drawn into a full-window overlay canvas and its own
  // glyphs are made transparent. The LCD blend needs the colour under the text (bgCols). Texts under the open file
  // dialog are left out.
  let ov = null, octx = null, pending = 0;
  // Every rectangle is measured relative to the overlay canvas itself (OX, OY = its own client position), so the text
  // lands on its element whatever the browser does with the viewport (iOS Safari pans and zooms the page under fixed
  // elements, and its client rectangles then no longer start at the canvas origin).
  let OX = 0, OY = 0;
  // kerning comes from viewer.js's shaper (SHAPER), which may load after the first render: lines drawn without it
  // must be redrawn once it is in, so its state is part of every line's signature
  const shaperGen = () => typeof SHAPER === 'undefined' ? 0 : (SHAPER.regular ? 1 : 0) + (SHAPER.bold ? 2 : 0);
  const SH = r => r && { left: r.left - OX, top: r.top - OY, right: r.right - OX, bottom: r.bottom - OY, width: r.width, height: r.height };
  const BR = e => SH(e.getBoundingClientRect());
  // the overlay covers the layout viewport (iOS reports the smaller visual viewport as innerWidth while zoomed in)
  const vpW = () => Math.max(innerWidth, document.documentElement.clientWidth), vpH = () => Math.max(innerHeight, document.documentElement.clientHeight);
  const hidden = new Set();
  // colour under a point: the topmost element there with a background colour (the text's own box is usually clear)
  // The page's colour under a text line, per device column: the nearest ancestor with a background colour, overpainted
  // by the earlier siblings (along the path down to the text) that have one and cover the column (e.g. a value fill).
  let bgCache = new Map();
  const bgColor = e => { let c = bgCache.get(e); if (c === undefined) { const r = rgbOf(getComputedStyle(e).backgroundColor); c = r && r[1] > 0 ? r[0] : null; bgCache.set(e, c); } return c; };
  function bgCols(el, xa, xb, my, d) {
    const cols = new Int32Array(Math.max(0, xb - xa));
    const path = [el];
    for (let e = el; bgColor(e) === null && e.parentElement; e = e.parentElement) path.push(e.parentElement);
    const top = path[path.length - 1], base = bgColor(top);
    cols.fill(base === null ? 0 : base);
    cols.cv = []; cols.top = new Int16Array(cols.length);   // per column: 1 + index of the canvas painted last there
    for (let k = path.length - 1; k > 0; k--) {
      const node = path[k - 1];
      for (const c of path[k].children) {
        if (c === node) break;
        // canvases under the text (e.g. the lane grid under the grid-size indicator): their own pixels are the background
        for (const cv of c.tagName === 'CANVAS' ? [c] : c.getElementsByTagName('canvas')) {
          if (!cv.width || !cv.checkVisibility()) continue;
          const q = BR(cv); if (my < q.top || my >= q.bottom) continue;
          const x0 = Math.max(xa, Math.round(q.left * d)), x1 = Math.min(xb, Math.round(q.right * d));
          if (x1 > x0) { cols.cv.push(cv); cols.top.fill(cols.cv.length, x0 - xa, x1 - xa); }
        }
        const col = bgColor(c); if (col === null) continue;
        const r = BR(c); if (my < r.top || my >= r.bottom) continue;
        const x0 = Math.max(xa, Math.round(r.left * d)), x1 = Math.min(xb, Math.round(r.right * d));
        if (x1 > x0) { cols.fill(col, x0 - xa, x1 - xa); cols.top.fill(0, x0 - xa, x1 - xa); }
      }
    }
    if (bgColor(el) !== null) { cols.fill(bgColor(el)); cols.top.fill(0); }
    return cols;
  }
  // copy the opaque pixels of canvas cv that lie under device rect [xa, xb) x [ya, yb) into the overlay pixels
  function canvasUnder(cv, id1, top, px, W, xa, xb, ya, yb, d) {
    const r = BR(cv); if (!r.width || !r.height) return;
    const sx = cv.width / (r.width * d), sy = cv.height / (r.height * d), L = r.left * d, Tp = r.top * d;
    const cx0 = Math.max(0, Math.floor((xa - L) * sx)), cy0 = Math.max(0, Math.floor((ya - Tp) * sy));
    const cx1 = Math.min(cv.width, Math.ceil((xb - L) * sx)), cy1 = Math.min(cv.height, Math.ceil((yb - Tp) * sy));
    if (cx1 <= cx0 || cy1 <= cy0) return;
    let id; try { id = cv.getContext('2d').getImageData(cx0, cy0, cx1 - cx0, cy1 - cy0); } catch (e) { return; }
    const iw = cx1 - cx0, q = id.data;
    for (let y = ya; y < yb; y++) {
      const cy = Math.floor((y + 0.5 - Tp) * sy) - cy0; if (cy < 0 || cy >= cy1 - cy0) continue;
      for (let x = xa; x < xb; x++) {
        if (top[x - xa] !== id1) continue;
        const cx = Math.floor((x + 0.5 - L) * sx) - cx0; if (cx < 0 || cx >= iw) continue;
        const i = (cy * iw + cx) * 4; if (q[i + 3] !== 255) continue;
        const o = (y * W + x) * 4; if (px[o + 3]) continue;
        px[o] = q[i]; px[o + 1] = q[i + 1]; px[o + 2] = q[i + 2];
      }
    }
  }
  // the clip rectangle of an element: its overflow-clipping ancestors intersected (memoised per render: clipCache)
  let clipCache = new Map();
  const NOCLIP = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
  function clipOf(e) {
    if (!e || e.nodeType !== 1 || e === document.body) return NOCLIP;
    let r = clipCache.get(e);
    if (r) return r;
    r = clipOf(e.parentElement);
    const s = getComputedStyle(e);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
      const b = BR(e);
      r = { x0: Math.max(r.x0, b.left + e.clientLeft), y0: Math.max(r.y0, b.top + e.clientTop), x1: Math.min(r.x1, b.left + e.clientLeft + e.clientWidth), y1: Math.min(r.y1, b.top + e.clientTop + e.clientHeight) };
    }
    clipCache.set(e, r);
    return r;
  }
  // Incremental: the overlay keeps its pixels between renders. Each text line gets a signature (string, font, colour,
  // origin, clip, background under it); only lines whose signature changed (and lines overlapping their old or new
  // rectangles) are cleared and redrawn, and only those rectangles are written back to the canvas.
  let buf = null, prev = new Map(), full = true;
  const stats = { renders: 0, redrawn: 0, rects: 0, area: 0 };
  function render() {
    pending = 0; bgCache = new Map(); clipCache = new Map();
    const d = window.devicePixelRatio || 1, vw = vpW(), vh = vpH(), W = Math.round(vw * d), H = Math.round(vh * d);
    if (ov.width !== W || ov.height !== H || !buf || buf.width !== W || buf.height !== H) {
      ov.width = W; ov.height = H; ov.style.width = vw + 'px'; ov.style.height = vh + 'px';
      buf = octx.createImageData(W, H); prev = new Map(); full = true;
    }
    { const o = ov.getBoundingClientRect(); if (o.left !== OX || o.top !== OY) { OX = o.left; OY = o.top; prev = new Map(); buf = octx.createImageData(W, H); full = true; } }
    const px = buf.data;
    const de = document.getElementById('dialog'), dr = de && de.checkVisibility() && BR(de);
    const dlg = dr && dr.width ? { el: de, l: dr.left, t: dr.top, r: dr.right, b: dr.bottom } : null;
    const cur = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = n.textContent; if (!s.trim()) continue;
      const el = n.parentElement; if (!el || el.closest('script,style,canvas')) continue;
      const cs = getComputedStyle(el);
      const f = fontOf(cs.fontFamily, cs.fontWeight, cs.fontStyle, parseFloat(cs.fontSize));
      if (!f) continue;
      if (!hidden.has(el)) { el.style.webkitTextFillColor = 'transparent'; el.style.webkitTextStroke = '0 transparent'; hidden.add(el); }
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const col = rgbOf(cs.color); if (!col || col[1] === 0) continue;
      const c = clipOf(el), size = liveSize(f.size, d);
      const clip = { x0: Math.max(0, Math.floor(c.x0 * d)), y0: Math.max(0, Math.floor(c.y0 * d)), x1: Math.min(W, Math.ceil(c.x1 * d)), y1: Math.min(H, Math.ceil(c.y1 * d)) };
      if (clip.x1 <= clip.x0 || clip.y1 <= clip.y0) continue;
      if (dlg && !dlg.el.contains(el) && BR(el).top < dlg.b && BR(el).bottom > dlg.t && BR(el).left < dlg.r && BR(el).right > dlg.l) continue;
      // one draw per line (white-space: pre text with newlines)
      let off = 0, li = 0;
      for (const line of s.split('\n')) {
        if (line.trim()) {
          const r = document.createRange(); r.setStart(n, off); r.setEnd(n, off + line.length);
          const q = SH(r.getClientRects()[0]);
          if (q) {
            let ox = Math.round(q.left * d);
            const oy = Math.round((q.top + f.asc) * d);
            // centred / right-aligned text in its own box: Live's aligned origin (0x14297c670: x = (w - textW) >> 1 or
            // w - textW, textW = Live's text width) + 1.0 (text draw origin offset)
            const al = cs.textAlign;
            if ((al === 'center' || al === 'right' || al === 'end') && cs.display !== 'inline' && !s.includes('\n')) {
              const b = BR(el);
              const bl = Math.round((b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)) * d);
              const bw = Math.round((b.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * d);
              const tw = liveWidth(line, f.fk, size);
              ox = bl + (al === 'center' ? (bw - tw) >> 1 : bw - tw) + 1;
            }
            const ex = Math.ceil(extent(line, f.fk, size)) + 4, xa = Math.max(clip.x0, ox - 4), xb = Math.min(clip.x1, ox + ex);
            const ya = Math.max(clip.y0, oy - size * 2), yb = Math.min(clip.y1, oy + size);
            if (xb > xa && yb > ya) {
              // background per device column (sampled at the text's middle line; one sample when the ends agree)
              const my = (q.top + q.bottom) / 2, cols = bgCols(el, xa, xb, my, d);
              let h = 0; for (let i = 0; i < cols.length; i++) h = (Math.imul(h, 31) + cols[i]) | 0;
              const sig = [shaperGen(), line, f.fk, size, col[0], col[1], ox, oy, xa, xb, ya, yb, clip.x0, clip.y0, clip.x1, clip.y1, h].join('|');
              // texts over a canvas follow the canvas pixels: always redrawn
              cur.push({ key: n, li, sig: cols.cv.length ? null : sig, r: [xa, ya, xb, yb], line, f, size, col, ox, oy, clip, cols });
            }
          }
        }
        off += line.length + 1; li++;
      }
    }
    // which rectangles change
    const keyOf = e => e.key, now = new Map();
    for (const e of cur) { let m = now.get(keyOf(e)); if (!m) now.set(keyOf(e), m = []); m[e.li] = e; }
    const dirty = [];
    for (const e of cur) {
      const o = prev.get(e.key)?.[e.li];
      if (!o || o.sig !== e.sig || e.sig === null) { dirty.push(e.r); if (o) dirty.push(o.r); }
    }
    for (const [k, m] of prev) { const c2 = now.get(k); m.forEach((o, i) => { if (o && !(c2 && c2[i])) dirty.push(o.r); }); }
    prev = now;
    if (full) { dirty.push([0, 0, W, H]); full = false; }
    if (!dirty.length) return;
    const hit = r => dirty.some(q => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]);
    // every line touching a dirty rectangle is redrawn whole, so its rectangle becomes dirty too (until stable)
    const redo = new Set();
    for (let grow = true; grow;) { grow = false; for (const e of cur) if (!redo.has(e) && hit(e.r)) { redo.add(e); dirty.push(e.r); grow = true; } }
    for (const [x0, y0, x1, y1] of dirty) for (let y = y0; y < y1; y++) px.fill(0, (y * W + x0) * 4, (y * W + x1) * 4);
    for (const e of cur) {
      if (!redo.has(e)) continue;
      const [xa, ya, xb, yb] = e.r, cols = e.cols;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const o = (y * W + x) * 4; if (px[o + 3]) continue;
          const bg = cols[x - xa];
          px[o] = bg >> 16 & 255; px[o + 1] = bg >> 8 & 255; px[o + 2] = bg & 255;
        }
      }
      cols.cv.forEach((cv, k) => canvasUnder(cv, k + 1, cols.top, px, W, xa, xb, ya, yb, d));
      drawInto(px, W, H, 0, 0, e.line, e.f.fk, e.size, e.col[0], e.ox, e.oy, e.clip, false, Math.round(e.col[1] * 255));
    }
    // write back the union of the dirty rectangles (one bounding box per row band keeps the call count low)
    let u = null;
    for (const r of dirty) u = u ? [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])] : r.slice();
    stats.renders++; stats.redrawn += redo.size; stats.rects += dirty.length; stats.area += (u[2] - u[0]) * (u[3] - u[1]);
    if (dirty.length > 64) octx.putImageData(buf, 0, 0, u[0], u[1], u[2] - u[0], u[3] - u[1]);
    else for (const [x0, y0, x1, y1] of dirty) octx.putImageData(buf, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }
  const schedule = () => { if (!pending && ov) pending = requestAnimationFrame(render); };
  function attach() {
    if (ov) return;
    ov = document.createElement('canvas'); ov.id = 'live-text';
    Object.assign(ov.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: 2147483000 });
    document.body.append(ov); octx = ov.getContext('2d');
    new MutationObserver(ms => { if (ms.some(m => m.target !== ov)) schedule(); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    // hover styles change only when the pointer crosses an element boundary (mouseover / mouseout), not on every move
    for (const e of ['mouseover', 'mouseout', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'wheel', 'resize', 'scroll', 'focus', 'blur'])
      window.addEventListener(e, () => { schedule(); setTimeout(schedule, 30); }, true);
    // pinch-zoom and panning on phones and tablets report through the visual viewport, not the window
    for (const e of ['resize', 'scroll']) window.visualViewport?.addEventListener(e, () => { schedule(); setTimeout(schedule, 30); });
    window.addEventListener('touchend', () => { schedule(); setTimeout(schedule, 30); }, true);
    schedule();
  }
  ready.then(() => { if (document.body) attach(); else addEventListener('DOMContentLoaded', attach); });
  return { stats, ready, drawInto, extent, pxOf, glyphMask, fonts: FONTS, lcdRender, fillText, refresh: schedule, renderNow: () => ov && render() };
})();
