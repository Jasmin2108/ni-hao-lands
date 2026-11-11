// Ni Hao Lands audio: everything is synthesized in the browser with Web Audio (no audio files).
// - Starts only after a user gesture (iOS/Android autoplay rules), suspends while the tab is hidden.
// - SFX share cached noise buffers and a capped voice count; footsteps are throttled.
// - Music is rendered lazily (OfflineAudioContext) after the first gesture, then looped.
(() => {
  "use strict";
  const LS_KEY = "nhl-audio";
  const DEF = { muted: false, music: 0.4, sfx: 0.7 };
  const MAX_VOICES = 14;
  const HEAR_RADIUS = 10; // tiles: other players' sounds beyond this are skipped

  function loadSettings() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (!j || typeof j !== "object") return { ...DEF };
      const c = (v, d) => (Number.isFinite(+v) ? Math.max(0, Math.min(1, +v)) : d);
      return { muted: !!j.muted, music: c(j.music, DEF.music), sfx: c(j.sfx, DEF.sfx) };
    } catch { return { ...DEF }; }
  }
  const settings = loadSettings();
  function saveSettings() { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch {} }

  let ctx = null, master = null, sfxBus = null, musicBus = null, ambBus = null, comp = null;
  let unlocked = false, voices = 0;
  const lastPlay = Object.create(null);
  const listeners = new Set();
  const listener = { x: 0, y: 0 };

  // ---------- shared building blocks (work on AudioContext and OfflineAudioContext) ----------
  const noiseCache = new WeakMap();
  function noiseBuf(ac) {
    let b = noiseCache.get(ac);
    if (!b) {
      b = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.5), ac.sampleRate);
      const d = b.getChannelData(0);
      let s = 0x9e3779b9 | 0; // xorshift32: exact 32-bit integer math, uniform white noise
      for (let i = 0; i < d.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = (s >>> 0) / 2147483648 - 1; }
      noiseCache.set(ac, b);
    }
    return b;
  }
  function env(g, t, a, peak, d, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.002, a));
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }
  function tone(ac, out, t, { type = "sine", f0 = 440, f1 = null, a = 0.005, d = 0.2, vol = 0.3, glide = null, detune = 0 }) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (glide || a + d));
    if (detune) o.detune.setValueAtTime(detune, t);
    env(g, t, a, vol, d);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + a + d + 0.05);
    return o;
  }
  function noise(ac, out, t, { type = "lowpass", f0 = 1000, f1 = null, q = 0.8, a = 0.003, d = 0.15, vol = 0.3, glide = null, offset = 0 }) {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf(ac);
    f.type = type; f.frequency.setValueAtTime(f0, t); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + (glide || a + d));
    env(g, t, a, vol, d);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, offset % 1.2); src.stop(t + a + d + 0.05);
    return src;
  }
  // soft guzheng-ish pluck: triangle + sine octave, tiny upward slide, exponential decay
  function pluck(ac, out, t, f, vol = 0.2, dec = 1.1, slide = false) {
    const g = ac.createGain();
    env(g, t, 0.004, vol, dec);
    g.connect(out);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(Math.min(9000, f * 8), t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2), t + dec);
    lp.connect(g);
    for (const [type, mul, v] of [["triangle", 1, 1], ["sine", 2, 0.35], ["sine", 3, 0.12]]) {
      const o = ac.createOscillator(), og = ac.createGain();
      o.type = type;
      const fr = f * mul;
      if (slide) { o.frequency.setValueAtTime(fr * 0.97, t); o.frequency.exponentialRampToValueAtTime(fr, t + 0.09); }
      else o.frequency.setValueAtTime(fr, t);
      og.gain.value = v;
      o.connect(og); og.connect(lp);
      o.start(t); o.stop(t + dec + 0.1);
    }
  }
  function bell(ac, out, t, f, vol = 0.12, dec = 1.6) {
    for (const [mul, v, dd] of [[1, 1, 1], [2.76, 0.4, 0.6], [5.4, 0.18, 0.35]]) tone(ac, out, t, { f0: f * mul, a: 0.004, d: dec * dd, vol: vol * v });
  }
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ---------- SFX recipes: (ac, out, t, o) ----------
  const SFX = {
    step(ac, out, t, o) { const f = o.surface === "wood" ? 700 : o.surface === "sand" ? 1800 : o.surface === "stone" ? 1300 : 900; noise(ac, out, t, { f0: f * (0.9 + Math.random() * 0.2), q: 1.2, a: 0.004, d: 0.07, vol: 0.12, offset: Math.random() }); },
    cast(ac, out, t) { noise(ac, out, t, { type: "bandpass", f0: 500, f1: 2600, q: 1.5, a: 0.03, d: 0.25, vol: 0.18 }); for (let i = 0; i < 4; i++) tone(ac, out, t + 0.12 + i * 0.035, { type: "square", f0: 2400, a: 0.001, d: 0.012, vol: 0.025 }); },
    splash(ac, out, t) { noise(ac, out, t, { f0: 2400, f1: 500, q: 0.7, a: 0.004, d: 0.35, vol: 0.28 }); tone(ac, out, t, { f0: 620, f1: 180, a: 0.003, d: 0.12, vol: 0.14 }); },
    bite(ac, out, t) { tone(ac, out, t, { f0: 520, f1: 210, a: 0.002, d: 0.09, vol: 0.22 }); noise(ac, out, t + 0.02, { f0: 1800, f1: 600, a: 0.002, d: 0.12, vol: 0.12 }); },
    catch(ac, out, t) { SFX.splash(ac, out, t); pluck(ac, out, t + 0.06, midi(74), 0.16, 0.5); pluck(ac, out, t + 0.16, midi(79), 0.16, 0.7); },
    chop(ac, out, t) { tone(ac, out, t, { f0: 210, f1: 85, a: 0.002, d: 0.11, vol: 0.4 }); noise(ac, out, t, { type: "bandpass", f0: 1400, q: 2, a: 0.001, d: 0.05, vol: 0.3 }); },
    clink(ac, out, t) { for (const [f, v] of [[2350, 0.13], [3720, 0.09], [5130, 0.06]]) tone(ac, out, t, { f0: f * (0.98 + Math.random() * 0.04), a: 0.001, d: 0.22, vol: v }); noise(ac, out, t, { type: "highpass", f0: 3000, a: 0.001, d: 0.03, vol: 0.18 }); },
    anvil(ac, out, t) { for (const [f, v, d] of [[880, 0.14, 0.7], [1333, 0.1, 0.5], [2650, 0.07, 0.35], [4010, 0.04, 0.2]]) tone(ac, out, t, { f0: f, a: 0.001, d, vol: v }); noise(ac, out, t, { type: "bandpass", f0: 2500, q: 1, a: 0.001, d: 0.04, vol: 0.25 }); },
    whoosh(ac, out, t) { noise(ac, out, t, { f0: 220, f1: 900, q: 0.6, a: 0.25, d: 0.6, vol: 0.22, glide: 0.4 }); },
    sizzle(ac, out, t) {
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noiseBuf(ac); f.type = "highpass"; f.frequency.value = 3200;
      g.gain.setValueAtTime(0.0001, t);
      for (let i = 0; i < 18; i++) g.gain.setValueAtTime((0.03 + Math.random() * 0.09) * (1 - i / 22), t + i * 0.035);
      g.gain.setValueAtTime(0.0001, t + 0.7);
      src.connect(f); f.connect(g); g.connect(out); src.start(t, Math.random()); src.stop(t + 0.72);
    },
    hit(ac, out, t) { tone(ac, out, t, { f0: 150, f1: 55, a: 0.002, d: 0.14, vol: 0.4 }); noise(ac, out, t, { f0: 1800, f1: 400, a: 0.001, d: 0.07, vol: 0.25 }); },
    hurt(ac, out, t) { tone(ac, out, t, { type: "triangle", f0: 300, f1: 140, a: 0.002, d: 0.16, vol: 0.22 }); noise(ac, out, t, { f0: 1200, a: 0.001, d: 0.06, vol: 0.18 }); },
    miss(ac, out, t) { noise(ac, out, t, { type: "bandpass", f0: 1900, f1: 600, q: 1.4, a: 0.01, d: 0.14, vol: 0.12 }); },
    death(ac, out, t) { tone(ac, out, t, { type: "triangle", f0: 440, f1: 110, a: 0.01, d: 0.8, vol: 0.2, glide: 0.75 }); tone(ac, out, t + 0.05, { f0: 90, f1: 45, a: 0.005, d: 0.4, vol: 0.3 }); },
    levelup(ac, out, t) { [67, 71, 74, 76, 79, 83].forEach((n, i) => pluck(ac, out, t + i * 0.085, midi(n), 0.15, 0.9)); bell(ac, out, t + 0.52, midi(86), 0.09, 1.4); },
    pop(ac, out, t) { tone(ac, out, t, { f0: 620, f1: 1250, a: 0.002, d: 0.06, vol: 0.14 }); },
    quest(ac, out, t) { [[62, 66, 69], [67, 71, 74]].forEach((ch, k) => ch.forEach((n) => pluck(ac, out, t + k * 0.22, midi(n), 0.1, 1.2))); bell(ac, out, t + 0.44, midi(79), 0.1, 1.6); bell(ac, out, t + 0.62, midi(83), 0.08, 1.6); },
    click(ac, out, t) { tone(ac, out, t, { type: "triangle", f0: 1500, a: 0.001, d: 0.025, vol: 0.08 }); },
    tab(ac, out, t) { tone(ac, out, t, { type: "triangle", f0: 980, f1: 1300, a: 0.001, d: 0.04, vol: 0.08 }); },
    chat(ac, out, t) { tone(ac, out, t, { f0: 880, a: 0.002, d: 0.05, vol: 0.07 }); tone(ac, out, t + 0.06, { f0: 1320, a: 0.002, d: 0.07, vol: 0.06 }); },
    sparkle(ac, out, t) { [84, 88, 91, 96, 100].forEach((n, i) => bell(ac, out, t + i * 0.05, midi(n), 0.045, 0.6)); noise(ac, out, t, { type: "highpass", f0: 6000, a: 0.05, d: 0.35, vol: 0.04 }); },
    glint(ac, out, t) { bell(ac, out, t, midi(93), 0.05, 0.4); bell(ac, out, t + 0.06, midi(98), 0.035, 0.35); },
    beat(ac, out, t) { tone(ac, out, t, { f0: 1050, a: 0.001, d: 0.05, vol: 0.12 }); tone(ac, out, t, { f0: 1580, a: 0.001, d: 0.03, vol: 0.05 }); },
    good(ac, out, t, o) { const n = 76 + Math.min(12, (o.streak || 0)) * 1; pluck(ac, out, t, midi(n), 0.15, 0.6); pluck(ac, out, t + 0.07, midi(n + 7), 0.12, 0.7); },
    perfect(ac, out, t, o) { SFX.good(ac, out, t, o); SFX.glint(ac, out, t + 0.12); },
    bad(ac, out, t) { tone(ac, out, t, { type: "triangle", f0: 260, f1: 190, a: 0.004, d: 0.18, vol: 0.12 }); },
    burnt(ac, out, t) { SFX.sizzle(ac, out, t); tone(ac, out, t + 0.1, { type: "triangle", f0: 220, f1: 150, a: 0.004, d: 0.3, vol: 0.12 }); },
    shower(ac, out, t) { for (let i = 0; i < 6; i++) SFX.clink(ac, out, t + i * 0.07 + Math.random() * 0.03); },
    timber(ac, out, t) { noise(ac, out, t, { f0: 300, f1: 120, a: 0.05, d: 0.6, vol: 0.25 }); tone(ac, out, t + 0.5, { f0: 120, f1: 50, a: 0.003, d: 0.3, vol: 0.35 }); },
    meow(ac, out, t) {
      const o = ac.createOscillator(), f = ac.createBiquadFilter(), f2 = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(780, t + 0.16); o.frequency.linearRampToValueAtTime(600, t + 0.34); o.frequency.linearRampToValueAtTime(460, t + 0.48);
      lfo.frequency.value = 6; lg.gain.value = 9; lfo.connect(lg); lg.connect(o.frequency);
      f.type = "bandpass"; f.Q.value = 6; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1700, t + 0.18); f.frequency.linearRampToValueAtTime(1000, t + 0.48);
      f2.type = "lowpass"; f2.frequency.value = 3200;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.06); g.gain.setValueAtTime(0.16, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
      o.connect(f); f.connect(f2); f2.connect(g); g.connect(out);
      o.start(t); lfo.start(t); o.stop(t + 0.55); lfo.stop(t + 0.55);
    },
    birdchirp(ac, out, t) { const n = 2 + Math.floor(Math.random() * 3), b = 2400 + Math.random() * 1400; for (let i = 0; i < n; i++) tone(ac, out, t + i * 0.09, { f0: b, f1: b * 1.45, a: 0.004, d: 0.06, vol: 0.05 }); },
    cricket(ac, out, t) { for (let i = 0; i < 4; i++) tone(ac, out, t + i * 0.045, { f0: 4300 + Math.random() * 120, a: 0.003, d: 0.025, vol: 0.025 }); },
  };
  const THROTTLE = { step: 180, chop: 120, clink: 120, sizzle: 500, whoosh: 600, chat: 150, pop: 60, click: 40, tab: 60, hit: 80, beat: 80, birdchirp: 300, cricket: 200 };

  // ---------- music (rendered offline, lazily) ----------
  // G major pentatonic village theme; night variant is slower, sparser, bell-led.
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const PENTA = [0, 2, 4, 7, 9];
  function scaleNote(base, deg) { const o = Math.floor(deg / 5), i = ((deg % 5) + 5) % 5; return base + o * 12 + PENTA[i]; }
  function composeMusic(ac, out, variant) {
    const night = variant === "night";
    const bpm = night ? 62 : 84, beat = 60 / bpm, bars = 16;
    const r = rng(night ? 777 : 2024);
    const root = 55; // G3
    const chords = night ? [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]] : [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [2, 5, 9]]; // G Em C D (night: G Em C Bm-ish)
    const prog = [0, 1, 2, 3, 0, 1, 2, 3, 2, 3, 0, 1, 2, 3, 1, 0];
    const rhythms = night ? [[4], [2, 2], [3, 1], [2, 1, 1]] : [[1, 1, 2], [2, 1, 1], [1, 1, 1, 1], [3, 1], [2, 2], [1.5, 0.5, 2]];
    // reverb send
    const rev = ac.createConvolver();
    const ir = ac.createBuffer(2, Math.floor(ac.sampleRate * (night ? 2.6 : 1.8)), ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
    rev.buffer = ir;
    const wet = ac.createGain(); wet.gain.value = night ? 0.32 : 0.2;
    rev.connect(wet); wet.connect(out);
    const dry = ac.createGain(); dry.gain.value = 1; dry.connect(out); dry.connect(rev);
    // motif memory for call-and-response
    let deg = 7, motif = null;
    for (let b = 0; b < bars; b++) {
      const t0 = b * 4 * beat;
      const ch = chords[prog[b]];
      // pad: two detuned triangles per chord tone, slow swell
      for (const iv of ch) {
        const f = midi(root + iv + 12);
        for (const dt of [-6, 6]) {
          const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
          o.type = "triangle"; o.frequency.value = f; o.detune.value = dt;
          lp.type = "lowpass"; lp.frequency.value = night ? 700 : 1100;
          g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(night ? 0.022 : 0.018, t0 + beat * 1.5); g.gain.setValueAtTime(night ? 0.022 : 0.018, t0 + beat * 3.4); g.gain.linearRampToValueAtTime(0.0001, t0 + beat * 4.3);
          o.connect(lp); lp.connect(g); g.connect(dry); o.start(t0); o.stop(t0 + beat * 4.4);
        }
      }
      // bass
      const bassN = root - 12 + ch[0];
      tone(ac, dry, t0, { f0: midi(bassN), a: 0.01, d: beat * 1.8, vol: night ? 0.09 : 0.11 });
      if (!night) tone(ac, dry, t0 + beat * 2, { f0: midi(bassN + 7), a: 0.01, d: beat * 1.6, vol: 0.07 });
      // light percussion (day): woodblock on 2 & 4, soft shaker on off-beats
      if (!night) {
        for (const k of [1, 3]) tone(ac, dry, t0 + k * beat, { f0: 1150, a: 0.001, d: 0.05, vol: 0.035 });
        for (let k = 0; k < 8; k++) if (k % 2) noise(ac, dry, t0 + k * beat / 2, { type: "highpass", f0: 6500, a: 0.003, d: 0.04, vol: 0.012 });
      }
      // melody: phrases of 2 bars; bar 2/4 of a phrase answers the motif
      let rh, notes = [];
      if (b % 2 === 1 && motif && r() < 0.7) { rh = motif.rh; notes = motif.deg.map((d, i) => d + (i === motif.deg.length - 1 ? (r() < 0.5 ? -1 : 1) : 0)); }
      else {
        rh = rhythms[Math.floor(r() * rhythms.length)];
        for (let i = 0; i < rh.length; i++) {
          const step = [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)];
          deg = Math.max(4, Math.min(11, deg + step));
          notes.push(deg);
        }
        motif = { rh, deg: notes.slice() };
      }
      // phrase end on a chord tone (bars 3, 7, 11, 15) with a long note
      if (b % 4 === 3) { rh = rh.length > 2 ? rh.slice(0, 2).concat([4 - rh[0] - rh[1]]) : rh; notes[notes.length - 1] = 5 + (r() < 0.5 ? 0 : 2); }
      let tt = t0;
      for (let i = 0; i < rh.length; i++) {
        const n = scaleNote(root + 12, notes[i] || 7);
        if (night && r() < 0.25 && i > 0) { tt += rh[i] * beat; continue; }
        if (night) bell(ac, dry, tt, midi(n), 0.05, 2.2);
        else pluck(ac, dry, tt, midi(n), 0.11, Math.min(1.6, rh[i] * beat * 1.4), r() < 0.25);
        if (!night && rh[i] >= 2 && r() < 0.5) pluck(ac, dry, tt + beat, midi(n + (r() < 0.5 ? 12 : -5)), 0.04, 0.6);
        tt += rh[i] * beat;
      }
    }
    return bars * 4 * beat;
  }
  const musicBuffers = {}; // variant -> AudioBuffer
  const renderPromises = {};
  async function renderMusicBuffer(variant, rate = 22050) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const night = variant === "night";
    const loopLen = 16 * 4 * (60 / (night ? 62 : 84));
    const tail = 3;
    const len = Math.ceil((loopLen + tail) * rate);
    const ac = new OAC(2, len, rate);
    const bus = ac.createGain(); bus.gain.value = 1; bus.connect(ac.destination);
    composeMusic(ac, bus, variant);
    const full = await ac.startRendering();
    // fold the tail back onto the start so the loop is seamless, then normalize to -6 dBFS peak
    const n = Math.floor(loopLen * rate);
    const outB = ac.createBuffer(2, n, rate);
    let peak = 0;
    const chans = [];
    for (let c = 0; c < 2; c++) {
      const src = full.getChannelData(c), dst = new Float32Array(n);
      for (let i = 0; i < n; i++) dst[i] = src[i] + (i + n < src.length ? src[i + n] : 0);
      for (let i = 0; i < n; i++) { const a = Math.abs(dst[i]); if (a > peak) peak = a; }
      chans.push(dst);
    }
    // loudness-match day/night: scale to a target RMS, then a soft ceiling so peaks never clip
    let sum = 0;
    for (let c = 0; c < 2; c++) { const d = chans[c]; for (let i = 0; i < n; i++) sum += d[i] * d[i]; }
    const rms = Math.sqrt(sum / (2 * n)) || 1e-9;
    const k = Math.min(0.12 / rms, peak > 0 ? 4 / peak : 1); // ~ -18.4 dBFS RMS target
    const ceil = 0.7; // soft-knee ceiling (~ -3 dBFS)
    for (let c = 0; c < 2; c++) {
      const d = chans[c];
      for (let i = 0; i < n; i++) { const v = d[i] * k, a = Math.abs(v); d[i] = a < 0.5 ? v : Math.sign(v) * (0.5 + (ceil - 0.5) * Math.tanh((a - 0.5) / (ceil - 0.5))); }
      outB.copyToChannel(d, c);
    }
    return outB;
  }
  function getMusic(variant) {
    if (musicBuffers[variant]) return Promise.resolve(musicBuffers[variant]);
    if (!renderPromises[variant]) renderPromises[variant] = renderMusicBuffer(variant).then((b) => (musicBuffers[variant] = b));
    return renderPromises[variant];
  }

  // ---------- live graph ----------
  const music = { day: null, night: null, want: "day" };
  const amb = { water: null, birds: 0, crickets: 0, nextBird: 0, nextCricket: 0, targets: { water: 0, birds: 0, crickets: 0 } };
  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch { ctx = new AC(); }
    master = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); musicBus = ctx.createGain(); ambBus = ctx.createGain();
    sfxBus.connect(master); musicBus.connect(master); ambBus.connect(master);
    applyVolumes(true);
    return ctx;
  }
  function applyVolumes(now) {
    if (!ctx) return;
    const t = ctx.currentTime, tc = now ? 0.001 : 0.08;
    master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, tc);
    sfxBus.gain.setTargetAtTime(settings.sfx * settings.sfx, t, tc);           // perceptual-ish curve
    musicBus.gain.setTargetAtTime(settings.music * settings.music * 0.9, t, tc);
    ambBus.gain.setTargetAtTime(Math.max(settings.sfx, settings.music) * 0.5, t, tc);
  }
  function startMusicLoop(variant) {
    if (!ctx || music[variant]) return;
    getMusic(variant).then((buf) => {
      if (!ctx || music[variant]) return;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.loop = true;
      g.gain.value = 0.0001;
      src.connect(g); g.connect(musicBus);
      src.start();
      music[variant] = { src, g };
      crossfade();
    }).catch(() => {});
  }
  function crossfade() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const v of ["day", "night"]) if (music[v]) music[v].g.gain.setTargetAtTime(v === music.want ? 1 : 0.0001, t, 2.5);
  }
  function startWater() {
    if (amb.water || !ctx) return;
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    src.buffer = noiseBuf(ctx); src.loop = true;
    lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.4;
    lfo.frequency.value = 0.13; lg.gain.value = 180; lfo.connect(lg); lg.connect(lp.frequency);
    g.gain.value = 0.0001;
    src.connect(lp); lp.connect(g); g.connect(ambBus);
    src.start(); lfo.start();
    amb.water = { src, g };
  }

  function play(name, o = {}) {
    if (!unlocked || !ctx || settings.muted || ctx.state !== "running") return false;
    const fn = SFX[name];
    if (!fn) return false;
    const now = performance.now();
    const key = name + (o.src || "");
    const th = THROTTLE[name] || 30;
    if (lastPlay[key] && now - lastPlay[key] < th) return false;
    let vol = o.vol == null ? 1 : o.vol;
    if (o.x != null && o.y != null) {
      const d = Math.hypot(o.x - listener.x, o.y - listener.y);
      if (d > HEAR_RADIUS) return false;
      if (o.other) vol *= 0.45 * (1 - d / HEAR_RADIUS);
    }
    if (vol < 0.02 || voices >= MAX_VOICES) return false;
    lastPlay[key] = now;
    const g = ctx.createGain();
    g.gain.value = vol;
    g.connect(sfxBus);
    voices++;
    try { fn(ctx, g, ctx.currentTime + 0.005, o); } catch {}
    setTimeout(() => { voices--; try { g.disconnect(); } catch {} }, 1800);
    return true;
  }

  function unlock() {
    if (unlocked) { if (ctx && ctx.state === "suspended" && !document.hidden) ctx.resume().catch(() => {}); return; }
    if (!ensureCtx()) return;
    // iOS: play a 1-sample silent buffer inside the gesture
    try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch {}
    ctx.resume().catch(() => {});
    unlocked = true;
    for (const ev of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(ev, unlock, true);
    startWater();
    // render music when the main thread is idle (lazy: nothing is generated before the first gesture)
    const go = () => startMusicLoop(music.want);
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(go, { timeout: 1500 });
    emit();
  }
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlock, true);
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (unlocked) ctx.resume().catch(() => {});
  });

  // Called by the game a few times per second.
  function update(o) {
    if (o && o.x != null) { listener.x = o.x; listener.y = o.y; }
    if (!ctx || !unlocked || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const night = o && o.night != null ? o.night : 0;
    const want = night > 0.55 ? "night" : "day";
    if (want !== music.want) { music.want = want; startMusicLoop(want); crossfade(); }
    const tg = { water: Math.max(0, Math.min(1, (o && o.water) || 0)), birds: o && o.indoors ? 0 : (1 - night) * ((o && o.green) != null ? o.green : 1), crickets: o && o.indoors ? 0 : night };
    if (amb.water) amb.water.g.gain.setTargetAtTime(0.0001 + tg.water * 0.35, t, 1.2);
    const now = performance.now();
    if (!settings.muted && tg.birds > 0.15 && now > amb.nextBird) { amb.nextBird = now + 2500 + Math.random() * 6000; playAmb("birdchirp", tg.birds * 0.8); }
    if (!settings.muted && tg.crickets > 0.15 && now > amb.nextCricket) { amb.nextCricket = now + 600 + Math.random() * 1400; playAmb("cricket", tg.crickets); }
  }
  function playAmb(name, vol) {
    if (!ctx || voices >= MAX_VOICES - 2) return;
    const g = ctx.createGain(); g.gain.value = vol; g.connect(ambBus);
    voices++;
    try { SFX[name](ctx, g, ctx.currentTime + 0.01, {}); } catch {}
    setTimeout(() => { voices--; try { g.disconnect(); } catch {} }, 1200);
  }

  function emit() { for (const f of listeners) { try { f(api.state()); } catch {} } }
  function set(patch) {
    if (patch.muted != null) settings.muted = !!patch.muted;
    if (patch.music != null) settings.music = Math.max(0, Math.min(1, +patch.music));
    if (patch.sfx != null) settings.sfx = Math.max(0, Math.min(1, +patch.sfx));
    saveSettings();
    applyVolumes(false);
    if (!settings.muted && ctx && unlocked && ctx.state === "suspended" && !document.hidden) ctx.resume().catch(() => {});
    emit();
  }

  // Offline render of any sound or the music for demos/tests: returns an AudioBuffer.
  async function renderOffline(what, seconds = 2, rate = 44100) {
    if (what === "music-day" || what === "music-night") return renderMusicBuffer(what.slice(6), rate);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const names = Array.isArray(what) ? what : [what];
    const ac = new OAC(2, Math.ceil(seconds * rate), rate);
    const c = ac.createDynamicsCompressor();
    c.threshold.value = -10; c.knee.value = 8; c.ratio.value = 4; c.attack.value = 0.003; c.release.value = 0.2;
    const g = ac.createGain(); g.gain.value = DEF.sfx * DEF.sfx;
    g.connect(c); c.connect(ac.destination);
    names.forEach((n, i) => SFX[n](ac, g, 0.05 + i * (seconds - 0.1) / names.length, { streak: 3 }));
    return ac.startRendering();
  }

  const api = {
    play,
    update,
    unlock,
    set,
    toggleMute() { set({ muted: !settings.muted }); return settings.muted; },
    settings: () => ({ ...settings }),
    state: () => ({ ...settings, unlocked, running: !!(ctx && ctx.state === "running"), musicReady: Object.keys(musicBuffers), voices }),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    names: () => Object.keys(SFX),
    renderOffline,
    defaults: { ...DEF },
  };
  window.NHLAudio = api;
})();
