// 英語家教's free zoom / pan (自由縮放): the gesture math for the character figure, pure so it can be tested. The view is a
// translate + scale of the figure's box about its own centre: the body, the face and the mouth overlays move as one (the
// figure is one wrapper in TutorPortrait), so the lip sync and the blink stay aligned. Coordinates are client pixels.
export type Pt = { x: number; y: number };
export type ZoomView = { scale: number; x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
/** the figure's box as it is laid out now (unscaled): its centre, its size and the stage it sits in */
export type ZoomGeom = { origin: Pt; box: { w: number; h: number }; stage: Rect };
/** the state the page keeps: the toggle (自由縮放 on or off), the view, and whether a gesture is moving it (no animation then) */
export type ZoomState = { on: boolean; view: ZoomView; dragging: boolean };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_IDENTITY: ZoomView = { scale: 1, x: 0, y: 0 };
/** a double tap: two taps this close in time and place reset the view */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;
/** a finger that moves more than this is a drag, not a tap */
export const TAP_SLOP_PX = 10;
/** the share of the scaled figure that must stay on the stage, so a pan can never drag it fully out of view */
const KEEP = 0.3;
const WHEEL_RATE = 0.0015;
const STORE_KEY = 'mugien.tutorZoom.on';

/** the scale kept between min and max (1x..4x by default; the figure's own picture may go down to FIGURE_SCALE_MIN) */
export function clampScale(s: number, max: number = ZOOM_MAX, min: number = ZOOM_MIN): number {
  if (!Number.isFinite(s)) return min;
  return Math.min(max, Math.max(min, s));
}

/** the translation range on one axis. A box that fits the stage (inside) may move anywhere as long as it stays fully on the stage;
 *  otherwise the centre may move so that KEEP of it still overlaps the stage on both ends */
function axisRange(origin: number, scaledLen: number, lo: number, hi: number, inside: boolean): [number, number] {
  if (inside && scaledLen <= hi - lo) return [lo + scaledLen / 2 - origin, hi - scaledLen / 2 - origin];
  const keep = Math.min(scaledLen, hi - lo) * KEEP;
  return [lo + keep - origin - scaledLen / 2, hi - keep - origin + scaledLen / 2];
}

/** the view with its scale clamped to min..max (1x..4x by default) and its translation kept inside the pan bounds. Below 1x the
 *  figure is smaller than the stage, so it may be moved anywhere while staying fully on the stage. */
export function clampView(v: ZoomView, g: ZoomGeom, max: number = ZOOM_MAX, min: number = ZOOM_MIN): ZoomView {
  const scale = clampScale(v.scale, max, min);
  const inside = scale < 1;
  const [minX, maxX] = axisRange(g.origin.x, g.box.w * scale, g.stage.left, g.stage.right, inside);
  const [minY, maxY] = axisRange(g.origin.y, g.box.h * scale, g.stage.top, g.stage.bottom, inside);
  return { scale, x: Math.min(maxX, Math.max(minX, v.x)), y: Math.min(maxY, Math.max(minY, v.y)) };
}

/** zoom to scale `ns` keeping the point under `pivot` where it is (a wheel tick, or a pinch's own midpoint) */
export function zoomAbout(v: ZoomView, ns: number, pivot: Pt, origin: Pt, max: number = ZOOM_MAX, min: number = ZOOM_MIN): ZoomView {
  const scale = clampScale(ns, max, min);
  const k = scale / v.scale;
  const rx = pivot.x - origin.x, ry = pivot.y - origin.y;
  return { scale, x: rx - (rx - v.x) * k, y: ry - (ry - v.y) * k };
}

/** a pinch in progress: the view the gesture began with, its midpoint and finger distance */
export type PinchBase = { view: ZoomView; mid: Pt; dist: number };

export function pinchBase(view: ZoomView, a: Pt, b: Pt): PinchBase {
  return { view, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) };
}

/** the view while two fingers move: the scale follows the finger distance, and the content under the starting midpoint
 *  stays under the current midpoint (so the midpoint's own movement pans as well) */
export function pinchView(base: PinchBase, a: Pt, b: Pt, origin: Pt, max: number = ZOOM_MAX, min: number = ZOOM_MIN): ZoomView {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const scale = clampScale(base.view.scale * (dist / base.dist), max, min);
  const k = scale / base.view.scale;
  return {
    scale,
    x: (mid.x - origin.x) - (base.mid.x - origin.x - base.view.x) * k,
    y: (mid.y - origin.y) - (base.mid.y - origin.y - base.view.y) * k,
  };
}

/** one finger drags the figure: the view's translation follows the finger */
export function panView(view: ZoomView, from: Pt, to: Pt): ZoomView {
  return { scale: view.scale, x: view.x + (to.x - from.x), y: view.y + (to.y - from.y) };
}

/** a mouse wheel tick: a step per delta, around the cursor */
export function wheelView(v: ZoomView, deltaY: number, cursor: Pt, origin: Pt, max: number = ZOOM_MAX, min: number = ZOOM_MIN): ZoomView {
  return zoomAbout(v, v.scale * Math.exp(-deltaY * WHEEL_RATE), cursor, origin, max, min);
}

export type TapMark = { t: number; x: number; y: number };
/** true when `now` completes a double tap begun at `prev` */
export function isDoubleTap(prev: TapMark | null, now: TapMark): boolean {
  if (!prev) return false;
  return now.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(now.x - prev.x, now.y - prev.y) <= DOUBLE_TAP_PX;
}

/** the default framing again, the toggle as it is (a switch of teacher: her head sits elsewhere, so the view starts over) */
export function resetView(z: ZoomState): ZoomState {
  return { ...z, view: ZOOM_IDENTITY, dragging: false };
}

/** the toggle flipped: ON keeps the (default) view ready to be zoomed, OFF goes back to the default framing (the page
 *  animates it, as the view is no longer being dragged) */
export function toggleZoom(z: ZoomState): ZoomState {
  return { on: !z.on, view: ZOOM_IDENTITY, dragging: false };
}

/** the toggle is remembered for the session only (sessionStorage, so it is gone with the tab); a store that throws reads as off */
export function readZoomOn(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeZoomOn(on: boolean): void {
  try {
    globalThis.sessionStorage?.setItem(STORE_KEY, on ? '1' : '0');
  } catch {
    // no storage (private window): the toggle simply is not remembered
  }
}
