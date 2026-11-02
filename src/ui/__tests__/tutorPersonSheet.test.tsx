// @vitest-environment jsdom
// The 人物 sheet of 英語家教: the top bar's buttons, the sheet's sections (moved out of 設定), the free zoom at the top left, and
// her saved figure view (only with a custom picture; the hamster starts at the default framing). The custom picture is a fake
// from the mocked loadCustomArt; nothing is sent anywhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TUTOR_KEY } from '../../game/tutor';

// React's act() needs the flag in a test environment; without it act() warns on every call
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ art: null as unknown }));
vi.mock('../../game/customArt', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../game/customArt')>();
  return { ...m, loadCustomArt: async () => fake.art };
});

let store: Map<string, string>;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  URL.createObjectURL = vi.fn(() => 'blob:picture');
  URL.revokeObjectURL = vi.fn();
  fake.art = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function mount(saved?: Record<string, unknown>) {
  if (saved) store.set(TUTOR_KEY, JSON.stringify(saved));
  const TutorView = (await import('../TutorView')).default;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<TutorView />); });
}

function unmount() {
  act(() => root.unmount());
  host.remove();
}

const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label) ?? null;
const headings = () => [...host.querySelectorAll('.sheet h3')].map((h) => h.textContent);
const figureTransform = () => host.querySelector<HTMLElement>('.tutor-zoom')?.style.transform ?? '';
async function openSheet(label: string) {
  await act(async () => { button(label)!.click(); });
}
async function closeSheet() {
  await act(async () => { host.querySelector<HTMLButtonElement>('.sheet-close')!.click(); });
}

