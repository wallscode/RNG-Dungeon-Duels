// audio.js — Pure Web Audio synthesis: 8 one-shot SFX + 3 ambient music moods.
// No audio files. AudioContext is created on the first user gesture (Begin Duel).

let ctx = null;
let _sfxEnabled = true;
let _ambientEnabled = true;

let _ambientMood = 'calm';
let _ambientRunning = false;
let _loopTimer = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
}

export function isSfxEnabled() { return _sfxEnabled; }
export function isAmbientEnabled() { return _ambientEnabled; }

export function setSfxEnabled(on) { _sfxEnabled = on; }

export function setAmbientEnabled(on) {
  _ambientEnabled = on;
  if (!on) stopAmbient();
  else startAmbient();
}

export function setAllSound(on) {
  setSfxEnabled(on);
  setAmbientEnabled(on);
}

// ── SFX ──────────────────────────────────────────────────────────────────────

export function playSound(name) {
  if (!ctx || !_sfxEnabled) return;
  const fx = SFX[name];
  if (fx) fx();
}

function noiseBuffer(durationSec) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

const SFX = {
  // 5–8 rapid white-noise bursts through a randomised bandpass.
  'dice-clatter': () => {
    const bursts = 5 + Math.floor(Math.random() * 4);
    let t = ctx.currentTime;
    for (let i = 0; i < bursts; i++) {
      const dur = 0.04 + Math.random() * 0.04;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 800 + Math.random() * 2400;
      filter.Q.value = 1.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(t);
      t += 0.07 + Math.random() * 0.03;
    }
  },

  // Thud (80→30 Hz sine) + tick (800 Hz blip).
  'dice-settle': () => {
    const t = ctx.currentTime;
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(80, t);
    thud.frequency.exponentialRampToValueAtTime(30, t + 0.2);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0, t);
    thudGain.gain.linearRampToValueAtTime(0.5, t + 0.008);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    thud.connect(thudGain).connect(ctx.destination);
    thud.start(t); thud.stop(t + 0.25);

    const tick = ctx.createOscillator();
    tick.type = 'sine';
    tick.frequency.value = 800;
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0, t);
    tickGain.gain.linearRampToValueAtTime(0.15, t + 0.003);
    tickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    tick.connect(tickGain).connect(ctx.destination);
    tick.start(t); tick.stop(t + 0.08);
  },

  // Square-wave arpeggio C5 E5 G5 C6 + sine shimmer sweep.
  'crit-fanfare': () => {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    let t = ctx.currentTime;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.12);
      t += 0.08;
    }
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(1000, t);
    shimmer.frequency.linearRampToValueAtTime(2000, t + 0.3);
    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0, t);
    sGain.gain.linearRampToValueAtTime(0.08, t + 0.02);
    sGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    shimmer.connect(sGain).connect(ctx.destination);
    shimmer.start(t); shimmer.stop(t + 0.35);
  },

  // Two detuned descending sines. Wired and ready; not currently dispatched.
  'fumble-doom': () => {
    const t = ctx.currentTime;
    for (const detune of [0, 3]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(200 + detune, t);
      osc.frequency.exponentialRampToValueAtTime(60 + detune, t + 0.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.55);
    }
  },

  // 50 Hz sub-bass swell + three 80 Hz square pulses.
  'collapse-rumble': () => {
    const t = ctx.currentTime;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 50;
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, t);
    subGain.gain.linearRampToValueAtTime(0.4, t + 0.05);
    subGain.gain.setValueAtTime(0.4, t + 0.6);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    sub.connect(subGain).connect(ctx.destination);
    sub.start(t); sub.stop(t + 0.85);

    for (let i = 0; i < 3; i++) {
      const pt = t + i * 0.2;
      const pulse = ctx.createOscillator();
      pulse.type = 'square';
      pulse.frequency.value = 80;
      const pGain = ctx.createGain();
      pGain.gain.setValueAtTime(0, pt);
      pGain.gain.linearRampToValueAtTime(0.15, pt + 0.01);
      pGain.gain.exponentialRampToValueAtTime(0.001, pt + 0.12);
      pulse.connect(pGain).connect(ctx.destination);
      pulse.start(pt); pulse.stop(pt + 0.15);
    }
  },

  // Noise whoosh (highpass 3000→400 Hz) + 440 Hz tone.
  'card-play': () => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.15);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);

    const tone = ctx.createOscillator();
    tone.type = 'sine';
    tone.frequency.value = 440;
    const tGain = ctx.createGain();
    tGain.gain.setValueAtTime(0, t);
    tGain.gain.linearRampToValueAtTime(0.1, t + 0.005);
    tGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    tone.connect(tGain).connect(ctx.destination);
    tone.start(t); tone.stop(t + 0.1);
  },

  // 5-note square arpeggio with a reverb-tail last note.
  'victory': () => {
    const notes = [261.63, 329.63, 392.0, 523.25, 659.25];
    let t = ctx.currentTime;
    notes.forEach((freq, i) => {
      const last = i === notes.length - 1;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.008);
      if (last) {
        gain.gain.setValueAtTime(0.15, t + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.72);
      } else {
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      }
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + (last ? 0.75 : 0.14));
      t += 0.1;
    });
  },

  // 3-note sine descent through a shared lowpass, master fade.
  'defeat': () => {
    const notes = [220, 174.61, 146.83];
    const t0 = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.8;
    const master = ctx.createGain();
    master.gain.value = 1.0;
    filter.connect(master).connect(ctx.destination);

    let t = t0;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain).connect(filter);
      osc.start(t); osc.stop(t + 0.25);
      t += 0.18;
    }
    master.gain.setValueAtTime(1.0, t);
    master.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
  },
};

