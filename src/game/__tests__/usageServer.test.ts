import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TTS_FREE_TIER, UsageStore, billedChars, claudeCostUsd, googleTier, monthKey, normalizeModel, ttsBucket, usageRoute,
} from '../../../server/usage.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mugi-tutor-usage-')); });
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe('month key', () => {
  it('is the local calendar month, zero-padded', () => {
    expect(monthKey(at(2026, 1, 5))).toBe('2026-01');
    expect(monthKey(at(2026, 10, 20))).toBe('2026-10');
  });
});

describe('usage store: month rollover', () => {
  it('counts into the month of the clock and starts a new month at zero', () => {
    let now = at(2026, 1, 31, 23);
    const s = new UsageStore({ file: join(dir, 'u.json'), now: () => now, debounceMs: 60_000 });
    s.recordTts({ engine: 'google', tier: 'wavenet' }, { ok: true, chars: 100 });
    now = at(2026, 2, 1, 0);
    s.recordTts({ engine: 'google', tier: 'wavenet' }, { ok: true, chars: 7 });
    const snap = s.snapshot();
    expect(snap.current).toBe('2026-02');
    expect(Object.keys(snap.months)).toEqual(['2026-02', '2026-01']);
    expect(snap.months['2026-01'].tts.google.wavenet.chars).toBe(100);
    expect(snap.months['2026-02'].tts.google.wavenet.chars).toBe(7);
  });

  it('shows the current month as empty before its first request', () => {
    const s = new UsageStore({ file: join(dir, 'u.json'), now: () => at(2026, 3, 9) });
    const snap = s.snapshot();
    expect(snap.current).toBe('2026-03');
    expect(snap.months['2026-03']).toEqual({ tts: { google: {}, azure: {} }, claude: {} });
  });
});

