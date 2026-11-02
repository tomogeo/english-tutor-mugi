import { useSyncExternalStore } from 'react';

// Full-screen app height + a hidden viewport debug overlay.
//
// iOS 主畫面 (standalone) with `black-translucent` + `viewport-fit=cover` draws the page from y=0 under the status
// bar, but WebKit sizes the layout viewport (what `position: fixed; bottom: 0`, `100%`, `100dvh`,
// `-webkit-fill-available` and often `innerHeight` resolve against) as screen height MINUS the status bar. Result:
// a fixed #root ends one status-bar height above the physical bottom and the page background shows through.
// Fix: in standalone, size #root from the real screen height (`--app-h`), pinned at top: 0.
//
// Debug overlay: `?vp=1` in the URL shows live
// viewport numbers; the flag persists in localStorage `mugien.vp`.

const nav = navigator as Navigator & { standalone?: boolean };
const iosStandalone = nav.standalone === true;
const displayStandalone = () => window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
export const isStandalone = () => iosStandalone || displayStandalone();

function fullHeight(): number {
  const de = document.documentElement;
  const vv = window.visualViewport;
  let h = Math.max(window.innerHeight, de.clientHeight, vv ? vv.height + vv.offsetTop : 0);
  if (iosStandalone) {
    // the app window IS the whole screen on iOS standalone; screen.* are portrait-fixed on iOS, so pick by orientation
    const landscape = window.innerWidth > window.innerHeight;
    const sh = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    h = Math.max(h, sh);
  }
  return Math.round(h);
}

function applyHeight() {
  const de = document.documentElement;
  const sa = isStandalone();
  de.classList.toggle('standalone', sa);
  const h = sa ? fullHeight() : 0;
  // never write a 0 / NaN height: #root would collapse to nothing (CSS falls back to 100lvh when unset)
  if (sa && Number.isFinite(h) && h > 100) de.style.setProperty('--app-h', `${h}px`);
  else de.style.removeProperty('--app-h');
  if (overlay) renderOverlay();
}

// ---- debug overlay ----
const KEY = 'mugien.vp';
let overlay: HTMLDivElement | null = null;
let probe: HTMLDivElement | null = null;
let timer = 0;
const listeners = new Set<(on: boolean) => void>();
/** live on-screen-keyboard numbers (ui/useIOSKeyboard) for the overlay */
export const kbDebug: { get?: () => string } = {};

function readFlag(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('vp');
    if (q === '1') localStorage.setItem(KEY, '1');
    else if (q === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return new URLSearchParams(location.search).get('vp') === '1';
  }
}

export const isViewportDebug = () => !!overlay;
export function onViewportDebug(fn: (on: boolean) => void) { listeners.add(fn); return () => void listeners.delete(fn); }

export function setViewportDebug(on: boolean) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  if (on && !overlay) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;z-index:99999;left:50%;top:40%;transform:translate(-50%,-50%);max-width:92vw;' +
      'padding:8px 10px;border-radius:10px;background:rgba(0,0,0,0.78);color:#e8e8e8;font:11px/1.45 ui-monospace,Menlo,monospace;' +
      'white-space:pre;pointer-events:auto;user-select:text;-webkit-user-select:text';
    overlay.title = '點兩下關閉';
    overlay.addEventListener('dblclick', () => setViewportDebug(false));
    document.body.append(probe, overlay);
    renderOverlay();
    timer = window.setInterval(renderOverlay, 500);
  } else if (!on && overlay) {
    overlay.remove(); probe?.remove(); overlay = probe = null;
    clearInterval(timer);
  }
  listeners.forEach((fn) => fn(on));
}

function renderOverlay() {
  if (!overlay || !probe) return;
  const de = document.documentElement;
  const vv = window.visualViewport;
  const ps = getComputedStyle(probe);
  const r = document.getElementById('root')?.getBoundingClientRect();
  const canvas = document.querySelector('#root canvas')?.getBoundingClientRect();
  const mm = (q: string) => (window.matchMedia(q).matches ? '1' : '0');
  const f = (n: number | undefined) => (n == null ? '-' : Math.round(n * 10) / 10);
  overlay.textContent = [
    `inner      ${innerWidth} × ${innerHeight}`,
    `outer      ${outerWidth} × ${outerHeight}`,
    `screen     ${screen.width} × ${screen.height}`,
    `avail      ${screen.availWidth} × ${screen.availHeight}`,
    `visualVP   ${f(vv?.width)} × ${f(vv?.height)}  top ${f(vv?.offsetTop)}`,
    `scroll     window ${f(window.scrollY)}  docEl ${f(de.scrollTop)}  body ${f(document.body.scrollTop)}`,
    `keyboard   ${kbDebug.get?.() ?? '-'}`,
    `docEl.client ${de.clientWidth} × ${de.clientHeight}`,
    `#root      y ${f(r?.top)} h ${f(r?.height)} bottom ${f(r?.bottom)}`,
    `canvas     ${canvas ? `y ${f(canvas.top)} h ${f(canvas.height)}` : '-'}`,
    `--app-h    ${de.style.getPropertyValue('--app-h') || '(unset)'}`,
    `safe-area  T ${ps.paddingTop} B ${ps.paddingBottom} L ${ps.paddingLeft} R ${ps.paddingRight}`,
    `standalone nav ${String(nav.standalone)}  class ${de.classList.contains('standalone')}`,
    `display    standalone ${mm('(display-mode: standalone)')} fullscreen ${mm('(display-mode: fullscreen)')} browser ${mm('(display-mode: browser)')}`,
    `dpr        ${devicePixelRatio}   orient ${screen.orientation?.type ?? '-'}`,
    `(點兩下關閉)`,
  ].join('\n');
}

export function initViewport() {
  applyHeight();
  window.addEventListener('resize', applyHeight);
  window.addEventListener('orientationchange', () => { applyHeight(); setTimeout(applyHeight, 300); });
  window.visualViewport?.addEventListener('resize', applyHeight);
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', applyHeight);
  // iOS sometimes settles the standalone viewport a moment after launch / resume
  window.addEventListener('pageshow', applyHeight);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyHeight(); });
  setTimeout(applyHeight, 500);
  // html / body no longer clip (index.css): keep the document itself from scrolling (standalone: it is screen-tall,
  // the layout viewport is shorter by the status bar)
  // (not while the chat keyboard is up — html.kb-lock, ui/useIOSKeyboard: fighting iOS's own scroll makes it flicker)
  window.addEventListener('scroll', () => {
    if ((window.scrollY || window.scrollX) && !document.documentElement.classList.contains('kb-lock')) window.scrollTo(0, 0);
  }, { passive: true });
  if (readFlag()) {
    if (document.body) setViewportDebug(true);
    else window.addEventListener('DOMContentLoaded', () => setViewportDebug(true), { once: true });
  }
}

/** React binding for the 「顯示尺寸資訊」 switches. */
export function useViewportDebug(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(onViewportDebug, isViewportDebug), setViewportDebug];
}
