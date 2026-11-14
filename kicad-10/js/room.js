// A small low-poly room around the desk: walls, floor, ceiling, a window, a wall shelf with
// books, a floor lamp, a rug and a potted plant. Plain faceted geometry built here (no external
// assets), flat-shaded, a few hundred triangles in all. Units: metres, desk top at y = 0.
import * as THREE from 'three';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...opts });

export function buildRoom({ floorY, ceilingY, back, front, left, right }) {
  const room = new THREE.Group();
  room.name = 'room';
  const H = ceilingY - floorY, W = right - left, D = front - back;
  const add = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; room.add(o); return o; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  const wall = mat(0xd9c7a8), wallSide = mat(0xcdb894), trim = mat(0xf1e9da), ceilingM = mat(0xece4d6);
  const floorM = mat(0x6e4a30), floorDark = mat(0x5f3f28);

  // floor: planks as long faceted strips in two alternating tones
  const plank = 0.18;
  for (let i = 0, x = left; x < right - 1e-6; i++, x += plank) {
    const w = Math.min(plank, right - x);
    add(box(w - 0.004, 0.02, D), i % 2 ? floorM : floorDark, x + w / 2, floorY - 0.01, (back + front) / 2);
  }
  add(box(W, 0.02, D), ceilingM, (left + right) / 2, ceilingY + 0.01, (back + front) / 2);

  // back wall with a window opening behind the desk
  const win = { w: 2.2, h: 1.5, x: -0.4, y: 0.22 };      // opening bottom at y, centred at x
  const wy0 = win.y, wy1 = win.y + win.h, wx0 = win.x - win.w / 2, wx1 = win.x + win.w / 2;
  const t = 0.1;
  add(box(wx0 - left + 0.01, H, t), wall, (left + wx0 - 0.01) / 2, floorY + H / 2, back - t / 2);
  add(box(right - wx1 + 0.01, H, t), wall, (wx1 + 0.01 + right) / 2, floorY + H / 2, back - t / 2);
  add(box(win.w, wy0 - floorY, t), wall, win.x, (floorY + wy0) / 2, back - t / 2);
  add(box(win.w, ceilingY - wy1, t), wall, win.x, (wy1 + ceilingY) / 2, back - t / 2);
  add(box(t, H, D), wallSide, left - t / 2, floorY + H / 2, (back + front) / 2);
  add(box(t, H, D), wallSide, right + t / 2, floorY + H / 2, (back + front) / 2);
  add(box(W + 2 * t, H, t), wall, (left + right) / 2, floorY + H / 2, front + t / 2);

  // skirting boards
  add(box(W, 0.09, 0.015), trim, (left + right) / 2, floorY + 0.045, back + 0.008);
  add(box(0.015, 0.09, D), trim, left + 0.008, floorY + 0.045, (back + front) / 2);
  add(box(0.015, 0.09, D), trim, right - 0.008, floorY + 0.045, (back + front) / 2);

  // window: frame, sill and a pale sky behind the glass
  const frameM = mat(0xefe6d6);
  const f = 0.05;
  add(box(win.w + 2 * f, f, 0.08), frameM, win.x, wy1 + f / 2, back - 0.04);
  add(box(win.w + 2 * f, f, 0.08), frameM, win.x, wy0 - f / 2, back - 0.04);
  add(box(f, win.h, 0.08), frameM, wx0 - f / 2, (wy0 + wy1) / 2, back - 0.04);
  add(box(f, win.h, 0.08), frameM, wx1 + f / 2, (wy0 + wy1) / 2, back - 0.04);
  add(box(win.w + 0.2, 0.03, 0.14), frameM, win.x, wy0 - f - 0.015, back + 0.03);
  // glazing bars (they cast no shadow, so no stripes fall across the boards)
  const bars = [];
  for (const k of [1 / 3, 2 / 3]) bars.push(add(box(0.03, win.h, 0.04), frameM, wx0 + win.w * k, (wy0 + wy1) / 2, back - 0.05));
  bars.push(add(box(win.w, 0.03, 0.04), frameM, win.x, wy0 + win.h * 0.62, back - 0.05));
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(win.w * 3, win.h * 3),
    new THREE.MeshBasicMaterial({ color: 0xe6ebee }));
  sky.position.set(win.x, (wy0 + wy1) / 2, back - 0.6);
  room.add(sky);
  // wall shelf with books (back wall, right of the window)
  const shelfM = mat(0x7a5235);
  const sx = 1.45, sy = 0.62;
  add(box(0.8, 0.03, 0.2), shelfM, sx, sy, back + 0.1);
  for (const bx of [-0.33, 0.33]) add(box(0.025, 0.12, 0.17), shelfM, sx + bx, sy - 0.075, back + 0.09);
  const bookColors = [0x2f4f6f, 0x8a3324, 0x55693a, 0xc49a48, 0x5a3d5c, 0x9c6b3c, 0x2e5d57];
  let bx = sx - 0.36;
  bookColors.forEach((c, i) => {
    const w = 0.03 + (i % 3) * 0.008, h = 0.17 + ((i * 37) % 5) * 0.012;
    add(box(w, h, 0.14), mat(c), bx + w / 2, sy + 0.015 + h / 2, back + 0.1);
    bx += w + 0.004;
  });
  const leaning = add(box(0.035, 0.19, 0.14), mat(0x6b4a2b), bx + 0.06, sy + 0.015 + 0.09, back + 0.1);
  leaning.rotation.z = -0.35;
  // rug under the desk
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.012, 8), mat(0x6e3b2c));
  rug.scale.set(1.2, 1, 0.75); rug.position.set(0, floorY + 0.006, 0.25); room.add(rug);
  const rugIn = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.013, 8), mat(0x8f6448));
  rugIn.scale.set(1.2, 1, 0.75); rugIn.position.set(0, floorY + 0.007, 0.25); room.add(rugIn);

  // floor lamp, back left of the desk
  const lampX = -1.25, lampZ = back + 0.35;
  const metal = mat(0x2b2622, { roughness: 0.6 });
  add(new THREE.CylinderGeometry(0.14, 0.16, 0.03, 8), metal, lampX, floorY + 0.015, lampZ);
  add(new THREE.CylinderGeometry(0.015, 0.015, 1.45, 6), metal, lampX, floorY + 0.75, lampZ);
  const shadeM = mat(0xf3d9a4, { emissive: 0xffc77a, emissiveIntensity: 0.55, side: THREE.DoubleSide });
  add(new THREE.CylinderGeometry(0.13, 0.22, 0.26, 8, 1, true), shadeM, lampX, floorY + 1.52, lampZ);
  const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 0), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
  bulb.position.set(lampX, floorY + 1.47, lampZ); room.add(bulb);
  const lampLight = new THREE.PointLight(0xffb468, 1.6, 4.5, 2);
  lampLight.position.set(lampX, floorY + 1.45, lampZ);
  room.add(lampLight);

  // potted plant, front right of the desk
  const px = 1.15, pz = back + 0.45;
  add(new THREE.CylinderGeometry(0.17, 0.12, 0.3, 8), mat(0xa65e3b), px, floorY + 0.15, pz);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 8), mat(0x3d2a1c), px, floorY + 0.29, pz);
  const leafM = mat(0x4c7d3c), leafM2 = mat(0x3d6a33);
  const leaves = [[0, 0.62, 0, 0.2], [0.13, 0.5, 0.06, 0.15], [-0.12, 0.55, -0.05, 0.16], [0.04, 0.78, -0.06, 0.13], [-0.06, 0.42, 0.11, 0.12]];
  leaves.forEach(([x, y, z, r], i) => add(new THREE.IcosahedronGeometry(r, 0), i % 2 ? leafM2 : leafM, px + x, floorY + y, pz + z, i));
  add(new THREE.CylinderGeometry(0.012, 0.016, 0.4, 5), mat(0x5a4632), px, floorY + 0.48, pz);

  room.traverse(o => { if (o.isMesh && o !== sky && o !== bulb) { o.receiveShadow = o.material !== frameM && o.material !== wall; o.castShadow = !bars.includes(o); } });
  return { room, lampLight, window: { x: win.x, y0: wy0, y1: wy1, z: back } };
}
