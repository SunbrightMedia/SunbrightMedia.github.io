/* Ableton Live 12 Set viewer.
 * Reads a zipped Live Project (Collect All and Save, tracks frozen) entirely in the browser,
 * rebuilds the Arrangement view, shows each track's devices, and plays the frozen audio.
 * Nothing is uploaded anywhere. */
'use strict';

// ---------------------------------------------------------------------------
// Constants

// Live's 70 clip/track colours, by Color index
const PALETTE = ['#FF94A6','#FFA529','#CC9927','#F7F47C','#BFFB00','#1AFF2F','#25FFA8','#5CFFE8','#8BC5FF','#5480E4','#92A7FF','#D86CE4','#E553A0','#FFFFFF','#FF3636','#F66C03','#99724B','#FFF034','#87FF67','#3DC300','#00BFAF','#19E9FF','#10A4EE','#007DC0','#886CE4','#B677C6','#FF39D4','#D0D0D0','#E2675A','#FFA374','#D3AD71','#EDFFAE','#D2E498','#BAD074','#9BC48D','#D4FDE1','#CDF1F8','#B9C1E3','#CDBBE4','#AE98E5','#E5DCE1','#A9A9A9','#C6928B','#B78256','#99836A','#BFBA69','#A6BE00','#7DB04D','#88C2BA','#9BB3C4','#85A5C2','#8393CC','#A595B5','#BF9FBE','#BC7196','#7B7B7B','#AF3333','#A95131','#724F41','#DBC300','#85961F','#539F31','#0A9C8E','#236384','#1A2F96','#2F52A2','#624BAD','#A34BAD','#CC2E6E','#3C3C3C'];
const PITCH = ['C','C#/D♭','D','D#/E♭','E','F','F#/G♭','G','G#/A♭','A','A#/B♭','B'];
const SCALES = ['Major','Minor','Dorian','Mixolydian','Lydian','Phrygian','Locrian','Whole Tone','Half-whole Dim.','Whole-half Dim.','Minor Blues','Minor Pentatonic','Major Pentatonic','Harmonic Minor','Harmonic Major','Dorian #4','Phrygian Dominant','Melodic Minor','Lydian Augmented','Lydian Dominant','Super Locrian','8-Tone Spanish','Bhairav','Hungarian Minor','Hirajoshi','In-Sen','Iwato','Kumoi','Pelog Selisir','Pelog Tembung','Messiaen 3','Messiaen 4','Messiaen 5','Messiaen 6','Messiaen 7'];

// Device element tags → the names Live shows
const DEVICE_NAMES = {
  InstrumentGroupDevice: 'Instrument Rack', AudioEffectGroupDevice: 'Audio Effect Rack', MidiEffectGroupDevice: 'MIDI Effect Rack', DrumGroupDevice: 'Drum Rack',
  OriginalSimpler: 'Simpler', MultiSampler: 'Sampler', Operator: 'Operator', UltraAnalog: 'Analog', InstrumentVector: 'Wavetable', Drift: 'Drift',
  Collision: 'Collision', StringStudio: 'Tension', LoungeLizard: 'Electric', InstrumentImpulse: 'Impulse', InstrumentMeld: 'Meld', Meld: 'Meld',
  ProxyInstrumentDevice: 'External Instrument', ProxyAudioEffectDevice: 'External Audio Effect',
  Eq8: 'EQ Eight', FilterEQ3: 'EQ Three', ChannelEq: 'Channel EQ', Compressor2: 'Compressor', Compressor: 'Compressor', GlueCompressor: 'Glue Compressor',
  MultibandDynamics: 'Multiband Dynamics', Limiter: 'Limiter', Gate: 'Gate', AutoFilter: 'Auto Filter', AutoFilter2: 'Auto Filter', AutoPan: 'Auto Pan-Tremolo',
  BeatRepeat: 'Beat Repeat', Chorus: 'Chorus', Chorus2: 'Chorus-Ensemble', Corpus: 'Corpus', Delay: 'Delay', Echo: 'Echo', Erosion: 'Erosion',
  FilterDelay: 'Filter Delay', FrequencyShifter: 'Shifter', GrainDelay: 'Grain Delay', Hybrid: 'Hybrid Reverb', Looper: 'Looper', Overdrive: 'Overdrive',
  Pedal: 'Pedal', PhaserNew: 'Phaser-Flanger', Phaser: 'Phaser', Flanger: 'Flanger', Redux: 'Redux', Redux2: 'Redux', Resonator: 'Resonators',
  Reverb: 'Reverb', Saturator: 'Saturator', Shifter: 'Shifter', SpectralResonator: 'Spectral Resonator', SpectralTime: 'Spectral Time',
  SpectrumAnalyzer: 'Spectrum', StereoGain: 'Utility', Tuner: 'Tuner', Vinyl: 'Vinyl Distortion', Vocoder: 'Vocoder', DrumBuss: 'Drum Buss',
  Roar: 'Roar', Amp: 'Amp', Cabinet: 'Cabinet', Tube: 'Dynamic Tube', CrossDelay: 'Simple Delay', PingPongDelay: 'Ping Pong Delay',
  MidiArpeggiator: 'Arpeggiator', MidiChord: 'Chord', MidiNoteLength: 'Note Length', MidiPitcher: 'Pitch', MidiRandom: 'Random', MidiScale: 'Scale',
  MidiVelocity: 'Velocity', MidiCc: 'CC Control',
};
const DEVICE_KINDS = {
  InstrumentGroupDevice: 'Rack', AudioEffectGroupDevice: 'Rack', MidiEffectGroupDevice: 'Rack', DrumGroupDevice: 'Rack',
  MxDeviceAudioEffect: 'Max Audio Effect', MxDeviceInstrument: 'Max Instrument', MxDeviceMidiEffect: 'Max MIDI Effect',
};
const RACKS = new Set(['InstrumentGroupDevice', 'AudioEffectGroupDevice', 'MidiEffectGroupDevice', 'DrumGroupDevice']);
const SKIP_PARAMS = new Set(['On', 'LomId', 'LomIdView', 'Pointee', 'LastPresetRef', 'SourceContext', 'LockedScripts', 'ViewData', 'Branches', 'ReturnBranches',
  'IsExpanded', 'ModulationSourceCount', 'ParametersListWrapper', 'LastSelectedTimeableIndex', 'LastSelectedClipEnvelopeIndex', 'IsFolded',
  'ShouldShowPresetName', 'UserName', 'Annotation', 'MpePitchBendUsesTuning', 'ViewStateSesstionTrackWidth', 'PluginDesc', 'ParameterList',
  'MidiControllerRange', 'AutomationTarget', 'ModulationTarget', 'MacroControls', 'MacroDisplayNames', 'MacroDefaults', 'MacroAnnotations', 'MacroColors',
  'Player', 'SampleRef', 'PatchSlot', 'MxPatchRef', 'BranchPresets', 'ChainSelector', 'ChainSelectorRelativePosition', 'ViewsToRestoreWhenUnfolding']);
const FOLDED_H = 17, MIN_H = 17, SEP = 2;

// ---------------------------------------------------------------------------
// Small helpers

const $ = (s, root = document) => root.querySelector(s);
const kid = (el, tag) => { if (!el) return null; for (const c of el.children) if (c.tagName === tag) return c; return null; };
const at = (el, ...tags) => tags.reduce((e, t) => kid(e, t), el);
const val = (el, ...tags) => at(el, ...tags)?.getAttribute('Value') ?? null;
const num = (el, ...tags) => { const v = val(el, ...tags); return v == null || v === '' ? null : Number(v); };
const bool = (el, ...tags) => val(el, ...tags) === 'true';
const kids = (el, ...tags) => { const e = at(el, ...tags); return e ? [...e.children] : []; };
const color = i => (i == null || i < 0 ? '#9a9a9a' : PALETTE[i] || '#9a9a9a');
const prettify = tag => tag.replace(/\.(\d+)/g, (_, n) => ' ' + (Number(n) + 1)).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^Parameter /, '').trim();
const luminance = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const basename = p => p.split(/[\\/]/).pop();
const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmtVal(v) {
  if (v === 'true') return 'On';
  if (v === 'false') return 'Off';
  const n = Number(v);
  if (v === '' || Number.isNaN(n)) return v;
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return String(Number(n.toFixed(3)));
}
const status = t => { $('#status-text').textContent = t; };

// ---------------------------------------------------------------------------
// Reading the zip and the Set

let files = new Map();       // path in zip → Uint8Array
let filesLower = new Map();  // lower-case basename → [paths]

function unzip(bytes) {
  return new Promise((resolve, reject) => {
    fflate.unzip(bytes, { filter: f => !f.name.startsWith('__MACOSX/') && !/(^|\/)\._/.test(f.name) && !f.name.endsWith('/') }, (err, out) => err ? reject(err) : resolve(out));
  });
}

async function gunzipText(bytes) {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? fflate.gunzipSync(bytes) : bytes;
  return new TextDecoder('utf-8').decode(raw);
}

function indexFiles(out) {
  files = new Map(Object.entries(out));
  filesLower = new Map();
  for (const p of files.keys()) {
    const b = basename(p).toLowerCase();
    if (!filesLower.has(b)) filesLower.set(b, []);
    filesLower.get(b).push(p);
  }
}

