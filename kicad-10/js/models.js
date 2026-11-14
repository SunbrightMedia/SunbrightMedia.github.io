// Footprint 3D models: path resolution, embedded files, STEP/IGES (occt-import-js) and VRML.
//  - Path resolution follows FILENAME_RESOLVER::ResolvePath (common/filename_resolver.cpp):
//    kicad-embed:// URIs come from the footprint's then the board's embedded files; ${KIPRJMOD}
//    is the project folder; other partial paths are tried relative to the project folder.
//    Library variables such as ${KICAD10_3DMODEL_DIR} point at KiCad's installed library, which
//    is not in the zip, so those models are reported as missing.
//  - Embedded files are base64 of zstd-compressed data (common/embedded_files.cpp).
//  - VRML coordinates are multiplied by 2.54 unless the file has a top-level Transform with a
//    non-unity scale (plugins/3d/vrml/v2/vrml2_coords.cpp, vrml2_transform.cpp).
//  - STEP is read in millimetres (occt-import-js default linearUnit).
import * as THREE from 'three';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';
import { decompress as zstdDecompress } from 'fzstd';

const OCCT_URL = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/';

let worker = null, jobId = 0;
const pending = new Map();
function occtWorker() {
  if (worker) return worker;
  const src = `importScripts(${JSON.stringify(OCCT_URL + 'occt-import-js.js')});
const ready = occtimportjs({ locateFile: f => ${JSON.stringify(OCCT_URL)} + f });
onmessage = async e => {
  const { id, kind, bytes } = e.data;
  try {
    const occt = await ready;
    const r = kind === 'iges' ? occt.ReadIgesFile(bytes, null) : occt.ReadStepFile(bytes, null);
    if (!r.success) throw new Error('could not read the file');
    const meshes = r.meshes.map(m => ({
      color: m.color || null,
      faces: m.brep_faces || [],
      pos: new Float32Array(m.attributes.position.array),
      nor: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null,
      idx: new Uint32Array(m.index.array),
    }));
    postMessage({ id, meshes }, meshes.flatMap(m => [m.pos.buffer, m.idx.buffer].concat(m.nor ? [m.nor.buffer] : [])));
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};`;
  worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = e => { const p = pending.get(e.data.id); pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.meshes); };
  worker.onerror = e => { for (const p of pending.values()) p.reject(new Error('STEP reader failed to load')); pending.clear(); };
  return worker;
}
function readOcct(bytes, kind) {
  const id = ++jobId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); occtWorker().postMessage({ id, kind, bytes }, [bytes.buffer]); });
}

// occt-import-js returns Quantity_Color::Red()/Green()/Blue(), which are linear RGB in OCCT 7.5+;
// KiCad's OCE plugin uses a 0.6 grey (sRGB) where a STEP file gives no colour (plugins/3d/oce/loadmodel.cpp)
const linColor = c => c ? new THREE.Color(c[0], c[1], c[2]) : new THREE.Color().setRGB(0.6, 0.6, 0.6, THREE.SRGBColorSpace);
function occtToObject(meshes) {
  const group = new THREE.Group();
  for (const m of meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    if (m.nor) g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    if (!m.nor) g.computeVertexNormals();
    const faceColors = m.faces.some(f => f.color);
    let mat;
    if (faceColors) {
      // per-face colours from the STEP file -> vertex colours (faces own disjoint triangles)
      const col = new Float32Array(m.pos.length);
      const base = linColor(m.color);
      col.fill(0); for (let v = 0; v < col.length; v += 3) { col[v] = base.r; col[v + 1] = base.g; col[v + 2] = base.b; }
      for (const f of m.faces) {
        const cc = f.color ? linColor(f.color) : base;
        for (let t = f.first; t <= f.last; t++) for (let k = 0; k < 3; k++) {
          const v = m.idx[t * 3 + k];
          col[v * 3] = cc.r; col[v * 3 + 1] = cc.g; col[v * 3 + 2] = cc.b;
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: linColor(m.color), roughness: 0.5, metalness: 0 });
    }
    group.add(new THREE.Mesh(g, mat));
  }
  return group;
}

