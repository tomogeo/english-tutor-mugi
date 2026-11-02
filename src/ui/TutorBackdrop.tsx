// 英語家教's background layer (背景): the picture, covering the stage, with its dimming, and the pinch / drag / double tap of the
// 背景 view. The scene box (game/tutorScene) is laid out in px, not transformed, so a figure inside it (the classroom's hamster on
// the lectern) scales with it and its own 角色 zoom still measures true positions. Children are drawn inside the scene.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BACKDROP_IDENTITY, BACKDROP_ZOOM_MAX, clampBackdrop, coverOf, sceneBox, type BackdropView, type Size } from '../game/tutorScene';
import { useZoomGestures } from './useFigureZoom';

/** the size the backdrop covers: its own box when laid out, else the window (a box not yet laid out reads 0 x 0) */
export function measureBox(el: HTMLElement): Size {
  const r = el.getBoundingClientRect();
  return {
    w: r.width > 0 ? r.width : window.innerWidth,
    h: r.height > 0 ? r.height : window.innerHeight,
  };
}

/** the first size, before any layout: the window itself (the backdrop is the full screen) */
function windowSize(): Size {
  return typeof window === 'undefined' ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight };
}

export function TutorBackdrop(props: {
  src: string;
  /** the classroom: the scene keeps the picture's aspect ratio (her lectern); otherwise the scene is the stage */
  anchored: boolean;
  /** the dimming, 0..60 (percent) */
  dim: number;
  /** the saved view (clamped here, so it always covers the stage) */
  view: BackdropView;
  dragging: boolean;
  /** 背景 is the zoom target and the zoom is on: the gestures move the background */
  gestures: boolean;
  onView: (v: BackdropView, dragging: boolean) => void;
  /** drawn inside the scene (moves and scales with the background) */
  children?: ReactNode;
  /** her figure: drawn in its own layer on the scene's DEFAULT box (view 1x, no offset), so a background zoom leaves her place and size as they are */
  figure?: ReactNode;
}) {
  const { src, anchored, dim, view, dragging, gestures, onView, children, figure } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  // the first render already has the window's size (no 0 x 0 box), and the layout effect measures the real box before paint
  const [stage, setStage] = useState<Size>(windowSize);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setStage(measureBox(el));
    measure();
    window.addEventListener('resize', measure);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      vv?.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);

  const clamped = clampBackdrop(view, coverOf(stage, anchored), stage);
  const box = sceneBox(stage, clamped, anchored);
  // the figure's layer: the default scene box, never the zoomed one
  const defaultBox = sceneBox(stage, BACKDROP_IDENTITY, anchored);

  useZoomGestures(wrapRef, clamped, {
    on: gestures,
    maxScale: BACKDROP_ZOOM_MAX,
    commit: onView,
    clamp: (v, g) => clampBackdrop(v, g.box, { w: g.stage.right - g.stage.left, h: g.stage.bottom - g.stage.top }),
    geom: (el) => {
      const r = el.getBoundingClientRect();
      const cover = coverOf({ w: r.width, h: r.height }, anchored);
      return {
        origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        box: { w: cover.w, h: cover.h },
        stage: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      };
    },
  });

  return (
    <div className={gestures ? 'tutor-backdrop zoom-on' : 'tutor-backdrop'} ref={wrapRef}>
      <div className={dragging ? 'tutor-scene dragging' : 'tutor-scene'}
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
        <img className="tutor-bg" src={src} alt="" draggable={false} decoding="async" />
        {dim > 0 && <div className="tutor-dim" style={{ opacity: dim / 100 }} />}
        {children}
      </div>
      {figure !== undefined && (
        <div className="tutor-figure-layer"
          style={{ left: defaultBox.left, top: defaultBox.top, width: defaultBox.width, height: defaultBox.height }}>
          {figure}
        </div>
      )}
    </div>
  );
}