// ── Ambient music ────────────────────────────────────────────────────────────
// Continuous chiptune loop: square melody + triangle bass. Mood transitions
// take effect at the next loop boundary so phrases never cut mid-note.

const MOODS = {
  calm: {
    masterGain: 0.08,
    bassGain: 0.06,
    melody: [
      [220, 0.25], [261, 0.25], [329, 0.25], [440, 0.5],
      [392, 0.25], [349, 0.25], [329, 0.5],
      [293, 0.25], [349, 0.25], [440, 0.25], [587, 0.5],
      [523, 0.25], [493, 0.25], [440, 0.75],
      [392, 0.25], [440, 0.25], [493, 0.25], [523, 0.5],
      [440, 0.25], [392, 0.25], [349, 0.5],
      [329, 0.25], [392, 0.25], [523, 0.25], [493, 0.5],
      [220, 1.0],
    ],
    bass: [[110, 1], [82, 1], [110, 1], [98, 1], [87, 2], [82, 2]],
  },
  tense: {
    masterGain: 0.09,
    bassGain: 0.08,
    melody: [
      [220, 0.2], [261, 0.2], [329, 0.2], [415, 0.4],
      [440, 0.2], [349, 0.2], [329, 0.4],
      [293, 0.2], [261, 0.2], [220, 0.2], [196, 0.4],
      [220, 0.15], [261, 0.15], [329, 0.15], [415, 0.15],
      [440, 0.3], [415, 0.3],
      [349, 0.2], [329, 0.2], [293, 0.4],
      [220, 0.8],
    ],
    bass: [
      [82, 0.5], [82, 0.5], [73, 0.5], [73, 0.5],
      [110, 0.4], [110, 0.4], [98, 0.4], [98, 0.4],
      [82, 1.0], [73, 1.0],
    ],
  },
  collapse: {
    masterGain: 0.10,
    bassGain: 0.10,
    melody: [
      [220, 0.15], [311, 0.15], [349, 0.15], [440, 0.3],
      [349, 0.2], [311, 0.2], [220, 0.4],
      [261, 0.15], [311, 0.15], [349, 0.15], [415, 0.3],
      [440, 0.2], [415, 0.2], [349, 0.4],
      [220, 0.15], [349, 0.15], [220, 0.15], [349, 0.3],
      [196, 0.6],
      [220, 0.8],
    ],
    bass: [
      [65, 0.35], [65, 0.35], [65, 0.35], [65, 0.35],
      [73, 0.35], [73, 0.35], [73, 0.35], [73, 0.35],
      [55, 0.7], [49, 0.7],
    ],
  },
};

export function setAmbientMood(mood) {
  if (MOODS[mood]) _ambientMood = mood; // picked up at the next loop boundary
}

export function startAmbient() {
  if (!ctx || !_ambientEnabled || _ambientRunning) return;
  _ambientRunning = true;
  scheduleLoop();
}

export function stopAmbient() {
  _ambientRunning = false;
  if (_loopTimer) { clearTimeout(_loopTimer); _loopTimer = null; }
}

function scheduleLoop() {
  if (!_ambientRunning || !ctx) return;
  const mood = MOODS[_ambientMood];
  const t0 = ctx.currentTime + 0.05;

  const master = ctx.createGain();
  master.gain.value = mood.masterGain;
  master.connect(ctx.destination);

  // Melody: square wave, per-note envelope.
  let t = t0;
  for (const [freq, dur] of mood.melody) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
    gain.gain.setValueAtTime(0.10, t + Math.max(0.01, dur - 0.02));
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
    t += dur;
  }
  const melodyLen = t - t0;

  // Bass: triangle wave.
  let bt = t0;
  for (const [freq, dur] of mood.bass) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(mood.bassGain, bt);
    gain.gain.linearRampToValueAtTime(mood.bassGain * 0.5, bt + Math.max(0.01, dur - 0.02));
    gain.gain.linearRampToValueAtTime(0, bt + dur);
    osc.connect(gain).connect(master);
    osc.start(bt); osc.stop(bt + dur + 0.02);
    bt += dur;
  }

  const loopLen = Math.max(melodyLen, bt - t0);
  // Reschedule 500ms before this cycle ends so the next mood is picked up cleanly.
  _loopTimer = setTimeout(scheduleLoop, Math.max(100, (loopLen - 0.5) * 1000));
}
