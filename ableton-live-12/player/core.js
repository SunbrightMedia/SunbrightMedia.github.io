// Live 12 player: the core (Set parsing, project loading, audio sources, warping, tempo map, playback engine), copied
// unchanged from the Arrangement replica (viewer.js), with its user-interface calls replaced by hooks the player sets.
// hooks.onPlay(), hooks.onStop(beatAtStop), hooks.onPos(beat), hooks.onMeter(track, meterState), hooks.insert() -> beat
const hooks = {};
const PITCH = ['C','C#/D♭','D','D#/E♭','E','F','F#/G♭','G','G#/A♭','A','A#/B♭','B'];
const SCALES = ['Major','Minor','Dorian','Mixolydian','Lydian','Phrygian','Locrian','Whole Tone','Half-whole Dim.','Whole-half Dim.','Minor Blues','Minor Pentatonic','Major Pentatonic','Harmonic Minor','Harmonic Major','Dorian #4','Phrygian Dominant','Melodic Minor','Lydian Augmented','Lydian Dominant','Super Locrian','8-Tone Spanish','Bhairav','Hungarian Minor','Hirajoshi','In-Sen','Iwato','Kumoi','Pelog Selisir','Pelog Tembung','Messiaen 3','Messiaen 4','Messiaen 5','Messiaen 6','Messiaen 7'];
const FOLDED_H = 17, MIN_H = 17, SEP = 2;
let set = null, tempoMap = null;
const PALETTE = ['#FF94A6','#FFA529','#CC9927','#F7F47C','#BFFB00','#1AFF2F','#25FFA8','#5CFFE8','#8BC5FF','#5480E4','#92A7FF','#D86CE4','#E553A0','#FFFFFF','#FF3636','#F66C03','#99724B','#FFF034','#87FF67','#3DC300','#00BFAF','#19E9FF','#10A4EE','#007DC0','#886CE4','#B677C6','#FF39D4','#D0D0D0','#E2675A','#FFA374','#D3AD71','#EDFFAE','#D2E498','#BAD074','#9BC48D','#D4FDE1','#CDF1F8','#B9C1E3','#CDBBE4','#AE98E5','#E5DCE1','#A9A9A9','#C6928B','#B78256','#99836A','#BFBA69','#A6BE00','#7DB04D','#88C2BA','#9BB3C4','#85A5C2','#8393CC','#A595B5','#BF9FBE','#BC7196','#7B7B7B','#AF3333','#A95131','#724F41','#DBC300','#85961F','#539F31','#0A9C8E','#236384','#1A2F96','#2F52A2','#624BAD','#A34BAD','#CC2E6E','#3C3C3C'];
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
// The Device View selector shows a miniature of the track's device chain right of the name (running Live: 53 x 23 px
// for the template's Reverb, 38 x 23 for its Delay, ending at the box's right edge, 2 px above and below the bar).
// Only the captured template devices with their default parameters can be shown.
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

let filesSrc = null;
function indexFiles(out) {
  filesSrc = out;
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
  // the Main track is folded unless its TrackUnfolded says otherwise (the default Set has none: Live shows Main folded)
  set.main.unfolded = val(main, 'TrackUnfolded') === 'true';
  if (!val(main, 'Name', 'EffectiveName')) set.main.name = 'Main';

  // groups
  const byId = new Map(set.tracks.map(t => [t.id, t]));
  for (const t of set.tracks) {
    t.parent = t.groupId >= 0 ? byId.get(String(t.groupId)) || null : null;
    if (t.parent) t.parent.children.push(t);
  }
  for (const t of set.tracks) { let d = 0, p = t.parent; while (p) { d++; p = p.parent; } t.depth = d; }
  // Group nesting widens the track header column by 5 px per level of the Set's deepest track, for every track, return
  // and Main (running Live 12 at 1920 px: titles start at x 1621 with no groups, 1616 with one level, 1611 with two)
  set.nest = 5 * Math.max(0, ...set.tracks.map(t => t.depth));

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
    outTarget: val(kid(chain, 'AudioOutputRouting'), 'Target') || '',
    // Live shows the user's name if there is one, else its own: EffectiveName "1-MIDI" / "A-Reverb" is shown as "1 MIDI"
    // in the header (and "1-MIDI" in the status bar), "A Reverb" for a return (letter + name; seen in the running Live)
    name: displayName(el, type),
    autoName: !val(el, 'Name', 'UserName'),
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
    c.filePath = val(at(el, 'SampleRef', 'FileRef'), 'Path') || '';
    c.warped = val(el, 'IsWarped') !== 'false';
    c.gain = num(el, 'SampleVolume') ?? 1;
    c.markers = kids(el, 'WarpMarkers').map(m => ({ sec: Number(m.getAttribute('SecTime')), beat: Number(m.getAttribute('BeatTime')) })).sort((a, b) => a.beat - b.beat);
  }
  return c;
}

