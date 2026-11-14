import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { readBoard } from './pcb.js';
import { buildBoard, convexPieces } from './build3d.js';
import { resolveModel, loadModelObject, modelMatrix } from './models.js';
import { buildRoom } from './room.js';

const $ = s => document.querySelector(s);
const statusEl = $('#status');
const listEl = $('#boards');
const status = t => { statusEl.textContent = t; };

// ---------------------------------------------------------------- physical constants
const GRAVITY = 9.81;            // m/s^2
// FR-4 specific gravity 1.850 g/cm^3 (https://en.wikipedia.org/wiki/FR-4, "Specific gravity/density")
const FR4_DENSITY = 1850;        // kg/m^3
const MM = 0.001;

// ---------------------------------------------------------------- desk (metres, top surface at y = 0)
const DESK = { w: 1.6, d: 0.8, top: 0.03, legH: 0.72, leg: 0.05 };
const FLOOR_Y = -(DESK.top + DESK.legH);
// Poly Haven "Dark Wood" texture covers 2000 x 2000 mm (asset dimensions on polyhaven.com);
// its grain runs along the texture's U axis
const WOOD_TILE = 2.0;
// the room around the desk (metres)
const ROOM = { back: -0.85, front: 2.3, left: -2.0, right: 2.0, ceiling: FLOOR_Y + 2.6 };

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: $('#view') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a221c);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.005, 30);
camera.position.set(0, 0.42, 0.42);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.minDistance = 0.04;
controls.maxDistance = 1.6;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minAzimuthAngle = -1.1;   // stay on the room side of the desk
controls.maxAzimuthAngle = 1.1;
controls.update();

new RGBELoader().load('textures/studio_small_09_1k.hdr', tex => {
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex).texture;
  tex.dispose(); pm.dispose();
});
scene.environmentIntensity = 0.7;

// daylight through the window behind the desk (near-neutral so board colours stay true); the
// back wall shadows everything but the window opening
const sun = new THREE.DirectionalLight(0xfff3e2, 2.0);
// from back left and fairly high, so its mirror reflection off glossy mask goes to the front right,
// away from the usual viewing directions
sun.position.set(-1.6, 1.9, -1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -1.1, right: 1.1, top: 1.1, bottom: -1.1, near: 0.5, far: 5 });
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.0006;
sun.shadow.radius = 3;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xfff0dc, 0x5a4232, 0.35));

// wood
const texLoader = new THREE.TextureLoader();
const woodTex = (file, srgb) => {
  const t = texLoader.load('textures/' + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const wood = new THREE.MeshStandardMaterial({
  map: woodTex('dark_wood_diff_2k.jpg', true),
  roughnessMap: woodTex('dark_wood_rough_2k.jpg', false),
  normalMap: woodTex('dark_wood_nor_gl_2k.jpg', false),
  color: 0xb8aaa0, roughness: 1, metalness: 0,   // darkens the photo texture a little; the grain is unchanged
});

// box whose UVs are in metres / WOOD_TILE, grain (texture U) running along the box's longest axis
function woodBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const long = w >= d && w >= h ? 'x' : d >= h ? 'z' : 'y';
  for (let i = 0; i < pos.count; i++) {
    const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
    const n = { x: Math.abs(nor.getX(i)), y: Math.abs(nor.getY(i)), z: Math.abs(nor.getZ(i)) };
    const axes = ['x', 'y', 'z'].filter(a => n[a] < 0.5);          // the two in-plane axes
    const along = axes.includes(long) ? long : axes[0];
    const across = axes.find(a => a !== along);
    uv.setXY(i, p[along] / WOOD_TILE + 0.21, p[across] / WOOD_TILE + 0.37);
  }
  return g;
}

const desk = new THREE.Group();
const top = new THREE.Mesh(woodBox(DESK.w, DESK.top, DESK.d), wood);
top.position.y = -DESK.top / 2;
desk.add(top);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const leg = new THREE.Mesh(woodBox(DESK.leg, DESK.legH, DESK.leg), wood);
  leg.position.set(sx * (DESK.w / 2 - DESK.leg), -DESK.top - DESK.legH / 2, sz * (DESK.d / 2 - DESK.leg));
  desk.add(leg);
}
desk.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
scene.add(desk);
const { room, lampLight } = buildRoom({ floorY: FLOOR_Y, ceilingY: ROOM.ceiling, back: ROOM.back, front: ROOM.front, left: ROOM.left, right: ROOM.right });
lampLight.intensity = 3;
scene.add(room);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- physics
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
world.integrationParameters.lengthUnit = 0.01;   // objects are centimetre-sized
world.timestep = 1 / 120;
{
  const deskBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(DESK.w / 2, DESK.top / 2, DESK.d / 2).setTranslation(0, -DESK.top / 2, 0).setFriction(0.5), deskBody);
  world.createCollider(RAPIER.ColliderDesc.cuboid(6, 0.05, 6).setTranslation(0, FLOOR_Y - 0.05, 0).setFriction(0.6), deskBody);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    world.createCollider(RAPIER.ColliderDesc.cuboid(DESK.leg / 2, DESK.legH / 2, DESK.leg / 2)
      .setTranslation(sx * (DESK.w / 2 - DESK.leg), -DESK.top - DESK.legH / 2, sz * (DESK.d / 2 - DESK.leg)), deskBody);
}

