import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SentenceBuffer, TTS_DEFAULTS, chosenVoice, createReplyVoice, createSpeechQueue, detectLang, getTtsSettings, migrateTtsSettings, pickVoice, setTtsSettings, takeSentences, unlockSpeech, type Lang, type LangVoice, type SpeechIo, type TtsSettings, type Utterance } from '../tts';

// a fake speech engine: records what was handed over, and lets the test end each utterance by hand
function fakeIo() {
  const spoken: Utterance[] = [];
  const io: SpeechIo & { cancels: number } = {
    cancels: 0,
    speak: (u) => { spoken.push(u); },
    cancel() { this.cancels++; },
  };
  return { io, spoken };
}

function makeQueue(extra: { onBusy?: (b: boolean) => void } = {}) {
  const f = fakeIo();
  const q = createSpeechQueue({ io: f.io, rate: () => 1.05, volume: () => 0.8, onBusy: extra.onBusy });
  return { ...f, q };
}

describe('takeSentences', () => {
  it('cuts at Chinese and Japanese full stops, ! ? … and newlines, keeping the terminators', () => {
    expect(takeSentences('你好。我是她！真的嗎？好…\n最後').sentences).toEqual(['你好。', '我是她！', '真的嗎？', '好…']);
    expect(takeSentences('今日はいい天気ですね。').sentences).toEqual(['今日はいい天気ですね。']);
  });

  it('keeps the unfinished tail as rest and groups repeated terminators', () => {
    expect(takeSentences('好了……還有').rest).toBe('還有');
    expect(takeSentences('好了……還有').sentences).toEqual(['好了……']);
    expect(takeSentences('沒有結束').sentences).toEqual([]);
  });

  it('drops blank pieces', () => {
    expect(takeSentences('\n\n。 ').sentences).toEqual(['。']);
    expect(takeSentences(' \n ').sentences).toEqual([]);
  });
});

describe('detectLang', () => {
  it('kana means Japanese, otherwise Chinese', () => {
    expect(detectLang('ありがとう')).toBe('en');
    expect(detectLang('謝謝你')).toBe('zh');
  });
});

describe('SentenceBuffer', () => {
  it('holds a partial sentence until its terminator arrives (streamed deltas)', () => {
    const b = new SentenceBuffer();
    expect(b.push('你好')).toEqual([]);
    expect(b.push('嗎？我')).toEqual([{ text: '你好嗎？', lang: 'zh' }]);
    expect(b.flush()).toEqual([{ text: '我', lang: 'zh' }]);
    expect(b.flush()).toEqual([]);
  });

  it('a language switch flushes the pending text first, so an utterance is one language', () => {
    const b = new SentenceBuffer();
    expect(b.push('好的', 'zh')).toEqual([]);
    expect(b.push('はい。', 'en')).toEqual([{ text: '好的', lang: 'zh' }, { text: 'はい。', lang: 'en' }]);
  });

  it('without an explicit lang each sentence is detected on its own', () => {
    const b = new SentenceBuffer();
    expect(b.push('好。ありがとう。')).toEqual([{ text: '好。', lang: 'zh' }, { text: 'ありがとう。', lang: 'en' }]);
  });
});

