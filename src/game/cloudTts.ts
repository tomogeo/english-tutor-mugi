// Cloud voices (Azure Speech, Google Cloud TTS) behind the same SpeechIo as the browser engine. The server (server/tts.ts)
// synthesizes one sentence per POST /api/tts; the clips are fetched in parallel as soon as a sentence is queued, but
// played strictly in call order, one at a time, through the shared Web Audio voice bus (so the mouth follows the real
// loudness). A sentence whose fetch/decode fails, or that comes while the audio context is still locked (iOS before the
// first tap), is spoken by the browser fallback instead, and the order goes on after it.
import { apiFetch } from './apiFetch';
import type { Lang, SpeechIo, Utterance } from './tts';
import { audioRunning, decodeVoice, playVoiceBuffer, shapeVoiceBuffer } from './audio';
import { voiceFxFor, type VoiceFx } from './voiceFx';
import type { VoiceSource, VisemeCue } from './voiceBus';
import { decodeVisemes, visemeIndexAt, type Viseme } from './visemes';
import { reportTtsFallback, tierShort } from './usageView';

/** the cloud engines (server/tts.ts) */
export type CloudEngine = 'azure' | 'google';
export type CloudVoice = { id: string; label: string; lang: string; character?: string };
export type CloudStatus = { azure: boolean; google: boolean; voices: Record<CloudEngine, Record<Lang, CloudVoice[]>> };

/** used until the status is loaded (the server's first voice of each list is the same) */
export const CLOUD_DEFAULT_VOICES: Record<CloudEngine, Record<Lang, string>> = {
  azure: { zh: 'zh-TW-HsiaoChenNeural', en: 'en-US-AvaNeural' },
  google: { zh: 'cmn-TW-Wavenet-A', en: 'en-US-Neural2-F' },
};

// ---------- status (GET /api/tts/status) ----------
let status: CloudStatus | null = null;
const statusListeners = new Set<() => void>();

/** the last fetched status, null until fetched or when the fetch failed */
export const cloudStatus = (): CloudStatus | null => status;
export function onCloudStatus(l: () => void): () => void {
  statusListeners.add(l);
  return () => void statusListeners.delete(l);
}
/** the voices an engine offers for a language (empty until the status is loaded) */
export const cloudVoiceList = (engine: CloudEngine, lang: Lang): CloudVoice[] => status?.voices?.[engine]?.[lang] ?? [];

/** the engine's default voice: its preferred one when offered, else the first offered */
export function cloudDefaultVoice(engine: CloudEngine, lang: Lang): string {
  const offered = cloudVoiceList(engine, lang);
  const preferred = CLOUD_DEFAULT_VOICES[engine][lang];
  if (offered.some((v) => v.id === preferred)) return preferred;
  return offered[0]?.id ?? preferred;
}

/** asks the server which engines have keys and which voices exist; updates the cache and tells the listeners */
export async function fetchTtsStatus(): Promise<CloudStatus | null> {
  try {
    const r = await apiFetch('/api/tts/status');
    if (!r.ok) throw new Error(String(r.status));
    status = (await r.json()) as CloudStatus;
  } catch {
    status = null;
  }
  statusListeners.forEach((l) => l());
  return status;
}

// ---------- the engine ----------
export type ClipPlayer = { stop(): void; source: VoiceSource };
/** what the engine needs from the outside; tests inject fakes, the app uses fetch / audio.ts */
export type CloudDeps = {
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number; headers?: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;
  decode: (ab: ArrayBuffer) => Promise<AudioBuffer | null>;
  /** the decoded clip with the 語速 and 音調 applied on this device (voiceFx.ts) */
  shape: (buf: AudioBuffer, fx: VoiceFx) => AudioBuffer;
  play: (buf: AudioBuffer, onEnded: () => void) => ClipPlayer;
  ready: () => boolean;
};
const DEFAULT_DEPS: CloudDeps = {
  fetch: (url, init) => apiFetch(url, init),
  decode: decodeVoice,
  shape: shapeVoiceBuffer,
  play: playVoiceBuffer,
  ready: audioRunning,
};

export type CloudIoOptions = {
  /** the cloud engine that speaks a language, null when the device's voice does (that sentence waits its turn and is spoken by `fallback`) */
  engine: (lang: Lang) => CloudEngine | null;
  voice: (lang: Lang, engine: CloudEngine) => string;
  fallback: SpeechIo;
  /** the playing clip's loudness source, or null when no clip is playing */
  onLevelSource: (src: VoiceSource | null) => void;
  deps?: Partial<CloudDeps>;
};
export type CloudIo = SpeechIo & { fallbackActive(): boolean };

/** boundary ticks while a clip plays, so the existing word-boundary lip boost keeps working */
const TICK_MS = 300;
/** a download that takes longer is given up (the sentence goes to the browser), so the order cannot stall */
const FETCH_TIMEOUT_MS = 12_000;
/** a clip that never reports its end is cut after its length plus this slack */
const PLAY_SLACK_MS = 3000;

/** a fetched sentence: the played audio and, when the server sends one, its mouth timing (X-TTS-Visemes, at speed 1) */
type Clip = { buf: AudioBuffer; visemes: Viseme[] };
type Job = {
  u: Utterance;
  g: number; // generation: a cancel() bumps it, and everything of an older generation is ignored
  ctl: AbortController;
  engine: CloudEngine | null; // null: this language is spoken by the device, in order, by the fallback
  clip: Promise<Clip | null> | null; // null: no clip, this sentence goes to the fallback
};

/**
 * The clip's loudness source with its mouth timing: the shape at the playback moment. The clip plays at `speed` (SoundTouch
 * tempo), so its elapsed time maps back to the timeline through visemeAt (game/visemes.ts).
 */
