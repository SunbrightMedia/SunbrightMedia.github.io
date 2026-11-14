// S-expression reader for KiCad files.
// Syntax per https://dev-docs.kicad.org/en/file-formats/sexpr-intro/ : tokens in ( ), strings in
// double quotes (UTF-8). Embedded file data (KiCad 9+) is written between '|' bars, see
// common/embedded_files.cpp (EMBEDDED_FILES::WriteEmbeddedFiles / EMBEDDED_FILES_PARSER).
//
// A list becomes a JS array whose first element is its keyword; atoms become strings.
// Quoted strings are wrapped as Str so a quoted "hide" is not mistaken for the hide keyword.

export class Str { constructor(s) { this.s = s; } toString() { return this.s; } }

export function parseSexpr(text) {
  let i = 0;
  const n = text.length;
  const stack = [];
  let cur = null, root = null;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 40) { // (
      const list = [];
      if (cur) cur.push(list); else root = list;
      stack.push(cur); cur = list; i++;
    } else if (c === 41) { // )
      cur = stack.pop(); i++;
      if (!cur && root) break;
    } else if (c <= 32) {
      i++;
    } else if (c === 34) { // "
      let j = i + 1, out = '', seg = j;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === 92) { // backslash escape
          out += text.slice(seg, j);
          const e = text[j + 1];
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          j += 2; seg = j;
        } else if (d === 34) break;
        else j++;
      }
      out += text.slice(seg, j);
      cur.push(new Str(out));
      i = j + 1;
    } else if (c === 124) { // | base64 data |
      const j = text.indexOf('|', i + 1);
      cur.push(text.slice(i + 1, j).replace(/\s+/g, ''));
      i = j + 1;
    } else {
      let j = i;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d <= 32 || d === 40 || d === 41) break;
        j++;
      }
      cur.push(text.slice(i, j));
      i = j;
    }
  }
  return root;
}

// helpers
export const S = v => (v instanceof Str ? v.s : v);
export const isList = v => Array.isArray(v);
export function find(list, key) {
  if (!list) return null;
  for (let k = 1; k < list.length; k++) { const e = list[k]; if (Array.isArray(e) && e[0] === key) return e; }
  return null;
}
export function findAll(list, key) {
  const r = [];
  if (!list) return r;
  for (let k = 1; k < list.length; k++) { const e = list[k]; if (Array.isArray(e) && e[0] === key) r.push(e); }
  return r;
}
export const num = v => parseFloat(S(v));
// value of (key v) as number
export function getNum(list, key, def) { const e = find(list, key); return e && e.length > 1 ? num(e[1]) : def; }
export function getStr(list, key, def) { const e = find(list, key); return e && e.length > 1 ? S(e[1]) : def; }
// bare-flag or (flag yes|no) style booleans (parseMaybeAbsentBool in the KiCad parser)
export function getBool(list, key, def) {
  if (!list) return def;
  for (let k = 1; k < list.length; k++) {
    const e = list[k];
    if (e === key) return true;
    if (Array.isArray(e) && e[0] === key) {
      if (e.length < 2) return true;
      const v = S(e[1]);
      return v === 'yes' || v === 'true';
    }
  }
  return def;
}
export function hasAtom(list, atom) {
  if (!list) return false;
  for (let k = 1; k < list.length; k++) if (list[k] === atom) return true;
  return false;
}
