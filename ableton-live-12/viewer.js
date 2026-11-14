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
function layoutStatusBar(name) {
  const c = layoutStatusBar.c || (layoutStatusBar.c = document.createElement('canvas').getContext('2d'));
  const cs = getComputedStyle($('#status-track'));
  c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const area = Math.max(45, Math.round(c.measureText(name || '').width) + 13), w = 20 + area;
  $('#status-trk').style.width = w + 'px';
  if (getComputedStyle($('#status-play')).display === 'none') return;   // narrow (phone) layout keeps its own positions
  $('#status-play').style.right = (56 + w + 9) + 'px';
  $('#status-text').style.right = (56 + w + 9 + 220 + 9) + 'px';
}
const status = (t, alert) => { const el = $('#status-text'); el.textContent = t; el.classList.toggle('alert', !!(alert && t)); };

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

function displayName(el, type) {
  const user = val(el, 'Name', 'UserName'), eff = val(el, 'Name', 'EffectiveName') || '';
  if (user) return user;
  if (type === 'return') return eff.replace(/^[A-Z]-/, '');
  return eff.replace(/^(\d+)-/, '$1 ');
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
    // Live shows the user's name if there is one, else its own: EffectiveName "1-MIDI" / "A-Reverb" is shown as "1 MIDI"
    // in the header (and "1-MIDI" in the status bar), "A Reverb" for a return (letter + name; seen in the running Live)
    name: displayName(el, type),
    effName: val(el, 'Name', 'EffectiveName') || '',
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
document.documentElement.style.setProperty('--title-sel-dark', rgbHex(hexRGB(T.SelectionBackground).slice(0, 3).map(v => v * 0.267)));
// grid line colour over a given lane colour
// Measured: Live draws the grid line on the plain lane colour (rounding down), then lays the tile shade over both.
// Live draws three strengths of GridLineBase (0x144670630 scales its alpha by 0.375 / 0.666 / 1.0, constants
// 0x145e93ab4 / 0x145e93cb8, truncated to an integer alpha) and 0x144670220 picks 1.0 for lines on a bar, 0.666 on a
// beat, 0.375 otherwise. (Read in the running Live: the grid uses theme slot 303 = GridLineBase, the tiles slot 214 =
// ArrangerGridTiles; sampled lines over #323232 / #363636 are #2c2c2c / #303030 (0.375) and #282828 / #2b2b2b (0.666).)
const GRID_LEVEL = [0.375, 0.666, 1];
const gridAlpha = (hex, f) => hex.slice(0, 7) + Math.trunc(parseInt(hex.slice(7, 9) || 'ff', 16) * f).toString(16).padStart(2, '0');
const gridLine = (sel, tiled, level = 2) => { const l = over(sel ? T.SurfaceHighlight : T.SurfaceBackground, gridAlpha(T.GridLineBase, GRID_LEVEL[level]), Math.floor); return tiled ? over(l, T.ArrangerGridTiles) : l; };
const gridLevel = b => { const on = u => Math.abs(b / u - Math.round(b / u)) < 1e-6; return on(beatsPerBar()) ? 2 : on(beatLen()) ? 1 : 0; };
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
  // Info View texts as Live 12 shows them when hovering each element (read off the running Live 12; line breaks as Live wraps them)
  'Track Title Bar': 'Click to select this track; choose ‘Rename’\nfrom the Edit menu to rename the track;\nchoose ‘Delete’ to delete the track. Drag this\ntrack above or below another to reorder\nthem.\n\n[Arrow Left/Right] Fold track display in/out',
  'Main Lane|midi': 'Displays all clips that normally play through\nthe track’s mixer. Click and drag to select\ntime, then use any available Edit menu\ncommand to edit.\n\n[Ctrl + Arrow Up/Down] Insert Clips from\nPrevious/Next Take Lane\n[Ctrl + Alt + Drag] Scroll Display\n[Ctrl + Scroll Wheel] Zoom In/Out\n[Alt + Scroll Wheel] Adjust Lane Height',
  'Clip/Device Drop Area': ' ',
  'Main Lane': 'Displays all clips that normally play through\nthe track’s mixer. Click and drag to select\ntime, then use any available Edit menu\ncommand to edit.\n\n[Ctrl + Arrow Up/Down] Insert Clips from\nPrevious/Next Take Lane\n[Ctrl + Alt + Drag] Scroll Display\n[Ctrl + Scroll Wheel] Zoom In/Out\n[Alt + Scroll Wheel] Adjust Lane Height\nHold [F] to View and Edit Fades',
  'Beat-Time Ruler': 'Drag left/right to scroll.\nDrag up/down to zoom out/in.\nDouble-click to zoom in to the current\nselection.\n\n[+/-] Zoom In/Out\n[Ctrl + Scroll Wheel] Zoom In/Out',
  'Scrub Area': 'Click here to make playback jump to this\npoint. The size of the jump will be quantized\nby the global quantization setting.\nHold the mouse down over the scrub area to\nrepeatedly play a section the size of the\nchosen quantization setting. Set\nquantization to small settings or ‘None’ to\nscrub through the music.\n\n[Ctrl + Scroll Wheel] Zoom In/Out',
  'Overview': 'This section gives an overview of the entire\nArrangement.\nIn the Arrangement View, the Overview can\nbe used for navigation: Click to jump, drag\nvertically to zoom and drag horizontally to\nscroll.\n\n[Ctrl + Alt + O] Show/Hide Overview',
  'Time Ruler': 'Drag left/right to scroll.',
  'Unfold Track Button': 'Click to fold or unfold the track. When the\ntrack is folded, you can select and move\nclips; when the track is unfolded, you can\nalso view and edit waveforms and breakpoint\nenvelopes. You can set an unfolded track’s\nheight by dragging the split line below it.\n\n[Alt + U] Fold/Unfold All Tracks\n[U] Fold/Unfold Selected Track',
  'Track Activator': 'Activate this button to hear the track, or\ndeactivate it to mute the track.\nTo set the destination for the track’s signal,\nuse the Output Type and Output Channel\nchoosers, available in the mixer’s In/Out\nsection.',
  'Solo/Cue': 'If the Solo/Cue switch in the Session mixer’s\nMain track is set to ‘Solo,’ then enabling this\nswitch will solo this track by muting all\nothers.\nIf the Solo/Cue switch is set to ‘Cue,’\nenabling this switch will send this track’s\noutput to the channels selected in the\nSession mixer’s Cue Out chooser. This is\nuseful for preparing clips in private, using\nheadphones.',
  'Arm Recording': 'Turn this switch on to record-enable a track.\nArmed tracks will record the signal set in the\nInput Type and Input Channel choosers as\nnew clips. Use the Control Bar’s Record and\nPlay buttons to begin recording. Stop\nrecording with the Stop button. Arm\nmultiple tracks at once by holding down the\nCtrl modifier.',
  'Input Type': 'This chooser selects an input for this track.\nIf the input you select here has multiple\nchannels or subcategories, you can select\nfrom among them in the Input Channel\nchooser below.\nThe list of available inputs depends on how\nthe relevant preferences for this track\n(Audio or MIDI/Sync) are configured. Note\nthat track-to-track routings only require\nusing one of the tracks’ In/Out chooser\npairs.',
  'Input Channel': 'This chooser selects a channel or\nsubcategory of input for this track. A more\ngeneral setting must be selected from the\nInput Type chooser above before options will\nappear in this chooser.\nThe availability of inputs depends on how\nthe relevant preferences for this track\n(Audio or MIDI/Sync) are configured.',
  'Monitoring': 'When monitoring is active, a track’s input is\nplayed through its devices and heard at its\noutput.\nThis setting can generally be left on ‘Auto,’\nwhich turns monitoring on when the track is\narmed and off to play clips.\nTo hear a track’s instrument playing input\nfrom a MIDI keyboard, or an external audio\nsignal through a track’s effects, arm the\ntrack.',
  'Output Type': 'This chooser selects this track’s output. If\nthis output has multiple channels or\nsubcategories, you can select from among\nthem in the Output Channel chooser below.\nThe list of available outputs depends on how\nthe relevant preferences for this track\n(Audio or MIDI/Sync) are configured.\nTrack-to-track routings only require using\none of the tracks’ In/Out chooser pairs.',
  'Volume Section': 'Volume Section',
  'Play Button': 'Click to start playback.\n\n[Space] Toggle Play and Stop\n[Shift + Space] Continue Playback From Stop\n[Ctrl + Space] Play Arrangement Selection',
  'Stop Button': 'Click to stop playback.\n\n[Space] Toggle Play and Stop\n[Double-Click] Stop and Return Song\nPosition to 1.1.1',
  'Loop Switch': 'Click here to activate the Arrangement loop.',
  'Follow': 'When enabled, the display will scroll during\nplayback to keep the current song position\nvisible. Follow behavior can be set to scroll\ncontinuously or on a page-by-page basis in\nthe Display/Language/Input Preferences.\n\n[Shift + Alt + F] Follow',
  'Waveform Vertical Zoom Level': 'Sets the vertical zoom level for all audio\nwaveforms. Use the right-click option to\nswitch the zoom factor from x (multiplied\nby) to dB.',
  'Optimize Arrangement Height': 'Optimize track height to fit the\nArrangement View.\n\n[H] Optimize Arrangement Height',
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
  head.innerHTML = '<span id="br-ftoggle" class="abs" style="left:0;top:0;width:18px;height:19px"><i data-ic="br_filters" style="left:2px;top:1px"></i></span><span class="l" style="left:19px">Filters</span><span id="br-edit"><i data-ic="br_editIcon" style="left:2px;top:0"></i><span class="abs" style="left:15px;top:1px">Edit</span></span>';
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
document.addEventListener('mouseover', e => { const i = e.target.closest?.('[data-info]'); if (i && i.dataset.info && INFO[i.dataset.info]) showInfo(i.dataset.info); });
// the lanes: Main Lane (MIDI tracks have no fades line), and below the last track the Clip/Device Drop Area (running Live)
document.addEventListener('mousemove', e => {
  if (!set || !e.target.closest?.('#tracks') || e.target.closest('.theader')) return;
  const area = $('#tracks');
  if (e.clientX - area.getBoundingClientRect().left >= lanesWidth()) return;
  const y = e.clientY - area.getBoundingClientRect().top + area.scrollTop;
  const r = rows.find(r => y >= r.y && y < r.y + r.h);
  const key = !r ? 'Clip/Device Drop Area' : r.track.type === 'midi' ? 'Main Lane|midi' : 'Main Lane';
  if (showInfo.cur !== key) { showInfo.cur = key; showInfo(key); }
});
// Info View texts that are not plain lines: bullet lists as Live lays them out (running Live, "Clip/Device Drop Area":
// a 3 x 3 px square 2 px right of the paragraph's left edge, item text 11 px right of it, items 2 px and 4 px further apart)
const INFO_HTML = {
  'Clip/Device Drop Area': ['You can create new tracks by dropping files\nand devices into this area:', ['Drop MIDI files, MIDI effects and\ninstruments to create MIDI tracks.', 'Drop samples and audio effects to\ncreate audio tracks.']],
};
function showInfo(title, shown = title.replace(/\|.*/, '')) {
  showInfo.cur = title;
  $('#info-title').textContent = shown;
  const body = $('#info-body'), h = INFO_HTML[title];
  if (!h) { body.textContent = INFO[title] || ''; return; }
  body.textContent = '';
  const p = document.createElement('div'); p.textContent = h[0]; body.append(p);
  h[1].forEach((t, i) => { const li = document.createElement('div'); li.className = 'li'; li.style.marginTop = (i ? 4 : 2) + 'px'; li.textContent = t; body.append(li); });
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
const view = { beat0: 0, ppb: DEFAULT_PPB, insert: 0, ext: null, range: null };
const HW = 292;  // track header width incl. its 2 px divider
const FONT = '10px "Ableton Sans Small"';

// ---------------------------------------------------------------------------
// Layout of track rows

function isVisible(t) { let p = t.parent; while (p) { if (!p.unfolded) return false; p = p.parent; } return true; }
// A track's lane, unfolded, is 17 x round(LaneHeight / 17) + 18 px: read off the running Live with LaneHeight 17, 34, 51,
// 68, 85, 99, 100, 101, 150, 200 in a Live-saved Set -> 35, 52, 69, 86, 103, 120, 120, 120, 171, 222 px (17 px rows + 1).
const laneContentH = h => 17 * Math.round(h / 17) + 18;
function laneH(t) { return (t.unfolded ? laneContentH(t.laneHeight) : FOLDED_H) + SEP; }  // row = content + 2 px divider

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
  refreshMixerClasses();
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
  // Info View topic by row: Input Type, Input Channel, -, Output Type
  d.dataset.info = ['Input Type', 'Input Channel', 'Monitoring', 'Output Type', ''][Math.round((y - 2) / 17)] || '';
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
  row.className = 'trow'; row.style.top = y + 'px'; row.style.height = h + 'px'; row.dataset.info = 'Main Lane';
  const ch = h - SEP;   // content height
  const hd = document.createElement('div');
  hd.className = 'theader' + (t === selected ? ' sel' : '');
  hd.style.height = h + 'px';
  const isMain = t.type === 'main', isRet = t.type === 'return';
  const nameBg = t.color;
  const dark = darkOf(nameBg);
  hd.innerHTML = `<div class="bg" style="height:${ch}px" data-info="Volume Section"></div>
    <div class="name" style="height:${ch}px;background:${nameBg};color:${dark}" data-info="Track Title Bar"><i class="fold" data-ic="${pinned || !t.unfolded ? 'hd_foldRet' : 'hd_fold'}"></i><span class="fold-hit" data-info="Unfold Track Button"><i class="fold-hov" data-ic="hd_foldHover"></i></span><span class="tn"></span></div>`;
  // a return's letter and name are placed apart: letter at the name's x, name 10 px further (user's Windows screenshot:
  // "A" and "B" at x 1644, "Reverb" and "Delay" both at 1654)
  if (isRet) { $('.name .tn', hd).innerHTML = '<span></span><span style="position:absolute;left:10px"></span>'; const [l, n] = $('.name .tn', hd).children; l.textContent = t.label; n.textContent = t.name; $('.name .tn', hd).style.left = '23px'; }
  else $('.name .tn', hd).textContent = t.name;
  if (isMain) $('.name .tn', hd).style.left = '25px';
  const vsep = (x, w) => { const s = document.createElement('div'); s.className = 'vsep'; Object.assign(s.style, { left: x + 'px', width: w + 'px', height: ch + 'px' }); hd.append(s); };
  const R = k => 2 + 17 * k;    // control row top
  if (isMain) {
    vsep(95, 5); vsep(174, 2); vsep(289, 3);
    dropdown(hd, 102, R(0), 70, '1/2', 11, 'hd_mainMeterIcon');
    const vol = hctl(hd, 'field', 178, R(0), 46, ''); vol.title = 'Main Volume';
    fieldFill(vol, volFill(t.mixer.volume), 'var(--RangeEditField)', dbText(t.mixer.volume));
    const cue = hctl(hd, 'field', 228, R(0), 46, ''); cue.title = 'Cue Volume';
    fieldFill(cue, volFill(0.5012), 'var(--ChosenPreListen)', '-6.0');
    meter(hd, t, 278, 2, ch - 4, false);
  } else {
    vsep(95, 2); vsep(171, 2);
    const act = hctl(hd, 'act on', 175, R(0), 46, t.label);
    act.title = 'Track Activator'; act.dataset.info = 'Track Activator';
    act.classList.toggle('on', t.mixer.on);
    act.addEventListener('mousedown', e => { e.stopPropagation(); setTitleSel(null); focusControl(act); t.mixer.on = !t.mixer.on; refreshMixer(); });
    const solo = hctl(hd, 'solo' + (t.mixer.solo ? ' on' : ''), 225, R(0), isRet ? 17 : 21, 'S');
    solo.title = 'Solo'; solo.dataset.info = 'Solo/Cue';
    solo.addEventListener('mousedown', e => {
      e.stopPropagation();
      setTitleSel(null);   // Solo / Track Activator clear the title selection, the track stays selected (running Live)
      focusControl(solo);
      const was = t.mixer.solo;
      if (!(e.ctrlKey || e.metaKey)) for (const o of allTracks()) o.mixer.solo = false;
      t.mixer.solo = !was;
      refreshMixer();
    });
    if (isRet) {
      hctl(hd, 'flat', 99, R(0), 70, null);
      hctl(hd, 'on', 246, R(0), 25, 'Post').title = 'Pre/Post';
      meter(hd, t, 275, 2, ch - 4, false);
    } else {
      const audio = t.type === 'audio' || t.type === 'group';
      if (t.type === 'midi' || t.type === 'audio') { const a = hctl(hd, '', 250, R(0), 21, null); a.title = 'Arm Recording'; a.dataset.info = 'Arm Recording'; a.dataset.ic = t.type === 'midi' ? 'hd_armMidi' : 'hd_armAudio'; }
      const rowsFit = t.unfolded ? Math.floor((ch - 2 + 4) / 17) : 0;
      // In/Out section (a folded track shows an empty box, as in Live 12's manual, "Track Controls")
      if (!t.unfolded) hctl(hd, 'flat', 99, R(0), 70, null);
      if (rowsFit >= 1) dropdown(hd, 99, R(0), 70, t.type === 'midi' ? 'All Ins' : t.type === 'group' ? '' : 'Ext. In', 2);
      if (rowsFit >= 2 && t.type !== 'group') dropdown(hd, 99, R(1), 70, t.type === 'midi' ? 'All Channels' : String(1 + (Number(t.label) + 1) % 2), 11, t.type === 'midi' ? 'hd_chanMeter' : 'hd_inMeterEmpty');
      if (rowsFit >= 3) {
        const mon = t.type === 'midi' ? 1 : 2;
        for (const [k, x, w, l] of [[0, 99, 17, 'In'], [1, 119, 27, 'Auto'], [2, 149, 20, 'Off']]) hctl(hd, mon === k ? 'on' : '', x, R(2), w, l).dataset.info = 'Monitoring';
      }
      if (rowsFit >= 4) dropdown(hd, 99, R(3), 70, t.type === 'midi' && !t.devices.length ? 'No Output' : 'Main', 2);
      if (rowsFit >= 5) hctl(hd, 'flat', 99, R(4), 70, null).style.background = 'transparent';
      // mixer
      if (audio && rowsFit >= 2) {
        const vol = hctl(hd, 'field', 175, R(1), 46, ''); vol.title = 'Track Volume';
        fieldFill(vol, volFill(t.mixer.volume), 'var(--RangeEditField)', dbText(t.mixer.volume));
        hctl(hd, 'field', 225, R(1), 46, panText(t.mixer.pan)).title = 'Track Panning';
      }
      if (audio && rowsFit >= 3) t.mixer.sends.slice(0, 2).forEach((v, i) => hctl(hd, 'field', 175 + 33 * i, R(2), 30, dbText(v, '−∞')).title = 'Send');
      if (audio || t.type === 'group') meter(hd, t, 275, 2, ch - 4, true);
      else if (t.unfolded) midiMeter(hd, ch);
      else foldedMidiMeter(hd, ch);
    }
  }
  hd._t = t;
  hd.addEventListener('mousedown', e => {
    // the fold button: the 13 px circle at the left of the title bar
    const nr = $('.name', hd).getBoundingClientRect();
    if (!pinned && e.clientX - nr.left < 18 && e.clientY - nr.top < 17) {
      const to = !t.unfolded;
      // "unfold all of your tracks at once by holding down the Alt modifier when clicking the button" (manual)
      for (const o of e.altKey ? set.tracks : [t]) o.unfolded = to;
      buildRows(); return;
    }
    select(t);
    // clicking the title bar itself selects the title: SelectionBackground while the Arrangement has focus (Live 12)
    if (e.target.closest('.name')) setTitleSel(t);
  });
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
// Folded MIDI track meter: four 3 px dots, traced from Live 12 (folded "2 MIDI" track)
function foldedMidiMeter(hd, ch) {
  const i = document.createElement('i'); i.dataset.ic = 'hd_midiFolded'; i.style.left = '0'; i.style.color = 'var(--MeterBackground)'; hd.append(i);
}
function midiMeter(hd, ch) {
  const n = Math.floor((ch - 5) / 8);
  for (let k = 0; k < n; k++) { const i = document.createElement('i'); i.dataset.ic = 'hd_midiDot'; Object.assign(i.style, { left: '274px', top: (5 + 8 * k) + 'px', color: 'var(--MeterBackground)' }); hd.append(i); }
}

let titleSel = null;
function setTitleSel(t) {
  titleSel = t;
  document.querySelectorAll('.theader').forEach(x => x.classList.toggle('tsel', !!t && x._t === t));
}
function allTracks() { return [...set.tracks, ...set.returns, set.main]; }

function select(t) {
  selected = t;
  document.querySelectorAll('.theader').forEach(x => x.classList.toggle('sel', x._t === t));
  const stName = t ? (t.type === 'main' ? t.name : (t.effName || (t.type === 'return' ? t.label + '-' + t.name : t.name)).replace(/ /g, '-')) : '';
  $('#status-track').textContent = stName;
  // Live sizes this box to the name: text area = text width + 13 px, right edge fixed, the Arrangement position field and the
  // message field move with it (running Live: "1-MIDI" 45 px, "A-Reverb" 58 px; "4-Audio" 49 px, 2 px less than this
  // rule gives - Live's own glyph advances/kerning differ slightly from the browser's)
  layoutStatusBar(stName);
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

// Live scrolls by whole pixels: a time's x is round(t / beats-per-px) (0x140e81590) minus an integer content offset
// (LArrangerScrollable's view position), so positions are rounded in content space, then shifted.
const scrollPx = () => Math.round(view.beat0 * view.ppb);
const xOf = b => b * view.ppb - scrollPx();
const bOf = x => (x + scrollPx()) / view.ppb;
const beatsPerBar = () => set ? set.sig.num * 4 / set.sig.den : 4;

// The Arrangement's time range, from Live 12.0's exe (addresses in "Ableton Live 12 Suite.exe", image base 0x140000000).
// ASongArrangerMediator (vtable 0x145cb9570) gives the range the Arrangement and the Overview map: start = 0
// (slot 9, 0x143b542a0) and end = max(S, visible end) (slot 6, 0x143b541b0), where visible end = the time at the
// last visible pixel ([LArrangerScrollable+0x140], written by 0x1437fe820) and S = the transport's extent
// (ATransport+0x200). 0x142f93db0 updates S: cand = clamp(songEnd + 32, 232, 15768000) (constants 0x145e953e0,
// 0x145e956b8, 0x145e95d00), adopted only if cand <= S - 32 or cand >= S + 16 (0x145e952c8).
// songEnd (0x142f90740) = max(arrangement content end ([ATransport+0x978]), current song time (ACurrentTime),
// loop end, end of the time selection (ATimeSelection; the insert marker is a selection of length 0),
// [LCuePointManager+0x110]). Values read in the running Live (empty Set, playhead 113.04, loop 8..24, insert 109):
// S = 232, content end 0, so S = the 232 floor.
const EXT_MIN = 232, EXT_PAD = 32, EXT_SHRINK = 32, EXT_GROW = 16, EXT_MAX = 15768000;
function songEnd() {
  let e = 0;
  for (const t of [...set.tracks, ...set.returns]) for (const c of [...t.clips, ...t.freezeClips]) e = Math.max(e, c.end);
  for (const l of set.locators) e = Math.max(e, l.time);   // cue points: [LCuePointManager+0x110] (see notes)
  return Math.max(e, engine.playing ? engine.beatNow() : view.insert, set.loop.start + set.loop.length, view.insert);
}
function updateExtent() {
  const c = clamp(songEnd() + EXT_PAD, EXT_MIN, EXT_MAX);
  if (view.ext == null || c <= view.ext - EXT_SHRINK || c >= view.ext + EXT_GROW) view.ext = c;
}
const rangeEnd = () => Math.max(view.ext ?? EXT_MIN, bOf(lanesWidth() - 1));
// Zoom limits. 0x1437ff9b0 (LArrangerScrollable slot 180) sets the content width to clamp(viewport width x factor,
// viewport width, 1073740823 px) (constant 0x145e95e60), and LBeatTimeViewPosConverter::setWidth (0x1431f78d0)
// maps the range onto it: beats per pixel = range / (width - 1). So fully zoomed out the whole range fills the
// lanes, and the deepest zoom puts the range on 1073740823 px.
const ZOOM_MAX_W = 1073740823;
function setZoom(ppb, anchorX, anchorB) {
  const vw = lanesWidth(), r = rangeEnd(), b = anchorB ?? bOf(anchorX);
  // the content width is a whole number of pixels (0x1437ff9b0 truncates it after rounding) and beats per pixel follow
  // from it, so zoom steps land on (width - 1) / range exactly as in Live
  const w0 = view.ppb * r + 1, w = clamp(Math.round(w0 * ppb / view.ppb), vw, ZOOM_MAX_W);
  view.ppb = (w - 1) / r;
  view.beat0 = b - anchorX / view.ppb;
  view.range = r;
  clampScroll();
}
// The scroll offset is clamped to the content (0x1437ff5e0): content left edge <= 0 <= content right edge - viewport,
// i.e. 0 <= beat0 <= range - (viewport - 1) / ppb. (Checked in Live: dragging the ruler right stops with beat 232,
// the end of S, at the right edge.) The range is the one the content width was last set from (at the last zoom),
// or S if that has grown since; how Live resizes the content when S changes between zooms is not traced.
function clampScroll() {
  const r = Math.max(view.ext ?? EXT_MIN, view.range ?? 0);
  view.beat0 = clamp(view.beat0, 0, Math.max(0, r - (lanesWidth() - 1) / view.ppb));
}

// Grid, tiles and ruler ticks, from Live 12.0's exe (the Arrangement's beat-time grid and ruler).
const beatLen = () => 4 / (set ? set.sig.den : 4);
// The adaptive grid: ABeatGrid with an AFlexibleBeatGridState (vtable 0x145ae5450). Its value is a note fraction
// num/den (den > 1) or num bars (den = 1); the step in beats is num x bar or 4 x num / den (0x1430e0520, triplets
// off). Every zoom change runs slot 13 (0x1431dc510) with min = [ABeatGrid+0xb8] x beats per pixel, and
// [ABeatGrid+0xb8] = 20 px (read in the running Live: the Options menu's grid width, Medium = sqrt(8 x Widest) by
// the menu code 0x1446818d0; Narrowest = 8):
//   coarser while step < min / sqrt 2 (0x145e94b40) and the coarser step < half the visible span ([+0xa0],
//   0x1430e0480; 0.5 = 0x145e94a00), up to 512 bars; coarser of (n, 1) is (2n, 1), of (n, d) is (n, d / 2);
//   finer while step > min x sqrt 2 (0x145e94e20) and the finer step > 8 px (0x1430e03b0, 8 = 0x145e951b8);
//   finer of (1, d) is (1, 2d), of (n, d) is (n / 2, d), and (1, > 0x4000) becomes (1, 0x8000) (0x145ae57a0),
//   which means no grid (0x1430df0b0 returns step 0) and is accepted without the 8 px test.
// Slot 13 runs on zoom changes, so this does too (not on every frame). So the step stays between 14.1 and 28.3 px, and as the bounds are inclusive and the ladder doubles, the history
// only matters where the ladder does not double (odd meters, half note -> bar). The value a Set starts with is not
// traced; (1, 1) is used.
const GRID_PX = 20, SQRT2 = Math.SQRT2;
const GRID_OFF = 0x8000;
const gridStepOf = v => v[0] === 1 && v[1] === GRID_OFF ? 0 : v[1] === 1 ? v[0] * beatsPerBar() : 4 * v[0] / v[1];
const gridCoarser = v => v[0] === 1 && v[1] === GRID_OFF ? [1, 0x4000] : v[1] === 1 ? [v[0] * 2, 1] : [v[0], v[1] / 2];
const gridFiner = v => { const f = v[0] === 1 ? [1, v[1] * 2] : [v[0] / 2, v[1]]; return f[0] === 1 && f[1] > 0x4000 ? [1, GRID_OFF] : f; };
function updateGrid() {
  const tpp = 1 / view.ppb, min = GRID_PX * tpp, span = lanesWidth() * tpp;
  let v = view.grid || [1, 1];
  if (gridStepOf(v) < min) {
    while (v[0] !== 512 && gridStepOf(v) < min / SQRT2 && 0.5 * span > gridStepOf(gridCoarser(v))) v = gridCoarser(v);
  } else {
    while (!(v[0] === 1 && v[1] === GRID_OFF) && gridStepOf(v) > min * SQRT2) {
      const f = gridFiner(v);
      if (!(f[1] === GRID_OFF || gridStepOf(f) > 8 * tpp)) break;
      v = f;
    }
  }
  view.grid = v;
}
// step in beats; 0 = no grid
function gridStep() {
  const key = view.ppb + '/' + lanesWidth() + '/' + beatsPerBar();
  if (view.gridKey !== key) { view.gridKey = key; updateGrid(); }
  return gridStepOf(view.grid);
}
// Tiles (the alternating lane shading), 0x14466f960: one beat if a beat is >= 80 px (0x145e955a8), else the bar
// times the first power of 4 that is >= 80 px; every other tile, from bar 1, is shaded.
const TILE_PX = 80;
function tileBeats() {
  const bpb = beatsPerBar(), beat = beatLen(), ppb = view.ppb;
  if (beat >= TILE_PX / ppb) return beat;
  let t = bpb;
  while (t * ppb < TILE_PX) t *= 4;
  return t;
}
// Beat-time ruler (ABeatTimeRulerView, vtable 0x145e7f6c8, draw 0x144683c90). Tick step from 0x1446a8970 with
// min = 20 px (0x145e95318): beat >= min: the beat halved while still >= min (out = max(2, num), 2 or 4 ticks per
// group as the step is the beat, half or less); bar < min: bar doubled until >= min (out 2); otherwise the bar
// divided by its largest proper divisor r (from num / 2 down to 2, num > 3) with bar / r > min (out = r), else the
// bar (out 2). Every out-th tick is a long one (0x144684060), and labels go on every L-th tick, L = max(int(0.25 /
// step), out) (0.25 = 0x145e946f8), counted from bar 1 - so labels are >= 40 px apart and never finer than 1/16.
function rulerTicks() {
  const num = set ? set.sig.num : 4, beat = beatLen(), bar = beatsPerBar(), min = 20 / view.ppb;
  let step, out = 2;
  if (min > beat) {
    if (min >= bar) { step = bar; while (min > step) step *= 2; }
    else {
      step = bar;
      if (num > 3) for (let r = Math.floor(num / 2); r >= 2; r--) if (num % r === 0 && min < bar / r) { step = bar / r; out = r; break; }
    }
  } else {
    step = beat;
    while (min <= step / 2) step /= 2;
    out = step === beat ? Math.max(2, num) : step === beat / 2 ? 2 : 4;
  }
  return { step, out, label: Math.max(Math.trunc(0.25 / step), out) };
}
// "5", "5.2" or "5.2.3" (bar.beat.sixteenth), as Live labels its beat-time ruler
function rulerLabel(b) {
  const bpb = beatsPerBar(), beat = beatLen();
  const bar = Math.floor(b / bpb + 1e-9), inBar = b - bar * bpb;
  const bt = Math.floor(inBar / beat + 1e-9), six = Math.round((inBar - bt * beat) / (beat / 4));
  if (bt === 0 && six === 0) return String(bar + 1);
  if (six === 0) return `${bar + 1}.${bt + 1}`;
  return `${bar + 1}.${bt + 1}.${six + 1}`;
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
  if (g > 0) for (let b = Math.floor(view.beat0 / g) * g; b < b1; b += g) {
    const x = Math.round(xOf(b));
    if (x < 0) continue;
    const k = Math.floor(b / block + 1e-9);
    ctx.fillStyle = gridLine(sel, ((k % 2) + 2) % 2 === 0, gridLevel(b));
    ctx.fillRect(x, y, 1, h);
  }
}
// grid lines inside a clip body, measured in Live 12: bar lines are the clip colour x0.675, others x0.784
function drawGrid(ctx, w, y, h, col) {
  const bpb = beatsPerBar(), g = gridStep(), b1 = bOf(w);
  const bar = shade(col, 0.675), sub = shade(col, 0.784);
  if (g > 0) for (let b = Math.floor(view.beat0 / g) * g; b < b1; b += g) {
    const x = Math.round(xOf(b));
    if (x < 0) continue;
    const isBar = Math.abs(b / bpb - Math.round(b / bpb)) < 1e-6;
    ctx.fillStyle = isBar ? bar : sub;
    ctx.fillRect(x, y, 1, h);
  }
}

let cursorAt = null;
function drawLanes(ctx, list, scrollTop, viewH, pinned) {
  const w = lanesWidth();
  if (!pinned) cursorAt = null;
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
    if (t === selected && !engine.playing && !pinned) cursorAt = { x: Math.round(xOf(view.insert)), y, h };
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
    drawGrid(ctx, w, bodyY, bodyH, col);
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
  // Live 12 draws only the clip's start edge (1 px, clip colour x0.53), no end edge (measured)
  if (x0 >= -1 && x0 <= w) ctx.fillRect(Math.round(x0), y, 1, h);
}
const shade = (hex, f) => { const n = parseInt(hex.slice(1, 7), 16); const c = v => Math.round(Math.min(255, v * f)).toString(16).padStart(2, '0'); return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255); };

function drawNotes(ctx, c, x0, x1, y, h, w) {
  if (!c.notes.length || h < 2) return;
  const lo = c.lo - 1, hi = c.hi + 1, range = hi - lo + 1;
  const rowH = h / range, nh = clamp(rowH > 3 ? rowH - 1 : rowH, 1, 8);
  const len = c.end - c.start;
  // MIDI notes: #181818 at 94% opacity over the clip colour (measured in Live 12: #182621 on #25ffa8)
  ctx.fillStyle = 'rgba(24,24,24,0.94)';
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
  // ticks (rulerTicks): long ones 6 px high, short ones 1 px at the bottom (0x144684060 draws them from y [+0x138]
  // = 17 to [+0x13c] = 11 or [+0x144] = 16 of the 17 px ruler, read in the running Live); a labelled tick also gets
  // a dot right of its top and the label text
  const { step, out, label } = rulerTicks();
  ctx.font = FONT; ctx.textBaseline = 'alphabetic';
  for (let i = Math.floor(view.beat0 / step + 1e-9); i * step <= bOf(w); i++) {
    const b = i * step, x = Math.round(xOf(b));
    ctx.fillStyle = T.RangeDisabledOff;
    if (i % out) { ctx.fillRect(x, 21, 1, 1); continue; }
    ctx.fillRect(x, 16, 1, 6);
    if (i % label) continue;
    ctx.fillRect(x + 1, 16, 1, 1);
    ctx.fillStyle = C.ruler;
    ctx.fillText(rulerLabel(b), x + 5, 20);
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
  if (g > 0) for (let b = Math.ceil(view.beat0 / g) * g; b < bOf(w); b += g) ctx.fillRect(Math.round(xOf(b)), 0, 1, 2);
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
// Beats the Overview spans: AAllTracksOverview (0x143add010) takes the mediator's range end (vslot 0x30 =
// ASongArrangerMediator slot 6, see rangeEnd) as its span from 0 and its own width / span as px per beat.
function overviewSpan() { return set ? rangeEnd() : 16; }
function drawOverview() {
  const W = $('#arrangement').clientWidth, ctx = ovCanvas.getContext('2d');
  const F = T.MainViewFocusIndicator;
  ctx.clearRect(0, 0, W, 14);
  OV_ROWS.forEach((v, y) => { ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(1, y, W - 2, 1); });
  const span = overviewSpan(), sx = b => b / span * (W - 2);
  if (set) {
    const all = set.tracks.filter(isVisible);
    all.forEach((t, i) => {
      const y0 = 1 + Math.floor(i * 10 / all.length), y1 = 1 + Math.floor((i + 1) * 10 / all.length);
      for (const c of t.clips) { ctx.fillStyle = c.color; ctx.fillRect(1 + sx(c.start), y0, Math.max(1, sx(c.end - c.start)), Math.max(1, y1 - y0)); }
    });
  }
  const px = (x, y, v) => { ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 1, 1); };
  const fx0 = Math.round(1 + sx(view.beat0)) - 1, fx1 = Math.round(1 + sx(bOf(lanesWidth())));
  if (fx0 <= 0 && fx1 >= W - 1) {
    // the frame fills the strip (as in the reference screenshot of a new Set)
    ctx.fillStyle = F;
    ctx.fillRect(0, 0, 1, 14); ctx.fillRect(W - 1, 0, 1, 14); ctx.fillRect(0, 12, W, 2);
    px(1, 0, 0x61); px(2, 0, 0x3d); px(W - 2, 0, 0x61); px(W - 3, 0, 0x3e);
    px(1, 11, 0x53); px(2, 11, 0x3a); px(W - 2, 11, 0x53); px(W - 3, 11, 0x3a);
    px(0, 13, 0x3d); px(1, 13, 0x60); px(2, 13, 0x6f); px(W - 1, 13, 0x3d); px(W - 2, 13, 0x60); px(W - 3, 13, 0x6f);
    return;
  }
  // a partial frame: 3 px sides and a 2 px bottom in MainViewFocusIndicator, SurfaceArea under the rest
  // (pixel pattern measured in Live 12 with the view zoomed in)
  ctx.fillStyle = C.area; ctx.fillRect(0, 12, W, 2);
  const L = Math.max(0, fx0), R = Math.min(W - 1, fx1);
  ctx.fillStyle = F; ctx.fillRect(L + 2, 12, R - L - 3, 1); ctx.fillRect(L + 5, 13, R - L - 9, 1);
  const side = (x, dir) => {
    const c = (dx, y, v) => px(x + dir * dx, y, v);
    for (let y = 0; y < 12; y++) { c(0, y, 0x75); c(1, y, 0x75); c(2, y, 0x75); }
    c(0, 0, 0x49); c(2, 0, 0x74); c(3, 0, 0x53); c(4, 0, 0x3a);
    c(0, 1, 0x65); c(2, 1, 0x53); c(0, 10, 0x65); c(2, 10, 0x53);
    c(0, 11, 0x49); c(2, 11, 0x74); c(3, 11, 0x53); c(4, 11, 0x3a);
    c(1, 12, 0x4d); c(2, 13, 0x3d); c(3, 13, 0x60); c(4, 13, 0x6f);
  };
  side(L, 1); side(R, -1);
}

let rafPending = false;
function drawAll() {
  if (!set || rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    // The Arrangement starts at bar 1 and ends at the range end (clampScroll, 0x1437ff5e0)
    updateExtent(); clampScroll();
    const tr = $('#tracks'), pn = $('#pinned');
    drawLanes(lanesCanvas.getContext('2d'), rows, tr.scrollTop, tr.clientHeight, false);
    drawLanes(pinCanvas.getContext('2d'), pinnedRows, pn.scrollTop, pn.clientHeight, true);
    drawRuler(); drawSongRuler(); drawOverview();
    // The insert marker's line in the selected track pulses (CSS insert-pulse, 0.6 s each way). From Live's code:
    // 0x144678580 sets a global blink level (ARemoteableInt at [0x147266f90]) to int(255 x w(t)), w = 0x14298c9a0:
    // phase = (t mod 1200 ms) / 1200 (1200 = 0x145e957f8), w = 2 x (phase <= 0.5 ? phase : 1 - phase), a linear
    // triangle; the marker (0x144678cf0) blends two theme colours by level / 255 (1/255 = 0x145e93420). t is Live's
    // global animation clock, so the phase is not tied to the click. The two colours are theme slots 20 and 57
    // ([colours+0x50], [colours+0xe4]); read from the running Live's colour table they are #03c3d5 (RangeDefault's
    // value) and #ffffff. Slot 57's theme name is ambiguous (four keys are white), so white is written literally.
    const cur = $('#insert-cursor');
    if (cursorAt && cursorAt.x >= 0 && cursorAt.x < lanesWidth()) Object.assign(cur.style, { display: 'block', left: cursorAt.x + 'px', top: (61 + cursorAt.y) + 'px', height: cursorAt.h + 'px' });
    else cur.style.display = 'none';
    // grid size indicator in the bottom right corner of the lanes: the grid value (see updateGrid), "1/1" = one bar
    gridStep();
    const gv = view.grid;
    $('#oneone').textContent = gv[1] === GRID_OFF ? '' : gv[1] === 1 ? (gv[0] === 1 ? '1/1' : `${gv[0]} Bars`) : `1/${gv[1] / gv[0]}`;

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
    // (Live's status bar shows nothing while starting playback, so neither do we)
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
    $('#status-text').title = silent.length ? `${silent.length} MIDI track${silent.length === 1 ? ' has' : 's have'} no frozen audio and can't be heard.` : '';
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
    // Follow, from Live 12.0's exe: while playing with Follow on, APlayLine slot 205 (0x143b55910) calls 0x143b55600,
    // which (with the page-mode flag [0x142f8b8c0()+0x360] off, as in the running Live) asks the scroll setter
    // 0x1437fea80 to put the playhead's pixel at int(viewport width x 0.5) (0.5 = 0x145e94a00) with force = 1:
    // a continuous scroll that keeps the playhead centred once it passes the middle (the offset is clamped to the
    // content, so the view stays put near the start and the end; see clampScroll). Traced in the running Live:
    // the setter got the playhead pixel and 0.5 on every play-line update.
    if (follow) {
      const w = lanesWidth();
      view.beat0 = (Math.round(b * view.ppb) - Math.trunc(w * 0.5)) / view.ppb;
      clampScroll();
    }
    drawAll();
  },
  stop(silent) {
    clearInterval(this.timer); this.timer = null;
    for (const n of this.live) { try { n.stop(); } catch (e) {} }
    this.live.clear();
    this.queue = []; this.segs = [];
    // no status message on stop (Live shows none)
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

let ovMoved = false;
function setupInteraction() {
  const tracks = $('#tracks'), pinned = $('#pinned');
  tracks.addEventListener('scroll', drawAll);
  pinned.addEventListener('scroll', drawAll);
  addEventListener('resize', layoutAfterResize);

  const zoomAt = (x, factor) => { x = Math.round(x); setZoom(view.ppb * factor, x, bOf(x)); drawAll(); };
  const onWheel = (e, area) => {
    if (!set) return;
    const rect = area.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Ctrl+wheel: LArrangerScrollable slot 105 (0x143b09990) zooms by pow(1.5, 0.1 x delta) (constants 0x145e94e48,
    // 0x145e94528) through 0x1437fe250, keeping the time under the mouse in place. One wheel notch arrives there as
    // delta 20 (read in the running Live), so x2.25 per notch; a notch is taken as 100 px of browser deltaY.
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(x, Math.pow(1.5, 0.1 * 20 * -e.deltaY / 100)); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      view.beat0 += (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / view.ppb;
      clampScroll();
      drawAll();
    }
  };
  for (const el of [tracks, pinned]) el.addEventListener('wheel', e => { if (e.clientX - el.getBoundingClientRect().left < lanesWidth()) onWheel(e, el); }, { passive: false });
  $('#ruler').addEventListener('wheel', e => onWheel(e, $('#ruler')), { passive: false });
  $('#songruler').addEventListener('wheel', e => onWheel(e, $('#songruler')), { passive: false });

  // Drag zoom/scroll of the beat-time ruler and the Overview: both end in LArrangerScrollable slot 181
  // (0x1437ff6a0, traced in the running Live for both), once per mouse move with that move's (dx, dy) in px:
  // if |dx| > |dy| it scrolls by dx (0x1437ff5e0), otherwise it zooms the content width by (1 + 0.01 x dy)
  // (constant 0x145e940c0; drag down = zoom in) about the anchor time [+0x120], which the press sets to the time
  // under the mouse (0x1437ffc00, mode 2), keeping that time's screen position (0x1437ff9b0).
  const dragDelta = (dx, dy, anchorB) => {
    if (Math.abs(dx) > Math.abs(dy)) { view.beat0 -= dx / view.ppb; clampScroll(); }
    else setZoom(view.ppb * Math.max(0, 1 + 0.01 * dy), Math.round(xOf(anchorB)), anchorB);   // the anchor keeps its whole-pixel x (0x1437ff9b0)
  };
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
      // Live applies the very first move (gdb: the first delta into slot 181 was the 2 px of the first mouse move)
      if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - y0) > 0) moved = true;
      if (!moved) return;
      dragDelta(dx, dy, anchorB);
      lastX = ev.clientX; lastY = ev.clientY;
      drawAll();
    };
    const up = () => {
      ruler.removeEventListener('pointermove', move); ruler.removeEventListener('pointerup', up);
      if (!moved) setInsert(snap(anchorB));
    };
    ruler.addEventListener('pointermove', move); ruler.addEventListener('pointerup', up);
  });
  // "If nothing is selected, double-clicking the beat-time ruler zooms out to show the entire Arrangement" (manual, Layout)
  const zoomAll = () => { view.beat0 = 0; setZoom(Math.min(DEFAULT_PPB, lanesWidth() / (set.end + beatsPerBar())), 0); drawAll(); };
  ruler.addEventListener('dblclick', () => { if (set) zoomAll(); });
  // Overview: "click and drag horizontally to scroll left or right, or click and drag vertically to zoom in or out.
  // To zoom out to the full Arrangement, double-click anywhere within the black outline." (manual, Layout)
  // Time ruler: "You can click and drag in the time ruler to scroll left or right." (manual, Layout)
  const dragNav = (el, zoom) => el.addEventListener('pointerdown', e => {
    if (!set) return;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, b0 = view.beat0;
    let lastX = x0, lastY = y0;
    // Overview: the press anchors the time under the mouse in the Overview's mapping (seen in Live: x 800 -> beat 68.46
    // of a 232-beat range). Its moves reach slot 181 like the ruler's (see dragDelta) but with dx negated (traced in
    // the running Live: +10 px of mouse -> dx -10, via AXBackgroundView slot 97, 0x142b110d0): the visible range
    // moves with the mouse, 1 lane pixel per mouse pixel.
    const r = el.getBoundingClientRect(), anchorB = zoom ? (x0 - r.left - 1) / (r.width - 2) * overviewSpan() : 0;
    ovMoved = false;
    const move = ev => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 0) ovMoved = true; else return;
      if (zoom) { dragDelta(-(ev.clientX - lastX), ev.clientY - lastY, anchorB); lastX = ev.clientX; lastY = ev.clientY; }
      else { view.beat0 = b0 - (ev.clientX - x0) / view.ppb; clampScroll(); }
      drawAll();
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
  dragNav($('#overview'), true); dragNav($('#song-canvas'), false);
  $('#overview').addEventListener('click', e => {
    if (!set || e.detail > 1 || ovMoved) return;
    const r = $('#overview').getBoundingClientRect(), vis = lanesWidth() / view.ppb;
    view.beat0 = (e.clientX - r.left - 1) / (r.width - 2) * overviewSpan() - vis / 2;
    drawAll();
  });
  $('#overview').addEventListener('dblclick', () => { if (set) zoomAll(); });
  const laneClick = (e, area, list) => {
    if (!set) return;
    const rect = area.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top + area.scrollTop;
    if (x > lanesWidth()) return;
    // below the last track Live selects the last track (seen in the running Live: a click in the empty area selected
    // 4 Audio and set the insert marker there)
    const r = list.find(r => y >= r.y && y < r.y + r.h) || (list.length && y >= list[list.length - 1].y ? list[list.length - 1] : null);
    if (r) select(r.track);
    setInsert(snap(bOf(x), e.altKey));
  };
  tracks.addEventListener('mousedown', e => {
    // [Ctrl + Alt + Drag] Scroll Display (Live 12 Info View, Main Lane)
    if (e.ctrlKey && e.altKey && !e.target.closest('.theader')) {
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, b0 = view.beat0, s0 = tracks.scrollTop;
      const mv = ev => { view.beat0 = b0 - (ev.clientX - x0) / view.ppb; tracks.scrollTop = s0 - (ev.clientY - y0); drawAll(); };
      const upf = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', upf); };
      addEventListener('mousemove', mv); addEventListener('mouseup', upf);
      return;
    }
    if (!e.target.closest('.theader')) setTitleSel(null);
    laneClick(e, tracks, rows);
  });
  pinned.addEventListener('mousedown', e => laneClick(e, pinned, pinnedRows));

  // Live's transport reacts on mouse down
  $('#cb-play').addEventListener('mousedown', () => { if (set) engine.play(view.insert); });
  $('#cb-stop').addEventListener('mousedown', () => { if (set) engine.stop(); });
  // "To return the insert marker to the starting play position, you can double-click the Stop button or press the Home key"
  // (Live 12 manual, Arrangement View > Arrangement Playback)
  $('#cb-stop').addEventListener('dblclick', () => { if (set) setInsert(0); });
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
    // Live 12 manual, Keyboard Shortcuts: + / - zoom, S solo, 0 deactivate, U fold/unfold, F1-F8 Track Activators.
    // Zoom keys: LArrangerView slot 210 (0x143ac5990) -> 0x1437fe1c0 with 1.6 / 0.625 (0x145e94e70 / 0x145e94ad0).
    // 0x1437fe1c0 asks slot 187 (0x143b0aa00) for an anchor: while Follow is scrolling playback that is the play
    // line; otherwise 0x1437fe2e0 zooms about the lanes' centre and then puts a visible time selection back where
    // it was on screen - for the insert marker (a selection of length 0, 0x1437fe479) its start keeps its x.
    // (Seen in Live: with the insert marker at 1.1.1 on screen, + keeps bar 1 at the left edge.)
    const zoomKey = f => {
      const w = lanesWidth(), xi = Math.round(xOf(view.insert));
      if (engine.playing && follow) setZoom(view.ppb * f, Math.round(xOf(engine.beatNow())), engine.beatNow());
      else if (xi >= 0 && xi <= w) setZoom(view.ppb * f, xi, view.insert);
      else setZoom(view.ppb * f, Math.trunc(w / 2));
      drawAll();
    };
    if (e.key === '+' || e.key === '=') zoomKey(1.6);
    if (e.key === '-') zoomKey(0.625);
    if (selected && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key === 's' || e.key === 'S') { const was = selected.mixer.solo; for (const o of allTracks()) o.mixer.solo = false; selected.mixer.solo = !was; refreshMixer(); }
      if (e.key === '0') { selected.mixer.on = !selected.mixer.on; refreshMixer(); }
      if ((e.key === 'u' || e.key === 'U') && selected.type !== 'return' && selected.type !== 'main') { selected.unfolded = !selected.unfolded; buildRows(); }
    }
    const fk = /^F([1-8])$/.exec(e.key);
    if (fk) { e.preventDefault(); const t = set.tracks.filter(isVisible)[Number(fk[1]) - 1]; if (t) { t.mixer.on = !t.mixer.on; refreshMixer(); } }
    // Live's shortcuts (Live 12 manual): Ctrl Alt 5 = browser, ? = Info View
    if (e.ctrlKey && e.altKey && e.key === '5') { e.preventDefault(); togglePanel('no-browser'); }
    if (e.key === '?') togglePanel('no-info');
  });
}
// ---------------------------------------------------------------------------
// Panels: show/hide toggles and drag-to-resize splitters

