import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkApiRequest, guardApi } from '../../../server/apiGuard.ts';
import {
  CHAT_MAX_ACTIVE, parseChatPerMinute, parseDailyUsd, releaseChatSlot, takeChatSlot, type ChatSlots,
} from '../../../server/claudeChat.ts';
import { dailyLimitHit, UsageStore } from '../../../server/usage.ts';
import { TTS_CACHE_MEM_MAX_BYTES, TtsCache } from '../../../server/ttsCache.ts';
import { sameOriginRequest } from '../../../server/tts.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mugi-tutor-guard-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const same = { host: 'localhost:3004', origin: 'http://localhost:3004' };
// the requests here come over a loopback socket (this PC); the guard refuses a request with no socket or a LAN socket
const LOOP = { socket: { remoteAddress: '127.0.0.1' } };

describe('API guard: checkApiRequest', () => {
  it('refuses a cross-site request (Sec-Fetch-Site)', () => {
    const r = checkApiRequest({ ...LOOP, method: 'POST', headers: { ...same, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3004', 'sec-fetch-site': 'cross-site' } })).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses an Origin whose host (name and port) is not the Host header', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3004', origin: 'https://evil.example' } })).toMatchObject({ ok: false, status: 403 });
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3004', origin: 'http://localhost:3005' } })).toMatchObject({ ok: false, status: 403 });
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3004', origin: 'http://127.0.0.1:3004' } })).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses Origin 'null' (sandboxed or opaque origins)", () => {
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'localhost:3004', origin: 'null', 'content-type': 'application/json' } })).toMatchObject({ ok: false, status: 403 });
  });

  it('allows a same-origin request, with the Host compared case-insensitively', () => {
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { ...same, 'content-type': 'application/json' } })).toEqual({ ok: true });
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'LocalHost:3004', origin: 'http://localhost:3004', 'content-type': 'application/json; charset=utf-8' } })).toEqual({ ok: true });
  });

  it('refuses a POST whose Content-Type is text/plain with 415', () => {
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { ...same, 'content-type': 'text/plain' } })).toMatchObject({ ok: false, status: 415 });
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'localhost:3004' } })).toMatchObject({ ok: false, status: 415 });
    expect(checkApiRequest({ ...LOOP, method: 'PUT', headers: { host: 'localhost:3004', 'content-type': 'text/plain' } })).toMatchObject({ ok: false, status: 415 });
    expect(checkApiRequest({ ...LOOP, method: 'DELETE', headers: { host: 'localhost:3004', 'content-type': 'text/plain' } })).toMatchObject({ ok: false, status: 415 });
  });

  it('does not check Content-Type on GET', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3004', origin: 'http://localhost:3004' } })).toEqual({ ok: true });
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3004', 'content-type': 'text/plain' } })).toEqual({ ok: true });
  });

  it('lets a request without Origin through (curl, the Vite proxy) when the other rules pass', () => {
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'localhost:3004', 'content-type': 'application/json' } })).toEqual({ ok: true });
  });

  it('guardApi answers the refused request itself and never calls the handler', () => {
    const handler = vi.fn();
    const writeHead = vi.fn();
    const end = vi.fn();
    const res = { writeHead, end } as unknown as ServerResponse;
    const req = { ...LOOP, method: 'POST', headers: { host: 'localhost:3004', 'content-type': 'text/plain' } } as unknown as IncomingMessage;
    guardApi(handler)(req, res);
    expect(handler).not.toHaveBeenCalled();
    expect(writeHead).toHaveBeenCalledWith(415, expect.anything());
    expect(JSON.parse(end.mock.calls[0][0] as string)).toMatchObject({ error: 'forbidden' });

    const ok = { ...LOOP, method: 'POST', headers: { ...same, 'content-type': 'application/json' } } as unknown as IncomingMessage;
    guardApi(handler)(ok, res);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('sameOriginRequest keeps its old answers (it is the GET form of the same rule)', () => {
    expect(sameOriginRequest({ ...LOOP, origin: 'http://localhost:3004', host: 'localhost:3004' })).toBe(true);
    expect(sameOriginRequest({ ...LOOP, origin: 'https://evil.example', host: 'localhost:3004' })).toBe(false);
    expect(sameOriginRequest({ ...LOOP, origin: 'null', host: 'localhost:3004' })).toBe(false);
    expect(sameOriginRequest({ ...LOOP, origin: 'http://localhost:3004', host: 'localhost:3004', 'sec-fetch-site': 'cross-site' })).toBe(false);
  });
});