function findSets() {
  return [...files.keys()]
    .filter(p => /\.als$/i.test(p) && !/(^|\/)Backup\//i.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

// Resolves a FileRef to a file inside the zip
function resolveRef(fileRef, root) {
  if (!fileRef) return null;
  let rel = val(fileRef, 'RelativePath');
  if (rel == null || rel === '') {
    const dirs = kids(fileRef, 'RelativePath').map(e => e.getAttribute('Dir')).filter(Boolean);
    const name = val(fileRef, 'Name');
    if (dirs.length || name) rel = [...dirs, name].filter(Boolean).join('/');
  }
  const abs = val(fileRef, 'Path') || '';
  const tryPaths = [];
  if (rel) {
    rel = rel.replace(/\\/g, '/');
    tryPaths.push(normalize(root + rel));
  }
  for (const p of tryPaths) if (files.has(p)) return p;
  const name = basename(rel || abs);
  if (!name) return null;
  const hits = filesLower.get(name.toLowerCase());
  if (!hits) return null;
  // prefer a file inside this project folder
  return hits.find(h => h.startsWith(root)) || hits[0];
}
function normalize(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '..') out.pop(); else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

// ---------------------------------------------------------------------------
// Set model

function parseSet(xmlText, setPath) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The Live Set file could not be read.');
  const ableton = doc.documentElement;
  const ls = kid(ableton, 'LiveSet');
  if (!ls) throw new Error('This does not look like a Live Set.');
  const root = dirname(setPath);
  const main = kid(ls, 'MainTrack') || kid(ls, 'MasterTrack');
  const mainMixer = at(main, 'DeviceChain', 'Mixer');

  const envelopesFor = (track, param) => {
    const id = at(param, 'AutomationTarget')?.getAttribute('Id');
    if (id == null) return [];
    const env = kids(track, 'AutomationEnvelopes', 'Envelopes').find(e => val(e, 'EnvelopeTarget', 'PointeeId') === id);
    return kids(env, 'Automation', 'Events').map(e => ({ t: Number(e.getAttribute('Time')), v: Number(e.getAttribute('Value')) })).sort((a, b) => a.t - b.t);
  };
  const tempoEvents = envelopesFor(main, at(mainMixer, 'Tempo'));
  const sigEvents = envelopesFor(main, at(mainMixer, 'TimeSignature'));
  const tempo0 = tempoEvents.length ? tempoEvents[0].v : (num(mainMixer, 'Tempo', 'Manual') || 120);
  const sigCode = sigEvents.length ? sigEvents[0].v : (num(mainMixer, 'TimeSignature', 'Manual') ?? 201);
  const sig = { num: (sigCode % 99) + 1, den: 2 ** Math.floor(sigCode / 99) };

  const scaleEl = kid(ls, 'ScaleInformation');
  const rootNote = num(scaleEl, 'Root') ?? num(scaleEl, 'RootNote');
  const scaleName = val(scaleEl, 'Name');
  const scale = { root: rootNote == null ? 'C' : PITCH[rootNote % 12], name: scaleName == null ? 'Major' : (SCALES[Number(scaleName)] ?? scaleName) };

  const set = {
    name: basename(setPath).replace(/\.als$/i, ''),
    creator: ableton.getAttribute('Creator') || '',
    tempo: tempo0, tempoEvents: tempoEvents.filter(e => e.t > -1e6), sig, scale, root,
    quant: ['None', '8 Bars', '4 Bars', '2 Bars', '1 Bar', '1/2', '1/2T', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32'][num(ls, 'GlobalQuantisation') ?? 4] || '1 Bar',
    loop: { on: bool(ls, 'Transport', 'LoopOn'), start: num(ls, 'Transport', 'LoopStart') || 0, length: num(ls, 'Transport', 'LoopLength') || 16 },
    locators: kids(ls, 'Locators', 'Locators').map(l => ({ time: num(l, 'Time') || 0, name: val(l, 'Name') || '' })).sort((a, b) => a.time - b.time),
    tracks: [], returns: [], main: null,
  };

  let n = 0, r = 0;
  for (const el of kids(ls, 'Tracks')) {
    const t = parseTrack(el, root);
    if (t.type === 'return') { t.label = String.fromCharCode(65 + r++); set.returns.push(t); }
    else { t.label = String(++n); set.tracks.push(t); }
  }
  set.main = parseTrack(main, root);
  set.main.type = 'main'; set.main.label = '';
  if (!val(main, 'Name', 'EffectiveName')) set.main.name = 'Main';

  // groups
  const byId = new Map(set.tracks.map(t => [t.id, t]));
  for (const t of set.tracks) {
    t.parent = t.groupId >= 0 ? byId.get(String(t.groupId)) || null : null;
    if (t.parent) t.parent.children.push(t);
  }
  for (const t of set.tracks) { let d = 0, p = t.parent; while (p) { d++; p = p.parent; } t.depth = d; }

  // song length
  let end = 0;
  for (const t of [...set.tracks, ...set.returns]) for (const c of [...t.clips, ...t.freezeClips]) end = Math.max(end, c.end);
  for (const l of set.locators) end = Math.max(end, l.time);
  set.end = Math.max(end, set.loop.start + set.loop.length, 16);
  return set;
}

function parseTrack(el, root) {
  const type = { MidiTrack: 'midi', AudioTrack: 'audio', GroupTrack: 'group', ReturnTrack: 'return' }[el.tagName] || 'main';
  const chain = kid(el, 'DeviceChain');
  const mixer = kid(chain, 'Mixer');
  const laneHeight = num(chain, 'AutomationLanes', 'AutomationLanes', 'AutomationLane', 'LaneHeight')
    ?? num(kids(chain, 'AutomationLanes', 'AutomationLanes')[0], 'LaneHeight') ?? 68;
  const unfoldedRaw = val(el, 'TrackUnfolded');
  const t = {
    el, id: el.getAttribute('Id'), type,
    name: val(el, 'Name', 'EffectiveName') || val(el, 'Name', 'UserName') || '',
    colorIndex: num(el, 'Color') ?? num(el, 'ColorIndex') ?? -1,
    groupId: num(el, 'TrackGroupId') ?? -1,
    unfolded: unfoldedRaw == null ? true : unfoldedRaw === 'true',
    laneHeight: Math.max(MIN_H, laneHeight),
    frozen: bool(el, 'Freeze'),
    mixer: {
      volume: num(mixer, 'Volume', 'Manual') ?? 1,
      pan: num(mixer, 'Pan', 'Manual') ?? 0,
      on: val(mixer, 'Speaker', 'Manual') !== 'false',
      solo: bool(mixer, 'SoloSink'),
      sends: kids(mixer, 'Sends').map(h => num(h, 'Send', 'Manual') ?? 0),
    },
    clips: [], freezeClips: [], devices: [], children: [],
  };
  t.color = color(t.colorIndex);
  t.devices = parseDevices(at(chain, 'DeviceChain', 'Devices'), root);
  const evs = seq => {
    if (!seq) return [];
    const holder = kid(seq, 'ClipTimeable') || kid(seq, 'Sample');
    return kids(holder, 'ArrangerAutomation', 'Events');
  };
  t.clips = evs(kid(chain, 'MainSequencer')).map(c => parseClip(c, root)).filter(Boolean).sort((a, b) => a.start - b.start);
  t.freezeClips = evs(kid(chain, 'FreezeSequencer')).map(c => parseClip(c, root)).filter(c => c && c.kind === 'audio').sort((a, b) => a.start - b.start);
  return t;
}

function parseClip(el, root) {
  const kind = el.tagName === 'AudioClip' ? 'audio' : el.tagName === 'MidiClip' ? 'midi' : null;
  if (!kind) return null;
  const loop = kid(el, 'Loop');
  const start = num(el, 'CurrentStart') ?? Number(el.getAttribute('Time'));
  const end = num(el, 'CurrentEnd') ?? start + 4;
  const c = {
    kind, start, end,
    name: val(el, 'Name') || '',
    colorIndex: num(el, 'Color') ?? num(el, 'ColorIndex') ?? -1,
    disabled: bool(el, 'Disabled'),
    loop: {
      on: bool(loop, 'LoopOn'),
      start: num(loop, 'LoopStart') ?? 0,
      end: num(loop, 'LoopEnd') ?? (end - start),
      startRel: num(loop, 'StartRelative') ?? 0,
    },
  };
  c.color = color(c.colorIndex);
  if (kind === 'midi') {
    c.notes = [];
    for (const kt of kids(el, 'Notes', 'KeyTracks')) {
      const key = num(kt, 'MidiKey') ?? 60;
      for (const n of kids(kt, 'Notes')) {
        if (n.tagName !== 'MidiNoteEvent') continue;
        c.notes.push({ key, t: Number(n.getAttribute('Time')), d: Number(n.getAttribute('Duration')), v: Number(n.getAttribute('Velocity')), on: n.getAttribute('IsEnabled') !== 'false' });
      }
    }
    c.notes.sort((a, b) => a.t - b.t);
    if (c.notes.length) { c.lo = Math.min(...c.notes.map(n => n.key)); c.hi = Math.max(...c.notes.map(n => n.key)); }
  } else {
    c.file = resolveRef(at(el, 'SampleRef', 'FileRef'), root);
    c.warped = val(el, 'IsWarped') !== 'false';
    c.gain = num(el, 'SampleVolume') ?? 1;
    c.markers = kids(el, 'WarpMarkers').map(m => ({ sec: Number(m.getAttribute('SecTime')), beat: Number(m.getAttribute('BeatTime')) })).sort((a, b) => a.beat - b.beat);
  }
  return c;
}

function parseDevices(devicesEl, root) {
  return devicesEl ? [...devicesEl.children].map(d => parseDevice(d, root)) : [];
}

function parseDevice(el, root) {
  const tag = el.tagName;
  const dev = {
    tag,
    on: val(el, 'On', 'Manual') !== 'false',
    name: val(el, 'UserName') || '',
    kind: DEVICE_KINDS[tag] || '',
    params: [], chains: [], macros: [],
  };
  if (tag === 'PluginDevice') {
    const info = at(el, 'PluginDesc')?.firstElementChild;
    const fmt = { Vst3PluginInfo: 'VST3', VstPluginInfo: 'VST', AuPluginInfo: 'AU' }[info?.tagName] || 'Plug-in';
    dev.kind = fmt;
    dev.name = dev.name || val(info, 'Name') || val(info, 'PlugName') || 'Plug-in';
    for (const p of kids(el, 'ParameterList')) {
      const pn = val(p, 'ParameterName');
      if (pn) dev.params.push([pn, fmtVal(val(p, 'ParameterValue', 'Manual') ?? '')]);
    }
    return dev;
  }
  if (tag.startsWith('MxDevice')) {
    let file = '';
    for (const fr of el.querySelectorAll('FileRef')) { const p = val(fr, 'RelativePath') || val(fr, 'Path') || val(fr, 'Name') || ''; if (/\.amxd$/i.test(p)) { file = p; break; } }
    dev.name = dev.name || basename(file).replace(/\.amxd$/i, '') || DEVICE_KINDS[tag];
  }
  if (!dev.name) dev.name = DEVICE_NAMES[tag] || prettify(tag);
  if (!dev.kind && dev.name !== (DEVICE_NAMES[tag] || prettify(tag))) dev.kind = DEVICE_NAMES[tag] || prettify(tag);

  if (RACKS.has(tag)) {
    const visible = num(el, 'NumVisibleMacroControls') ?? 8;
    for (let i = 0; i < visible; i++) {
      const mv = num(el, `MacroControls.${i}`, 'Manual');
      if (mv == null) continue;
      dev.macros.push([val(el, `MacroDisplayNames.${i}`) || `Macro ${i + 1}`, mv]);
    }
    for (const b of kids(el, 'Branches')) {
      const chainEl = [...(kid(b, 'DeviceChain')?.children || [])].find(c => c.tagName.endsWith('DeviceChain'));
      const note = num(b, 'BranchInfo', 'ReceivingNote');
      dev.chains.push({
        name: val(b, 'Name', 'EffectiveName') || val(b, 'Name', 'UserName') || val(b, 'Name') || 'Chain',
        color: color(num(b, 'Color') ?? -1),
        note,
        on: val(b, 'MixerDevice', 'Speaker', 'Manual') !== 'false',
        devices: parseDevices(kid(chainEl, 'Devices'), root),
      });
    }
    return dev;
  }
  dev.params = readParams(el, '', 0);
  return dev;
}

function readParams(el, prefix, depth) {
  const out = [];
  for (const c of el.children) {
    if (SKIP_PARAMS.has(c.tagName) || /^Macro/.test(c.tagName)) continue;
    const manual = kid(c, 'Manual');
    if (manual && (kid(c, 'AutomationTarget') || kid(c, 'ModulationTarget') || depth === 0)) {
      out.push([prettify(prefix + c.tagName), fmtVal(manual.getAttribute('Value'))]);
    } else if (c.children.length && depth < 3 && !manual) {
      out.push(...readParams(c, prefix + c.tagName + ' ', depth + 1));
    }
    if (out.length > 160) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tempo map (beats ↔ seconds), with Live's linear tempo ramps

class TempoMap {
  constructor(tempo, events, endBeat) {
    this.tempo = tempo;
    this.events = events.length ? events : null;
    if (!this.events) return;
    this.step = 1 / 16;
    const n = Math.ceil((endBeat + 64) / this.step) + 2;
    this.table = new Float64Array(n);
    let s = 0;
    for (let i = 1; i < n; i++) {
      const b = (i - 0.5) * this.step;
      s += this.step * 60 / this.tempoAt(b);
      this.table[i] = s;
    }
  }
  tempoAt(b) {
    if (!this.events) return this.tempo;
    const ev = this.events;
    if (b <= ev[0].t) return ev[0].v;
    for (let i = 1; i < ev.length; i++) {
      if (b <= ev[i].t) {
        const a = ev[i - 1], z = ev[i];
        if (z.t === a.t) return z.v;
        return a.v + (z.v - a.v) * (b - a.t) / (z.t - a.t);
      }
    }
    return ev[ev.length - 1].v;
  }
  sec(b) {
    if (!this.events) return b * 60 / this.tempo;
    if (b <= 0) return b * 60 / this.tempoAt(0);
    const i = b / this.step, k = Math.floor(i);
    if (k + 1 >= this.table.length) return this.table[this.table.length - 1] + (b - (this.table.length - 1) * this.step) * 60 / this.tempoAt(b);
    return this.table[k] + (this.table[k + 1] - this.table[k]) * (i - k);
  }
  beat(s) {
    if (!this.events) return s * this.tempo / 60;
    let lo = -64, hi = (this.table.length - 1) * this.step;
    for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (this.sec(m) < s) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
}

// ---------------------------------------------------------------------------
// Audio files: PCM WAV/AIFF are read straight from the file bytes; anything else is decoded

const sources = new Map();   // zip path → source

function parsePCM(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if ((id(0) === 'RIFF' || id(0) === 'RF64') && id(8) === 'WAVE') {
    let o = 12, fmt = null, data = null;
    while (o + 8 <= bytes.length) {
      const cid = id(o); let size = dv.getUint32(o + 4, true);
      if (cid === 'fmt ') {
        let format = dv.getUint16(o + 8, true);
        const ch = dv.getUint16(o + 10, true), sr = dv.getUint32(o + 12, true), bits = dv.getUint16(o + 22, true);
        if (format === 0xFFFE && size >= 40) format = dv.getUint16(o + 32, true);
        fmt = { format, ch, sr, bits };
      } else if (cid === 'data') {
        if (size === 0xFFFFFFFF || o + 8 + size > bytes.length) size = bytes.length - o - 8;
        data = { off: o + 8, size };
        break;
      }
      o += 8 + size + (size & 1);
    }
    if (!fmt || !data || !(fmt.format === 1 || fmt.format === 3)) return null;
    return pcmSource(dv, data.off, data.size, fmt.ch, fmt.sr, fmt.bits, fmt.format === 3, true);
  }
  if (id(0) === 'FORM' && (id(8) === 'AIFF' || id(8) === 'AIFC')) {
    let o = 12, comm = null, ssnd = null;
    while (o + 8 <= bytes.length) {
      const cid = id(o), size = dv.getUint32(o + 4, false);
      if (cid === 'COMM') {
        const ch = dv.getInt16(o + 8, false), frames = dv.getUint32(o + 10, false), bits = dv.getInt16(o + 14, false);
        const exp = dv.getUint16(o + 16, false) & 0x7fff, mant = dv.getUint32(o + 18, false);
        const sr = Math.round(mant * Math.pow(2, exp - 16383 - 31));
        let comp = 'NONE';
        if (id(8) === 'AIFC' && size >= 22) comp = id(o + 26);
        comm = { ch, frames, bits, sr, comp };
      } else if (cid === 'SSND') {
        const off = dv.getUint32(o + 8, false);
        ssnd = { off: o + 16 + off, size: size - 8 - off };
      }
      o += 8 + size + (size & 1);
    }
    if (!comm || !ssnd) return null;
    const c = comm.comp.toLowerCase();
    if (c === 'none' || c === 'twos') return pcmSource(dv, ssnd.off, ssnd.size, comm.ch, comm.sr, comm.bits, false, false);
    if (c === 'sowt') return pcmSource(dv, ssnd.off, ssnd.size, comm.ch, comm.sr, comm.bits, false, true);
    if (c === 'fl32') return pcmSource(dv, ssnd.off, ssnd.size, comm.ch, comm.sr, 32, true, false);
    if (c === 'fl64') return pcmSource(dv, ssnd.off, ssnd.size, comm.ch, comm.sr, 64, true, false);
    return null;
  }
  return null;
}

function pcmSource(dv, off, size, ch, sr, bits, float, le) {
  const bps = bits / 8, frameBytes = bps * ch;
  const frames = Math.floor(Math.min(size, dv.byteLength - off) / frameBytes);
  let read;
  if (float && bits === 32) read = p => dv.getFloat32(p, le);
  else if (float && bits === 64) read = p => dv.getFloat64(p, le);
  else if (bits === 8) read = le ? (p => (dv.getUint8(p) - 128) / 128) : (p => dv.getInt8(p) / 128);
  else if (bits === 16) read = p => dv.getInt16(p, le) / 32768;
  else if (bits === 24) read = le
    ? (p => { const v = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16); return v / 8388608; })
    : (p => { const v = (dv.getInt8(p) << 16) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p + 2); return v / 8388608; });
  else if (bits === 32) read = p => dv.getInt32(p, le) / 2147483648;
  else return null;
  return {
    kind: 'pcm', sr, ch, frames,
    read(start, count) {
      start = Math.max(0, Math.floor(start)); count = Math.max(0, Math.min(Math.floor(count), frames - start));
      const out = [];
      for (let c = 0; c < ch; c++) out.push(new Float32Array(count));
      let p = off + start * frameBytes;
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < ch; c++) { out[c][i] = read(p); p += bps; }
      }
      return out;
    },
  };
}

let decodeCtx = null;
async function getSource(path) {
  if (!path) return null;
  if (sources.has(path)) return sources.get(path);
  const bytes = files.get(path);
  if (!bytes) return null;
  let src = null;
  try { src = parsePCM(bytes); } catch (e) { src = null; }
  if (!src) {
    try {
      decodeCtx ||= new OfflineAudioContext(1, 1, 44100);
      const copy = bytes.slice().buffer;
      const buf = await decodeCtx.decodeAudioData(copy);
      src = {
        kind: 'decoded', sr: buf.sampleRate, ch: buf.numberOfChannels, frames: buf.length,
        read(start, count) {
          start = Math.max(0, Math.floor(start)); count = Math.max(0, Math.min(Math.floor(count), buf.length - start));
          const out = [];
          for (let c = 0; c < buf.numberOfChannels; c++) out.push(buf.getChannelData(c).slice(start, start + count));
          return out;
        },
      };
    } catch (e) { src = null; }
  }
  sources.set(path, src);
  return src;
}

// Waveform overview: min/max per block of frames, per channel
const PEAK_BLOCK = 256;
const peaks = new Map(); // path → { blocks, ch, min: Int8Array[], max: Int8Array[] }
async function computePeaks(path) {
  if (peaks.has(path)) return peaks.get(path);
  const src = await getSource(path);
  if (!src) { peaks.set(path, null); return null; }
  const blocks = Math.ceil(src.frames / PEAK_BLOCK), ch = Math.min(src.ch, 2);
  const pk = { blocks, ch, sr: src.sr, min: [], max: [], done: 0 };
  for (let c = 0; c < ch; c++) { pk.min.push(new Int8Array(blocks)); pk.max.push(new Int8Array(blocks)); }
  peaks.set(path, pk);
  const per = 2048; // blocks per slice, then yield to keep the page responsive
  for (let b0 = 0; b0 < blocks; b0 += per) {
    const nb = Math.min(per, blocks - b0);
    const data = src.read(b0 * PEAK_BLOCK, nb * PEAK_BLOCK);
    for (let c = 0; c < ch; c++) {
      const d = data[c], mn = pk.min[c], mx = pk.max[c];
      for (let b = 0; b < nb; b++) {
        let lo = 1, hi = -1;
        const e = Math.min(d.length, (b + 1) * PEAK_BLOCK);
        for (let i = b * PEAK_BLOCK; i < e; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (lo > hi) lo = hi = 0;
        mn[b0 + b] = Math.round(clamp(lo, -1, 1) * 127);
        mx[b0 + b] = Math.round(clamp(hi, -1, 1) * 127);
      }
    }
    pk.done = b0 + nb;
    await new Promise(r => setTimeout(r, 0));
  }
  return pk;
}

// ---------------------------------------------------------------------------
// Clip timing: arrangement beat → position inside the clip's content → seconds in the sample

function contentAt(c, d) {
  // d = beats since clip start (or seconds, for unwarped audio)
  const L = c.loop.end - c.loop.start;
  if (c.loop.on && L > 0) {
    const s = c.loop.startRel + d;
    return c.loop.start + (((s % L) + L) % L);
  }
  return c.loop.start + d;
}
// next point after d where the loop wraps (Infinity if none)
function nextWrap(c, d) {
  const L = c.loop.end - c.loop.start;
  if (!c.loop.on || L <= 0) return Infinity;
  const s = c.loop.startRel + d;
  return d + (L - (((s % L) + L) % L));
}
function warpSec(c, beat) {
  const m = c.markers;
  if (!m || m.length === 0) return beat * 60 / (set?.tempo || 120);
  if (m.length === 1) return m[0].sec + (beat - m[0].beat) * 60 / (set?.tempo || 120);
  let i = 1;
  while (i < m.length - 1 && beat > m[i].beat) i++;
  const a = m[i - 1], b = m[i];
  return a.sec + (beat - a.beat) * (b.sec - a.sec) / (b.beat - a.beat || 1);
}
function warpBreaks(c, cb0, cb1) {
  const out = [];
  if (c.markers) for (const m of c.markers) if (m.beat > cb0 && m.beat < cb1) out.push(m.beat);
  return out;
}

// ---------------------------------------------------------------------------
// Theme colours (Live's own theme file, see themes.js) and the colours Live derives from them

const T = window.THEME;
const hexRGB = h => { const n = parseInt(h.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255, h.length > 7 ? parseInt(h.slice(7, 9), 16) / 255 : 1]; };
const rgbHex = c => '#' + c.slice(0, 3).map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
// colour `top` (with its alpha) laid over opaque `base`
const over = (base, top, round = Math.round) => { const b = hexRGB(base), t = hexRGB(top); return '#' + b.slice(0, 3).map((v, i) => round(clamp(v + (t[i] - v) * t[3], 0, 255)).toString(16).padStart(2, '0')).join(''); };
const C = {};
function themeColours() {
  C.surface = T.SurfaceBackground; C.highlight = T.SurfaceHighlight; C.area = T.SurfaceArea;
  C.tile = over(T.SurfaceBackground, T.ArrangerGridTiles);          // the darker of the alternating lane tiles
  C.tileSel = over(T.SurfaceHighlight, T.ArrangerGridTiles);
  C.ruler = T.ArrangementRulerMarkings; C.loop = T.LoopColor; C.insert = T.RangeDefault;
}
themeColours();
// grid line colour over a given lane colour
// Measured: Live draws the grid line on the plain lane colour (rounding down), then lays the tile shade over both.
const gridLine = (sel, tiled) => { const l = over(sel ? T.SurfaceHighlight : T.SurfaceBackground, T.GridLineBase, Math.floor); return tiled ? over(l, T.ArrangerGridTiles) : l; };
// a track's dark contrast colour on its own colour (fold button, name): the track colour at 26.7%
const darkOf = hex => rgbHex(hexRGB(hex).slice(0, 3).map(v => v * 0.267));

// ---------------------------------------------------------------------------
// Icons traced from the reference screenshot (icons.js)

function makeIcon(name) {
  const d = ICONS[name];
  if (!d) return null;
  if (d[0] === 'rgb') {
    const [, dx, dy, w, h, s] = d;
    const c = document.createElement('canvas');
    c.width = w; c.height = h; c.className = 'ic';
    Object.assign(c.style, { left: dx + 'px', top: dy + 'px', width: w + 'px', height: h + 'px' });
    const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      img.data[i * 4] = parseInt(s.substr(i * 6, 2), 16); img.data[i * 4 + 1] = parseInt(s.substr(i * 6 + 2, 2), 16);
      img.data[i * 4 + 2] = parseInt(s.substr(i * 6 + 4, 2), 16); img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const [dx, dy, w, h, s] = d;
  const paths = new Map();
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const a = parseInt(s.substr((y * w + x) * 2, 2), 16);
      let e = x + 1;
      while (e < w && parseInt(s.substr((y * w + e) * 2, 2), 16) === a) e++;
      if (a) paths.set(a, (paths.get(a) || '') + `M${x} ${y}h${e - x}v1h${x - e}z`);
      x = e;
    }
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic'); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.left = dx + 'px'; svg.style.top = dy + 'px';
  let html = '';
  for (const [a, p] of paths) html += `<path fill="currentColor" fill-opacity="${(a / 255).toFixed(3)}" d="${p}"/>`;
  svg.innerHTML = html;
  return svg;
}
function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-ic]')) {
    if (el._ic) continue;
    el._ic = true;
    if (el.tagName === 'I') Object.assign(el.style, { position: 'absolute', top: el.style.top || '0', width: '0', height: '0', overflow: 'visible' });
    else if (!el.style.position && getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const ic = makeIcon(el.dataset.ic);
    if (ic) el.append(ic);
  }
}