export function withVisemes(src: VoiceSource, visemes: Viseme[], speed: number, startedAt: number): VoiceSource {
  return {
    level: () => src.level(),
    playing: () => src.playing(),
    visemeAt: (): VisemeCue | null => {
      const i = visemeIndexAt(visemes, performance.now() - startedAt, speed);
      return i < 0 ? null : { v: visemes[i].v, i };
    },
  };
}

export function createCloudIo(o: CloudIoOptions): CloudIo {
  const d: CloudDeps = { ...DEFAULT_DEPS, ...o.deps };
  let gen = 0;
  let order: Job[] = []; // waiting, in call order
  const inFlight = new Set<Job>(); // not yet settled (aborted on cancel)
  let cur: { job: Job; stop(): void; tick?: ReturnType<typeof setInterval>; guard?: ReturnType<typeof setTimeout> } | null = null;
  let fbActive = false;

  const clearTimers = () => {
    if (cur?.tick !== undefined) clearInterval(cur.tick);
    if (cur?.guard !== undefined) clearTimeout(cur.guard);
  };
  const endCurrent = () => {
    if (!cur) return;
    clearTimers();
    cur = null;
    o.onLevelSource(null);
  };

  /** a sentence has ended (clip or fallback utterance): the next one may start */
  const settle = (job: Job) => {
    if (job.g !== gen || cur?.job !== job) return;
    inFlight.delete(job);
    endCurrent();
    job.u.onDone();
    pump();
  };

  const speakFallback = (job: Job) => {
    fbActive = true;
    cur = { job, stop: () => {} };
    o.fallback.speak({ ...job.u, onDone: () => { fbActive = false; settle(job); } });
  };

  const startClip = (job: Job, clip: Clip) => {
    let h: ClipPlayer;
    try {
      h = d.play(clip.buf, () => settle(job));
    } catch {
      speakFallback(job);
      return;
    }
    job.u.onBoundary();
    const tick = setInterval(() => job.u.onBoundary(), TICK_MS);
    const length = Number.isFinite(clip.buf.duration) ? clip.buf.duration : 0;
    const guard = setTimeout(() => { if (cur?.job === job) { h.stop(); settle(job); } }, length * 1000 + PLAY_SLACK_MS);
    cur = { job, stop: () => h.stop(), tick, guard };
    o.onLevelSource(clip.visemes.length ? withVisemes(h.source, clip.visemes, job.u.rate, performance.now()) : h.source);
  };

  /** the next waiting sentence starts once nothing is playing; its clip is awaited (order kept), then played */
  const pump = () => {
    if (cur || order.length === 0) return;
    const job = order.shift()!;
    if (!job.clip) return speakFallback(job);
    cur = { job, stop: () => {} }; // holds the slot while the clip downloads
    job.clip.then((clip) => {
      if (job.g !== gen || cur?.job !== job) return; // cancelled meanwhile
      cur = null;
      if (clip) startClip(job, clip);
      else speakFallback(job);
    });
  };

  /** the voice a sentence is spoken with: the character's own when its plan is this engine's, else the 設定 page's */
  const voiceOf = (u: Utterance, engine: CloudEngine): string =>
    u.speaker?.kind === 'cloud' && u.speaker.engine === engine ? u.speaker.voice : o.voice(u.lang, engine);

  const fetchClip = async (job: Job, u: Utterance, engine: CloudEngine): Promise<Clip | null> => {
    const timeout = setTimeout(() => job.ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      // the server always synthesizes at rate 1 / pitch 1 (one cache entry per voice and text); 語速 and 音調 are applied here
      const ask = (voice: string) => d.fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, voice, text: u.text, rate: 1, pitch: 1 }),
        signal: job.ctl.signal,
      });
      let voice = voiceOf(u, engine);
      let r = await ask(voice);
      // a character's own voice that the server does not offer (its list was not loaded when it was chosen): this line is spoken
      // with the 設定 page's voice of the language instead
      const fallbackVoice = o.voice(u.lang, engine);
      if (!r.ok && r.status === 400 && voice !== fallbackVoice) {
        voice = fallbackVoice;
        r = await ask(voice);
      }
      // the server's free-tier fallback (server/tts.ts): a diverted sentence is noted once per month, and a 429 means the browser
      // speaks it (the null below), as any failed clip does; no error is shown
      const fb = r.headers?.get('X-TTS-Fallback') ?? null;
      if (fb) {
        const req = r.headers?.get('X-TTS-Requested-Tier') ?? '';
        const tier = r.headers?.get('X-TTS-Tier') ?? '';
        reportTtsFallback(req, fb === 'browser' ? '瀏覽器內建語音' : tierShort(tier));
      }
      if (!r.ok) return null;
      const visemes = decodeVisemes(r.headers?.get('X-TTS-Visemes') ?? null);
      const decoded = await d.decode(await r.arrayBuffer());
      return decoded ? { buf: d.shape(decoded, voiceFxFor(u.rate, u.pitch)), visemes } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    speak(u) {
      // a character's own plan decides the engine of her line: a cloud voice of its engine, or the device voice (null)
      const engine = u.speaker ? (u.speaker.kind === 'cloud' ? u.speaker.engine : null) : o.engine(u.lang);
      const job: Job = { u, g: gen, ctl: new AbortController(), engine, clip: null };
      if (engine && d.ready()) job.clip = fetchClip(job, u, engine);
      inFlight.add(job);
      order.push(job);
      pump();
    },
    cancel() {
      gen++;
      for (const j of inFlight) j.ctl.abort();
      inFlight.clear();
      order = [];
      cur?.stop();
      clearTimers();
      cur = null;
      fbActive = false;
      o.fallback.cancel();
      o.onLevelSource(null);
    },
    fallbackActive: () => fbActive,
  };
}
