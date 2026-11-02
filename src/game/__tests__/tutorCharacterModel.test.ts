// The characters of 英語家教 (人物): the settings shape and its migration from the one-tutor saves, the add / delete / select rules
// (the three built-in ones stay, at most 8), each character's chat history and personality, the anchors on the classroom's lectern in
// px on a 375 × 812 stage, and each character's voice (speakPlanFor) and how the speech queue uses it. Nothing is sent anywhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TUTOR, TUTOR_CHARACTERS_MAX, TUTOR_CHAT_KEY, TUTOR_KEY, activeCharacter, addCharacter, deleteCharacter, effectivePersona,
  loadTutor, loadTutorChat, migrateTutor, selectCharacter, tutorChatKey, writeTutorChat, updateCharacter, type Character, type TutorSettings,
} from '../tutor';
import {
  ANCHORS, BUILTIN_CHARACTERS, CUSTOM_ANCHOR, NEUTRAL_PERSONA, anchorOf, defaultPersonaOf,
} from '../tutorCharacters';
import { cleanCharacterVoice, speakPlanFor, genderVoiceId, BROWSER_MALE_PITCH, type VoiceOption } from '../characterVoice';
import { BACKDROP_IDENTITY, DEFAULT_SCENE, figureAnchorBox, sceneBox } from '../tutorScene';
import { createSpeechQueue, type SpeechIo, type Utterance } from '../tts';
import { artKeyOf } from '../customArt';

/** a Map-backed localStorage (the node test environment has none) */
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
  };
}
let ls: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  ls = memoryStorage();
  vi.stubGlobal('localStorage', ls);
});
afterEach(() => vi.unstubAllGlobals());

const ids = (s: TutorSettings) => s.characters.map((c) => c.id);

describe('the settings shape and its migration', () => {
  it('an older save (the one tutor at the top) becomes character 1, and Lily and Ethan are added', () => {
    const s = migrateTutor({ name: 'ミオ', subtitle: '猫・英語家教', persona: '愛撒嬌', figureView: { scale: 2, x: 1, y: 2 }, sttLang: 'zh-TW' });
    expect(s.activeId).toBe('mugi');
    expect(ids(s)).toEqual(['mugi', 'yui', 'yuma']);
    expect(s.characters[0]).toEqual({ id: 'mugi', name: 'ミオ', subtitle: '猫・英語家教', persona: '愛撒嬌', figureView: { scale: 2, x: 1, y: 2 }, voice: null });
    expect(s.characters[1]).toMatchObject({ id: 'yui', name: 'Lily', voice: { gender: 'female' } });
    expect(s.characters[2]).toMatchObject({ id: 'yuma', name: 'Ethan', voice: { gender: 'male' } });
    expect(s.sttLang).toBe('zh-TW');
    expect('name' in s).toBe(false);
  });

  it('a new save keeps its characters, puts back a built-in one that is missing, and keeps at most 8', () => {
    const added = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `角${i}`, subtitle: 'x', persona: '', figureView: null, voice: null }));
    const s = migrateTutor({ characters: [{ id: 'yui', name: 'Lily二' }, ...added], activeId: 'c2' });
    expect(s.characters).toHaveLength(TUTOR_CHARACTERS_MAX);
    expect(ids(s).slice(0, 3)).toEqual(['mugi', 'yui', 'yuma']);
    expect(s.characters[1].name).toBe('Lily二');
    expect(s.activeId).toBe('c2');
  });

  it('Lily saved with the old default subtitle (大學生) gets the new one; a subtitle the player typed is kept', () => {
    const s = migrateTutor({ characters: [
      { id: 'yui', name: 'Lily', subtitle: '大學生・英語家教（舊）', persona: '' },
      { id: 'c1', name: '角', subtitle: '大學生・英語家教', persona: '' },
    ] });
    expect(s.characters[1].subtitle).toBe('高中生・英語家教');
    expect(s.characters[3].subtitle).toBe('大學生・英語家教');
    const typed = migrateTutor({ characters: [{ id: 'yui', subtitle: '咖啡店店員' }] });
    expect(typed.characters[1].subtitle).toBe('咖啡店店員');
  });

  it('Lily saved with an empty persona follows the new default; a persona she was given by the player is kept', () => {
    const followed = migrateTutor({ characters: [{ id: 'yui', persona: '' }] });
    expect(effectivePersona(followed.characters[1])).toBe(BUILTIN_CHARACTERS.yui.defaultPersona);
    const own = migrateTutor({ characters: [{ id: 'yui', persona: '我的人設：愛吃拉麵' }] });
    expect(effectivePersona(own.characters[1])).toBe('我的人設：愛吃拉麵');
  });

  it('an active id that is not a character falls back to the first one', () => {
    expect(migrateTutor({ activeId: 'nope' }).activeId).toBe('mugi');
    expect(migrateTutor(null)).toEqual(DEFAULT_TUTOR);
  });

  it('an unknown or broken save reads as the defaults', () => {
    ls.setItem(TUTOR_KEY, '{nope');
    expect(loadTutor()).toEqual(DEFAULT_TUTOR);
    expect(activeCharacter(loadTutor()).id).toBe('mugi');
  });
});

