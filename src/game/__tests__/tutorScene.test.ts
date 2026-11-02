import { describe, expect, it } from 'vitest';
import {
  BACKDROP_IDENTITY, BACKDROP_ZOOM_MAX, DEFAULT_SCENE, cleanBackdropView, cleanBackgroundDim, cleanBackgroundId,
  clampBackdrop, coverBox, coverOf, coverSize, dimOf, figureAnchorBox, sceneBox,
} from '../tutorScene';
import { ANCHORS, CUSTOM_ANCHOR, anchorOf } from '../tutorCharacters';

const IMG = { w: DEFAULT_SCENE.width, h: DEFAULT_SCENE.height };
const RATIO = 851 / 1848;
const TALL = { w: 390, h: 844 }; // a phone, portrait
const WIDE = { w: 1000, h: 500 }; // a wide window
const SQUARE = { w: 400, h: 400 };
const HAMSTER_ASPECT = 768 / 657; // body.webp h / w
const YUI_ASPECT = 900 / 689; // public/characters/yui/a.webp h / w
const YUMA_ASPECT = 900 / 414; // public/characters/yuma/a.webp h / w
const HAMSTER = ANCHORS.mugi;

describe('the classroom scene box (cover)', () => {
  it('the picture is 851 × 1848; the hamster anchor is 23.2% wide, feet at 58.7% (the anchor table)', () => {
    expect(DEFAULT_SCENE).toMatchObject({ width: 851, height: 1848 });
    expect(HAMSTER).toEqual({ width: 0.232, centerX: 0.5, anchorY: 0.587, pictureAnchor: 1 });
    expect(anchorOf('mugi')).toEqual(HAMSTER);
    expect(CUSTOM_ANCHOR).toEqual({ width: 0.45, centerX: 0.5, anchorY: 0.974, pictureAnchor: 1 });
  });

  it.each([['tall phone', TALL], ['wide window', WIDE], ['square', SQUARE]])('covers the %s stage with the picture ratio, centred', (_name, stage) => {
    const c = coverBox(stage, IMG);
    expect(c.width).toBeGreaterThanOrEqual(stage.w - 1e-9);
    expect(c.height).toBeGreaterThanOrEqual(stage.h - 1e-9);
    // one side is exactly the stage's (the other is cropped)
    expect(Math.min(Math.abs(c.width - stage.w), Math.abs(c.height - stage.h))).toBeLessThan(1e-9);
    expect(c.width / c.height).toBeCloseTo(RATIO, 9);
    expect(c.left + c.width / 2).toBeCloseTo(stage.w / 2, 9);
    expect(c.top + c.height / 2).toBeCloseTo(stage.h / 2, 9);
  });

  it('a tall stage fits the width, a wide stage fits the height', () => {
    expect(coverSize(TALL, IMG).w).toBeCloseTo(390, 9);
    expect(coverSize(TALL, IMG).h).toBeGreaterThan(844);
    expect(coverSize(WIDE, IMG).w).toBeCloseTo(1000, 9); // the picture is tall: a wide stage is covered by its width
  });

  it('the identity view is the cover box when anchored, the stage itself when not', () => {
    expect(sceneBox(TALL, BACKDROP_IDENTITY, true)).toEqual(coverBox(TALL, IMG));
    expect(sceneBox(TALL, BACKDROP_IDENTITY, false)).toEqual({ left: 0, top: 0, width: 390, height: 844 });
    expect(coverOf(TALL, false)).toEqual({ w: 390, h: 844 });
  });
});

describe('the characters on the lectern (figureAnchorBox)', () => {
  it.each([['tall', TALL], ['wide', WIDE]])('the hamster on a %s stage: 23.2% of the picture wide, centred, feet at 58.7% of its height', (_n, stage) => {
    const scene = sceneBox(stage, BACKDROP_IDENTITY, true);
    const fig = figureAnchorBox(scene, HAMSTER_ASPECT, HAMSTER);
    expect(fig.width / scene.width).toBeCloseTo(0.232, 9);
    expect((fig.width / scene.width) * DEFAULT_SCENE.width).toBeCloseTo(0.232 * 851, 6); // in the picture's own pixels
    expect(fig.left + fig.width / 2).toBeCloseTo(scene.left + scene.width * 0.5, 9);
    expect((fig.top + fig.height - scene.top) / scene.height).toBeCloseTo(0.587, 9); // her feet
    expect(fig.height / fig.width).toBeCloseTo(HAMSTER_ASPECT, 9);
  });

  it('Lily sits: 62% of the picture wide, centred, the point 64% down her picture at 58.7% of the height', () => {
    const scene = sceneBox(TALL, BACKDROP_IDENTITY, true);
    const fig = figureAnchorBox(scene, YUI_ASPECT, ANCHORS.yui);
    expect(fig.width / scene.width).toBeCloseTo(0.53, 9);
    expect(fig.left + fig.width / 2).toBeCloseTo(scene.left + scene.width / 2, 9);
    expect((fig.top + fig.height * 0.64 - scene.top) / scene.height).toBeCloseTo(0.587, 9);
  });

  it('Ethan stands: 76% of the picture wide, centred, his feet at 91.5% of the picture height', () => {
    const scene = sceneBox(TALL, BACKDROP_IDENTITY, true);
    const fig = figureAnchorBox(scene, YUMA_ASPECT, ANCHORS.yuma);
    expect(fig.width / scene.width).toBeCloseTo(0.76, 9);
    expect(fig.left + fig.width / 2).toBeCloseTo(scene.left + scene.width / 2, 9);
    expect((fig.top + fig.height - scene.top) / scene.height).toBeCloseTo(0.915, 9);
  });

  it('follows the scene (the default box) when the background is zoomed: the anchor is the same on the default box', () => {
    const scene = sceneBox(TALL, BACKDROP_IDENTITY, true);
    const fig = figureAnchorBox(scene, HAMSTER_ASPECT, HAMSTER);
    expect((fig.top + fig.height - scene.top) / scene.height).toBeCloseTo(0.587, 9);
    expect(fig.width / scene.width).toBeCloseTo(0.232, 9);
  });
});

