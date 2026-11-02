// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TutorBackdrop } from '../TutorBackdrop';
import { BACKDROP_IDENTITY, DEFAULT_SCENE } from '../../game/tutorScene';

// the backdrop box is 400 × 800 px in jsdom (no layout): it reads its size from getBoundingClientRect (the window when that is 0)
const rectOf = (w: number, h: number) => () => ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON() {} });
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = rectOf(400, 800) as unknown as typeof HTMLElement.prototype.getBoundingClientRect;
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
  vi.unstubAllGlobals();
});

function render(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const base = { src: 'blob:x', anchored: true, dim: 0, dragging: false, gestures: false, onView: () => {} };
const sceneOf = (host: HTMLElement) => host.querySelector<HTMLElement>('.tutor-scene')!;

describe('TutorBackdrop first paint (the full screen, centred)', () => {
  /** the cover must cover the window and sit centred on it: no empty edge, no offset */
  function expectCoversCentred(s: HTMLElement, vw: number, vh: number) {
    const left = parseFloat(s.style.left), top = parseFloat(s.style.top);
    const w = parseFloat(s.style.width), h = parseFloat(s.style.height);
    expect(left).toBeLessThanOrEqual(1e-6);
    expect(top).toBeLessThanOrEqual(1e-6);
    expect(left + w).toBeGreaterThanOrEqual(vw - 1e-6);
    expect(top + h).toBeGreaterThanOrEqual(vh - 1e-6);
    expect(left + w / 2).toBeCloseTo(vw / 2, 3);
    expect(top + h / 2).toBeCloseTo(vh / 2, 3);
  }

  it('a box not yet laid out (0 x 0) takes the window size on the first render, covering and centred', () => {
    vi.stubGlobal('innerWidth', 375);
    vi.stubGlobal('innerHeight', 812);
    HTMLElement.prototype.getBoundingClientRect = rectOf(0, 0) as unknown as typeof HTMLElement.prototype.getBoundingClientRect;
    const r = render(<TutorBackdrop {...base} view={BACKDROP_IDENTITY} />);
    expectCoversCentred(sceneOf(r.host), 375, 812);
    expect(parseFloat(sceneOf(r.host).style.width)).toBeCloseTo(375, 3); // the picture's width fits the phone
    r.unmount();
  });

  it('a mocked box of the phone size is covered and centred on the first render too', () => {
    vi.stubGlobal('innerWidth', 375);
    vi.stubGlobal('innerHeight', 812);
    HTMLElement.prototype.getBoundingClientRect = rectOf(375, 812) as unknown as typeof HTMLElement.prototype.getBoundingClientRect;
    const r = render(<TutorBackdrop {...base} view={BACKDROP_IDENTITY} />);
    expectCoversCentred(sceneOf(r.host), 375, 812);
    r.unmount();
  });

  it('a wide window: the picture is fitted by its height and still centred', () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 500);
    HTMLElement.prototype.getBoundingClientRect = rectOf(1000, 500) as unknown as typeof HTMLElement.prototype.getBoundingClientRect;
    const r = render(<TutorBackdrop {...base} view={BACKDROP_IDENTITY} />);
    expectCoversCentred(sceneOf(r.host), 1000, 500);
    r.unmount();
  });
});

