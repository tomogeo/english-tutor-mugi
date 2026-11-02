// Spending on the chat server, with no upstream call: a fake Anthropic stream stands in for the SDK. Covers the usage of
// streams that end early (aborted, timed out, failed), the estimate for a model with no price, and the concurrency limits.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  chatRequest, estimateChatUsage, LOOKUP_MAX_ACTIVE, parseChatBody, recordStreamSpend, releaseLookupConcurrency,
  takeLookupConcurrency, JUDGE_TIMEOUT_MS,
} from '../../../server/claudeChat.ts';
import { anthropicProvider, CHAT_STREAM_TIMEOUT_MS, mergeUsage } from '../../../server/llm/anthropicProvider.ts';
import { claudeCostEstimateUsd, priciestBand, UsageStore, dailyLimitHit } from '../../../server/usage.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mugi-tutor-spend-')); });
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

const now = new Date(2026, 9, 28, 12, 0, 0);
const storeAt = () => new UsageStore({ file: join(dir, 'usage.json'), now: () => now, debounceMs: 60_000 });

const body = parseChatBody(JSON.stringify({
  messages: [{ role: 'user', content: '你好，我想練習英文' }, { role: 'assistant', content: 'Sure!' }, { role: 'user', content: '今天天氣如何？' }],
  role: 'Mugi', mode: 'teacher', context: {},
}));

/**
 * A stream that yields `events`, then waits until it is aborted and fails the way the SDK does. `finalMessage` is never
 * reached in these tests. The fake client's messages.stream returns it.
 */
function abortableStream(events: unknown[]) {
  let aborted = false;
  let wake: (() => void) | undefined;
  const abort = vi.fn(() => {
    aborted = true;
    wake?.();
  });
  const stream = {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
      if (!aborted) await new Promise<void>((resolve) => { wake = resolve; });
      throw new Error('Request was aborted.');
    },
    finalMessage: async () => { throw new Error('not reached'); },
    abort,
  };
  const client = { beta: { messages: { stream: vi.fn(() => stream) } } } as unknown as Anthropic;
  return { client, abort };
}

const startEvent = (usage: Record<string, number>) => ({
  type: 'message_start',
  message: { usage: { input_tokens: 0, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null, ...usage } },
});

describe('usage merge: the newest numbers of the stream events', () => {
  it('message_start gives the input; message_delta moves the output on and keeps the rest', () => {
    let u = mergeUsage(undefined, { input_tokens: 500, output_tokens: 1, cache_read_input_tokens: 400 });
    u = mergeUsage(u, { output_tokens: 42 });
    expect(u).toEqual({ input_tokens: 500, output_tokens: 42, cache_read_input_tokens: 400 });
  });

  it('null and missing fields do not overwrite a known number', () => {
    const u = mergeUsage({ input_tokens: 500, output_tokens: 3 }, { input_tokens: null, output_tokens: 9 });
    expect(u).toEqual({ input_tokens: 500, output_tokens: 9 });
    expect(mergeUsage({ input_tokens: 1 }, undefined)).toEqual({ input_tokens: 1 });
  });
});

