import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { azureVoiceFor, browserFallback, googleVoiceFor, planTts, type TtsBody } from '../../../server/tts.ts';
import { UsageStore, crossesThreshold, freeOf, ttsBucket } from '../../../server/usage.ts';
import {
  fallbackTarget, firstFallbackThisMonth, pastFallbackAt, reportTtsFallback, onTtsFallbackNotice, type UsageData,
} from '../usageView';

const body = (engine: 'google' | 'azure', voice: string, text = '你好'): TtsBody => ({ engine, voice, text, rate: 1, pitch: 1 });
/** a usedOf over a fixed table of characters per engine/tier (missing → 0) */
const usedFrom = (t: Record<string, number>) => (e: 'google' | 'azure', tier: string) => t[`${e}:${tier}`] ?? 0;

describe('threshold math (90% of the free allowance, the request included)', () => {
  it('crosses only strictly above 90%: 900 of 1,000 with 100 more stays, 101 more crosses', () => {
    expect(crossesThreshold(800, 100, 1000)).toBe(false);
    expect(crossesThreshold(800, 101, 1000)).toBe(true);
    expect(crossesThreshold(0, 900, 1000)).toBe(false);
    expect(crossesThreshold(0, 901, 1000)).toBe(true);
  });

  it('never crosses a tier with no allowance', () => {
    expect(crossesThreshold(10_000_000, 10_000, undefined)).toBe(false);
    expect(freeOf('google', 'other')).toBeUndefined();
    expect(freeOf('google', 'neural2')).toBe(1_000_000);
    expect(freeOf('azure', 'neural')).toBe(500_000);
  });

  it('counts the request\'s own length: a long sentence can cross even when the tier is at 80%', () => {
    const w = ttsBucket('google', 'cmn-TW-Wavenet-A');
    expect(crossesThreshold(3_200_000, 0, freeOf('google', w.tier))).toBe(false);
    expect(crossesThreshold(3_200_000, 500_001, freeOf('google', w.tier))).toBe(true);
  });
});

describe('voice mapping', () => {
  it('maps a Google voice to the closest voice of another tier: same locale, then same letter', () => {
    expect(googleVoiceFor('cmn-TW-Wavenet-A', 'standard')?.id).toBe('cmn-TW-Standard-A');
    // no cmn-CN Standard voice in the allowlist: the same language family's Standard voice is the closest
    expect(googleVoiceFor('cmn-CN-Wavenet-D', 'standard')?.id).toBe('cmn-TW-Standard-A');
    expect(googleVoiceFor('en-US-Neural2-F', 'wavenet')?.id).toBe('en-US-Wavenet-F');
  });

  it('an English Neural2 voice maps to the English Standard voice of the same letter', () => {
    expect(googleVoiceFor('en-US-Neural2-F', 'standard')?.id).toBe('en-US-Standard-F');
    expect(googleVoiceFor('en-US-Neural2-D', 'standard')?.id).toBe('en-US-Standard-D');
  });

  it('maps any voice to an Azure voice of the same locale, else the same language', () => {
    expect(azureVoiceFor('cmn-TW-Wavenet-A')?.id).toBe('zh-TW-HsiaoChenNeural');
    expect(azureVoiceFor('cmn-CN-Wavenet-A')?.id).toBe('zh-CN-XiaoxiaoNeural');
    expect(azureVoiceFor('en-US-Neural2-F')?.id).toBe('en-US-AvaNeural');
    expect(azureVoiceFor('en-US-Chirp3-HD-Aoede')).toBeUndefined();
  });
});

describe('planTts: the requested tier while it is within 90%', () => {
  it('uses the requested engine and tier without a fallback', () => {
    const p = planTts(body('google', 'cmn-TW-Wavenet-A'), 10, usedFrom({ 'google:wavenet': 100 }), true);
    expect(p).toEqual({ kind: 'use', engine: 'google', voice: 'cmn-TW-Wavenet-A', requestedTier: 'wavenet', fallback: false });
  });
});

