// 英語家教's free zoom / pan gestures (game/tutorZoom holds the math): pointer events on a box while the zoom is on (one finger
// drags, two pinch around the midpoint, a double tap resets, the mouse wheel zooms around the cursor). The figure (角色) and the
// background (背景) use the same hook with their own geometry, clamp and commit. Native listeners, so the wheel can be stopped
// and the touch gestures are not left to the page's scroll.
import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  clampView, isDoubleTap, panView, pinchBase, pinchView, TAP_SLOP_PX, wheelView, ZOOM_IDENTITY, ZOOM_MAX, ZOOM_MIN,
  type PinchBase, type Pt, type TapMark, type ZoomGeom, type ZoomState, type ZoomView,
} from '../game/tutorZoom';

type Gesture = { mode: 'pan'; from: Pt; base: ZoomView } | { mode: 'pinch'; pinch: PinchBase } | null;

export type GestureOptions = {
  /** gestures are taken only while this is true (the page keeps its own gestures otherwise) */
  on: boolean;
  /** the largest scale the gestures reach */
  maxScale: number;
  /** the smallest scale the gestures reach (default ZOOM_MIN, 1x) */
  minScale?: number;
  /** the view moved: called on every move (dragging true) and when the gesture ends or a double tap resets (dragging false) */
  commit: (v: ZoomView, dragging: boolean) => void;
  /** keeps a view inside its bounds for this geometry */
  clamp: (v: ZoomView, g: ZoomGeom) => ZoomView;
  /** the geometry now: the view's origin, the unscaled box and the stage; null when it cannot be measured */
  geom: (el: HTMLElement) => ZoomGeom | null;
};

/** the figure box's geometry now: its centre (the view's origin), its size and the stage it sits in */
export function figureGeomOf(el: HTMLElement): ZoomGeom | null {
  // the stage the figure is kept in: the .tutor-stage, or the full-screen background layer the classroom's figure is drawn in
  const stage = (el.closest('.tutor-stage, .tutor-backdrop') as HTMLElement | null) ?? el.parentElement;
  if (!stage) return null;
  const r = el.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return {
    origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
    box: { w: r.width, h: r.height },
    stage: { left: s.left, top: s.top, right: s.right, bottom: s.bottom },
  };
}

export function useZoomGestures(ref: RefObject<HTMLElement | null>, view: ZoomView, opts: GestureOptions) {
  const pts = useRef(new Map<number, Pt>());
  // the view the gestures build on: the one shown, except while a pointer is down (then it is the one being moved)
  const cur = useRef<ZoomView>(view);
  if (pts.current.size === 0) cur.current = view;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const gesture = useRef<Gesture>(null);
  const press = useRef<{ t: number; at: Pt; moved: boolean } | null>(null);
  const lastTap = useRef<TapMark | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const put = (v: ZoomView, dragging: boolean) => {
      cur.current = v;
      optsRef.current.commit(v, dragging);
    };
    /** the gesture starts over from the pointers that are down: one finger pans, two pinch */
    const rebase = () => {
      const ps = [...pts.current.values()];
      if (ps.length >= 2) gesture.current = { mode: 'pinch', pinch: pinchBase(cur.current, ps[0], ps[1]) };
      else if (ps.length === 1) gesture.current = { mode: 'pan', from: ps[0], base: cur.current };
      else gesture.current = null;
    };

    const down = (e: PointerEvent) => {
      if (!optsRef.current.on) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* the pointer may already be gone */ }
      const p = { x: e.clientX, y: e.clientY };
      pts.current.set(e.pointerId, p);
      if (pts.current.size === 1) press.current = { t: e.timeStamp, at: p, moved: false };
      else if (press.current) press.current.moved = true; // a second finger is never a tap
      rebase();
    };
    const move = (e: PointerEvent) => {
      if (!optsRef.current.on || !pts.current.has(e.pointerId)) return;
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = press.current;
      if (p && !p.moved && Math.hypot(e.clientX - p.at.x, e.clientY - p.at.y) > TAP_SLOP_PX) p.moved = true;
      const g = optsRef.current.geom(el);
      const gs = gesture.current;
      if (!g || !gs) return;
      const ps = [...pts.current.values()];
      let v: ZoomView;
      if (gs.mode === 'pinch' && ps.length >= 2) v = pinchView(gs.pinch, ps[0], ps[1], g.origin, optsRef.current.maxScale, optsRef.current.minScale ?? ZOOM_MIN);
      else if (gs.mode === 'pan' && ps.length === 1) v = panView(gs.base, gs.from, ps[0]);
      else return;
      put(optsRef.current.clamp(v, g), true);
    };
    const up = (e: PointerEvent) => {
      if (!pts.current.has(e.pointerId)) return;
      pts.current.delete(e.pointerId);
      if (pts.current.size > 0) {
        // one finger lifted from a pinch: the other carries on as a pan from where the view is now
        rebase();
        return;
      }
      const p = press.current;
      press.current = null;
      gesture.current = null;
      optsRef.current.commit(cur.current, false);
      if (!p || p.moved) return;
      const tap: TapMark = { t: e.timeStamp, x: p.at.x, y: p.at.y };
      if (isDoubleTap(lastTap.current, tap)) {
        // a double tap resets the view; not being dragged any more, the page animates it back
        lastTap.current = null;
        cur.current = ZOOM_IDENTITY;
        optsRef.current.commit(ZOOM_IDENTITY, false);
      } else {
        lastTap.current = tap;
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!optsRef.current.on) return;
      e.preventDefault();
      const g = optsRef.current.geom(el);
      if (!g) return;
      const v = wheelView(cur.current, e.deltaY, { x: e.clientX, y: e.clientY }, g.origin, optsRef.current.maxScale, optsRef.current.minScale ?? ZOOM_MIN);
      put(optsRef.current.clamp(v, g), false);
    };

    // WebKit (iPhone) runs its own pinch-zoom / scroll on touches unless they are cancelled: the viewport's
    // user-scalable=no is ignored there, so while the zoom is on these native gestures are stopped on the box
    // (passive: false is what lets preventDefault work). Off, nothing is stopped: the page keeps its own gestures.
    const native = (e: Event) => { if (optsRef.current.on) e.preventDefault(); };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('touchmove', native, { passive: false });
    el.addEventListener('gesturestart', native);
    el.addEventListener('gesturechange', native);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchmove', native);
      el.removeEventListener('gesturestart', native);
      el.removeEventListener('gesturechange', native);
    };
  }, [ref]);
}

/** the scale range of a figure: the defaults (1x..4x) unless the caller gives its own (a custom picture may go down to 0.5x) */
export type FigureZoomRange = { minScale?: number; maxScale?: number };

/** the figure's free zoom (角色): the gestures move the ZoomState's view of the figure */
export function useFigureZoom(ref: RefObject<HTMLElement | null>, zoom: ZoomState, setZoom: Dispatch<SetStateAction<ZoomState>>, range: FigureZoomRange = {}) {
  const maxScale = range.maxScale ?? ZOOM_MAX;
  const minScale = range.minScale ?? ZOOM_MIN;
  useZoomGestures(ref, zoom.view, {
    on: zoom.on,
    maxScale,
    minScale,
    commit: (v, dragging) => setZoom((z) => ({ ...z, view: v, dragging })),
    clamp: (v, g) => clampView(v, g, maxScale, minScale),
    geom: figureGeomOf,
  });
}