// ---------------------------------------------------------------------------
// Static parts: browser, info view

const SIDEBAR = [
  [0, 'cat', 'Collections'], [1, '', 'Favorites', 'sb_favorites'],
  [3, 'cat', 'Library'], [4, 'sel', 'All', 'sb_all'], [5, '', 'Sounds', 'sb_sounds'], [6, '', 'Drums', 'sb_drums'], [7, '', 'Instruments', 'sb_instruments'],
  [8, '', 'Audio Effects', 'sb_audioEffects'], [9, '', 'MIDI Effects', 'sb_midiEffects'], [10, '', 'Modulators', 'sb_modulators'], [11, '', 'Max for Live', 'sb_maxForLive'],
  [12, '', 'Plug-Ins', 'sb_plugins'], [13, '', 'Clips', 'sb_clips'], [14, '', 'Samples', 'sb_samples'], [15, '', 'Grooves', 'sb_grooves'], [16, '', 'Tunings', 'sb_tunings'], [17, '', 'Templates', 'sb_templates'],
  [19, 'cat', 'Places'], [20, '', 'Packs', 'sb_packs'], [21, 'dis', 'Cloud', 'sb_cloud'], [22, 'dis', 'Push', 'sb_push'], [23, '', 'User Library', 'sb_userLibrary'],
  [24, '', 'Current Project', 'sb_currentProject'], [25, '', 'Add Folder…', 'sb_addFolder'],
];
const FILTERS = ['Content', 'Type', 'Sounds', 'Drums', 'Character', 'Devices', 'Function', 'Format', 'Clips', 'Genres', 'Key', 'Grooves', 'Tunings', 'Creator'];
const INFO = {
  'Track Title Bar': 'Click to select this track; choose ‘Rename’\nfrom the Edit menu to rename the track;\nchoose ‘Delete’ to delete the track. Drag this\ntrack above or below another to reorder\nthem.\n\n[Arrow Left/Right] Fold track display in/out',
};
function buildStatic() {
  const sb = $('#sidebar');
  for (const [k, cls, label, ic] of SIDEBAR) {
    const r = document.createElement('div');
    r.className = 'sbrow ' + cls; r.style.top = (1 + 19 * k) + 'px';
    r.innerHTML = `<span class="l"></span>`;
    r.firstChild.textContent = label;
    if (ic) { const s = document.createElement('i'); s.dataset.ic = ic; s.style.left = '4px'; s.style.top = '0'; if (ic === 'sb_favorites') s.style.color = '#ff0505'; r.append(s); }
    sb.append(r);
  }
  const f = $('#filters');
  const head = document.createElement('div');
  head.className = 'frow'; head.style.top = '0';
  head.innerHTML = '<i data-ic="br_filters" style="left:2px;top:1px"></i><span class="l" style="left:19px">Filters</span><span id="br-edit"><i data-ic="br_editIcon" style="left:2px;top:0"></i><span class="abs" style="left:15px">Edit</span></span>';
  f.append(head);
  const sep0 = document.createElement('div'); sep0.className = 'frow line'; sep0.style.top = '19px'; sep0.style.background = 'var(--SurfaceArea)'; f.append(sep0);
  FILTERS.forEach((n, i) => {
    const r = document.createElement('div'); r.className = 'frow'; r.style.top = (20 + 20 * i) + 'px';
    r.innerHTML = '<span class="l"></span>';
    r.firstChild.textContent = n;
    f.append(r);
    const a = document.createElement('i'); a.dataset.ic = 'br_arrow'; a.style.top = '3px'; r.append(a);
    r._arrow = a;
    const ln = document.createElement('div'); ln.className = 'frow line'; ln.style.top = (39 + 20 * i) + 'px'; f.append(ln);
  });
  const ln2 = document.createElement('div'); ln2.className = 'frow line'; ln2.style.cssText = 'top:300px;height:2px;background:var(--SurfaceArea)'; f.append(ln2);
  applyIcons();
  // the arrow sits 3 px after each filter label
  document.fonts.ready.then(() => { for (const r of f.querySelectorAll('.frow')) if (r._arrow) r._arrow.style.left = (7 + Math.round(r.firstChild.getBoundingClientRect().width)) + 'px'; });
  showInfo('Track Title Bar');
}
function showInfo(title) {
  $('#info-title').textContent = title;
  $('#info-body').textContent = INFO[title] || '';
}