describe('add, delete and select', () => {
  it('adds a character named 新角色 with the neutral personality, and makes it the active one', () => {
    const s = addCharacter(DEFAULT_TUTOR, 'c1');
    expect(s).not.toBeNull();
    const added = s!.characters[3];
    expect(added).toMatchObject({ id: 'c1', name: '新角色', subtitle: '英語家教', persona: '', voice: null });
    expect(s!.activeId).toBe('c1');
    expect(effectivePersona(added)).toBe(NEUTRAL_PERSONA);
  });

  it('refuses a ninth character', () => {
    let s: TutorSettings | null = DEFAULT_TUTOR;
    for (let i = 0; i < 5; i++) s = addCharacter(s!, `c${i}`);
    expect(s!.characters).toHaveLength(TUTOR_CHARACTERS_MAX);
    expect(addCharacter(s!, 'c9')).toBeNull();
  });

  it('the built-in characters (1 to 3) are never deleted; an added one is, and the first character becomes active', () => {
    expect(deleteCharacter(DEFAULT_TUTOR, 'mugi')).toBe(DEFAULT_TUTOR);
    expect(deleteCharacter(DEFAULT_TUTOR, 'yui')).toBe(DEFAULT_TUTOR);
    const added = addCharacter(DEFAULT_TUTOR, 'c1')!;
    const gone = deleteCharacter(added, 'c1');
    expect(ids(gone)).toEqual(['mugi', 'yui', 'yuma']);
    expect(gone.activeId).toBe('mugi');
  });

  it('selects a character by id; an unknown id changes nothing', () => {
    expect(selectCharacter(DEFAULT_TUTOR, 'yuma').activeId).toBe('yuma');
    expect(selectCharacter(DEFAULT_TUTOR, 'nobody')).toBe(DEFAULT_TUTOR);
    expect(activeCharacter(selectCharacter(DEFAULT_TUTOR, 'yui')).name).toBe('Lily');
  });

  it('updates one character and leaves the others as they are', () => {
    const s = updateCharacter(DEFAULT_TUTOR, 'yui', { name: 'Lily 2' });
    expect(s.characters[1].name).toBe('Lily 2');
    expect(s.characters[0]).toEqual(DEFAULT_TUTOR.characters[0]);
  });
});