describe('the top bar', () => {
  it('has 設定, 速查 and 小提醒 on the right, in that order, and the subtitle under the name', async () => {
    await mount({ characters: [{ id: 'mugi', name: 'ミオ', subtitle: '猫・英語家教' }] });
    const labels = [...host.querySelectorAll('.tutor-tools > button')].map((b) => b.getAttribute('aria-label')?.split('，')[0]);
    expect(labels).toEqual(['設定', '速查', '小提醒筆記本']);
    expect(host.querySelector('.tutor-title strong')?.textContent).toBe('ミオ');
    expect(host.querySelector('.tutor-title span')?.textContent).toBe('猫・英語家教');
    unmount();
  }, 60_000);

  it('the free zoom is at the top left, outside the right-hand tools', async () => {
    await mount();
    expect(button('自由縮放')).not.toBeNull();
    expect(host.querySelector('.tutor-tools button[aria-label="自由縮放"]')).toBeNull();
    expect(host.querySelector('.tutor-zoom-tools button[aria-label="自由縮放"]')).not.toBeNull();
    unmount();
  }, 60_000);

  it('人物 sits at the top left, to the left of the zoom button', async () => {
    await mount();
    const people = host.querySelector('.tutor-zoom-tools button[aria-label="人物"]');
    const zoom = host.querySelector('.tutor-zoom-tools button[aria-label="自由縮放"]');
    expect(people).not.toBeNull();
    expect(host.querySelector('.tutor-tools button[aria-label="人物"]')).toBeNull();
    expect(people!.compareDocumentPosition(zoom!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
  }, 60_000);

  it('the 人物 sheet shows the tabs 1, 2, 3 and ＋, with 1 selected', async () => {
    await mount();
    await openSheet('人物');
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('.char-tabs[aria-label="角色"] > button')].map((b) => b.textContent);
    expect(tabs).toEqual(['1', '2', '3', '＋']);
    expect(host.querySelector('.char-tabs[aria-label="角色"] [aria-selected="true"]')?.textContent).toBe('1');
    expect(host.querySelector('.sheet')?.textContent).toContain('背景（所有角色共用）');
    await closeSheet();
    unmount();
  }, 60_000);

  it('the 角色｜背景 target shows under the zoom button only while the zoom is on with a background', async () => {
    await mount();
    expect(host.querySelector('.tutor-target')).toBeNull();
    await act(async () => { button('自由縮放')!.click(); });
    expect(host.querySelector('.tutor-zoom-tools .tutor-target')).not.toBeNull();
    unmount();
  }, 60_000);
});

describe('the sheets: 人物 and 設定', () => {
  it('人物 holds the name, the subtitle, 人設, 人設圖片 and 背景圖片; 設定 no longer does', async () => {
    await mount();
    await openSheet('人物');
    expect(host.querySelector('.sheet')?.getAttribute('aria-label')).toBe('人物');
    expect(host.querySelector('input[aria-label="名字"]')).not.toBeNull();
    expect(host.querySelector('input[aria-label="副標"]')).not.toBeNull();
    expect(headings()).toEqual(expect.arrayContaining(['名字', '人設', '人設圖片', '背景圖片']));
    // no custom picture: the 人物位置 row is not shown
    expect(headings()).not.toContain('人物位置');
    await closeSheet();
    await openSheet('設定');
    expect(host.querySelector('.sheet')?.getAttribute('aria-label')).toBe('設定');
    const settings = headings();
    expect(settings).toEqual(expect.arrayContaining(['AI 服務', '金鑰', '每日預算上限', 'Claude 模型', '聲音', '對話', '用量']));
    for (const moved of ['名字', '人設', '人設圖片', '背景圖片', '人物位置']) expect(settings).not.toContain(moved);
    expect(host.querySelector('input[aria-label="名字"]')).toBeNull();
    await closeSheet();
    unmount();
  }, 60_000);

  it('opening one sheet closes the other', async () => {
    await mount();
    await openSheet('人物');
    await openSheet('設定');
    expect(host.querySelectorAll('.sheet-backdrop')).toHaveLength(1);
    expect(host.querySelector('.sheet')?.getAttribute('aria-label')).toBe('設定');
    unmount();
  }, 60_000);
});

describe('her figure view (角色)', () => {
  it('the hamster starts at the default framing, and the stored view is not touched', async () => {
    await mount({ characters: [{ id: 'mugi', figureView: { scale: 2, x: 10, y: 0 } }] });
    expect(figureTransform()).toContain('scale(1)');
    expect(JSON.parse(store.get(TUTOR_KEY)!).characters[0].figureView).toEqual({ scale: 2, x: 10, y: 0 });
    unmount();
  }, 60_000);

  it('with a custom picture the saved view is restored, and it is kept on mount', async () => {
    fake.art = { mode: 'single', frames: [{ id: 'f1', viseme: null, blob: new Blob(['x'], { type: 'image/png' }) }] };
    await mount({ characters: [{ id: 'mugi', figureView: { scale: 2, x: 10, y: 0 } }] });
    expect(figureTransform()).toContain('scale(2)');
    expect(JSON.parse(store.get(TUTOR_KEY)!).characters[0].figureView).toEqual({ scale: 2, x: 10, y: 0 });
    unmount();
  }, 60_000);

  it('with a custom picture, 人物位置 shows and its 重設位置 clears the saved view', async () => {
    fake.art = { mode: 'single', frames: [{ id: 'f1', viseme: null, blob: new Blob(['x'], { type: 'image/png' }) }] };
    await mount({ characters: [{ id: 'mugi', figureView: { scale: 2, x: 10, y: 0 } }] });
    await openSheet('人物');
    expect(headings()).toContain('人物位置');
    expect(host.querySelector('.sheet')?.textContent).toContain('用左上角的放大鏡、選『角色』拖曳或縮放來調整；點兩下還原');
    const reset = [...host.querySelectorAll<HTMLButtonElement>('.sheet button')].find((b) => b.textContent === '重設位置')!;
    await act(async () => { reset.click(); });
    expect(JSON.parse(store.get(TUTOR_KEY)!).characters[0].figureView).toBeNull();
    await closeSheet();
    expect(figureTransform()).toContain('scale(1)');
    unmount();
  }, 60_000);
});