// ---------------------------------------------------------------------------
// State

let set = null, tempoMap = null;
let rows = [];        // visible rows in the scrolling area: { track, y, h }
let pinnedRows = [];  // returns and main
let selected = null;
// Live's zoom for a new Set: one bar = 15.6896 px (fitted to all 84 grid lines of the reference screenshot:
// 1314 px of lanes show 335 beats)
const DEFAULT_PPB = 1314 / 335;
const view = { beat0: 0, ppb: DEFAULT_PPB, insert: 0 };
const HW = 292;  // track header width incl. its 2 px divider
const FONT = '10px "Ableton Sans Small"';

// ---------------------------------------------------------------------------
// Layout of track rows

function isVisible(t) { let p = t.parent; while (p) { if (!p.unfolded) return false; p = p.parent; } return true; }
function laneH(t) { return (t.unfolded ? Math.max(MIN_H, t.laneHeight) : FOLDED_H) + SEP; }  // row = content + 2 px divider

function buildRows() {
  const rowsEl = $('#rows'), pinEl = $('#pinned-rows');
  rowsEl.innerHTML = ''; pinEl.innerHTML = '';
  rows = []; pinnedRows = [];
  let y = 0;
  for (const t of set.tracks) {
    if (!isVisible(t)) continue;
    const h = laneH(t);
    rows.push({ track: t, y, h });
    rowsEl.append(makeRow(t, y, h, false));
    y += h;
  }
  rowsEl.style.height = y + 'px';
  let py = 3;
  for (const t of [...set.returns, set.main]) {
    const h = FOLDED_H + SEP;
    pinnedRows.push({ track: t, y: py, h });
    pinEl.append(makeRow(t, py, h, true));
    py += h;
  }
  pinEl.style.height = py + 'px';
  const top = document.createElement('div'); top.className = 'trow'; top.style.cssText = 'top:0;height:3px;background:var(--SurfaceArea)'; pinEl.prepend(top);
  $('#pinned').style.height = Math.min(py, 200) + 'px';
  applyIcons($('#tracks-wrap'));
  layoutCanvases();
  drawAll();
}

function dbText(v, inf = '-inf') {
  if (v <= 0.000317) return inf;
  const db = 20 * Math.log10(v);
  if (Math.abs(db) < 0.05) return '0';
  return db.toFixed(1);
}
function panText(p) {
  const v = Math.round(p * 50);
  return v === 0 ? 'C' : v < 0 ? `${-v}L` : `${v}R`;
}
// Volume field fill. Measured in Live 12: 0 dB fills 37 of 44 px, -6 dB fills 31 of 44 px.
function volFill(v) {
  if (v <= 0.000317) return 0;
  const db = 20 * Math.log10(v);
  return db >= -18 ? clamp(0.841 + 0.0227 * db, 0, 1) : 0.432 * Math.exp((db + 18) / 12);
}

// a 13 px header control; x/w relative to the header, row = control row (17 px pitch)
function hctl(hd, cls, x, y, w, text) {
  const d = document.createElement('div');
  d.className = 'btn ' + cls;
  Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w + 'px' });
  if (text != null) { const s = document.createElement('span'); s.className = 'abs'; s.textContent = text; s.style.left = '0'; s.style.right = '0'; d.append(s); }
  hd.append(d);
  return d;
}
function dropdown(hd, x, y, w, text, textX, icon) {
  const d = hctl(hd, 'field', x, y, w, null);
  d.style.textAlign = 'left';
  const s = document.createElement('span'); s.className = 'abs'; s.textContent = text;
  Object.assign(s.style, { left: textX + 'px', width: (57 - textX) + 'px', overflow: 'hidden', whiteSpace: 'nowrap' });
  d.append(s);
  if (icon) { const i = document.createElement('i'); i.dataset.ic = icon; i.style.left = '0'; d.append(i); }
  const tri = document.createElement('i'); tri.dataset.ic = 'hd_ddTri'; tri.style.left = '56px'; d.append(tri);
  return d;
}
function fieldFill(d, frac, colour, text) {
  d.innerHTML = '';
  const f = document.createElement('i');
  Object.assign(f.style, { position: 'absolute', left: '1px', top: '1px', bottom: '1px', width: Math.round(frac * (parseFloat(d.style.width) - 2)) + 'px', background: colour });
  const s = document.createElement('span'); s.className = 'abs'; s.style.left = '0'; s.style.right = '0'; s.textContent = text;
  d.append(f, s);
}

function makeRow(t, y, h, pinned) {
  const row = document.createElement('div');
  row.className = 'trow'; row.style.top = y + 'px'; row.style.height = h + 'px';
  const ch = h - SEP;   // content height
  const hd = document.createElement('div');
  hd.className = 'theader' + (t === selected ? ' sel' : '');
  hd.style.height = h + 'px';
  const isMain = t.type === 'main', isRet = t.type === 'return';
  const nameBg = t.color;
  const dark = darkOf(nameBg);
  hd.innerHTML = `<div class="bg" style="height:${ch}px"></div>
    <div class="name" style="height:${ch}px;background:${nameBg};color:${dark}" data-info="Track Title Bar"><i data-ic="${pinned ? 'hd_foldRet' : 'hd_fold'}"></i><span></span></div>`;
  $('.name span', hd).textContent = (isRet ? t.label + ' ' : '') + t.name;
  if (isMain) $('.name span', hd).style.left = '26px';
  const vsep = (x, w) => { const s = document.createElement('div'); s.className = 'vsep'; Object.assign(s.style, { left: x + 'px', width: w + 'px', height: ch + 'px' }); hd.append(s); };
  const R = k => 2 + 17 * k;    // control row top
  if (isMain) {
    vsep(95, 5); vsep(174, 2);
    dropdown(hd, 102, R(0), 70, '1/2', 11, 'hd_mainMeterIcon');
    const vol = hctl(hd, 'field', 178, R(0), 46, ''); vol.title = 'Main Volume';
    fieldFill(vol, volFill(t.mixer.volume), 'var(--RangeEditField)', dbText(t.mixer.volume));
    const cue = hctl(hd, 'field', 228, R(0), 46, ''); cue.title = 'Cue Volume';
    fieldFill(cue, volFill(0.5012), 'var(--ChosenPreListen)', '-6.0');
    meter(hd, t, 278, 2, ch - 4, false);
  } else {
    vsep(95, 2); vsep(171, 2);
    const act = hctl(hd, 'on', 175, R(0), 46, t.label);
    act.title = 'Track Activator';
    act.classList.toggle('on', t.mixer.on);
    act.addEventListener('mousedown', e => { e.stopPropagation(); t.mixer.on = !t.mixer.on; act.classList.toggle('on', t.mixer.on); engine.updateMix(); });
    const solo = hctl(hd, 'solo' + (t.mixer.solo ? ' on' : ''), 225, R(0), isRet ? 17 : 21, 'S');
    solo.title = 'Solo';
    solo.addEventListener('mousedown', e => {
      e.stopPropagation();
      const was = t.mixer.solo;
      if (!(e.ctrlKey || e.metaKey)) for (const o of allTracks()) o.mixer.solo = false;
      t.mixer.solo = !was;
      document.querySelectorAll('.theader').forEach(x => x._t && x.querySelector('.solo')?.classList.toggle('on', x._t.mixer.solo));
      engine.updateMix();
    });
    if (isRet) {
      hctl(hd, 'flat', 99, R(0), 70, null);
      hctl(hd, 'on', 246, R(0), 25, 'Post').title = 'Pre/Post';
      meter(hd, t, 275, 2, ch - 4, false);
    } else {
      const audio = t.type === 'audio' || t.type === 'group';
      if (t.type === 'midi' || t.type === 'audio') { const a = hctl(hd, '', 250, R(0), 21, null); a.title = 'Arm Recording'; a.dataset.ic = t.type === 'midi' ? 'hd_armMidi' : 'hd_armAudio'; }
      const rowsFit = Math.floor((ch - 2 + 4) / 17);
      // In/Out section
      if (rowsFit >= 1) dropdown(hd, 99, R(0), 70, t.type === 'midi' ? 'All Ins' : t.type === 'group' ? '' : 'Ext. In', 2);
      if (rowsFit >= 2 && t.type !== 'group') dropdown(hd, 99, R(1), 70, t.type === 'midi' ? 'All Channels' : String(1 + (Number(t.label) + 1) % 2), 11, t.type === 'midi' ? 'hd_chanMeter' : 'hd_inMeterEmpty');
      if (rowsFit >= 3) {
        const mon = t.type === 'midi' ? 1 : 2;
        hctl(hd, mon === 0 ? 'on' : '', 99, R(2), 17, 'In');
        hctl(hd, mon === 1 ? 'on' : '', 119, R(2), 27, 'Auto');
        hctl(hd, mon === 2 ? 'on' : '', 149, R(2), 20, 'Off');
      }
      if (rowsFit >= 4) dropdown(hd, 99, R(3), 70, t.type === 'midi' && !t.devices.length ? 'No Output' : 'Main', 2);
      if (rowsFit >= 5) hctl(hd, 'flat', 99, R(4), 70, null).style.background = 'transparent';
      // mixer
      if (audio && rowsFit >= 2) {
        const vol = hctl(hd, 'field', 175, R(1), 46, ''); vol.title = 'Track Volume';
        fieldFill(vol, volFill(t.mixer.volume), 'var(--RangeEditField)', dbText(t.mixer.volume));
        hctl(hd, 'field', 225, R(1), 46, panText(t.mixer.pan)).title = 'Track Panning';
      }
      if (audio && rowsFit >= 3) t.mixer.sends.slice(0, 2).forEach((v, i) => hctl(hd, 'field', 175 + 33 * i, R(2), 30, dbText(v, '-∞')).title = 'Send');
      if (audio || t.type === 'group') meter(hd, t, 275, 2, ch - 2, true);
      else midiMeter(hd, ch);
    }
  }
  hd._t = t;
  hd.addEventListener('mousedown', e => {
    if (e.target.closest('.name') && e.offsetX < 20 && !pinned) { t.unfolded = !t.unfolded; buildRows(); return; }
    select(t);
  });
  hd.addEventListener('mouseover', e => { const i = e.target.closest('[data-info]'); if (i) showInfo(i.dataset.info); });
  row.append(hd);
  return row;
}
// audio meter: two 3 px bars; the top tenth is the separate peak section
function meter(hd, t, x, y, h, gapRow) {
  const m = document.createElement('div'); m.className = 'meter';
  Object.assign(m.style, { left: x + 'px', top: y + 'px', width: '7px', height: h + 'px' });
  const top = Math.max(1, Math.round(h * 0.1));
  for (const cx of [0, 4]) {
    for (const [yy, hh] of [[0, top], [top + 1, h - top - 1]]) {
      const b = document.createElement('i'); Object.assign(b.style, { left: cx + 'px', top: yy + 'px', height: hh + 'px' }); m.append(b);
    }
    const lv = document.createElement('b');
    Object.assign(lv.style, { position: 'absolute', left: cx + 'px', width: '3px', bottom: '0', height: '0', background: 'linear-gradient(to top, var(--StandardVuMeter-Minimum, #00f758) 70%, #ffd100 88%, #ff0a0a)' });
    m.append(lv);
  }
  t._meter = m;
  hd.append(m);
}
function midiMeter(hd, ch) {
  const n = Math.floor((ch - 5) / 8);
  for (let k = 0; k < n; k++) { const i = document.createElement('i'); i.dataset.ic = 'hd_midiDot'; Object.assign(i.style, { left: '274px', top: (5 + 8 * k) + 'px', color: 'var(--MeterBackground)' }); hd.append(i); }
}

