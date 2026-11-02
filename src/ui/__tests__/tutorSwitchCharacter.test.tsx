// @vitest-environment jsdom
// Regression: switching characters in the 人物 sheet keeps exactly one persona box and one picture section. The bug was two
// siblings with the same React key (the character id), so React kept the old persona box and stacked the new one beside it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TUTOR_KEY } from '../../game/tutor';

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

async function mount() {
  store.set(TUTOR_KEY, JSON.stringify({
    characters: [{ id: 'mugi', name: 'Mugi', persona: '元氣的倉鼠' }, { id: 'yui', name: 'Lily', persona: '冷靜的老師' }],
    activeId: 'mugi',
  }));
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

async function openSheet() {
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === '人物')!.click();
  });
}

async function pickTab(index: number) {
  await act(async () => {
    host.querySelectorAll<HTMLButtonElement>('.char-tabs[aria-label="角色"] > button')[index].click();
  });
}

const personaBoxes = () => host.querySelectorAll('textarea.as-persona').length;
const pictureSections = () => host.querySelectorAll('[aria-label="人設圖片的形式"]').length;

describe('switching characters in the 人物 sheet', () => {
  it('keeps exactly one persona box and one picture section, and shows the chosen character\'s persona', async () => {
    await mount();
    await openSheet();
    expect(personaBoxes()).toBe(1);
    expect(pictureSections()).toBe(1);
    expect(host.querySelector<HTMLTextAreaElement>('textarea.as-persona')?.value).toBe('元氣的倉鼠');

    await pickTab(1);
    expect(personaBoxes()).toBe(1);
    expect(pictureSections()).toBe(1);
    expect(host.querySelector<HTMLTextAreaElement>('textarea.as-persona')?.value).toBe('冷靜的老師');

    await pickTab(0);
    expect(personaBoxes()).toBe(1);
    expect(pictureSections()).toBe(1);
    expect(host.querySelector<HTMLTextAreaElement>('textarea.as-persona')?.value).toBe('元氣的倉鼠');
    unmount();
  }, 60_000);
});