describe('chat slots: per-minute start limit and concurrency', () => {
  it('allows perMinute starts in a sliding minute, then refuses until the oldest one ages out', () => {
    const s: ChatSlots = { times: [], active: 0 };
    expect(takeChatSlot(2, 0, s)).toBe('ok'); releaseChatSlot(s);
    expect(takeChatSlot(2, 1000, s)).toBe('ok'); releaseChatSlot(s);
    expect(takeChatSlot(2, 2000, s)).toBe('rate'); // refused: not counted in the window
    // at 60 s the start at 0 is a full minute old and leaves the window; the one at 1 s is still in it
    expect(takeChatSlot(2, 60_000, s)).toBe('ok'); releaseChatSlot(s);
    expect(takeChatSlot(2, 60_500, s)).toBe('rate'); // 1 s and 60 s are both in the window
    expect(takeChatSlot(2, 61_000, s)).toBe('ok');
  });

  it('refuses more than CHAT_MAX_ACTIVE requests running at once, and a finished one frees its slot', () => {
    const s: ChatSlots = { times: [], active: 0 };
    for (let i = 0; i < CHAT_MAX_ACTIVE; i++) expect(takeChatSlot(0, 0, s)).toBe('ok');
    expect(takeChatSlot(0, 0, s)).toBe('busy');
    releaseChatSlot(s);
    expect(takeChatSlot(0, 0, s)).toBe('ok');
  });

  it('a refused start does not take a slot or a place in the minute window', () => {
    const s: ChatSlots = { times: [], active: 0 };
    for (let i = 0; i < CHAT_MAX_ACTIVE; i++) takeChatSlot(0, 0, s);
    expect(takeChatSlot(0, 0, s)).toBe('busy');
    expect(s.times.length).toBe(CHAT_MAX_ACTIVE);
    expect(s.active).toBe(CHAT_MAX_ACTIVE);
  });

  it('perMinute 0 means no per-minute limit', () => {
    const s: ChatSlots = { times: [], active: 0 };
    for (let i = 0; i < 100; i++) {
      expect(takeChatSlot(0, i, s)).toBe('ok');
      releaseChatSlot(s);
    }
  });

  it('parses MUGI_CHAT_PER_MINUTE: default 20, a whole number >= 0, 0 = no limit', () => {
    expect(parseChatPerMinute(undefined)).toBe(20);
    expect(parseChatPerMinute('')).toBe(20);
    expect(parseChatPerMinute('abc')).toBe(20);
    expect(parseChatPerMinute('-3')).toBe(20);
    expect(parseChatPerMinute('1.5')).toBe(20);
    expect(parseChatPerMinute('5')).toBe(5);
    expect(parseChatPerMinute('0')).toBe(0);
  });
});