function allTracks() { return [...set.tracks, ...set.returns, set.main]; }

function select(t) {
  selected = t;
  document.querySelectorAll('.theader').forEach(x => x.classList.toggle('sel', x._t === t));
  $('#status-track').textContent = t ? (t.type === 'return' || t.type === 'main' ? t.name : t.name.replace(/ /g, '-')) : '';
  renderDevices(t);
  drawAll();
}

// ---------------------------------------------------------------------------
// Drawing

const lanesCanvas = $('#lanes-canvas'), pinCanvas = $('#pinned-canvas'), rulerCanvas = $('#ruler-canvas'), songCanvas = $('#song-canvas'), ovCanvas = $('#overview');
const DPR = () => window.devicePixelRatio || 1;
function sizeCanvas(cv, w, h) {
  const d = DPR();
  cv.width = Math.max(1, Math.round(w * d)); cv.height = Math.max(1, Math.round(h * d));
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); return ctx;
}
function lanesWidth() { return Math.max(1, $('#arrangement').clientWidth - HW); }
function layoutCanvases() {
  const w = lanesWidth();
  for (const [cv, sc] of [[lanesCanvas, $('#tracks')], [pinCanvas, $('#pinned')]]) {
    const h = sc.clientHeight;
    sizeCanvas(cv, w, h);
    cv.style.marginBottom = -h + 'px';
  }
  $('#ruler').style.width = w + 'px';
  sizeCanvas(rulerCanvas, w, 45);
  sizeCanvas(songCanvas, w, 21);
  sizeCanvas(ovCanvas, $('#arrangement').clientWidth, 14);
}

const xOf = b => (b - view.beat0) * view.ppb;
const bOf = x => view.beat0 + x / view.ppb;
const beatsPerBar = () => set ? set.sig.num * 4 / set.sig.den : 4;

// Bar-number spacing: the smallest power-of-two number of bars at least 44 px apart
// (Live 12 at the reference zoom: one bar = 15.7 px, a number every 4 bars).
function barStep() {
  const bpb = beatsPerBar();
  for (const s of [1, 2, 4, 8, 16, 32, 64, 128, 256]) if (s * bpb * view.ppb >= 44) return s;
  return 512;
}
// grid line spacing in beats: the finest power-of-two step at least 12 px apart (reference: a line per bar at 15.7 px)
function gridStep() {
  const beat = 4 / (set ? set.sig.den : 4), bpb = beatsPerBar();
  for (const s of [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]) {
    const b = s * beat;
    if (b * view.ppb >= 12 && (b < bpb ? bpb % b < 1e-9 : b % bpb < 1e-9)) return b;
  }
  return 2048;
}
// Alternating background tiles: the smallest power-of-four number of bars at least 100 px wide
// (reference screenshots: 16 bars at 15.7 px/bar, 4 bars at 26 px/bar).
function tileBeats() {
  const bpb = beatsPerBar();
  for (let s = 1; s < 1e6; s *= 4) if (s * bpb * view.ppb >= 100) return s * bpb;
  return 1e6;
}
// lane background: tiles (the first, from bar 1, darker) and grid lines
function drawZebra(ctx, w, y, h, sel) {
  const block = tileBeats(), b1 = bOf(w);
  const light = sel ? C.highlight : C.surface, dark = sel ? C.tileSel : C.tile;
  for (let b = Math.floor(view.beat0 / block) * block; b < b1; b += block) {
    const k = Math.round(b / block);
    const x0 = Math.round(xOf(b)), x1 = Math.round(xOf(b + block));
    ctx.fillStyle = (k % 2 === 0) ? dark : light;
    ctx.fillRect(Math.max(0, x0), y, Math.min(w, x1) - Math.max(0, x0), h);
  }
  const g = gridStep();
  for (let b = Math.floor(view.beat0 / g) * g; b < b1; b += g) {
    const x = Math.round(xOf(b));
    if (x < 0) continue;
    const k = Math.floor(b / block + 1e-9);
    ctx.fillStyle = gridLine(sel, ((k % 2) + 2) % 2 === 0);
    ctx.fillRect(x, y, 1, h);
  }
}
function drawGrid(ctx, w, y, h) {
  const bpb = beatsPerBar(), g = gridStep(), b1 = bOf(w);
  for (let b = Math.floor(view.beat0 / g) * g; b < b1; b += g) {
    const x = Math.round(xOf(b));
    if (x < 0) continue;
    const isBar = Math.abs(b / bpb - Math.round(b / bpb)) < 1e-6;
    ctx.fillStyle = isBar ? 'rgba(0,0,0,.2)' : 'rgba(0,0,0,.1)';
    ctx.fillRect(x, y, 1, h);
  }
}

function drawLanes(ctx, list, scrollTop, viewH, pinned) {
  const w = lanesWidth();
  ctx.clearRect(0, 0, w, viewH);
  drawZebra(ctx, w, 0, viewH, false);
  let end = 0;
  for (const r of list) {
    const y = r.y - scrollTop;
    end = Math.max(end, y + r.h);
    if (y > viewH || y + r.h < 0) continue;
    const t = r.track, h = r.h - SEP;
    if (t === selected) drawZebra(ctx, w, y, h, true);
    if (t.type === 'group') drawGroupSummary(ctx, t, y, h, w);
    else for (const c of t.clips) {
      const x0 = xOf(c.start), x1 = xOf(c.end);
      if (x1 < 0 || x0 > w) continue;
      drawClip(ctx, c, x0, x1, y, h, w);
    }
    ctx.fillStyle = C.area; ctx.fillRect(0, y + h, w, SEP);
    // the insert marker's cursor line in the selected track
    if (t === selected && !engine.playing) { const x = Math.round(xOf(view.insert)); ctx.fillStyle = '#78dee8'; ctx.fillRect(x, y, 1, h); }
  }
  if (pinned) { ctx.fillStyle = C.area; ctx.fillRect(0, 0, w, 3); }
  else if (viewH - end > 30) {
    // centred hint on a SurfaceBackground plate that hides the grid (as measured)
    const msg = 'Drop Files and Devices Here';
    ctx.font = FONT; ctx.textBaseline = 'alphabetic';
    const tw = Math.ceil(ctx.measureText(msg).width), tx = Math.round((w - tw) / 2), by = Math.round(end + (viewH - end) / 2) + 4;
    ctx.fillStyle = C.surface; ctx.fillRect(tx - 1, by - 8, tw + 1, 11);
    ctx.fillStyle = T.ControlForeground; ctx.fillText(msg, tx, by);
  }
  const ph = engine.playing ? engine.beatNow() : null;
  if (ph != null) { const x = Math.round(xOf(ph)); if (x >= 0 && x <= w) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, 0, 1, viewH); } }
}

function drawGroupSummary(ctx, g, y, h, w) {
  const kidsDeep = [];
  const walk = t => { for (const k of t.children) { kidsDeep.push(k); walk(k); } };
  walk(g);
  const lanes = kidsDeep.filter(k => k.clips.length);
  if (!lanes.length) return;
  const slot = Math.max(2, Math.min(4, (h - 4) / lanes.length));
  lanes.forEach((k, i) => {
    const yy = y + 2 + (i * slot) % Math.max(1, h - 4);
    for (const c of k.clips) {
      const x0 = xOf(c.start), x1 = xOf(c.end);
      if (x1 < 0 || x0 > w) continue;
      ctx.fillStyle = c.disabled ? T.MutedAuditionClip : c.color;
      ctx.fillRect(Math.max(0, x0), yy, Math.max(1, Math.min(w, x1) - Math.max(0, x0)), Math.max(1, slot - 1.5));
    }
  });
}

function drawClip(ctx, c, x0, x1, y, h, w) {
  const col = c.disabled ? T.MutedAuditionClip : c.color;
  const edge = shade(col, 0.53);
  const cx0 = Math.max(-2, Math.round(x0)), cx1 = Math.min(w + 2, Math.round(x1));
  const headH = h >= 30 ? 15 : h - 1;
  ctx.save();
  ctx.beginPath(); ctx.rect(cx0, y, cx1 - cx0, h); ctx.clip();
  ctx.fillStyle = col; ctx.fillRect(cx0, y, cx1 - cx0, h);
  ctx.fillStyle = edge; ctx.fillRect(cx0, y, cx1 - cx0, 1);
  const by = y + 1 + headH;
  if (h >= 30) {
    ctx.fillStyle = edge; ctx.fillRect(cx0, by, cx1 - cx0, 1);
    const bodyY = by + 1, bodyH = y + h - bodyY;
    drawGrid(ctx, w, bodyY, bodyH);
    if (c.kind === 'midi') drawNotes(ctx, c, x0, x1, bodyY + 2, bodyH - 4, w);
    else drawWave(ctx, c, x0, x1, bodyY + 1, bodyH - 2, w);
    if (c.loop.on) {
      ctx.fillStyle = edge;
      let d = nextWrap(c, 0);
      for (let k = 0; k < 2000 && c.start + d < c.end - 1e-9; k++) { const x = Math.round(xOf(c.start + d)); if (x > w) break; if (x >= 0) ctx.fillRect(x, by, 1, h - (by - y)); d = nextWrap(c, d + 1e-9); }
    }
  }
  ctx.fillStyle = luminance(col) < 0.4 ? '#efefef' : T.ClipText;
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  if (c.name && cx1 - cx0 > 12) ctx.fillText(c.name, Math.max(x0, 0) + 3, y + 1 + headH / 2 + 0.5, Math.max(0, cx1 - Math.max(x0, 0) - 6));
  ctx.restore();
  ctx.fillStyle = edge;
  if (x0 >= -1 && x0 <= w) ctx.fillRect(Math.round(x0), y, 1, h);
  if (x1 >= -1 && x1 <= w) ctx.fillRect(Math.round(x1) - 1, y, 1, h);
}
const shade = (hex, f) => { const n = parseInt(hex.slice(1, 7), 16); const c = v => Math.round(Math.min(255, v * f)).toString(16).padStart(2, '0'); return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255); };

