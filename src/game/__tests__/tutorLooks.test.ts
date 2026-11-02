import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TUTOR_CHARACTER } from '../tutorCharacters';
import { overlayFile, parseTutorArt, TutorFaceClock, type TutorArt } from '../tutorFace';

const idle = { speaking: false, cue: null, level: 0 };
const speaking = { ...idle, speaking: true };

/** the art json of Mugi as the art script wrote it (extra fields: fit, seamReport, blend, feather, visemes, ellipse, poses) */
const mugiJson = {
  size: 657, box: [276, 308, 393, 403], feather: 10, visemes: ['a', 'e', 'i', 'o', 'u', 'm'], takes: [1],
  faceless: true, talkFaces: null,
  figure: {
    file: 'body.webp', w: 657, h: 768, backdrop: false, portrait: { x: 0, y: 0, scale: 1 },
    poses: { idle: { file: 'body.webp', w: 657, h: 768, portrait: { x: 0, y: 0, scale: 1 } }, talk: null },
  },
  fit: { scale: 0.998, dx: -142.75, dy: 2.0, source: 'open frame onto closed frame, mean colour difference' },
};

describe('the parser takes Mugi\'s art (one take, extra fields)', () => {
  it('accepts takes [1] and ignores fit / feather / visemes / poses', () => {
    const art = parseTutorArt(mugiJson) as TutorArt;
    expect(art).not.toBeNull();
    expect(art.takes).toEqual([1]);
    expect(art.faceless).toBe(true);
    expect(art.box).toEqual([276, 308, 393, 403]);
    expect(art.size).toBe(657);
    expect(art.figure).toMatchObject({ file: 'body.webp', w: 657, h: 768 });
  });
  it('still rejects an empty takes list and a bad box', () => {
    expect(parseTutorArt({ ...mugiJson, takes: [] })).toBeNull();
    expect(parseTutorArt({ ...mugiJson, takes: [3] })).toBeNull();
    expect(parseTutorArt({ ...mugiJson, box: [300, 300, 280, 380] })).toBeNull();
  });
  it('reads figure.backdrop: true or false; absent is null (the picture then decides)', () => {
    const fig = (extra: Record<string, unknown>) => ({ ...mugiJson, figure: { ...mugiJson.figure, ...extra } });
    expect((parseTutorArt(fig({ backdrop: true })) as TutorArt).figure?.backdrop).toBe(true);
    expect((parseTutorArt(fig({ backdrop: false })) as TutorArt).figure?.backdrop).toBe(false);
    const { backdrop: _drop, ...noFlag } = mugiJson.figure;
    expect((parseTutorArt({ ...mugiJson, figure: noFlag }) as TutorArt).figure?.backdrop).toBeNull();
    expect((parseTutorArt(fig({ backdrop: 'yes' })) as TutorArt).figure?.backdrop).toBeNull();
  });
});

describe('the mouth of a one-take art never asks for take 2', () => {
  it('speaking with a timeline: every shape is take 1 when the art has only take 1', () => {
    const c = new TutorFaceClock(0, { rng: () => 1, takes: [1] });
    expect(c.frame(100, { ...speaking, cue: { v: 'a', i: 0 } }).mouth).toEqual({ take: 1, viseme: 'a' });
    expect(c.frame(110, { ...speaking, cue: { v: 'i', i: 1 } }).mouth).toEqual({ take: 1, viseme: 'i' });
    expect(c.frame(120, { ...speaking, cue: { v: 'm', i: 2 } }).mouth).toEqual({ take: 1, viseme: 'm' });
  });
  it('speaking on the loudness: every change of shape stays on take 1', () => {
    const c = new TutorFaceClock(0, { rng: () => 1, takes: [1] });
    expect(c.frame(100, { ...speaking, level: 0.9 }).mouth).toEqual({ take: 1, viseme: 'a' });
    expect(c.frame(140, { ...speaking, level: 0 }).mouth).toEqual({ take: 1, viseme: 'm' });
    expect(c.frame(180, { ...speaking, level: 0.9 }).mouth).toEqual({ take: 1, viseme: 'a' });
  });
  it('a two-take art still alternates the takes', () => {
    const c = new TutorFaceClock(0, { rng: () => 1, takes: [1, 2] });
    expect(c.frame(100, { ...speaking, cue: { v: 'a', i: 0 } }).mouth).toEqual({ take: 1, viseme: 'a' });
    expect(c.frame(110, { ...speaking, cue: { v: 'i', i: 1 } }).mouth).toEqual({ take: 2, viseme: 'i' });
  });
  it('the overlay file names of a take come from its number', () => {
    expect(overlayFile(1, 'a')).toBe('mouth-1-a.webp');
    expect(overlayFile(1, 'm')).toBe('mouth-1-m.webp');
  });
});

describe('the real art of Mugi (public/characters/mugi)', () => {
  const root = fileURLToPath(new URL('../../../public/characters/mugi/', import.meta.url));
  const json = `${root}tutor.json`;
  const visemes = ['a', 'e', 'i', 'o', 'u', 'm'] as const;

  it('her art is the only look and it is the one the app uses', () => {
    expect(TUTOR_CHARACTER.artDir).toBe('characters/mugi');
    expect(TUTOR_CHARACTER.id).toBe('mugi');
  });
  it.skipIf(!existsSync(json))('Mugi: a faceless cut-out (no backdrop), one take, all six overlays and the body on disk', () => {
    const art = parseTutorArt(JSON.parse(readFileSync(json, 'utf8'))) as TutorArt;
    expect(art).not.toBeNull();
    expect(art.faceless).toBe(true);
    expect(art.takes).toEqual([1]);
    expect(art.figure?.backdrop).toBe(false);
    for (const v of visemes) {
      expect(existsSync(`${root}${overlayFile(1, v)}`)).toBe(true);
    }
    expect(existsSync(`${root}${art.figure?.file ?? 'body.webp'}`)).toBe(true);
  });
});