describe('daily spending cap', () => {
  it('parses MUGI_DAILY_USD: default 2, a number >= 0, 0 = no cap', () => {
    expect(parseDailyUsd(undefined)).toBe(2);
    expect(parseDailyUsd('')).toBe(2);
    expect(parseDailyUsd('x')).toBe(2);
    expect(parseDailyUsd('-1')).toBe(2);
    expect(parseDailyUsd('0.5')).toBe(0.5);
    expect(parseDailyUsd('0')).toBe(0);
  });

  it('is reached at the cap, and 0 never is', () => {
    expect(dailyLimitHit(1.99, 2)).toBe(false);
    expect(dailyLimitHit(2, 2)).toBe(true);
    expect(dailyLimitHit(500, 0)).toBe(false);
  });

  it('counts the estimated cost of the local day and resets at midnight', () => {
    let now = new Date(2026, 9, 28, 23, 0, 0);
    const store = new UsageStore({ file: join(dir, 'usage.json'), now: () => now, debounceMs: 60_000 });
    // claude-opus-5-5: $4 per million input tokens
    store.recordClaude('claude-opus-5-5', { input_tokens: 400_000, output_tokens: 0 }); // $1.60
    expect(store.dailyCostUsd()).toBeCloseTo(1.6, 6);
    store.recordClaude('claude-opus-5-5', { input_tokens: 200_000, output_tokens: 0 }); // $0.80
    expect(store.dailyCostUsd()).toBeCloseTo(2.4, 6);
    expect(dailyLimitHit(store.dailyCostUsd(), 2)).toBe(true);

    now = new Date(2026, 9, 29, 0, 5, 0);
    expect(store.dailyCostUsd()).toBe(0);
    store.recordClaude('claude-opus-5-5', { input_tokens: 100_000, output_tokens: 0 });
    expect(store.dailyCostUsd()).toBeCloseTo(0.4, 6);
    expect(dailyLimitHit(store.dailyCostUsd(), 2)).toBe(false);
  });

  it('does not count failed calls, and keeps the day totals across a restart', () => {
    const now = new Date(2026, 9, 28, 12, 0, 0);
    const file = join(dir, 'usage.json');
    const a = new UsageStore({ file, now: () => now, debounceMs: 60_000 });
    a.recordClaudeError('claude-opus-5-5');
    a.recordClaude('claude-opus-5-5', { input_tokens: 250_000, output_tokens: 0 }); // $1.00
    a.flush();
    const b = new UsageStore({ file, now: () => now, debounceMs: 60_000 });
    expect(b.dailyCostUsd()).toBeCloseTo(1, 6);
    expect(JSON.parse(readFileSync(file, 'utf8')).days).toBeDefined();
  });

  it('an older usage file with no day totals loads, with today at zero', () => {
    const file = join(dir, 'usage.json');
    writeFileSync(file, JSON.stringify({ version: 1, months: { '2026-10': { tts: { google: {}, azure: {} }, claude: {} } } }));
    const s = new UsageStore({ file, now: () => new Date(2026, 9, 28, 12), debounceMs: 60_000 });
    expect(s.dailyCostUsd()).toBe(0);
    expect(s.snapshot().months['2026-10']).toBeDefined();
  });
});

describe('speech memory cache: byte cap', () => {
  it('the default cap is 32 MB', () => {
    expect(TTS_CACHE_MEM_MAX_BYTES).toBe(32 * 1024 * 1024);
  });

  it('evicts the least recently used replies to stay within the byte cap', async () => {
    const c = new TtsCache({ dir: join(dir, 'cache'), memMax: 1000, memMaxBytes: 100, sweepDebounceMs: 60_000 });
    await c.store('a', Buffer.alloc(40, 1));
    await c.store('b', Buffer.alloc(40, 2));
    expect(c.memoryBytes()).toBe(80);
    c.peek('a'); // a is now the newest
    await c.store('c', Buffer.alloc(40, 3)); // 120 > 100: b goes
    expect(c.memoryBytes()).toBe(80);
    expect(c.peek('b')).toBeUndefined();
    expect(c.peek('a')?.[0]).toBe(1);
    expect(c.peek('c')?.[0]).toBe(3);
    await c.settle();
  });

  it('a reply bigger than the cap is kept on disk only, not in memory', async () => {
    const c = new TtsCache({ dir: join(dir, 'cache2'), memMax: 1000, memMaxBytes: 100, sweepDebounceMs: 60_000 });
    await c.store('big', Buffer.alloc(200, 9));
    expect(c.memoryBytes()).toBe(0);
    expect(c.peek('big')).toBeUndefined();
    await c.settle();
  });

  it('the count cap still applies on its own', async () => {
    const c = new TtsCache({ dir: join(dir, 'cache3'), memMax: 2, memMaxBytes: 10_000, sweepDebounceMs: 60_000 });
    await c.store('a', Buffer.alloc(10));
    await c.store('b', Buffer.alloc(10));
    await c.store('c', Buffer.alloc(10));
    expect(c.peek('a')).toBeUndefined();
    expect(c.memoryBytes()).toBe(20);
    await c.settle();
  });
});