describe('TutorBackdrop (背景 layer)', () => {
  it('the classroom scene covers the stage with the picture ratio (400 px wide here, centred)', () => {
    const r = render(<TutorBackdrop {...base} view={BACKDROP_IDENTITY} />);
    const s = sceneOf(r.host);
    expect(s.style.width).toBe('400px');
    expect(parseFloat(s.style.height)).toBeCloseTo((400 * DEFAULT_SCENE.height) / DEFAULT_SCENE.width, 1);
    expect(parseFloat(s.style.left)).toBeCloseTo(0, 9);
    expect(r.host.querySelector('img.tutor-bg')).toBeTruthy();
    r.unmount();
  });

  it('a picture of the player (not anchored) covers the stage itself', () => {
    const r = render(<TutorBackdrop {...base} anchored={false} view={BACKDROP_IDENTITY} />);
    expect(sceneOf(r.host).style.width).toBe('400px');
    expect(sceneOf(r.host).style.height).toBe('800px');
    r.unmount();
  });

  it('a saved view that would leave an empty edge is clamped back: the scene still covers the stage', () => {
    // 2x: the scene is 800 px wide, so it may move 200 px at most; the saved 9999 px pulls back to 200 px
    const r = render(<TutorBackdrop {...base} view={{ scale: 2, x: 9999, y: 0 }} />);
    const s = sceneOf(r.host);
    expect(s.style.width).toBe('800px');
    expect(parseFloat(s.style.left)).toBeCloseTo(0, 9);
    r.unmount();
  });

  it('the scale is kept within 1x..3x', () => {
    const r = render(<TutorBackdrop {...base} anchored={false} view={{ scale: 7, x: 0, y: 0 }} />);
    expect(sceneOf(r.host).style.width).toBe('1200px');
    r.unmount();
  });

  it('the dimming is a black layer over the picture, and absent at 0%', () => {
    const dimmed = render(<TutorBackdrop {...base} dim={25} view={BACKDROP_IDENTITY} />);
    expect(dimmed.host.querySelector<HTMLElement>('.tutor-dim')!.style.opacity).toBe('0.25');
    dimmed.unmount();
    const none = render(<TutorBackdrop {...base} dim={0} view={BACKDROP_IDENTITY} />);
    expect(none.host.querySelector('.tutor-dim')).toBeNull();
    none.unmount();
  });

  it('the children (her, on the lectern) are drawn inside the scene; touch is taken only while the background is the zoom target', () => {
    const r = render(<TutorBackdrop {...base} view={BACKDROP_IDENTITY}><i className="kid" /></TutorBackdrop>);
    expect(sceneOf(r.host).querySelector('.kid')).toBeTruthy();
    expect(r.host.querySelector('.tutor-backdrop')?.classList.contains('zoom-on')).toBe(false);
    r.unmount();
    const z = render(<TutorBackdrop {...base} gestures view={BACKDROP_IDENTITY} />);
    expect(z.host.querySelector('.tutor-backdrop')?.classList.contains('zoom-on')).toBe(true);
    z.unmount();
  });
});

describe('the zoom target toggle (角色｜背景) in the tutor view', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.setItem('mugien.tutorZoom.on', '1'); // free zoom is on for the session
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('the classroom background is the full screen: a layer of the tutor itself, outside the stage (behind the bar and the chat)', async () => {
    const TutorView = (await import('../TutorView')).default;
    const { act: a } = await import('react');
    const { createRoot: cr } = await import('react-dom/client');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = cr(host);
    await a(async () => { root.render(<TutorView onBack={() => {}} />); });
    const backdrop = host.querySelector('.tutor-backdrop')!;
    expect(backdrop.parentElement?.classList.contains('tutor')).toBe(true);
    expect(host.querySelector('.tutor-stage .tutor-backdrop')).toBeNull();
    // the hamster is drawn in her own layer on the scene's default box (not inside the zoomable scene), on the same full-screen cover
    expect(backdrop.querySelector('.tutor-scene .tutor-portrait')).toBeNull();
    expect(backdrop.querySelector('.tutor-figure-layer .tutor-portrait')).toBeTruthy();
    a(() => root.unmount());
    host.remove();
  }, 60_000);

  it('is shown with the classroom, and hidden for plain black', async () => {
    const TutorView = (await import('../TutorView')).default;
    const { act: a } = await import('react');
    const { createRoot: cr } = await import('react-dom/client');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = cr(host);
    await a(async () => { root.render(<TutorView onBack={() => {}} />); });
    const toggle = host.querySelector('.tutor-target');
    expect(toggle).toBeTruthy();
    expect([...host.querySelectorAll('.tutor-target button')].map((b) => b.textContent)).toEqual(['角色', '背景']);
    a(() => root.unmount());
    host.remove();

    localStorage.setItem('mugien.tutor.v1', JSON.stringify({ background: 'black' }));
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const root2 = cr(host2);
    await a(async () => { root2.render(<TutorView onBack={() => {}} />); });
    expect(host2.querySelector('.tutor-target')).toBeNull();
    a(() => root2.unmount());
    host2.remove();
  }, 60_000);
});