describe('planTts: fallback order', () => {
  it('Neural2 past 90% goes to WaveNet first (en), then Standard, then Azure when configured', () => {
    const used = usedFrom({ 'google:neural2': 950_000 });
    const p = planTts(body('google', 'en-US-Neural2-F', 'Hello there'), 5, used, true);
    expect(p).toEqual({ kind: 'use', engine: 'google', voice: 'en-US-Wavenet-F', requestedTier: 'neural2', fallback: true });
  });

  it('when the WaveNet option is also past 90%, the Standard voice is next', () => {
    const used = usedFrom({ 'google:neural2': 950_000, 'google:wavenet': 3_700_000 });
    const p = planTts(body('google', 'en-US-Neural2-F', 'Hello there'), 5, used, true);
    expect(p).toEqual({ kind: 'use', engine: 'google', voice: 'en-US-Standard-F', requestedTier: 'neural2', fallback: true });
  });

  it('when the WaveNet and Standard options are also past 90%, Azure is next', () => {
    const used = usedFrom({ 'google:neural2': 950_000, 'google:wavenet': 3_700_000, 'google:standard': 3_700_000 });
    const p = planTts(body('google', 'en-US-Neural2-F', 'Hello there'), 5, used, true);
    expect(p).toEqual({ kind: 'use', engine: 'azure', voice: 'en-US-AvaNeural', requestedTier: 'neural2', fallback: true });
  });

  it('a Chinese WaveNet past 90% goes to the Standard voice of the same locale', () => {
    const used = usedFrom({ 'google:wavenet': 3_700_000 });
    const p = planTts(body('google', 'cmn-TW-Wavenet-A'), 5, used, true);
    expect(p).toEqual({ kind: 'use', engine: 'google', voice: 'cmn-TW-Standard-A', requestedTier: 'wavenet', fallback: true });
  });

  it('a Standard request has nowhere Google to go and falls to Azure', () => {
    const used = usedFrom({ 'google:standard': 3_700_000 });
    const p = planTts(body('google', 'cmn-TW-Standard-A'), 5, used, true);
    expect(p).toEqual({ kind: 'use', engine: 'azure', voice: 'zh-TW-HsiaoChenNeural', requestedTier: 'standard', fallback: true });
  });

  it('an Azure request past its allowance goes to the browser (no Google fallback for Azure)', () => {
    const used = usedFrom({ 'azure:neural': 460_000 });
    expect(planTts(body('azure', 'zh-TW-HsiaoChenNeural'), 50_000, used, true)).toEqual({ kind: 'browser', requestedTier: 'neural' });
  });
});

describe('planTts: Azure not configured and the browser', () => {
  it('with Azure unconfigured, a fully used Neural2 goes to the browser', () => {
    const used = usedFrom({ 'google:neural2': 950_000, 'google:wavenet': 3_700_000, 'google:standard': 3_700_000 });
    expect(planTts(body('google', 'en-US-Neural2-F'), 5, used, false)).toEqual({ kind: 'browser', requestedTier: 'neural2' });
  });

  it('with Azure over 90% too, it also goes to the browser', () => {
    const used = usedFrom({ 'google:wavenet': 3_700_000, 'google:standard': 3_700_000, 'azure:neural': 460_000 });
    expect(planTts(body('google', 'cmn-TW-Wavenet-A'), 5, used, true)).toEqual({ kind: 'browser', requestedTier: 'wavenet' });
  });

  it('the browser response is a 429 with the fallback marked for the client', () => {
    const fb = browserFallback('neural2');
    expect(fb.status).toBe(429);
    expect(fb.headers).toEqual({ 'X-TTS-Fallback': 'browser', 'X-TTS-Requested-Tier': 'neural2' });
    expect(fb.body).toMatchObject({ fallback: 'browser', reason: 'free-tier' });
  });
});