function togglePanel(cls, force) {
  const app = $('#app');
  app.classList.toggle(cls, force);
  const on = c => !app.classList.contains(c);
  // ViewControlOn when the view is shown, ViewControlOff when hidden (press screenshots 3 and 5)
  $('#cb-browser').style.color = on('no-browser') ? 'var(--ViewControlOn)' : 'var(--ViewControlOff)';
  $('#st-info').style.color = on('no-info') ? 'var(--ViewControlOn)' : 'var(--ViewControlOff)';
  $('#status-trk').classList.toggle('closed', !on('no-detail'));
  layoutAfterResize();
}
// Browser / sidebar limits measured by dragging the splitters of the real Live 12 (1920 px wide window):
//   the Arrangement border sits at --bw + 16 (pixel-identical to Live at the same width);
//   narrowest open browser: border x = 143  ->  --bw 127;
//   a drag asking for a border left of x = 68 (--bw < 52) closes the browser (and greys its toggle);
//   widest: border x = 1578 at 1920 px, i.e. --bw = window width - 358; when the window shrinks Live
//   narrows the browser to keep this, so the lanes never collapse;
//   sidebar divider: sidebar >= 27 px, and >= 100 px left for the browser's content column.
const BW_MIN = 127, BW_CLOSE = 52, BW_RIGHT = 358, SBW_MIN = 27, SBW_RIGHT = 100;
function clampPanels() {
  const app = $('#app'), px = v => parseFloat(getComputedStyle(app).getPropertyValue(v));
  const bwMax = Math.max(BW_MIN, app.clientWidth - BW_RIGHT);
  const bw = clamp(px('--bw'), BW_MIN, bwMax);
  if (bw !== px('--bw')) app.style.setProperty('--bw', bw + 'px');
  const sbw = clamp(px('--sbw'), SBW_MIN, bw - SBW_RIGHT);
  if (sbw !== px('--sbw')) app.style.setProperty('--sbw', sbw + 'px');
}
// When the lanes get wider Live keeps the scroll position and zoom: the range end follows the new visible end
// (ASongArrangerMediator slot 6 = max(S, visible end)), so nothing is clamped (running Live: hiding the browser kept bar 6
// at the left edge)
function layoutAfterResize() { clampPanels(); if (set) { layoutCanvases(); view.range = Math.max(view.range ?? 0, bOf(lanesWidth() - 1)); drawAll(); } }
function focusPanel(id) {
  for (const p of ['browser', 'arrangement', 'detail']) $('#' + p).classList.toggle('focused', p === id);
}
function setupPanels() {
  for (const p of ['browser', 'arrangement', 'detail']) $('#' + p).addEventListener('mousedown', () => focusPanel(p), true);
  document.addEventListener('mousedown', e => { if (!e.target.closest('.btn')) focusControl(null); }, true);
  $('#cb-browser').addEventListener('mousedown', () => togglePanel('no-browser'));
  $('#st-info').addEventListener('mousedown', () => togglePanel('no-info'));
  $('#status-trk .up').addEventListener('mousedown', () => togglePanel('no-detail'));
  $('#br-ftoggle').addEventListener('mousedown', () => $('#browser').classList.toggle('filters-hidden'));
  const app = $('#app');
  const px = v => parseFloat(getComputedStyle(app).getPropertyValue(v));
  const drag = (el, axis, begin, set) => el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const start = axis === 'x' ? e.clientX : e.clientY, b0 = begin(start);
    const move = ev => { set(b0, (axis === 'x' ? ev.clientX : ev.clientY) - start); layoutAfterResize(); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
  // Limits are not documented by Ableton; these only stop a panel collapsing to nothing or pushing others off screen.
  // From a closed browser the drag starts at the Arrangement's left edge (Live: grab x 8 -> border follows the pointer).
  drag($('#grip-browser'), 'x', start => app.classList.contains('no-browser') ? start - 14 : px('--bw'), (b, d) => {
    const want = b + d;
    if (want < BW_CLOSE) { if (!app.classList.contains('no-browser')) togglePanel('no-browser', true); return; }
    app.style.setProperty('--bw', want + 'px');
    if (app.classList.contains('no-browser')) togglePanel('no-browser', false);
  });
  drag($('#grip-sidebar'), 'x', () => px('--sbw'), (b, d) => app.style.setProperty('--sbw', (b + d) + 'px'));
  if ('ResizeObserver' in window) new ResizeObserver(layoutAfterResize).observe($('#arrangement'));
}

// "the cursor will snap to grid lines that represent the meter subdivisions"; Alt bypasses snapping (manual, Using the Editing Grid)
// A lane click goes LArrangerScrollable slot 95 (0x143b0a600) -> 0x143b516f0 -> TTimeline snapping (0x14302ce80,
// 0x14302d280) with the adaptive grid. Read in the running Live at 1/128 grid (0.03125 beats): 1.1094 -> 1.125,
// 1.1193 -> 1.125, 1.1357 -> 1.125, i.e. the nearest grid line. Snapping to clip edges (0x14302d280 also weighs an
// object snap, within 5 px, 0x145e950f8) is not modelled.
function snap(b, free) {
  if (free) return Math.max(0, b);
  const g = gridStep();
  return g > 0 ? Math.max(0, Math.round(b / g) * g) : Math.max(0, b);
}
// re-draw the Track Activator / Solo switches after a keyboard change
function refreshMixer() { refreshMixerClasses(); engine.updateMix(); }
// soloing a track greys the other tracks' Track Activators (ControlDisabled #757575 in the running Live), also after the
// headers are rebuilt (fold/unfold)
function refreshMixerClasses() {
  const soloing = allTracks().some(t => t.mixer.solo);
  document.querySelectorAll('.theader').forEach(x => {
    if (!x._t) return;
    x.querySelector('.solo')?.classList.toggle('on', x._t.mixer.solo);
    const a = x.querySelector('.act');
    if (a) { a.classList.toggle('on', x._t.mixer.on); a.classList.toggle('implicit', soloing && x._t.mixer.on && !x._t.mixer.solo && x._t.type !== 'return'); }
  });
}
// The 1 px ControlSelectionFrame ring Live draws around the last pressed header control (measured in Live 12)
function focusControl(el) {
  document.querySelectorAll('.btn.focus').forEach(b => b !== el && b.classList.remove('focus'));
  if (el) el.classList.add('focus');
}
function setInsert(b) {
  view.insert = b;
  showPos('cb-pos', fmtPos(b));
  // Live's status bar after placing the insert marker, e.g. "Insert Mark 39.1.1 (Time: 1:16)" (seen in the running Live,
  // on the Alert colour)
  const sec = Math.floor(tempoMap.sec(b) + 1e-6);
  status(`Insert Mark ${fmtPos(b).join('.')} (Time: ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')})`, true);
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
    <div class="drop" id="drop">Drop a zipped Live Project folder here<br><span class="btn2" id="choose">Choose .zip…</span></div>
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
  view.beat0 = 0; view.ext = null; view.range = null; view.grid = null; view.gridKey = null; updateExtent();
  view.ppb = Math.min(DEFAULT_PPB, lanesWidth() / (set.end + beatsPerBar()));
  setZoom(view.ppb, 0);
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
setupPanels();
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && /\.zip$/i.test(f.name)) loadFile(f); });