describe('chat stream aborted by the player: its usage so far is recorded', () => {
  it('known usage (message_start seen) is recorded with the output by reply length, marked estimated; the abort is not an error', async () => {
    const { client, abort } = abortableStream([startEvent({ input_tokens: 800, output_tokens: 1 })]);
    const provider = anthropicProvider(client);
    const req = chatRequest(body, 'claude-haiku-5-5');
    const s = provider.streamChat(req, () => {});
    await new Promise((resolve) => setImmediate(resolve)); // let the start event be read
    s.abort();
    expect(abort).toHaveBeenCalledTimes(1);
    await expect(s.done).rejects.toThrow('aborted');
    expect(s.usageSoFar()).toEqual({ input_tokens: 800, output_tokens: 1 }); // the mid-stream output is only the start count

    const store = storeAt();
    recordStreamSpend(store, 'claude-haiku-5-5', req, s, 12, { clientGone: true });
    const c = store.snapshot().months['2026-10'].claude['claude-haiku-5-5'];
    // 12 reply chars at two per token: 6 output tokens, not the 1 the start event reported
    expect(c).toMatchObject({ requests: 1, errors: 0, inputTokens: 800, outputTokens: 6, estimated: 1 });
    expect(c.costUsd).toBeGreaterThan(0);
    expect(store.estimatedDailyCostUsd()).toBeCloseTo(store.dailyCostUsd(), 9);
  });

  it('a stream aborted after a 2000-character reply records at least 1000 output tokens, marked estimated', async () => {
    const reply = '好'.repeat(2000);
    const events = [
      startEvent({ input_tokens: 800, output_tokens: 1 }),
      { type: 'content_block_delta', delta: { type: 'text_delta', text: reply } },
    ];
    const { client } = abortableStream(events);
    const req = chatRequest(body, 'claude-haiku-5-5');
    let replyChars = 0;
    const s = anthropicProvider(client).streamChat(req, (t) => { replyChars += t.length; });
    await new Promise((resolve) => setImmediate(resolve)); // let the events be read
    s.abort();
    await expect(s.done).rejects.toThrow('aborted');
    expect(replyChars).toBe(2000);

    const store = storeAt();
    recordStreamSpend(store, 'claude-haiku-5-5', req, s, replyChars, { clientGone: true });
    const c = store.snapshot().months['2026-10'].claude['claude-haiku-5-5'];
    expect(c.outputTokens).toBeGreaterThanOrEqual(1000);
    expect(c).toMatchObject({ requests: 1, errors: 0, estimated: 1 });
  });

  it('the output of an interrupted stream is never below what the upstream reported', () => {
    const store = storeAt();
    const req = chatRequest(body, 'claude-haiku-5-5');
    recordStreamSpend(store, 'claude-haiku-5-5', req, { usageSoFar: () => ({ input_tokens: 10, output_tokens: 300 }) }, 4, { clientGone: true });
    expect(store.snapshot().months['2026-10'].claude['claude-haiku-5-5']).toMatchObject({ outputTokens: 300, estimated: 1 });
  });

  it('with no usage yet, the player leaving is charged the conservative estimate (and marked as one)', async () => {
    const { client } = abortableStream([]);
    const s = anthropicProvider(client).streamChat(chatRequest(body, 'claude-haiku-5-5'), () => {});
    s.abort();
    await expect(s.done).rejects.toThrow();
    expect(s.usageSoFar()).toBeUndefined();

    const req = chatRequest(body, 'claude-haiku-5-5');
    const store = storeAt();
    recordStreamSpend(store, 'claude-haiku-5-5', req, s, 30, { clientGone: true });
    const c = store.snapshot().months['2026-10'].claude['claude-haiku-5-5'];
    expect(c).toMatchObject({ requests: 1, errors: 0, estimated: 1, inputTokens: estimateChatUsage(req, 30).input_tokens, outputTokens: 15 });
    expect(c.inputTokens).toBeGreaterThan(0);
    expect(store.estimatedDailyCostUsd()).toBeGreaterThan(0);
    expect(store.estimatedDailyCostUsd()).toBeCloseTo(store.dailyCostUsd(), 9);
  });

  it('the estimate is one token per two characters of the request text, and the reply length for output', () => {
    const req = chatRequest(body, 'claude-haiku-5-5');
    const e = estimateChatUsage(req, 9);
    expect(e.output_tokens).toBe(5);
    expect(e.input_tokens).toBe(Math.ceil(JSON.stringify({ system: req.system, messages: req.messages }).length / 2));
  });
});

