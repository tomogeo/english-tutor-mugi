// QA: the 人物 / 背景 settings (game/tutor.ts, game/tutorScene.ts): old saves, the caps, deleting the active one, names.
import { describe, expect, it } from 'vitest';
import {
  addBackground, addCharacter, activeCharacter, deleteBackground, deleteCharacter, effectivePersona, migrateTutor, selectBackground,
  selectCharacter, TUTOR_BACKGROUNDS_MAX, TUTOR_CHARACTERS_MAX, cleanTutorName, TUTOR_NAME_MAX, DEFAULT_TUTOR, tutorChatKey,
} from '../game/tutor';
import { cleanBackgroundDim, cleanBackgroundId, DIM_MAX } from '../game/tutorScene';
import { cleanCharacterVoice, speakPlanFor, BROWSER_MALE_PITCH, CLOUD_EN_VOICES, genderVoiceId } from '../game/characterVoice';
import { findVoice, TTS_VOICES, googleVoiceFor } from '../../server/tts';
import { DEFAULT_PROVIDERS } from '../game/claudeProtocol';

describe('old saves load without crashing', () => {
  it('null, arrays and junk give the defaults', () => {
    for (const raw of [null, undefined, 42, 'x', [], { characters: 'nope' }, { characters: [null, 3, { id: '../bad' }] }]) {
      const s = migrateTutor(raw);
      expect(s.characters.map((c) => c.id)).toEqual(['mugi', 'yui', 'yuma']);
      expect(activeCharacter(s).id).toBe('mugi');
    }
  });

  it('a one-tutor save (top-level name, subtitle, persona, figureView) becomes character 1', () => {
    const s = migrateTutor({ name: '小春', subtitle: '我的老師', persona: '溫柔一點', figureView: { scale: 2, x: 5, y: -3 } });
    expect(s.characters[0]).toMatchObject({ id: 'mugi', name: '小春', subtitle: '我的老師', persona: '溫柔一點', figureView: { scale: 2, x: 5, y: -3 } });
    expect(s.characters.length).toBe(3);
  });

  it('an unknown field and a wrong-typed field are ignored, the rest is kept', () => {
    const s = migrateTutor({ scheme: 'dark', sttLang: 'fr-FR', providers: ['google'], background: 42, backgroundDim: 'x' });
    expect(s.sttLang).toBe('en-US');
    expect(s.providers).toEqual(DEFAULT_PROVIDERS);
    expect(s.background).toBe('classroom');
  });

  it('a save with the characters list missing one built-in gets it back', () => {
    const s = migrateTutor({ characters: [{ id: 'yui', name: 'Lily' }] });
    expect(s.characters.map((c) => c.id)).toEqual(['mugi', 'yui', 'yuma']);
  });

  it('an active id that is no longer listed falls back to the first character', () => {
    expect(migrateTutor({ activeId: 'ghost' }).activeId).toBe('mugi');
  });

  it('an old background "custom" is kept as an added background and selected', () => {
    const s = migrateTutor({ background: 'custom' });
    expect(s.customBackgrounds).toEqual(['custom']);
    expect(s.background).toBe('custom');
  });

  it('an old single dimming and view land on the background it had', () => {
    const s = migrateTutor({ background: 'black', backgroundDim: 30, backgroundView: { scale: 2, x: 1, y: 1 } });
    expect(s.backgroundOpts.black).toEqual({ dim: 30, view: { scale: 2, x: 1, y: 1 } });
  });
});