describe('each character has her own chat history and personality', () => {
  it('the hamster keeps today\'s chat key; the others have their own', () => {
    expect(tutorChatKey('mugi')).toBe(TUTOR_CHAT_KEY);
    expect(tutorChatKey('yui')).toBe(`${TUTOR_CHAT_KEY}.yui`);
    expect(tutorChatKey('yui')).not.toBe(tutorChatKey('yuma'));
  });

  it('switching the character switches the chat: each one only sees its own lines', () => {
    writeTutorChat([{ from: 'me', text: 'はじめまして', t: 1 }], 'mugi');
    writeTutorChat([{ from: 'her', text: 'こんにちは、Lilyです', t: 2 }], 'yui');
    expect(loadTutorChat('mugi').map((l) => l.text)).toEqual(['はじめまして']);
    expect(loadTutorChat('yui').map((l) => l.text)).toEqual(['こんにちは、Lilyです']);
    expect(loadTutorChat('yuma')).toEqual([]);
  });

  it('the built-in personalities are sent; the hamster sends none (the server has hers)', () => {
    expect(effectivePersona(DEFAULT_TUTOR.characters[0])).toBe('');
    expect(effectivePersona(DEFAULT_TUTOR.characters[1])).toBe(BUILTIN_CHARACTERS.yui.defaultPersona);
    expect(effectivePersona(DEFAULT_TUTOR.characters[2])).toBe(BUILTIN_CHARACTERS.yuma.defaultPersona);
    expect(defaultPersonaOf('yui')).toContain('美國高三女生');
    expect(defaultPersonaOf('yuma')).toContain('男大學生');
  });

  it('a character with her own personality sends that one', () => {
    const c: Character = { ...DEFAULT_TUTOR.characters[1], persona: '冷靜的學姐' };
    expect(effectivePersona(c)).toBe('冷靜的學姐');
  });

  it('the active character is the one the settings point at', () => {
    expect(activeCharacter({ ...DEFAULT_TUTOR, activeId: 'yuma' }).name).toBe('Ethan');
  });
});

describe('anchors on the lectern (px on a 375 × 812 stage)', () => {
  const STAGE = { w: 375, h: 812 };
  const scene = sceneBox(STAGE, BACKDROP_IDENTITY, true);

  it('Lily: 53% of the scene wide (198.75 px), centred, her point 64% down at the lectern top (x 88.1 px, top 281.8 px)', () => {
    const fig = figureAnchorBox(scene, 900 / 587, anchorOf('yui'));
    expect(fig.width).toBeCloseTo(198.75, 1);
    expect(fig.left).toBeCloseTo(88.125, 1);
    expect(fig.top).toBeCloseTo(281.82, 1);
    expect(fig.height).toBeCloseTo(304.73, 1);
  });

  it('Ethan: 76% of the scene wide (285 px), centred, his feet at 91.5% of the scene (bottom at 744 px)', () => {
    const fig = figureAnchorBox(scene, 900 / 415, anchorOf('yuma'));
    expect(fig.width).toBeCloseTo(285, 1);
    expect(fig.left).toBeCloseTo(45, 1);
    expect(fig.top + fig.height).toBeCloseTo(744, 0);
  });

  it('the anchor table holds the numbers; an added character stands on the floor at 45%', () => {
    expect(ANCHORS.yuma).toEqual({ width: 0.76, centerX: 0.5, anchorY: 0.915, pictureAnchor: 1 });
    expect(ANCHORS.yui).toEqual({ width: 0.53, centerX: 0.5, anchorY: 0.587, pictureAnchor: 0.64 });
    expect(anchorOf('c1')).toEqual(CUSTOM_ANCHOR);
    expect(DEFAULT_SCENE.width).toBe(851);
  });
});