// Live's instrument devices (their Set tags)
const INSTRUMENT_TAGS = new Set(['InstrumentGroupDevice', 'DrumGroupDevice', 'OriginalSimpler', 'MultiSampler', 'UltraAnalog', 'Operator',
  'InstrumentVector', 'LoungeLizard', 'StringStudio', 'Collision', 'InstrumentImpulse', 'Drift', 'InstrumentMeld', 'MxDeviceInstrument']);
// A MIDI track whose chain holds an instrument (or that is frozen: its freeze file is audio) has an audio output; Live's
// Arrangement mixer then shows it a volume and a pan field, the sends and the two-channel level meter, like an audio track
// (running Live, the owner's Set: the five frozen MIDI tracks with VST3 instruments)
function audioOut(t) { return t.type === 'audio' || t.type === 'group' || (t.type === 'midi' && (t.frozen || t.devices.some(d => d.instrument))); }
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
    // a VST3 plug-in's DeviceType: 1 for the instruments in the owner's Set (IconDrum, MODO BASS 2, JUNO-60, Dexed,
    // JUNO-106, TRITON), 2 for its audio effect (ZEKEWARE Chorus)
    dev.instrument = val(info, 'DeviceType') === '1';
    dev.name = dev.name || val(info, 'Name') || val(info, 'PlugName') || 'Plug-in';
    for (const p of kids(el, 'ParameterList')) {
      const pn = val(p, 'ParameterName');
      if (pn) dev.params.push([pn, fmtVal(val(p, 'ParameterValue', 'Manual') ?? '')]);
    }
    return dev;
  }
  dev.instrument = INSTRUMENT_TAGS.has(tag);
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
    kind: 'pcm', sr, ch, frames, bits,
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
const sourceLoads = new Map();   // path -> promise of its source, while it is being read
function getSource(path) {
  if (!path) return Promise.resolve(null);
  if (sources.has(path)) return Promise.resolve(sources.get(path));
  if (!sourceLoads.has(path)) {
    const pr = readSource(path).then(src => { sourceLoads.delete(path); if (src || !pendingFiles.has(path)) sources.set(path, src); return src; });
    sourceLoads.set(path, pr);
  }
  return sourceLoads.get(path);
}
async function readSource(path) {
  let bytes = files.get(path);
  if (!bytes && pendingFiles.has(path)) bytes = await pendingFiles.get(path);   // still downloading: wait for it
  if (!bytes) return null;
  let src = null;
  try { src = parsePCM(bytes); } catch (e) { src = null; }
  if (!src) {
    try {
      decodeCtx ||= new OfflineAudioContext(1, 1, 44100);
      const copy = bytes.slice().buffer;
      const buf = await decodeCtx.decodeAudioData(copy);
      // AAC starts with 1024 samples of encoder priming, which Chromium, Firefox and WebKit drop (the file's edit list;
      // measured: the decoded audio lines up with the original to 1 sample). A decoder that keeps them gives a longer
      // buffer than the original: skip them there.
      const want = expectFrames.get(path);
      const skip = want && buf.length - want >= 1024 ? 1024 : 0;
      const frames = want ? Math.min(want, buf.length - skip) : buf.length;
      src = {
        kind: 'decoded', sr: buf.sampleRate, ch: buf.numberOfChannels, frames,
        read(start, count) {
          start = Math.max(0, Math.floor(start)); count = Math.max(0, Math.min(Math.floor(count), frames - start));
          const out = [];
          for (let c = 0; c < buf.numberOfChannels; c++) out.push(buf.getChannelData(c).slice(skip + start, skip + start + count));
          return out;
        },
      };
    } catch (e) { src = null; }
  }
  return src;
}