describe('chat stream that fails or runs out of time', () => {
  it('a failed upstream with no usage is only an error, not a spend', () => {
    const store = storeAt();
    const req = chatRequest(body, 'claude-haiku-5-5');
    recordStreamSpend(store, 'claude-haiku-5-5', req, { usageSoFar: () => undefined }, 0, { clientGone: false });
    expect(store.snapshot().months['2026-10'].claude['claude-haiku-5-5']).toMatchObject({ requests: 1, errors: 1, costUsd: 0, estimated: 0 });
    expect(store.dailyCostUsd()).toBe(0);
  });

  it('a failed upstream with known usage records the usage and counts the error', () => {
    const store = storeAt();
    const req = chatRequest(body, 'claude-haiku-5-5');
    recordStreamSpend(store, 'claude-haiku-5-5', req, { usageSoFar: () => ({ input_tokens: 1000, output_tokens: 10 }) }, 0, { clientGone: false });
    expect(store.snapshot().months['2026-10'].claude['claude-haiku-5-5']).toMatchObject({ requests: 1, errors: 1, inputTokens: 1000, outputTokens: 10, estimated: 1 });
  });

  it('with thinking on, an interrupted stream keeps a reserve of output tokens; with it off, the reply length alone', () => {
    const store = storeAt();
    const withThinking = { ...chatRequest(body, 'claude-haiku-5-5'), thinking: { type: 'enabled', budget_tokens: 1024 } } as ReturnType<typeof chatRequest>;
    recordStreamSpend(store, 'claude-haiku-5-5', withThinking, { usageSoFar: () => ({ input_tokens: 10, output_tokens: 1 }) }, 0, { clientGone: true });
    expect(store.snapshot().months['2026-10'].claude['claude-haiku-5-5'].outputTokens).toBe(256);
    recordStreamSpend(store, 'claude-haiku-5-5', chatRequest(body, 'claude-haiku-5-5'), { usageSoFar: () => ({ input_tokens: 10, output_tokens: 1 }) }, 0, { clientGone: true });
    expect(store.snapshot().months['2026-10'].claude['claude-haiku-5-5'].outputTokens).toBe(257);
  });

  it('a stream still running after CHAT_STREAM_TIMEOUT_MS is cut off, and says so', async () => {
    vi.useFakeTimers();
    const { client, abort } = abortableStream([startEvent({ input_tokens: 10, output_tokens: 1 })]);
    const s = anthropicProvider(client).streamChat(chatRequest(body, 'claude-haiku-5-5'), () => {});
    const outcome = s.done.then(() => 'resolved', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(CHAT_STREAM_TIMEOUT_MS);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(await outcome).toContain('逾時');
  });

  it('a stream that finishes in time does not leave the timer running (nothing is aborted later)', async () => {
    vi.useFakeTimers();
    const final = { content: [{ type: 'text', text: '嗨' }], model: 'claude-haiku-5-5', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' };
    const stream = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '嗨' } };
      },
      finalMessage: async () => final,
      abort: vi.fn(),
    };
    const client = { beta: { messages: { stream: vi.fn(() => stream) } } } as unknown as Anthropic;
    const r = await anthropicProvider(client).streamChat(chatRequest(body, 'claude-haiku-5-5'), () => {}).done;
    expect(r.text).toBe('嗨');
    expect(vi.getTimerCount()).toBe(0);
    expect(stream.abort).not.toHaveBeenCalled();
  });
});

describe('a model with no price is charged at the priciest price, so the cap still applies', () => {
  it('the priciest band is the highest input and output price in the table', () => {
    expect(priciestBand()).toEqual({ inPerMTok: 10, outPerMTok: 50 });
    expect(claudeCostEstimateUsd({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(10, 9);
    expect(claudeCostEstimateUsd({ input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(50, 9);
  });

  it('an unpriced model adds the estimate to the day and marks it as estimated; the cap is then reached', () => {
    const store = storeAt();
    store.recordClaude('claude-mystery-9-9', { input_tokens: 250_000, output_tokens: 0 }); // $2.50 at $10/M
    expect(store.dailyCostUsd()).toBeCloseTo(2.5, 9);
    expect(store.estimatedDailyCostUsd()).toBeCloseTo(2.5, 9);
    expect(dailyLimitHit(store.dailyCostUsd(), 2)).toBe(true);
    const c = store.snapshot().months['2026-10'].claude['claude-mystery-9-9'];
    expect(c).toMatchObject({ requests: 1, unpriced: 1, costUsd: expect.any(Number) });
    expect(c.costUsd).toBeCloseTo(2.5, 9);
  });

  it('a priced model adds nothing to the estimated part', () => {
    const store = storeAt();
    store.recordClaude('claude-opus-5-5', { input_tokens: 100_000, output_tokens: 0 });
    expect(store.dailyCostUsd()).toBeCloseTo(0.4, 9);
    expect(store.estimatedDailyCostUsd()).toBe(0);
  });

  it('the estimated part survives a restart', () => {
    const file = join(dir, 'usage.json');
    const a = new UsageStore({ file, now: () => now, debounceMs: 60_000 });
    a.recordClaude('claude-mystery-9-9', { input_tokens: 100_000, output_tokens: 0 });
    a.flush();
    const b = new UsageStore({ file, now: () => now, debounceMs: 60_000 });
    expect(b.estimatedDailyCostUsd()).toBeCloseTo(1, 9);
    expect(b.dailyCostUsd()).toBeCloseTo(1, 9);
  });
});

describe('lookup concurrency: its own limit, separate from the chat slots', () => {
  it('two lookups may run at once; a third is refused until one finishes', () => {
    expect(LOOKUP_MAX_ACTIVE).toBe(2);
    expect(takeLookupConcurrency()).toBe(true);
    expect(takeLookupConcurrency()).toBe(true);
    expect(takeLookupConcurrency()).toBe(false);
    releaseLookupConcurrency();
    expect(takeLookupConcurrency()).toBe(true);
    releaseLookupConcurrency();
    releaseLookupConcurrency();
    expect(takeLookupConcurrency()).toBe(true);
    releaseLookupConcurrency();
  });
});

describe('the one-shot judge has a time limit', () => {
  it('the judge limit is 30 seconds', () => {
    expect(JUDGE_TIMEOUT_MS).toBe(30_000);
  });

});