describe('createSpeechQueue', () => {
  it('speaks one utterance per enqueued piece, in order, with the rate, pitch and volume', () => {
    const { spoken, q } = makeQueue();
    q.enqueue('第一句。', 'zh');
    q.enqueue('第二句。', 'zh');
    q.enqueue('こんにちは。', 'en');
    expect(spoken.map((u) => u.text)).toEqual(['第一句。', '第二句。', 'こんにちは。']);
    expect(spoken.map((u) => u.lang)).toEqual(['zh', 'zh', 'en']);
    expect(spoken[0]).toMatchObject({ rate: 1.05, pitch: 1, volume: 0.8 });
  });

  it('is busy from the first utterance until the last one ends', () => {
    const busy: boolean[] = [];
    const { spoken, q } = makeQueue({ onBusy: (b) => busy.push(b) });
    q.enqueue('一。', 'zh');
    q.enqueue('二。', 'zh');
    expect(q.busy()).toBe(true);
    spoken[0].onDone();
    expect(q.busy()).toBe(true);
    spoken[1].onDone();
    expect(q.busy()).toBe(false);
    expect(busy).toEqual([true, false]);
  });

  it('ignores blank text', () => {
    const { spoken, q } = makeQueue();
    q.enqueue('   ', 'zh');
    expect(spoken).toHaveLength(0);
    expect(q.busy()).toBe(false);
  });

  it('stop() cancels the engine and drops the queue; late callbacks of dropped utterances change nothing', () => {
    const busy: boolean[] = [];
    const { io, spoken, q } = makeQueue({ onBusy: (b) => busy.push(b) });
    q.enqueue('一。', 'zh');
    q.enqueue('二。', 'zh');
    q.stop();
    expect(io.cancels).toBe(1);
    expect(q.busy()).toBe(false);
    spoken[0].onDone();
    q.enqueue('三。', 'zh');
    expect(q.busy()).toBe(true);
    expect(busy).toEqual([true, false, true]);
  });

  it('a watchdog ends an utterance whose end event never comes', () => {
    vi.useFakeTimers();
    try {
      const { q } = makeQueue();
      q.enqueue('很長很長的一句話', 'zh');
      expect(q.busy()).toBe(true);
      vi.advanceTimersByTime(60_000);
      expect(q.busy()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createReplyVoice (reply bus → queue, lang routing)', () => {
  let queued: { text: string; lang: Lang }[];
  let stops: number;
  let on: boolean;
  const q = { enqueue: (text: string, lang: Lang) => queued.push({ text, lang }), stop: () => { stops++; } };
  let voice: ReturnType<typeof createReplyVoice>;

  beforeEach(() => {
    queued = [];
    stops = 0;
    on = true;
    voice = createReplyVoice(q, () => on);
  });
  afterEach(() => { on = true; });

  it('queues sentences as the deltas stream in, and flushes the tail on done', () => {
    voice({ type: 'start', id: 1 });
    voice({ type: 'delta', id: 1, text: '你好。我' });
    expect(queued).toEqual([{ text: '你好。', lang: 'zh' }]);
    voice({ type: 'delta', id: 1, text: '是她' });
    voice({ type: 'done', id: 1, text: '你好。我是她' });
    expect(queued.map((x) => x.text)).toEqual(['你好。', '我是她']);
  });

  it('routes each delta by its lang', () => {
    voice({ type: 'start', id: 2 });
    voice({ type: 'delta', id: 2, text: '看這個。', lang: 'zh' });
    voice({ type: 'delta', id: 2, text: 'これは本です。', lang: 'en' });
    voice({ type: 'done', id: 2, text: '' });
    expect(queued).toEqual([{ text: '看這個。', lang: 'zh' }, { text: 'これは本です。', lang: 'en' }]);
  });

  it('a reply that never streamed is spoken whole on done, sentence by sentence with detected langs', () => {
    voice({ type: 'start', id: 3 });
    voice({ type: 'done', id: 3, text: '好的。ありがとう' });
    expect(queued).toEqual([{ text: '好的。', lang: 'zh' }, { text: 'ありがとう', lang: 'en' }]);
  });

  it('start cancels the speech of the previous reply', () => {
    voice({ type: 'start', id: 4 });
    expect(stops).toBe(1);
  });

  it('error drops the unfinished tail; nothing is spoken for it', () => {
    voice({ type: 'start', id: 5 });
    voice({ type: 'delta', id: 5, text: '沒說完' });
    voice({ type: 'error', id: 5, message: 'x' });
    voice({ type: 'done', id: 5, text: '' });
    expect(queued).toEqual([]);
  });

  it('does nothing while the reply voice is switched off', () => {
    on = false;
    voice({ type: 'start', id: 6 });
    voice({ type: 'delta', id: 6, text: '安靜。' });
    voice({ type: 'done', id: 6, text: '安靜。' });
    expect(queued).toEqual([]);
  });
});

describe('pickVoice', () => {
  const voices = [
    { name: 'Google 粵語（香港）', lang: 'zh-HK' },
    { name: 'Ting-Ting', lang: 'zh-CN' },
    { name: 'Meijia', lang: 'zh-TW' },
    { name: 'Yu-shu', lang: 'zh-TW' },
    { name: 'Kyoko', lang: 'en-US' },
    { name: 'Otoya', lang: 'ja_JP' },
    { name: 'English', lang: 'en-US' },
  ];

  it('prefers zh-TW, then zh-HK, then zh-CN, and a female name inside the region', () => {
    expect(pickVoice(voices, 'zh')?.name).toBe('Meijia');
    expect(pickVoice(voices.filter((v) => v.lang !== 'zh-TW'), 'zh')?.name).toBe('Google 粵語（香港）');
    expect(pickVoice(voices.filter((v) => !v.lang.startsWith('zh-TW') && !v.lang.startsWith('zh-HK')), 'zh')?.name).toBe('Ting-Ting');
  });

  it('prefers en-US (Kyoko) and returns null when there is no matching language', () => {
    expect(pickVoice(voices, 'en')?.name).toBe('Kyoko');
    expect(pickVoice([{ name: 'English', lang: 'en-US' }], 'zh')).toBeNull();
  });
});

describe('speakableText', () => {
  it('drops bracket and quote marks so iOS does not read them aloud', async () => {
    const { speakableText } = await import('../tts');
    expect(speakableText('）')).toBe('');
    expect(speakableText('「を」喔！）')).toBe('を 喔！');
    expect(speakableText('（昨天在學校做了什麼呢？）')).toBe('昨天在學校做了什麼呢？');
    expect(speakableText('…！')).toBe('');
  });
});

describe('AsideFilter', () => {
  it('skips parenthesised asides, even when split across chunks', async () => {
    const { AsideFilter } = await import('../tts');
    const f = new AsideFilter();
    expect(f.push('こんばんは（晚')).toBe('こんばんは');
    expect(f.push('安）！今日は')).toBe('！今日は');
    expect(f.push('(kyou) いい天気')).toBe(' いい天気');
    expect(new AsideFilter().push('才不想你呢（其實很想）')).toBe('才不想你呢');
  });
});

describe('voice quality and the chosen voice', () => {
  const setLang = (lang: Lang, patch: Partial<LangVoice>) => setTtsSettings({ [lang]: { ...getTtsSettings()[lang], ...patch } } as Partial<TtsSettings>);
  afterEach(() => { setTtsSettings({ zh: TTS_DEFAULTS.zh, en: TTS_DEFAULTS.en }); });

  it('inside a region a high-quality voice beats the plain one, in either order', () => {
    const plain = { name: '美佳', lang: 'zh-TW' };
    const hq = { name: '美佳（高音質）', lang: 'zh-TW' };
    expect(pickVoice([plain, hq], 'zh')?.name).toBe('美佳（高音質）');
    expect(pickVoice([hq, plain], 'zh')?.name).toBe('美佳（高音質）');
  });

  it('auto mode still prefers zh-TW over a high-quality zh-CN voice', () => {
    const cn = { name: '月（高音質）', lang: 'zh-CN' };
    const tw = { name: '美佳', lang: 'zh-TW' };
    expect(pickVoice([cn, tw], 'zh')?.name).toBe('美佳');
    expect(pickVoice([tw, cn], 'zh')?.name).toBe('美佳');
  });

  it('chosenVoice returns the configured voice of that language, and falls back to auto when that voice is missing', () => {
    const voices = [{ name: '美佳', lang: 'zh-TW' }, { name: '月（高音質）', lang: 'zh-CN' }];
    setLang('zh', { voices: { browser: '月（高音質）' } });
    expect(chosenVoice(voices, 'zh')?.name).toBe('月（高音質）');
    expect(chosenVoice(voices, 'en')).toBeNull(); // the zh choice does not leak into ja
    setLang('zh', { voices: { browser: '不存在的聲音' } });
    expect(chosenVoice(voices, 'zh')?.name).toBe('美佳');
    setLang('zh', { voices: {} });
    expect(chosenVoice(voices, 'zh')?.name).toBe('美佳');
  });

  it('each language has its own 語速 and 音調; both are clamped to their ranges', () => {
    setLang('zh', { pitch: 5, rate: 9 });
    expect(getTtsSettings().zh).toMatchObject({ pitch: 1.3, rate: 1.3 });
    expect(getTtsSettings().en).toMatchObject({ pitch: 1, rate: 1.05 });
    setLang('en', { pitch: 0, rate: 0 });
    expect(getTtsSettings().en).toMatchObject({ pitch: 0.8, rate: 0.8 });
    expect(getTtsSettings().zh.pitch).toBe(1.3);
    setLang('zh', { pitch: 1.044, rate: 1.066 });
    expect(getTtsSettings().zh).toMatchObject({ pitch: 1.04, rate: 1.07 }); // snapped to the 0.01 step
  });

  it('each language keeps its own engine; an unknown engine name falls back to the browser', () => {
    setLang('zh', { engine: 'google' });
    expect(getTtsSettings()).toMatchObject({ zh: { engine: 'google' }, en: { engine: 'browser' } });
    setLang('en', { engine: 'nope' as never });
    expect(getTtsSettings().en.engine).toBe('browser');
  });

  it('the voice ids of each engine are kept per language; non-string ids become ""', () => {
    setLang('en', { voices: { azure: 'en-US-AvaNeural', google: 3 as never } });
    expect(getTtsSettings().en.voices).toEqual({ azure: 'en-US-AvaNeural' });
    expect(getTtsSettings().zh.voices).toEqual({});
  });
});

describe('migrateTtsSettings (per-language settings and the older one-engine save)', () => {
  it('an old save (one engine, rate and pitch, voices per language) applies the same values to both languages', () => {
    const m = migrateTtsSettings({
      on: false, rate: 1.2, pitch: 1.3, engine: 'azure', zhVoice: 'a', enVoice: 'b',
      azureZh: 'zh-TW-HsiaoYuNeural', azureEn: 'en-US-AvaNeural', googleZh: 'g1', googleEn: 'g2',
    });
    expect(m.on).toBe(false);
    expect(m.zh).toEqual({ engine: 'azure', rate: 1.2, pitch: 1.3, voices: { browser: 'a', azure: 'zh-TW-HsiaoYuNeural', google: 'g1' } });
    expect(m.en).toEqual({ engine: 'azure', rate: 1.2, pitch: 1.3, voices: { browser: 'b', azure: 'en-US-AvaNeural', google: 'g2' } });
  });

  it('an old save with out-of-range numbers and non-string voices is clamped and cleaned', () => {
    const m = migrateTtsSettings({ rate: 9, pitch: -3, zhVoice: 7, engine: 'nope' });
    expect(m.zh).toEqual({ engine: 'browser', rate: 1.3, pitch: 0.8, voices: {} });
    expect(m.en).toEqual({ engine: 'browser', rate: 1.3, pitch: 0.8, voices: {} });
  });

  it('nothing saved gives the defaults for both languages', () => {
    expect(migrateTtsSettings(null)).toEqual({
      on: true,
      zh: { engine: 'browser', rate: 1.05, pitch: 1, voices: {} },
      en: { engine: 'browser', rate: 1.05, pitch: 1, voices: {} },
    });
  });

  it('a per-language save is kept as it is', () => {
    const v2 = {
      on: true,
      zh: { engine: 'google', rate: 1.1, pitch: 1.1, voices: { google: 'cmn-TW-Wavenet-A' } },
      en: { engine: 'browser', rate: 1, pitch: 1, voices: { browser: 'Kyoko' } },
    };
    expect(migrateTtsSettings(v2)).toEqual(v2);
  });

  it('a saved v1 key is read when no v2 key exists (module load)', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === 'mugien.tts.v1' ? JSON.stringify({ on: true, rate: 1.2, pitch: 1.3, engine: 'google', googleZh: 'x', googleEn: 'y' }) : null),
      setItem() {},
    });
    try {
      const fresh = await import('../tts');
      expect(fresh.getTtsSettings().zh).toEqual({ engine: 'google', rate: 1.2, pitch: 1.3, voices: { google: 'x' } });
      expect(fresh.getTtsSettings().en).toEqual({ engine: 'google', rate: 1.2, pitch: 1.3, voices: { google: 'y' } });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('unlockSpeech (iOS: the first speak must come inside a user gesture)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('speaks a silent utterance synchronously and resumes the synth, so later replies are allowed', () => {
    const spoke: { text: string; volume: number }[] = [];
    const synth = { speak: vi.fn((u: { text: string; volume: number }) => { spoke.push(u); }), resume: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
    class Utt { text: string; volume = 1; lang = ''; constructor(t: string) { this.text = t; } }
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', Utt);
    unlockSpeech();
    expect(synth.speak).toHaveBeenCalledTimes(1); // called before unlockSpeech returns, i.e. inside the gesture
    expect(spoke[0]).toMatchObject({ text: '。', volume: 0 });
    expect(synth.resume).toHaveBeenCalled();
    expect(synth.cancel).not.toHaveBeenCalled(); // the unlock must not cancel anything by itself
  });
});

describe('createSpeechQueue with per-language settings (a mixed reply)', () => {
  it('each utterance gets its own language\'s 語速 and 音調', () => {
    const f = fakeIo();
    const q = createSpeechQueue({
      io: f.io,
      rate: (lang) => (lang === 'zh' ? 1.1 : 0.9),
      pitch: (lang) => (lang === 'zh' ? 1.1 : 1),
      volume: () => 0.8,
    });
    q.enqueue('你好，今天很好。', 'zh');
    q.enqueue('こんにちは。', 'en');
    expect(f.spoken.map((u) => [u.lang, u.rate, u.pitch])).toEqual([['zh', 1.1, 1.1], ['en', 0.9, 1]]);
  });
});