describe('caps', () => {
  it('8 characters: the ninth add is refused (null)', () => {
    let s = DEFAULT_TUTOR;
    for (let i = 0; i < 5; i++) s = addCharacter(s, `c${i}`)!;
    expect(s.characters.length).toBe(TUTOR_CHARACTERS_MAX);
    expect(addCharacter(s, 'extra')).toBeNull();
  });

  it('a save with more than 8 characters is cut to 8', () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `角色${i}` }));
    expect(migrateTutor({ characters: list }).characters.length).toBe(TUTOR_CHARACTERS_MAX);
  });

  it('6 backgrounds: the seventh add is refused; a save over 6 is cut to 6', () => {
    let s = DEFAULT_TUTOR;
    for (let i = 0; i < TUTOR_BACKGROUNDS_MAX; i++) s = addBackground(s, `bg${i}`)!;
    expect(addBackground(s, 'bg-extra')).toBeNull();
    const many = Array.from({ length: 9 }, (_, i) => `bg${i}`);
    expect(migrateTutor({ customBackgrounds: many }).customBackgrounds.length).toBe(TUTOR_BACKGROUNDS_MAX);
  });

  it('a legacy "custom" background when 6 are already listed drops the last listed one (not the new one)', () => {
    const six = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
    const s = migrateTutor({ background: 'custom', customBackgrounds: six });
    // 'custom' is in use: it must be listed; the cap keeps 6, so one of the player's six disappears
    expect(s.customBackgrounds).toContain('custom');
    expect(s.customBackgrounds.length).toBe(6);
  });

  it('a built-in id cannot be added as a background', () => {
    expect(addBackground(DEFAULT_TUTOR, 'classroom')).toBeNull();
  });
});

describe('deleting the active one', () => {
  it('deleting the active added character selects the first one', () => {
    const s = selectCharacter(addCharacter(DEFAULT_TUTOR, 'c1')!, 'c1');
    const after = deleteCharacter(s, 'c1');
    expect(after.activeId).toBe('mugi');
    expect(after.characters.some((c) => c.id === 'c1')).toBe(false);
  });

  it('a built-in character cannot be deleted', () => {
    expect(deleteCharacter(DEFAULT_TUTOR, 'yui')).toBe(DEFAULT_TUTOR);
  });

  it('deleting a character leaves its chat history key behind (the caller clears it)', () => {
    // TutorView clears clearTutorChat(activeId) on delete; the key must match what was written
    expect(tutorChatKey('c1')).toBe('mugien.tutor.chat.v1.c1');
  });

  it('deleting the active background puts the classroom back', () => {
    const s = selectBackground(addBackground(DEFAULT_TUTOR, 'bgA')!, 'bgA');
    expect(deleteBackground(s, 'bgA').background).toBe('classroom');
  });

  it('the background opts of a deleted background are removed', () => {
    const s = addBackground(DEFAULT_TUTOR, 'bgA')!;
    expect(deleteBackground(s, 'bgA').backgroundOpts.bgA).toBeUndefined();
  });
});

describe('names and persona', () => {
  it('the player may type up to 16 characters in the name box, but the saved name is cut to 8', () => {
    expect(TUTOR_NAME_MAX).toBe(8);
    expect(cleanTutorName('一二三四五六七八九')).toBe('一二三四五六七八');
  });

  it('a 9-character name typed in the box (box allows 16) is shortened silently', () => {
    // TutorView renders <input maxLength={16}> but labels it 「最多 8 個字」; the save cuts at 8
    expect(cleanTutorName('ABCDEFGHI')).toBe('ABCDEFGH');
  });

  it('a whitespace-only name falls back to the default', () => {
    expect(cleanTutorName('   ')).toBe('Mugi');
  });

  it('a name with a newline keeps the newline in the saved name (only trimmed)', () => {
    expect(cleanTutorName('小\n春')).toBe('小\n春');
  });

  it('a persona over 400 characters in a save is cut to 400 code points', () => {
    const s = migrateTutor({ characters: [{ id: 'mugi', persona: '字'.repeat(450) }] });
    expect([...s.characters[0].persona].length).toBe(400);
  });

  it('an added character has the neutral personality until she gets her own', () => {
    const s = addCharacter(DEFAULT_TUTOR, 'c9')!;
    expect(effectivePersona(activeCharacter(s))).toContain('英語家教');
  });
});