describe('usage store: persistence', () => {
  it('survives a restart: a new store reads what the old one flushed', () => {
    const file = join(dir, '.usage', 'usage.json');
    const a = new UsageStore({ file, now: () => at(2026, 10, 20), debounceMs: 60_000 });
    a.recordTts({ engine: 'google', tier: 'neural2' }, { ok: true, chars: 42 });
    a.recordTtsCacheHit({ engine: 'google', tier: 'neural2' });
    a.recordClaude('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500 });
    a.flush();
    const b = new UsageStore({ file, now: () => at(2026, 10, 20) });
    expect(b.snapshot().months['2026-10']).toEqual(a.snapshot().months['2026-10']);
    expect(b.snapshot().months['2026-10'].tts.google.neural2).toEqual({ requests: 1, failures: 0, chars: 42, cacheHits: 1, fallbacks: 0 });
  });

  it('writes through a temp file and leaves no temp file behind', () => {
    const file = join(dir, 'usage.json');
    const s = new UsageStore({ file, now: () => at(2026, 10, 20), debounceMs: 60_000 });
    s.recordTts({ engine: 'azure', tier: 'neural' }, { ok: true, chars: 5 });
    s.flush();
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('moves an unreadable file aside and starts empty instead of crashing', () => {
    const file = join(dir, 'usage.json');
    writeFileSync(file, '{not json', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new UsageStore({ file, now: () => at(2026, 10, 20) });
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith('usage.json.bad-'))).toBe(true);
    expect(s.snapshot().months['2026-10'].claude).toEqual({});
    warn.mockRestore();
  });
});

describe('usage store: debounced writes', () => {
  it('saves once, after the last change plus the debounce delay', () => {
    vi.useFakeTimers();
    const file = join(dir, 'usage.json');
    const s = new UsageStore({ file, now: () => at(2026, 10, 20), debounceMs: 2000 });
    s.recordTts({ engine: 'google', tier: 'standard' }, { ok: true, chars: 10 });
    s.recordTts({ engine: 'google', tier: 'standard' }, { ok: true, chars: 20 });
    s.recordTts({ engine: 'google', tier: 'standard' }, { ok: false, chars: 0 });
    expect(s.writes).toBe(0);
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(1999);
    expect(s.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(s.writes).toBe(1);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.months['2026-10'].tts.google.standard).toEqual({ requests: 3, failures: 1, chars: 30, cacheHits: 0, fallbacks: 0 });
  });

  it('does not write when nothing changed', () => {
    vi.useFakeTimers();
    const s = new UsageStore({ file: join(dir, 'usage.json'), now: () => at(2026, 10, 20), debounceMs: 2000 });
    s.flush();
    vi.advanceTimersByTime(5000);
    expect(s.writes).toBe(0);
  });
});

describe('TTS counting', () => {
  it('maps a Google voice id to its tier', () => {
    expect(googleTier('cmn-TW-Wavenet-A')).toBe('wavenet');
    expect(googleTier('cmn-CN-Wavenet-D')).toBe('wavenet');
    expect(googleTier('cmn-TW-Standard-A')).toBe('standard');
    expect(googleTier('en-US-Neural2-F')).toBe('neural2');
    expect(googleTier('en-US-Chirp3-HD-Aoede')).toBe('chirp3-hd');
    expect(googleTier('en-US-Studio-O')).toBe('studio');
    expect(googleTier('something-else')).toBe('other');
  });

  it('puts Azure in its own neural bucket and Google by tier', () => {
    expect(ttsBucket('azure', 'zh-TW-HsiaoChenNeural')).toEqual({ engine: 'azure', tier: 'neural' });
    expect(ttsBucket('google', 'cmn-TW-Wavenet-A')).toEqual({ engine: 'google', tier: 'wavenet' });
  });

  it('bills one character per code point: CJK, kana, punctuation and emoji each count 1', () => {
    expect(billedChars('你好ABC，')).toBe(6);
    expect(billedChars('こんにちは')).toBe(5);
    expect(billedChars('😀😀')).toBe(2);
    expect(billedChars('')).toBe(0);
  });

  it('counts per tier, and a failed call adds a request and a failure but no characters', () => {
    const s = new UsageStore({ file: join(dir, 'u.json'), now: () => at(2026, 10, 20), debounceMs: 60_000 });
    const wav = ttsBucket('google', 'cmn-TW-Wavenet-A');
    const std = ttsBucket('google', 'cmn-TW-Standard-A');
    s.recordTts(wav, { ok: true, chars: billedChars('你好世界') });
    s.recordTts(wav, { ok: false, chars: 0 });
    s.recordTts(std, { ok: true, chars: 3 });
    s.recordTts(ttsBucket('azure', 'en-US-AvaNeural'), { ok: true, chars: 2 });
    const m = s.snapshot().months['2026-10'];
    expect(m.tts.google.wavenet).toEqual({ requests: 2, failures: 1, chars: 4, cacheHits: 0, fallbacks: 0 });
    expect(m.tts.google.standard.chars).toBe(3);
    expect(m.tts.azure.neural.chars).toBe(2);
  });

  it('exposes the free allowances the client shows', () => {
    expect(TTS_FREE_TIER.google).toEqual({ standard: 4_000_000, wavenet: 4_000_000, neural2: 1_000_000 });
    expect(TTS_FREE_TIER.azure.neural).toBe(500_000);
  });
});

describe('Claude cost math', () => {
  it('prices Opus 5.5 at $4 in / $20 out per million, cache write 1.25x, cache read 0.1x', () => {
    const m = 'claude-opus-5-5';
    expect(claudeCostUsd(m, { input_tokens: 1_000_000 })).toBeCloseTo(4, 10);
    expect(claudeCostUsd(m, { output_tokens: 1_000_000 })).toBeCloseTo(20, 10);
    expect(claudeCostUsd(m, { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(5, 10);
    expect(claudeCostUsd(m, { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.4, 10);
    expect(claudeCostUsd(m, { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: null, cache_read_input_tokens: null }))
      .toBeCloseTo((100 * 4 + 50 * 20) / 1e6, 12);
  });

  it('prices Haiku 5.5 in two bands by the whole prompt (input + cache), at 100K tokens or fewer and above', () => {
    const h = 'claude-haiku-5-5';
    // 100,000 prompt tokens: first band, $0.10 in / $0.50 out (per million)
    expect(claudeCostUsd(h, { input_tokens: 100_000, output_tokens: 1_000_000 })).toBeCloseTo(100_000 * 0.1 / 1e6 + 0.5, 10);
    // 100,001 prompt tokens: second band, $0.50 in / $2.50 out
    expect(claudeCostUsd(h, { input_tokens: 100_001 })).toBeCloseTo(100_001 * 0.5 / 1e6, 12);
    // the prompt is 60K input + 50K cache read = 110K: second band, cache read at 0.1x of $0.50
    expect(claudeCostUsd(h, { input_tokens: 60_000, cache_read_input_tokens: 50_000 }))
      .toBeCloseTo(60_000 * 0.5 / 1e6 + 50_000 * 0.1 * 0.5 / 1e6, 12);
  });

  it('prices a dated snapshot as its alias, and returns null for a model with no price', () => {
    expect(normalizeModel('claude-opus-5-5-20261001')).toBe('claude-opus-5-5');
    expect(claudeCostUsd('claude-opus-5-5-20261001', { input_tokens: 1_000_000 })).toBeCloseTo(4, 10);
    expect(claudeCostUsd('some-unknown-model', { input_tokens: 1_000_000 })).toBeNull();
  });

  it('aggregates per model: tokens, requests, errors, cost and unpriced responses', () => {
    const s = new UsageStore({ file: join(dir, 'u.json'), now: () => at(2026, 10, 20), debounceMs: 60_000 });
    s.recordClaude('claude-opus-5-5', { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 });
    s.recordClaude('claude-opus-5-5-20261001', { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0 });
    s.recordClaudeError('claude-opus-5-5');
    s.recordClaude('mystery-model', { input_tokens: 10, output_tokens: 10 });
    const m = s.snapshot().months['2026-10'].claude;
    expect(Object.keys(m).sort()).toEqual(['claude-opus-5-5', 'mystery-model']);
    const op = m['claude-opus-5-5'];
    expect(op.requests).toBe(3);
    expect(op.errors).toBe(1);
    expect(op.inputTokens).toBe(1500);
    expect(op.outputTokens).toBe(150);
    expect(op.cacheWriteTokens).toBe(200);
    expect(op.cacheReadTokens).toBe(300);
    const expected = claudeCostUsd('claude-opus-5-5', { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 })!
      + claudeCostUsd('claude-opus-5-5', { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0 })!;
    expect(op.costUsd).toBeCloseTo(expected, 12);
    expect(op.unpriced).toBe(0);
    // a model with no price is charged at the priciest band (fable's 10 in / 50 out per million): 10 in + 10 out
    expect(m['mystery-model']).toMatchObject({ requests: 1, unpriced: 1, inputTokens: 10 });
    expect(m['mystery-model'].costUsd).toBeCloseTo(10 * 10 / 1e6 + 10 * 50 / 1e6, 12);
  });
});

describe('GET /api/usage', () => {
  function fakeRes() {
    const r = { status: 0, headers: {} as Record<string, unknown>, body: '', headersSent: false };
    return {
      r,
      writeHead(status: number, headers: Record<string, unknown>) { r.status = status; r.headers = headers; r.headersSent = true; return this; },
      end(b?: string) { r.body = b ?? ''; },
    };
  }

  it('returns { months, current, freeTier } with the current month present', () => {
    const s = new UsageStore({ file: join(dir, 'u.json'), now: () => at(2026, 10, 20), debounceMs: 60_000 });
    s.recordClaude('claude-haiku-5-5', { input_tokens: 10, output_tokens: 5 });
    const f = fakeRes();
    usageRoute(s, { method: 'GET', url: '/' }, f as never);
    expect(f.r.status).toBe(200);
    const j = JSON.parse(f.r.body);
    expect(Object.keys(j).sort()).toEqual(['current', 'freeTier', 'months']);
    expect(j.current).toBe('2026-10');
    expect(j.freeTier.google.wavenet).toBe(4_000_000);
    const m = j.months['2026-10'];
    expect(Object.keys(m).sort()).toEqual(['claude', 'tts']);
    expect(m.claude['claude-haiku-5-5'].requests).toBe(1);
    expect(m.tts).toEqual({ google: {}, azure: {} });
  });

  it('is read-only: other methods and paths are 404', () => {
    const s = new UsageStore({ file: join(dir, 'u.json'), now: () => at(2026, 10, 20), debounceMs: 60_000 });
    const post = fakeRes();
    usageRoute(s, { method: 'POST', url: '/' }, post as never);
    expect(post.r.status).toBe(404);
    const reset = fakeRes();
    usageRoute(s, { method: 'POST', url: '/api/usage/reset' }, reset as never);
    expect(reset.r.status).toBe(404);
  });
});
