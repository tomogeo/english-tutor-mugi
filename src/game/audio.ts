// Audio on the Web Audio API: one shared AudioContext, two buses (music / voice) under a master gain. The only clip the app
// plays on its own is the background music (public/audio/bgm.mp3, looping; silent when the file is missing). Cloud voice
// clips are decoded and shaped here (decodeVoice, shapeVoiceBuffer) and played through playVoiceBuffer, which publishes the
// loudness for lip-sync (game/voiceBus).
//
// iOS Safari: an AudioContext starts "suspended" and only a user gesture may resume it. We resume (and play a 1-sample
// silent buffer, the old iOS unlock trick) from the first pointer/touch/key event, and re-arm the listeners whenever the
// context drops out of "running" (iOS "interrupted" after a call / background). navigator.audioSession.type = 'playback'
// (Safari 16.4+) makes Web Audio ignore the ring/silent switch, like a music app.
import type { VoiceSource } from './voiceBus';
import { applyVoiceFxToBuffer, type VoiceFx } from './voiceFx';

/** the background music file, under the app's base URL */
export const MUSIC_URL = `${import.meta.env.BASE_URL}audio/bgm.mp3`;
export type Bus = 'music' | 'voice';
export type AudioSettings = { muted: boolean; master: number; music: number; voice: number };

const SETTINGS_KEY = 'mugien.audio';
const DEFAULTS: AudioSettings = { muted: false, master: 1, music: 0.5, voice: 1 };

let settings: AudioSettings = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    return s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
})();
const settingsListeners = new Set<(s: AudioSettings) => void>();

type Graph = { ctx: AudioContext; master: GainNode; buses: Record<Bus, GainNode> };
let graph: Graph | null = null;

function getGraph(): Graph | null {
  if (graph) return graph;
  const Ctor: typeof AudioContext | undefined =
    typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  if (!Ctor) return null;
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch { /* not supported */ }
  const ctx = new Ctor();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const bus = () => {
    const g = ctx.createGain();
    g.connect(master);
    return g;
  };
  graph = { ctx, master, buses: { music: bus(), voice: bus() } };
  applySettings();
  ctx.addEventListener?.('statechange', () => {
    if (ctx.state !== 'running') armUnlock();
    stateListeners.forEach((l) => l(ctx.state));
  });
  return graph;
}

function applySettings() {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  graph.master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.02);
  for (const b of ['music', 'voice'] as const) graph.buses[b].gain.setTargetAtTime(settings[b], t, 0.02);
}

export function getAudioSettings(): AudioSettings {
  return settings;
}
export function setAudioSettings(patch: Partial<AudioSettings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* private mode */ }
  applySettings();
  settingsListeners.forEach((l) => l(settings));
}
export function onAudioSettings(l: (s: AudioSettings) => void) {
  settingsListeners.add(l);
  return () => void settingsListeners.delete(l);
}

// ---------- unlock on first gesture ----------
const stateListeners = new Set<(s: AudioContextState | 'interrupted') => void>();
const GESTURES = ['pointerdown', 'touchend', 'mousedown', 'keydown', 'click'] as const;
let armed = false;

function unlock() {
  const g = getGraph();
  if (!g) return;
  if (g.ctx.state !== 'running') {
    // must run synchronously inside the gesture handler on iOS
    try {
      const src = g.ctx.createBufferSource();
      src.buffer = g.ctx.createBuffer(1, 1, 22050);
      src.connect(g.ctx.destination);
      src.start(0);
    } catch { /* ignore */ }
    g.ctx.resume().catch(() => {});
  }
  if (g.ctx.state === 'running') disarm();
  else g.ctx.resume().then(() => g.ctx.state === 'running' && disarm(), () => {});
}
function armUnlock() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  for (const e of GESTURES) window.addEventListener(e, unlock, { capture: true, passive: true });
}
function disarm() {
  if (!armed) return;
  armed = false;
  for (const e of GESTURES) window.removeEventListener(e, unlock, { capture: true });
}
if (typeof window !== 'undefined') {
  armUnlock();
  // returning from background: iOS may leave the context suspended/interrupted
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && graph && graph.ctx.state !== 'running') {
      graph.ctx.resume().catch(() => {});
      armUnlock();
    }
  });
}

export const audioState = () => graph?.ctx.state ?? 'none';
export function onAudioState(l: (s: AudioContextState | 'interrupted') => void) {
  stateListeners.add(l);
  return () => void stateListeners.delete(l);
}
const running = () => !!graph && graph.ctx.state === 'running';

// ---------- playback ----------
type Live = { src: AudioBufferSourceNode; gain: GainNode; done: boolean; stop: () => void };

function start(buf: AudioBuffer, bus: Bus, loop: boolean, gain = 1, at?: AudioNode): Live {
  const g = getGraph()!;
  const src = g.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const gn = g.ctx.createGain();
  gn.gain.value = gain;
  src.connect(gn);
  if (at) {
    gn.connect(at);
    at.connect(g.buses[bus]);
  } else gn.connect(g.buses[bus]);
  const live: Live = {
    src, gain: gn, done: false,
    stop: () => {
      if (live.done) return;
      live.done = true;
      try { src.stop(); } catch { /* not started */ }
      src.disconnect();
      gn.disconnect();
    },
  };
  src.onended = () => live.stop();
  src.start();
  return live;
}