const boards = [];   // { root, body, info }

function addBoardToWorld(built, name) {
  const root = new THREE.Group();
  root.name = name;
  const k = built.group;                 // KiCad 3D frame, mm
  k.scale.setScalar(MM);
  k.rotation.x = -Math.PI / 2;           // KiCad (x, y, z) -> three (x, z, -y)
  root.add(k);
  scene.add(root);

  // spawn position: spread boards out across the desk
  const i = boards.length;
  const SPOTS = [[0, 0], [0.22, -0.05], [-0.22, -0.05], [0.05, -0.2], [-0.1, 0.2], [0.3, 0.2], [-0.35, 0.15], [0.45, -0.2], [-0.45, -0.25]];
  const [sx, sz] = SPOTS[i % SPOTS.length];
  const spot = new THREE.Vector3(sx, 0.03 + 0.02 * Math.floor(i / SPOTS.length), sz);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spot.x, spot.y, spot.z).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.08));

  // board collider: convex pieces of the Edge.Cuts outline, extruded through the full stack
  const zt = built.z.maskF * MM, zb = built.z.maskB * MM;
  for (const piece of convexPieces(built.outlineEx, (x, y) => built.P(x, y))) {
    const pts = new Float32Array(piece.length * 6);
    piece.forEach(([x, y], j) => { pts.set([x * MM, zt, -y * MM, x * MM, zb, -y * MM], j * 6); });
    const cd = RAPIER.ColliderDesc.convexHull(pts);
    if (cd) world.createCollider(cd.setDensity(FR4_DENSITY).setFriction(0.45).setRestitution(0.05), body);
  }
  const b = { root, body, built, name };
  boards.push(b);
  return b;
}

// collider for a placed 3D model: its oriented bounding box (no mass is added: the files carry none)
function addModelCollider(b, box, matrix) {
  if (box.isEmpty()) return;
  const toRoot = new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeScale(MM, MM, MM));
  const pts = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z])
    pts.push(...new THREE.Vector3(x, y, z).applyMatrix4(matrix).applyMatrix4(toRoot).toArray());
  const cd = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
  if (cd) world.createCollider(cd.setDensity(0).setFriction(0.5), b.body);
}

// ---------------------------------------------------------------- dragging
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;
const LIFT = 0.012;   // the grabbed point is held 12 mm above where it was picked up

function pointerRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}

renderer.domElement.addEventListener('pointerdown', e => {
  if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  pointerRay(e);
  const hits = ray.intersectObjects(boards.map(b => b.root), true);
  if (!hits.length) return;
  let o = hits[0].object; while (o && !boards.some(b => b.root === o)) o = o.parent;
  const b = boards.find(bb => bb.root === o);
  controls.enabled = false;
  const p = hits[0].point;
  const t = b.body.translation(), q = b.body.rotation();
  const local = p.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w).invert());
  const hand = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
  const joint = world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: local.x, y: local.y, z: local.z }), hand, b.body, true);
  b.body.setAngularDamping(2.5);
  drag = { b, hand, joint, id: e.pointerId, start: [e.clientX, e.clientY], t0: performance.now(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -(p.y + LIFT)), target: p.clone().setY(p.y + LIFT) };
  renderer.domElement.setPointerCapture(e.pointerId);
  renderer.domElement.style.cursor = 'grabbing';
  e.preventDefault();
}, { capture: true });