describe('month reset', () => {
  it('the used characters start again in a new month', () => {
    let now = new Date(2026, 0, 31, 23, 0);
    const dir = mkdtempSync(join(tmpdir(), 'mugi-tutor-fallback-'));
    try {
      const s = new UsageStore({ file: join(dir, 'u.json'), now: () => now, debounceMs: 60_000 });
      s.recordTts({ engine: 'google', tier: 'neural2' }, { ok: true, chars: 990_000 });
      expect(s.ttsUsed('google', 'neural2')).toBe(990_000);
      // 990,000 of 1,000,000 is past 90%: this month the request already falls to WaveNet
      expect(planTts(body('google', 'en-US-Neural2-F'), 5, (e, t) => s.ttsUsed(e, t), false)).toMatchObject({ kind: 'use', voice: 'en-US-Wavenet-F', fallback: true });
      now = new Date(2026, 1, 1, 0, 5);
      expect(s.ttsUsed('google', 'neural2')).toBe(0);
      expect(planTts(body('google', 'en-US-Neural2-F'), 5, (e, t) => s.ttsUsed(e, t), false)).toEqual({
        kind: 'use', engine: 'google', voice: 'en-US-Neural2-F', requestedTier: 'neural2', fallback: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('client side: fallback display and one-time notice', () => {
  const m = (chars: Record<string, number>) => ({
    tts: { google: Object.fromEntries(Object.entries(chars).map(([t, c]) => [t, { requests: 1, failures: 0, chars: c, cacheHits: 0 }])), azure: {} },
    claude: {},
  });
  const d: UsageData = {
    months: { '2026-10': m({ neural2: 950_000, wavenet: 100 }), '2026-09': m({ neural2: 10 }) },
    current: '2026-10',
    freeTier: { google: { standard: 4_000_000, wavenet: 4_000_000, neural2: 1_000_000 }, azure: { neural: 500_000 } },
  };

  it('a tier at 90% or more is past the threshold; a tier under it is not', () => {
    expect(pastFallbackAt(d, '2026-10', 'google', 'neural2')).toBe(true);
    expect(pastFallbackAt(d, '2026-10', 'google', 'wavenet')).toBe(false);
    expect(pastFallbackAt(d, '2026-09', 'google', 'neural2')).toBe(false);
  });

  it('names the next option in the chain: WaveNet, then Standard, Azure, the browser', () => {
    expect(fallbackTarget(d, '2026-10', 'neural2', true)).toBe('WaveNet');
    const full = { ...d, months: { '2026-10': m({ neural2: 950_000, wavenet: 3_700_000 }) } };
    expect(fallbackTarget(full, '2026-10', 'neural2', true)).toBe('Standard');
    const all = { ...d, months: { '2026-10': m({ neural2: 950_000, wavenet: 3_700_000, standard: 3_700_000 }) } };
    expect(fallbackTarget(all, '2026-10', 'neural2', true)).toBe('Azure');
    expect(fallbackTarget(all, '2026-10', 'neural2', false)).toBe('瀏覽器內建語音');
  });

  describe('one-time notice', () => {
    let store: Record<string, string>;
    beforeEach(() => {
      store = {};
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
      });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is announced the first time in a month and not again that month, but again in the next', () => {
      const texts: string[] = [];
      const off = onTtsFallbackNotice((t) => texts.push(t));
      reportTtsFallback('neural2', 'WaveNet', new Date(2026, 9, 3));
      reportTtsFallback('neural2', 'WaveNet', new Date(2026, 9, 4));
      reportTtsFallback('neural2', 'WaveNet', new Date(2026, 10, 1));
      off();
      expect(texts).toEqual(['Neural2 已達 90%，本月改用 WaveNet', 'Neural2 已達 90%，本月改用 WaveNet']);
    });

    it('treats unavailable storage as already announced (no crash)', () => {
      vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
      expect(firstFallbackThisMonth('2026-10')).toBe(false);
    });
  });
});

describe('Neural2 is counted conservatively', () => {
  it('Neural2 counts UTF-8 bytes, Standard / WaveNet / Azure count characters', async () => {
    const { billedChars } = await import('../../../server/usage');
    expect(billedChars('こんにちは', 'google', 'neural2')).toBe(15);
    expect(billedChars('こんにちは', 'google', 'wavenet')).toBe(5);
    expect(billedChars('こんにちは', 'google', 'standard')).toBe(5);
    expect(billedChars('你好 hi', 'azure', 'neural')).toBe(5);
    expect(billedChars('你好 hi')).toBe(5);
  });
  it('the plan checks each tier with its own count', async () => {
    const { planTts } = await import('../../../server/tts');
    const { billedChars } = await import('../../../server/usage');
    const text = 'こんにちは'; // 15 bytes for Neural2, 5 characters for WaveNet
    // Neural2 at 899,990: + 5 chars would fit under 900,000, + 15 bytes does not → falls back to WaveNet
    const used = (e: string, t: string) => (e === 'google' && t === 'neural2' ? 899_990 : 0);
    const p = planTts({ engine: 'google', voice: 'en-US-Neural2-F', text, rate: 1, pitch: 1 }, (e, t) => billedChars(text, e, t), used, false);
    expect(p).toMatchObject({ kind: 'use', fallback: true });
  });
});
