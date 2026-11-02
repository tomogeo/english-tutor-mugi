import { describe, expect, it } from 'vitest';
import { reminderPrompt, systemPrompt } from '../../../server/prompts.ts';

// the volatile rules (tip details, self-check, the tip language) live in the reminder, which rides on the newest user message;
// the system prompt is the stable part and must not carry them.
describe('teacher reminder: the 小提醒 is Chinese by default, its English inside <en>', () => {
  const r = reminderPrompt();
  it('says plainly that the tip is Traditional Chinese, with the English to learn only inside <en>', () => {
    expect(r).toContain('tip 必須用繁體中文寫');
    expect(r).toContain('<en>…</en>');
  });
  it('the default is the Chinese tip', () => {
    expect(reminderPrompt('zh')).toBe(r);
  });
  it('ends with the self-check list', () => {
    expect(r).toContain('寫完之前逐項檢查');
    expect(r.indexOf('寫完之前逐項檢查')).toBeGreaterThan(r.indexOf('開頭不要加「小提醒」'));
  });
  it('the system prompt carries none of the volatile tip rules or the self-check', () => {
    const p = systemPrompt('Mugi');
    expect(p).not.toContain('寫完之前逐項檢查');
    expect(p).not.toContain('必須用繁體中文寫');
    expect(p).not.toContain('開頭不要加');
  });
  it('the system prompt teaches English, never Japanese', () => {
    const p = systemPrompt('Mugi');
    expect(p).toContain('英語');
    expect(p).not.toMatch(/日語|日文|假名|漢字/);
  });
});

describe('teacher reminder: the English tip language', () => {
  const r = reminderPrompt('en');
  it('asks for a tip in simple English, still with <en> around the English to learn', () => {
    expect(r).toContain('簡單、好懂的英文');
    expect(r).not.toContain('tip 必須用繁體中文寫');
    expect(r).toContain('<en>');
  });
  it('the system prompt is the same whatever the tip language (the cache keeps hitting)', () => {
    expect(systemPrompt('Mugi')).toBe(systemPrompt('Mugi'));
    expect(reminderPrompt('en')).not.toBe(reminderPrompt('zh'));
  });
});

describe('teacher reminder: no 小提醒 label', () => {
  const r = reminderPrompt();
  it('the tip example and rule carry no 小提醒： label', () => {
    expect(r).not.toContain('小提醒：');
    expect(r).toContain('開頭不要加「小提醒」');
  });
});

// the reply is a JSON object (Structured Outputs): the prompts describe its fields and carry no tag vocabulary
describe('teacher prompts describe the JSON reply, with no tags to write', () => {
  it('the system prompt names the three fields and says lang is en, gloss is the Chinese meaning', () => {
    const p = systemPrompt('Mugi');
    for (const word of ['segments', 'tip', 'tone', 'lang', 'gloss']) expect(p).toContain(word);
    expect(p).toContain('"en"');
  });
  it('the system prompt asks for no <meta> or <tip> tags in the reply (the tip keeps its <en> inside the string)', () => {
    const p = systemPrompt('Mugi');
    expect(p).not.toContain('<meta>');
    expect(p).not.toContain('<tip>…</tip>');
  });
  for (const lang of ['zh', 'en'] as const) {
    it(`the reminder (${lang}) shows one reply as JSON, with a tip whose English is in <en>`, () => {
      const r = reminderPrompt(lang);
      const example = /\{"segments":.*"tone":"happy"\}/.exec(r)?.[0] ?? '';
      expect(example).not.toBe('');
      const parsed = JSON.parse(example) as { segments: { lang: string; text: string; gloss: string }[]; tip: string; tone: string };
      expect(parsed.segments[0].lang).toBe('en');
      expect(parsed.tip).toContain('<en>');
      expect(parsed.tone).toBe('happy');
    });
  }
});
