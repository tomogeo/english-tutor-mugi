import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudIo, type CloudDeps, type ClipPlayer } from '../cloudTts';
import type { SpeechIo, Utterance } from '../tts';
import type { VoiceSource } from '../voiceBus';
import type { VoiceFx } from '../voiceFx';

// the clip "audio" is just its text: the fake decoder turns the downloaded bytes back into that text
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const textOf = (buf: unknown) => (buf as { text: string }).text;

type Played = { text: string; onEnded: () => void; stopped: boolean };
type Harness = ReturnType<typeof harness>;

function harness(opts: { ready?: boolean } = {}) {
  const requests: { body: { text: string; engine: string; voice: string; rate: number; pitch: number }; signal: AbortSignal; respond: (ok: boolean) => void }[] = [];
  const played: Played[] = [];
  const shapes: VoiceFx[] = [];
  const levels: (VoiceSource | null)[] = [];
  const spoken: Utterance[] = [];
  const fallback: SpeechIo & { cancels: number } = {
    cancels: 0,
    speak: (u) => { spoken.push(u); },
    cancel() { this.cancels++; },
  };
  const deps: Partial<CloudDeps> = {
    ready: () => opts.ready ?? true,
    fetch: (_url, init) => new Promise((resolve) => {
      const body = JSON.parse(init.body as string);
      requests.push({
        body,
        signal: init.signal as AbortSignal,
        respond: (ok) => resolve({ ok, arrayBuffer: async () => enc(body.text) }),
      });
    }),
    decode: async (ab) => ({ text: new TextDecoder().decode(ab) }) as unknown as AudioBuffer,
    shape: (buf, fx) => { shapes.push(fx); return buf; },
    play: (buf, onEnded): ClipPlayer => {
      const p: Played = { text: textOf(buf), onEnded, stopped: false };
      played.push(p);
      return {
        stop: () => { p.stopped = true; },
        source: { playing: () => !p.stopped, level: () => 0.5 },
      };
    },
  };
  const io = createCloudIo({
    engine: () => 'azure',
    voice: (lang) => (lang === 'zh' ? 'zh-TW-HsiaoChenNeural' : 'en-US-AvaNeural'),
    fallback,
    onLevelSource: (s) => levels.push(s),
    deps,
  });
  return { io, requests, played, levels, spoken, fallback, shapes };
}

const utt = (text: string, extra: Partial<Utterance> = {}): Utterance => ({
  text, lang: 'zh', rate: 1.05, pitch: 1, volume: 0.8, onBoundary: () => {}, onDone: () => {}, ...extra,
});
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let h: Harness | null = null;
afterEach(() => {
  h?.io.cancel(); // clears the boundary timer of a clip still playing
  h = null;
});