renderer.domElement.addEventListener('pointermove', e => {
  if (!drag) {
    if (e.pointerType === 'mouse') {
      pointerRay(e);
      renderer.domElement.style.cursor = ray.intersectObjects(boards.map(b => b.root), true).length ? 'grab' : '';
    }
    return;
  }
  if (e.pointerId !== drag.id) return;
  pointerRay(e);
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(drag.plane, p)) {
    p.x = THREE.MathUtils.clamp(p.x, -DESK.w / 2 - 0.1, DESK.w / 2 + 0.1);
    p.z = THREE.MathUtils.clamp(p.z, -DESK.d / 2 - 0.1, DESK.d / 2 + 0.1);
    drag.target.copy(p);
  }
});

// a double click / double tap on a board turns it over (to see the back side)
let lastTap = null;
function flipBoard(b) {
  const t = b.body.translation(), q = b.body.rotation();
  const nq = new THREE.Quaternion(q.x, q.y, q.z, q.w).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
  b.body.setTranslation({ x: t.x, y: t.y + 0.04, z: t.z }, true);
  b.body.setRotation({ x: nq.x, y: nq.y, z: nq.z, w: nq.w }, true);
  b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const moved = drag.start && e ? Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) : 99;
  if (moved < 8 && performance.now() - drag.t0 < 400) {
    if (lastTap && lastTap.b === drag.b && performance.now() - lastTap.t < 450) { lastTap = null; drag.flip = true; }
    else lastTap = { b: drag.b, t: performance.now() };
  } else lastTap = null;
  if (drag.flip) { world.removeImpulseJoint(drag.joint, true); world.removeRigidBody(drag.hand); drag.b.body.setAngularDamping(0.08); flipBoard(drag.b); drag = null; controls.enabled = true; return; }
  world.removeImpulseJoint(drag.joint, true);
  world.removeRigidBody(drag.hand);
  drag.b.body.setAngularDamping(0.08);
  drag = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = '';
}
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- loop
let acc = 0, last = performance.now();
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= world.timestep) {
    if (drag) {
      // move the hand towards the pointer at a bounded speed so the joint stays well-behaved
      const h = drag.hand.translation();
      const d = new THREE.Vector3(drag.target.x - h.x, drag.target.y - h.y, drag.target.z - h.z);
      const max = 1.5 * world.timestep;
      if (d.length() > max) d.setLength(max);
      drag.hand.setNextKinematicTranslation({ x: h.x + d.x, y: h.y + d.y, z: h.z + d.z });
    }
    world.step();
    acc -= world.timestep;
  }
  for (const b of boards) {
    const t = b.body.translation(), q = b.body.rotation();
    b.root.position.set(t.x, t.y, t.z);
    b.root.quaternion.set(q.x, q.y, q.z, q.w);
    if (t.y < FLOOR_Y - 1) { b.body.setTranslation({ x: 0, y: 0.05, z: 0 }, true); b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
  }
  controls.update();
  // keep the camera inside the room
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, ROOM.left + 0.15, ROOM.right - 0.15);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, FLOOR_Y + 0.15, ROOM.ceiling - 0.15);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, ROOM.back + 0.15, ROOM.front - 0.15);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- loading projects
function unzip(bytes) {
  return new Promise((resolve, reject) => {
    fflate.unzip(bytes, { filter: f => !f.name.startsWith('__MACOSX/') && !/(^|\/)\._/.test(f.name) && !f.name.endsWith('/') },
      (err, out) => err ? reject(err) : resolve(out));
  });
}

// point the camera at a board so it fills most of the view (first board only)
function frameBoard(b) {
  const t = b.body.translation();
  const r = Math.hypot(b.built.size[0], b.built.size[1]) * MM / 2;
  const vfov = camera.fov * Math.PI / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = THREE.MathUtils.clamp(1.25 * r / Math.sin(Math.min(vfov, hfov) / 2), controls.minDistance * 2, 1.2);
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.set(t.x, 0, t.z);
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  controls.update();
}

function pickBoardFile(names) {
  const pcbs = names.filter(n => n.endsWith('.kicad_pcb') && !/-backups\/|_autosave-|(^|\/)~/.test(n));
  if (!pcbs.length) return null;
  const withPro = pcbs.filter(n => names.includes(n.replace(/\.kicad_pcb$/, '.kicad_pro')));
  const pool = withPro.length ? withPro : pcbs;
  pool.sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0));
  return pool[0];
}

