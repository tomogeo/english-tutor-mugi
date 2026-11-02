// 英語家教 face: when she blinks and which mouth overlay is on while she speaks. Pure state machines (time and randomness are
// passed in), so they are tested with fake clocks. Mugi is faceless: her body picture is the whole figure, and the lip-sync
// is a set of mouth overlays drawn on top of it (public/characters/mugi/mouth-<take>-<viseme>.webp), placed by tutor.json.

import type { VisemeCode } from './visemes';
import type { VisemeCue } from './voiceBus';

// ---------- blink ----------
/** the wait between two blinks, and how long the eyes stay shut */
export const BLINK_GAP_MS: [number, number] = [3000, 6000];
export const BLINK_MS = 120;

/** Blinks every 3–6 s; each blink keeps the eyes shut for BLINK_MS. Time is passed in (ms), so a fake clock drives it. */
export class BlinkClock {
  private next: number;
  private until = -1;
  private readonly rng: () => number;
  constructor(now: number, rng: () => number = Math.random) {
    this.rng = rng;
    this.next = now + this.gap();
  }
  private gap(): number {
    const [lo, hi] = BLINK_GAP_MS;
    return lo + this.rng() * (hi - lo);
  }
  /** true while the eyes are shut at `now` (call once per frame, with a non-decreasing clock) */
  closedAt(now: number): boolean {
    if (now < this.until) return true;
    if (now >= this.next) {
      this.until = now + BLINK_MS;
      this.next = this.until + this.gap();
      return true;
    }
    return false;
  }
}

// ---------- amplitude mouth ----------
/** loudness edges between the shapes: below the first → m (closed), then i, e, o, and a for the loudest */
export const LEVEL_EDGES = [0.08, 0.22, 0.4, 0.6] as const;
const BAND_SHAPE: VisemeCode[] = ['m', 'i', 'e', 'o', 'a'];
/** a band change needs the level this far past its edge, so the mouth does not flicker on the boundary */
export const LEVEL_HYSTERESIS = 0.03;

/** The mouth shape for the voice loudness (the fallback when the line has no timeline): silent m, loud a, with hysteresis. */
export class AmplitudeMouth {
  private band = 0;
  step(level: number): VisemeCode {
    // up: the level is past the next edge by the margin; one band at a time
    while (this.band < LEVEL_EDGES.length && level >= LEVEL_EDGES[this.band] + LEVEL_HYSTERESIS) this.band++;
    // down: the level is below the edge under the current band by the margin
    while (this.band > 0 && level < LEVEL_EDGES[this.band - 1] - LEVEL_HYSTERESIS) this.band--;
    return BAND_SHAPE[this.band];
  }
  reset() { this.band = 0; }
}

// ---------- the frame ----------
/** one mouth overlay: which take (1 or 2) and which shape */
export type MouthCue = { take: 1 | 2; viseme: VisemeCode };
/** what is drawn this frame: whether the eyes are shut (the closed-eye picture, when the art has one), and the mouth overlay on top (null: none) */
export type TutorFrame = { closed: boolean; mouth: MouthCue | null };

export type TutorFaceInput = {
  /** she is voicing a reply right now */
  speaking: boolean;
  /** the timeline's shape now (a clip that carries one), null when the line has none */
  cue: VisemeCue | null;
  /** the voice loudness, 0..1 (used when there is no cue) */
  level: number;
};

export type TutorFaceOptions = {
  /** the takes the art has (tutor.json): one take means every overlay is that take */
  takes?: readonly (1 | 2)[];
  rng?: () => number;
};

/**
 * Blink + lip-sync state. While speaking, the mouth follows the timeline when the line has one (take alternates per shape, so
 * the two takes give some variety), otherwise the loudness. Takes alternate when the shape changes.
 */
export class TutorFaceClock {
  private readonly blink: BlinkClock;
  private readonly amp = new AmplitudeMouth();
  private lastShape: VisemeCode | null = null;
  private take: 1 | 2 = 1;
  /** the only take the art has, when it has one; null when the takes alternate */
  private readonly onlyTake: 1 | 2 | null;

  constructor(now: number, opts: TutorFaceOptions = {}) {
    this.blink = new BlinkClock(now, opts.rng);
    this.onlyTake = opts.takes && opts.takes.length === 1 ? opts.takes[0] : null;
  }