// Canvas text (rulers, labels) uses Live's web fonts, which a canvas cannot wait for on its own: Safari in
// particular draws with a fallback serif if they are not loaded yet. Load them before the first draw and
// redraw whenever any font finishes loading.
const fontsReady = Promise.all([FONT, 'bold ' + FONT, '9px "Ableton Sans Small 9"', '18px "Ableton Sans Light"']
  .map(f => document.fonts.load(f).catch(() => {})));
document.fonts.addEventListener?.('loadingdone', () => { if (set) drawAll(); });
fontsReady.then(() => { if (set) { layoutCanvases(); drawAll(); } });

(async () => {
  await fontsReady;
  status('');
  let manifest = null;
  try { const r = await fetch('projects/manifest.json', { cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch (e) {}
  const list = manifest?.projects || [];
  const want = new URLSearchParams(location.search).get('project');
  const pick = list.find(p => p.name === want) || (list.length === 1 ? list[0] : null);
  if (pick) {
    try { await loadUrl(pick.parts || [pick.file], pick.name); } catch (e) { openDialog(`<span class="err">${String(e.message || e)}</span>`); }
  } else if (list.length > 1) {
    dialog(`<h1>Ableton Live 12</h1><p>Choose a project</p><div class="list"></div><p><span class="btn2" id="choose2">Open a .zip…</span></p>`);
    for (const p of list) {
      const d = document.createElement('div'); d.textContent = p.name;
      d.addEventListener('click', () => loadUrl(p.parts || [p.file], p.name).catch(e => openDialog(`<span class="err">${String(e.message || e)}</span>`)));
      $('#dialog .list').append(d);
    }
    $('#choose2').addEventListener('click', () => $('#file-input').click());
  } else {
    // like Live itself: start with a new, empty Set (File opens a zipped project)
    await loadDefaultSet();
  }
})();

async function loadDefaultSet() {
  try {
    const r = await fetch('projects/Untitled.als');
    if (!r.ok) throw new Error('no default Set');
    const bytes = new Uint8Array(await r.arrayBuffer());
    indexFiles({ 'Untitled.als': bytes });
    set = parseSet(await gunzipText(bytes), 'Untitled.als');
    set.name = 'Untitled';
    tempoMap = new TempoMap(set.tempo, set.tempoEvents, set.end);
    showSet();
    closeDialog();
  } catch (e) { openDialog(); }
}
