import { describe, expect, it } from 'vitest';
import { CLOUD_TTS_CALL_MS, TTS_VOICES, azureRequest, cloudSynthesize, engineConfigured, escapeXml, googlePitch, googleRequest, parseTtsBody, pct, ttsStatus, type TtsConfig } from '../../../server/tts.ts';

const NONE: TtsConfig = { azureKey: '', azureRegion: '', googleKey: '' };
const ALL: TtsConfig = { azureKey: 'AZ-SECRET', azureRegion: 'eastasia', googleKey: 'G-SECRET' };

describe('pct (SSML prosody percentages)', () => {
  it('formats signed whole percents', () => {
    expect(pct(0.05)).toBe('+5%');
    expect(pct(-0.1)).toBe('-10%');
    expect(pct(0)).toBe('+0%');
    expect(pct(-0.004)).toBe('+0%');
    expect(pct(0.3)).toBe('+30%');
  });
});

describe('escapeXml', () => {
  it('escapes & < > " and \'', () => {
    expect(escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
    expect(escapeXml('你好 ABC')).toBe('你好 ABC');
  });
});

describe('azureRequest', () => {
  const req = azureRequest('eastasia', 'AZ-SECRET', 'zh-TW-HsiaoChenNeural', '看<這>&"吧"', 1.05, 1);

  it('posts to the region host, with the key in its header and the format / agent headers', () => {
    expect(req.url).toBe('https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
    const h = req.init.headers as Record<string, string>;
    expect(h['Ocp-Apim-Subscription-Key']).toBe('AZ-SECRET');
    expect(h['Content-Type']).toBe('application/ssml+xml');
    expect(h['X-Microsoft-OutputFormat']).toBe('audio-24khz-48kbitrate-mono-mp3');
    expect(h['User-Agent']).toBe('mugi-tutor');
    expect(req.init.method).toBe('POST');
  });

  it('never puts the key in the URL', () => {
    expect(req.url).not.toContain('AZ-SECRET');
  });

  it('builds SSML with the voice, its language, the prosody and the escaped text', () => {
    const body = req.init.body as string;
    expect(body).toContain('xml:lang="zh-TW"');
    expect(body).toContain('<voice name="zh-TW-HsiaoChenNeural">');
    expect(body).toContain('<prosody rate="+5%" pitch="+0%">');
    expect(body).toContain('看&lt;這&gt;&amp;&quot;吧&quot;');
    expect(body).not.toContain('<這>');
  });

  it('maps rate and pitch to percentages (pitch is halved)', () => {
    const body = azureRequest('eastasia', 'k', 'en-US-AvaNeural', 'はい', 0.8, 1.4).init.body as string;
    expect(body).toContain('xml:lang="en-US"');
    expect(body).toContain('<prosody rate="-20%" pitch="+20%">');
  });

  it('refuses a voice outside the allowlist', () => {
    expect(() => azureRequest('eastasia', 'k', 'en-US-DavisNeural', 'hi', 1, 1)).toThrow();
  });
});

describe('googlePitch and googleRequest', () => {
  it('maps the client pitch (0.5..2) to semitones -10..+20, one decimal, clamped', () => {
    expect(googlePitch(1)).toBe(0);
    expect(googlePitch(1.4)).toBe(8);
    expect(googlePitch(2)).toBe(20);
    expect(googlePitch(0.5)).toBe(-10);
    expect(googlePitch(1.234)).toBe(4.7);
    expect(googlePitch(3)).toBe(20);
  });

  const req = googleRequest('G-SECRET', 'en-US-Neural2-F', 'はい、わかりました', 1.1, 1.4);

  it('keeps the key in the X-Goog-Api-Key header, never in the URL', () => {
    expect(req.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(req.url).not.toContain('G-SECRET');
    expect((req.init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('G-SECRET');
    expect(req.init.method).toBe('POST');
  });

  it('sends the input, the voice (BCP-47 languageCode) and the audio config', () => {
    const body = JSON.parse(req.init.body as string);
    expect(body).toEqual({
      input: { text: 'はい、わかりました' },
      voice: { languageCode: 'en-US', name: 'en-US-Neural2-F' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.1, pitch: 8 },
    });
  });

  it('uses the cmn-* language codes for the Chinese voices', () => {
    const body = JSON.parse(googleRequest('k', 'cmn-TW-Wavenet-A', '你好', 1, 1).init.body as string);
    expect(body.voice).toEqual({ languageCode: 'cmn-TW', name: 'cmn-TW-Wavenet-A' });
  });

  it('refuses a voice outside the allowlist', () => {
    expect(() => googleRequest('k', 'en-US-Wavenet-A', 'hi', 1, 1)).toThrow();
  });
});

describe('parseTtsBody (request validation)', () => {
  const ok = { engine: 'azure', voice: 'zh-TW-HsiaoChenNeural', text: '你好', rate: 1.05, pitch: 1 };

  it('accepts a well-formed body', () => {
    expect(parseTtsBody(JSON.stringify(ok))).toEqual(ok);
  });

  it('accepts the male Japanese voices of the characters (Azure, Google) and lists them', () => {
    for (const voice of ['en-US-AndrewNeural', 'en-US-BrianNeural']) {
      expect(parseTtsBody(JSON.stringify({ ...ok, engine: 'azure', voice, text: 'こんにちは' })).voice).toBe(voice);
      expect(TTS_VOICES.azure.en.map((v) => v.id)).toContain(voice);
    }
    for (const voice of ['en-US-Neural2-D', 'en-US-Neural2-D', 'en-US-Wavenet-D']) {
      expect(parseTtsBody(JSON.stringify({ ...ok, engine: 'google', voice, text: 'こんにちは' })).voice).toBe(voice);
      expect(TTS_VOICES.google.en.map((v) => v.id)).toContain(voice);
    }
    // the first of each list stays the default (the female voice)
    expect(TTS_VOICES.azure.en[0].id).toBe('en-US-AvaNeural');
    expect(TTS_VOICES.google.en[0].id).toBe('en-US-Neural2-F');
  });

  it('rejects a voice that the engine does not offer (also a voice of the other engine)', () => {
    expect(() => parseTtsBody(JSON.stringify({ ...ok, voice: 'cmn-TW-Wavenet-A' }))).toThrow();
    expect(() => parseTtsBody(JSON.stringify({ ...ok, voice: 'zh-TW-HsiaoChenNeural; rm' }))).toThrow();
  });

  it('rejects unknown engines, empty text and text over 500 characters', () => {
    expect(() => parseTtsBody(JSON.stringify({ ...ok, engine: 'amazon' }))).toThrow();
    expect(() => parseTtsBody(JSON.stringify({ ...ok, text: '   ' }))).toThrow();
    expect(() => parseTtsBody(JSON.stringify({ ...ok, text: '字'.repeat(501) }))).toThrow();
    expect(parseTtsBody(JSON.stringify({ ...ok, text: '字'.repeat(500) })).text.length).toBe(500);
  });

  it('rejects non-JSON', () => {
    expect(() => parseTtsBody('{nope')).toThrow();
  });

  it('clamps rate and pitch to 0.5..2 and defaults them to 1', () => {
    expect(parseTtsBody(JSON.stringify({ ...ok, rate: 9, pitch: 0.1 }))).toMatchObject({ rate: 2, pitch: 0.5 });
    expect(parseTtsBody(JSON.stringify({ ...ok, rate: 'fast', pitch: NaN }))).toMatchObject({ rate: 1, pitch: 1 });
  });
});

describe('engine configuration and status', () => {
  it('an engine is configured only with its key (Azure also needs a region)', () => {
    expect(engineConfigured(NONE, 'azure')).toBe(false);
    expect(engineConfigured(NONE, 'google')).toBe(false);
    expect(engineConfigured({ ...ALL, azureRegion: '' }, 'azure')).toBe(false);
    expect(engineConfigured({ ...ALL, azureRegion: 'evil.example.com/x' }, 'azure')).toBe(false);
    expect(engineConfigured(ALL, 'azure')).toBe(true);
    expect(engineConfigured({ ...ALL, googleKey: '' }, 'google')).toBe(false);
    expect(engineConfigured(ALL, 'google')).toBe(true);
  });

  it('status reports booleans and the voice lists, never the keys', () => {
    const s = ttsStatus({ ...ALL, googleKey: '' });
    expect(s).toEqual({ azure: true, google: false, voices: TTS_VOICES });
    expect(JSON.stringify(s)).not.toContain('SECRET');
  });

  it('each engine lists its default voice first', () => {
    expect(TTS_VOICES.azure.zh[0].id).toBe('zh-TW-HsiaoChenNeural');
    expect(TTS_VOICES.azure.en[0].id).toBe('en-US-AvaNeural');
    expect(TTS_VOICES.google.zh[0].id).toBe('cmn-TW-Wavenet-A');
    expect(TTS_VOICES.google.en[0].id).toBe('en-US-Neural2-F');
  });
});

describe('cloud TTS: a request that never answers gives up at the limit (a failed request)', () => {
  const ref = { engine: 'azure' as const, voice: TTS_VOICES.azure.zh[0].id, text: '你好', rate: 1, pitch: 1 };
  // a fetch that only ends when its signal aborts, the way a stalled connection behaves
  const hangs = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const s = init?.signal;
    s?.addEventListener('abort', () => reject(s.reason));
  })) as unknown as typeof fetch;

  it('the limit is 20 seconds', () => {
    expect(CLOUD_TTS_CALL_MS).toBe(20_000);
  });

  it('a fetch that never answers is aborted at the limit and becomes a 502 upstream error', async () => {
    const started = Date.now();
    await expect(cloudSynthesize(ALL, ref, hangs, 50)).rejects.toMatchObject({ status: 502, code: 'upstream' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a response whose body never finishes is cut off at the same limit', async () => {
    // the headers arrive at once; the body then stalls until the signal aborts
    const f = ((_url: string, init?: RequestInit) => {
      const s = init?.signal;
      const arrayBuffer = () => new Promise<ArrayBuffer>((_res, rej) => s?.addEventListener('abort', () => rej(s.reason)));
      return Promise.resolve({ ok: true, arrayBuffer });
    }) as unknown as typeof fetch;
    await expect(cloudSynthesize(ALL, ref, f, 50)).rejects.toMatchObject({ status: 502, code: 'upstream' });
  });

  it('a prompt answer is returned as the audio, and the signal handed to fetch is not aborted', async () => {
    let signal: AbortSignal | undefined;
    const ok = ((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    }) as unknown as typeof fetch;
    const buf = await cloudSynthesize(ALL, ref, ok);
    expect([...buf]).toEqual([1, 2, 3]);
    expect(signal?.aborted).toBe(false);
  });
});
