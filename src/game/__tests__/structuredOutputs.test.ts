// Structured Outputs for the server's one-shot Claude calls (judge, 速查, 小提醒 rewrite). A fake LlmProvider records the
// request and returns a fixed reply: nothing calls Claude, Google or Azure.
import { describe, expect, it } from 'vitest';
import {
  CHAT_REPLY_SCHEMA, JUDGE_SCHEMA, LOOKUP_MODEL, LOOKUP_SCHEMA, TIP_FIX_MODEL, TIP_FIX_SCHEMA, lookupAnswerWith, rewriteTipWith, tipFromFixReply,
} from '../../../server/claudeChat.ts';
import type { LlmCompleteRequest, LlmProvider, LlmResult } from '../../../server/llm/provider.ts';
import { CHAT_TONES } from '../claudeProtocol';

function fakeProvider(text: string) {
  const reqs: LlmCompleteRequest[] = [];
  const provider: LlmProvider = {
    id: 'anthropic',
    streamChat() {
      throw new Error('streamChat is not used by these tests');
    },
    async complete(req): Promise<LlmResult> {
      reqs.push(req);
      return { text, model: req.model, stopReason: 'end_turn' };
    },
    describeError: () => ({ status: 500, message: 'fake' }),
  };
  return { provider, reqs };
}

/** every object node has additionalProperties: false and lists all its properties as required; no length/size limits */
function checkSchema(node: unknown, path = 'root'): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems', 'minItems']) {
    expect(n, `${path} must not use ${banned}`).not.toHaveProperty(banned);
  }
  if (n.type === 'object') {
    const props = n.properties as Record<string, unknown>;
    expect(n.additionalProperties, `${path} additionalProperties`).toBe(false);
    expect(n.required as string[], `${path} required`).toEqual(expect.arrayContaining(Object.keys(props)));
    for (const [k, v] of Object.entries(props)) checkSchema(v, `${path}.${k}`);
  }
  if (n.type === 'array') checkSchema(n.items, `${path}[]`);
}

describe('schemas are valid for Structured Outputs', () => {
  it('JUDGE_SCHEMA', () => checkSchema(JUDGE_SCHEMA, 'JUDGE'));
  it('LOOKUP_SCHEMA', () => checkSchema(LOOKUP_SCHEMA, 'LOOKUP'));
  it('TIP_FIX_SCHEMA', () => checkSchema(TIP_FIX_SCHEMA, 'TIP_FIX'));
  it('CHAT_REPLY_SCHEMA (her reply: segments, tip, tone)', () => {
    checkSchema(CHAT_REPLY_SCHEMA, 'CHAT');
    expect(CHAT_REPLY_SCHEMA.required).toEqual(['segments', 'tip', 'tone']);
    expect(CHAT_REPLY_SCHEMA.properties.tone.enum).toEqual([...CHAT_TONES]);
    expect(CHAT_REPLY_SCHEMA.properties.segments.items.properties.lang.enum).toEqual(['en', 'zh']);
  });
  it('LOOKUP_SCHEMA level enum is exactly the CEFR levels plus 其他', () => {
    const level = (LOOKUP_SCHEMA.properties.items.items.properties as Record<string, { enum?: string[] }>).level;
    expect(level.enum).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', '其他']);
    const gLevel = (LOOKUP_SCHEMA.properties.grammar.items.properties as Record<string, { enum?: string[] }>).level;
    expect(gLevel.enum).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', '其他']);
  });
});

describe('lookupAnswerWith sends the lookup schema', () => {
  it('passes output_config.format and the lookup model', async () => {
    const { provider, reqs } = fakeProvider('{}');
    await lookupAnswerWith(provider, '怎麼說');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].output_config?.format).toEqual({ type: 'json_schema', schema: LOOKUP_SCHEMA });
    expect(reqs[0].model).toBe(LOOKUP_MODEL);
  });

  it('a JSON reply becomes an answer', async () => {
    const reply = JSON.stringify({
      items: [{ en: 'school', zh: '學校', level: 'A1', note: '' }],
      grammar: [],
      examples: [{ en: 'I go to school.', zh: '去學校' }],
      message: '',
    });
    const { provider } = fakeProvider(reply);
    const r = await lookupAnswerWith(provider, '學校');
    expect(r.answer).not.toBeNull();
    expect(r.answer!.items).toHaveLength(1);
    expect(r.answer!.items[0]).toMatchObject({ zh: '學校', level: 'A1' });
    expect(r.answer!.items[0].en).toContain('school');
    expect(r.answer!.examples).toHaveLength(1);
    expect(r.raw).toBe(reply);
  }, 20000);

  it('a non-JSON reply gives answer null and the raw text', async () => {
    const { provider } = fakeProvider('  這不是 JSON 的回覆  ');
    const r = await lookupAnswerWith(provider, '問題');
    expect(r.answer).toBeNull();
    expect(r.raw).toBe('這不是 JSON 的回覆');
  });
});

describe('rewriteTipWith sends the tip schema', () => {
  it('passes output_config.format and keeps the tip model', async () => {
    const { provider, reqs } = fakeProvider('{"tip":"要說 がっこう 喔"}');
    await rewriteTipWith(provider, '要說 <en>がっこう</en> 喔');
    expect(reqs[0].output_config?.format).toEqual({ type: 'json_schema', schema: TIP_FIX_SCHEMA });
    expect(reqs[0].model).toBe(TIP_FIX_MODEL);
    expect(reqs[0].thinking).toEqual({ type: 'disabled' });
  });
});

describe('tipFromFixReply', () => {
  it('reads the tip field from JSON', () => {
    expect(tipFromFixReply('{"tip":"要說 <en>がっこう</en> 喔"}')).toBe('要說 <en>がっこう</en> 喔');
  });
  it('removes a <tip> wrapper inside the tip field', () => {
    expect(tipFromFixReply('{"tip":"<tip>abc</tip>"}')).toBe('abc');
  });
  it('still reads the old <tip> format', () => {
    expect(tipFromFixReply('<tip>舊格式</tip>')).toBe('舊格式');
  });
  it('plain text comes back trimmed', () => {
    expect(tipFromFixReply('  純文字  ')).toBe('純文字');
  });
  it('JSON without a tip field falls back to the whole text', () => {
    expect(tipFromFixReply('{"x":1}')).toBe('{"x":1}');
  });
});