// Waveform data: min/max of the samples per block of 2^k frames, per channel (float, as Live keeps them). Level 4
// (16 frames) is computed once per file; coarser levels are pairs of finer ones, finer than 16 frames is read from the
// samples when drawn.
const PEAK_BLOCK = 16;
const peaks = new Map(); // path -> { ch, sr, frames, done, lv: [{ min: Float32Array[], max: Float32Array[] }] (index k - 4) }
async function computePeaks(path) {
  if (peaks.has(path)) return peaks.get(path);
  const src = await getSource(path);
  if (!src) { peaks.set(path, null); return null; }
  const blocks = Math.ceil(src.frames / PEAK_BLOCK), ch = Math.min(src.ch, 2);
  const pk = { ch, sr: src.sr, frames: src.frames, src, done: 0, blocks, lv: [{ min: [], max: [] }] };
  for (let c = 0; c < ch; c++) { pk.lv[0].min.push(new Float32Array(blocks)); pk.lv[0].max.push(new Float32Array(blocks)); }
  peaks.set(path, pk);
  const per = 8192; // blocks per slice, then yield to keep the page responsive
  for (let b0 = 0; b0 < blocks; b0 += per) {
    const nb = Math.min(per, blocks - b0);
    const data = src.read(b0 * PEAK_BLOCK, nb * PEAK_BLOCK);
    for (let c = 0; c < ch; c++) {
      const d = data[Math.min(c, data.length - 1)], mn = pk.lv[0].min[c], mx = pk.lv[0].max[c];
      for (let b = 0; b < nb; b++) {
        let lo = Infinity, hi = -Infinity;
        const e = Math.min(d.length, (b + 1) * PEAK_BLOCK);
        for (let i = b * PEAK_BLOCK; i < e; i++) { const s = d[i]; if (s < lo) lo = s; if (s > hi) hi = s; }
        if (lo > hi) lo = hi = 0;
        mn[b0 + b] = lo; mx[b0 + b] = hi;
      }
    }
    pk.done = b0 + nb; pk.lv.length = 1;   // coarser levels are rebuilt from the new data
    await new Promise(r => setTimeout(r, 0));
  }
  return pk;
}
// min / max of block j at level k (blocks of 2^k frames) for channel c; 0 outside the file
function peakLevel(pk, k) {
  if (k < 4) return null;
  while (pk.lv.length <= k - 4) {
    const p = pk.lv[pk.lv.length - 1], n = Math.ceil(p.min[0].length / 2), q = { min: [], max: [] };
    for (let c = 0; c < pk.ch; c++) {
      const a = p.min[c], b = p.max[c], mn = new Float32Array(n), mx = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        const j2 = 2 * j, has2 = j2 + 1 < a.length;
        mn[j] = has2 ? Math.min(a[j2], a[j2 + 1]) : a[j2]; mx[j] = has2 ? Math.max(b[j2], b[j2 + 1]) : b[j2];
      }
      q.min.push(mn); q.max.push(mx);
    }
    pk.lv.push(q);
  }
  return pk.lv[k - 4];
}
function blockMinMax(pk, k, j, c) {
  const size = 2 ** k, s0 = j * size;
  if (j < 0 || s0 >= pk.frames) return [0, 0];
  if (k >= 4) {
    if (s0 >= pk.done * PEAK_BLOCK) return [0, 0];
    const L = peakLevel(pk, k); return [L.min[c][j], L.max[c][j]];
  }
  const d = pk.src.read(s0, Math.min(size, pk.frames - s0)), ch = d[Math.min(c, d.length - 1)];
  let lo = Infinity, hi = -Infinity;
  for (const s of ch) { if (s < lo) lo = s; if (s > hi) hi = s; }
  return lo > hi ? [0, 0] : [lo, hi];
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

function dbText(v, inf = '-inf') {
  if (v <= 0.000317) return inf;
  const db = 20 * Math.log10(v);
  if (Math.abs(db) < 0.05) return '0';
  return db.toFixed(1);
}
function panText(p) {
  // the pan value is a float in Live (the slider's position -> value is converted to float, 0x142b47440): -0.05 shows "3L"
  const v = Math.round(Math.fround(p) * 50);
  return v === 0 ? 'C' : v < 0 ? `${-v}L` : `${v}R`;
}
// ---- Track volume taper, from Live 12.0's exe ----
// The mixer volume (an ATimeableFloatCurrentValue, vt 0x145afbc50) keeps the gain and shows the slider a position 0..1
// through its ATrackLevelUserFloatConverter (vt 0x145afe8c8, at value +0x88): slot 4 0x14317a870 -> 0x142c096a0 (gain ->
// position), slot 5 0x14317a7f0 -> 0x142c09760 (position -> gain). Both use level table type 1 of Live's global table set
// ([[0x147225e10]+0x460][2]+0x30): the gains at positions 0, 0.01 .. 1, read with gdb from the running Live (-70 dB at 0,
// 0 dB at 0.85, +6 dB at 1; 0.4 dB per 0.01 above -10 dB).
const VOL_T = [0.00031622776,0.00047863042,0.0006781619,0.00089949806,0.0011168642,0.0013803854,0.0016982447,0.002079697,0.0025351304,0.003076098,0.0037153538,0.004466837,0.005345646,0.006367957,0.007550927,0.00891251,0.010471291,0.01224617,0.014256085,0.016519625,0.019054621,0.02187763,0.025003474,0.028444627,0.032210708,0.03630783,0.04073805,0.045498844,0.050582506,0.05597581,0.061659563,0.06760836,0.07379049,0.08016788,0.08669625,0.09332551,0.10000008,0.1066597,0.11324014,0.11967415,0.12589265,0.13182579,0.13803853,0.14454408,0.15135624,0.15848945,0.16595882,0.1737802,0.18197021,0.19054618,0.19952634,0.20892972,0.21877627,0.22908686,0.2398834,0.25118873,0.2630269,0.27542293,0.2884032,0.30199522,0.3162278,0.33113113,0.34673685,0.36307803,0.38018936,0.3981071,0.4168693,0.43651575,0.4570881,0.47863004,0.5011872,0.5248074,0.5495408,0.5754399,0.60255957,0.6309573,0.6606934,0.69183093,0.7244359,0.7585776,0.7943282,0.83176374,0.8709636,0.91201085,0.9549926,1,1.0471284,1.0964781,1.1481535,1.2022643,1.2589253,1.3182566,1.3803842,1.4454397,1.5135611,1.5848931,1.6595868,1.7378008,1.8197008,1.9054607,1.9952624].map(Math.fround);
const f32 = Math.fround;
// 0x142c096a0: the first table entry above the gain (binary search over the 101 entries), linear between it and the one
// before (fraction in float, position in double, returned as float); clamped to 0..1 by the converter
function volToPos(g) {
  g = f32(g);
  let i = 0; while (i < 101 && !(g < VOL_T[i])) i++;
  if (i === 0) return 0;
  if (i === 101) return 1;
  const fr = f32(f32(g - VOL_T[i - 1]) / f32(VOL_T[i] - VOL_T[i - 1]));
  return clamp(f32((fr + (i - 1)) * 0.01), 0, 1);
}
// 0x142c09760: i = trunc(float(p * 100)), f = p * 100 - i in double (0 below 2^-17, 1 from 1 - 2^-17), lerp in double
function posToVol(p) {
  p = f32(p);
  if (!(p > 0)) return VOL_T[0];
  if (!(p < 1)) return VOL_T[100];
  const i = Math.trunc(f32(p * 100));
  let f = p * 100 - i;
  f = f > 7.62939453125e-06 ? (f >= 0.9999923706054688 ? 1 : f) : 0;
  return clamp(f32(VOL_T[i] - VOL_T[i] * f + f * VOL_T[i + 1]), VOL_T[0], VOL_T[100]);
}
// The volume field's fill: round(position x inner width) (Live's pixels at -31.0 / -14.5 / -5.0 / -3.4 / -2.3 dB in the
// owner's Set: 10 / 21 / 32 / 34 / 35 of 44 px; the field's draw case for the fill is not traced)
function volFill(v) { return volToPos(v); }
function quantVol(g) { if (!(g > VOL_T[0])) return VOL_T[0]; return f32(10 ** (Math.round(20 * Math.log10(g) * 10) / 200)); }
const beatsPerBar = () => set ? set.sig.num * 4 / set.sig.den : 4;
function quantBeats(q) {
  let m;
  if (!q || q === 'None') return 0;
  if ((m = /^(\d+) Bars?$/.exec(q))) return +m[1] * beatsPerBar();
  if ((m = /^1\/(\d+)(T?)$/.exec(q))) return 4 / +m[1] * (m[2] ? 2 / 3 : 1);
  return beatsPerBar();
}

// The Arrangement's time range, from Live 12.0's exe (addresses in "Ableton Live 12 Suite.exe", image base 0x140000000).
const beatLen = () => 4 / (set ? set.sig.den : 4);
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
      // a mono clip plays on both channels at full level, as in Live (running Live: a -30 dB mono sine meters -30.0 dB
      // on each side), not through the panner's mono law (-3 dB each side)
      input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
      const vol = this.ctx.createGain();       // track volume × audible
      const pan = this.ctx.createStereoPanner();
      const an = this.ctx.createAnalyser(); an.fftSize = 512;
      const split = this.ctx.createChannelSplitter(2);
      const anL = this.ctx.createAnalyser(), anR = this.ctx.createAnalyser(); anL.fftSize = anR.fftSize = 4096;
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
    this.mainChain();
    for (const [t, n] of this.nodes) {
      const g = t.type === 'main' ? t.mixer.volume : (t.type === 'group' ? (t.mixer.on ? 1 : 0) : (this.audible(t) ? 1 : 0)) * t.mixer.volume;
      n.vol.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
      n.pan.pan.value = clamp(t.mixer.pan, -1, 1);
    }
  },
  // The Main track: its volume is the master gain, then its pan, then the output; its level meter reads that output
  // (after volume and pan, like the tracks' meters), through the same analysers and meter code as the tracks
  mainChain() {
    if (!set || !this.master) return;
    if (!this.main || this.main.master !== this.master) {
      const pan = this.ctx.createStereoPanner(), split = this.ctx.createChannelSplitter(2);
      const anL = this.ctx.createAnalyser(), anR = this.ctx.createAnalyser(); anL.fftSize = anR.fftSize = 4096;
      this.master.disconnect(); this.master.connect(pan); pan.connect(this.ctx.destination);
      pan.connect(split); split.connect(anL, 0); split.connect(anR, 1);
      this.main = { master: this.master, node: { input: this.master, vol: this.master, pan, anL, anR } };
    }
    if (this.nodes.get(set.main) !== this.main.node) { this.nodes.delete(set.main); this.nodes.set(set.main, this.main.node); }
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
    for (const p of need) if (!pendingFiles.has(p)) await getSource(p);   // a project's files still downloading join later (addLate)
    this.playing = true;
    hooks.onPlay && hooks.onPlay();
    this.t0 = this.ctx.currentTime + 0.1;
    this.segs = [];
    this.startBeat = fromBeat;
    this.queue = [];
    this.horizonBeat = fromBeat;
    this.nextSeg();
    this.timer = setInterval(() => this.tick(), 40);
    this.tick();
    this.meters();
  },
  // a segment maps a stretch of real time to a stretch of the arrangement (loops add more segments)
  nextSeg(jumpTo) {
    const last = this.segs[this.segs.length - 1];
    // the loop that applies: the scrub area's held section, else the arrangement loop
    const L = this.scrubLoop || (set.loop.on ? { from: set.loop.start, to: set.loop.start + set.loop.length } : null);
    let b0, ctx0;
    if (jumpTo != null) { b0 = jumpTo; ctx0 = last ? last.ctx1 : this.t0; }
    else if (!last) { b0 = this.startBeat; ctx0 = this.t0; }
    else { if (!L) return null; b0 = L.from; ctx0 = last.ctx1; }
    const b1 = L && b0 < L.to - 1e-9 ? L.to : Math.max(b0, set.end) + 4096;
    const seg = { b0, b1, ctx0, ctx1: ctx0 + (tempoMap.sec(b1) - tempoMap.sec(b0)), scrub: !!this.scrubLoop && L === this.scrubLoop };
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
  // Playback continues at song time `to` from the moment the play line reaches `at` (sample-exact: the current segment
  // ends there, sounds scheduled past it are cut, a new segment starts)
  jump(at, to) {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    let i = this.segs.findIndex(g => now < g.ctx1);
    if (i < 0) i = this.segs.length - 1;
    const seg = this.segs[i];
    let T = at >= seg.b0 - 1e-9 && at <= seg.b1 + 1e-9 ? this.ctxAt(seg, at) : seg.ctx1;
    T = Math.max(T, now + 0.005);
    seg.b1 = Math.min(seg.b1, tempoMap.beat(tempoMap.sec(seg.b0) + (T - seg.ctx0))); seg.ctx1 = T;
    this.segs.length = i + 1;
    for (const n of this.live) { try { n.stop(T); } catch (e) {} }
    this.queue = this.queue.filter(q => q.when < T).map(q => q.when + (q.e - q.s) / q.rate > T ? { ...q, e: q.s + (T - q.when) * q.rate } : q);
    this.nextSeg(to);
    this.tick();
  },
  // The scrub area (running Live 12 with the owner's Set, global quantization 1 Bar): a press when stopped starts playback
  // at the start of the clicked bar; while playing, playback jumps there at the next bar line. Held, that bar repeats
  // (seen: 6.1.1, 5.3.4, 5.3.3 while held at bar 5); on release playback goes on from where it is. The section is the
  // global quantization (set.quant); with None the jump is to the click itself, at once, and nothing repeats (Live's
  // continuous scrubbing then is not modelled).
  scrubPress(beat, q) {
    const target = q > 0 ? Math.floor(beat / q + 1e-9) * q : beat;
    this.scrubLoop = q > 0 ? { from: target, to: target + q } : null;
    if (!this.playing) { this.play(target); return; }
    const now = this.beatNow();
    this.scrubAt = q > 0 ? Math.ceil(now / q - 1e-9) * q : now;
    this.jump(this.scrubAt, target);
  },
  scrubRelease() {
    const s = this.scrubLoop; this.scrubLoop = null;
    if (!s || !this.playing || !this.ctx) return;
    const now = this.ctx.currentTime, cur = this.segs.find(g => now < g.ctx1);
    if (!cur) return;
    if (cur.scrub) this.jump(cur.b1, cur.b1);          // in the repeating bar: go on past it
    else this.jump(this.scrubAt, s.from);               // the jump is still to come: keep it, without the repeat
  },
  // an audio file that arrives while the song plays: its clips join in time, from the current position on (schedule()
  // starts a piece that is already under way at the right point and drops pieces that are over)
  addLate(path, src) {
    if (!this.playing || !src) return;
    for (const seg of this.segs) for (const t of set.tracks) for (const c of this.playClips(t)) {
      if (c.disabled || c.file !== path) continue;
      const a = Math.max(c.start, seg.b0), b = Math.min(c.end, seg.b1);
      if (b > a) this.addPieces(t, c, src, seg, a, b);
    }
    this.queue.sort((x, y) => x.when - y.when);
    this.tick();
  },
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
    if (!this.playing) return hooks.insert ? hooks.insert() : 0;
    const now = this.ctx.currentTime;
    const seg = this.segs.find(s => now >= s.ctx0 && now < s.ctx1) || this.segs[0];
    if (!seg) return this.startBeat;
    if (now < seg.ctx0) return seg.b0;
    return tempoMap.beat(tempoMap.sec(seg.b0) + (now - seg.ctx0));
  },
  updatePos() { hooks.onPos && hooks.onPos(this.beatNow()); },
  stop(silent) {
    clearInterval(this.timer); this.timer = null;
    this.scrubLoop = null;
    for (const n of this.live) { try { n.stop(); } catch (e) {} }
    this.live.clear();
    this.queue = []; this.segs = [];
    const at = this.playing ? this.beatNow() : null;
    this.playing = false;
    hooks.onStop && hooks.onStop(at);
  },
  meters() {
    // Live's meters (traced): the realtime OAudioMeterProcessor (0x142ceb4e0) takes each sample's power p = s*s, keeps the
    // largest p and runs a mean square ms += (p - ms) * c with c = 1 - expf(-5 / sample rate) (0x140a47dd2, 0.2 s),
    // keeping the largest ms. AAudioMeterModule (0x1444cf4a0) fetches and clears both on every UI update and feeds an
    // LAudioMeterFader each (0x1444c4c70) with the peak and 2 * ms: level = max(10 * log10(x), -140) (x > 1e-12, else -140),
    // shown = max(level, shown - 0.075 dB/ms * elapsed ms) ("MeterDefaultFallbackRate" 75), held = the highest level,
    // falling at the same rate once it is older than 10000 ms ("MeterDefaultHoldTime"), reset below -140. The bar is the
    // peak fader's shown level (AVuMeterView slot 180), the darker part the mean-square fader's (slot 182), the line the
    // peak fader's held level (slot 181). The page reads each new sample once from its analysers, using the audio clock.
    cancelAnimationFrame(this.meterRaf);
    const buf = new Float32Array(4096), sr = this.ctx.sampleRate, C = Math.fround(1 - Math.fround(Math.exp(-5 / sr)));
    // fall rates (+0x40, gdb): peak 0x3d99999a (MeterDefaultFallbackRateDbPerSec 75 * 0.001), mean square 0x3ca32f45
    // (RmsMeterDefaultFallbackRateDbPerSec: 0x1444cf710, default 19.92, clamped to 5 .. 19.920008, * 0.001)
    const fader = rate => ({ cur: -140, shown: -140, held: -140, holding: false, t: null, ht: 0, rate });
    const feed = (f, x, now) => {
      f.cur = x > 1e-12 ? Math.max(10 * Math.log10(x), -140) : -140;
      const fall = f.t === null ? 0 : (now - f.t) * f.rate;
      f.shown = Math.max(f.cur, f.shown - fall);
      if (f.cur >= f.held) { f.held = f.cur; f.holding = true; f.ht = now; }
      else if (f.holding && now - f.ht > 10000) f.held -= fall;
      if (f.held < -140) { f.held = -140; f.holding = false; }
      f.t = now;
    };
    const loop = () => {
      if (!this.playing && [...this.nodes.values()].every(n => !n.meter || n.meter.ch.every(c => c.pk.shown <= -140 && c.rms.shown <= -140 && c.pk.held <= -140))) { this.meterRaf = 0; return; }
      const now = Math.floor(performance.now()), at = Math.round(this.ctx.currentTime * sr);
      for (const [t, n] of this.nodes) {
        const st = n.meter ||= { at, ch: [0, 1].map(() => ({ ms: 0, pk: fader(0.07500000298023224), rms: fader(0.019920000806450844) })) };
        const fresh = Math.min(buf.length, Math.max(0, at - st.at)); st.at = at;
        [n.anL, n.anR].forEach((an, i) => {
          const ch = st.ch[i]; let pk = 0, mx = 0, ms = ch.ms;
          an.getFloatTimeDomainData(buf);
          for (let k = buf.length - fresh; k < buf.length; k++) {
            const p = Math.fround(buf[k] * buf[k]);
            if (p > pk) pk = p;
            ms = Math.fround(ms + Math.fround(Math.fround(p - ms) * C));
            if (ms > mx) mx = ms;
          }
          ch.ms = ms;
          feed(ch.pk, pk, now); feed(ch.rms, Math.fround(mx + mx), now);
        });
        hooks.onMeter && hooks.onMeter(t, st);
      }
      this.meterRaf = requestAnimationFrame(loop);
    };
    loop();
  },
};
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