function vrmlToObject(text) {
  const loader = new VRMLLoader();
  const scene = loader.parse(text, '');
  // KiCad: legacy 0.1 inch units unless a top-level Transform carries a non-unity scale
  let topScale = false;
  for (const c of scene.children) if (Math.abs(c.scale.x - 1) > 1e-9 || Math.abs(c.scale.y - 1) > 1e-9 || Math.abs(c.scale.z - 1) > 1e-9) topScale = true;
  const g = new THREE.Group();
  g.add(scene);
  if (!topScale) scene.scale.multiplyScalar(2.54);
  return g;
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// files: Map(path -> Uint8Array) of the zip; projectDir: folder of the .kicad_pcb ('' or 'a/b/')
export function resolveModel(file, files, projectDir, embeddedStack, projectVars) {
  let name = file.replace(/\\/g, '/');
  if (name.startsWith('kicad-embed://')) {
    const key = name.slice('kicad-embed://'.length);
    for (const emb of embeddedStack) {
      const e = emb.get(key);
      if (e) return { bytes: () => zstdDecompress(base64ToBytes(e.data)), key: 'embed:' + key + ':' + e.data.length, name: key };
    }
    return null;
  }
  // ${VAR} / $(VAR) substitution: KIPRJMOD, then project text variables
  let unresolved = false;
  name = name.replace(/\$\{([^}]*)\}|\$\(([^)]*)\)/g, (m, a, b) => {
    const v = a || b;
    if (v === 'KIPRJMOD') return projectDir.replace(/\/$/, '');
    if (projectVars && projectVars[v] !== undefined) return projectVars[v];
    unresolved = true; return m;
  });
  if (unresolved) return null;
  const norm = p => {
    const parts = [];
    for (const s of p.split('/')) { if (s === '' || s === '.') continue; if (s === '..') parts.pop(); else parts.push(s); }
    return parts.join('/');
  };
  const tryPath = p => { const k = norm(p); return files.has(k) ? { bytes: () => files.get(k), key: 'zip:' + k, name: k } : null; };
  if (file.startsWith('${KIPRJMOD}') || file.startsWith('$(KIPRJMOD)')) return tryPath(name);
  if (/^([a-zA-Z]:)?\//.test(name)) return null;     // absolute path on the author's computer
  return tryPath(projectDir + name);                // partial path relative to the project
}

const cache = new Map();
export async function loadModelObject(res) {
  if (cache.has(res.key)) return (await cache.get(res.key)).clone();
  const p = (async () => {
    const ext = res.name.toLowerCase().split('.').pop();
    let bytes = res.bytes();
    if (ext === 'step' || ext === 'stp' || ext === 'stpz' || ext === 'iges' || ext === 'igs') {
      if (ext === 'stpz' || (bytes[0] === 0x1f && bytes[1] === 0x8b)) bytes = globalThis.fflate.gunzipSync(bytes);
      return occtToObject(await readOcct(bytes.slice(), ext === 'iges' || ext === 'igs' ? 'iges' : 'step'));
    }
    if (ext === 'wrl' || ext === 'wrz') {
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = globalThis.fflate.gunzipSync(bytes);
      const text = new TextDecoder().decode(bytes);
      if (!/^#VRML V2\.0/.test(text)) throw new Error('only VRML 2.0 files are supported');
      return vrmlToObject(text);
    }
    throw new Error('unsupported 3D model format .' + ext);
  })();
  cache.set(res.key, p);
  try { return (await p).clone(); } catch (e) { cache.delete(res.key); throw e; }
}

// RENDER_3D_OPENGL::get3dModelsFromFootprint (render_3d_opengl.cpp) as a matrix in the board's
// centred 3D frame (mm): T(fp, z) * Rz(orientation) * [flipped: Ry(pi) * Rz(pi)] *
// T(offset) * Rz(-rz) * Ry(-ry) * Rx(-rx) * S(scale)
export function modelMatrix(m, P, z) {
  const [x, y] = P(m.fpX, m.fpY);
  const M = new THREE.Matrix4().makeTranslation(x, y, m.flipped ? z.modelB : z.modelF);
  const R = (axis, deg) => new THREE.Matrix4().makeRotationAxis(axis, deg * Math.PI / 180);
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  if (m.fpA) M.multiply(R(Z, m.fpA));
  if (m.flipped) { M.multiply(R(Y, 180)); M.multiply(R(Z, 180)); }
  M.multiply(new THREE.Matrix4().makeTranslation(m.offset[0], m.offset[1], m.offset[2]));
  M.multiply(R(Z, -m.rotate[2])); M.multiply(R(Y, -m.rotate[1])); M.multiply(R(X, -m.rotate[0]));
  M.multiply(new THREE.Matrix4().makeScale(m.scale[0], m.scale[1], m.scale[2]));
  return M;
}
