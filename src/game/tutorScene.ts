// 英語家教's background (背景) and the scene math: pure, so it is tested with plain numbers. The default background is the
// classroom picture; Mugi stands on its lectern, so the picture and her live in one "scene" box with the picture's own aspect
// ratio, sized to cover the stage (cover: cropped, never distorted, centred). The 背景 view (pinch / drag of the whole scene)
// is kept in the settings; the render clamps it, so a stored view that no longer fits the stage is pulled back in.
/**
 * The background (背景) in use is an id: 'classroom' (the built-in picture, the only one with lecterns), 'black' (plain black), or the id
 * of an added background (game/tutorBackground). Built-in ids are fixed; each added one has its own picture, dimming and view.
 */
export const BUILTIN_BACKGROUNDS = ['classroom', 'black'] as const;
export const isBuiltinBackground = (id: string): boolean => (BUILTIN_BACKGROUNDS as readonly string[]).includes(id);

/** a fresh id for an added background (its picture's record key in IndexedDB too) */
export function newBackgroundId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
/** what the free zoom (自由縮放) moves: the character (角色) or the whole background (背景) */
export type ZoomTarget = 'figure' | 'backdrop';

export type Size = { w: number; h: number };
export type Box = { left: number; top: number; width: number; height: number };
/** the background view: a scale about the scene's centre, and its offset in px (the same model as the figure's view) */
export type BackdropView = { scale: number; x: number; y: number };

export const BACKDROP_IDENTITY: BackdropView = { scale: 1, x: 0, y: 0 };
export const BACKDROP_ZOOM_MIN = 1;
export const BACKDROP_ZOOM_MAX = 3;
export const DIM_MAX = 60;
export const DIM_DEFAULT_CLASSROOM = 0;
export const DIM_DEFAULT_CUSTOM = 25;

/**
 * The classroom picture, in its own pixels (written by the project author for public/backgrounds/classroom.webp, 851 × 1848). Where
 * each character stands on it is the anchor table in game/tutorCharacters.ts.
 */
export const DEFAULT_SCENE = {
  file: 'backgrounds/classroom.webp',
  width: 851,
  height: 1848,
};
/**
 * Where a figure stands in the scene, all as shares of the scene (0..1): its width and its centre x as shares of the scene's width,
 * `anchorY` as a share of its height, and `pictureAnchor` the share of the figure's own picture height that sits at anchorY
 * (1 = the bottom of the picture, its feet; 0.64 = the point 64% down the picture).
 */
export type FigureAnchor = { width: number; centerX: number; anchorY: number; pictureAnchor: number };

/** the size that covers the stage with the image's aspect ratio (the larger of the two scales wins; the rest is cropped) */
export function coverSize(stage: Size, img: Size): Size {
  const s = Math.max(stage.w / img.w, stage.h / img.h);
  return { w: img.w * s, h: img.h * s };
}

/** the unscaled cover box of the scene: the classroom picture's cover box when anchored, else the stage itself */
export function coverOf(stage: Size, anchored: boolean): Size {
  return anchored ? coverSize(stage, { w: DEFAULT_SCENE.width, h: DEFAULT_SCENE.height }) : { w: stage.w, h: stage.h };
}

/** the scene's box in stage px: the cover box, scaled and offset by the view, centred on the stage */
export function sceneBox(stage: Size, view: BackdropView, anchored: boolean): Box {
  const c = coverOf(stage, anchored);
  const w = c.w * view.scale;
  const h = c.h * view.scale;
  return { left: (stage.w - w) / 2 + view.x, top: (stage.h - h) / 2 + view.y, width: w, height: h };
}

/** the cover box of the classroom picture in the stage (centred, cropped on the longer side) */
export function coverBox(stage: Size, img: Size): Box {
  const c = coverSize(stage, img);
  return { left: (stage.w - c.w) / 2, top: (stage.h - c.h) / 2, width: c.w, height: c.h };
}

/** the figure's box in stage px, from the scene box: width = anchor.width of the scene, height from the figure's aspect (h / w),
 *  centred at anchor.centerX, and the point pictureAnchor down the picture at anchor.anchorY of the scene's height */
export function figureAnchorBox(scene: Box, figAspect: number, anchor: FigureAnchor): Box {
  const width = scene.width * anchor.width;
  const height = width * figAspect;
  return {
    left: scene.left + scene.width * anchor.centerX - width / 2,
    top: scene.top + scene.height * anchor.anchorY - height * anchor.pictureAnchor,
    width,
    height,
  };
}

/** the view kept inside its bounds: the scale within 1x..max, and the offset so the scene still covers the stage (no empty edges) */
export function clampBackdrop(v: BackdropView, cover: Size, stage: Size, max: number = BACKDROP_ZOOM_MAX): BackdropView {
  const scale = Number.isFinite(v.scale) ? Math.min(max, Math.max(BACKDROP_ZOOM_MIN, v.scale)) : BACKDROP_ZOOM_MIN;
  const maxX = Math.max(0, (cover.w * scale - stage.w) / 2);
  const maxY = Math.max(0, (cover.h * scale - stage.h) / 2);
  const x = Number.isFinite(v.x) ? v.x : 0;
  const y = Number.isFinite(v.y) ? v.y : 0;
  return { scale, x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
}

/** the background a save holds: a built-in id or one of the added ids listed in the save; anything else is the classroom */
export function cleanBackgroundId(raw: unknown, added: readonly string[]): string {
  return typeof raw === 'string' && (isBuiltinBackground(raw) || added.includes(raw)) ? raw : 'classroom';
}

/** the dimming share a save holds: a whole number 0..60, else null (= the default of the mode) */
export function cleanBackgroundDim(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.min(DIM_MAX, Math.max(0, Math.round(raw)));
}

/** the dimming in effect: the saved one, else 25% for an added picture and 0% for the classroom (`added`: an added background) */
export function dimOf(added: boolean, dim: number | null): number {
  return dim ?? (added ? DIM_DEFAULT_CUSTOM : DIM_DEFAULT_CLASSROOM);
}

/** the background view a save holds (scale 1x..3x, finite offsets); anything else is the identity */
export function cleanBackdropView(raw: unknown): BackdropView {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const scale = typeof o.scale === 'number' && Number.isFinite(o.scale) ? Math.min(BACKDROP_ZOOM_MAX, Math.max(BACKDROP_ZOOM_MIN, o.scale)) : 1;
  return { scale, x: num(o.x), y: num(o.y) };
}