// A project in projects/manifest.json is a zip ({ file } or, split, { parts }) or a folder of files ({ folder, files }).
// A folder's files are { path (as the Set refers to it), src (the file on the site, if it differs: e.g. the audio
// compressed to AAC), size, frames (the original's length, for the AAC priming check) } (or [path, size]). The Set is
// downloaded first and shown at once; the audio files download in parallel behind it and are decoded as they arrive.
function fetchProject(p) { return p.folder ? loadFolder(p) : loadUrl(p.parts || [p.file], p.name); }
async function download(url, size, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download ${decodeURIComponent(url.split('/').pop())} (${res.status})`);
  const reader = res.body.getReader(), chunks = [];
  let bytes = size ? new Uint8Array(size) : null, n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (bytes && n + value.length <= bytes.length) bytes.set(value, n); else { if (bytes) { chunks.push(bytes.subarray(0, n)); bytes = null; } chunks.push(value); }
    n += value.length; onBytes && onBytes(value.length);
  }
  if (bytes && n === bytes.length) return bytes;
  if (bytes) chunks.unshift(bytes.subarray(0, n));
  const all = new Uint8Array(n); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return all;
}
let pendingFiles = new Map(), expectFrames = new Map();
async function loadFolder(p) {
  if (engine.playing) engine.stop(true);
  const root = p.folder.replace(/\/+$/, ''), top = root.split('/').pop();
  const list = p.files.map(f => Array.isArray(f) ? { path: f[0], size: f[1] } : f);
  const url = f => root.split('/').concat((f.src || f.path).split('/')).map(encodeURIComponent).join('/');
  const isSet = f => /\.als$/i.test(f.path);
  const out = {};
  // the Set first, alone (so it is not slowed by the audio)
  const sets = list.filter(isSet), total = sets.reduce((a, f) => a + (f.size || 0), 0);
  let got = 0;
  for (const f of sets) out[top + '/' + f.path] = await download(url(f), f.size, n => {
    got += n; progressDialog(`Downloading ${p.name}… ${(got / 1048576).toFixed(1)} MB`, total ? got / total : null);
  });
  // then the audio. Every file is known before the Set is read (its clips resolve to it); its bytes come later.
  pendingFiles = new Map(); expectFrames = new Map();
  const audio = list.filter(f => !isSet(f)).map(f => {
    const k = top + '/' + f.path;
    out[k] = null;
    if (f.frames) expectFrames.set(k, f.frames);
    let resolve; pendingFiles.set(k, new Promise(r => { resolve = r; }));
    return { f, k, resolve };
  });
  await openFiles(out, p.name);
  if (filesSrc !== out) { for (const a of audio) a.resolve(null); return; }
  // the files the song needs first are downloaded first (by the earliest clip using each), three at a time; each is
  // decoded as soon as it is in and, if the song is already playing, joins in time (engine.addLate)
  const first = new Map();
  for (const t of [...set.tracks, ...set.returns]) for (const c of [...t.clips, ...t.freezeClips])
    if (c.file) first.set(c.file, Math.min(first.get(c.file) ?? Infinity, c.start));
  audio.sort((x, y) => (first.get(x.k) ?? Infinity) - (first.get(y.k) ?? Infinity));
  let next = 0;
  const worker = async () => {
    while (next < audio.length) {
      const a = audio[next++];
      let bytes = null;
      if (filesSrc === out) { try { bytes = await download(url(a.f), a.f.size); } catch (e) { console.error(e); } }
      out[a.k] = bytes;
      if (bytes && filesSrc === out) {
        files.set(a.k, bytes);
        getSource(a.k).then(src => { if (filesSrc === out) { drawAll(); engine.addLate(a.k, src); } });
      }
      a.resolve(bytes);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

async function loadZipBytes(bytes, label) {
  let out;
  try {
    if (engine.playing) engine.stop(true);
    progressDialog(`Unpacking ${label}…`, null);
    await new Promise(r => setTimeout(r, 30));
    out = await unzip(bytes);
    pendingFiles = new Map(); expectFrames = new Map();
  } catch (err) {
    console.error(err);
    openDialog(`<span class="err">${String(err.message || err).replace(/</g, '&lt;')}</span>`);
    return;
  }
  bytes = null;
  await openFiles(out, label);
}

// the project's files (path -> bytes): find its Set, read it and show it
async function openFiles(out, label) {
  try {
    if (engine.playing) engine.stop(true);
    indexFiles(out);
    const sets = findSets();
    if (!sets.length) throw new Error('No Live Set (.als) was found in this project.');
    let chosen = sets[0];
    if (sets.length > 1) chosen = await pickSet(sets);
    progressDialog(`Reading ${basename(chosen)}…`, null);
    await new Promise(r => setTimeout(r, 30));
    const xml = await gunzipText(files.get(chosen));
    sources.clear(); peaks.clear();
    cancelAnimationFrame(engine.meterRaf); engine.meterRaf = 0;
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