function drawNotes(ctx, c, x0, x1, y, h, w) {
  if (!c.notes.length || h < 2) return;
  const lo = c.lo - 1, hi = c.hi + 1, range = hi - lo + 1;
  const rowH = h / range, nh = clamp(rowH > 3 ? rowH - 1 : rowH, 1, 8);
  const len = c.end - c.start;
  ctx.fillStyle = '#1e1f23';
  let d = 0;
  for (let k = 0; k < 4000 && d < len; k++) {
    const cs = contentAt(c, d);
    const pieceEnd = Math.min(len, nextWrap(c, d));
    const ce = cs + (pieceEnd - d);
    const xa = xOf(c.start + d);
    if (xa > w) break;
    if (xOf(c.start + pieceEnd) >= 0) {
      for (const n of c.notes) {
        if (n.t + n.d <= cs || n.t >= ce) continue;
        const s = Math.max(n.t, cs), e = Math.min(n.t + n.d, ce);
        const nx0 = xOf(c.start + d + (s - cs)), nx1 = xOf(c.start + d + (e - cs));
        const ny = y + (hi - n.key) * (h / range) + (h / range - nh) / 2;
        ctx.globalAlpha = n.on ? 1 : 0.35;
        ctx.fillRect(nx0, Math.round(ny), Math.max(1, nx1 - nx0 - 0.5), nh);
      }
    }
    if (pieceEnd === Infinity) break;
    d = pieceEnd;
  }
  ctx.globalAlpha = 1;
}

function drawWave(ctx, c, x0, x1, y, h, w) {
  const pk = c.file ? peaks.get(c.file) : null;
  if (!pk) return;
  const chs = pk.ch, band = h / chs;
  ctx.fillStyle = T.WaveformColor;
  const xs = Math.max(0, Math.floor(x0)), xe = Math.min(w, Math.ceil(x1));
  const clipStartSec = tempoMap.sec(c.start);
  for (let x = xs; x < xe; x++) {
    const ba = bOf(x) - c.start, bb = bOf(x + 1) - c.start;
    let sa, sb;
    if (c.warped) { sa = warpSec(c, contentAt(c, ba)); sb = warpSec(c, contentAt(c, bb)); }
    else { sa = contentAt(c, tempoMap.sec(c.start + ba) - clipStartSec); sb = contentAt(c, tempoMap.sec(c.start + bb) - clipStartSec); }
    if (sb < sa) sb = sa + (bb - ba) * 60 / tempoMap.tempoAt(c.start + ba);
    let k0 = Math.floor(sa * pk.sr / PEAK_BLOCK), k1 = Math.ceil(sb * pk.sr / PEAK_BLOCK);
    if (k1 <= k0) k1 = k0 + 1;
    if (k0 >= pk.done || k1 <= 0) continue;
    k0 = Math.max(0, k0); k1 = Math.min(pk.done, k1);
    for (let ch = 0; ch < chs; ch++) {
      let lo = 127, hi = -127;
      const mn = pk.min[ch], mx = pk.max[ch];
      const stride = Math.max(1, Math.floor((k1 - k0) / 64));
      for (let k = k0; k < k1; k += stride) { if (mn[k] < lo) lo = mn[k]; if (mx[k] > hi) hi = mx[k]; }
      if (lo > hi) continue;
      const mid = y + band * ch + band / 2, amp = (band / 2 - 1) * c.gain ** 0.5;
      const top = mid - (hi / 127) * amp, bot = mid - (lo / 127) * amp;
      ctx.fillRect(x, top, 1, Math.max(1, bot - top));
    }
  }
}

// Beat-time ruler: 22 px band with bar numbers, then 23 px of lane background with the loop brace and insert marker
function drawRuler() {
  const cv = rulerCanvas, w = lanesWidth(), h = 45, ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.surface; ctx.fillRect(0, 0, w, 22);
  if (!set) return;
  drawZebra(ctx, w, 22, h - 22, false);
  const bpb = beatsPerBar(), step = barStep();
  ctx.font = FONT; ctx.textBaseline = 'alphabetic';
  const firstBar = Math.floor(view.beat0 / bpb), lastBar = Math.ceil(bOf(w) / bpb);
  for (let bar = Math.floor(firstBar / step) * step; bar <= lastBar; bar += step) {
    const x = Math.round(xOf(bar * bpb));
    ctx.fillStyle = T.RangeDisabledOff;
    ctx.fillRect(x, 16, 1, 6); ctx.fillRect(x, 16, 2, 1);
    ctx.fillStyle = C.ruler;
    ctx.fillText(String(bar + 1), x + 5, 20);
  }
  // loop brace (LoopColor frame; filled when the loop is on), drawn from the measured pixel pattern
  const lx0 = Math.round(xOf(set.loop.start)), lx1 = Math.round(xOf(set.loop.start + set.loop.length));
  drawLoopBrace(ctx, lx0, lx1, set.loop.on);
  for (const l of set.locators) {
    const x = Math.round(xOf(l.time));
    if (x < -200 || x > w) continue;
    ctx.fillStyle = T.ControlForeground;
    ctx.beginPath(); ctx.moveTo(x, 23); ctx.lineTo(x + 6, 28); ctx.lineTo(x, 33); ctx.closePath(); ctx.fill();
    if (l.name) ctx.fillText(l.name, x + 8, 31);
  }
  // insert / start marker: a 7 px wide downward triangle at the bottom
  const ix = Math.round(xOf(view.insert));
  ctx.fillStyle = C.insert;
  for (let k = 0; k < 4; k++) ctx.fillRect(ix - 3 + k, 41 + k, 7 - 2 * k, 1);
  if (engine.playing) { const px = Math.round(xOf(engine.beatNow())); ctx.fillStyle = '#ffffff'; ctx.fillRect(px, 22, 1, h - 22); }
}
// Left end of the loop brace, 10 x 11 px of LoopColor coverage measured from Live (the right end is its mirror image)
const BRACE = [[0.91,0.95,1,1,1,1,1,1,1,1],[0.74,0.11,0.68,0.56,0.04,0,0,0,0,0],[0.74,0,0,0.31,0.78,0.31,0,0,0,0],[0.74,0,0,0,0.04,0.56,0.67,0.11,0,0],
  [0.74,0,0,0,0,0,0.2,0.76,0.44,0.01],[0.74,0,0,0,0,0,0,0.02,0.78,0.6],[0.74,0,0,0,0,0,0.2,0.75,0.43,0.01],[0.74,0,0,0,0.04,0.56,0.67,0.11,0,0],
  [0.74,0,0,0.32,0.78,0.31,0,0,0,0],[0.74,0.11,0.68,0.56,0.04,0,0,0,0,0],[0.91,0.95,1,1,1,1,1,1,1,1]];
function drawLoopBrace(ctx, lx0, lx1, on) {
  const fg = on ? C.surface : C.loop, bg = on ? C.loop : C.surface;
  ctx.fillStyle = bg; ctx.fillRect(lx0, 22, lx1 - lx0 + 1, 11);
  ctx.fillStyle = C.loop; ctx.fillRect(lx0 + 10, 22, lx1 - lx0 - 19, 1); ctx.fillRect(lx0 + 10, 32, lx1 - lx0 - 19, 1);
  ctx.fillStyle = fg;
  BRACE.forEach((row, y) => row.forEach((a, x) => {
    if (!a) return;
    ctx.globalAlpha = a;
    const c = (x === 0 || y === 0 || y === 10) ? C.loop : fg;
    ctx.fillStyle = c;
    ctx.fillRect(lx0 + x, 22 + y, 1, 1); ctx.fillRect(lx1 - x, 22 + y, 1, 1);
  }));
  ctx.globalAlpha = 1;
  ctx.fillStyle = T.RangeDisabledOff; ctx.fillRect(lx0, 21, 1, 1); ctx.fillRect(lx1, 21, 1, 1);
}

function drawSongRuler() {
  const cv = songCanvas, w = lanesWidth(), h = 21, ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.surface; ctx.fillRect(0, 0, w, h);
  if (!set) return;
  const s0 = tempoMap.sec(view.beat0), s1 = tempoMap.sec(bOf(w));
  const pxPerSec = w / Math.max(0.001, s1 - s0);
  let step = 1;
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) { step = s; if (s * pxPerSec >= 50) break; }
  ctx.font = FONT; ctx.textBaseline = 'alphabetic';
  // measured tick colour of the time ruler (a little lighter than the beat ruler's)
  const tick = '#6b6b6b';
  ctx.fillStyle = tick;
  const g = gridStep();
  for (let b = Math.ceil(view.beat0 / g) * g; b < bOf(w); b += g) ctx.fillRect(Math.round(xOf(b)), 0, 1, 2);
  for (let s = Math.max(0, Math.floor(s0 / step) * step); s <= s1; s += step) {
    const x = Math.round(xOf(tempoMap.beat(s)));
    ctx.fillStyle = tick; ctx.fillRect(x, 0, 1, 8); ctx.fillRect(x, 7, 2, 1);
    ctx.fillStyle = C.ruler;
    ctx.fillText(`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`, x + 3, 11);
  }
  // insert marker, pointing up
  const ix = Math.round(xOf(view.insert));
  ctx.fillStyle = C.insert;
  for (let k = 0; k < 4; k++) ctx.fillRect(ix - k, 1 + k, 2 * k + 1, 1);
}

// Overview strip above the ruler, framed in MainViewFocusIndicator grey
const OV_ROWS = [0x36, 0x36, 0x29, 0x31, 0x36, 0x2d, 0x2d, 0x36, 0x31, 0x29, 0x36, 0x36];
function drawOverview() {
  const W = $('#arrangement').clientWidth, ctx = ovCanvas.getContext('2d');
  const F = T.MainViewFocusIndicator;
  ctx.clearRect(0, 0, W, 14);
  OV_ROWS.forEach((v, y) => { ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(1, y, W - 2, 1); });
  if (set) {
    // clips, squeezed into the 12 px strip
    const lw = lanesWidth(), all = set.tracks.filter(isVisible), total = Math.max(set.end + beatsPerBar(), bOf(lw));
    all.forEach((t, i) => {
      const y0 = 1 + Math.floor(i * 10 / all.length), y1 = 1 + Math.floor((i + 1) * 10 / all.length);
      for (const c of t.clips) { ctx.fillStyle = c.color; ctx.fillRect(1 + c.start / total * (W - 2), y0, Math.max(1, (c.end - c.start) / total * (W - 2)), Math.max(1, y1 - y0)); }
    });
  }
  ctx.fillStyle = F;
  ctx.fillRect(0, 0, 1, 14); ctx.fillRect(W - 1, 0, 1, 14); ctx.fillRect(0, 12, W, 2);
  // rounded inner corners, as measured
  const px = (x, y, v) => { ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 1, 1); };
  px(1, 0, 0x61); px(2, 0, 0x3d); px(W - 2, 0, 0x61); px(W - 3, 0, 0x3e);
  px(1, 11, 0x53); px(2, 11, 0x3a); px(W - 2, 11, 0x53); px(W - 3, 11, 0x3a);
  px(0, 13, 0x3d); px(1, 13, 0x60); px(2, 13, 0x6f); px(W - 1, 13, 0x3d); px(W - 2, 13, 0x60); px(W - 3, 13, 0x6f);
}

let rafPending = false;
function drawAll() {
  if (!set || rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const tr = $('#tracks'), pn = $('#pinned');
    drawLanes(lanesCanvas.getContext('2d'), rows, tr.scrollTop, tr.clientHeight, false);
    drawLanes(pinCanvas.getContext('2d'), pinnedRows, pn.scrollTop, pn.clientHeight, true);
    drawRuler(); drawSongRuler(); drawOverview();
    // grid size indicator in the bottom right corner of the lanes ("1/1" = one bar)
    const g = gridStep() / beatsPerBar();
    $('#oneone').textContent = g >= 1 ? (g === 1 ? '1/1' : `${g} Bars`) : `1/${Math.round(1 / g)}`;
    const z = view.ppb / (DEFAULT_PPB);
    $('#zoom-label').textContent = z.toFixed(2) + 'x';
    $('#zoom-fill').style.width = Math.round(clamp(10 * z, 0, 33)) + 'px';
  });
}

// ---------------------------------------------------------------------------

// Devices (Detail view)

function renderDevices(t) {
  const host = $('#devices');
  host.innerHTML = '';
  if (!t) { host.innerHTML = '<div class="empty">Select a track to see its devices</div>'; return; }
  if (!t.devices.length) {
    host.innerHTML = `<div class="empty">${t.type === 'audio' || t.type === 'return' || t.type === 'group' || t.type === 'main' ? 'Drop Audio Effects Here' : 'Drop an Instrument or Sample Here'}</div>`;
    return;
  }
  for (const d of t.devices) host.append(deviceEl(d));
}