  frame(now: number, input: TutorFaceInput): TutorFrame {
    const closed = this.blink.closedAt(now);
    if (!input.speaking) {
      this.amp.reset();
      this.lastShape = null;
      return { closed, mouth: null };
    }
    const shape: VisemeCode = input.cue ? input.cue.v : this.amp.step(input.level);
    const pos = input.cue ? input.cue.i : null;
    // the takes alternate: per shape of the timeline, or per change of shape when the loudness drives the mouth
    if (pos !== null) this.take = pos % 2 === 0 ? 1 : 2;
    else if (shape !== this.lastShape) this.take = this.take === 1 ? 2 : 1;
    this.lastShape = shape;
    return { closed, mouth: { take: this.onlyTake ?? this.take, viseme: shape } };
  }
}

// ---------- art metadata (tutor.json) ----------
export type TutorArt = {
  size: number;
  /** the overlay box in the figure's pixel frame: [x0, y0, x1, y1] */
  box: [number, number, number, number];
  takes: readonly (1 | 2)[];
  /** the figure has one face (its own body's): no portrait images, only the mouth overlays on the body */
  faceless: boolean;
  /** the body the mouth sits on; null when the art has none */
  figure: TutorFigure | null;
};

/** the body picture in its own px frame, and where the portrait layer sits in it: x, y of its top-left, scale */
export type TutorFigure = {
  file: string;
  w: number;
  h: number;
  portrait: { x: number; y: number; scale: number };
  /** the body picture keeps its own background (a photo) rather than being a cut-out; null when the art does not say (the
   *  picture's alpha then decides, ui/TutorPortrait) */
  backdrop: boolean | null;
};

/** the portrait layer's box in percent of the figure: left, top, width, height */
export function portraitPlacement(art: TutorArt): { left: number; top: number; width: number; height: number } {
  const f = art.figure;
  if (!f) return { left: 0, top: 0, width: 100, height: 100 };
  const side = art.size * f.portrait.scale;
  return {
    left: (f.portrait.x / f.w) * 100,
    top: (f.portrait.y / f.h) * 100,
    width: (side / f.w) * 100,
    height: (side / f.h) * 100,
  };
}

/** the mouth box (tutor.json box, in the art's `size` px: the figure's full-res width) in percent of the portrait layer. The
 *  layer is `size` wide and `size × h / w` tall in that same px, so the percentages are the box's share of the layer's width
 *  and height. null when the art has no box. */
export function mouthPlacement(art: TutorArt): { left: number; top: number; width: number; height: number } | null {
  const b = art.box;
  if (!b) return null;
  const s = art.size;
  return { left: (b[0] / s) * 100, top: (b[1] / s) * 100, width: ((b[2] - b[0]) / s) * 100, height: ((b[3] - b[1]) / s) * 100 };
}

/** tutor.json's figure; null when it is missing or malformed (the art then has no body). Its top-level fields are the body. */
export function parseFigure(raw: unknown): TutorFigure | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const p = (o.portrait && typeof o.portrait === 'object' ? o.portrait : null) as Record<string, unknown> | null;
  if (typeof o.file !== 'string' || !o.file || !num(o.w) || !num(o.h) || o.w <= 0 || o.h <= 0) return null;
  if (!p || !num(p.x) || !num(p.y) || !num(p.scale) || p.scale <= 0) return null;
  const backdrop = typeof o.backdrop === 'boolean' ? o.backdrop : null;
  return { file: o.file, w: o.w, h: o.h, portrait: { x: p.x, y: p.y, scale: p.scale }, backdrop };
}

/** tutor.json → the art description; null when the file is not the one the art script wrote (the tutor then has no overlays) */
export function parseTutorArt(raw: unknown): TutorArt | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const box = Array.isArray(o.box) && o.box.length === 4 && o.box.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (o.box as [number, number, number, number]) : null;
  const size = typeof o.size === 'number' && o.size > 0 ? o.size : 0;
  if (!box || !size || box[2] <= box[0] || box[3] <= box[1]) return null;
  const takes = Array.isArray(o.takes) ? o.takes.filter((t): t is 1 | 2 => t === 1 || t === 2) : [];
  if (!takes.length) return null;
  return { size, box, takes, faceless: o.faceless === true, figure: parseFigure(o.figure) };
}

const VISEME_NAMES: VisemeCode[] = ['a', 'e', 'i', 'o', 'u', 'm'];

/** the file of one mouth overlay: "mouth-1-a.webp", under the art folder */
export function overlayFile(take: 1 | 2, viseme: VisemeCode): string {
  return `mouth-${take}-${viseme}.webp`;
}

/** every overlay file the art has, for preloading */
export function overlayFiles(): string[] {
  const out: string[] = [];
  for (const t of [1, 2] as const) for (const v of VISEME_NAMES) out.push(overlayFile(t, v));
  return out;
}