/** Decoded background music, cached: one fetch and one decode per page visit. null when there is no file (404) or no audio. */
let musicBuffer: Promise<AudioBuffer | null> | null = null;
function loadMusic(): Promise<AudioBuffer | null> {
  const g = getGraph();
  if (!g) return Promise.resolve(null);
  return (musicBuffer ??= fetch(MUSIC_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`); // a missing track is silence, not an error
      // dev servers and SPA fallbacks answer a missing file with 200 + index.html: that is not audio either
      const type = (r.headers.get('content-type') ?? '').toLowerCase();
      if (type && !type.startsWith('audio/') && type !== 'application/octet-stream') throw new Error(`not audio: ${type}`);
      return r.arrayBuffer();
    })
    .then((ab) => new Promise<AudioBuffer>((res, rej) => {
      // callback form (old Safari); modern browsers also return a promise, which must be handled too or a bad file is an
      // "unhandled rejection"
      const p = g.ctx.decodeAudioData(ab, res, rej) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.catch === 'function') p.catch(rej);
    }))
    .catch((e: unknown) => {
      console.debug('[audio] no background music:', e instanceof Error ? e.message : e);
      musicBuffer = null;
      return null;
    }));
}

// music: one looping track on the music bus
let music: { live: Live | null; token: number } | null = null;
let musicToken = 0;

function fadeOut(l: Live, fade: number) {
  const g = getGraph();
  if (!g || fade <= 0) return l.stop();
  const t = g.ctx.currentTime;
  l.gain.gain.cancelScheduledValues(t);
  l.gain.gain.setValueAtTime(l.gain.gain.value, t);
  l.gain.gain.linearRampToValueAtTime(0, t + fade);
  setTimeout(() => l.stop(), fade * 1000 + 50);
}

/**
 * Starts the background music, looping, on the music bus. Does nothing when it already plays. A missing file stays silent.
 * Music that loads while audio is locked starts silently and becomes audible on unlock.
 */
export function playMusic(fade = 1) {
  if (music) return;
  const token = ++musicToken;
  music = { live: null, token };
  loadMusic().then((buf) => {
    if (!buf || !music || music.token !== token) return;
    const live = start(buf, 'music', true, fade > 0 ? 0 : 1);
    if (fade > 0) {
      const t = getGraph()!.ctx.currentTime;
      live.gain.gain.setValueAtTime(0, t);
      live.gain.gain.linearRampToValueAtTime(1, t + fade);
    }
    music.live = live;
  });
}
export function stopMusic(fade = 1) {
  if (!music) return;
  musicToken++;
  if (music.live) fadeOut(music.live, fade);
  music = null;
}

/**
 * The iOS audio session type (Safari 16.4+ navigator.audioSession). The app uses 'playback' (sound even with the silent switch on),
 * but a 'playback' session refuses microphone capture (getUserMedia → InvalidStateError). A page that records switches to
 * 'play-and-record' while it records and back to 'playback' when it is done. No-op where the API does not exist.
 */
export function setAudioSessionType(type: 'playback' | 'play-and-record'): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = type;
  } catch { /* not supported */ }
}

/** whether the shared context runs (iOS: only after a user gesture); cloud voices use the browser voice until then */
export function audioRunning(): boolean {
  return running();
}

/** decodes a downloaded voice clip on the shared context; null when there is no context or the bytes do not decode */
export function decodeVoice(ab: ArrayBuffer): Promise<AudioBuffer | null> {
  const g = getGraph();
  if (!g) return Promise.resolve(null);
  return new Promise((res) => {
    try {
      g.ctx.decodeAudioData(ab, res, () => res(null)).catch(() => res(null));
    } catch {
      res(null);
    }
  });
}

/**
 * A decoded cloud clip with the 語速 and 音調 applied on this device (game/voiceFx.ts), built on the shared context.
 * Throws when there is no context; the caller treats that like a clip that failed to decode.
 */
export function shapeVoiceBuffer(buf: AudioBuffer, fx: VoiceFx): AudioBuffer {
  const g = getGraph();
  if (!g) throw new Error('no audio context');
  return applyVoiceFxToBuffer(buf, fx, g.ctx);
}

/** loudness of an analysed voice clip: RMS of the analyser's time data (0..1), `playing` until the clip ends */
function voiceMeter(g: Graph, an: AnalyserNode, live: Live): VoiceSource {
  const data = new Float32Array(an.fftSize);
  let lastT = -1, lastLevel = 0;
  return {
    playing: () => !live.done,
    level: () => {
      if (live.done) return 0;
      const now = g.ctx.currentTime;
      if (now === lastT) return lastLevel; // one analysis per audio quantum is plenty
      lastT = now;
      an.getFloatTimeDomainData(data);
      let s = 0;
      for (let i = 0; i < data.length; i++) s += data[i] * data[i];
      // speech RMS sits around 0.03–0.3 → ~0.1–0.9
      return (lastLevel = Math.min(1, Math.sqrt(s / data.length) * 3));
    },
  };
}

/**
 * Plays a decoded voice clip on the voice bus through its own analyser. The cloud voice queue decides when lip-sync follows
 * it (the returned source). onEnded runs once, on the natural end only; stop() ends it silently.
 */
export function playVoiceBuffer(buf: AudioBuffer, onEnded: () => void): { stop(): void; source: VoiceSource } {
  const g = getGraph();
  if (!g) throw new Error('no audio context');
  const an = g.ctx.createAnalyser();
  an.fftSize = 1024;
  an.smoothingTimeConstant = 0.3;
  const live = start(buf, 'voice', false, 1, an);
  let ended = false;
  live.src.addEventListener('ended', () => {
    if (ended) return;
    ended = true;
    an.disconnect();
    onEnded();
  });
  return {
    stop() {
      if (ended) return;
      ended = true;
      live.stop();
      an.disconnect();
    },
    source: voiceMeter(g, an, live),
  };
}