async function loadZip(bytes, label) {
  status(`Opening ${label}…`);
  const files = new Map(Object.entries(await unzip(bytes)));
  const pcbName = pickBoardFile([...files.keys()]);
  if (!pcbName) throw new Error(`${label}: no .kicad_pcb file in the zip`);
  const dir = pcbName.includes('/') ? pcbName.slice(0, pcbName.lastIndexOf('/') + 1) : '';
  let textVars = {};
  const pro = files.get(pcbName.replace(/\.kicad_pcb$/, '.kicad_pro'));
  if (pro) try { textVars = JSON.parse(new TextDecoder().decode(pro)).text_variables || {}; } catch (e) {}
  const warnings = [];
  status(`Reading ${pcbName.split('/').pop()}…`);
  await new Promise(r => setTimeout(r, 0));
  const board = await readBoard(new TextDecoder().decode(files.get(pcbName)), {
    textVars, fileName: pcbName.split('/').pop(), warn: m => warnings.push(m) });
  status(`Building ${pcbName.split('/').pop()}…`);
  await new Promise(r => setTimeout(r, 0));
  const built = buildBoard(board);
  const name = pcbName.split('/').pop().replace(/\.kicad_pcb$/, '');
  const b = addBoardToWorld(built, name);
  if (boards.length === 1) frameBoard(b);
  const entry = boardEntry(name, built, warnings);
  status('');
  loadModels(b, board, files, dir, textVars, entry);
  return b;
}

function boardEntry(name, built, warnings) {
  const li = document.createElement('details');
  li.innerHTML = `<summary></summary><div class="body"></div>`;
  li.querySelector('summary').textContent = `${name} — ${built.size[0].toFixed(1)} × ${built.size[1].toFixed(1)} mm`;
  const body = li.querySelector('.body');
  for (const w of warnings) { const p = document.createElement('p'); p.textContent = w; body.append(p); }
  const models = document.createElement('p'); body.append(models);
  listEl.append(li);
  listEl.hidden = false;
  return { li, models, body };
}

async function loadModels(b, board, files, dir, textVars, entry) {
  const shown = board.models.filter(m => m.show && !m.dnp && m.file);   // DNP models hidden (show_footprints_dnp = false)
  let ok = 0, failed = 0;
  const missing = new Map();
  const update = () => { entry.models.textContent = `3D models: ${ok} shown` + (missing.size ? `, ${[...missing.values()].reduce((a, v) => a + v, 0)} not in the zip` : '') + (failed ? `, ${failed} unreadable` : ''); };
  update();
  const jobs = shown.map(async m => {
    const res = resolveModel(m.file, files, dir, [m.embedded, board.embedded], textVars);
    if (!res) { missing.set(m.file, (missing.get(m.file) || 0) + 1); update(); return; }
    try {
      const obj = await loadModelObject(res);
      const M = modelMatrix(m, b.built.P, b.built.z);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj, true);
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(M);
      if (m.opacity < 1) obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity *= m.opacity; } });
      obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      b.built.group.add(obj);
      obj.updateMatrixWorld(true);
      addModelCollider(b, box, M);
      ok++;
    } catch (e) {
      failed++;
      const p = document.createElement('p'); p.textContent = `${m.file}: ${e.message}`; entry.body.append(p);
    }
    update();
  });
  await Promise.all(jobs);
  if (missing.size) {
    const d = document.createElement('ul');
    d.className = 'missing';
    for (const [f, n] of missing) { const li = document.createElement('li'); li.textContent = n > 1 ? `${f} (×${n})` : f; d.append(li); }
    entry.body.append(d);
  }
}

async function loadFiles(list) {
  for (const f of list) {
    if (!/\.zip$/i.test(f.name)) { status(`${f.name} is not a .zip`); continue; }
    try { await loadZip(new Uint8Array(await f.arrayBuffer()), f.name); }
    catch (e) { console.error(e); status(String(e.message || e)); }
  }
}

$('#open').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', e => { loadFiles([...e.target.files]); e.target.value = ''; });
addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('over'); });
addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('over'); });
addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('over'); loadFiles([...(e.dataTransfer?.files || [])]); });

// projects listed in projects/manifest.json are put on the desk at start
(async () => {
  let manifest = null;
  try { const r = await fetch('projects/manifest.json', { cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch (e) {}
  for (const p of manifest?.projects || []) {
    try {
      const parts = p.parts || [p.file];
      const chunks = [];
      for (const u of parts) { const r = await fetch(u); if (!r.ok) throw new Error(`Couldn't download ${u} (${r.status})`); chunks.push(new Uint8Array(await r.arrayBuffer())); }
      const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
      let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
      await loadZip(all, p.name || parts[0]);
    } catch (e) { console.error(e); status(String(e.message || e)); }
  }
  if (!boards.length) status('Drop a zipped KiCad project here, or use Open.');
})();

window.__kicad = { boards, world, scene, camera, controls, loadZip };