function deviceEl(d) {
  const el = document.createElement('div');
  el.className = 'device' + (d.on ? '' : ' off');
  el.innerHTML = '<div class="dtitle"><i class="dot"></i><span class="dname"></span><span class="dkind"></span></div><div class="dbody"></div>';
  $('.dname', el).textContent = d.name;
  $('.dkind', el).textContent = d.kind;
  const body = $('.dbody', el);
  if (d.chains.length || RACKS.has(d.tag)) {
    if (d.macros.length) {
      const m = document.createElement('div'); m.className = 'macros';
      for (const [n, v] of d.macros) {
        const mc = document.createElement('div'); mc.className = 'macro';
        mc.innerHTML = '<i class="knob"></i><div class="pn"></div><div class="pv"></div>';
        $('.knob', mc).style.setProperty('--r', (-135 + clamp(v / 127, 0, 1) * 270) + 'deg');
        mc.querySelector('.pn').textContent = n; mc.querySelector('.pv').textContent = Math.round(v);
        m.append(mc);
      }
      body.append(m);
    }
    const list = document.createElement('div'); list.className = 'chains';
    const nested = document.createElement('div'); nested.className = 'nested';
    const show = (i) => {
      [...list.children].forEach((x, j) => x.classList.toggle('sel', i === j));
      nested.innerHTML = '';
      const ch = d.chains[i];
      if (!ch) return;
      if (!ch.devices.length) { const e = document.createElement('div'); e.className = 'empty'; e.style.margin = 'auto'; e.textContent = 'Empty chain'; nested.append(e); }
      for (const nd of ch.devices) nested.append(deviceEl(nd));
    };
    d.chains.forEach((ch, i) => {
      const r = document.createElement('div'); r.className = 'chain';
      r.innerHTML = `<i style="background:${ch.color}"></i><span></span>`;
      r.querySelector('span').textContent = ch.name + (ch.note != null && d.tag === 'DrumGroupDevice' ? ` (${noteName(ch.note)})` : '');
      if (!ch.on) r.style.opacity = .5;
      r.addEventListener('mousedown', () => show(i));
      list.append(r);
    });
    if (d.chains.length) { body.append(list, nested); show(0); }
    el.style.maxWidth = 'none';
  } else {
    const p = document.createElement('div'); p.className = 'params';
    for (const [n, v] of d.params) {
      const pe = document.createElement('div'); pe.className = 'param';
      pe.innerHTML = '<div class="pn"></div><div class="pv"></div>';
      pe.firstChild.textContent = n; pe.lastChild.textContent = v;
      pe.title = `${n}: ${v}`;
      p.append(pe);
    }
    if (!d.params.length) { const e = document.createElement('div'); e.className = 'param'; e.innerHTML = '<div class="pn">No parameters</div>'; p.append(e); }
    body.append(p);
  }
  return el;
}
const noteName = n => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n % 12] + (Math.floor(n / 12) - 2);

// ---------------------------------------------------------------------------
// Playback

const engine = {
  ctx: null, playing: false, nodes: new Map(), live: new Set(), timer: null, segs: [], queue: [], meterRaf: 0,

  ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = set.main.mixer.volume;
    this.master.connect(this.ctx.destination);
    this.buildGraph();
  },
  buildGraph() {
    this.nodes.clear();
    const make = t => {
      const input = this.ctx.createGain();     // clips and child tracks arrive here
      const vol = this.ctx.createGain();       // track volume × audible
      const pan = this.ctx.createStereoPanner();
      const an = this.ctx.createAnalyser(); an.fftSize = 512;
      const split = this.ctx.createChannelSplitter(2);
      const anL = this.ctx.createAnalyser(), anR = this.ctx.createAnalyser(); anL.fftSize = anR.fftSize = 512;
      input.connect(vol); vol.connect(pan); pan.connect(split); split.connect(anL, 0); split.connect(anR, 1);
      this.nodes.set(t, { input, vol, pan, anL, anR });
    };
    for (const t of set.tracks) make(t);
    for (const t of set.tracks) {
      const n = this.nodes.get(t);
      n.pan.connect(t.parent ? this.nodes.get(t.parent).input : this.master);
    }
    this.updateMix();
  },
  audible(t) {
    let p = t;
    while (p) { if (!p.mixer.on) return false; p = p.parent; }
    const soloing = set.tracks.some(x => x.mixer.solo);
    if (!soloing) return true;
    p = t; while (p) { if (p.mixer.solo) return true; p = p.parent; }
    // a soloed track inside a group keeps the group bus open
    const kidSolo = x => x.children.some(k => k.mixer.solo || kidSolo(k));
    return t.type === 'group' && kidSolo(t);
  },
  updateMix() {
    if (!this.ctx) return;
    for (const [t, n] of this.nodes) {
      const g = (t.type === 'group' ? (t.mixer.on ? 1 : 0) : (this.audible(t) ? 1 : 0)) * t.mixer.volume;
      n.vol.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
      n.pan.pan.value = clamp(t.mixer.pan, -1, 1);
    }
  },
  // which clips make a track's sound
  playClips(t) {
    if (t.freezeClips.length) return t.freezeClips;
    if (t.type === 'audio') return t.clips;
    return [];
  },

  async play(fromBeat) {
    this.ensure();
    await this.ctx.resume();
    this.stop(true);
    // make sure every needed file is ready
    const need = new Set();
    for (const t of set.tracks) for (const c of this.playClips(t)) if (c.file && !c.disabled) need.add(c.file);
    status(`Preparing ${need.size} audio file${need.size === 1 ? '' : 's'}…`);
    for (const p of need) await getSource(p);
    this.playing = true;
    $('#cb-play').classList.add('playing');
    this.t0 = this.ctx.currentTime + 0.1;
    this.segs = [];
    this.startBeat = fromBeat;
    this.queue = [];
    this.horizonBeat = fromBeat;
    this.nextSeg();
    this.timer = setInterval(() => this.tick(), 40);
    this.tick();
    const silent = set.tracks.filter(t => (t.type === 'midi') && !t.freezeClips.length && t.clips.length);
    status(silent.length ? `Playing. ${silent.length} MIDI track${silent.length === 1 ? ' has' : 's have'} no frozen audio and can't be heard.` : 'Playing');
    this.meters();
  },
  // a segment maps a stretch of real time to a stretch of the arrangement (loops add more segments)
  nextSeg() {
    const last = this.segs[this.segs.length - 1];
    const loopOn = set.loop.on, le = set.loop.start + set.loop.length;
    let b0, ctx0;
    if (!last) { b0 = this.startBeat; ctx0 = this.t0; }
    else { b0 = loopOn ? set.loop.start : last.b1; ctx0 = last.ctx1; }
    let b1 = loopOn && b0 < le ? le : Math.max(b0, set.end) + 4096;
    if (!loopOn && last) return null;
    const seg = { b0, b1, ctx0, ctx1: ctx0 + (tempoMap.sec(b1) - tempoMap.sec(b0)) };
    this.segs.push(seg);
    // chunks for every track in this segment
    for (const t of set.tracks) for (const c of this.playClips(t)) {
      if (c.disabled || !c.file) continue;
      const a = Math.max(c.start, b0), b = Math.min(c.end, b1);
      if (b <= a) continue;
      const src = sources.get(c.file);
      if (!src) continue;
      this.addPieces(t, c, src, seg, a, b);
    }
    this.queue.sort((x, y) => x.when - y.when);
    return seg;
  },
  ctxAt(seg, beat) { return seg.ctx0 + tempoMap.sec(beat) - tempoMap.sec(seg.b0); },
  addPieces(t, c, src, seg, a, b) {
    const tempoVaries = !!tempoMap.events;
    let d = a - c.start;
    const dEnd = b - c.start;
    const clipSec0 = tempoMap.sec(c.start);
    let guard = 0;
    while (d < dEnd - 1e-9 && guard++ < 100000) {
      let dNext = Math.min(dEnd, nextWrap(c, d));
      if (tempoVaries) dNext = Math.min(dNext, Math.floor(d) + 1);
      let sa, sb;
      if (c.warped) {
        const ca = contentAt(c, d), cb = ca + (dNext - d);
        const brk = warpBreaks(c, ca, cb)[0];
        if (brk != null) dNext = d + (brk - ca);
        sa = warpSec(c, ca); sb = warpSec(c, ca + (dNext - d));
      } else {
        const ea = tempoMap.sec(c.start + d) - clipSec0, eb = tempoMap.sec(c.start + dNext) - clipSec0;
        sa = contentAt(c, ea); sb = sa + (eb - ea);
      }
      const ta = this.ctxAt(seg, c.start + d), tb = this.ctxAt(seg, c.start + dNext);
      if (tb > ta && sb > sa) {
        const rate = (sb - sa) / (tb - ta);
        // split into chunks of at most 2 seconds of source audio
        const CH = 2;
        for (let s = sa; s < sb - 1e-6; s += CH) {
          const e = Math.min(sb, s + CH);
          this.queue.push({ t, src, gain: c.gain, when: ta + (s - sa) / rate, s, e, rate });
        }
      }
      d = dNext;
    }
  },
  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime, horizon = now + 1.5;
    while (this.segs.length && this.segs[this.segs.length - 1].ctx1 < horizon + 2) { if (!this.nextSeg()) break; }
    while (this.queue.length && this.queue[0].when < horizon) {
      const q = this.queue.shift();
      this.schedule(q, now);
    }
    // forget finished segments except the current one
    while (this.segs.length > 2 && this.segs[1].ctx1 < now) this.segs.shift();
    this.updatePos();
  },
  schedule(q, now) {
    const sr = q.src.sr;
    let s = q.s, when = q.when;
    if (when + (q.e - s) / q.rate < now) return;          // already over
    if (when < now) { s += (now - when) * q.rate; when = now; }
    const f0 = Math.floor(s * sr), f1 = Math.ceil(q.e * sr);
    if (f1 <= f0 || f0 >= q.src.frames) return;
    const data = q.src.read(f0, f1 - f0);
    if (!data.length || !data[0].length) return;
    const buf = this.ctx.createBuffer(Math.min(2, data.length), data[0].length, sr);
    buf.copyToChannel(data[0], 0);
    if (buf.numberOfChannels > 1) buf.copyToChannel(data[1] || data[0], 1);
    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = q.rate;
    const g = this.ctx.createGain(); g.gain.value = q.gain;
    node.connect(g); g.connect(this.nodes.get(q.t).input);
    node.start(when, (s * sr - f0) / sr);
    this.live.add(node);
    node.onended = () => { this.live.delete(node); g.disconnect(); };
  },
  beatNow() {
    if (!this.playing) return view.insert;
    const now = this.ctx.currentTime;
    const seg = this.segs.find(s => now >= s.ctx0 && now < s.ctx1) || this.segs[0];
    if (!seg) return this.startBeat;
    if (now < seg.ctx0) return seg.b0;
    return tempoMap.beat(tempoMap.sec(seg.b0) + (now - seg.ctx0));
  },
  updatePos() {
    const b = this.beatNow();
    showPos('cb-pos', fmtPos(b));
    $('#cb-tempo').textContent = tempoMap.tempoAt(b).toFixed(2);
    // follow
    if (follow) {
      const w = lanesWidth(), x = xOf(b);
      if (x > w * 0.9 || x < 0) { view.beat0 = b - (w * 0.05) / view.ppb; }
    }
    drawAll();
  },
  stop(silent) {
    clearInterval(this.timer); this.timer = null;
    for (const n of this.live) { try { n.stop(); } catch (e) {} }
    this.live.clear();
    this.queue = []; this.segs = [];
    if (this.playing && !silent) status('Stopped');
    this.playing = false;
    $('#cb-play').classList.remove('playing');
    cancelAnimationFrame(this.meterRaf);
    for (const t of set?.tracks || []) if (t._meter) t._meter.querySelectorAll('b').forEach(b => b.style.height = '0');
    showPos('cb-pos', fmtPos(view.insert));
    drawAll();
  },
  meters() {
    const buf = new Float32Array(512);
    const loop = () => {
      if (!this.playing) return;
      for (const [t, n] of this.nodes) {
        if (!t._meter || !t._meter.isConnected) continue;
        const bars = t._meter.querySelectorAll('b');
        [n.anL, n.anR].forEach((an, i) => {
          an.getFloatTimeDomainData(buf);
          let pk = 0; for (let k = 0; k < buf.length; k++) { const v = Math.abs(buf[k]); if (v > pk) pk = v; }
          const db = pk > 0 ? 20 * Math.log10(pk) : -100;
          bars[i].style.height = clamp((db + 60) / 66, 0, 1) * 100 + '%';
        });
      }
      this.meterRaf = requestAnimationFrame(loop);
    };
    loop();
  },
};
let follow = true;