describe('the voice of a character (speakPlanFor)', () => {
  const none = () => [] as VoiceOption[];

  it('null follows the 設定 page (no plan)', () => {
    expect(speakPlanFor(null, 'azure', none)).toBeNull();
    expect(speakPlanFor(null, 'browser', none)).toBeNull();
  });

  it('a male voice with the device voice is pitched lower; a female one is not', () => {
    expect(speakPlanFor({ gender: 'male' }, 'browser', none)).toEqual({ kind: 'browser', pitch: BROWSER_MALE_PITCH });
    expect(speakPlanFor({ gender: 'female' }, 'browser', none)).toEqual({ kind: 'browser', pitch: 1 });
  });

  it('a male voice on Azure and on Google is the male voice of the engine', () => {
    expect(speakPlanFor({ gender: 'male' }, 'azure', none)).toEqual({ kind: 'cloud', engine: 'azure', voice: 'en-US-AndrewNeural' });
    expect(speakPlanFor({ gender: 'male' }, 'google', none)).toEqual({ kind: 'cloud', engine: 'google', voice: 'en-US-Neural2-D' });
    expect(speakPlanFor({ gender: 'female' }, 'google', none)).toEqual({ kind: 'cloud', engine: 'google', voice: 'en-US-Neural2-F' });
  });

  it('the gender voice of each engine is its fixed English voice', () => {
    expect(genderVoiceId('azure', 'female')).toBe('en-US-AvaNeural');
    expect(genderVoiceId('google', 'male')).toBe('en-US-Neural2-D');
  });

  it('a chosen voice of a choice engine is used as it is', () => {
    expect(speakPlanFor({ engine: 'azure', en: 'en-US-BrianNeural' }, 'browser', none)).toEqual({ kind: 'cloud', engine: 'azure', voice: 'en-US-BrianNeural' });
    expect(speakPlanFor({ gender: 'male' }, 'azure', () => [{ id: 'en-US-AvaNeural', label: '七海' }])).toEqual(
      { kind: 'cloud', engine: 'azure', voice: 'en-US-AndrewNeural' },
    );
  });

  it('a save keeps only the valid parts of a voice', () => {
    expect(cleanCharacterVoice({ engine: 'azure', en: 'en-US-AndrewNeural', gender: 'male' })).toEqual({ engine: 'azure', en: 'en-US-AndrewNeural', gender: 'male' });
    expect(cleanCharacterVoice({ engine: 'amazon', gender: 'robot' })).toBeNull();
    expect(cleanCharacterVoice({ en: 'x; rm -rf' })).toBeNull();
    expect(cleanCharacterVoice(null)).toBeNull();
  });
});

describe('the speech queue speaks a line with its character\'s plan', () => {
  it('a device-voice plan lowers the pitch of a Japanese line; a Chinese line keeps the 設定 page pitch', () => {
    const spoken: Utterance[] = [];
    const io: SpeechIo = { speak: (u) => { spoken.push(u); }, cancel: () => {} };
    const q = createSpeechQueue({ io, rate: () => 1, volume: () => 1, pitch: () => 1 });
    q.enqueue('こんにちは', 'en', { kind: 'browser', pitch: BROWSER_MALE_PITCH });
    q.enqueue('你好', 'zh', { kind: 'browser', pitch: BROWSER_MALE_PITCH });
    expect(spoken[0].pitch).toBeCloseTo(0.8, 5);
    expect(spoken[0].speaker).toEqual({ kind: 'browser', pitch: 0.8 });
    expect(spoken[1].pitch).toBe(1);
    expect(spoken[1].speaker).toBeUndefined();
  });

  it('a cloud plan rides along on the line, so the cloud engine picks its voice', () => {
    const spoken: Utterance[] = [];
    const io: SpeechIo = { speak: (u) => { spoken.push(u); }, cancel: () => {} };
    const q = createSpeechQueue({ io, rate: () => 1, volume: () => 1 });
    q.enqueue('こんにちは', 'en', { kind: 'cloud', engine: 'azure', voice: 'en-US-AndrewNeural' });
    expect(spoken[0].speaker).toEqual({ kind: 'cloud', engine: 'azure', voice: 'en-US-AndrewNeural' });
  });
});

describe('the sound of a stored picture is per character', () => {
  it('the picture of a character is kept under her own record key; the hamster is the one of older saves', () => {
    expect(artKeyOf('yui')).not.toBe(artKeyOf('mugi'));
    expect(artKeyOf('yui')).toContain('yui');
  });
});