describe('backgrounds (cleaning)', () => {
  it('a dim outside 0..60 is clamped; a non-number is the default', () => {
    expect(cleanBackgroundDim(99)).toBe(DIM_MAX);
    expect(cleanBackgroundDim(-5)).toBe(0);
    expect(cleanBackgroundDim('30')).toBeNull();
  });
  it('an unknown background id falls back to the classroom', () => {
    expect(cleanBackgroundId('nope', ['a'])).toBe('classroom');
  });
});

describe('voices per character', () => {
  it('male Japanese voices are in the server allowlists', () => {
    expect(findVoice('azure', 'en-US-AndrewNeural')?.label).toContain('男聲');
    expect(findVoice('azure', 'en-US-BrianNeural')).toBeDefined();
    expect(findVoice('google', 'en-US-Neural2-D')).toBeDefined();
    expect(findVoice('google', 'en-US-Neural2-D')).toBeDefined();
    expect(findVoice('google', 'en-US-Wavenet-D')).toBeDefined();
  });

  it('the built-in gender defaults are in the allowlist', () => {
    expect(findVoice('azure', CLOUD_EN_VOICES.azure.male)).toBeDefined();
    expect(findVoice('google', CLOUD_EN_VOICES.google.male)).toBeDefined();
    expect(findVoice('google', CLOUD_EN_VOICES.google.female)).toBeDefined();
  });

  it('an unknown voice id and a voice of the other engine are refused (not in the allowlist)', () => {
    expect(findVoice('azure', 'en-US-Fake')).toBeUndefined();
    expect(findVoice('azure', 'en-US-Neural2-D')).toBeUndefined();
    expect(findVoice('google', 'en-US-AndrewNeural')).toBeUndefined();
  });

  it('Google maps an English Neural2 voice to the WaveNet and Standard voices of the same letter', () => {
    expect(googleVoiceFor('en-US-Neural2-F', 'wavenet')?.id).toBe('en-US-Wavenet-F');
    expect(googleVoiceFor('en-US-Neural2-F', 'standard')?.id).toBe('en-US-Standard-F');
  });

  it('a male character with the device voice gets the lower pitch', () => {
    expect(speakPlanFor({ gender: 'male' }, 'browser', () => [])).toEqual({ kind: 'browser', pitch: BROWSER_MALE_PITCH });
  });

  it('a male character on Azure gets the male Azure voice', () => {
    expect(speakPlanFor({ gender: 'male' }, 'azure', () => [])).toEqual({ kind: 'cloud', engine: 'azure', voice: 'en-US-AndrewNeural' });
  });

  it('the gender voices of both engines are fixed English voices', () => {
    expect(genderVoiceId('azure', 'male', [])).toBe('en-US-AndrewNeural');
    expect(genderVoiceId('google', 'female', [])).toBe('en-US-Neural2-F');
  });

  it('a voice id with odd characters is not kept', () => {
    expect(cleanCharacterVoice({ en: '../../etc' })).toBeNull();
    expect(cleanCharacterVoice({ en: 'en-US-AndrewNeural', engine: 'nope' })).toEqual({ en: 'en-US-AndrewNeural' });
  });

  it('TTS_VOICES lists are non-empty for azure and google', () => {
    expect(TTS_VOICES.azure.en.length).toBeGreaterThan(0);
    expect(TTS_VOICES.google.en.length).toBeGreaterThan(0);
  });

  it('an English voice of another engine saved on a character is accepted client-side when that engine list is still empty', () => {
    // speakPlanFor: an empty (not yet loaded) list accepts any id; the server then refuses an id outside its own list
    const plan = speakPlanFor({ engine: 'google', en: 'en-US-AndrewNeural' }, 'browser', () => []);
    expect(plan).toEqual({ kind: 'cloud', engine: 'google', voice: 'en-US-AndrewNeural' });
    expect(findVoice('google', 'en-US-AndrewNeural')).toBeUndefined();
  });

  it('selectCharacter with an unknown id changes nothing', () => {
    expect(selectCharacter(DEFAULT_TUTOR, 'ghost')).toBe(DEFAULT_TUTOR);
  });
});
