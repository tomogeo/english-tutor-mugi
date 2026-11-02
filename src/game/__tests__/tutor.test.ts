import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TUTOR_CHAT_KEY, TUTOR_CHAT_KEEP, TUTOR_DEFAULT_NAME, TUTOR_KEY, TUTOR_NAME_MAX, DEFAULT_TUTOR, clearTutorChat, cleanTutorName,
  loadTutor, loadTutorChat, migrateTutor, renameTutor, writeTutor, writeTutorChat,
  type Character, type TutorSettings,
} from '../tutor';
import { reminderPrompt, systemPrompt } from '../../../server/prompts.ts';

/** a Map-backed localStorage (the node test environment has none) */
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    _map: m,
  };
}

let ls: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  ls = memoryStorage();
  vi.stubGlobal('localStorage', ls);
});
afterEach(() => vi.unstubAllGlobals());

/** the three built-in characters as they start */
const CHARS: Character[] = [
  { id: 'mugi', name: 'Mugi', subtitle: '倉鼠・英語家教', persona: '', figureView: null, voice: null },
  { id: 'yui', name: 'Lily', subtitle: '高中生・英語家教', persona: '', figureView: null, voice: { gender: 'female' } },
  { id: 'yuma', name: 'Ethan', subtitle: '大學生・英語家教', persona: '', figureView: null, voice: { gender: 'male' } },
];

/** the model, background and other fields every settings object has by default (the characters, the mic language are listed apart) */
const MODELS = {
  tipLang: 'zh', showGloss: true, chatModel: '', helperModel: 'claude-haiku-5-5', providers: ['anthropic'], openaiModel: '',
  background: 'classroom', customBackgrounds: [], backgroundOpts: {},
} as const;

/** a whole settings object: the characters, the active one, and the other fields */
const settingsOf = (characters: Character[], extra: Partial<TutorSettings> = {}): TutorSettings => ({
  characters, activeId: 'mugi', sttLang: 'en-US', ...MODELS, ...extra,
});

describe('storage keys', () => {
  it('uses its own settings and chat keys under the mugi prefix', () => {
    expect(TUTOR_KEY).toBe('mugien.tutor.v1');
    expect(TUTOR_CHAT_KEY).toBe('mugien.tutor.chat.v1');
  });
  it('the settings and the chat are stored apart', () => {
    writeTutorChat([{ from: 'her', text: 'こんにちは', t: 2 }]);
    writeTutor(settingsOf([{ ...CHARS[0], name: 'ミオ' }, CHARS[1], CHARS[2]]));
    expect(ls.getItem(TUTOR_KEY)).not.toBeNull();
    expect(loadTutorChat()[0].text).toBe('こんにちは');
    clearTutorChat();
    expect(loadTutorChat()).toEqual([]);
    expect(loadTutor().characters[0].name).toBe('ミオ');
  });
});

describe('tutor settings', () => {
  it('defaults to Mugi, Lily and Ethan, the English listening language, the server chat model and Haiku for the helpers', () => {
    expect(TUTOR_DEFAULT_NAME).toBe('Mugi');
    expect(DEFAULT_TUTOR).toEqual(settingsOf(CHARS));
    expect(loadTutor()).toEqual(settingsOf(CHARS));
  });
  it('a renamed tutor is kept; names are trimmed and capped', () => {
    writeTutor(settingsOf([{ ...CHARS[0], name: '  ミオ  ' }, CHARS[1], CHARS[2]], { sttLang: 'zh-TW' }));
    expect(loadTutor().characters[0]).toMatchObject({ name: 'ミオ' });
    expect(loadTutor().sttLang).toBe('zh-TW');
    expect(cleanTutorName('   ')).toBe(TUTOR_DEFAULT_NAME);
    expect(cleanTutorName('一二三四五六七八九十')).toBe('一二三四五六七八');
    expect(TUTOR_NAME_MAX).toBe(8);
  });
  it('renameTutor renames the active character and saves the cleaned name with the other settings', () => {
    const next = renameTutor('  芽衣  ', settingsOf(CHARS, { sttLang: 'zh-TW' }));
    expect(next.characters[0].name).toBe('芽衣');
    expect(next.characters.slice(1)).toEqual(CHARS.slice(1));
    expect(loadTutor()).toEqual(next);
  });
  it('the mic language falls back to English for anything but 中文', () => {
    expect(migrateTutor({ sttLang: 'zh-TW' }).sttLang).toBe('zh-TW');
    expect(migrateTutor({ sttLang: 'en-US' }).sttLang).toBe('en-US');
    expect(migrateTutor(null)).toEqual(settingsOf(CHARS));
  });
  it('a broken value falls back to the defaults', () => {
    ls.setItem(TUTOR_KEY, '{not json');
    expect(loadTutor()).toEqual(settingsOf(CHARS));
  });
});