function fmtPos(b) {
  const bpb = beatsPerBar(), beatLen = 4 / set.sig.den;
  const bar = Math.floor(b / bpb) + 1;
  const inBar = b - (bar - 1) * bpb;
  const beat = Math.floor(inBar / beatLen + 1e-9) + 1;
  const six = Math.floor((inBar - (beat - 1) * beatLen) / (beatLen / 4) + 1e-9) + 1;
  return [bar, beat, six];
}
function fmtLen(b) {
  const bpb = beatsPerBar(), beatLen = 4 / set.sig.den;
  const bars = Math.floor(b / bpb + 1e-9), rest = b - bars * bpb;
  const beats = Math.floor(rest / beatLen + 1e-9), six = Math.round((rest - beats * beatLen) / (beatLen / 4));
  return [bars, beats, six];
}
// the three right-aligned fields of a position display
function showPos(id, parts) { parts.forEach((v, i) => { $(`#${id}-${i + 1}`).textContent = v; }); }

// ---------------------------------------------------------------------------
// Interaction

function setupInteraction() {
  const tracks = $('#tracks'), pinned = $('#pinned');
  tracks.addEventListener('scroll', drawAll);
  pinned.addEventListener('scroll', drawAll);
  addEventListener('resize', () => { if (set) { layoutCanvases(); drawAll(); } });

  const zoomAt = (x, factor) => {
    const b = bOf(x);
    view.ppb = clamp(view.ppb * factor, 0.05, 2000);
    view.beat0 = b - x / view.ppb;
    drawAll();
  };
  const onWheel = (e, area) => {
    if (!set) return;
    const rect = area.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(x, Math.exp(-e.deltaY * 0.0025)); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      view.beat0 += (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / view.ppb;
      view.beat0 = Math.max(-4, view.beat0);
      drawAll();
    }
  };
  for (const el of [tracks, pinned]) el.addEventListener('wheel', e => { if (e.clientX - el.getBoundingClientRect().left < lanesWidth()) onWheel(e, el); }, { passive: false });
  $('#ruler').addEventListener('wheel', e => onWheel(e, $('#ruler')), { passive: false });
  $('#songruler').addEventListener('wheel', e => onWheel(e, $('#songruler')), { passive: false });

  // Ruler: click sets the start position; drag up/down zooms, left/right scrolls (like Live)
  const ruler = $('#ruler');
  ruler.addEventListener('pointerdown', e => {
    if (!set) return;
    const rect = ruler.getBoundingClientRect();
    const x0 = e.clientX - rect.left, y0 = e.clientY;
    let moved = false, lastX = e.clientX, lastY = e.clientY;
    const anchorB = bOf(x0);
    ruler.setPointerCapture(e.pointerId);
    const move = ev => {
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - y0) > 3) moved = true;
      if (!moved) return;
      view.ppb = clamp(view.ppb * Math.exp(dy * 0.012), 0.05, 2000);
      view.beat0 = anchorB - (x0 + (ev.clientX - e.clientX)) / view.ppb;
      lastX = ev.clientX; lastY = ev.clientY;
      drawAll();
    };
    const up = () => {
      ruler.removeEventListener('pointermove', move); ruler.removeEventListener('pointerup', up);
      if (!moved) setInsert(snap(anchorB));
    };
    ruler.addEventListener('pointermove', move); ruler.addEventListener('pointerup', up);
  });
  const laneClick = (e, area, list) => {
    if (!set) return;
    const rect = area.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top + area.scrollTop;
    if (x > lanesWidth()) return;
    const r = list.find(r => y >= r.y && y < r.y + r.h);
    if (r) select(r.track);
    setInsert(snap(bOf(x)));
  };
  tracks.addEventListener('mousedown', e => laneClick(e, tracks, rows));
  pinned.addEventListener('mousedown', e => laneClick(e, pinned, pinnedRows));

  $('#cb-play').addEventListener('click', () => { if (set) engine.play(view.insert); });
  $('#cb-stop').addEventListener('click', () => { if (set) { if (!engine.playing) setInsert(0); engine.stop(); } });
  $('#cb-loop').addEventListener('click', () => {
    if (!set) return;
    set.loop.on = !set.loop.on; $('#cb-loop').classList.toggle('on', set.loop.on);
    if (engine.playing) engine.play(engine.beatNow());
    drawAll();
  });
  $('#cb-follow').addEventListener('click', () => { follow = !follow; $('#cb-follow').classList.toggle('on', follow); });
  $('#cb-follow').classList.toggle('on', follow);
  addEventListener('keydown', e => {
    if (!set || e.target.closest?.('input')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (engine.playing) engine.stop(); else engine.play(view.insert);
    }
    if (e.key === 'Home') { setInsert(0); }
  });
}
function snap(b) {
  const g = view.ppb > 30 ? 0.25 : view.ppb > 8 ? 1 : beatsPerBar();
  return Math.max(0, Math.round(b / g) * g);
}
function setInsert(b) {
  view.insert = b;
  showPos('cb-pos', fmtPos(b));
  if (engine.playing) engine.play(b);
  drawAll();
}

// ---------------------------------------------------------------------------
// Loading a project

function dialog(html) { $('#dialog').innerHTML = html; $('#overlay').hidden = false; }
function closeDialog() { $('#overlay').hidden = true; }

function openDialog(msg) {
  dialog(`
    <h1>Ableton Live 12</h1>
    <p>${msg || 'Open a Live Project to view its Arrangement, devices and frozen audio.'}</p>
    <div class="drop" id="drop">Drop a zipped Live Project folder here<br><span class="btn" id="choose">Choose .zip…</span></div>
    <p style="color:var(--text-dim);font-size:11px">In Live: freeze all tracks, File › Collect All and Save, then zip the whole Project folder. Everything stays in your browser.</p>`);
  $('#choose').addEventListener('click', () => $('#file-input').click());
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
}
function progressDialog(text, frac) {
  if (!$('#dialog .bar')) dialog(`<h1>Loading</h1><p id="prog-text"></p><div class="bar"><i></i></div>`);
  $('#prog-text').textContent = text;
  $('#dialog .bar i').style.width = (frac == null ? 100 : Math.round(frac * 100)) + '%';
}

async function loadFile(file) {
  progressDialog(`Reading ${file.name}…`, null);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadZipBytes(bytes, file.name);
}

async function loadUrl(parts, label) {
  const chunks = []; let got = 0, total = 0;
  const sizes = [];
  for (const p of parts) {
    const res = await fetch(p);
    if (!res.ok) throw new Error(`Couldn't download ${p} (${res.status})`);
    const len = Number(res.headers.get('content-length')) || 0;
    sizes.push(len); total += len;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      progressDialog(`Downloading ${label}… ${(got / 1048576).toFixed(1)} MB`, total ? got / total : null);
    }
  }
  const all = new Uint8Array(got); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  await loadZipBytes(all, label);
}

async function loadZipBytes(bytes, label) {
  try {
    if (engine.playing) engine.stop(true);
    progressDialog(`Unpacking ${label}…`, null);
    await new Promise(r => setTimeout(r, 30));
    indexFiles(await unzip(bytes));
    bytes = null;
    const sets = findSets();
    if (!sets.length) throw new Error('No Live Set (.als) was found in this zip.');
    let chosen = sets[0];
    if (sets.length > 1) chosen = await pickSet(sets);
    progressDialog(`Reading ${basename(chosen)}…`, null);
    await new Promise(r => setTimeout(r, 30));
    const xml = await gunzipText(files.get(chosen));
    sources.clear(); peaks.clear();
    if (engine.ctx) { engine.ctx.close(); engine.ctx = null; }
    set = parseSet(xml, chosen);
    tempoMap = new TempoMap(set.tempo, set.tempoEvents, set.end);
    showSet();
    closeDialog();
    loadWaveforms();
  } catch (err) {
    console.error(err);
    openDialog(`<span class="err">${String(err.message || err).replace(/</g, '&lt;')}</span>`);
  }
}

function pickSet(list) {
  return new Promise(resolve => {
    dialog(`<h1>Choose a Live Set</h1><p>This project contains more than one Set.</p><div class="list"></div>`);
    for (const s of list) {
      const d = document.createElement('div'); d.textContent = s.replace(/^[^/]*\//, '');
      d.addEventListener('click', () => resolve(s));
      $('#dialog .list').append(d);
    }
  });
}

function showSet() {
  document.title = `${set.name} - Ableton Live 12 Suite`;
  $('#win-title').textContent = document.title;
  $('#cb-tempo').textContent = set.tempo.toFixed(2);
  $('#cb-sig .r').textContent = set.sig.num; $('#cb-sig .t:last-child').textContent = set.sig.den;
  $('#cb-quant').textContent = set.quant;
  $('#cb-root').textContent = set.scale.root;
  $('#cb-scale').textContent = set.scale.name;
  showPos('cb-ls', fmtPos(set.loop.start));
  showPos('cb-ll', fmtLen(set.loop.length));
  $('#cb-loop').classList.toggle('on', set.loop.on);
  view.insert = 0;
  showPos('cb-pos', fmtPos(0));
  selected = null;
  buildRows();
  // Live's default zoom; zoomed out further only if the song would not fit
  view.ppb = Math.min(DEFAULT_PPB, clamp(lanesWidth() / (set.end + beatsPerBar()), 0.05, 200));
  view.beat0 = 0;
  // sample rate from the first frozen file
  const any = set.tracks.flatMap(t => t.freezeClips).find(c => c.file) || set.tracks.flatMap(t => t.clips).find(c => c.file);
  if (any) getSource(any.file).then(s => { if (s) $('#cb-sr').textContent = (s.sr / 1000).toFixed(1).replace(/\.0$/, '') + ' kHz'; });
  const frozen = set.tracks.filter(t => t.frozen).length;
  const missing = set.tracks.flatMap(t => [...t.clips, ...t.freezeClips]).filter(c => c.kind === 'audio' && !c.file).length;
  $('#status-text').title = (`${set.name}: ${set.tracks.length} tracks (${frozen} frozen), ${set.returns.length} return track${set.returns.length === 1 ? '' : 's'}` + (missing ? ` · ${missing} audio file${missing === 1 ? '' : 's'} missing from the zip` : '') + (set.creator ? ` · ${set.creator}` : ''));
  status('');
  select(set.tracks[0] || null);
  drawAll();
}

async function loadWaveforms() {
  const paths = new Set();
  for (const t of set.tracks) for (const c of t.clips) if (c.kind === 'audio' && c.file) paths.add(c.file);
  let last = 0;
  for (const p of paths) {
    const done = computePeaks(p);
    // redraw now and then while peaks fill in
    const iv = setInterval(() => { if (performance.now() - last > 150) { last = performance.now(); drawAll(); } }, 200);
    await done; clearInterval(iv); drawAll();
  }
}

// ---------------------------------------------------------------------------
// Start

setupInteraction();
$('#file-input').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; });
$('#menu-file').addEventListener('click', () => openDialog());
buildStatic();
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && /\.zip$/i.test(f.name)) loadFile(f); });

(async () => {
  status('Ableton Live 12');
  let manifest = null;
  try { const r = await fetch('projects/manifest.json', { cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch (e) {}
  const list = manifest?.projects || [];
  const want = new URLSearchParams(location.search).get('project');
  const pick = list.find(p => p.name === want) || (list.length === 1 ? list[0] : null);
  if (pick) {
    try { await loadUrl(pick.parts || [pick.file], pick.name); } catch (e) { openDialog(`<span class="err">${String(e.message || e)}</span>`); }
  } else if (list.length > 1) {
    dialog(`<h1>Ableton Live 12</h1><p>Choose a project</p><div class="list"></div><p><span class="btn" id="choose2">Open a .zip…</span></p>`);
    for (const p of list) {
      const d = document.createElement('div'); d.textContent = p.name;
      d.addEventListener('click', () => loadUrl(p.parts || [p.file], p.name).catch(e => openDialog(`<span class="err">${String(e.message || e)}</span>`)));
      $('#dialog .list').append(d);
    }
    $('#choose2').addEventListener('click', () => $('#file-input').click());
  } else {
    openDialog();
  }
})();