describe('clampBackdrop (the background view stays over the stage)', () => {
  it('the scale is kept between 1x and 3x; a bad number reads as 1x', () => {
    const cover = coverSize(SQUARE, IMG);
    expect(clampBackdrop({ scale: 0.2, x: 0, y: 0 }, cover, SQUARE).scale).toBe(1);
    expect(clampBackdrop({ scale: 9, x: 0, y: 0 }, cover, SQUARE).scale).toBe(BACKDROP_ZOOM_MAX);
    expect(clampBackdrop({ scale: Number.NaN, x: 0, y: 0 }, cover, SQUARE).scale).toBe(1);
  });

  it('the offset is limited so the scene still covers the stage: no empty edges', () => {
    const stage = TALL;
    const cover = coverSize(stage, IMG);
    for (const scale of [1, 1.5, 3]) {
      const v = clampBackdrop({ scale, x: 99999, y: -99999 }, cover, stage);
      const s = sceneBox(stage, v, true);
      expect(s.left).toBeLessThanOrEqual(1e-9);
      expect(s.left + s.width).toBeGreaterThanOrEqual(stage.w - 1e-9);
      expect(s.top).toBeLessThanOrEqual(1e-9);
      expect(s.top + s.height).toBeGreaterThanOrEqual(stage.h - 1e-9);
    }
  });

  it('a tall phone at 1x can only move vertically (the width already fits)', () => {
    const cover = coverSize(TALL, IMG);
    expect(clampBackdrop({ scale: 1, x: 50, y: 0 }, cover, TALL).x).toBe(0);
    const v = clampBackdrop({ scale: 1, x: 0, y: 999 }, cover, TALL);
    expect(v.y).toBeCloseTo((cover.h - TALL.h) / 2, 9);
  });

  it('a view inside its bounds is kept as it is', () => {
    const cover = coverSize(SQUARE, IMG);
    expect(clampBackdrop({ scale: 2, x: 10, y: -20 }, cover, SQUARE)).toEqual({ scale: 2, x: 10, y: -20 });
  });
});

describe('saved values read as the rules say', () => {
  it('the mode: classroom, custom or black; anything else is the classroom', () => {
    expect(cleanBackgroundId('black', [])).toBe('black');
    expect(cleanBackgroundId('classroom', [])).toBe('classroom');
    expect(cleanBackgroundId('b1', ['b1'])).toBe('b1');
    expect(cleanBackgroundId('b2', ['b1'])).toBe('classroom');
    expect(cleanBackgroundId('svg', [])).toBe('classroom');
    expect(cleanBackgroundId(undefined, [])).toBe('classroom');
  });

  it('the dimming: a whole number 0..60, else null (the mode default)', () => {
    expect(cleanBackgroundDim(25.4)).toBe(25);
    expect(cleanBackgroundDim(90)).toBe(60);
    expect(cleanBackgroundDim(-5)).toBe(0);
    expect(cleanBackgroundDim('25')).toBeNull();
    expect(cleanBackgroundDim(null)).toBeNull();
  });

  it('the dimming in effect: 0 for the classroom, 25 for a picture of the player, the saved one when set', () => {
    expect(dimOf(false, null)).toBe(0);
    expect(dimOf(true, null)).toBe(25);
    expect(dimOf(true, 40)).toBe(40);
    expect(dimOf(false, 0)).toBe(0);
  });

  it('the view: scale 1x..3x and finite offsets; anything else is the identity', () => {
    expect(cleanBackdropView({ scale: 2, x: 4, y: -6 })).toEqual({ scale: 2, x: 4, y: -6 });
    expect(cleanBackdropView({ scale: 7, x: 'a', y: Number.NaN })).toEqual({ scale: 3, x: 0, y: 0 });
    expect(cleanBackdropView(null)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