describe('tutor chat history', () => {
  it('keeps the newest lines only', () => {
    const many = Array.from({ length: TUTOR_CHAT_KEEP + 5 }, (_, i) => ({ from: 'me' as const, text: `第${i}句`, t: i }));
    writeTutorChat(many);
    const back = loadTutorChat();
    expect(back).toHaveLength(TUTOR_CHAT_KEEP);
    expect(back[back.length - 1].text).toBe(`第${TUTOR_CHAT_KEEP + 4}句`);
  });
  it('drops anything that is not a chat line', () => {
    ls.setItem(TUTOR_CHAT_KEY, JSON.stringify([{ from: 'me', text: 'ok', t: 1 }, { nope: true }, 'x', { from: 'her', text: 5 }]));
    expect(loadTutorChat()).toEqual([{ from: 'me', text: 'ok', t: 1 }]);
    ls.setItem(TUTOR_CHAT_KEY, '{}');
    expect(loadTutorChat()).toEqual([]);
  });
});

describe('the tutor persona on the server (Mugi)', () => {
  it('the system prompt names her, is the same on every call, and never asks for a scene', () => {
    const a = systemPrompt('Mugi');
    expect(a).toContain('Mugi');
    expect(a).toBe(systemPrompt('Mugi'));
    expect(a).not.toContain('action');
  });
  it('teaches in English (teacher rules) as a JSON reply with segments, tip and tone', () => {
    const a = systemPrompt('Mugi');
    expect(a).toContain('segments');
    expect(a).toContain('tip');
    expect(a).toContain('tone');
    expect(a).not.toContain('<meta>');
  });
  it('the volatile reminder carries the format details of every reply', () => {
    expect(reminderPrompt()).toContain('寫完之前逐項檢查');
  });
});

describe('tutor settings from an older save', () => {
  it('a save that still has a scheme field loads; the field is ignored and not kept', () => {
    ls.setItem(TUTOR_KEY, JSON.stringify({ name: 'Mugi', sttLang: 'en-US', scheme: 'matcha' }));
    const s = loadTutor();
    expect(s).toEqual(DEFAULT_TUTOR);
    expect('scheme' in s).toBe(false);
    expect(migrateTutor({ scheme: 3 })).toEqual(DEFAULT_TUTOR);
  });
});

describe('background settings (背景)', () => {
  it('an older save has no background: the classroom, nothing added, no settings of its own', () => {
    const s = migrateTutor({ name: 'Mugi', sttLang: 'en-US' });
    expect(s.background).toBe('classroom');
    expect(s.customBackgrounds).toEqual([]);
    expect(s.backgroundOpts).toEqual({});
  });

  it("an older save's single custom background becomes the added background 'custom', with its dimming and view", () => {
    const s = migrateTutor({ background: 'custom', backgroundDim: 25.4, backgroundView: { scale: 2, x: 30, y: -10 } });
    expect(s).toMatchObject({ background: 'custom', customBackgrounds: ['custom'] });
    expect(s.backgroundOpts.custom).toEqual({ dim: 25, view: { scale: 2, x: 30, y: -10 } });
  });

  it('an older black or classroom save keeps its dimming and view under that background', () => {
    const s = migrateTutor({ background: 'black', backgroundDim: 10, backgroundView: { scale: 1.5, x: 0, y: 0 } });
    expect(s).toMatchObject({ background: 'black', customBackgrounds: [] });
    expect(s.backgroundOpts.black).toEqual({ dim: 10, view: { scale: 1.5, x: 0, y: 0 } });
  });

  it('a bad value falls back: the classroom, with its own cleaned settings', () => {
    const bad = migrateTutor({ background: 'svg', backgroundDim: 'x', backgroundView: { scale: 9, x: 'a' } });
    expect(bad.background).toBe('classroom');
    expect(bad.backgroundOpts.classroom).toEqual({ dim: null, view: { scale: 3, x: 0, y: 0 } });
  });

  it("a new save keeps the added list (valid, unique, at most 6) and each background's own settings", () => {
    const s = migrateTutor({
      background: 'b2', customBackgrounds: ['b1', 'b1', 'b2', 'classroom', 'x y', ...Array.from({ length: 6 }, (_, i) => `c${i}`)],
      backgroundOpts: { b2: { dim: 40, view: { scale: 2, x: 1, y: 2 } }, black: { dim: 5, view: { scale: 1, x: 0, y: 0 } } },
    });
    expect(s.customBackgrounds).toEqual(['b1', 'b2', 'c0', 'c1', 'c2', 'c3']);
    expect(s.background).toBe('b2');
    expect(s.backgroundOpts.b2).toEqual({ dim: 40, view: { scale: 2, x: 1, y: 2 } });
    expect(s.backgroundOpts.black).toEqual({ dim: 5, view: { scale: 1, x: 0, y: 0 } });
  });
});
