// 音 (sound). Everything is made in the browser with WebAudio — no sound files:
//   - 波: filtered noise that swells slowly, louder with the wind
//   - エンジン: a low engine note that follows the boat's speed
//   - リール: a ratchet while a line is being wound up
//   - 取り込み: a splash when fish come aboard
//   - 無線: a two-tone beep when a peer calls
//   - 鳥: gull cries while birds (鳥山) are close
// It only reads what the screen shows; it never touches the simulation (and
// never uses its random numbers). Browsers only allow sound after the player
// touches the page, so the audio starts on the first tap or key.
export const SOUND_KEY = 'ryoshi-game:sound';
export const SOUND_LEVELS = [
  { id: 'off', label: '音：なし', gain: 0 },
  { id: 'low', label: '音：小', gain: 0.25 },
  { id: 'mid', label: '音：中', gain: 0.5 },
  { id: 'high', label: '音：大', gain: 0.9 },
];

export function loadSoundLevel(storage) {
  try {
    const v = storage && storage.getItem(SOUND_KEY);
    const i = SOUND_LEVELS.findIndex((l) => l.id === v);
    return i >= 0 ? i : 2;
  } catch {
    return 2;
  }
}

export function saveSoundLevel(storage, i) {
  try {
    if (storage) storage.setItem(SOUND_KEY, SOUND_LEVELS[i].id);
  } catch {
    /* not saved: the default comes back next time */
  }
}

/** The next level when the sound button is pressed: 中 → 大 → なし → 小 → 中 … */
export function nextSoundLevel(i) {
  return [3, 2, 0, 1][[0, 1, 2, 3].indexOf(i)] ?? 2;
}

function noiseBuffer(ctx, seconds, brown = true) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

/**
 * The sound system. `level` is an index into SOUND_LEVELS. `update(st)` is
 * called every frame with what the screen shows: { atSea, speed (m/s), wind
 * (m/s), retrieving (0..1), birds (0..1), night }. `event(kind)` plays a
 * one-shot: 'land' | 'radio' | 'bite' | 'ui'.
 */
export function createSound(level = 2) {
  let ctx = null;
  let master = null;
  let waves = null;
  let engine = null;
  let reel = null;
  let birdAt = 0;
  let cur = level;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = SOUND_LEVELS[cur].gain;
    master.connect(ctx.destination);
    // waves: looping brown noise through a low-pass, its level swelling slowly
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = noiseBuffer(ctx, 4);
    wsrc.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 700;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    wsrc.connect(wf).connect(wg).connect(master);
    wsrc.start();
    waves = { gain: wg, filter: wf };
    // engine: two detuned saws through a low-pass
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.frequency.value = 300;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = o2.type = 'sawtooth';
    o1.frequency.value = 42;
    o2.frequency.value = 42.7;
    o1.connect(ef);
    o2.connect(ef);
    ef.connect(eg).connect(master);
    o1.start();
    o2.start();
    engine = { gain: eg, o1, o2, filter: ef };
    // reel: a square-wave ratchet, gated by a gain
    const rg = ctx.createGain();
    rg.gain.value = 0;
    const ro = ctx.createOscillator();
    ro.type = 'square';
    ro.frequency.value = 28;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 2400;
    rf.Q.value = 2;
    ro.connect(rf).connect(rg).connect(master);
    ro.start();
    reel = { gain: rg };
    return true;
  }

  /** Called on the first tap/key: browsers only start audio after a gesture. */
  function unlock() {
    if (!ctx && !build()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setLevel(i) {
    cur = i;
    if (master) master.gain.setTargetAtTime(SOUND_LEVELS[i].gain, ctx.currentTime, 0.05);
  }

  function update(st) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const at = (param, v) => param.setTargetAtTime(v, t, 0.25);
    if (!st.atSea) {
      at(waves.gain.gain, 0.05);
      at(engine.gain.gain, 0);
      at(reel.gain.gain, 0);
      return;
    }
    const wind = Math.max(0, st.wind || 0);
    const swell = 0.75 + 0.25 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    at(waves.gain.gain, (0.12 + Math.min(0.35, wind * 0.03)) * swell);
    at(waves.filter.frequency, 500 + wind * 60);
    const sp = Math.abs(st.speed || 0);
    at(engine.gain.gain, 0.05 + Math.min(0.2, sp * 0.025));
    at(engine.o1.frequency, 38 + sp * 6);
    at(engine.o2.frequency, 38.6 + sp * 6.1);
    at(engine.filter.frequency, 220 + sp * 60);
    at(reel.gain.gain, st.retrieving ? 0.05 : 0);
    // gulls: an occasional cry while birds are close
    if (st.birds > 0.05 && t - birdAt > 1.2 + 2.5 / st.birds) {
      birdAt = t;
      cry(t, 0.06 * Math.min(1, st.birds));
    }
  }

  function cry(t, vol) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    const f0 = 1900 + Math.random() * 500;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.35);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.45);
  }

  function event(kind) {
    if (!ctx || ctx.state !== 'running' || cur === 0) return;
    const t = ctx.currentTime;
    if (kind === 'land') {
      // a splash: a short burst of filtered noise
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.4, false);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      src.connect(f).connect(g).connect(master);
      src.start(t);
    } else if (kind === 'radio' || kind === 'bite' || kind === 'ui') {
      const tones = kind === 'radio' ? [880, 1320] : kind === 'bite' ? [660] : [520];
      tones.forEach((fr, k) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = fr;
        const s = t + k * 0.14;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(kind === 'ui' ? 0.05 : 0.12, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.12);
        o.connect(g).connect(master);
        o.start(s);
        o.stop(s + 0.14);
      });
    }
  }

  return { unlock, setLevel, update, event, get level() {
    return cur;
  } };
}