describe('createCloudIo', () => {
  it('always asks the server for rate 1 and pitch 1, and applies the sentence\'s 語速 and 音調 on the device', async () => {
    h = harness();
    h.io.speak(utt('你好。', { rate: 0.9, pitch: 1.2 }));
    await flush();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].body).toEqual({ engine: 'azure', voice: 'zh-TW-HsiaoChenNeural', text: '你好。', rate: 1, pitch: 1 });
    h.requests[0].respond(true);
    await flush();
    expect(h.shapes).toEqual([{ speed: 0.9, semitones: 4 }]);
  });

  it('a mixed reply: a zh sentence goes to the cloud engine, a ja sentence (device voice) to the browser, in call order', async () => {
    vi.useFakeTimers();
    try {
      const fallbackSpoken: Utterance[] = [];
      const requested: string[] = [];
      const played: string[] = [];
      let endClip: (() => void) | null = null;
      const io = createCloudIo({
        engine: (lang) => (lang === 'zh' ? 'azure' : null),
        voice: () => 'zh-TW-HsiaoChenNeural',
        fallback: { speak: (u) => { fallbackSpoken.push(u); }, cancel() {} },
        onLevelSource: () => {},
        deps: {
          ready: () => true,
          fetch: (_url, init) => { requested.push(JSON.parse(init.body as string).engine); return Promise.resolve({ ok: true, arrayBuffer: async () => enc('你好。') }); },
          decode: async () => ({ duration: 1 }) as unknown as AudioBuffer,
          shape: (b) => b,
          play: (_buf, onEnded): ClipPlayer => { played.push('zh'); endClip = onEnded; return { stop() {}, source: { playing: () => true, level: () => 0.5 } }; },
        },
      });
      io.speak(utt('你好。', { lang: 'zh' }));
      io.speak(utt('こんにちは。', { lang: 'en', rate: 0.9, pitch: 1.1 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(requested).toEqual(['azure']); // only the zh sentence is fetched
      expect(played).toEqual(['zh']);
      expect(fallbackSpoken).toEqual([]); // the ja sentence waits for the zh clip
      endClip!();
      await vi.advanceTimersByTimeAsync(0);
      expect(fallbackSpoken.map((u) => [u.lang, u.rate, u.pitch])).toEqual([['en', 0.9, 1.1]]);
      io.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefetches in parallel but plays clips strictly in call order, even when the responses come out of order', async () => {
    h = harness();
    const { io, requests, played } = h;
    const ends: string[] = [];
    io.speak(utt('一。', { onDone: () => ends.push('一') }));
    io.speak(utt('二。', { onDone: () => ends.push('二') }));
    io.speak(utt('三。', { onDone: () => ends.push('三') }));
    await flush();
    expect(requests).toHaveLength(3); // all three were requested right away

    requests[2].respond(true);
    requests[1].respond(true);
    await flush();
    expect(played).toHaveLength(0); // the first sentence is still downloading: nothing jumps ahead

    requests[0].respond(true);
    await flush();
    expect(played.map((p) => p.text)).toEqual(['一。']);

    played[0].onEnded();
    await flush();
    expect(played.map((p) => p.text)).toEqual(['一。', '二。']);
    expect(ends).toEqual(['一']);

    played[1].onEnded();
    await flush();
    expect(played.map((p) => p.text)).toEqual(['一。', '二。', '三。']);
    played[2].onEnded();
    expect(ends).toEqual(['一', '二', '三']);
  });

  it('publishes the clip level while it plays, and clears it when the queue of clips drains', async () => {
    h = harness();
    const { io, requests, played, levels } = h;
    io.speak(utt('好。'));
    await flush();
    requests[0].respond(true);
    await flush();
    expect(levels.at(-1)?.level()).toBe(0.5);
    played[0].onEnded();
    expect(levels.at(-1)).toBeNull();
  });

  it('sends a sentence to the browser fallback when its download fails, then goes on after that utterance ends', async () => {
    h = harness();
    const { io, requests, played, spoken, fallback } = h;
    const ends: string[] = [];
    io.speak(utt('壞掉的。', { onDone: () => ends.push('壞') }));
    io.speak(utt('好的。', { onDone: () => ends.push('好') }));
    await flush();
    requests[0].respond(false);
    requests[1].respond(true);
    await flush();
    expect(spoken.map((u) => u.text)).toEqual(['壞掉的。']);
    expect(played).toHaveLength(0); // the second sentence waits for the browser to finish the first

    spoken[0].onDone();
    await flush();
    expect(ends).toEqual(['壞']);
    expect(played.map((p) => p.text)).toEqual(['好的。']);
    played[0].onEnded();
    expect(ends).toEqual(['壞', '好']);
    expect(fallback.cancels).toBe(0);
  });

  it('a network error counts as a failed download (fallback)', async () => {
    h = harness();
    const rejecting = createCloudIo({
      engine: () => 'google',
      voice: () => 'cmn-TW-Wavenet-A',
      fallback: h.fallback,
      onLevelSource: () => {},
      deps: { ready: () => true, fetch: () => Promise.reject(new Error('offline')), decode: async () => null, play: () => { throw new Error('no'); } },
    });
    rejecting.speak(utt('斷線。'));
    await flush();
    expect(h.spoken.map((u) => u.text)).toEqual(['斷線。']);
    rejecting.cancel();
  });

  it('while the audio context is locked (iOS before the first tap) every sentence goes to the browser, without a request', async () => {
    h = harness({ ready: false });
    h.io.speak(utt('還沒解鎖。'));
    await flush();
    expect(h.requests).toHaveLength(0);
    expect(h.spoken.map((u) => u.text)).toEqual(['還沒解鎖。']);
    expect(h.io.fallbackActive()).toBe(true);
  });

  it('cancel() drops the queue, stops the clip, stops the browser, and ignores late responses', async () => {
    h = harness();
    const { io, requests, played, levels } = h;
    const ends: string[] = [];
    io.speak(utt('一。', { onDone: () => ends.push('一') }));
    io.speak(utt('二。', { onDone: () => ends.push('二') }));
    await flush();
    requests[0].respond(true);
    await flush();
    expect(played.map((p) => p.text)).toEqual(['一。']);

    io.cancel();
    expect(played[0].stopped).toBe(true);
    expect(requests[1].signal.aborted).toBe(true);
    expect(h.fallback.cancels).toBe(1);
    expect(levels.at(-1)).toBeNull();

    // the stopped clip's end and the aborted download's late bytes change nothing
    played[0].onEnded();
    requests[1].respond(true);
    await flush();
    expect(played).toHaveLength(1);
    expect(ends).toEqual([]);
    expect(io.fallbackActive()).toBe(false);
  });

  it('after cancel() a new sentence plays normally', async () => {
    h = harness();
    const { io, requests, played } = h;
    io.speak(utt('舊的。'));
    await flush();
    io.cancel();
    requests[0].respond(true);
    io.speak(utt('新的。'));
    await flush();
    requests[1].respond(true);
    await flush();
    expect(played.map((p) => p.text)).toEqual(['新的。']);
  });

  it('a download that hangs is given up after the timeout and the sentence goes to the browser; the order goes on', async () => {
    vi.useFakeTimers();
    try {
      const fallback: SpeechIo & { spoken: Utterance[] } = {
        spoken: [],
        speak(u) { this.spoken.push(u); },
        cancel() {},
      };
      const played: string[] = [];
      const io = createCloudIo({
        engine: () => 'azure',
        voice: () => 'zh-TW-HsiaoChenNeural',
        fallback,
        onLevelSource: () => {},
        deps: {
          ready: () => true,
          // never answers, but does react to the abort the timeout sends
          fetch: (_url, init) => new Promise((_resolve, reject) => {
            (init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')));
          }),
          decode: async () => null,
          play: () => { throw new Error('unused'); },
        },
      });
      io.speak(utt('卡住。'));
      await vi.advanceTimersByTimeAsync(0);
      expect(fallback.spoken).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(12_000);
      expect(fallback.spoken.map((u) => u.text)).toEqual(['卡住。']);
      io.cancel();
      expect(played).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('boundary callbacks fire at the start of a clip and keep ticking while it plays', async () => {
    vi.useFakeTimers();
    try {
      h = harness();
      const { io, requests, played } = h;
      let boundaries = 0;
      io.speak(utt('長一點的句子。', { onBoundary: () => { boundaries++; } }));
      await vi.advanceTimersByTimeAsync(0);
      requests[0].respond(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(played).toHaveLength(1);
      const atStart = boundaries;
      expect(atStart).toBeGreaterThanOrEqual(1);
      await vi.advanceTimersByTimeAsync(900);
      expect(boundaries).toBeGreaterThanOrEqual(atStart + 3);
      played[0].onEnded();
      const after = boundaries;
      await vi.advanceTimersByTimeAsync(900);
      expect(boundaries).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });
});
